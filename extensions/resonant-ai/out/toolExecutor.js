"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.setAskUserCallback = setAskUserCallback;
exports.setAuthInfo = setAuthInfo;
exports.registerTerminal = registerTerminal;
exports.appendTerminalOutput = appendTerminalOutput;
exports.executeToolCall = executeToolCall;
exports.setGlobalState = setGlobalState;
exports.storeConversationSummary = storeConversationSummary;
exports.retrieveRelevantMemories = retrieveRelevantMemories;
exports.registerMcpServer = registerMcpServer;
exports.getVisualization = getVisualization;
const vscode = __importStar(require("vscode"));
const cp = __importStar(require("child_process"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const https = __importStar(require("https"));
const http = __importStar(require("http"));
const interactiveTerminal = __importStar(require("./interactiveTerminal"));
// Callback for ask_user — set by chatViewProvider
let askUserCallback = null;
function setAskUserCallback(cb) {
    askUserCallback = cb;
}
// Auth info for server-backed memory
let _authToken = null;
let _authDomain = null;
function setAuthInfo(token, domain) {
    _authToken = token;
    _authDomain = domain;
}
// Track active terminals for read_terminal
const _terminals = new Map();
function registerTerminal(pid, name) {
    _terminals.set(pid, { name, output: '', pid: parseInt(pid, 10) });
}
function appendTerminalOutput(pid, data) {
    const t = _terminals.get(pid);
    if (t) {
        t.output += data;
        if (t.output.length > 100000)
            t.output = t.output.slice(-80000);
    }
}
async function executeToolCall(toolCall, workspaceRoot) {
    const name = toolCall.function.name;
    let args;
    try {
        args = JSON.parse(toolCall.function.arguments);
    }
    catch {
        return JSON.stringify({ error: `Invalid JSON arguments: ${toolCall.function.arguments}` });
    }
    // Normalize common arg name variations from different LLMs
    args.path = args.path || args.file_path || args.file || args.filename;
    args.content = args.content || args.text || args.code || args.data;
    args.command = args.command || args.cmd || args.shell_command || args.CommandLine;
    args.pattern = args.pattern || args.query || args.search || args.regex;
    args.old_string = args.old_string || args.old_text || args.find;
    args.new_string = args.new_string || args.new_text || args.replace;
    args.cwd = args.cwd || args.working_directory || args.directory || args.Cwd;
    args.input = args.input || args.text || args.command;
    try {
        switch (name) {
            case 'file_read': return await execFileRead(resolvePath(args.path, workspaceRoot), args.offset, args.limit);
            case 'file_write': return await execFileWrite(resolvePath(args.path, workspaceRoot), args.content);
            case 'file_edit': return await execFileEdit(resolvePath(args.path, workspaceRoot), args.old_string, args.new_string, args.replace_all, args.explanation);
            case 'multi_edit': return await execMultiEdit(resolvePath(args.path, workspaceRoot), args.edits, args.explanation);
            case 'file_list': return await execFileList(resolvePath(args.path, workspaceRoot) || workspaceRoot);
            case 'file_delete': return await execFileDelete(resolvePath(args.path, workspaceRoot));
            case 'grep_search': return await execGrepSearch(args.path || workspaceRoot, args.pattern, args.include, args.case_sensitive, args.match_per_line, args.fixed_strings);
            case 'find_by_name': return await execFindByName(args.path || workspaceRoot, args.pattern, args.type, args.max_depth, args.extensions, args.excludes, args.full_path);
            case 'run_command': return await execRunCommand(args.command, args.cwd || workspaceRoot, args.blocking, args.wait_ms_before_async, args.safe_to_auto_run);
            case 'read_terminal': return await execReadTerminal(args.process_id, args.name);
            case 'search_web': return await execSearchWeb(args.query, args.domain);
            case 'read_url_content': return await execReadUrl(args.url);
            case 'browser_check': return await execBrowserCheck(args.url, args.expect, args.timeout_seconds);
            case 'browser_preview': return await execBrowserPreview(args.url, args.name);
            case 'read_browser_logs': return await execReadBrowserLogs(args.preview_id);
            case 'ask_user': return await execAskUser(args.question, args.options, args.allow_multiple);
            case 'todo_list': return await execTodoList(args.todos);
            case 'save_memory': return await execSaveMemory(args.key, args.content, args.tags, args.action, args.id);
            case 'read_memory': return await execReadMemory(args.key, args.tag, args.query);
            case 'create_memory': return await execCreateMemory(args.action, args.title, args.content, args.tags, args.id);
            case 'read_notebook': return await execReadNotebook(args.path);
            case 'edit_notebook': return await execEditNotebook(args.path, args.cell_number, args.new_source, args.cell_type, args.edit_mode);
            case 'file_move': return await execFileMove(resolvePath(args.source, workspaceRoot), resolvePath(args.destination, workspaceRoot));
            case 'code_search': return await execCodeSearch(args.query, args.path || workspaceRoot);
            case 'command_status': return await execCommandStatus(args.command_id, args.wait_seconds, args.output_character_count);
            case 'view_content_chunk': return await execViewContentChunk(args.document_id, args.position);
            case 'trajectory_search': return await execTrajectorySearch(args.query, args.conversation_id);
            case 'platform_api_search': return await execPlatformApiSearch(args.query, args.category);
            case 'platform_api_call': return await execPlatformApiCall(args.method, args.path, args.body);
            // Git operations
            case 'git_status': return await execShell(`git status --porcelain`, args.path || workspaceRoot);
            case 'git_diff': return await execShell(`git diff ${args.staged ? '--staged' : ''} ${args.file ? `-- "${args.file}"` : ''} | head -500`, args.path || workspaceRoot);
            case 'git_log': return await execShell(`git log --oneline -n ${args.count || 10} ${args.file ? `-- "${args.file}"` : ''}`, args.path || workspaceRoot);
            case 'git_commit': return await execGitCommit(args.path || workspaceRoot, args.message, args.files);
            case 'git_push': return await execShell(`git push ${args.remote || 'origin'} ${args.branch || 'HEAD'}`, args.path || workspaceRoot);
            case 'git_pull': return await execShell(`git pull ${args.remote || 'origin'} ${args.branch || ''}`, args.path || workspaceRoot);
            case 'git_branch': return await execGitBranch(args.path || workspaceRoot, args.action, args.name);
            // Code Visualizer — real local Python analyzer (AST parsing, services, pipelines, governance)
            case 'code_visualizer_scan': return await cvExec('scan', args.path || workspaceRoot);
            case 'code_visualizer_functions': return await cvExec('functions', args.path || workspaceRoot);
            case 'code_visualizer_trace': return await cvExec('trace', args.path || workspaceRoot, [args.query || 'main', String(args.max_depth || 10)]);
            case 'code_visualizer_governance': return await cvExec('governance', args.path || workspaceRoot, [String(args.drift_threshold || 20.0)]);
            case 'code_visualizer_graph': return await cvExec('graph', args.path || workspaceRoot);
            case 'code_visualizer_pipeline': return await cvExec('pipeline', args.path || workspaceRoot, [args.pipeline_name || '']);
            case 'code_visualizer_filter': return await cvExec('filter', args.path || workspaceRoot, [...(args.file_path ? [`--file=${args.file_path}`] : []), ...(args.node_type ? [`--type=${args.node_type}`] : []), ...(args.keyword ? [`--keyword=${args.keyword}`] : [])]);
            case 'code_visualizer_by_type': return await cvExec('by_type', args.path || workspaceRoot, [args.node_type || 'function']);
            case 'code_visualizer_compare': return await cvExec('compare', args.paths || '', [args.labels || '']);
            case 'code_visualizer_live_nodes': return await cvExec('live_nodes', args.path || workspaceRoot, [String(args.drift_threshold || 20.0)]);
            case 'code_visualizer_invalid_nodes': return await cvExec('invalid_nodes', args.path || workspaceRoot, [String(args.drift_threshold || 20.0)]);
            case 'code_visualizer_compile': return await cvExec('compile', args.path || workspaceRoot, [args.gal_action || '{}']);
            case 'code_visualizer_verify_invariants': return await cvExec('verify_invariants', args.path || workspaceRoot);
            // Graph Janitor Agent — autonomous dead code / reachability scanner (runs locally via GovernanceEngine)
            case 'graph_janitor_scan': return await cvExec('graph_janitor', args.path || workspaceRoot, [String(args.max_proposals || 15), String(args.drift_threshold || 20.0)]);
            // Compatibility aliases (LLMs sometimes hallucinate *_github variants)
            case 'code_visualizer_scan_github': return await cvExec('scan', args.path || workspaceRoot);
            case 'graph_janitor_scan_github': return await cvExec('graph_janitor', args.path || workspaceRoot, [String(args.max_proposals || 15), String(args.drift_threshold || 20.0)]);
            // Interactive Terminal
            case 'terminal_create': return await execTerminalCreate(args.name, args.cwd || workspaceRoot, args.shell);
            case 'terminal_send': return await execTerminalSend(args.session_id, args.input);
            case 'terminal_send_raw': return await execTerminalSendRaw(args.session_id, args.input);
            case 'terminal_read': return await execTerminalRead(args.session_id, args.last_n_chars);
            case 'terminal_wait': return await execTerminalWait(args.session_id, args.timeout_ms, args.stable_ms);
            case 'terminal_list': return JSON.stringify({ sessions: interactiveTerminal.listSessions() });
            case 'terminal_close': return JSON.stringify(interactiveTerminal.closeSession(args.session_id));
            case 'terminal_clear': return JSON.stringify(interactiveTerminal.clearOutput(args.session_id));
            // Deployment
            case 'deploy_web_app': return await execDeployWebApp(args.project_path || workspaceRoot, args.framework, args.subdomain, args.provider);
            case 'check_deploy_status': return await execCheckDeployStatus(args.deployment_id);
            case 'read_deployment_config': return await execReadDeploymentConfig(args.project_path || workspaceRoot);
            case 'ssh_run': return await execSshRun(args.host, args.user, args.command, args.port);
            case 'droplet_docker_status': return await execDropletDockerStatus(args.host, args.user, args.port);
            case 'droplet_deploy_frontend': return await execDropletDeployFrontend(args.host, args.user, args.repo_dir, args.web_root, args.branch);
            // MCP (Model Context Protocol)
            case 'list_mcp_resources': return await execListMcpResources(args.server_name);
            case 'read_mcp_resource': return await execReadMcpResource(args.server_name, args.uri);
            // Workflows
            case 'list_workflows': return await execListWorkflows(workspaceRoot);
            case 'run_workflow': return await execRunWorkflow(args.name, workspaceRoot);
            // Conversation checkpoints
            case 'save_checkpoint': return await execSaveCheckpoint(args.summary, args.key_files, args.pending_tasks);
            case 'load_checkpoint': return await execLoadCheckpoint();
            // Visual tools
            case 'visualize': return await execVisualize(args.title, args.svg, args.mermaid, args.width, args.height);
            case 'image_search': return await execImageSearch(args.query, args.count);
            default: return JSON.stringify({ error: `Unknown tool: ${name}` });
        }
    }
    catch (err) {
        return JSON.stringify({ error: `Tool execution failed: ${err.message}` });
    }
}
// ── Path Resolution ──
/** Resolve a path against workspaceRoot if it's relative */
function resolvePath(filePath, workspaceRoot) {
    if (!filePath)
        return workspaceRoot;
    if (path.isAbsolute(filePath))
        return filePath;
    return path.join(workspaceRoot, filePath);
}
// ── File Operations ──
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'tiff', 'ico', 'heic', 'heif']);
async function execFileRead(filePath, offset, limit) {
    try {
        const ext = path.extname(filePath).replace('.', '').toLowerCase();
        // Image file support — return base64 + metadata
        if (IMAGE_EXTENSIONS.has(ext)) {
            const data = fs.readFileSync(filePath);
            const base64 = data.toString('base64');
            const sizeKB = (data.byteLength / 1024).toFixed(1);
            return JSON.stringify({
                path: filePath,
                type: 'image',
                format: ext,
                size_kb: parseFloat(sizeKB),
                base64_preview: base64.slice(0, 200) + '...',
                message: `Image file: ${path.basename(filePath)} (${sizeKB} KB, ${ext}). Full base64 available but not shown to save tokens.`,
            });
        }
        let content = fs.readFileSync(filePath, 'utf-8');
        if (offset || limit) {
            const lines = content.split('\n');
            const start = (offset || 1) - 1;
            const end = limit ? start + limit : lines.length;
            const sliced = lines.slice(start, end);
            content = sliced.map((line, i) => `${start + i + 1}\t${line}`).join('\n');
            return JSON.stringify({ path: filePath, total_lines: lines.length, showing: `${start + 1}-${Math.min(end, lines.length)}`, content });
        }
        return JSON.stringify({ path: filePath, content });
    }
    catch (e) {
        return JSON.stringify({ error: e.message });
    }
}
async function execFileWrite(filePath, content) {
    try {
        if (content === undefined || content === null) {
            console.error('[Resonant Tool] file_write: content is missing/undefined for', filePath);
            return JSON.stringify({ error: 'file_write requires "content" argument. The content to write was missing or undefined.' });
        }
        const text = typeof content === 'string' ? content : String(content);
        console.log(`[Resonant Tool] file_write: writing ${text.length} bytes to ${filePath}`);
        // Use Node.js fs directly — more reliable than vscode.workspace.fs in dev builds
        const dir = path.dirname(filePath);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, text, 'utf-8');
        // Verify write succeeded
        const stat = fs.statSync(filePath);
        console.log(`[Resonant Tool] file_write: verified ${stat.size} bytes on disk at ${filePath}`);
        return JSON.stringify({ path: filePath, written: true, bytes: text.length });
    }
    catch (e) {
        console.error('[Resonant Tool] file_write FAILED:', e.message, 'path:', filePath);
        return JSON.stringify({ error: e.message });
    }
}
async function execFileEdit(filePath, oldStr, newStr, replaceAll, explanation) {
    try {
        console.log(`[Resonant Tool] file_edit: ${filePath}`);
        const content = fs.readFileSync(filePath, 'utf-8');
        if (!content.includes(oldStr)) {
            return JSON.stringify({ error: 'old_string not found in file' });
        }
        const newContent = replaceAll ? content.split(oldStr).join(newStr) : content.replace(oldStr, newStr);
        fs.writeFileSync(filePath, newContent, 'utf-8');
        console.log(`[Resonant Tool] file_edit: written ${newContent.length} bytes to ${filePath}`);
        return JSON.stringify({ path: filePath, edited: true, ...(explanation ? { explanation } : {}) });
    }
    catch (e) {
        console.error('[Resonant Tool] file_edit FAILED:', e.message);
        return JSON.stringify({ error: e.message });
    }
}
async function execMultiEdit(filePath, edits, explanation) {
    try {
        console.log(`[Resonant Tool] multi_edit: ${filePath} (${edits.length} edits)`);
        let content = fs.readFileSync(filePath, 'utf-8');
        const original = content;
        for (let i = 0; i < edits.length; i++) {
            if (!content.includes(edits[i].old_string)) {
                return JSON.stringify({ error: `Edit ${i + 1} failed: old_string not found. No changes applied.` });
            }
            content = edits[i].replace_all
                ? content.split(edits[i].old_string).join(edits[i].new_string)
                : content.replace(edits[i].old_string, edits[i].new_string);
        }
        if (content === original)
            return JSON.stringify({ path: filePath, edited: false, message: 'No changes' });
        fs.writeFileSync(filePath, content, 'utf-8');
        console.log(`[Resonant Tool] multi_edit: written ${content.length} bytes to ${filePath}`);
        return JSON.stringify({ path: filePath, edited: true, edits_applied: edits.length, ...(explanation ? { explanation } : {}) });
    }
    catch (e) {
        return JSON.stringify({ error: e.message });
    }
}
async function execFileList(dirPath) {
    try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        const items = entries.map((entry) => ({
            name: entry.name,
            isDirectory: entry.isDirectory(),
            path: path.join(dirPath, entry.name),
        }));
        return JSON.stringify({ path: dirPath, items });
    }
    catch (e) {
        return JSON.stringify({ error: e.message });
    }
}
async function execFileDelete(filePath) {
    try {
        fs.rmSync(filePath, { recursive: true, force: true });
        return JSON.stringify({ path: filePath, deleted: true });
    }
    catch (e) {
        return JSON.stringify({ error: e.message });
    }
}
// ── Search (ripgrep/fd with fallback to grep/find) ──
let _hasRipgrep = null;
let _hasFd = null;
async function checkTool(name) {
    return new Promise(resolve => {
        cp.exec(`which ${name}`, (err) => resolve(!err));
    });
}
async function execBrowserCheck(url, expect, timeoutSeconds) {
    const timeout = Math.min(Math.max(timeoutSeconds || 15, 1), 60);
    const safeUrl = String(url || '').replace(/"/g, '%22');
    const cmd = `curl -sL -m ${timeout} -D - "${safeUrl}" -o - -w "\n__RG_STATUS__:%{http_code}\n__RG_FINAL__:%{url_effective}\n__RG_TIME__:%{time_total}\n"`;
    const raw = await execShell(cmd, '/tmp');
    const out = parseShellResult(raw);
    const statusMatch = out.match(/__RG_STATUS__:(\d+)/);
    const finalMatch = out.match(/__RG_FINAL__:(.*)/);
    const timeMatch = out.match(/__RG_TIME__:(.*)/);
    const status = statusMatch ? parseInt(statusMatch[1], 10) : 0;
    const finalUrl = finalMatch ? finalMatch[1].trim() : '';
    const latencySeconds = timeMatch ? parseFloat(timeMatch[1]) : null;
    // Remove headers (everything before first blank line)
    const parts = out.split(/\r?\n\r?\n/);
    const body = parts.length > 1 ? parts.slice(1).join('\n\n') : out;
    const snippet = body.replace(/\s+/g, ' ').trim().slice(0, 800);
    const expectStr = expect ? String(expect) : '';
    const expectFound = expectStr ? body.includes(expectStr) : null;
    const ok = status >= 200 && status < 400 && (expectFound !== false);
    return JSON.stringify({
        url,
        final_url: finalUrl || url,
        status,
        latency_seconds: latencySeconds,
        ok,
        expect: expectStr || undefined,
        expect_found: expectFound,
        snippet,
    });
}
async function execSshRun(host, user, command, port) {
    if (!host || !user || !command) {
        return JSON.stringify({ error: 'ssh_run requires host, user, and command.' });
    }
    const p = port ? Number(port) : 22;
    const safeCmd = String(command).replace(/"/g, '\\"');
    const ssh = `ssh -p ${p} -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new ${user}@${host} "${safeCmd}"`;
    return execShell(ssh, '/tmp');
}
async function execDropletDockerStatus(host, user, port) {
    if (!host || !user)
        return JSON.stringify({ error: 'droplet_docker_status requires host and user params.' });
    const h = host;
    const u = user;
    const p = port ? Number(port) : 22;
    // Use server-side counting + minimal JSON output to avoid truncation issues
    const remoteCmd = [
        `set -e`,
        // counts
        `RUNNING=$(docker ps -q | wc -l | tr -d ' ')`,
        `ALL=$(docker ps -aq | wc -l | tr -d ' ')`,
        `STOPPED=$((ALL-RUNNING))`,
        // compose projects (if available)
        `COMPOSE=$( (docker compose ls --format json 2>/dev/null || true) | head -c 200000 )`,
        // short list of containers (names + status)
        `LIST=$(docker ps -a --format '{{.Names}}\t{{.Status}}' | head -n 200)`,
        `printf '{"running":%s,"stopped":%s,"total":%s,' "$RUNNING" "$STOPPED" "$ALL"`,
        `printf '"compose":%s,' "\${COMPOSE:-[]}"`,
        `printf '"containers":"%s"}' "$(printf "%s" "$LIST" | sed 's/\\/\\\\/g; s/"/\\\"/g')"`,
    ].join(' && ');
    const safeCmd = String(remoteCmd).replace(/"/g, '\\"');
    const ssh = `ssh -p ${p} -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new ${u}@${h} "${safeCmd}"`;
    // Large output because compose JSON + container list can exceed 3k
    const raw = await execShellLarge(ssh, '/tmp', 200000, 20000);
    try {
        const parsed = JSON.parse(raw);
        const stdout = String(parsed.stdout || '').trim();
        if (!stdout)
            return raw;
        const status = JSON.parse(stdout);
        return JSON.stringify({ host: h, user: u, ...status });
    }
    catch {
        return raw;
    }
}
async function execDropletDeployFrontend(host, user, repoDir, webRoot, branch) {
    if (!host || !user || !repoDir || !webRoot)
        return JSON.stringify({ error: 'droplet_deploy_frontend requires host, user, repo_dir, and web_root params.' });
    const h = host;
    const u = user;
    const repo = repoDir;
    const root = webRoot;
    const br = branch || 'main';
    const remoteCmd = [
        `set -e`,
        `cd "${repo}"`,
        `git fetch origin`,
        `git reset --hard origin/${br}`,
        `npm ci`,
        `npm run build`,
        `sudo rsync -a --delete dist/ "${root}"`,
        `sudo nginx -s reload`,
        `echo DEPLOY_OK`,
    ].join(' && ');
    const result = await execSshRun(h, u, remoteCmd, 22);
    try {
        const parsed = JSON.parse(result);
        const stdout = String(parsed.stdout || '');
        const success = stdout.includes('DEPLOY_OK') && parsed.code === 0;
        return JSON.stringify({
            host: h,
            user: u,
            repo_dir: repo,
            web_root: root,
            branch: br,
            success,
            stdout: stdout.slice(0, 3000),
            stderr: String(parsed.stderr || '').slice(0, 1000),
            code: parsed.code,
        });
    }
    catch {
        return result;
    }
}
async function hasRipgrep() {
    if (_hasRipgrep === null)
        _hasRipgrep = await checkTool('rg');
    return _hasRipgrep;
}
async function hasFd() {
    if (_hasFd === null)
        _hasFd = await checkTool('fd');
    return _hasFd;
}
async function execGrepSearch(dirPath, pattern, include, caseSensitive, matchPerLine, fixedStrings) {
    const escaped = pattern.replace(/"/g, '\\"');
    if (await hasRipgrep()) {
        // Use ripgrep — 10-50x faster
        let cmd = `rg --no-heading --line-number`;
        if (!caseSensitive)
            cmd += ' -i';
        if (fixedStrings)
            cmd += ' --fixed-strings';
        if (include)
            cmd += ` -g "${include}"`;
        cmd += ` -g "!node_modules" -g "!.git" -g "!__pycache__"`;
        if (matchPerLine)
            cmd += ' -C 3'; // 3 lines context
        cmd += ` "${escaped}" "${dirPath}" 2>/dev/null | head -200`;
        return execShell(cmd, dirPath);
    }
    // Fallback to grep
    let cmd = include
        ? `grep -rn --include="${include}" "${escaped}" "${dirPath}"`
        : `grep -rn "${escaped}" "${dirPath}"`;
    if (!caseSensitive)
        cmd = cmd.replace('grep', 'grep -i');
    if (fixedStrings)
        cmd = cmd.replace('grep', 'grep -F');
    cmd += ' 2>/dev/null | head -100';
    return execShell(cmd, dirPath);
}
async function execFindByName(dirPath, pattern, type, maxDepth, extensions, excludes, fullPath) {
    if (await hasFd()) {
        // Use fd — much faster than find
        let cmd = `fd`;
        if (type === 'file')
            cmd += ' -t f';
        else if (type === 'directory')
            cmd += ' -t d';
        if (maxDepth)
            cmd += ` -d ${maxDepth}`;
        if (fullPath)
            cmd += ' --full-path';
        // Extensions
        if (extensions && extensions.length > 0) {
            for (const ext of extensions)
                cmd += ` -e ${ext}`;
        }
        // Excludes
        const defaultExcludes = ['node_modules', '.git', '__pycache__', ...(excludes || [])];
        for (const ex of defaultExcludes)
            cmd += ` -E "${ex}"`;
        cmd += ` "${pattern}" "${dirPath}" 2>/dev/null | head -50`;
        return execShell(cmd, dirPath);
    }
    // Fallback to find
    let cmd = `find "${dirPath}"`;
    if (maxDepth)
        cmd += ` -maxdepth ${maxDepth}`;
    if (type === 'file')
        cmd += ' -type f';
    else if (type === 'directory')
        cmd += ' -type d';
    if (fullPath) {
        cmd += ` -path "${pattern}"`;
    }
    else {
        cmd += ` -name "${pattern}"`;
    }
    cmd += ' -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/__pycache__/*"';
    if (excludes) {
        for (const ex of excludes)
            cmd += ` -not -path "*/${ex}/*"`;
    }
    cmd += ' 2>/dev/null | head -50';
    return execShell(cmd, dirPath);
}
// ── Shell ──
/** Extract just stdout text from execShell JSON wrapper */
function parseShellResult(raw) {
    try {
        const parsed = JSON.parse(raw);
        return (parsed.stdout || '').trim();
    }
    catch {
        return raw;
    }
}
function execShell(command, cwd) {
    return new Promise((resolve) => {
        cp.exec(command, { cwd, timeout: 30000, maxBuffer: 1024 * 1024 * 5 }, (error, stdout, stderr) => {
            resolve(JSON.stringify({
                stdout: (stdout || '').slice(0, 3000),
                stderr: (stderr || '').slice(0, 1000),
                code: error ? error.code || 1 : 0,
                success: !error,
            }));
        });
    });
}
function execShellLarge(command, cwd, maxStdoutChars, maxStderrChars) {
    return new Promise((resolve) => {
        cp.exec(command, { cwd, timeout: 60000, maxBuffer: 1024 * 1024 * 20 }, (error, stdout, stderr) => {
            resolve(JSON.stringify({
                stdout: (stdout || '').slice(0, maxStdoutChars),
                stderr: (stderr || '').slice(0, maxStderrChars),
                code: error ? error.code || 1 : 0,
                success: !error,
            }));
        });
    });
}
async function execRunCommand(command, cwd, blocking, waitMsBeforeAsync, safeToAutoRun) {
    if (!command || typeof command !== 'string') {
        return JSON.stringify({ error: 'run_command requires a "command" argument (string). The command to run was missing or undefined.' });
    }
    // Validate cwd exists — fall back to workspace root or home if deleted
    const fs = require('fs');
    if (!cwd || !fs.existsSync(cwd)) {
        const wsFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        const fallbackCwd = wsFolder || require('os').homedir();
        console.warn(`[DevSwat AI] run_command cwd '${cwd}' does not exist, falling back to '${fallbackCwd}'`);
        cwd = fallbackCwd;
    }
    // SafeToAutoRun: if false/undefined, commands run but the AI is expected to have confirmed with user.
    // The flag is informational — logged for auditing. Extension UI can use it for confirmation dialogs.
    if (safeToAutoRun === false) {
        // Show confirmation dialog for unsafe commands
        const choice = await vscode.window.showWarningMessage(`The AI wants to run a potentially unsafe command:\n\n${command}`, { modal: true }, 'Run', 'Cancel');
        if (choice !== 'Run') {
            return JSON.stringify({ error: 'Command cancelled by user', command, reason: 'unsafe_rejected' });
        }
    }
    // Default: blocking (backward compat)
    if (blocking === false) {
        // Async mode — start background process
        const cmdId = `bg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const proc = cp.exec(command, { cwd, maxBuffer: 1024 * 1024 * 10 });
        const entry = { process: proc, output: '', done: false, code: null };
        proc.stdout?.on('data', (d) => { entry.output += d.toString(); });
        proc.stderr?.on('data', (d) => { entry.output += d.toString(); });
        proc.on('exit', (code) => { entry.done = true; entry.code = code; });
        _bgCommands.set(cmdId, entry);
        // Wait briefly to catch quick failures
        const waitMs = Math.min(waitMsBeforeAsync || 2000, 10000);
        await new Promise(resolve => setTimeout(resolve, waitMs));
        if (entry.done && entry.code !== 0) {
            return JSON.stringify({
                command_id: cmdId,
                status: 'failed',
                output: entry.output.slice(0, 3000),
                code: entry.code,
            });
        }
        return JSON.stringify({
            command_id: cmdId,
            status: entry.done ? 'done' : 'running',
            output: entry.output.slice(0, 1000),
            message: entry.done ? 'Command completed' : 'Command running in background. Use command_status to check.',
        });
    }
    // Blocking mode (default)
    return execShell(command, cwd);
}
async function execReadTerminal(processId, name) {
    if (processId) {
        const t = _terminals.get(processId);
        if (!t)
            return JSON.stringify({ error: `No terminal with PID: ${processId}` });
        return JSON.stringify({ pid: processId, name: t.name, output: t.output.slice(-5000) });
    }
    if (name) {
        for (const [pid, t] of _terminals) {
            if (t.name.toLowerCase().includes(name.toLowerCase())) {
                return JSON.stringify({ pid, name: t.name, output: t.output.slice(-5000) });
            }
        }
        return JSON.stringify({ error: `No terminal matching name: ${name}` });
    }
    // List all terminals
    const list = Array.from(_terminals.entries()).map(([pid, t]) => ({ pid, name: t.name, output_length: t.output.length }));
    return JSON.stringify({ terminals: list });
}
// ── Interactive Terminal ──
async function execTerminalCreate(name, cwd, shell) {
    const session = interactiveTerminal.createSession(name, cwd, shell);
    // Wait a moment for shell to initialize
    await new Promise(r => setTimeout(r, 500));
    return JSON.stringify({
        session_id: session.id,
        name: session.name,
        cwd: session.cwd,
        shell: session.shell,
        alive: session.isAlive,
        message: `Terminal "${session.name}" created. Use terminal_send to send commands, terminal_read to read output.`,
    });
}
async function execTerminalSend(sessionId, input) {
    const result = interactiveTerminal.sendInput(sessionId, input);
    if (!result.success) {
        return JSON.stringify({ error: result.error });
    }
    // Wait briefly for output to appear
    await new Promise(r => setTimeout(r, 300));
    const output = interactiveTerminal.readOutput(sessionId, 3000);
    return JSON.stringify({
        success: true,
        sent: input,
        recent_output: output.output.slice(-2000),
        alive: output.alive,
    });
}
async function execTerminalSendRaw(sessionId, input) {
    const result = interactiveTerminal.sendRawInput(sessionId, input);
    if (!result.success) {
        return JSON.stringify({ error: result.error });
    }
    return JSON.stringify({ success: true, sent_bytes: input.length });
}
async function execTerminalRead(sessionId, lastNChars) {
    const result = interactiveTerminal.readOutput(sessionId, lastNChars);
    if (result.error) {
        return JSON.stringify({ error: result.error });
    }
    return JSON.stringify({
        session_id: sessionId,
        output: result.output,
        total_chars: result.total_chars,
        alive: result.alive,
    });
}
async function execTerminalWait(sessionId, timeoutMs, stableMs) {
    const timeout = Math.min(timeoutMs || 5000, 30000);
    const stable = Math.min(stableMs || 500, 5000);
    const result = await interactiveTerminal.waitForOutput(sessionId, timeout, stable);
    return JSON.stringify({
        session_id: sessionId,
        new_output: result.output,
        total_chars: result.total_chars,
        alive: result.alive,
        timed_out: result.timed_out,
    });
}
// ── Web ──
async function execSearchWeb(query, domain) {
    let searchQuery = query;
    if (domain)
        searchQuery += ` site:${domain}`;
    const escaped = searchQuery.replace(/"/g, '\\"');
    return execShell(`curl -sL "https://html.duckduckgo.com/html/?q=${encodeURIComponent(escaped)}" | grep -oP '<a rel="nofollow" class="result__a" href="[^"]*">[^<]*</a>' | head -10 | sed 's/<[^>]*>//g'`, '/tmp');
}
async function execReadUrl(url) {
    return new Promise((resolve) => {
        cp.exec(`curl -sL --max-time 15 "${url}"`, { timeout: 20000, maxBuffer: 1024 * 1024 * 10 }, (error, stdout) => {
            if (error) {
                resolve(JSON.stringify({ error: error.message }));
                return;
            }
            const text = (stdout || '')
                .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                .replace(/<[^>]+>/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            // Chunk content for large pages
            const CHUNK_SIZE = 4000;
            if (text.length > CHUNK_SIZE) {
                const docId = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
                const chunks = [];
                for (let i = 0; i < text.length; i += CHUNK_SIZE) {
                    chunks.push(text.slice(i, i + CHUNK_SIZE));
                }
                _urlContentCache.set(docId, chunks);
                resolve(JSON.stringify({
                    url,
                    document_id: docId,
                    total_chunks: chunks.length,
                    total_chars: text.length,
                    content: chunks[0],
                    message: `Content chunked into ${chunks.length} parts. Use view_content_chunk(document_id="${docId}", position=1) to read next chunk.`,
                }));
            }
            else {
                resolve(JSON.stringify({ url, content: text }));
            }
        });
    });
}
// Browser preview console log capture
const _browserLogs = new Map();
let _previewPanelCount = 0;
async function execBrowserPreview(url, name) {
    const previewName = name || `Preview ${++_previewPanelCount}`;
    const previewId = `preview_${Date.now()}`;
    _browserLogs.set(previewId, []);
    // Create a WebviewPanel that wraps the URL in an iframe with console capture
    const panel = vscode.window.createWebviewPanel('resonantBrowserPreview', previewName, vscode.ViewColumn.Beside, { enableScripts: true, retainContextWhenHidden: true });
    panel.webview.html = `<!DOCTYPE html>
<html><head><style>
  body, html { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; }
  iframe { width: 100%; height: 100%; border: none; }
  #log-bar { position: fixed; bottom: 0; left: 0; right: 0; background: #1e1e1e; color: #ccc;
    font-family: monospace; font-size: 11px; max-height: 120px; overflow-y: auto; padding: 4px 8px;
    border-top: 1px solid #444; z-index: 9999; display: none; }
  #log-bar.visible { display: block; }
  .log-entry { padding: 1px 0; } .log-error { color: #f44; } .log-warn { color: #fa0; }
  #toggle-btn { position: fixed; bottom: 4px; right: 8px; z-index: 10000; background: #333;
    color: #ccc; border: 1px solid #555; border-radius: 3px; padding: 2px 8px; cursor: pointer; font-size: 10px; }
</style></head><body>
  <iframe id="frame" src="${url}" sandbox="allow-scripts allow-same-origin allow-forms allow-popups"></iframe>
  <button id="toggle-btn" onclick="document.getElementById('log-bar').classList.toggle('visible')">Console</button>
  <div id="log-bar"></div>
  <script>
    const vscode = acquireVsCodeApi();
    const logBar = document.getElementById('log-bar');
    window.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'console') {
        const entry = document.createElement('div');
        entry.className = 'log-entry' + (e.data.level === 'error' ? ' log-error' : e.data.level === 'warn' ? ' log-warn' : '');
        entry.textContent = '[' + e.data.level + '] ' + e.data.message;
        logBar.appendChild(entry);
        logBar.scrollTop = logBar.scrollHeight;
        vscode.postMessage({ type: 'console', level: e.data.level, message: e.data.message });
      }
    });
    // Attempt to inject console capture into iframe (same-origin only)
    const frame = document.getElementById('frame');
    frame.addEventListener('load', () => {
      try {
        const w = frame.contentWindow;
        ['log','warn','error','info'].forEach(level => {
          const orig = w.console[level];
          w.console[level] = function() {
            const msg = Array.from(arguments).map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
            window.postMessage({ type: 'console', level, message: msg }, '*');
            orig.apply(w.console, arguments);
          };
        });
        // Capture unhandled errors
        w.addEventListener('error', (e) => {
          window.postMessage({ type: 'console', level: 'error', message: e.message + ' at ' + e.filename + ':' + e.lineno }, '*');
        });
        w.addEventListener('unhandledrejection', (e) => {
          window.postMessage({ type: 'console', level: 'error', message: 'Unhandled rejection: ' + e.reason }, '*');
        });
      } catch(e) {
        // Cross-origin — can't inject, but log bar still works for same-origin
        logBar.innerHTML = '<div class="log-entry log-warn">[system] Cross-origin: console capture limited</div>';
        logBar.classList.add('visible');
      }
    });
  </script>
</body></html>`;
    // Listen for console messages from the webview
    panel.webview.onDidReceiveMessage((msg) => {
        if (msg.type === 'console') {
            const logs = _browserLogs.get(previewId) || [];
            logs.push(`[${msg.level}] ${msg.message}`);
            if (logs.length > 200)
                logs.splice(0, logs.length - 200);
            _browserLogs.set(previewId, logs);
        }
    });
    panel.onDidDispose(() => {
        // Keep logs for 5 minutes after panel close
        setTimeout(() => _browserLogs.delete(previewId), 300000);
    });
    return JSON.stringify({
        opened: true,
        url,
        name: previewName,
        preview_id: previewId,
        console_capture: true,
        message: `Browser preview opened with console capture. Use read_browser_logs(preview_id="${previewId}") to read captured console output.`,
    });
}
async function execReadBrowserLogs(previewId) {
    const logs = _browserLogs.get(previewId);
    if (!logs) {
        // List available previews
        const available = Array.from(_browserLogs.keys());
        return JSON.stringify({ error: `No preview with ID: ${previewId}`, available_previews: available });
    }
    return JSON.stringify({ preview_id: previewId, log_count: logs.length, logs: logs.slice(-50) });
}
// ── Meta / Planning ──
async function execAskUser(question, options, allowMultiple) {
    // Normalize options to AskUserOption format
    const normalizedOptions = options?.map(o => typeof o === 'string' ? { label: o } : o);
    if (askUserCallback && normalizedOptions) {
        const response = await askUserCallback(question, normalizedOptions);
        return JSON.stringify({ question, response });
    }
    // Fallback: use VS Code quick pick with rich options
    if (normalizedOptions && normalizedOptions.length > 0) {
        const items = normalizedOptions.map(o => ({
            label: o.label,
            description: o.description || '',
        }));
        if (allowMultiple) {
            const picked = await vscode.window.showQuickPick(items, {
                placeHolder: question,
                canPickMany: true,
            });
            const selected = picked?.map(p => p.label) || [];
            return JSON.stringify({ question, response: selected });
        }
        const picked = await vscode.window.showQuickPick(items, { placeHolder: question });
        return JSON.stringify({ question, response: picked?.label || '[No selection]' });
    }
    const answer = await vscode.window.showInputBox({ prompt: question });
    return JSON.stringify({ question, response: answer || '[No answer]' });
}
let globalState = null;
function setGlobalState(state) { globalState = state; }
async function execTodoList(todos) {
    if (globalState)
        globalState.update('resonant_todos', todos);
    return JSON.stringify({ saved: true, count: todos.length, todos });
}
async function execSaveMemory(key, content, tags, action, id) {
    // Try server-backed Hash Sphere first
    if (_authToken && _authDomain) {
        try {
            const result = await serverMemoryEmbed(content, tags || [], key);
            // Also save locally as cache
            if (globalState) {
                const store = globalState.get('resonant_memory', {});
                store[key] = { content, tags: tags || [], updated: new Date().toISOString(), server_synced: true };
                await globalState.update('resonant_memory', store);
            }
            return result;
        }
        catch {
            // Fallback to local
        }
    }
    if (!globalState)
        return JSON.stringify({ error: 'State not available' });
    const store = globalState.get('resonant_memory', {});
    store[key] = { content, tags: tags || [], updated: new Date().toISOString() };
    await globalState.update('resonant_memory', store);
    return JSON.stringify({ saved: true, key, storage: 'local' });
}
async function execReadMemory(key, tag, query) {
    // Try server-backed retrieval first for query-based search
    if (query && _authToken && _authDomain) {
        try {
            return await serverMemoryRetrieve(query);
        }
        catch { /* fallback */ }
    }
    if (!globalState)
        return JSON.stringify({ error: 'State not available' });
    const store = globalState.get('resonant_memory', {});
    if (key) {
        const entry = store[key];
        if (entry)
            return JSON.stringify({ key, ...entry });
        return JSON.stringify({ error: `Memory not found: ${key}` });
    }
    if (tag) {
        const matches = Object.entries(store)
            .filter(([, v]) => v.tags?.includes(tag))
            .map(([k, v]) => ({ key: k, ...v }));
        return JSON.stringify({ tag, memories: matches });
    }
    // Query-based search in local store
    if (query) {
        const q = query.toLowerCase();
        const matches = Object.entries(store)
            .filter(([k, v]) => {
            const c = ((v.content || '') + ' ' + (v.tags || []).join(' ') + ' ' + k).toLowerCase();
            return q.split(/\s+/).some((t) => c.includes(t));
        })
            .slice(0, 20)
            .map(([k, v]) => ({ key: k, ...v }));
        return JSON.stringify({ query, memories: matches, count: matches.length });
    }
    const all = Object.entries(store).map(([k, v]) => ({ key: k, ...v }));
    return JSON.stringify({ memories: all, count: all.length });
}
async function execCreateMemory(action, title, content, tags, id) {
    if (!globalState)
        return JSON.stringify({ error: 'State not available' });
    const store = globalState.get('resonant_memory', {});
    if (action === 'create') {
        const memId = id || `mem_${Date.now()}`;
        store[memId] = { title: title || '', content: content || '', tags: tags || [], updated: new Date().toISOString() };
        await globalState.update('resonant_memory', store);
        // Also try server
        if (_authToken && _authDomain && content) {
            try {
                await serverMemoryEmbed(content, tags || [], memId);
            }
            catch { /* ok */ }
        }
        return JSON.stringify({ action: 'create', id: memId, saved: true });
    }
    else if (action === 'update' && id) {
        const existing = store[id];
        if (!existing)
            return JSON.stringify({ error: `Memory ${id} not found` });
        if (title)
            existing.title = title;
        if (content)
            existing.content = content;
        if (tags)
            existing.tags = tags;
        existing.updated = new Date().toISOString();
        await globalState.update('resonant_memory', store);
        return JSON.stringify({ action: 'update', id, saved: true });
    }
    else if (action === 'delete' && id) {
        delete store[id];
        await globalState.update('resonant_memory', store);
        return JSON.stringify({ action: 'delete', id, deleted: true });
    }
    return JSON.stringify({ error: `Invalid action: ${action}. Use create, update, or delete.` });
}
// ── Server-backed Memory (Hash Sphere) ──
function serverRequest(method, path, body) {
    return new Promise((resolve, reject) => {
        const url = new URL(`${_authDomain}${path}`);
        const headers = { 'Content-Type': 'application/json' };
        if (_authToken) {
            if (_authToken.startsWith('RG-'))
                headers['x-api-key'] = _authToken;
            else
                headers['Authorization'] = `Bearer ${_authToken}`;
        }
        const mod = url.protocol === 'https:' ? https : http;
        const req = mod.request({
            hostname: url.hostname,
            port: url.port || (url.protocol === 'https:' ? 443 : 80),
            path: url.pathname + url.search,
            method,
            headers,
        }, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk.toString(); });
            res.on('end', () => {
                if (res.statusCode && res.statusCode >= 400)
                    reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
                else
                    resolve(data);
            });
        });
        req.on('error', reject);
        if (body)
            req.write(JSON.stringify(body));
        req.end();
    });
}
async function serverMemoryEmbed(content, tags, key) {
    const result = await serverRequest('POST', '/api/v1/user-memory/memories/embed', {
        content,
        tags,
        metadata: { source: 'resonant-ide', key },
    });
    const parsed = JSON.parse(result);
    return JSON.stringify({ saved: true, storage: 'server', memory_id: parsed.id || parsed.memory_id, key });
}
async function serverMemoryRetrieve(query) {
    const result = await serverRequest('POST', '/api/v1/user-memory/memories/retrieve', {
        query,
        limit: 10,
    });
    const parsed = JSON.parse(result);
    return JSON.stringify({ query, storage: 'server', memories: parsed.memories || parsed.results || parsed, count: (parsed.memories || parsed.results || []).length });
}
// ── Notebooks ──
async function execReadNotebook(filePath) {
    try {
        const uri = vscode.Uri.file(filePath);
        const data = await vscode.workspace.fs.readFile(uri);
        const nb = JSON.parse(Buffer.from(data).toString('utf-8'));
        const cells = (nb.cells || []).map((cell, i) => ({
            index: i,
            type: cell.cell_type,
            source: Array.isArray(cell.source) ? cell.source.join('') : cell.source,
            outputs: (cell.outputs || []).map((o) => {
                if (o.text)
                    return Array.isArray(o.text) ? o.text.join('') : o.text;
                if (o.data?.['text/plain'])
                    return Array.isArray(o.data['text/plain']) ? o.data['text/plain'].join('') : o.data['text/plain'];
                return '[output]';
            }),
        }));
        return JSON.stringify({ path: filePath, kernel: nb.metadata?.kernelspec?.display_name, cells });
    }
    catch (e) {
        return JSON.stringify({ error: e.message });
    }
}
// ── File Move ──
async function execFileMove(source, destination) {
    try {
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.renameSync(source, destination);
        return JSON.stringify({ source, destination, moved: true });
    }
    catch (e) {
        return JSON.stringify({ error: e.message });
    }
}
// ── Code Search (semantic-like via grep with context) ──
async function execCodeSearch(query, dirPath) {
    // Multi-pass search: extract terms, search with ripgrep/grep, return files + context
    const terms = query.replace(/[^a-zA-Z0-9_. ]/g, '').split(/\s+/).filter(t => t.length > 2);
    if (terms.length === 0)
        return JSON.stringify({ error: 'No searchable terms in query' });
    const codeExts = '*.ts,*.tsx,*.js,*.jsx,*.py,*.go,*.rs,*.java,*.rb,*.php,*.c,*.cpp,*.h,*.css,*.html,*.vue,*.svelte';
    if (await hasRipgrep()) {
        // Pass 1: Find files matching all key terms (most specific)
        const primary = terms.slice(0, 2).join('|');
        const pass1 = await execShell(`rg --no-heading -l -g "{${codeExts}}" -g "!node_modules" -g "!.git" -g "!dist" -g "!build" "${primary}" "${dirPath}" 2>/dev/null | head -20`, dirPath);
        // Pass 2: Get context matches from top files
        const files = parseShellResult(pass1).split('\n').filter(Boolean).slice(0, 10);
        if (files.length === 0) {
            // Broaden: try individual terms
            const broader = terms.slice(0, 1)[0];
            return execShell(`rg --no-heading -n -C 1 -g "{${codeExts}}" -g "!node_modules" -g "!.git" "${broader}" "${dirPath}" 2>/dev/null | head -60`, dirPath);
        }
        // Show matches with context for top files
        const fileArgs = files.map(f => `"${f}"`).join(' ');
        const contextSearch = await execShell(`rg --no-heading -n -C 2 "${primary}" ${fileArgs} 2>/dev/null | head -100`, dirPath);
        return JSON.stringify({ query, files_found: files.length, matches: parseShellResult(contextSearch) });
    }
    // Fallback to grep
    const pattern = terms.slice(0, 3).join('\\|');
    return execShell(`grep -rn --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" --include="*.py" --include="*.go" --include="*.rs" --include="*.java" -l "${pattern}" "${dirPath}" -not -path "*/node_modules/*" -not -path "*/.git/*" 2>/dev/null | head -30`, dirPath);
}
// ── Background Command Tracking ──
const _bgCommands = new Map();
async function execCommandStatus(commandId, waitSeconds, outputCharacterCount) {
    const cmd = _bgCommands.get(commandId);
    if (!cmd)
        return JSON.stringify({ error: `No background command with ID: ${commandId}` });
    if (waitSeconds && waitSeconds > 0 && !cmd.done) {
        await new Promise(resolve => {
            const timeout = setTimeout(resolve, Math.min(waitSeconds, 60) * 1000);
            if (cmd.process.exitCode !== null) {
                clearTimeout(timeout);
                resolve();
            }
            else {
                cmd.process.on('exit', () => { clearTimeout(timeout); resolve(); });
            }
        });
    }
    const charCount = Math.min(outputCharacterCount || 5000, 50000);
    return JSON.stringify({
        id: commandId,
        status: cmd.done ? 'done' : 'running',
        output: cmd.output.slice(-charCount),
        exitCode: cmd.code,
    });
}
// ── URL Content Cache ──
const _urlContentCache = new Map();
async function execViewContentChunk(documentId, position) {
    const chunks = _urlContentCache.get(documentId);
    if (!chunks)
        return JSON.stringify({ error: `No cached content for document: ${documentId}` });
    if (position < 0 || position >= chunks.length)
        return JSON.stringify({ error: `Position ${position} out of range (0-${chunks.length - 1})` });
    return JSON.stringify({ document_id: documentId, position, total_chunks: chunks.length, content: chunks[position] });
}
// ── Trajectory Search (conversation memory — enhanced with server retrieval + conversation summaries) ──
// Store conversation summaries for cross-session continuity
const _conversationSummaries = new Map();
function storeConversationSummary(conversationId, summary, messageCount) {
    _conversationSummaries.set(conversationId, {
        summary,
        timestamp: new Date().toISOString(),
        messages: messageCount,
    });
    // Persist to globalState
    if (globalState) {
        const summaries = globalState.get('resonant_conversation_summaries', {});
        summaries[conversationId] = _conversationSummaries.get(conversationId);
        // Keep last 50 summaries
        const keys = Object.keys(summaries);
        if (keys.length > 50) {
            for (const k of keys.slice(0, keys.length - 50))
                delete summaries[k];
        }
        globalState.update('resonant_conversation_summaries', summaries);
    }
}
async function execTrajectorySearch(query, conversationId) {
    // Try server-backed semantic retrieval first
    if (_authToken && _authDomain && query) {
        try {
            const serverResult = await serverMemoryRetrieve(query);
            const parsed = JSON.parse(serverResult);
            if ((parsed.memories || parsed.results || []).length > 0) {
                return serverResult;
            }
        }
        catch { /* fallback to local */ }
    }
    // Search conversation summaries
    const summaryResults = [];
    const allSummaries = globalState?.get('resonant_conversation_summaries', {}) || {};
    const q = query.toLowerCase();
    for (const [id, s] of Object.entries(allSummaries)) {
        if (conversationId && id !== conversationId)
            continue;
        const text = (s.summary || '').toLowerCase();
        const score = q.split(/\s+/).filter((t) => text.includes(t)).length;
        if (score > 0) {
            summaryResults.push({ conversation_id: id, summary: (s.summary || '').slice(0, 300), timestamp: s.timestamp, score });
        }
    }
    summaryResults.sort((a, b) => b.score - a.score);
    // Also search memory store
    if (!globalState)
        return JSON.stringify({ error: 'State not available' });
    const store = globalState.get('resonant_memory', {});
    const memoryResults = Object.entries(store)
        .filter(([k, v]) => {
        const content = ((v.content || '') + ' ' + (v.title || '') + ' ' + (v.tags || []).join(' ')).toLowerCase();
        return q.split(/\s+/).some((term) => content.includes(term));
    })
        .slice(0, 10)
        .map(([k, v]) => ({ key: k, content: (v.content || '').slice(0, 200), tags: v.tags, title: v.title }));
    return JSON.stringify({
        query,
        conversation_id: conversationId,
        conversations: summaryResults.slice(0, 5),
        memories: memoryResults,
        total: summaryResults.length + memoryResults.length,
    });
}
const PLATFORM_API_CATALOG = {
    agents: { base: '/api/v1/agents', description: 'Manage autonomous AI agents — create, configure, chat with, and monitor agents', endpoints: [
            { method: 'GET', path: '/', description: 'List all agents owned by the user' },
            { method: 'POST', path: '/', description: 'Create a new autonomous agent with name, system prompt, and capabilities' },
            { method: 'GET', path: '/{id}', description: 'Get agent details by ID' },
            { method: 'PUT', path: '/{id}', description: 'Update agent configuration' },
            { method: 'DELETE', path: '/{id}', description: 'Delete an agent' },
            { method: 'POST', path: '/{id}/chat', description: 'Send a message to an agent and get a response' },
        ] },
    sessions: { base: '/api/v1/sessions', description: 'Conversation sessions — persistent chat threads with agents', endpoints: [
            { method: 'GET', path: '/', description: 'List user sessions' },
            { method: 'POST', path: '/', description: 'Create a new session' },
            { method: 'GET', path: '/{id}', description: 'Get session details' },
            { method: 'DELETE', path: '/{id}', description: 'Delete session' },
            { method: 'GET', path: '/{id}/messages', description: 'Get all messages in a session' },
        ] },
    teams: { base: '/api/v1/teams', description: 'Team management — create orgs, invite members, manage roles', endpoints: [
            { method: 'GET', path: '/', description: 'List teams' },
            { method: 'POST', path: '/', description: 'Create team' },
            { method: 'GET', path: '/{id}', description: 'Get team details' },
            { method: 'PUT', path: '/{id}', description: 'Update team' },
            { method: 'DELETE', path: '/{id}', description: 'Delete team' },
            { method: 'POST', path: '/{id}/members', description: 'Add member to team' },
        ] },
    workflows: { base: '/api/v1/workflows', description: 'Automation workflows — multi-step agent pipelines', endpoints: [
            { method: 'GET', path: '/', description: 'List workflows' },
            { method: 'POST', path: '/', description: 'Create workflow' },
            { method: 'GET', path: '/{id}', description: 'Get workflow' },
            { method: 'PUT', path: '/{id}', description: 'Update workflow' },
            { method: 'DELETE', path: '/{id}', description: 'Delete workflow' },
            { method: 'POST', path: '/{id}/execute', description: 'Execute workflow' },
        ] },
    chat: { base: '/api/v1/resonant-chat', description: 'Resonant Chat — AI conversations with skill execution', endpoints: [
            { method: 'GET', path: '/conversations', description: 'List conversations' },
            { method: 'POST', path: '/conversations', description: 'Create conversation' },
            { method: 'GET', path: '/conversations/{id}', description: 'Get conversation' },
            { method: 'DELETE', path: '/conversations/{id}', description: 'Delete conversation' },
            { method: 'GET', path: '/conversations/{id}/messages', description: 'Get messages' },
        ] },
    billing: { base: '/api/v1/billing', description: 'Subscription billing — plans, invoices, usage tracking', endpoints: [
            { method: 'GET', path: '/plans', description: 'List available subscription plans' },
            { method: 'GET', path: '/subscription', description: 'Get current subscription' },
            { method: 'POST', path: '/subscribe', description: 'Subscribe to plan' },
            { method: 'POST', path: '/cancel', description: 'Cancel subscription' },
            { method: 'GET', path: '/invoices', description: 'List invoices' },
            { method: 'GET', path: '/usage', description: 'Get usage stats' },
        ] },
    memory: { base: '/api/v1/user-memory', description: 'Hash Sphere memory — embed, retrieve, and manage persistent memories', endpoints: [
            { method: 'GET', path: '/memories', description: 'List all memories' },
            { method: 'POST', path: '/memories/embed', description: 'Embed new memory with vector embedding' },
            { method: 'POST', path: '/memories/retrieve', description: 'Semantic search across memories' },
            { method: 'DELETE', path: '/memories/{id}', description: 'Delete a memory' },
        ] },
    blockchain: { base: '/api/v1/blockchain', description: 'On-chain anchoring — anchor hashes to Base Sepolia for tamper-proof verification', endpoints: [
            { method: 'POST', path: '/anchor', description: 'Anchor a hash on-chain (MemoryAnchors contract)' },
            { method: 'GET', path: '/verify/{hash}', description: 'Verify if a hash has been anchored' },
            { method: 'GET', path: '/status', description: 'Blockchain service status' },
        ] },
    notifications: { base: '/api/v1/notifications', description: 'User notifications', endpoints: [
            { method: 'GET', path: '/', description: 'List notifications' },
            { method: 'PUT', path: '/{id}/read', description: 'Mark as read' },
            { method: 'POST', path: '/preferences', description: 'Update notification preferences' },
        ] },
    marketplace: { base: '/api/v1/marketplace', description: 'Agent marketplace — buy/sell agent templates', endpoints: [
            { method: 'GET', path: '/listings', description: 'Browse marketplace' },
            { method: 'POST', path: '/listings', description: 'Create listing' },
            { method: 'GET', path: '/listings/{id}', description: 'Get listing' },
            { method: 'POST', path: '/purchase', description: 'Purchase listing' },
        ] },
    autonomy: { base: '/api/v1/autonomy', description: 'Autonomous task execution — schedule and run agent tasks', endpoints: [
            { method: 'GET', path: '/tasks', description: 'List tasks' },
            { method: 'POST', path: '/tasks', description: 'Create task' },
            { method: 'GET', path: '/tasks/{id}', description: 'Get task' },
            { method: 'POST', path: '/tasks/{id}/execute', description: 'Execute task' },
        ] },
    rabbit: { base: '/api/v1/rabbit', description: 'Rabbit social — communities and posts for agents and users', endpoints: [
            { method: 'GET', path: '/communities', description: 'List communities' },
            { method: 'POST', path: '/communities', description: 'Create community' },
            { method: 'GET', path: '/posts', description: 'List posts' },
            { method: 'POST', path: '/posts', description: 'Create post' },
            { method: 'GET', path: '/posts/{id}', description: 'Get post' },
            { method: 'PUT', path: '/votes', description: 'Vote on post' },
        ] },
    storage: { base: '/api/v1/storage', description: 'File storage — upload and manage files', endpoints: [
            { method: 'POST', path: '/upload', description: 'Upload file' },
            { method: 'GET', path: '/files', description: 'List files' },
            { method: 'GET', path: '/files/{id}', description: 'Get file' },
            { method: 'DELETE', path: '/files/{id}', description: 'Delete file' },
        ] },
    ide: { base: '/api/v1/ide', description: 'IDE services — code completions, LOC tracking, update checks', endpoints: [
            { method: 'POST', path: '/completions', description: 'LLM completions for IDE' },
            { method: 'POST', path: '/loc/track', description: 'Track lines of code written' },
            { method: 'GET', path: '/loc/stats/me', description: 'Get personal LOC stats' },
            { method: 'GET', path: '/updates/check', description: 'Check for IDE updates' },
        ] },
    auth: { base: '/api/v1/auth', description: 'Authentication — login, register, token management', endpoints: [
            { method: 'POST', path: '/login', description: 'Login' },
            { method: 'POST', path: '/register', description: 'Register' },
            { method: 'POST', path: '/logout', description: 'Logout' },
            { method: 'GET', path: '/me', description: 'Get current user' },
            { method: 'POST', path: '/refresh', description: 'Refresh token' },
        ] },
    user: { base: '/user', description: 'User profile and API key management', endpoints: [
            { method: 'GET', path: '/api-keys', description: 'List user BYOK API keys (encrypted, DB-backed)' },
            { method: 'POST', path: '/api-keys', description: 'Add BYOK API key (provider, api_key, name)' },
            { method: 'DELETE', path: '/api-keys/by-provider/{provider}', description: 'Delete BYOK key by provider name' },
            { method: 'DELETE', path: '/api-keys/{key_id}', description: 'Delete BYOK key by UUID' },
            { method: 'POST', path: '/api-keys/validate', description: 'Validate an API key against provider' },
        ] },
    hash_sphere_sim: {
        base: '/api/v1/state-physics',
        description: 'Hash Sphere Invariants SIM — a constraint-governed simulation engine for modeling trust networks, identity graphs, and economic systems. NOT literal physics. Models 3 coupled layers: (1) Identity Layer — users, agents, services, contracts with DSIDs (Decentralized Secure IDs); (2) State/Memory Layer — what happened, proofs, anchors; (3) Economic/Temporal Layer — value transfers, trust scores, accumulated costs. Enforces 6 conservation laws (invariants): mass conservation, energy conservation, identity uniqueness, causality, trust bounds [0-1], non-negative value. Useful for: fraud detection, trust propagation analysis, anomaly detection, autonomous agent simulation, economic modeling, compliance auditing.',
        endpoints: [
            { method: 'GET', path: '/state', description: 'Get current universe state — all nodes (users/agents/services) with trust scores, values, positions, and edges (transactions/trust relationships)' },
            { method: 'POST', path: '/simulate', description: 'Run N simulation steps — applies entropy (trust decay, value fluctuation), checks invariants, and evolves the universe. Body: {"steps": 100}' },
            { method: 'POST', path: '/reset', description: 'Reset the universe to initial state (re-loads from real platform user data if authenticated)' },
            { method: 'GET', path: '/api/invariants', description: 'Check all 6 conservation laws and return any violations (trust out of bounds, negative values, duplicate identities, causality violations, etc.)' },
            { method: 'GET', path: '/api/metrics', description: 'Get universe metrics — node count, edge count, total value, average trust, etc.' },
            { method: 'GET', path: '/api/entropy', description: 'Get entropy metrics — trust decay rate, value fluctuation, activity probability, system disorder level' },
            { method: 'POST', path: '/api/demo', description: 'Seed a demo universe with sample users and transactions. Query params: num_users=30, num_transactions=80' },
            { method: 'POST', path: '/identity', description: 'Add an identity (user/agent/service/contract) to the universe with initial trust score and value' },
            { method: 'POST', path: '/api/transaction', description: 'Add a value transfer between two identities (tests conservation laws)' },
            { method: 'POST', path: '/api/agents/spawn', description: 'Spawn autonomous agents inside the universe that make decisions, transfer value, and test invariants' },
            { method: 'GET', path: '/api/agents', description: 'List all active autonomous agents in the universe with their budgets and action history' },
            { method: 'POST', path: '/api/physics/config', description: 'Configure simulation forces — gravity (attraction between connected nodes), repulsion, spring constant, damping' },
            { method: 'POST', path: '/api/entropy/config', description: 'Configure entropy injection — trust decay rate, value fluctuation noise, random activity probability' },
            { method: 'POST', path: '/api/galaxy', description: 'Generate a full galaxy (large-scale universe) with many users, services, transactions, agents. Body: {"num_users":500, "num_transactions":1500, "num_services":10, "enable_agent":true}' },
            { method: 'GET', path: '/api/asymmetry', description: 'Compute asymmetry score — measures inequality (Gini coefficient on value) and trust variance. Returns: score 0-1, interpretation (system_frozen / unstable / emergence_possible)' },
            { method: 'POST', path: '/api/entropy/perturbation', description: 'Inject a sudden perturbation event (shock) into the universe to test resilience' },
            { method: 'POST', path: '/api/entropy/toggle', description: 'Enable/disable entropy injection (trust decay, random fluctuations)' },
            { method: 'GET', path: '/ui', description: 'Get the interactive HTML visualization UI for the Hash Sphere universe' },
        ]
    },
};
async function execPlatformApiSearch(query, category) {
    const q = query.toLowerCase();
    const results = [];
    for (const [cat, info] of Object.entries(PLATFORM_API_CATALOG)) {
        if (category && cat !== category)
            continue;
        // Build searchable text from all descriptions
        const endpointText = info.endpoints.map(e => `${e.method} ${e.path} ${e.description}`).join(' ');
        const catText = (cat + ' ' + info.description + ' ' + info.base + ' ' + endpointText).toLowerCase();
        const tokens = q.split(/\s+/).filter(t => t.length > 1);
        const score = tokens.filter(t => catText.includes(t)).length;
        if (score > 0 || !query) {
            // Filter to matching endpoints within the category
            const matchingEndpoints = info.endpoints.filter(e => {
                const eText = (`${e.method} ${e.path} ${e.description}`).toLowerCase();
                return tokens.some(t => eText.includes(t));
            });
            results.push({
                category: cat,
                description: info.description,
                base: info.base,
                endpoints: matchingEndpoints.length > 0 ? matchingEndpoints : info.endpoints.slice(0, 5),
                relevance: score,
            });
        }
    }
    results.sort((a, b) => b.relevance - a.relevance);
    return JSON.stringify({ query, results: results.slice(0, 10), total_categories: Object.keys(PLATFORM_API_CATALOG).length });
}
async function execPlatformApiCall(method, apiPath, body) {
    if (!_authToken || !_authDomain) {
        return JSON.stringify({ error: 'Not authenticated. Sign in first to use platform API.' });
    }
    // Safety: block admin/internal paths for non-superusers
    if (/\/(admin|rara|daemon|internal)\//i.test(apiPath)) {
        return JSON.stringify({ error: 'Access denied: admin/internal paths are restricted.' });
    }
    try {
        const result = await serverRequest(method.toUpperCase(), apiPath, body);
        try {
            const parsed = JSON.parse(result);
            return JSON.stringify({ status: 'ok', method, path: apiPath, response: parsed });
        }
        catch {
            return JSON.stringify({ status: 'ok', method, path: apiPath, response: result.slice(0, 5000) });
        }
    }
    catch (e) {
        return JSON.stringify({ error: e.message, method, path: apiPath });
    }
}
// ── Auto-inject Memories (exported for extension.ts to call at conversation start) ──
async function retrieveRelevantMemories(userQuery) {
    const memories = [];
    // 1. Try server-backed semantic retrieval
    if (_authToken && _authDomain) {
        try {
            const result = await serverMemoryRetrieve(userQuery);
            const parsed = JSON.parse(result);
            const items = parsed.memories || parsed.results || [];
            for (const m of items.slice(0, 5)) {
                const content = m.content || m.text || '';
                if (content)
                    memories.push(content.slice(0, 500));
            }
        }
        catch { /* fallback */ }
    }
    // 2. Also check local memory for keyword matches
    if (globalState) {
        const store = globalState.get('resonant_memory', {});
        const q = userQuery.toLowerCase();
        const localMatches = Object.entries(store)
            .filter(([k, v]) => {
            const text = ((v.content || '') + ' ' + (v.title || '') + ' ' + (v.tags || []).join(' ')).toLowerCase();
            return q.split(/\s+/).filter(t => t.length > 2).some(t => text.includes(t));
        })
            .slice(0, 5);
        for (const [k, v] of localMatches) {
            const text = `[${k}] ${(v.content || '').slice(0, 300)}`;
            if (!memories.some(m => m.includes(k)))
                memories.push(text);
        }
    }
    if (memories.length === 0)
        return '';
    return `\n\n<SYSTEM-RETRIEVED-MEMORIES>\nThe following memories were automatically retrieved and may be relevant:\n${memories.map((m, i) => `${i + 1}. ${m}`).join('\n')}\n</SYSTEM-RETRIEVED-MEMORIES>`;
}
// ── Git Operations ──
async function execGitCommit(cwd, message, files) {
    const escaped = message.replace(/"/g, '\\"');
    if (files && files.length > 0) {
        const fileList = files.map(f => `"${f}"`).join(' ');
        return execShell(`git add ${fileList} && git commit -m "${escaped}"`, cwd);
    }
    return execShell(`git add -A && git commit -m "${escaped}"`, cwd);
}
async function execGitBranch(cwd, action, name) {
    switch (action) {
        case 'create': return name ? execShell(`git checkout -b "${name}"`, cwd) : JSON.stringify({ error: 'Branch name required' });
        case 'switch': return name ? execShell(`git checkout "${name}"`, cwd) : JSON.stringify({ error: 'Branch name required' });
        case 'delete': return name ? execShell(`git branch -d "${name}"`, cwd) : JSON.stringify({ error: 'Branch name required' });
        case 'list':
        default:
            return execShell('git branch -a', cwd);
    }
}
// ── Code Visualizer — Real local Python analyzer (AST parsing) ──
// Resolve cv_cli.py path relative to this extension
function _cvCliPath() {
    // In compiled extension: out/ is sibling to code_visualizer/
    const extDir = path.resolve(__dirname, '..');
    return path.join(extDir, 'code_visualizer', 'cv_cli.py');
}
async function cvExec(command, targetPath, extraArgs = []) {
    if (/^https?:\/\//i.test(targetPath) || /^git@/i.test(targetPath)) {
        return JSON.stringify({
            error: 'Code Visualizer local mode only supports local filesystem paths. Clone the repository locally and pass its absolute path.',
            path: targetPath,
        });
    }
    const cliPath = _cvCliPath();
    const args = [cliPath, command, targetPath, ...extraArgs];
    return new Promise((resolve) => {
        cp.execFile('python3', args, {
            timeout: 600000,
            maxBuffer: 1024 * 1024 * 1024 * 5,
        }, (error, stdout, stderr) => {
            if (error) {
                resolve(JSON.stringify({ error: `Code Visualizer failed: ${error.message}`, stderr: (stderr || '').slice(0, 500) }));
                return;
            }
            // stdout is JSON from cv_cli.py
            try {
                JSON.parse(stdout); // validate it's JSON
                resolve(stdout.trim());
            }
            catch {
                resolve(JSON.stringify({ error: 'Invalid JSON from analyzer', raw: stdout.slice(0, 2000) }));
            }
        });
    });
}
// ── Deployment ──
const _deployments = new Map();
async function execDeployWebApp(projectPath, framework, subdomain, provider) {
    // Detect framework if not specified
    let detectedFramework = framework;
    if (!detectedFramework) {
        try {
            const pkgUri = vscode.Uri.file(path.join(projectPath, 'package.json'));
            const data = await vscode.workspace.fs.readFile(pkgUri);
            const pkg = JSON.parse(Buffer.from(data).toString('utf-8'));
            const deps = { ...pkg.dependencies, ...pkg.devDependencies };
            if (deps.next)
                detectedFramework = 'nextjs';
            else if (deps.react)
                detectedFramework = 'react';
            else if (deps.svelte)
                detectedFramework = 'svelte';
            else if (deps.vue)
                detectedFramework = 'vue';
            else if (deps.astro)
                detectedFramework = 'astro';
            else
                detectedFramework = 'static';
        }
        catch {
            detectedFramework = 'static';
        }
    }
    // Build the project
    const buildCmd = detectedFramework === 'static' ? 'echo "No build needed"' : 'npm run build';
    const buildResult = await execShell(buildCmd, projectPath);
    const parsed = JSON.parse(buildResult);
    if (!parsed.success) {
        return JSON.stringify({ error: `Build failed: ${parsed.stderr || parsed.stdout}`, framework: detectedFramework });
    }
    // Detect output directory
    let distDir = 'dist';
    if (detectedFramework === 'nextjs')
        distDir = '.next';
    else if (detectedFramework === 'react')
        distDir = 'build';
    // If server API available, deploy via platform
    if (_authToken && _authDomain) {
        try {
            const deployResult = await serverRequest('POST', '/api/v1/ide/deploy', {
                project_path: projectPath,
                framework: detectedFramework,
                subdomain: subdomain,
                dist_dir: distDir,
            });
            const result = JSON.parse(deployResult);
            const deployId = result.deployment_id || `deploy_${Date.now()}`;
            _deployments.set(deployId, { status: 'deployed', url: result.url, logs: '' });
            return JSON.stringify({ deployed: true, deployment_id: deployId, url: result.url, framework: detectedFramework });
        }
        catch (e) {
            // Server deploy failed, fall through to local message
        }
    }
    // Fallback: guide user to deploy manually
    return JSON.stringify({
        message: `Build complete (${detectedFramework}). Output in ${distDir}/. To deploy:\n` +
            `- Netlify: npx netlify deploy --prod --dir=${distDir}\n` +
            `- Vercel: npx vercel --prod\n` +
            `- Custom: rsync -a ${distDir}/ user@server:/var/www/`,
        framework: detectedFramework,
        dist_dir: distDir,
        build_output: (parsed.stdout || '').slice(-500),
    });
}
async function execCheckDeployStatus(deploymentId) {
    const d = _deployments.get(deploymentId);
    if (d) {
        return JSON.stringify({ deployment_id: deploymentId, ...d });
    }
    // Try server
    if (_authToken && _authDomain) {
        try {
            return await serverRequest('GET', `/api/v1/ide/deploy/${deploymentId}/status`);
        }
        catch { /* fallback */ }
    }
    return JSON.stringify({ error: `No deployment found: ${deploymentId}` });
}
// ── Deployment Config ──
async function execReadDeploymentConfig(projectPath) {
    try {
        // Try reading package.json
        const pkgUri = vscode.Uri.file(path.join(projectPath, 'package.json'));
        const data = await vscode.workspace.fs.readFile(pkgUri);
        const pkg = JSON.parse(Buffer.from(data).toString('utf-8'));
        return JSON.stringify({
            path: projectPath,
            name: pkg.name,
            version: pkg.version,
            scripts: pkg.scripts || {},
            dependencies: Object.keys(pkg.dependencies || {}),
            devDependencies: Object.keys(pkg.devDependencies || {}),
            framework: pkg.dependencies?.next ? 'nextjs' : pkg.dependencies?.react ? 'create-react-app' : pkg.dependencies?.svelte ? 'svelte' : 'unknown',
        });
    }
    catch {
        return JSON.stringify({ error: `No package.json found at ${projectPath}` });
    }
}
// ── Notebooks ──
// ── MCP (Model Context Protocol) Support ──
const _mcpServers = new Map();
function registerMcpServer(name, resources) {
    _mcpServers.set(name, { resources });
}
async function execListMcpResources(serverName) {
    if (serverName) {
        const server = _mcpServers.get(serverName);
        if (!server)
            return JSON.stringify({ error: `MCP server not found: ${serverName}` });
        return JSON.stringify({ server: serverName, resources: server.resources });
    }
    // List all servers and their resource counts
    const servers = Array.from(_mcpServers.entries()).map(([name, s]) => ({
        name,
        resource_count: s.resources.length,
        resources: s.resources.map(r => ({ uri: r.uri, name: r.name })),
    }));
    return JSON.stringify({ servers, total: servers.length });
}
async function execReadMcpResource(serverName, uri) {
    const server = _mcpServers.get(serverName);
    if (!server)
        return JSON.stringify({ error: `MCP server not found: ${serverName}` });
    const resource = server.resources.find(r => r.uri === uri);
    if (!resource)
        return JSON.stringify({ error: `Resource not found: ${uri}` });
    // If URI is a file, read it
    if (uri.startsWith('file://')) {
        const filePath = uri.replace('file://', '');
        return execFileRead(filePath);
    }
    // If URI is an HTTP URL, fetch it
    if (uri.startsWith('http://') || uri.startsWith('https://')) {
        return execReadUrl(uri);
    }
    return JSON.stringify({ resource: resource.name, uri, content: resource.description || 'No content available' });
}
// ── Workflows (.resonant/workflows/*.md) ──
async function execListWorkflows(workspaceRoot) {
    const workflowDir = path.join(workspaceRoot, '.resonant', 'workflows');
    try {
        const uri = vscode.Uri.file(workflowDir);
        const entries = await vscode.workspace.fs.readDirectory(uri);
        const workflows = [];
        for (const [name, type] of entries) {
            if (type === vscode.FileType.File && name.endsWith('.md')) {
                const filePath = path.join(workflowDir, name);
                const data = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
                const content = Buffer.from(data).toString('utf-8');
                // Parse YAML frontmatter for description
                const match = content.match(/^---\n([\s\S]*?)\n---/);
                let description = '';
                if (match) {
                    const descMatch = match[1].match(/description:\s*(.+)/);
                    if (descMatch)
                        description = descMatch[1].trim();
                }
                workflows.push({
                    name: name.replace('.md', ''),
                    description,
                    path: filePath,
                });
            }
        }
        return JSON.stringify({ workflows, count: workflows.length, directory: workflowDir });
    }
    catch {
        return JSON.stringify({ workflows: [], count: 0, message: `No workflow directory found at ${workflowDir}. Create .resonant/workflows/*.md files.` });
    }
}
async function execRunWorkflow(name, workspaceRoot) {
    const filePath = path.join(workspaceRoot, '.resonant', 'workflows', `${name}.md`);
    try {
        const data = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
        const content = Buffer.from(data).toString('utf-8');
        // Strip YAML frontmatter
        const body = content.replace(/^---\n[\s\S]*?\n---\n?/, '').trim();
        return JSON.stringify({
            workflow: name,
            path: filePath,
            steps: body,
            message: `Workflow "${name}" loaded. Follow the steps below.`,
        });
    }
    catch {
        return JSON.stringify({ error: `Workflow not found: ${name}. Create ${filePath}` });
    }
}
// ── Conversation Checkpoints ──
async function execSaveCheckpoint(summary, keyFiles, pendingTasks) {
    if (!globalState)
        return JSON.stringify({ error: 'State not available' });
    const checkpoint = {
        summary,
        key_files: keyFiles || [],
        pending_tasks: pendingTasks || [],
        timestamp: new Date().toISOString(),
    };
    const checkpoints = globalState.get('resonant_checkpoints', []);
    checkpoints.push(checkpoint);
    // Keep last 20 checkpoints
    if (checkpoints.length > 20)
        checkpoints.splice(0, checkpoints.length - 20);
    await globalState.update('resonant_checkpoints', checkpoints);
    // Also sync to server if available
    if (_authToken && _authDomain) {
        try {
            await serverMemoryEmbed(`Checkpoint: ${summary}\nFiles: ${(keyFiles || []).join(', ')}\nTasks: ${(pendingTasks || []).join(', ')}`, ['checkpoint', 'ide-session'], `checkpoint_${Date.now()}`);
        }
        catch { /* ok */ }
    }
    return JSON.stringify({ saved: true, total_checkpoints: checkpoints.length });
}
async function execLoadCheckpoint() {
    if (!globalState)
        return JSON.stringify({ error: 'State not available' });
    const checkpoints = globalState.get('resonant_checkpoints', []);
    if (checkpoints.length === 0)
        return JSON.stringify({ message: 'No checkpoints found.' });
    const latest = checkpoints[checkpoints.length - 1];
    return JSON.stringify({ latest, total_checkpoints: checkpoints.length, all: checkpoints.slice(-5) });
}
// ── Visual Tools ──
// Store generated visualizations for rendering in chat
const _visualizations = new Map();
function getVisualization(id) { return _visualizations.get(id); }
async function execVisualize(title, svg, mermaid, width, height) {
    if (!title)
        return JSON.stringify({ error: 'title is required' });
    if (!svg && !mermaid)
        return JSON.stringify({ error: 'Either svg or mermaid parameter is required' });
    const vizId = `viz_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const w = width || 600;
    const h = height || 400;
    let finalSvg = '';
    if (svg) {
        // Validate and normalize SVG
        finalSvg = svg.trim();
        if (!finalSvg.startsWith('<svg')) {
            // Wrap bare SVG content
            finalSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${finalSvg}</svg>`;
        }
        // Ensure viewBox and dimensions
        if (!finalSvg.includes('width=')) {
            finalSvg = finalSvg.replace('<svg', `<svg width="${w}" height="${h}"`);
        }
    }
    else if (mermaid) {
        // Store mermaid source — the chat renderer will handle conversion
        finalSvg = ''; // Will be rendered by extension
    }
    _visualizations.set(vizId, { title, svg: finalSvg, mermaid: mermaid || undefined });
    // Clean up old visualizations (keep last 20)
    if (_visualizations.size > 20) {
        const keys = Array.from(_visualizations.keys());
        for (let i = 0; i < keys.length - 20; i++)
            _visualizations.delete(keys[i]);
    }
    return JSON.stringify({
        visualization_id: vizId,
        title,
        type: svg ? 'svg' : 'mermaid',
        width: w,
        height: h,
        rendered: true,
        message: `Visualization "${title}" created and displayed inline.`,
    });
}
async function execImageSearch(query, count) {
    if (!query)
        return JSON.stringify({ error: 'query is required' });
    const maxResults = Math.min(count || 5, 10);
    // Strategy 1: Bing image search (scrape HTML — no API key needed)
    try {
        const bingUrl = `https://www.bing.com/images/search?q=${encodeURIComponent(query)}&first=1&count=${maxResults * 2}&qft=+filterui:photo-photo`;
        const html = await httpGet(bingUrl);
        // Extract image data from Bing's <a class="iusc" m="{...}"> elements
        const results = [];
        const iuscPattern = /class="iusc"[^>]*m="([^"]+)"/g;
        let match;
        while ((match = iuscPattern.exec(html)) !== null && results.length < maxResults) {
            try {
                const decoded = match[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&');
                const data = JSON.parse(decoded);
                if (data.murl) {
                    results.push({
                        title: data.t || data.desc || query,
                        url: data.murl,
                        thumbnail: data.turl || data.murl,
                        source: data.purl ? new URL(data.purl).hostname : '',
                        width: data.mw || 0,
                        height: data.mh || 0,
                    });
                }
            }
            catch { /* skip malformed entry */ }
        }
        // Fallback: try extracting from <img> src attributes if iusc didn't work
        if (results.length === 0) {
            const imgPattern = /src="(https:\/\/tse\d*\.mm\.bing\.net\/th[^"]+)"/g;
            let imgMatch;
            while ((imgMatch = imgPattern.exec(html)) !== null && results.length < maxResults) {
                results.push({
                    title: `${query} (${results.length + 1})`,
                    url: imgMatch[1],
                    thumbnail: imgMatch[1],
                    source: 'bing.com',
                    width: 0,
                    height: 0,
                });
            }
        }
        if (results.length > 0) {
            return JSON.stringify({ query, results, source: 'bing', count: results.length });
        }
    }
    catch { /* Bing failed, try DuckDuckGo */ }
    // Strategy 2: DuckDuckGo image search
    try {
        const tokenResp = await httpGet(`https://duckduckgo.com/?q=${encodeURIComponent(query)}`);
        // Try multiple vqd patterns (DDG changes format periodically)
        const vqdMatch = tokenResp.match(/vqd=['"]([^'"]+)['"]/) ||
            tokenResp.match(/vqd=([\d-]+)/) ||
            tokenResp.match(/vqd%3D([\w-]+)/);
        if (vqdMatch) {
            const vqd = vqdMatch[1];
            const apiUrl = `https://duckduckgo.com/i.js?l=us-en&o=json&q=${encodeURIComponent(query)}&vqd=${vqd}&f=,,,,,&p=1`;
            const imgResp = await httpGet(apiUrl);
            const imgData = JSON.parse(imgResp);
            const results = (imgData.results || []).slice(0, maxResults).map((r) => ({
                title: r.title || '',
                url: r.image || r.url || '',
                thumbnail: r.thumbnail || r.image || '',
                source: r.source || '',
                width: r.width || 0,
                height: r.height || 0,
            }));
            if (results.length > 0) {
                return JSON.stringify({ query, results, source: 'duckduckgo', count: results.length });
            }
        }
    }
    catch { /* DDG also failed */ }
    // Strategy 3: Google Images scrape (last resort)
    try {
        const gUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&tbm=isch&safe=active`;
        const gHtml = await httpGet(gUrl);
        const results = [];
        // Google embeds image URLs in data attributes and script tags
        const gImgPattern = /\["(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp|gif))",\s*(\d+),\s*(\d+)\]/gi;
        let gMatch;
        while ((gMatch = gImgPattern.exec(gHtml)) !== null && results.length < maxResults) {
            const imgUrl = gMatch[1];
            // Skip Google's own assets
            if (imgUrl.includes('gstatic.com') || imgUrl.includes('google.com'))
                continue;
            results.push({
                title: `${query} (${results.length + 1})`,
                url: imgUrl,
                thumbnail: imgUrl,
                source: 'google images',
                width: parseInt(gMatch[2]) || 0,
                height: parseInt(gMatch[3]) || 0,
            });
        }
        if (results.length > 0) {
            return JSON.stringify({ query, results, source: 'google', count: results.length });
        }
    }
    catch { /* Google also failed */ }
    return JSON.stringify({ query, results: [], source: 'none', count: 0, error: 'All image search providers failed. Try a different query.' });
}
// Simple HTTP GET helper for image search
function httpGet(url) {
    return new Promise((resolve, reject) => {
        const mod = url.startsWith('https') ? https : http;
        const req = mod.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' } }, (res) => {
            // Follow redirects
            if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                httpGet(res.headers.location).then(resolve).catch(reject);
                return;
            }
            let data = '';
            res.on('data', (chunk) => data += chunk.toString());
            res.on('end', () => resolve(data));
        });
        req.on('error', reject);
        req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
    });
}
async function execEditNotebook(filePath, cellNumber, newSource, cellType, editMode) {
    try {
        const uri = vscode.Uri.file(filePath);
        const data = await vscode.workspace.fs.readFile(uri);
        const nb = JSON.parse(Buffer.from(data).toString('utf-8'));
        if (!nb.cells)
            nb.cells = [];
        const sourceLines = newSource.split('\n').map((l, i, arr) => i < arr.length - 1 ? l + '\n' : l);
        if (editMode === 'insert') {
            nb.cells.splice(cellNumber, 0, {
                cell_type: cellType || 'code', source: sourceLines, metadata: {},
                ...(cellType !== 'markdown' ? { outputs: [], execution_count: null } : {}),
            });
        }
        else {
            if (cellNumber >= nb.cells.length)
                return JSON.stringify({ error: `Cell ${cellNumber} does not exist` });
            nb.cells[cellNumber].source = sourceLines;
        }
        await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(nb, null, 1), 'utf-8'));
        return JSON.stringify({ path: filePath, cell: cellNumber, mode: editMode || 'replace', success: true });
    }
    catch (e) {
        return JSON.stringify({ error: e.message });
    }
}
//# sourceMappingURL=toolExecutor.js.map