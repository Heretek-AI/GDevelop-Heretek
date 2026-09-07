![GDevelop banner](https://raw.githubusercontent.com/4ian/GDevelop/master/newIDE/GDevelop%20banner.png "GDevelop banner")

# GDevelop (BYOK Edition) 🚀

[![GitHub Release](https://img.shields.io/github/v/release/Heretek-AI/GDevelop-Heretek?include_prereleases&color=blue&label=Release)](https://github.com/Heretek-AI/GDevelop-Heretek/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)
[![Upstream Sync](https://img.shields.io/badge/Upstream%20Sync-4ian%2FGDevelop-blueviolet)](https://github.com/4ian/GDevelop)
[![Local AI: Ollama / LM Studio](https://img.shields.io/badge/Local%20AI-Ollama%20%7C%20LM%20Studio-orange)](https://github.com/Heretek-AI/GDevelop-Heretek#quick-start-guides)
[![No Watermark](https://img.shields.io/badge/Branding-No%20Watermark-success)](https://github.com/Heretek-AI/GDevelop-Heretek#unlocked-client-side-features)

> **The open-source 2D, 3D, and multiplayer game engine with Bring Your Own Key (BYOK) AI, Local LLMs (Ollama, LM Studio, DeepSeek), unlocked offline features, and seamless in-app auto-updates.**

---

## 🌟 Why GDevelop (BYOK Edition)?

GDevelop is a powerful, no-code, open-source game engine. **GDevelop (BYOK Edition)** enhances the engine with complete AI freedom, local model support, and unlocks all client-side features without artificial subscription paywalls:

### 🤖 1. Bring Your Own Key (BYOK) AI Agent
- **Zero Subscription Limits**: Generate games, scenes, objects, behaviors, and event logic using your own AI keys or local models.
- **Provider Agnostic**: Connect to **Ollama**, **LM Studio**, **OpenAI** (GPT-4o, o3-mini), **OpenRouter** (Claude 3.5 Sonnet, DeepSeek R1), **Azure OpenAI**, **Groq**, **DeepSeek**, **vLLM**, or any OpenAI-compatible API.
- **Full Autonomous Capabilities**: The AI Agent can inspect scene trees, create 2D/3D objects, configure physics and platformer behaviors, write event sheets, and execute sandboxed code.
- **Privacy-First & Secure**: API keys are kept in session memory only and never written in cleartext to `localStorage`.

<<<<<<< HEAD
### 🔓 2. Unlocked Client-Side & Offline Features
- **No Watermark & Custom Splash Screen**: Freely disable the GDevelop startup splash logo and in-game watermark in exported games.
- **0-Second Instant Startup**: Removed artificial loading screen delay clamps—exported games start immediately.
- **Live Preview Hot Reloading**: Unlocked real-time live preview code and scene updates without periodic paywall interruptions.
- **Network Preview (Over Wi-Fi/LAN)**: Test your games across your local network and on mobile devices (phones/tablets).
- **Advanced In-Game Debugger**: Full access to memory profiler, variable inspector, pause, and step execution.
- **Creator Profile Customization**: Custom bio, social links, and Discord role perks unlocked for all users.
=======
- Find GDevelop games on [gd.games](https://gd.games), the gaming platform for games powered by GDevelop.
- See the [showcase of games](https://gdevelop.io/games) created with GDevelop and published on Steam, iOS (App Store), Android (Google Play), Itch.io, Newgrounds, CrazyGames, Poki...
>>>>>>> upstream/master

### 🔄 3. In-App Background Auto-Updater
- Desktop builds automatically check for updates against [Heretek-AI/GDevelop-Heretek Releases](https://github.com/Heretek-AI/GDevelop-Heretek/releases).
- Downloads updates in the background and prompts to restart when a new version is available.

### 🛡️ 4. Upstream Synchronized & Secure
- Continuously synchronized with upstream [4ian/GDevelop](https://github.com/4ian/GDevelop).
- Automated PR-only sync workflow with workflow locking to protect against supply-chain attacks (e.g. Shai-Hulud).

---

## ⚡ Quick Start Guides

### 🦙 A. Local AI with Ollama (100% Free & Offline)

1. **Install and run Ollama**:
   ```bash
   # Enable CORS for GDevelop
   OLLAMA_ORIGINS="*" ollama serve
   ```
2. **Pull a recommended coding model**:
   ```bash
   ollama pull qwen2.5-coder
   ```
3. **Configure in GDevelop**:
   - Open **Preferences (Ctrl+, or ⚙️)** $\rightarrow$ **Custom / Local AI Endpoint (BYOK)**.
   - Toggle **Enable Custom / Local AI Endpoint**.
   - Set **Base URL**: `http://localhost:11434/v1`
   - Set **Model Name**: `qwen2.5-coder` (or `llama3.2`, `mistral`, `deepseek-r1`)
   - Click **Test Connection** $\rightarrow$ Start building!

---

### 🧪 B. Local AI with LM Studio

1. Open **LM Studio** and download your model of choice (e.g. `Qwen 2.5 Coder 7B/14B` or `DeepSeek-Coder`).
2. Go to the **Local Server** tab (`<->`), set **Cross-Origin-Resource-Sharing (CORS)** to `ON`, and click **Start Server**.
3. In GDevelop Preferences:
   - Set **Base URL**: `http://localhost:1234/v1`
   - Set **Model Name**: Enter the identifier shown in LM Studio (or leave default).
   - Click **Test Connection**.

---

### 🌐 C. Cloud Providers (OpenRouter / DeepSeek / OpenAI / Groq)

| Provider | Base URL | Recommended Models |
| :--- | :--- | :--- |
| **OpenRouter** | `https://openrouter.ai/api/v1` | `anthropic/claude-3.5-sonnet`, `deepseek/deepseek-r1` |
| **DeepSeek** | `https://api.deepseek.com/v1` | `deepseek-chat`, `deepseek-reasoner` |
| **OpenAI** | `https://api.openai.com/v1` | `gpt-4o`, `gpt-4o-mini`, `o3-mini` |
| **Groq** | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile`, `qwen-2.5-coder-32b` |

1. In GDevelop Preferences, paste your **API Key** and **Base URL**.
2. Enter your desired **Model Name**.
3. Click **Test Connection**.

---

## 📊 Feature Comparison

| Feature | Upstream GDevelop (Free) | Upstream GDevelop (Subscribed) | **GDevelop (BYOK Edition)** |
| :--- | :---: | :---: | :---: |
| **AI Assistant & Game Creator** | ❌ Limited Credits / Day | ⚠️ Monthly Credit Quota | **✅ Unlimited (Local AI & BYOK)** |
| **Local LLMs (Ollama, LM Studio)** | ❌ Not Supported | ❌ Not Supported | **✅ 100% Free & Offline** |
| **Remove GDevelop Startup Logo** | ❌ Locked | ✅ Silver / Gold ($) | **✅ 100% Free & Unlocked** |
| **Remove GDevelop Watermark** | ❌ Locked | ✅ Silver / Gold ($) | **✅ 100% Free & Unlocked** |
| **0s Instant Splash Duration** | ❌ Forced Delay | ✅ Silver / Gold ($) | **✅ 100% Free & Unlocked** |
| **Live Preview (Hot Reloading)** | ⚠️ Paywall Popups | ✅ Unrestricted | **✅ 100% Free & Unrestricted** |
| **Preview over Wi-Fi / LAN** | ❌ Locked | ✅ Silver / Gold ($) | **✅ 100% Free & Unlocked** |
| **In-Game Debugger & Profiler** | ❌ Locked | ✅ Silver / Gold ($) | **✅ 100% Free & Unlocked** |
| **Custom Creator Profile** | ❌ Locked | ✅ Subscribed ($) | **✅ 100% Free & Unlocked** |
| **Local HTML5/Desktop Exports** | ✅ Free | ✅ Free | **✅ Free & Unrestricted** |

---

## 📦 Downloads & Installation

Download the latest installer or package for your operating system from the **[Releases Page](https://github.com/Heretek-AI/GDevelop-Heretek/releases)**:

- 🪟 **Windows**: `GDevelop-5-Setup-*.exe` (Installer) or `GDevelop-5-*-win.zip` (Portable)
- 🐧 **Linux**: `GDevelop-5-*.AppImage` or `gdevelop-5_*.deb`
- 🍎 **macOS**: `GDevelop-5-*.dmg` (Universal binary for Intel & Apple Silicon)
- 🌐 **Web**: Run directly in your browser or host via static hosting.

---

## 🛠️ Building from Source

### Prerequisites
- [Node.js](https://nodejs.org) (v18 or v20 LTS recommended)
- `npm` (v9 or v10)
- `git`

### 1. Clone the repository
```bash
git clone https://github.com/Heretek-AI/GDevelop-Heretek.git
cd GDevelop-Heretek
```

### 2. Install dependencies & build Web IDE
```bash
cd newIDE/app
npm install
npm run build
```

### 3. Run the Electron Desktop App
```bash
cd ../electron-app
npm install
npm start
```

---

## 🏗️ Technical Architecture

| Directory | Description |
| :--- | :--- |
| **`Core`** | Core C++ classes describing game structure, behaviors, and project data models. |
| **`GDJS`** | The runtime game engine written in TypeScript with PixiJS and Three.js for 2D/3D WebGL rendering. |
| **`GDevelop.js`** | WebAssembly / Emscripten bindings bridging `Core`, `GDJS`, and extensions to JavaScript. |
| **`newIDE`** | The React & Electron game editor, containing the UI, AI Client, events editor, and scene canvas. |
| **`Extensions`** | Built-in extensions for physics (Box2D, 3D Jolt Physics), pathfinding, lighting, particles, and input. |

---

## 🤝 Contributing

Contributions, bug reports, and suggestions are welcome!
- Check out [open issues](https://github.com/Heretek-AI/GDevelop-Heretek/issues) or submit a Pull Request.
- For upstream engine contributions, please see [4ian/GDevelop](https://github.com/4ian/GDevelop).

---

## 📜 License

- The Core library, native/HTML5 game engine, IDE, and built-in extensions are licensed under the **MIT License**.
- Games exported with GDevelop are distributed under the MIT license: you own all rights to your games and can distribute, sell, or monetize them freely.
- GDevelop name and original logos are property of Florian Rival.
