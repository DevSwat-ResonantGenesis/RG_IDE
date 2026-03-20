# Resonant IDE

**The open-source AI-native code editor by [Resonant Genesis](https://dev-swat.com)**

Resonant IDE is a full VS Code fork with a built-in autonomous coding agent. It connects to the Resonant Genesis platform for cloud-powered AI assistance, or runs fully offline with a local LLM via Ollama.

> **Thin-client architecture:** All orchestration intelligence (system prompts, tool definitions, tool selection, retry logic) lives server-side in [`RG_Axtention_IDE`](https://github.com/DevSwat-ResonantGenesis/RG_Axtention_IDE). The IDE itself is a lightweight client that renders UI and executes tools locally on your machine. No proprietary logic is exposed in the client.

---

## Architecture

```
Your Machine (Resonant IDE)                 Resonant Genesis Cloud
┌─────────────────────────────┐            ┌──────────────────────────────┐
│  Thin client:               │ SSE stream │  ide_agent_service:          │
│  - Full VS Code editor      │◄──────────│  - System prompt             │
│  - Chat panel (built-in)    │            │  - Tool definitions          │
│  - Local tool executor      │            │  - Tool selection logic      │
│  - Inline completions       │────────────►  - LLM calls (6 providers)  │
│  - LOC tracking             │ tool results│  - BYOK key resolution      │
│  - Profile / settings UI    │            │  - Message history           │
│                             │            │  - Credit deduction          │
│  NO orchestration code      │            └──────────────────────────────┘
│  NO tool definitions        │
│  NO system prompts          │            ┌──────────────────────────────┐
│  Login required for cloud   │            │  OR: Local LLM (Ollama)     │
│  Ollama works without login │            │  - Fully offline             │
└─────────────────────────────┘            │  - No account needed         │
                                           │  - Free, unlimited           │
                                           └──────────────────────────────┘
```

---

## Features

### AI Chat Agent
- **Autonomous coding agent** in the built-in Chat panel — reads, writes, edits, searches, and runs commands
- **Server-side agentic loop** — the server decides which tools to call, the IDE executes them locally
- **Multi-loop execution** — up to 15 loops per request (configurable, or unlimited with `0`)
- **Rich tool UI** — shows diffs, command output, file operations inline in chat
- **Session metrics** — tool calls, loops, tokens, elapsed time, LOC written/edited

### Inline Completions (Ghost Text)
- Copilot-style code completions as you type
- Uses the same LLM provider selected in the model picker
- Toggle on/off via command palette: `Resonant AI: Toggle Inline Completions`

### Multi-Provider LLM Support
Choose your provider from the VS Code model picker:

| Provider | Models | Notes |
|----------|--------|-------|
| **Groq** | Llama 3.3 70B, Mixtral, Gemma 2 | Default — fastest inference |
| **OpenAI** | GPT-4o, GPT-4o-mini, o1, o3-mini | Best for complex reasoning |
| **Anthropic** | Claude Sonnet 4, Claude Haiku | Best for code generation |
| **Google** | Gemini 2.0 Flash, Gemini Pro | Lowest credit cost |
| **DeepSeek** | DeepSeek Chat, DeepSeek Coder | Strong code model |
| **Mistral** | Mistral Large, Codestral | European provider |
| **Ollama** (local) | Any model you pull | Free, fully offline |

### Bring Your Own Key (BYOK)
- Add your own API keys on the [platform dashboard](https://dev-swat.com/settings) under **API Keys**
- When BYOK keys are set, the platform uses YOUR key — **zero credit cost**
- Supports: OpenAI, Anthropic, Groq, Google, DeepSeek, Mistral

### Local LLM (Ollama)
Run AI completely offline with no account required:
1. Install [Ollama](https://ollama.com)
2. Pull a model: `ollama pull llama3.1:8b`
3. Start Ollama: `ollama serve`
4. In Resonant IDE: Settings → search `resonant.localLLM.enabled` → enable
5. Select a local model from the Chat model picker

**Local LLM features:**
- Full agentic loop runs locally (no server needed)
- All tools available: file read/write/edit, search, terminal, etc.
- Configurable context length (default: 32K tokens)
- Custom Ollama URL if running on a different host

### User Agents
- Create custom AI agents on the platform with specialized system prompts
- Agents appear as chat participants in the IDE
- Each agent can have its own tools, personality, and constraints

---

## Credit System

Resonant IDE uses a credit-based billing system. **1 credit ≈ $0.001** (1,000 credits = $1).

### Free Tier
Every new account receives **1,000 free credits** — enough for ~50 chat messages or ~10 agentic coding sessions.

### How Credits Are Deducted

Credits are deducted **per LLM call** based on actual token usage:

| Cost Component | Rate |
|----------------|------|
| **Input tokens** | 10 credits per 1K tokens |
| **Output tokens** | 30 credits per 1K tokens |
| **Minimum per request** | 1 credit |

**Provider multipliers** (applied to token costs):

| Provider | Multiplier | Effective cost |
|----------|-----------|----------------|
| Google / Gemini | 0.8x | Cheapest cloud option |
| Groq | 0.5x | Budget-friendly, fast |
| OpenAI | 1.0x | Standard rate |
| Anthropic | 1.2x | Premium for Claude |
| Local (Ollama) | 0.1x | Near-zero (only if routed through platform) |
| **BYOK** | **0x** | **Free — your own key** |

**Agent execution costs:**

| Action | Credits |
|--------|---------|
| Agent session start | 100 |
| Each agent step/loop | 500 |
| Tool invocation | 200 |
| Web search call | 300 |
| Memory write | 50 |

**Typical session costs:**
- Simple Q&A (1 loop, ~2K tokens): **~5-20 credits**
- Code edit task (3-5 loops, ~8K tokens): **~50-150 credits**
- Complex refactor (10+ loops, ~20K tokens): **~200-500 credits**

### Plans

| Plan | Price | Included Credits | Key Limits |
|------|-------|-----------------|------------|
| **Developer** (free) | $0/mo | 1,000 | 3 agents, 100 msg/day |
| **Plus** | $4.99/mo | 499,000 | 20 agents, autonomous mode, rollover |
| **Enterprise** | Custom | Unlimited | Unlimited everything |

### Credit Packs (Top-ups)

| Pack | Credits | Price | Per 1K |
|------|---------|-------|--------|
| Starter | 5,000 | $5 | $1.00 |
| Basic | 10,000 | $8 | $0.80 |
| Growth | 50,000 | $35 | $0.70 |
| Scale | 100,000 | $60 | $0.60 |
| Enterprise | 500,000 | $250 | $0.50 |

---

## Installation

### Download Pre-built (Recommended)
1. Download the latest `.dmg` (macOS) from [Releases](https://github.com/DevSwat-ResonantGenesis/RG_IDE/releases)
2. Drag **Resonant IDE** to Applications
3. Open Resonant IDE
4. Sign in via command palette: `Resonant AI: Sign In`

### Build from Source

**Prerequisites:**
- Node.js 18+
- Python 3.10+ (for native module builds)
- Git
- macOS, Linux, or Windows

```bash
# Clone the repo
git clone https://github.com/DevSwat-ResonantGenesis/RG_IDE.git
cd RG_IDE

# Install dependencies
npm install

# Build
npm run compile

# Run in development mode
./scripts/code.sh
```

For a production build:
```bash
npm run gulp vscode-darwin-arm64  # macOS Apple Silicon
npm run gulp vscode-darwin-x64    # macOS Intel
npm run gulp vscode-linux-x64     # Linux
npm run gulp vscode-win32-x64     # Windows
```

---

## Getting Started

### 1. Sign In
- Open command palette (`Cmd+Shift+P` / `Ctrl+Shift+P`)
- Run `Resonant AI: Sign In`
- Or click the Resonant AI status bar icon

### 2. Register an Account
- Visit [dev-swat.com/signup](https://dev-swat.com/signup)
- Sign up with email or GitHub OAuth
- Your 1,000 free credits are available immediately

### 3. Start Coding with AI
- Open a project folder (`File → Open Folder`)
- Open the Chat panel (`Cmd+Shift+I` or click the chat icon)
- Select a model from the picker dropdown
- Ask the AI to do anything: edit files, search code, run commands, debug

### 4. Set Up BYOK (Optional)
- Go to [dev-swat.com/settings](https://dev-swat.com/settings) → **API Keys**
- Add your OpenAI, Anthropic, or Groq key
- The IDE will automatically use your key — no credits deducted

### 5. Set Up Local LLM (Optional)
- Install Ollama: `brew install ollama` (macOS) or [ollama.com](https://ollama.com)
- Pull a model: `ollama pull llama3.1:8b` (or `qwen2.5-coder:14b` for coding)
- In IDE settings, enable `resonant.localLLM.enabled`
- No account needed — fully offline

---

## Available Tools

When the AI agent runs, it can use these tools (executed locally on your machine):

| Tool | Description |
|------|-------------|
| `file_read` | Read file contents (with line range) |
| `file_write` | Create or overwrite files |
| `file_edit` | Find-and-replace edits in files |
| `multi_edit` | Multiple edits in one file atomically |
| `file_list` | List directory contents |
| `file_delete` | Delete files |
| `file_move` | Move/rename files |
| `grep_search` | Regex search across files (ripgrep) |
| `find_by_name` | Find files by name pattern |
| `code_search` | Semantic code search |
| `run_command` | Execute shell commands |
| `search_web` | Search the web |
| `ssh_run` | Run commands on remote servers |
| `terminal_*` | Interactive terminal sessions |
| `code_visualizer_*` | Codebase analysis and visualization |

---

## Settings

All settings are under the `resonant` namespace in VS Code settings:

| Setting | Default | Description |
|---------|---------|-------------|
| `resonant.apiUrl` | `https://dev-swat.com` | Platform API URL |
| `resonant.maxToolLoops` | `15` | Max agentic loops per request (0 = unlimited) |
| `resonant.inlineCompletions` | `true` | Enable ghost-text completions |
| `resonant.localLLM.enabled` | `false` | Enable Ollama local LLM |
| `resonant.localLLM.url` | `http://localhost:11434` | Ollama server URL |
| `resonant.localLLM.model` | `llama3.1:8b` | Default local model |
| `resonant.localLLM.contextLength` | `32768` | Context window size |

---

## Commands

Available from the command palette (`Cmd+Shift+P`):

| Command | Description |
|---------|-------------|
| `Resonant AI: Sign In` | Authenticate with the platform |
| `Resonant AI: Sign Out` | Log out |
| `Resonant AI: Set API Key` | Manually enter JWT or API key |
| `Resonant AI: Open Chat` | Open the AI chat panel |
| `Resonant AI: New Conversation` | Start a fresh chat |
| `Resonant AI: Open Profile` | View account info and usage |
| `Resonant AI: Open Settings` | Open the Resonant settings panel |
| `Resonant AI: Refresh Providers` | Re-fetch available models and agents |
| `Resonant AI: Toggle Inline Completions` | Turn ghost-text on/off |
| `Resonant AI: Test Local Connection` | Test Ollama connectivity |
| `Resonant AI: List Local Models` | Browse and select Ollama models |
| `Resonant AI: Toggle Local LLM` | Enable/disable local LLM mode |

---

## Contributing

We welcome contributions! Resonant IDE is based on VS Code (MIT License) with the Resonant AI extension.

### Development Setup

```bash
# Clone
git clone https://github.com/DevSwat-ResonantGenesis/RG_IDE.git
cd RG_IDE

# Install all dependencies
npm install

# Build the extension
cd extensions/resonant-ai
npm install
npm run compile
cd ../..

# Launch in dev mode
./scripts/code.sh
```

### Project Structure

```
RG_IDE/
├── extensions/
│   └── resonant-ai/          # The AI extension
│       └── src/
│           └── extension.ts   # Main entry point (thin client)
├── src/                       # VS Code core source
├── build/                     # Build scripts
├── resources/                 # App icons, branding
├── cli/                       # CLI tooling
└── scripts/
    └── code.sh                # Dev launch script
```

### Key Files
- **`extensions/resonant-ai/src/extension.ts`** — Main extension: registers chat participant, handles SSE agent loop, local LLM loop, tool execution, UI rendering
- **`extensions/resonant-ai/src/toolExecutor.ts`** — Local tool implementations (file ops, grep, terminal)
- **`extensions/resonant-ai/src/localLLMProvider.ts`** — Ollama integration
- **`extensions/resonant-ai/src/languageModelProvider.ts`** — VS Code Language Model Provider (model picker)
- **`extensions/resonant-ai/src/authService.ts`** — Authentication and token management
- **`extensions/resonant-ai/src/inlineCompletionProvider.ts`** — Ghost-text inline completions
- **`extensions/resonant-ai/src/locTracker.ts`** — Lines-of-code tracking per session

### Coding Guidelines
- The extension is a **thin client** — no orchestration logic, no system prompts, no tool definitions
- All cloud intelligence lives in [RG_Axtention_IDE](https://github.com/DevSwat-ResonantGenesis/RG_Axtention_IDE) (server-side)
- Local LLM path is the only exception — it runs a full local agentic loop with tool definitions
- Use TypeScript strict mode
- Follow existing code style (no semicolons optional — match the file you're editing)

### Submitting Changes
1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes
4. Test locally: `./scripts/code.sh`
5. Commit with a descriptive message: `git commit -m "feat: add X"`
6. Push and open a Pull Request

---

## Related Repositories

| Repo | Description |
|------|-------------|
| [RG_Axtention_IDE](https://github.com/DevSwat-ResonantGenesis/RG_Axtention_IDE) | Server-side agentic orchestration (Python/FastAPI) |
| [RG_IDE_Platform](https://github.com/DevSwat-ResonantGenesis/RG_IDE_Platform) | IDE platform services (LSP, terminal, preview) |
| [RG_Gateway](https://github.com/DevSwat-ResonantGenesis/RG_Gateway) | API gateway routing |
| [RG_Auth](https://github.com/DevSwat-ResonantGenesis/RG_Auth) | Authentication service |
| [RG_Billing](https://github.com/DevSwat-ResonantGenesis/RG_Billing) | Credit system and billing |

---

## License

Resonant IDE is based on [VS Code](https://github.com/microsoft/vscode) (MIT License).
The Resonant AI extension and platform integration are proprietary to Resonant Genesis.

See [LICENSE](LICENSE) for details.