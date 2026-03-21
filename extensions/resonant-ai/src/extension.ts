/*---------------------------------------------------------------------------------------------
 *  Resonant AI Extension — Thin Client
 *  Registers as a Language Model Provider + Chat Participant for the built-in Chat panel.
 *  All orchestration (system prompt, tool selection, agentic loop) runs server-side.
 *  This client renders UI, discovers local LLM models, and executes tools locally.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';
import { ResonantAuthService } from './authService';
import { ResonantAuthenticationProvider } from './authProvider';
import { ResonantLanguageModelProvider } from './languageModelProvider';
import { ProfileWebviewProvider } from './profileWebview';
import { SettingsPanelProvider } from './settingsPanel';
import { ResonantAgentProvider } from './agentProvider';
import { ResonantChatViewProvider } from './chatViewProvider';
import { executeToolCall, setAuthInfo, retrieveRelevantMemories, storeConversationSummary } from './toolExecutor';
import { LOCAL_TOOL_DEFINITIONS, TOOL_COUNT } from './toolDefinitions';
import { initLocTracker, trackToolLOC, flushEvents as flushLocEvents, disposeLocTracker, updateLocAuth, getSessionStats, getSessionDelta } from './locTracker';
import { initUpdateChecker, registerCommands as registerUpdateCommands, updateCheckerAuth, disposeUpdateChecker } from './updateChecker';
import { ResonantInlineCompletionProvider, setInlineCompletionAuth, setInlineCompletionModel, setInlineCompletionEnabled } from './inlineCompletionProvider';
import { testLocalConnection, listLocalModels } from './localLLMProvider';
import { disposeAllSessions as disposeTerminalSessions } from './interactiveTerminal';

/** Compact summary of Code Visualizer results for the LLM.
 *  Full report stays local — user sees it in chat. Only this summary goes to server. */
const CV_TOOLS = new Set(['code_visualizer_scan', 'code_visualizer_graph', 'code_visualizer_functions', 'code_visualizer_governance', 'code_visualizer_trace', 'code_visualizer_filter', 'code_visualizer_by_type']);
function summarizeCVForServer(toolName: string, raw: string): string {
	try {
		const d = JSON.parse(raw);
		if (d.error) { return raw; }
		const lines: string[] = [`Code Visualizer (${toolName}) completed.`];
		const s = d.stats || d.analysis?.stats || {};
		if (s.total_services) { lines.push(`Services: ${s.total_services}`); }
		if (s.files_analyzed) { lines.push(`Files analyzed: ${s.files_analyzed}${s.truncated ? ' (capped)' : ''}`); }
		if (s.total_functions) { lines.push(`Functions: ${s.total_functions}`); }
		if (s.total_endpoints) { lines.push(`Endpoints: ${s.total_endpoints}`); }
		if (s.total_connections) { lines.push(`Connections: ${s.total_connections}`); }
		if (s.broken_connections) { lines.push(`Broken connections: ${s.broken_connections}`); }
		const services = d.services || {};
		const svcNames = Object.keys(services).slice(0, 15);
		if (svcNames.length) { lines.push(`Service names: ${svcNames.join(', ')}`); }
		const nodes = d.nodes || [];
		const funcs = nodes.filter((n: any) => n.type === 'function').slice(0, 15);
		if (funcs.length) {
			lines.push(`Top functions:`);
			for (const f of funcs) { lines.push(`  - ${f.name} (${f.file_path}:${f.line_start || '?'})`); }
		}
		const eps = nodes.filter((n: any) => n.type === 'api_endpoint').slice(0, 15);
		if (eps.length) {
			lines.push(`API endpoints:`);
			for (const ep of eps) { lines.push(`  - ${ep.metadata?.route || ep.name} (${ep.file_path})`); }
		}
		if (d.reachability_score !== undefined) { lines.push(`Reachability: ${d.reachability_score}`); }
		if (d.drift_score !== undefined) { lines.push(`Drift: ${d.drift_score}`); }
		const violations = d.violations || [];
		if (violations.length) {
			lines.push(`Violations: ${violations.length}`);
			for (const v of violations.slice(0, 5)) { lines.push(`  - ${v.type || v.rule || 'issue'}: ${String(v.message || v.details || '').slice(0, 120)}`); }
		}
		lines.push('');
		lines.push('Full detailed report is shown to the user in the IDE. Discuss architecture, patterns, and findings — do NOT ask to re-scan.');
		return lines.join('\n');
	} catch {
		return raw.length > 5000 ? raw.slice(0, 5000) + '\n... (truncated for server)' : raw;
	}
}

