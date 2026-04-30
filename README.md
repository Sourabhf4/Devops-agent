# DevOps AI Agent

A web-based DevOps AI Agent built with React + Vite. Supports Groq, Anthropic (Claude), and OpenAI APIs. All credentials are stored in your browser's localStorage — nothing is sent to any backend.

## Features

- 🐳 Docker module
- 🖥 System module
- ☸ Kubernetes module
- ☁ Cloud (AWS) module
- 🔗 Network module
- 📋 Logs module
- 🔑 Credential manager (Groq, Anthropic, OpenAI, AWS, Docker, K8s, SSH)

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Run development server

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

### 3. Add your API Key

Click **🔑 Credentials & API Keys** in the sidebar and add your:
- **Groq API key** — Get free at [console.groq.com](https://console.groq.com) (recommended)
- **Anthropic API key** — From [console.anthropic.com](https://console.anthropic.com)
- **OpenAI API key** — From [platform.openai.com](https://platform.openai.com)

### 4. Build for production

```bash
npm run build
```

## Project Structure

```
devops-agent/
├── index.html
├── package.json
├── vite.config.js
├── README.md
└── src/
    ├── main.jsx          # React entry point
    ├── index.css         # Global reset styles
    └── DevOpsAgent.jsx   # Main app component
```

## Notes

- All credentials are saved in `localStorage` under the key `devops_agent_creds_v1`
- No backend required — runs entirely in the browser
- API calls go directly from your browser to Groq/Anthropic/OpenAI endpoints
