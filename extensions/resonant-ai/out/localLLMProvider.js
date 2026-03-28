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
exports.testLocalConnection = testLocalConnection;
exports.listLocalModels = listLocalModels;
exports.callLocalCompletions = callLocalCompletions;
exports.callLocalCompletionsSync = callLocalCompletionsSync;
/*---------------------------------------------------------------------------------------------
 *  Local LLM Provider — Direct connection to Ollama or any OpenAI-compatible local server.
 *  Since Resonant IDE is a desktop Electron app, it can call localhost directly.
 *  No WebSocket tunnel needed (unlike the web platform).
 *
 *  Supports:
 *  - Ollama (default: http://localhost:11434)
 *  - LM Studio (http://localhost:1234)
 *  - llama.cpp server (http://localhost:8080)
 *  - Any OpenAI-compatible API (LocalAI, vLLM, text-generation-webui, etc.)
 *
 *  Uses OpenAI-compatible /v1/chat/completions for inference.
 *  Uses Ollama /api/tags for model discovery (falls back to configured model list).
 *--------------------------------------------------------------------------------------------*/
const http = __importStar(require("http"));
const url_1 = require("url");
// ── Connection Test ──
async function testLocalConnection(baseUrl) {
    try {
        // Try Ollama /api/tags first
        const resp = await httpGet(`${baseUrl}/api/tags`, 3000);
        if (resp.statusCode === 200) {
            return { ok: true, server: 'ollama' };
        }
    }
    catch { /* not Ollama */ }
    try {
        // Try OpenAI-compatible /v1/models
        const resp = await httpGet(`${baseUrl}/v1/models`, 3000);
        if (resp.statusCode === 200) {
            return { ok: true, server: 'openai-compatible' };
        }
    }
    catch { /* not OpenAI-compatible */ }
    try {
        // Try root health check
        const resp = await httpGet(baseUrl, 3000);
        if (resp.statusCode === 200) {
            return { ok: true, server: 'unknown' };
        }
        return { ok: false, server: 'none', error: `HTTP ${resp.statusCode}` };
    }
    catch (err) {
        return { ok: false, server: 'none', error: err instanceof Error ? err.message : String(err) };
    }
}
// ── Model Discovery ──
async function listLocalModels(baseUrl) {
    const models = [];
    // Try Ollama /api/tags
    try {
        const resp = await httpGet(`${baseUrl}/api/tags`, 5000);
        if (resp.statusCode === 200) {
            const data = JSON.parse(resp.body);
            for (const m of data.models || []) {
                models.push({
                    name: m.name,
                    size: m.size || 0,
                    parameterSize: m.details?.parameter_size || '',
                    quantization: m.details?.quantization_level || '',
                    family: m.details?.family || '',
                    modifiedAt: m.modified_at || '',
                });
            }
            return models;
        }
    }
    catch { /* not Ollama */ }
    // Try OpenAI-compatible /v1/models
    try {
        const resp = await httpGet(`${baseUrl}/v1/models`, 5000);
        if (resp.statusCode === 200) {
            const data = JSON.parse(resp.body);
            for (const m of data.data || []) {
                models.push({
                    name: m.id,
                    size: 0,
                    parameterSize: '',
                    quantization: '',
                    family: m.owned_by || '',
                    modifiedAt: '',
                });
            }
            return models;
        }
    }
    catch { /* fallback */ }
    return models;
}
// ── Completions (Streaming) ──
async function callLocalCompletions(config, messages, tools, onChunk) {
    const baseUrl = config.url.replace(/\/+$/, '');
    const url = `${baseUrl}/v1/chat/completions`;
    const body = {
        model: config.model,
        messages,
        stream: true,
        temperature: 0.7,
        max_tokens: 16384,
    };
    // Only include tools if the model supports them and we have some
    if (tools && tools.length > 0) {
        body.tools = tools;
    }
    let content = '';
    const toolCalls = new Map();
    let usage = null;
    return new Promise((resolve, reject) => {
        const parsed = new url_1.URL(url);
        const reqOptions = {
            hostname: parsed.hostname,
            port: parsed.port || 80,
            path: parsed.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'text/event-stream',
            },
        };
        const payload = JSON.stringify(body);
        const req = http.request(reqOptions, (res) => {
            if (res.statusCode !== 200) {
                let errBody = '';
                res.on('data', (c) => { errBody += c.toString(); });
                res.on('end', () => {
                    reject(new Error(`Local LLM returned ${res.statusCode}: ${errBody.slice(0, 300)}`));
                });
                return;
            }
            let buffer = '';
            res.on('data', (chunk) => {
                buffer += chunk.toString();
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || trimmed === 'data: [DONE]') {
                        continue;
                    }
                    if (!trimmed.startsWith('data: ')) {
                        continue;
                    }
                    try {
                        const data = JSON.parse(trimmed.slice(6));
                        const choice = data.choices?.[0];
                        if (!choice) {
                            continue;
                        }
                        // Text content
                        if (choice.delta?.content) {
                            content += choice.delta.content;
                            onChunk?.(choice.delta.content);
                        }
                        // Tool calls (streamed incrementally)
                        if (choice.delta?.tool_calls) {
                            for (const tc of choice.delta.tool_calls) {
                                const idx = tc.index ?? 0;
                                if (!toolCalls.has(idx)) {
                                    toolCalls.set(idx, {
                                        id: tc.id || `local_call_${Date.now()}_${idx}`,
                                        name: tc.function?.name || '',
                                        arguments: tc.function?.arguments || '',
                                    });
                                }
                                else {
                                    const existing = toolCalls.get(idx);
                                    if (tc.function?.name) {
                                        existing.name = tc.function.name;
                                    }
                                    if (tc.function?.arguments) {
                                        existing.arguments += tc.function.arguments;
                                    }
                                }
                            }
                        }
                        // Usage (usually in last chunk)
                        if (data.usage) {
                            usage = data.usage;
                        }
                    }
                    catch { /* skip malformed SSE lines */ }
                }
            });
            res.on('end', () => {
                // Parse any remaining buffer
                if (buffer.trim() && buffer.trim() !== 'data: [DONE]' && buffer.trim().startsWith('data: ')) {
                    try {
                        const data = JSON.parse(buffer.trim().slice(6));
                        if (data.choices?.[0]?.delta?.content) {
                            content += data.choices[0].delta.content;
                            onChunk?.(data.choices[0].delta.content);
                        }
                        if (data.usage) {
                            usage = data.usage;
                        }
                    }
                    catch { /* skip */ }
                }
                const resultToolCalls = Array.from(toolCalls.values()).map(tc => ({
                    id: tc.id,
                    type: 'function',
                    function: { name: tc.name, arguments: tc.arguments },
                }));
                resolve({
                    content,
                    tool_calls: resultToolCalls,
                    usage,
                    model: config.model,
                });
            });
            res.on('error', reject);
        });
        req.on('error', (err) => {
            if (err.code === 'ECONNREFUSED') {
                reject(new Error(`Cannot connect to local LLM at ${baseUrl}. Is Ollama running? Start it with: ollama serve`));
            }
            else {
                reject(err);
            }
        });
        // 5 minute timeout for slow local models
        req.setTimeout(300_000, () => {
            req.destroy();
            reject(new Error('Local LLM request timed out (5 minutes)'));
        });
        req.write(payload);
        req.end();
    });
}
// ── Non-streaming fallback (for models that don't support streaming well) ──
async function callLocalCompletionsSync(config, messages, tools) {
    const baseUrl = config.url.replace(/\/+$/, '');
    const url = `${baseUrl}/v1/chat/completions`;
    const body = {
        model: config.model,
        messages,
        stream: false,
        temperature: 0.7,
        max_tokens: 16384,
    };
    if (tools && tools.length > 0) {
        body.tools = tools;
    }
    const resp = await httpPost(url, JSON.stringify(body), 300_000);
    const data = JSON.parse(resp.body);
    const choice = data.choices?.[0];
    return {
        content: choice?.message?.content || '',
        tool_calls: (choice?.message?.tool_calls || []).map(tc => ({
            id: tc.id,
            type: tc.type,
            function: tc.function,
        })),
        usage: data.usage || null,
        model: data.model || config.model,
    };
}
function httpGet(url, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
        const parsed = new url_1.URL(url);
        const req = http.request({
            hostname: parsed.hostname,
            port: parsed.port || 80,
            path: parsed.pathname + parsed.search,
            method: 'GET',
        }, (res) => {
            let body = '';
            res.on('data', (c) => { body += c.toString(); });
            res.on('end', () => resolve({ statusCode: res.statusCode || 0, body }));
        });
        req.on('error', reject);
        req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('Timeout')); });
        req.end();
    });
}
function httpPost(url, payload, timeoutMs = 60000) {
    return new Promise((resolve, reject) => {
        const parsed = new url_1.URL(url);
        const req = http.request({
            hostname: parsed.hostname,
            port: parsed.port || 80,
            path: parsed.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': String(Buffer.byteLength(payload)),
            },
        }, (res) => {
            let body = '';
            res.on('data', (c) => { body += c.toString(); });
            res.on('end', () => resolve({ statusCode: res.statusCode || 0, body }));
        });
        req.on('error', reject);
        req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('Timeout')); });
        req.write(payload);
        req.end();
    });
}