/** POST tool result back to server for the server-side agent loop */
function postToolResult(
	apiUrl: string,
	authToken: string,
	sessionId: string,
	toolCallId: string,
	name: string,
	result: string,
): Promise<void> {
	return new Promise((resolve, reject) => {
		const url = new URL(`${apiUrl}/api/v1/ide/agent-stream/${sessionId}/tool-results`);
		const payload = JSON.stringify({ tool_call_id: toolCallId, name, result });
		const isHttps = url.protocol === 'https:';
		const reqModule = isHttps ? https : http;
		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
			'Content-Length': String(Buffer.byteLength(payload)),
		};
		if (authToken.startsWith('RG-')) {
			headers['x-api-key'] = authToken;
		} else {
			headers['Authorization'] = `Bearer ${authToken}`;
			headers['Cookie'] = `rg_access_token=${authToken}`;
		}
		const req = reqModule.request({
			hostname: url.hostname,
			port: url.port || (isHttps ? 443 : 80),
			path: url.pathname,
			method: 'POST',
			headers,
		}, (res) => {
			let body = '';
			res.on('data', (c: Buffer) => { body += c.toString(); });
			res.on('end', () => {
				if (res.statusCode && res.statusCode < 400) { resolve(); }
				else { reject(new Error(`Tool result POST ${res.statusCode}: ${body.slice(0, 200)}`)); }
			});
			res.on('error', reject);
		});
		req.on('error', reject);
		req.write(payload);
		req.end();
	});
}

/**
 * Server-side agentic loop via SSE. The server runs the loop (LLM calls,
 * tool selection, message history, system prompt). The client only renders
 * UI and executes tools locally when the server requests it.
 *
 * This is the THIN CLIENT path — all orchestration logic is on the server.
 * Tool definitions and system prompts never leave the server.
 */
