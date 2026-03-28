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
exports.ResonantAgentProvider = void 0;
/*---------------------------------------------------------------------------------------------
 *  Resonant Genesis Agent Provider
 *  Fetches user agents from /api/v1/agents and registers each as a
 *  VS Code chat participant so they appear in the @ mention list.
 *--------------------------------------------------------------------------------------------*/
const vscode = __importStar(require("vscode"));
const https = __importStar(require("https"));
const http = __importStar(require("http"));
const url_1 = require("url");
class ResonantAgentProvider {
    context;
    getToken;
    participants = [];
    registeredIds = new Set();
    refreshTimer;
    constructor(context, getToken) {
        this.context = context;
        this.getToken = getToken;
    }
    async activate() {
        await this.refreshAgents();
        // Refresh agents every 5 minutes
        this.refreshTimer = setInterval(() => this.refreshAgents(), 300_000);
    }
    async refreshAgents() {
        // Dispose previous participants
        for (const p of this.participants) {
            p.dispose();
        }
        this.participants = [];
        const token = await this.getToken();
        if (!token) {
            return;
        }
        try {
            const agents = await this.fetchAgents(token);
            console.log(`[Resonant AI] Fetched ${agents.length} user agents`);
            for (const agent of agents) {
                if (!agent.is_active) {
                    continue;
                }
                this.registerAgent(agent, token);
            }
        }
        catch (err) {
            console.error('[Resonant AI] Failed to fetch agents:', err);
        }
    }
    registerAgent(agent, token) {
        // Create a sanitized participant ID from agent name
        const safeId = agent.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const participantId = `resonant-genesis.agent-${safeId}`;
        // Skip if already registered (prevents "Agent already has implementation" errors)
        if (this.registeredIds.has(participantId)) {
            console.log(`[Resonant AI] Agent "${agent.name}" already registered, skipping`);
            return;
        }
        try {
            const participant = vscode.chat.createChatParticipant(participantId, async (request, _chatContext, response, cancelToken) => {
                try {
                    const currentToken = await this.getToken();
                    if (!currentToken) {
                        response.markdown('⚠️ Please sign in to use this agent.');
                        return;
                    }
                    await this.streamAgentResponse(agent, request.prompt, currentToken, response, cancelToken);
                }
                catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    response.markdown(`⚠️ Agent error: ${msg}`);
                }
            });
            participant.iconPath = new vscode.ThemeIcon('hubot');
            if (agent.description) {
                participant.description = agent.description;
            }
            participant.fullName = agent.name;
            this.participants.push(participant);
            this.registeredIds.add(participantId);
            this.context.subscriptions.push(participant);
        }
        catch (err) {
            console.warn(`[Resonant AI] Failed to register agent "${agent.name}":`, err);
        }
    }
    async streamAgentResponse(agent, prompt, token, response, cancelToken) {
        const apiUrl = vscode.workspace.getConfiguration('resonant').get('apiUrl', 'https://dev-swat.com');
        const url = new url_1.URL(`${apiUrl}/api/v1/agents/${agent.id}/chat`);
        const isHttps = url.protocol === 'https:';
        const reqModule = isHttps ? https : http;
        const body = JSON.stringify({
            message: prompt,
            stream: true,
        });
        const headers = {
            'Content-Type': 'application/json',
            'Accept': 'text/event-stream',
            'Authorization': `Bearer ${token}`,
        };
        return new Promise((resolve, reject) => {
            const req = reqModule.request({
                hostname: url.hostname,
                port: url.port || (isHttps ? 443 : 80),
                path: url.pathname,
                method: 'POST',
                headers,
            }, (res) => {
                if (res.statusCode !== 200) {
                    let errBody = '';
                    res.on('data', (chunk) => { errBody += chunk.toString(); });
                    res.on('end', () => {
                        reject(new Error(`Agent API returned ${res.statusCode}: ${errBody.slice(0, 200)}`));
                    });
                    return;
                }
                let buffer = '';
                res.on('data', (chunk) => {
                    if (cancelToken.isCancellationRequested) {
                        req.destroy();
                        resolve();
                        return;
                    }
                    buffer += chunk.toString();
                    // Parse SSE events
                    const blocks = buffer.split('\n\n');
                    buffer = blocks.pop() || '';
                    for (const block of blocks) {
                        if (!block.trim()) {
                            continue;
                        }
                        let data = '';
                        for (const line of block.split('\n')) {
                            if (line.startsWith('data: ')) {
                                data = line.slice(6);
                            }
                        }
                        if (!data || data === '[DONE]') {
                            continue;
                        }
                        try {
                            const parsed = JSON.parse(data);
                            if (parsed.content) {
                                response.markdown(parsed.content);
                            }
                            else if (parsed.choices?.[0]?.delta?.content) {
                                response.markdown(parsed.choices[0].delta.content);
                            }
                        }
                        catch {
                            // If it's plain text, output directly
                            if (data && data !== '[DONE]') {
                                response.markdown(data);
                            }
                        }
                    }
                });
                res.on('end', () => resolve());
                res.on('error', reject);
            });
            req.on('error', reject);
            cancelToken.onCancellationRequested(() => {
                req.destroy();
                resolve();
            });
            req.write(body);
            req.end();
        });
    }
    async fetchAgents(token) {
        const apiUrl = vscode.workspace.getConfiguration('resonant').get('apiUrl', 'https://dev-swat.com');
        const url = new url_1.URL(`${apiUrl}/api/v1/agents`);
        const isHttps = url.protocol === 'https:';
        const mod = isHttps ? https : http;
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
        };
        const body = await new Promise((resolve, reject) => {
            const req = mod.request({ hostname: url.hostname, port: url.port || (isHttps ? 443 : 80), path: url.pathname, method: 'GET', headers }, (res) => {
                let d = '';
                res.on('data', (c) => { d += c.toString(); });
                res.on('end', () => {
                    if (res.statusCode && res.statusCode >= 400) {
                        reject(new Error(`HTTP ${res.statusCode}: ${d.slice(0, 200)}`));
                    }
                    else {
                        resolve(d);
                    }
                });
            });
            req.on('error', reject);
            req.end();
        });
        const data = JSON.parse(body);
        return Array.isArray(data) ? data : (data.agents || []);
    }
    dispose() {
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
        }
        for (const p of this.participants) {
            p.dispose();
        }
        this.participants = [];
    }
}
exports.ResonantAgentProvider = ResonantAgentProvider;
