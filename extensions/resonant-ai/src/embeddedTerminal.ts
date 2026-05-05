/*---------------------------------------------------------------------------------------------
 *  Embedded Terminal Webview — xterm.js terminal embedded in chat
 *
 *  Provides WindSurf/Cascade-like embedded terminal experience:
 *  - Terminal appears directly in chat (not separate panel)
 *  - Real-time output streaming via SSE
 *  - Interactive input (passwords, prompts)
 *  - Uses xterm.js for terminal emulation
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';

export class EmbeddedTerminalView {
	private panel: vscode.WebviewPanel | undefined;
	private disposables: vscode.Disposable[] = [];
	private sessionId: string = '';
	private apiUrl: string = 'https://dev-swat.com';
	private terminalOnlyMode: boolean = false;

	constructor(private context: vscode.ExtensionContext) {
		const config = vscode.workspace.getConfiguration('resonant');
		this.apiUrl = config.get<string>('apiUrl', 'https://dev-swat.com');
	}

	show(sessionId: string, title: string = 'Terminal') {
		this.sessionId = sessionId;
		
		if (this.panel) {
			this.panel.reveal();
			return;
		}

		this.panel = vscode.window.createWebviewPanel(
			'resonant.embeddedTerminal',
			title,
			vscode.ViewColumn.Beside,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [
					vscode.Uri.joinPath(this.context.extensionUri, 'node_modules', 'xterm'),
					vscode.Uri.joinPath(this.context.extensionUri, 'node_modules', 'xterm-addon-fit'),
					vscode.Uri.joinPath(this.context.extensionUri, 'node_modules', 'xterm-addon-web-links'),
				]
			}
		);

		this.panel.webview.html = this.getWebviewContent(sessionId);
		this.panel.onDidDispose(() => this.dispose());
		
		// Handle messages from webview
		this.panel.webview.onDidReceiveMessage(message => {
			if (message.type === 'input') {
				// Send input to backend via HTTP endpoint
				this.sendToBackend(sessionId, message.content);
			}
		});
	}

	private getWebviewContent(sessionId: string): string {
		const xtermPath = this.panel?.webview.asWebviewUri(
			vscode.Uri.joinPath(this.context.extensionUri, 'node_modules', 'xterm', 'lib', 'xterm.js')
		);
		const fitAddonPath = this.panel?.webview.asWebviewUri(
			vscode.Uri.joinPath(this.context.extensionUri, 'node_modules', 'xterm-addon-fit', 'lib', 'xterm-addon-fit.js')
		);
		const webLinksAddonPath = this.panel?.webview.asWebviewUri(
			vscode.Uri.joinPath(this.context.extensionUri, 'node_modules', 'xterm-addon-web-links', 'lib', 'xterm-addon-web-links.js')
		);

		return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Embedded Terminal</title>
    <style>
        body {
            margin: 0;
            padding: 0;
            background: #1e1e1e;
            overflow: hidden;
        }
        #terminal-container {
            width: 100%;
            height: 100vh;
        }
    </style>
</head>
<body>
    <div id="terminal-container"></div>
    <script src="${xtermPath}"></script>
    <script src="${fitAddonPath}"></script>
    <script src="${webLinksAddonPath}"></script>
    <script>
        const sessionId = '${sessionId}';
        const terminal = new Terminal({
            cursorBlink: true,
            fontSize: 14,
            fontFamily: 'Menlo, Monaco, "Courier New", monospace',
            theme: {
                background: '#1e1e1e',
                foreground: '#d4d4d4',
                cursor: '#ffffff',
                black: '#000000',
                red: '#cd3131',
                green: '#00bc00',
                yellow: '#949800',
                blue: '#0451a5',
                magenta: '#bc05bc',
                cyan: '#0598bc',
                white: '#d4d4d4',
                brightBlack: '#666666',
                brightRed: '#cd3131',
                brightGreen: '#14ce14',
                brightYellow: '#b5ba00',
                brightBlue: '#0451a5',
                brightMagenta: '#bc05bc',
                brightCyan: '#0598bc',
                brightWhite: '#ffffff'
            }
        });

        const fitAddon = new FitAddon.FitAddon();
        terminal.loadAddon(fitAddon);
        terminal.loadAddon(new WebLinksAddon.WebLinksAddon());

        const container = document.getElementById('terminal-container');
        container.appendChild(terminal.element);
        fitAddon.fit();

        window.addEventListener('resize', () => fitAddon.fit());

        // Connect to backend for streaming
        const ws = new WebSocket('ws://localhost:8000/api/v1/ide/terminal-stream/' + sessionId);
        
        ws.onopen = () => {
            console.log('Terminal stream connected');
        };

        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.type === 'output') {
                terminal.write(data.content);
            } else if (data.type === 'error') {
                terminal.write('\\r\\n\\x1b[31mError: ' + data.message + '\\x1b[0m\\r\\n');
            }
        };

        ws.onerror = (error) => {
            console.error('Terminal stream error:', error);
            terminal.write('\\r\\n\\x1b[31mConnection error\\x1b[0m\\r\\n');
        };

        ws.onclose = () => {
            terminal.write('\\r\\n\\x1b[33mConnection closed\\x1b[0m\\r\\n');
        };

        const vscode = acquireVsCodeApi();
        let terminalOnlyMode = false;

        // Handle messages from extension
        window.addEventListener('message', (event) => {
            const message = event.data;
            if (message.type === 'terminal_only_mode') {
                terminalOnlyMode = message.enabled;
                if (terminalOnlyMode) {
                    terminal.write('\\r\\n\\x1b[33m=== Terminal-Only Mode Active ===\\x1b[0m\\r\\n');
                }
            }
        });

        // Send user input to backend
        terminal.onData((data) => {
            if (terminalOnlyMode) {
                // In terminal-only mode, send to /terminal-input endpoint
                fetch('${this.apiUrl}/api/v1/ide/terminal-input', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        session_id: sessionId,
                        input: data
                    })
                })
                .then(response => response.json())
                .then(result => {
                    if (result.response) {
                        terminal.write(result.response);
                    }
                })
                .catch(error => {
                    terminal.write('\\r\\n\\x1b[31mError: ' + error.message + '\\x1b[0m\\r\\n');
                });
            } else {
                // Normal mode: send to PTY via WebSocket
                ws.send(JSON.stringify({ type: 'input', content: data }));
            }
        });

        // Notify extension when terminal is ready
        const vscode = acquireVsCodeApi();
        vscode.postMessage({ type: 'ready', sessionId });
    </script>
</body>
</html>`;
	}

	setTerminalOnlyMode(enabled: boolean) {
		this.terminalOnlyMode = enabled;
		// Update webview to handle terminal-only mode
		if (this.panel) {
			this.panel.webview.postMessage({ type: 'terminal_only_mode', enabled });
		}
	}

	sendInput(input: string) {
		this.panel?.webview.postMessage({ type: 'input', content: input });
	}

	private async sendToBackend(sessionId: string, input: string): Promise<void> {
		const url = `${this.apiUrl}/api/v1/ide/terminal-send`;
		const urlObj = new URL(url);
		const isHttps = urlObj.protocol === 'https:';
		const reqModule = isHttps ? https : http;
		
		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
		};
		
		const payload = JSON.stringify({ session_id: sessionId, input: input });
		headers['Content-Length'] = String(Buffer.byteLength(payload));
		
		const req = reqModule.request({
			hostname: urlObj.hostname,
			port: urlObj.port || (isHttps ? 443 : 80),
			path: urlObj.pathname,
			method: 'POST',
			headers,
		}, (res) => {
			if (res.statusCode && res.statusCode >= 400) {
				console.error(`PTY send failed: HTTP ${res.statusCode}`);
			}
		});
		
		req.on('error', (err) => {
			console.error('PTY send error:', err);
		});
		
		req.write(payload);
		req.end();
	}

	dispose() {
		this.panel?.dispose();
		this.disposables.forEach(d => d.dispose());
		this.disposables = [];
	}
}