function processServerAgentLoop(
	apiUrl: string,
	authToken: string,
	body: Record<string, unknown>,
	workspaceRoot: string,
	chatResponse: vscode.ChatResponseStream,
	cancellationToken: vscode.CancellationToken,
): Promise<{ loops: number; toolCalls: number; tokens: number; provider: string; model: string; fallbackChain: Array<{ provider: string; model: string; attempt: number }> }> {
	return new Promise((resolve, reject) => {
		const url = new URL(`${apiUrl}/api/v1/ide/agent-stream`);
		const payload = JSON.stringify(body);
		const isHttps = url.protocol === 'https:';
		const reqModule = isHttps ? https : http;

		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
			'Accept': 'text/event-stream',
			'Content-Length': String(Buffer.byteLength(payload)),
		};
		if (authToken.startsWith('RG-')) {
			headers['x-api-key'] = authToken;
		} else {
			headers['Authorization'] = `Bearer ${authToken}`;
			headers['Cookie'] = `rg_access_token=${authToken}`;
		}

		let totalToolCalls = 0;
		const fallbackChain: Array<{ provider: string; model: string; attempt: number }> = [];
		let buffer = '';
		let resolved = false;

		const shortPath = (p: string): string => {
			if (!p) { return ''; }
			if (p.startsWith(workspaceRoot + '/')) { return p.slice(workspaceRoot.length + 1); }
			const parts = p.split('/');
			return parts.length > 3 ? '.../' + parts.slice(-2).join('/') : p;
		};
		const trunc = (s: string, n: number) => s && s.length > n ? s.slice(0, n) + '…' : (s || '');
		const resolvePath = (p: string | undefined): string => {
			if (!p) { return workspaceRoot; }
			if (require('path').isAbsolute(p)) { return p; }
			return require('path').join(workspaceRoot, p);
		};

		const FILE_TOOLS = new Set(['file_read', 'file_write', 'file_edit', 'multi_edit', 'file_delete', 'file_move', 'file_list']);

		/** Render ⚡ tool label + code preview in chat */
		const renderToolUI = (toolName: string, toolArgs: Record<string, any>): void => {
			let toolLabel = '';
			let codePreview = '';
			if (toolName === 'run_command') {
				const cmd = (toolArgs.command || '').slice(0, 120);
				const cwd = toolArgs.cwd ? shortPath(toolArgs.cwd) : '';
				toolLabel = `Command${cwd ? ' in \`' + cwd + '\`' : ''}`;
				codePreview = `\n\`\`\`sh\n${cmd}\n\`\`\`\n`;
			} else if (toolName === 'file_read') {
				toolLabel = `Read \`${shortPath(toolArgs.path || '')}\`${toolArgs.offset ? ` (lines ${toolArgs.offset}-${toolArgs.offset + (toolArgs.limit || 100)})` : ''}`;
			} else if (toolName === 'file_write') {
				toolLabel = `Write \`${shortPath(toolArgs.path || '')}\``;
				if (toolArgs.content) {
					const ext = (toolArgs.path || '').split('.').pop() || '';
					const lang = ext === 'ts' || ext === 'tsx' ? 'typescript' : ext === 'js' || ext === 'jsx' ? 'javascript' : ext === 'py' ? 'python' : ext === 'html' ? 'html' : ext === 'css' ? 'css' : ext === 'json' ? 'json' : '';
					codePreview = `\n\`\`\`${lang}\n${trunc(toolArgs.content, 500)}\n\`\`\`\n`;
				}
			} else if (toolName === 'file_edit') {
				const exp = toolArgs.explanation ? ` — ${toolArgs.explanation}` : '';
				toolLabel = `Edit \`${shortPath(toolArgs.path || '')}\`${exp}`;
				if (toolArgs.old_string || toolArgs.new_string) {
					codePreview = '\n\`\`\`diff\n';
					if (toolArgs.old_string) { codePreview += String(toolArgs.old_string).split('\n').slice(0, 8).map((l: string) => '- ' + l).join('\n') + '\n'; }
					if (toolArgs.new_string) { codePreview += String(toolArgs.new_string).split('\n').slice(0, 8).map((l: string) => '+ ' + l).join('\n') + '\n'; }
					codePreview += '\`\`\`\n';
				}
			} else if (toolName === 'multi_edit') {
				const n = Array.isArray(toolArgs.edits) ? toolArgs.edits.length : '?';
				toolLabel = `Multi-edit \`${shortPath(toolArgs.path || '')}\` (${n} edits)`;
			} else if (toolName === 'grep_search') {
				toolLabel = `Search: \`${trunc(toolArgs.pattern || '', 40)}\` in \`${shortPath(toolArgs.path || '')}\``;
			} else if (toolName === 'find_by_name') {
				toolLabel = `Find: \`${trunc(toolArgs.pattern || '', 40)}\``;
			} else if (toolName === 'search_web') {
				toolLabel = `Web search: \`${trunc(toolArgs.query || '', 50)}\``;
			} else if (toolName === 'file_list') {
				toolLabel = `List files in \`${shortPath(toolArgs.path || '')}\``;
			} else if (toolName === 'file_delete') {
				toolLabel = `Delete \`${shortPath(toolArgs.path || '')}\``;
			} else if (toolName === 'code_search') {
				toolLabel = `Code search: \`${trunc(toolArgs.query || '', 40)}\``;
			} else if (toolName === 'ssh_run') {
				toolLabel = `SSH run · ${toolArgs.user ? toolArgs.user + '@' : ''}${toolArgs.host || ''}`;
				if (toolArgs.command) { codePreview = `\n\`\`\`sh\n${trunc(toolArgs.command || '', 160)}\n\`\`\`\n`; }
			} else if (toolName.startsWith('terminal_')) {
				toolLabel = `Terminal: ${toolName.replace('terminal_', '')}`;
			} else if (toolName.startsWith('code_visualizer_')) {
				toolLabel = `Code analysis: ${toolName.replace('code_visualizer_', '')}`;
			} else {
				toolLabel = `${toolName.replace(/_/g, ' ')}`;
			}
			chatResponse.markdown(`\n\n> ⚡ ${toolLabel}\n`);
			if (codePreview) { chatResponse.markdown(codePreview); }
		};

		const req = reqModule.request({
			hostname: url.hostname,
			port: url.port || (isHttps ? 443 : 80),
			path: url.pathname,
			method: 'POST',
			headers,
		}, (res) => {
			if (res.statusCode !== 200) {
				let errBody = '';
				res.on('data', (c: Buffer) => { errBody += c.toString(); });
				res.on('end', () => reject(new Error(`API ${res.statusCode}: ${errBody.slice(0, 300)}`)));
				return;
			}

			res.on('data', (chunk: Buffer) => {
				buffer += chunk.toString();
				const blocks = buffer.split('\n\n');
				buffer = blocks.pop() || '';

				for (const block of blocks) {
					if (!block.trim()) { continue; }
					let event = '';
					let data = '';
					for (const line of block.split('\n')) {
						if (line.startsWith('event: ')) { event = line.slice(7); }
						else if (line.startsWith('data: ')) { data = line.slice(6); }
					}
					if (!data) { continue; }

					try {
						const p = JSON.parse(data);
						switch (event) {
							case 'thinking':
								chatResponse.progress(p.message || 'Thinking...');
								break;

							case 'text':
								if (p.content) { chatResponse.markdown(p.content); }
								break;

							case 'execute_tool': {
								const toolName: string = p.name || '';
								const toolArgs: Record<string, any> = p.arguments || {};
								const callId: string = p.tool_call_id || '';
								const sessionId: string = p.session_id || '';
								totalToolCalls++;

								// Normalize arg names
								toolArgs.path = toolArgs.path || toolArgs.file_path || toolArgs.file || toolArgs.filename;
								toolArgs.content = toolArgs.content || toolArgs.text || toolArgs.code || toolArgs.data;
								toolArgs.command = toolArgs.command || toolArgs.cmd || toolArgs.shell_command || toolArgs.CommandLine;
								toolArgs.pattern = toolArgs.pattern || toolArgs.query || toolArgs.search || toolArgs.regex;
								toolArgs.cwd = toolArgs.cwd || toolArgs.working_directory || toolArgs.directory || toolArgs.Cwd;
								toolArgs.input = toolArgs.input || toolArgs.text;

								// Render tool UI
								renderToolUI(toolName, toolArgs);

								// Execute locally, POST result back (async — server waits)
								(async () => {
									const toolStart = Date.now();
									let toolResult: string;
									try {
										const fakeTC = { id: callId, type: 'function' as const, function: { name: toolName, arguments: JSON.stringify(toolArgs) } };
										toolResult = await executeToolCall(fakeTC, workspaceRoot);
									} catch (err: unknown) {
										toolResult = JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
									}
									const toolTime = ((Date.now() - toolStart) / 1000).toFixed(1);
									const isError = toolResult.includes('"error"');
									chatResponse.markdown(`> ${isError ? '❌' : '✅'} **${toolTime}s**\n`);

									// Track LOC
									if (['file_write', 'file_edit', 'multi_edit'].includes(toolName) && !isError) {
										trackToolLOC(toolName, toolArgs);
									}
									// Auto-open files
									if (FILE_TOOLS.has(toolName)) {
										const filePath = resolvePath(toolArgs.path || toolArgs.source);
										if (filePath && filePath !== workspaceRoot) {
											try {
												const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
												await vscode.window.showTextDocument(doc, { preview: true, preserveFocus: true });
											} catch { /* file might not exist yet */ }
										}
									}
									// POST result to server so it can continue the loop
									// For Code Visualizer: send compact summary (full report stays local for user)
									const serverResult = CV_TOOLS.has(toolName) ? summarizeCVForServer(toolName, toolResult) : toolResult;
									try {
										await postToolResult(apiUrl, authToken, sessionId, callId, toolName, serverResult);
									} catch (err) {
										console.error('[Resonant AI] Failed to POST tool result:', err);
									}
								})().catch(err => console.error('[Resonant AI] Tool execution error:', err));
								break;
							}

							case 'fallback': {
								const attempt = p.attempt || fallbackChain.length + 1;
								fallbackChain.push({ provider: p.provider || '', model: p.model || '', attempt });
								if (attempt === 1) {
									chatResponse.progress(`Trying ${p.provider}/${p.model}...`);
								} else {
									chatResponse.progress(`Fallback #${attempt}: trying ${p.provider}/${p.model}...`);
								}
								break;
							}

							case 'tool_done':
								break;

							case 'stats':
								if (Array.isArray(p.fallback_chain)) {
									for (const fb of p.fallback_chain) {
										if (!fallbackChain.some(e => e.provider === fb.provider && e.attempt === fb.attempt)) {
											fallbackChain.push(fb);
										}
									}
								}
								if (!resolved) {
									resolved = true;
									const tokenCount = p.tokens || p.total_tokens || p.tokens_used
										|| (p.usage ? (p.usage.total_tokens || (p.usage.prompt_tokens || 0) + (p.usage.completion_tokens || 0)) : 0)
										|| 0;
									resolve({
										loops: p.loops || 0,
										toolCalls: p.tool_calls || totalToolCalls,
										tokens: tokenCount,
										provider: p.provider || '',
										model: p.model || '',
										fallbackChain,
									});
								}
								break;

							case 'done':
								if (!resolved) {
									resolved = true;
									resolve({ loops: 0, toolCalls: totalToolCalls, tokens: 0, provider: '', model: '', fallbackChain });
								}
								break;

							case 'error':
								if (!resolved) {
									resolved = true;
									reject(new Error(p.error || 'Unknown server error'));
								}
								break;
						}
					} catch { /* skip malformed SSE data */ }
				}
			});

			res.on('end', () => {
				if (!resolved) {
					resolved = true;
					resolve({ loops: 0, toolCalls: totalToolCalls, tokens: 0, provider: '', model: '', fallbackChain });
				}
			});
			res.on('error', (err) => { if (!resolved) { resolved = true; reject(err); } });
		});

		req.on('error', (err) => { if (!resolved) { resolved = true; reject(err); } });
		cancellationToken.onCancellationRequested(() => {
			req.destroy();
			if (!resolved) { resolved = true; resolve({ loops: 0, toolCalls: totalToolCalls, tokens: 0, provider: '', model: '', fallbackChain }); }
		});
		req.write(payload);
		req.end();
	});
}

