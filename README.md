<div align="center">

# Resonant IDE

### The AI-Native Development Environment by Resonant Genesis

**Built entirely by AI, orchestrated by [Louie Nemesh](https://dev-swat.com)**

[![License: RG Source Available](https://img.shields.io/badge/License-RG%20Source%20Available-blue.svg)](LICENSE.txt)
[![Platform](https://img.shields.io/badge/Platform-dev--swat.com-purple.svg)](https://dev-swat.com)

[Manual Install](#getting-started) · [Documentation](https://dev-swat.com/docs) · [Platform](https://dev-swat.com) · [Report Issue](https://dev-swat.com/feedback)

</div>

---

## What is Resonant IDE?

**Resonant IDE** is a full-featured AI-native code editor built on the VS Code Open Source foundation, deeply integrated with the **Resonant Genesis** AI governance platform. Unlike traditional editors that bolt on AI as an afterthought, Resonant IDE was designed from the ground up with AI at its core — every feature, every tool, every workflow is AI-first.

This is not a wrapper. This is not a plugin. This is a **complete development environment** where the AI assistant has the same capabilities as you: it reads your files, runs your commands, searches your codebase, manages your git, edits your notebooks, browses the web, and deploys your code — all through a governed, auditable, identity-bound execution pipeline.

### Screenshots

<div align="center">

**AI Chat + Editor + Terminal — Unified Workspace**

![Resonant IDE Interface](docs/screenshots/interface.png)

**11 AI Providers with BYOK (Bring Your Own Key)**

![AI Providers & BYOK Settings](docs/screenshots/ai-providers.png)

**Configurable Max Tool Loops — Up to Unlimited**

![Settings — Max Tool Loops](docs/screenshots/settings-loops.png)

</div>

### Key Differentiators

| Feature | Resonant IDE | Traditional Editors | AI Wrappers |
|---------|-------------|-------------------|-------------|
| **Native AI Agent** | Built-in agentic loop with 59+ tools | Separate extension/plugin | Chat-only, no tools |
| **Local + Cloud AI** | Ollama, LM Studio, OpenAI, Anthropic, Groq | Cloud-only or local-only | Single provider |
| **SAST & Architecture** | AST analysis, dependency graphs, SAST, full-stack mapping | Basic search | No analysis |
| **Platform Identity** | DSID (Decentralized Semantic ID) per user | Username/password | API key |
| **Memory System** | Hash Sphere persistent memory across sessions | No memory | Chat history only |
| **Tool Execution** | 59 local tools + 433 platform API endpoints | Limited extensions | Sandboxed/limited |
| **Governed Execution** | Pre-execution policies, trust tiers, audit trails | No governance | No governance |

---

## Architecture

Resonant IDE uses a **thin client + server orchestration** model. The desktop app handles UI rendering, authentication, local LLM discovery, and tool execution. All AI orchestration intelligence (system prompts, tool selection, agentic loop, LLM provider routing) runs server-side in `RG_Axtention_IDE`.

```
┌──────────────────────────────────────┐      ┌──────────────────────────────────┐
│     Resonant IDE (Electron Client)   │      │    RG_Axtention_IDE (Server)     │
│                                      │      │                                  │
│  ┌────────────┐  ┌────────────────┐  │      │  ┌──────────────────────────────┐│
│  │ VS Code    │  │ Resonant AI    │  │ SSE  │  │  Agentic Loop Engine         ││
│  │ Core       │  │ Extension      │◄─┼──────┼──│  - System prompt (protected) ││
│  │ (Editor,   │  │                │  │      │  │  - Smart tool selection      ││
│  │  Terminal, │  │ Responsibilities│  │      │  │  - LLM calls (multi-prov)   ││
│  │  Debug)    │  │ ─────────────  │──┼──────┼─►│  - Message history mgmt     ││
│  │            │  │ • Auth (JWT)   │  │ POST │  │  - Retry + rate limiting    ││
│  │            │  │ • UI rendering │  │      │  │  - BYOK key resolution      ││
│  │            │  │ • Tool executor│  │      │  └──────────────────────────────┘│
│  │            │  │ • LLM discovery│  │      │                                  │
│  │            │  │   (Ollama)     │  │      │  ┌──────────────────────────────┐│
│  └────────────┘  └────────────────┘  │      │  │  59 Tool Definitions         ││
│                                      │      │  │  (never leave the server)    ││
│  NO orchestration intelligence       │      │  └──────────────────────────────┘│
│  NO system prompts                   │      │                                  │
│  NO tool definitions                 │      │  Providers: Groq, OpenAI,        │
│  (this repo is public)               │      │  Anthropic, Google, DeepSeek,    │
│                                      │      │  Mistral + user BYOK keys        │
└──────────────────────────────────────┘      └─────────────┬────────────────────┘
                                                            │
                                                            ▼
                                              ┌──────────────────────────┐
                                              │  Resonant Genesis Cloud   │
                                              │  (30+ microservices)      │
                                              │                           │
                                              │  Gateway → Auth → Chat    │
                                              │  Agents → Memory → Billing│
                                              │  Blockchain → Marketplace │
                                              └──────────────────────────┘
```

### How It Works

1. User sends a prompt in the IDE chat
2. Client POSTs to server via `/api/v1/ide/agent-stream`
3. Server selects tools, builds system prompt, calls LLM
4. Server streams SSE events: `thinking`, `text`, `execute_tool`, `stats`, `done`
5. On `execute_tool` → client runs the tool locally → POSTs result back
6. Server resumes agentic loop → calls LLM again → repeat until done
7. For local Ollama: client sends `local_llm` config, server proxies the call

### Extension Source Files (`extensions/resonant-ai/src/`)

| File | Purpose | Lines |
|------|---------|-------|
| `extension.ts` | Main entry point — SSE client, tool dispatch, auth wiring | ~800 |
| `toolExecutor.ts` | All 59 tool implementations — file I/O, git, web, deploy, etc. | ~2,300 |
| `toolDefinitions.ts` | Local tool schemas (for Ollama fallback) | ~200 |
| `languageModelProvider.ts` | Multi-provider LLM discovery (cloud + local) | ~600 |
| `localLLMProvider.ts` | Ollama/LM Studio/llama.cpp local model discovery | ~300 |
| `chatViewProvider.ts` | Sidebar webview chat UI with streaming | ~900 |
| `authProvider.ts` | VS Code AuthenticationProvider for Resonant Genesis | ~180 |
| `authService.ts` | Token management, refresh, DSID binding | ~280 |
| `interactiveTerminal.ts` | Persistent terminal sessions with I/O capture | ~300 |
| `inlineCompletionProvider.ts` | Ghost text code completions (FIM) | ~190 |
| `locTracker.ts` | Lines-of-code tracking per session | ~160 |
| `updateChecker.ts` | Auto-update system with release notes | ~160 |
| `settingsPanel.ts` | Full settings webview panel | ~700 |
| `profileWebview.ts` | User profile and account management | ~250 |
| `agentProvider.ts` | VS Code Chat Participant integration | ~190 |

> **Note:** Tool definitions and orchestration intelligence (system prompts, tool selection algorithm) live server-side in [`RG_Axtention_IDE`](https://github.com/DevSwat-ResonantGenesis/RG_Axtention_IDE) (private repo). This client repo is public and contains no proprietary AI logic.

---

## 59 Tools (11 Categories)

Tool **definitions** and **selection** are managed server-side. Tool **execution** happens locally on your machine — the AI can read your files, run your commands, and manage your git without any code leaving your machine unless you explicitly share it.

### Core (12 tools)
`file_read` · `file_write` · `file_edit` · `multi_edit` · `file_list` · `file_delete` · `file_move` · `grep_search` · `find_by_name` · `run_command` · `command_status` · `read_terminal`

### Git (7 tools)
`git_status` · `git_diff` · `git_log` · `git_commit` · `git_push` · `git_pull` · `git_branch`

### Web (6 tools)
`search_web` · `read_url_content` · `view_content_chunk` · `browser_check` · `browser_preview` · `read_browser_logs`

### Codebase Intelligence (8 tools)
`code_visualizer_scan` · `code_visualizer_functions` · `code_visualizer_trace` · `code_visualizer_governance` · `code_visualizer_graph` · `code_visualizer_pipeline` · `code_visualizer_filter` · `code_visualizer_by_type`

### Interactive Terminal (8 tools)
`terminal_create` · `terminal_send` · `terminal_send_raw` · `terminal_read` · `terminal_wait` · `terminal_list` · `terminal_close` · `terminal_clear`

### Planning & Memory (6 tools)
`todo_list` · `ask_user` · `save_memory` · `read_memory` · `create_memory` · `code_search`

### Notebooks (2 tools)
`notebook_read` · `notebook_edit`

### Platform API (2 tools)
`platform_api_search` · `platform_api_call` — access to **433 backend endpoints** across 17 services

### Deploy (2 tools)
`ssh_run` · `deploy_web_app`

### Trajectory (1 tool)
`trajectory_search` — semantic search over conversation history

### Inline Completions
Real-time ghost text code suggestions via FIM (Fill-in-the-Middle) across 30+ languages.

---

## Supported AI Providers

### Cloud Providers (via Resonant Genesis Platform)
- **OpenAI** — GPT-4o, GPT-4o-mini
- **Anthropic** — Claude 3.5 Sonnet, Claude 3 Opus
- **Groq** — Llama 3.3 70B (ultra-fast inference)
- **Google** — Gemini Pro, Gemini Flash
- **BYOK** — Bring Your Own Key for any provider

### Local Providers (Zero Internet Required)
- **Ollama** — Any model (llama3.1, codellama, deepseek-coder, qwen2.5-coder, etc.)
- **LM Studio** — OpenAI-compatible API
- **llama.cpp** — Direct server connection
- **LocalAI** — Multi-model local server
- **vLLM** — High-performance local inference

### Provider Selection
The AI automatically selects the best available provider, or you can manually choose via the model picker. BYOK users get priority routing to their preferred provider.

---

## SAST, Dependency Analysis & Full-Stack Architecture Engine

The built-in analysis engine performs deep static analysis locally — **no code leaves your machine**:

- **SAST (Static Application Security Testing)** — Security vulnerability scanning, forbidden dependency checks, architecture drift scoring (0-100)
- **AST Parsing** — Full abstract syntax tree analysis for Python, JavaScript, TypeScript
- **Dependency Graphs** — Import chains, call graphs, service-to-service dependency mapping
- **Full-Stack Architecture Mapping** — Auto-discovers microservice boundaries, API routes, data flows, and inter-service communication patterns
- **Dead Code Detection** — Unreachable functions, unused imports, orphaned files
- **Pipeline Auto-Detection** — Discovers user_registration, login, chat_flow, billing, agent_execution pipelines across the full stack
- **Governance Enforcement** — Policy validation, trust-tier compliance, execution boundary checks
- **Multi-Repo Comparison** — Cross-repository analysis and change detection
- **Graph Janitor** — Health scoring with actionable remediation suggestions

---

## Memory & Identity

### Hash Sphere Memory
Every conversation, every code change, every decision is optionally stored in the **Hash Sphere** — a deterministic hashing system that maps content to 3D coordinates for semantic retrieval. Memories persist across sessions and sync to the cloud when authenticated.

### Decentralized Semantic Identity (DSID)
Your identity is cryptographically bound to the Ethereum Base Sepolia L2 blockchain. Every action in the IDE is traceable to your verified identity, creating an immutable audit trail of your development activity.

---

## Getting Started

### Prerequisites
- **Node.js** 22.x or later (22.22.0 recommended — see `.nvmrc`)
- **npm** 10.x or later
- **Python** 3.10+ (for native module compilation and SAST analysis)
- **Xcode Command Line Tools** (macOS) or **build-essential** (Linux) — required for native modules
- A free account at [dev-swat.com](https://dev-swat.com) (required for AI features)

### Build from Source

```bash
# Clone
git clone https://github.com/DevSwat-ResonantGenesis/RG_IDE.git
cd RG_IDE

# Install dependencies (takes 2-5 minutes)
npm install

# Build the Resonant AI extension
cd extensions/resonant-ai && npm install && npx tsc -p tsconfig.json && cd ../..

# Compile the full IDE (takes ~2 minutes)
npm run compile

# Launch Resonant IDE
./scripts/code.sh
```

The `scripts/code.sh` launcher will:
1. Download the correct Electron binary (first run only)
2. Verify compilation output exists
3. Sync built-in extensions
4. Launch the IDE

### Troubleshooting

**"Cannot find module out/main.js"**
The TypeScript compilation didn't run or failed. Fix:
```bash
rm -rf out
npm run compile
./scripts/code.sh
```

**Compilation fails with errors**
Ensure you have the correct Node.js version:
```bash
node --version  # Should be v22.x
```

**npm warnings about "Unknown project config"**
These are cosmetic warnings from npm 10+/11+ about `.npmrc` keys (`disturl`, `target`, `runtime`, etc.). These keys are **required** by the build system — do not remove them. The warnings are harmless and do not affect the build.

**Native module build failures**
Ensure you have C++ build tools installed:
```bash
# macOS
xcode-select --install

# Ubuntu/Debian
sudo apt install build-essential python3
```

> **Note:** Resonant IDE is currently available as a manual build from source. Pre-built binaries (.dmg, .AppImage, .exe) are coming soon. A registered account at [dev-swat.com](https://dev-swat.com/signup) is required to use the AI assistant and platform features.

---

## Platform Integration

Resonant IDE connects to the **Resonant Genesis** platform — a governed execution system for AI agents with 30+ microservices:

| Service | What It Does |
|---------|-------------|
| **Gateway** | API routing, auth verification, rate limiting |
| **Auth Service** | JWT tokens, OAuth2, 2FA, DSID binding |
| **Chat Service** | Multi-provider AI routing, skills, streaming |
| **Agent Engine** | Autonomous agent execution, planning, tools |
| **Memory Service** | Hash Sphere storage, semantic retrieval |
| **Blockchain Node** | Base Sepolia identity registry, memory anchors |
| **SAST & Architecture Engine** | AST analysis, SAST, dependency mapping, pipeline detection |
| **Billing Service** | Credits, Stripe, usage tracking |
| **Marketplace** | Agent templates, extensions, publishing |
| **IDE Service** | LOC tracking, updates, analytics |

### 433 Platform API Endpoints

The `platform_api_search` and `platform_api_call` tools give the AI direct access to the entire platform API — create agents, manage teams, query memories, interact with blockchain, publish to marketplace, and more.

---

## Contributing

We welcome contributions! Please read our [Contributing Guide](CONTRIBUTING.md) before submitting pull requests.

### How to Contribute

1. **Fork** this repository
2. **Create** a feature branch: `git checkout -b feature/my-feature`
3. **Make** your changes
4. **Test** locally: build and run the IDE
5. **Submit** a pull request

### Contribution Areas

- **AI Tools** — Add new tools in `extensions/resonant-ai/src/toolDefinitions.ts` and `toolExecutor.ts`
- **Language Support** — Improve inline completions for specific languages
- **Local LLM** — Add support for new local inference servers
- **SAST & Architecture** — Extend analysis to new languages, add security rules
- **UI/UX** — Improve the chat interface, settings panel, profile page
- **Documentation** — Improve docs, add tutorials, fix typos

---

## About the Creator

**Resonant IDE** and the entire **Resonant Genesis** platform were built by **Louie Nemesh** — an AI architect who started this project on **November 11, 2025** with a singular vision: to build the world's most comprehensive AI governance platform.

**Every single line of code was written by AI**, orchestrated and directed by Louie as the sole human architect. No team of developers. No outsourced contractors. One person directing AI to build an enterprise-grade platform with 30+ microservices, blockchain integration, a full IDE, and a marketplace — proving that the future of software development is human-AI collaboration at its finest.

> *"I didn't write a single line of code myself. I architected, I directed, I made every decision — but the code was written by AI. This is what the future looks like."*
> — Louie Nemesh, Founder & AI Architect

### The Numbers

- **30+** production microservices
- **433** API endpoints
- **137** AI tools across the platform
- **59** local IDE tools
- **53** React UI components
- **4** AI providers (OpenAI, Anthropic, Groq, Google)
- **3** smart contracts on Base Sepolia (Ethereum L2)
- **1** human architect
- **0** lines of human-written code

---

## Links

- **Platform**: [dev-swat.com](https://dev-swat.com)
- **AI Portal**: [resonantgenesis.ai](https://resonantgenesis.ai)
- **GitHub**: [github.com/DevSwat-ResonantGenesis](https://github.com/DevSwat-ResonantGenesis)
- **Feedback**: [dev-swat.com/feedback](https://dev-swat.com/feedback)
- **Documentation**: [dev-swat.com/docs](https://dev-swat.com/docs)

---

## License

Copyright (c) 2025-2026 Resonant Genesis / DevSwat. Founded and built by Louie Nemesh.

Licensed under the [Resonant Genesis Source Available License](LICENSE.txt).

- **View & study**: Free for everyone
- **Download & use**: Free with [platform registration](https://dev-swat.com/signup)
- **Contribute**: Pull requests welcome
- **Commercial use**: [Contact us](https://dev-swat.com/contact)

This project is built on the [VS Code Open Source](https://github.com/microsoft/vscode) foundation (MIT licensed). The Resonant AI extension and all Resonant Genesis-specific modifications are covered by the Resonant Genesis Source Available License.

---

<div align="center">

**Built on Resonant Genesis technology by Louie Nemesh**

*The future of development is AI-native.*

</div>
