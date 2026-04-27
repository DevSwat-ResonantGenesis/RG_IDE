"use strict";
/**
 * LOC Tracker — counts lines of code written by DevSwat AI and sends telemetry.
 * Tracks file_write, file_edit, multi_edit tool calls.
 * Batches events and sends to /api/v1/ide/loc/track every 30 seconds.
 */
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
exports.initLocTracker = initLocTracker;
exports.updateLocAuth = updateLocAuth;
exports.getSessionStats = getSessionStats;
exports.resetSessionStats = resetSessionStats;
exports.getSessionDelta = getSessionDelta;
exports.trackToolLOC = trackToolLOC;
exports.flushEvents = flushEvents;
exports.disposeLocTracker = disposeLocTracker;
const https = __importStar(require("https"));
const http = __importStar(require("http"));
const url_1 = require("url");
// ── State ──
let _userId = '';
let _userEmail = '';
let _sessionId = '';
let _apiUrl = '';
let _authToken = '';
let _eventQueue = [];
let _flushTimer = null;
let _totalSession = { written: 0, edited: 0, deleted: 0, net: 0, calls: 0 };
const IDE_VERSION = '1.0.0';
function initLocTracker(apiUrl, authToken, userId, email) {
    _apiUrl = apiUrl;
    _authToken = authToken;
    _userId = userId;
    _userEmail = email || '';
    _sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    // Flush every 30 seconds
    if (_flushTimer) {
        clearInterval(_flushTimer);
    }
    _flushTimer = setInterval(() => flushEvents(), 30000);
}
function updateLocAuth(apiUrl, authToken) {
    _apiUrl = apiUrl;
    _authToken = authToken;
}
function getSessionStats() {
    return { ..._totalSession, queued: _eventQueue.length };
}
function resetSessionStats() {
    _totalSession = { written: 0, edited: 0, deleted: 0, net: 0, calls: 0 };
}
function getSessionDelta(since) {
    return {
        written: _totalSession.written - (since?.written || 0),
        edited: _totalSession.edited - (since?.edited || 0),
        deleted: _totalSession.deleted - (since?.deleted || 0),
        net: _totalSession.net - (since?.net || 0),
        calls: _totalSession.calls - (since?.calls || 0),
    };
}
/**
 * Count LOC from a tool call and queue the event.
 * Call this after file_write, file_edit, or multi_edit succeeds.
 */
function trackToolLOC(toolName, toolArgs) {
    let linesWritten = 0;
    let linesEdited = 0;
    let linesDeleted = 0;
    let filePath = toolArgs.path || '';
    if (toolName === 'file_write') {
        // Entire file content written
        const content = toolArgs.content || '';
        linesWritten = content.split('\n').length;
    }
    else if (toolName === 'file_edit') {
        const oldStr = toolArgs.old_string || '';
        const newStr = toolArgs.new_string || '';
        const oldLines = oldStr.split('\n').length;
        const newLines = newStr.split('\n').length;
        if (newLines > oldLines) {
            linesWritten = newLines - oldLines;
            linesEdited = oldLines;
        }
        else if (newLines < oldLines) {
            linesDeleted = oldLines - newLines;
            linesEdited = newLines;
        }
        else {
            linesEdited = newLines;
        }
    }
    else if (toolName === 'multi_edit') {
        const edits = toolArgs.edits || [];
        for (const edit of edits) {
            const oldStr = edit.old_string || '';
            const newStr = edit.new_string || '';
            const oldLines = oldStr.split('\n').length;
            const newLines = newStr.split('\n').length;
            if (newLines > oldLines) {
                linesWritten += newLines - oldLines;
                linesEdited += oldLines;
            }
            else if (newLines < oldLines) {
                linesDeleted += oldLines - newLines;
                linesEdited += newLines;
            }
            else {
                linesEdited += newLines;
            }
        }
    }
    else {
        return; // Not a tracked tool
    }
    const netLines = linesWritten - linesDeleted;
    const evt = {
        tool_name: toolName,
        file_path: filePath,
        lines_written: linesWritten,
        lines_edited: linesEdited,
        lines_deleted: linesDeleted,
        net_lines: netLines,
        language: detectLanguage(filePath),
        timestamp: new Date().toISOString(),
    };
    _eventQueue.push(evt);
    _totalSession.written += linesWritten;
    _totalSession.edited += linesEdited;
    _totalSession.deleted += linesDeleted;
    _totalSession.net += netLines;
    _totalSession.calls++;
}
/**
 * Flush queued events to backend.
 */
async function flushEvents() {
    if (_eventQueue.length === 0 || !_apiUrl || !_authToken || !_userId) {
        return;
    }
    const batch = _eventQueue.splice(0);
    const payload = JSON.stringify({
        user_id: _userId,
        user_email: _userEmail,
        session_id: _sessionId,
        ide_version: IDE_VERSION,
        events: batch.map(e => ({ ...e, user_id: _userId })),
    });
    try {
        const url = new url_1.URL(`${_apiUrl}/api/v1/ide/loc/track`);
        const isHttps = url.protocol === 'https:';
        const reqModule = isHttps ? https : http;
        const headers = {
            'Content-Type': 'application/json',
            'Content-Length': String(Buffer.byteLength(payload)),
        };
        if (_authToken.startsWith('RG-')) {
            headers['x-api-key'] = _authToken;
        }
        else {
            headers['Authorization'] = `Bearer ${_authToken}`;
        }
        await new Promise((resolve) => {
            const req = reqModule.request({
                hostname: url.hostname,
                port: url.port || (isHttps ? 443 : 80),
                path: url.pathname,
                method: 'POST',
                headers,
                rejectUnauthorized: false,
            }, (res) => {
                res.resume();
                resolve();
            });
            req.on('error', () => {
                // Re-queue events on failure (up to 500)
                _eventQueue.unshift(...batch.slice(0, 500 - _eventQueue.length));
                resolve();
            });
            req.write(payload);
            req.end();
        });
    }
    catch {
        // Re-queue on failure
        _eventQueue.unshift(...batch.slice(0, 500 - _eventQueue.length));
    }
}
function disposeLocTracker() {
    if (_flushTimer) {
        clearInterval(_flushTimer);
        _flushTimer = null;
    }
    // Final flush
    flushEvents();
}
function detectLanguage(filePath) {
    const ext = filePath.split('.').pop()?.toLowerCase() || '';
    const map = {
        py: 'Python', js: 'JavaScript', ts: 'TypeScript',
        tsx: 'TypeScript', jsx: 'JavaScript', go: 'Go',
        rs: 'Rust', java: 'Java', rb: 'Ruby', vue: 'Vue',
        svelte: 'Svelte', css: 'CSS', html: 'HTML',
        sh: 'Shell', yaml: 'YAML', yml: 'YAML',
        json: 'JSON', md: 'Markdown', sql: 'SQL',
    };
    return map[ext] || ext.toUpperCase() || 'Unknown';
}
//# sourceMappingURL=locTracker.js.map