let authService: ResonantAuthService;

export function activate(context: vscode.ExtensionContext) {
	console.log('[Resonant AI] Extension activating...');

	// Register VS Code authentication provider (powers the Sign In button)
	const authProvider = new ResonantAuthenticationProvider(context);
	context.subscriptions.push(authProvider);

	// Auth service for token management
	authService = new ResonantAuthService(context);
	context.subscriptions.push({ dispose: () => authService.dispose() });

	// Register as Language Model Provider for the built-in Chat panel
	const lmProvider = new ResonantLanguageModelProvider(
		context,
		async () => authService.getToken(),
	);
	context.subscriptions.push(
		vscode.lm.registerLanguageModelChatProvider('resonant', lmProvider),
	);
	console.log('[Resonant AI] Registered language model provider "resonant"');

	// Register inline completion provider (ghost text / Copilot-style completions)
	const inlineProvider = new ResonantInlineCompletionProvider();
	context.subscriptions.push(
		vscode.languages.registerInlineCompletionItemProvider({ pattern: '**' }, inlineProvider)
	);
	// Wire auth for inline completions when token is available
	const wireInlineAuth = () => {
		const token = authService.getToken();
		const config = vscode.workspace.getConfiguration('resonant');
		const apiUrl = (config.get<string>('apiUrl', '') || authService.getAuthDomain()) + '/api/v1/ide/completions';
		if (token) setInlineCompletionAuth(apiUrl, token);
		setInlineCompletionEnabled(config.get<boolean>('inlineCompletions', true));
	};
	wireInlineAuth();
	// Toggle command
	context.subscriptions.push(
		vscode.commands.registerCommand('resonant.toggleInlineCompletions', () => {
			const config = vscode.workspace.getConfiguration('resonant');
			const current = config.get<boolean>('inlineCompletions', true);
			config.update('inlineCompletions', !current, vscode.ConfigurationTarget.Global);
			setInlineCompletionEnabled(!current);
			vscode.window.showInformationMessage(`Resonant AI inline completions: ${!current ? 'ON' : 'OFF'}`);
		})
	);
	console.log('[Resonant AI] Registered inline completion provider');

	// Register as Chat Participant (agent) — full agentic loop with local tool execution.
	// Calls /api/v1/ide/completions DIRECTLY with LOCAL_TOOL_DEFINITIONS.
	const participant = vscode.chat.createChatParticipant(
		'resonant-genesis.resonant-ai.default',
		async (request, chatContext, response, token) => {
			const config = vscode.workspace.getConfiguration('resonant');
			const configuredUrl = config.get<string>('apiUrl', '');
			const apiUrl = configuredUrl || authService.getAuthDomain();
			const authToken = authService.getToken();
			const configuredLoops = config.get<number>('maxToolLoops', 15);
			const maxLoops = configuredLoops === 0 ? 999999 : configuredLoops; // 0 = unlimited
			const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
			const workspaceRoot = workspaceFolder || require('os').homedir();

			// Determine selected model from VS Code model picker (must be before auth check)
			let providerKey = 'groq';
			let modelName = 'llama-3.3-70b-versatile';
			try {
				// VS Code Chat API: request.model is the user's ACTUAL selection from the picker
				const selectedId: string | undefined = (request as any).model?.id;
				if (selectedId && selectedId.startsWith('resonant-')) {
					const parts = selectedId.replace(/^resonant-/, '').split('-');
					providerKey = parts[0];
					modelName = parts.slice(1).join('-');
				} else {
					// Fallback: selectChatModels returns ALL models — pick first (not ideal)
					const models = await vscode.lm.selectChatModels({ vendor: 'resonant' });
					if (models[0]) {
						const id = models[0].id;
						const parts = id.replace(/^resonant-/, '').split('-');
						providerKey = parts[0];
						modelName = parts.slice(1).join('-');
					}
				}
			} catch { /* use defaults */ }

			// Auth required for all modes — server handles orchestration even for local LLM
			if (!authToken) {
				response.markdown('⚠️ Please sign in first. Use **Resonant AI: Sign In** from the command palette or click the status bar.');
				return;
			}

			// Wire auth info for server-backed memory
			setAuthInfo(authToken, apiUrl);

			// Warn if no workspace folder is open
			if (!workspaceFolder) {
				response.markdown('⚠️ **No folder is open.** Please open a project folder first:\n\n1. **File → Open Folder** (or ⌘O)\n2. Select your project directory\n3. Then ask me to analyze it\n\nI need a workspace folder to read files, search code, and run tools.');
				return;
			}

			const openFile = vscode.window.activeTextEditor?.document.uri.fsPath;
			const locStart = getSessionStats();
			const startTime = Date.now();
			let totalToolCalls = 0;
			let totalTokens = 0;
			let loops = 0;
			let lastProvider = '';
			let lastModel = '';

			try {
				// ═══════════════════════════════════════════════════════════
				// SERVER-SIDE AGENTIC LOOP — thin client (ALL providers)
				// Server handles: LLM calls, tool selection, system prompt,
				// message history, retry logic. Client only renders UI and
				// executes tools locally when the server requests it.
				// For local LLM (Ollama): server proxies LLM calls through
				// the client's local endpoint.
				// ═══════════════════════════════════════════════════════════
				const chatHistoryContext: Array<{ role: string; content: string }> = [];
				for (const turn of chatContext.history) {
					if (turn instanceof vscode.ChatRequestTurn) {
						chatHistoryContext.push({ role: 'user', content: turn.prompt });
					} else if (turn instanceof vscode.ChatResponseTurn) {
						let text = '';
						for (const part of turn.response) {
							if (part instanceof vscode.ChatResponseMarkdownPart) { text += part.value.value; }
						}
						if (text) {
							let cleaned = text.replace(/\n\n---\n\*🔧[\s\S]*?\*\n?/g, '\n').replace(/\n\*✏️ Session LOC:[^\n]*\n?/g, '\n').trim();
							if (cleaned) { chatHistoryContext.push({ role: 'assistant', content: cleaned }); }
						}
					}
				}

				// Build request body — include local LLM info if user selected Ollama
				const requestBody: Record<string, unknown> = {
					prompt: request.prompt,
					workspace_root: workspaceRoot,
					active_file: openFile,
					model_id: `resonant-${providerKey}-${modelName}`,
					context: chatHistoryContext.slice(-40),
					max_loops: maxLoops,
				};
				if (providerKey === 'ollama') {
					const localLLMConfig = vscode.workspace.getConfiguration('resonant.localLLM');
					requestBody.local_llm = {
						url: localLLMConfig.get<string>('url', 'http://localhost:11434'),
						model: modelName || localLLMConfig.get<string>('model', 'llama3.1:8b'),
						context_length: localLLMConfig.get<number>('contextLength', 32768),
					};
				}

				const stats = await processServerAgentLoop(apiUrl, authToken!, requestBody, workspaceRoot, response, token);

				totalToolCalls = stats.toolCalls;
				totalTokens = stats.tokens;
				loops = stats.loops;
				lastProvider = stats.provider;
				lastModel = stats.model;

				// Summary line — always show metrics
				const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
				const tokenStr = totalTokens > 0 ? ` · ${totalTokens.toLocaleString()} tokens` : '';
				const providerStr = lastProvider ? ` · ${lastProvider}${lastModel ? '/' + lastModel : ''}` : '';
				const preferredStr = `${providerKey}/${modelName}`;
				const actualStr = lastProvider ? `${lastProvider}${lastModel ? '/' + lastModel : ''}` : '';
				const fbChain = stats.fallbackChain || [];
				response.markdown(`\n\n---\n*🔧 ${totalToolCalls} tool call${totalToolCalls !== 1 ? 's' : ''} · ${loops} loop${loops > 1 ? 's' : ''}${tokenStr} · ${elapsed}s${providerStr}*\n`);
				if (fbChain.length > 0) {
					// Deduplicate chain by provider (show unique providers tried)
					const seen = new Set<string>();
					const uniqueProviders: string[] = [];
					for (const fb of fbChain) {
						if (!seen.has(fb.provider)) {
							seen.add(fb.provider);
							uniqueProviders.push(fb.provider);
						}
					}
					const chainStr = uniqueProviders.map(p =>
						p === lastProvider ? `**${p}** ✓` : `~~${p}~~ ✗`
					).join(' → ');
					const wasPreferred = lastProvider === providerKey;
					const prefLabel = wasPreferred ? '' : ` · preferred: ${preferredStr}`;
					response.markdown(`*⚡ Provider chain: ${chainStr}${prefLabel}*\n`);
				} else if (actualStr && actualStr !== preferredStr) {
					response.markdown(`*⚡ Preferred: ${preferredStr} · Used: ${actualStr}*\n`);
				}

				if (loops >= maxLoops) {
					response.markdown(`\n\n*⚠️ Reached max loops (${maxLoops})*\n`);
				}

				// Show LOC stats for THIS chat turn (delta)
				const locDelta = getSessionDelta(locStart);
				if (locDelta.calls > 0) {
					response.markdown(`\n*✏️ Session LOC: ${locDelta.written} written, ${locDelta.edited} edited, ${locDelta.net} net*\n`);
				}

				// Flush LOC events after each conversation turn
				flushLocEvents();
			} catch (err: unknown) {
				const msg = err instanceof Error ? err.message : String(err);
				response.markdown(`\n\n*❌ Error:* ${msg}`);
			}
		},
	);
	participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'icon.svg');
	context.subscriptions.push(participant);
	console.log(`[Resonant AI] Registered chat participant with ${TOOL_COUNT} local tools`);

	// Commands
	context.subscriptions.push(
		vscode.commands.registerCommand('resonant.openChat', () => {
			// Open the built-in chat panel
			vscode.commands.executeCommand('workbench.action.chat.open');
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('resonant.newConversation', () => {
			vscode.commands.executeCommand('workbench.action.chat.newChat');
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('resonant.login', () => {
			authService.login();
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('resonant.logout', () => {
			authService.logout();
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('resonant.setApiKey', async () => {
			const key = await vscode.window.showInputBox({
				prompt: 'Enter your Resonant API key or JWT token',
				password: true,
				placeHolder: 'RG-xxxx or JWT token',
			});
			if (key) {
				await authService.setTokenManually(key);
			}
		}),
	);

	// ── Local LLM Commands ──
	context.subscriptions.push(
		vscode.commands.registerCommand('resonant.localLLM.testConnection', async () => {
			const localConfig = vscode.workspace.getConfiguration('resonant.localLLM');
			const localUrl = localConfig.get<string>('url', 'http://localhost:11434');
			const statusMsg = vscode.window.setStatusBarMessage(`$(loading~spin) Testing connection to ${localUrl}...`);
			try {
				const result = await testLocalConnection(localUrl);
				statusMsg.dispose();
				if (result.ok) {
					const models = await listLocalModels(localUrl);
					const modelList = models.map(m => `${m.name}${m.parameterSize ? ' (' + m.parameterSize + ')' : ''}`).join(', ');
					vscode.window.showInformationMessage(
						`✅ Connected to ${result.server} at ${localUrl}\n${models.length} model${models.length !== 1 ? 's' : ''}: ${modelList || 'none found'}`,
					);
					// Auto-enable if not already
					if (!localConfig.get<boolean>('enabled', false)) {
						const enable = await vscode.window.showInformationMessage(
							'Local LLM is not enabled. Enable it now?', 'Yes', 'No',
						);
						if (enable === 'Yes') {
							await localConfig.update('enabled', true, vscode.ConfigurationTarget.Global);
							lmProvider.refreshModels();
							vscode.window.showInformationMessage('Local LLM mode enabled! Select a local model from the model picker.');
						}
					}
				} else {
					vscode.window.showErrorMessage(`❌ Cannot connect to ${localUrl}: ${result.error}\n\nMake sure Ollama is running: ollama serve`);
				}
			} catch (err) {
				statusMsg.dispose();
				vscode.window.showErrorMessage(`Connection test failed: ${err instanceof Error ? err.message : String(err)}`);
			}
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('resonant.localLLM.listModels', async () => {
			const localUrl = vscode.workspace.getConfiguration('resonant.localLLM').get<string>('url', 'http://localhost:11434');
			try {
				const models = await listLocalModels(localUrl);
				if (models.length === 0) {
					vscode.window.showWarningMessage(`No models found at ${localUrl}. Pull a model with: ollama pull llama3.1:8b`);
					return;
				}
				const items = models.map(m => ({
					label: m.name,
					description: [m.parameterSize, m.quantization, m.family].filter(Boolean).join(' · '),
					detail: m.size > 0 ? `${(m.size / 1e9).toFixed(1)} GB` : undefined,
				}));
				const picked = await vscode.window.showQuickPick(items, {
					title: `Local Models (${localUrl})`,
					placeHolder: 'Select a model to set as default',
				});
				if (picked) {
					await vscode.workspace.getConfiguration('resonant.localLLM').update('model', picked.label, vscode.ConfigurationTarget.Global);
					lmProvider.refreshModels();
					vscode.window.showInformationMessage(`Default local model set to: ${picked.label}`);
				}
			} catch (err) {
				vscode.window.showErrorMessage(`Failed to list models: ${err instanceof Error ? err.message : String(err)}\n\nIs Ollama running? Start it with: ollama serve`);
			}
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('resonant.localLLM.selectModel', async () => {
			// Same as listModels — alias for discoverability
			vscode.commands.executeCommand('resonant.localLLM.listModels');
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('resonant.localLLM.toggle', async () => {
			const localConfig = vscode.workspace.getConfiguration('resonant.localLLM');
			const current = localConfig.get<boolean>('enabled', false);
			await localConfig.update('enabled', !current, vscode.ConfigurationTarget.Global);
			lmProvider.refreshModels();
			vscode.window.showInformationMessage(`Local LLM mode: ${!current ? 'ON ✅' : 'OFF'}`);
		}),
	);

	// Profile / Account Settings webview
	const profileProvider = new ProfileWebviewProvider(context, async () => authService.getToken());
	context.subscriptions.push(
		vscode.commands.registerCommand('resonant.openProfile', () => {
			profileProvider.show();
		}),
	);

	// Status bar settings panel (Windsurf-style)
	const settingsPanel = new SettingsPanelProvider(context, async () => authService.getToken(), () => authService.getAuthDomain());
	context.subscriptions.push(
		vscode.commands.registerCommand('resonant.openSettingsPanel', () => {
			settingsPanel.show();
		}),
		{ dispose: () => settingsPanel.dispose() },
	);
	settingsPanel.updateStatusBar();

	// Agent provider — fetches user agents from backend and registers as chat participants
	const agentProvider = new ResonantAgentProvider(context, async () => authService.getToken());
	context.subscriptions.push({ dispose: () => agentProvider.dispose() });
	agentProvider.activate();

	// Register custom Resonant AI Chat sidebar (shows SSE flow, tool calls, timing)
	const chatViewProvider = new ResonantChatViewProvider(context, authService);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider('resonant.chatView', chatViewProvider),
	);
	console.log('[Resonant AI] Registered Resonant AI Chat sidebar view');

	context.subscriptions.push(
		vscode.commands.registerCommand('resonant.toggleChatView', () => {
			vscode.commands.executeCommand('resonant.chatView.focus');
		}),
	);

	// Listen for auth changes — update status bar, re-fetch agents & models
	context.subscriptions.push(
		authService.onDidChangeAuth(async (loggedIn) => {
			console.log(`[Resonant AI] Auth changed: loggedIn=${loggedIn}`);
			await settingsPanel.onAuthChanged();
			chatViewProvider.onAuthChanged(loggedIn);
			if (loggedIn) {
				lmProvider.refreshModels();
				agentProvider.refreshAgents();
			}
		}),
	);

	// Command to refresh providers/agents manually
	context.subscriptions.push(
		vscode.commands.registerCommand('resonant.refreshProviders', () => {
			lmProvider.refreshModels();
			agentProvider.refreshAgents();
			vscode.window.showInformationMessage('Resonant AI: Refreshing providers and agents...');
		}),
	);

	// Initialize LOC tracker + update checker
	const initApiUrl = vscode.workspace.getConfiguration('resonant').get<string>('apiUrl', '') || authService.getAuthDomain();
	const initToken = authService.getToken();
	if (initToken) {
		initLocTracker(initApiUrl, initToken, 'pending', '');
		initUpdateChecker(context, initApiUrl, initToken);
	}
	registerUpdateCommands(context);

	// Update LOC/update auth when user logs in
	context.subscriptions.push(
		authService.onDidChangeAuth(async (loggedIn) => {
			if (loggedIn) {
				const url = vscode.workspace.getConfiguration('resonant').get<string>('apiUrl', '') || authService.getAuthDomain();
				const token = authService.getToken();
				updateLocAuth(url, token);
				updateCheckerAuth(url, token);
				initLocTracker(url, token, 'user', '');
			}
		}),
	);

	console.log('[Resonant AI] Extension activated — integrated into built-in Chat.');
}

export function deactivate() {
	disposeLocTracker();
	disposeUpdateChecker();
	disposeTerminalSessions();
	console.log('[Resonant AI] Extension deactivated.');
}
