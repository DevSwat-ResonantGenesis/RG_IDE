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
exports.ResonantAuthenticationProvider = void 0;
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
const vscode = __importStar(require("vscode"));
const http = __importStar(require("http"));
const https = __importStar(require("https"));
const AUTH_TOKEN_KEY = 'resonant_auth_token';
const AUTH_USER_KEY = 'resonant_auth_user';
const SESSIONS_KEY = 'resonant_auth_sessions';
/**
* Minimal VS Code authentication provider for Resonant Genesis.
* When user clicks "Continue with Resonant Genesis" in the sign-in dialog,
* opens browser to resonantgenesis.xyz, receives token via local HTTP callback.
*/
class ResonantAuthenticationProvider {
    _context;
    static id = 'resonant-genesis';
    _sessionChangeEmitter = new vscode.EventEmitter();
    onDidChangeSessions = this._sessionChangeEmitter.event;
    _disposables = [];
    _localServer = null;
    constructor(_context) {
        this._context = _context;
        this._disposables.push(vscode.authentication.registerAuthenticationProvider(ResonantAuthenticationProvider.id, 'Resonant Genesis', this, { supportsMultipleAccounts: false }));
    }
    async getSessions(_scopes) {
        const stored = this._context.globalState.get(SESSIONS_KEY, []);
        return stored.map(s => ({
            id: s.id,
            accessToken: s.accessToken,
            account: s.account,
            scopes: s.scopes,
        }));
    }
    async createSession(scopes) {
        const config = vscode.workspace.getConfiguration('resonant');
        const apiUrl = config.get('apiUrl', 'https://dev-swat.com');
        const port = 19200 + Math.floor(Math.random() * 800);
        // Open browser → backend → local callback with token
        const token = await this._doLogin(apiUrl, port);
        const userInfo = await this._fetchUser(apiUrl, token);
        const session = {
            id: `resonant-${Date.now()}`,
            accessToken: token,
            account: { id: userInfo.email || 'user', label: userInfo.name || userInfo.email || 'Resonant User' },
            scopes: [...scopes],
        };
        // Persist
        await this._context.globalState.update(SESSIONS_KEY, [{ id: session.id, accessToken: session.accessToken, account: session.account, scopes: session.scopes }]);
        await this._context.globalState.update(AUTH_TOKEN_KEY, token);
        await this._context.globalState.update(AUTH_USER_KEY, userInfo);
        this._sessionChangeEmitter.fire({ added: [session], removed: [], changed: [] });
        vscode.window.showInformationMessage(`Signed in as ${session.account.label}`);
        return session;
    }
    async removeSession(sessionId) {
        const stored = this._context.globalState.get(SESSIONS_KEY, []);
        const removed = stored.filter(s => s.id === sessionId);
        await this._context.globalState.update(SESSIONS_KEY, []);
        await this._context.globalState.update(AUTH_TOKEN_KEY, undefined);
        await this._context.globalState.update(AUTH_USER_KEY, undefined);
        if (removed.length > 0) {
            this._sessionChangeEmitter.fire({
                added: [], changed: [],
                removed: removed.map(s => ({ id: s.id, accessToken: s.accessToken, account: s.account, scopes: s.scopes })),
            });
        }
        vscode.window.showInformationMessage('Resonant IDE: Signed out.');
    }
    _doLogin(apiUrl, port) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                if (this._localServer) {
                    this._localServer.close();
                    this._localServer = null;
                }
                reject(new Error('Login timed out'));
            }, 5 * 60 * 1000);
            let resolved = false;
            this._localServer = http.createServer((req, res) => {
                const url = new URL(req.url || '/', `http://localhost:${port}`);
                if (url.pathname === '/auth-callback') {
                    const token = url.searchParams.get('token');
                    if (token) {
                        res.writeHead(200, { 'Content-Type': 'text/html' });
                        res.end('<html><body style="font-family:sans-serif;background:#1e1e1e;color:#ccc;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><h2 style="color:#4ade80">Signed In!</h2><p>Return to Resonant IDE.</p></div></body></html>');
                        clearTimeout(timer);
                        resolved = true;
                        setTimeout(() => { if (this._localServer) {
                            this._localServer.close();
                            this._localServer = null;
                        } }, 500);
                        resolve(token);
                    }
                    else {
                        res.writeHead(400);
                        res.end('Missing token');
                    }
                }
                else {
                    res.writeHead(404);
                    res.end('Not found');
                }
            });
            const authUrl = `${apiUrl}/auth/desktop-callback?port=${port}`;
            this._localServer.listen(port, '127.0.0.1', () => {
                vscode.env.openExternal(vscode.Uri.parse(authUrl));
            });
            this._localServer.on('error', (err) => {
                this._localServer = null;
                clearTimeout(timer);
                reject(err);
            });
            // Aggressive poll: after 5s, re-open the callback URL every 2s.
            // Once user logs in on browser, cookie is set and next poll succeeds.
            let pollElapsed = 0;
            const retryTimer = setInterval(async () => {
                pollElapsed += 2000;
                if (resolved || !this._localServer) {
                    clearInterval(retryTimer);
                    return;
                }
                if (pollElapsed > 120000) {
                    clearInterval(retryTimer);
                    return;
                } // 2min max
                if (pollElapsed >= 5000) {
                    console.log(`[Resonant Auth Provider] Poll ${Math.round(pollElapsed / 1000)}s — re-opening callback`);
                    await vscode.env.openExternal(vscode.Uri.parse(authUrl));
                }
            }, 2000);
        });
    }
    async _fetchUser(apiUrl, token) {
        try {
            const url = new URL(`${apiUrl}/auth/me`);
            const headers = { 'Content-Type': 'application/json' };
            if (token.startsWith('RG-')) {
                headers['x-api-key'] = token;
            }
            else {
                headers['Authorization'] = `Bearer ${token}`;
            }
            const body = await new Promise((resolve, reject) => {
                const req = https.request({ hostname: url.hostname, port: 443, path: url.pathname, method: 'GET', headers }, (res) => {
                    let d = '';
                    res.on('data', (c) => { d += c.toString(); });
                    res.on('end', () => res.statusCode && res.statusCode >= 400 ? reject(new Error(`HTTP ${res.statusCode}`)) : resolve(d));
                });
                req.on('error', reject);
                req.end();
            });
            const data = JSON.parse(body);
            return { email: data.email || '', name: data.full_name || data.display_name || data.name || data.email || '' };
        }
        catch (err) {
            console.error('[Resonant AI] Failed to fetch user profile:', err);
            return { email: '', name: '' };
        }
    }
    dispose() {
        if (this._localServer) {
            this._localServer.close();
            this._localServer = null;
        }
        this._sessionChangeEmitter.dispose();
        this._disposables.forEach(d => d.dispose());
    }
}
exports.ResonantAuthenticationProvider = ResonantAuthenticationProvider;
