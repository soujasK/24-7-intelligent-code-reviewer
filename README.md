# 24/7 Intelligent Code Review (Zero-Trust Wasm Code Defense Mesh)

> **Autonomous In-Browser Static Analysis, DuckDB-Wasm AST SQL Compilation, Multi-Agent Swarm Intelligence, and Cryptographically Verifiable Code Defense — Powered by Google Cloud, Google Gemini, Firebase, and Google Antigravity.**

[![Built with Google Antigravity](https://img.shields.io/badge/Google%20Antigravity-Agentic%20Engine-4285F4.svg?logo=google&logoColor=white)](#)
[![Google Gemini API](https://img.shields.io/badge/Google%20Gemini-2.5%20Flash%20API-8E75C2.svg?logo=googlegemini&logoColor=white)](#)
[![Google Cloud Platform](https://img.shields.io/badge/Google%20Cloud-GCP%20%7C%20Firestore%20%7C%20Functions-EA4335.svg?logo=googlecloud&logoColor=white)](#)
[![Firebase](https://img.shields.io/badge/Firebase-Auth%20%7C%20Firestore%20%7C%20Rules-FFCA28.svg?logo=firebase&logoColor=black)](#)
[![Zero-Trust Security](https://img.shields.io/badge/Zero--Trust-Wasm%20Defense%20Mesh-00C853.svg)](#)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## 🎯 Executive Summary

**24/7 Intelligent Code Review** is a real-time, zero-trust autonomous code defense, algorithmic complexity inspection, and architectural integrity analysis mesh that executes **entirely client-side in your browser**.

Built and orchestrated with **Google Antigravity**, **Google Gemini 2.5 Flash**, **Google Cloud Platform (GCP)**, **Firebase**, and **WebAssembly (Tree-Sitter & DuckDB-Wasm)**, this platform allows engineering teams to evaluate proprietary code against custom team policies and historical CSV datasets with **zero raw source code ever transmitted over external networks**.

---

## 🚀 Deep Integration with Google Technologies & Tools

This project is architected and built natively around the **Google Developer Ecosystem**:

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                        GOOGLE DEVELOPER ECOSYSTEM ARCHITECTURE                          │
│                                                                                         │
│  ┌─────────────────────────────────┐       ┌─────────────────────────────────────────┐  │
│  │     GOOGLE ANTIGRAVITY          │       │           GOOGLE GEMINI API             │  │
│  │  • Multi-Agent Swarm Logic      │       │  • gemini-2.5-flash (@google/genai)     │  │
│  │  • Autonomous AST Orchestration │  ───► │  • Structured JSON Rule Distillation    │  │
│  │  • Zero-Trust Policy Workflows  │       │  • Anonymized AI Code Remediation       │  │
│  └─────────────────────────────────┘       └─────────────────────────────────────────┘  │
│                   │                                             │                       │
│                   ▼                                             ▼                       │
│  ┌───────────────────────────────────────────────────────────────────────────────────┐  │
│  │                    FIREBASE & GOOGLE CLOUD PLATFORM (GCP)                         │  │
│  │  • Google Cloud Identity / Firebase Auth (OAuth Token Lifecycle)                  │  │
│  │  • Google Cloud Firestore (Append-Only Audit History, Elo Ratings, Rules)         │  │
│  │  • Google Cloud Functions (2nd Gen Serverless Endpoints + Secret Manager)         │  │
│  │  • Firebase Emulators (Local Dev Environment on Ports 5001, 8080, 9099)           │  │
│  │  • Firebase Analytics (Real-time telemetry and scanner diagnostics)               │  │
│  └───────────────────────────────────────────────────────────────────────────────────┘  │
│                   │                                                                     │
│                   ▼                                                                     │
│  ┌───────────────────────────────────────────────────────────────────────────────────┐  │
│  │                       GOOGLE CHROMIUM WEB STANDARDS (V8)                          │  │
│  │  • WebAssembly Execution Core (Tree-Sitter, DuckDB-Wasm, Pyodide WASM)            │  │
│  │  • Autonomous 5-Agent Swarm (Concurrent Web Workers)                              │  │
│  │  • WebCrypto API (ECDSA P-256 Digital Audit Attestation & SHA-256 Hashes)          │  │
│  └───────────────────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

### 1. 🤖 Google Antigravity (Agentic Architecture & Workflow)
- **Autonomous Agent Pods**: Designed with Google Antigravity's agentic engineering paradigm, orchestrating 5 concurrent, specialized Web Worker pods that continuously inspect AST nodes, call hierarchies, and loop depths.
- **Micro-Task Decomposition**: Implements Antigravity's robust state management and planning patterns to coordinate parsing, DuckDB relational ingestion, fuzzer verification, and graph topology generation.

### 2. ⚡ Google Gemini 2.5 Flash API (`@google/genai`)
- **Ultra-Fast Code Remediation**: Utilizes Google's state-of-the-art `gemini-2.5-flash` model for sub-second, highly contextual code defense suggestions and safe wrapper replacements.
- **Strict Privacy Anonymization**: Before invoking Gemini, client-side AST tokenizers replace all identifiers with role-based placeholders (`var_1`, `fn_2`, `Cls_3`) and mask literals (`<TYPE>`). **Gemini receives 0 raw proprietary source code.**
- **Structured Schema Distillation**: Employs Gemini's native `responseSchema` (Type.OBJECT) for zero-shot rule synthesis, distilling rejected remediations into permanent, reusable static analysis policy rules.

### 3. 🔥 Google Firebase & Google Cloud Platform (GCP)
- **Firebase Authentication & Cloud Identity**: Secure GitHub OAuth credential exchange and session persistence.
- **Google Cloud Firestore**: Scalable NoSQL real-time document database maintaining:
  - **Institutional Memory**: Living repository of team-distilled compliance rules.
  - **Developer Elo Ratings**: Continuous skill matrix progression (1600 baseline, Grade A/B/Grandmaster).
  - **Append-Only Audit Trail**: Tamper-proof history of code reviews and CSV policy evaluations.
- **Google Cloud Functions (2nd Gen / Cloud Run)**: Serverless backend callable functions (`remediateFinding`, `distillCorrection`, `askCodeAssistant`) configured with Google Cloud Secret Manager.
- **Firebase Local Emulator Suite**: Complete offline development support for Auth, Firestore, and Cloud Functions.

### 4. 🌐 Google Chromium V8 Web Standards
- Leverages high-performance WebAssembly runtimes, multithreaded Web Workers, and the W3C WebCrypto API for client-side cryptographic attestation.

---

## ⚡ Core Platform Features

### 1. In-Browser Zero-Trust Static Analysis
- **Tree-Sitter WebAssembly**: Parses Python, C++, TypeScript, and JavaScript into full Abstract Syntax Tree (AST) relations directly in the browser.
- **DuckDB-Wasm Relational AST Engine**: Compiles AST nodes, identifiers, loops, functions, and call expressions into in-memory DuckDB tables (`ast_nodes`, `ast_calls`, `ast_loops`, `ast_functions`).
- **Instant SQL Rule Evaluation**: Executes relational SQL queries across AST structures in <5ms.
- **Zero Raw Source Leakage**: Code is tokenized and processed client-side. Only sanitized, anonymized skeletons are ever transmitted for optional LLM remediations.

### 2. Autonomous 5-Agent Swarm Architecture
- 🛡️ **POD-01 (Security & Deserialization Pod)**: Scans AST for unverified dynamic sinks (`pickle.loads`, `eval`, `exec`, `os.system`, SQL injection).
- ⚡ **POD-02 (Algorithmic Complexity Pod)**: Detects nested loop bottlenecks ($O(N^2)$), invariant call overhead inside iterations, and algorithmic scaling issues.
- 🌐 **POD-03 (Architecture & Blast Radius Pod)**: Analyzes cross-module call fanout, coupling density, and multi-file dependency blast radii.
- 🧪 **POD-04 (Pyodide Fuzzing Gate Pod)**: Automated property-based fuzz tests in an isolated WebAssembly Python sandbox.
- 📜 **POD-05 (DuckDB Historical CSV Policy Pod)**: Dynamically compiles natural language team CSV policies into executable SQL AST relational queries.

### 3. Dynamic CSV Policy Intelligence & Historical Datasets
- **CSV to AST Policy Compiler**: Ingests customized CSV policy files (`<id>, <type>, <description>`) and evaluates code against institutional rules in real time.
- **Dedicated History Timeline**: Separated tracking for **Code Review Evaluations** and **CSV Policy Datasets** to keep scans clean and structured.
- **Interactive Chatbot Prompt Adaptation**: Real-time context awareness dynamically switches suggested prompts between Code Defense questions and CSV Policy questions.

### 4. Live Interactive Blast Radius Force Graph (D3.js)
- **Force-Directed Graph Visualization**: Visualizes multi-file dependency trees, function-to-function call chains, and external API sinks.
- **Pulsing Violation Halos**: Real-time visual alerts for security and complexity infractions.
- **Downstream Blast Radius Isolation**: Click any node to instantly isolate and inspect all affected downstream caller chains.

### 5. Developer Quality Rating & Dynamic ELO Matrix
- **Dual-Tiered Security Index**: Real-time **Active File Health** and **Workspace Security Index** weighted by violation severity.
- **Chess-Style ELO Engine**: Tracks code quality progression across scan sessions with dynamic tier badges (*Grandmaster Elite*, *Zero-Trust Grade A*, *Intermediate Grade B*, *Remediation Required*).

### 6. File-Scoped AI Remediation & Security Assistant
- **Context-Aware Assistant**: Powered by **Google Gemini** (`gemini-2.5-flash` / Vertex AI) with local heuristic offline fallbacks.
- **One-Click In-Editor Remediation**: Automatically replaces vulnerable or slow code blocks with approved safe wrappers.

### 7. Cryptographic Attestation & CSV Export
- **ECDSA (P-256) Audit Receipts**: Generates cryptographic digital signatures verifying audit timestamps, SHA-256 code hashes, and zero-violation compliance.
- **One-Click CSV Export**: Comprehensive export of all detected findings, rule types, line numbers, and sandbox execution verdicts.

---

## 🛠️ Complete Tech Stack

| Category | Technologies & Tools |
| :--- | :--- |
| **Agentic Framework** | Google Antigravity Agentic IDE & Autonomous Workflows |
| **AI & LLM Engine** | Google Gemini 2.5 Flash API, `@google/genai`, Google Vertex AI |
| **Cloud & Backend** | Google Cloud Platform (GCP), Firebase Auth, Cloud Firestore, Cloud Functions (2nd Gen) |
| **Frontend Framework** | React 18, TypeScript, Tailwind CSS, Monaco Editor, Lucide Icons |
| **Data & Graph Viz** | D3.js v7 Force-Directed Graph Simulation |
| **WebAssembly Core** | DuckDB-Wasm, Web Tree-Sitter, Pyodide (Python 3 WASM) |
| **Cryptography** | WebCrypto API (ECDSA P-256, SHA-256) |
| **Tooling & Build** | Vite, PostCSS, ESLint, TypeScript |

---

## 🚀 Getting Started

### Prerequisites
- **Node.js**: `v18.0.0` or later
- **npm**: `v9.0.0` or later

### Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/soujasK/24-7-intelligent-code-reviewer.git
   cd 24-7-intelligent-code-reviewer
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure Environment Variables** (Optional for Firebase & Gemini):
   Create a `.env` file from the provided `.env.example`:
   ```env
   # Google Gemini API Key (Direct in-browser AI Assistant & Remediation)
   VITE_GEMINI_API_KEY=your_gemini_api_key_here

   # Google Firebase / GCP Configuration (Optional)
   VITE_FIREBASE_API_KEY=your_api_key
   VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
   VITE_FIREBASE_PROJECT_ID=your_project_id
   VITE_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
   VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
   VITE_FIREBASE_APP_ID=your_app_id
   ```

4. **Start the Development Server**:
   ```bash
   npm run dev
   ```
   Open [http://localhost:5173/](http://localhost:5173/) in your browser.

5. **Build for Production**:
   ```bash
   npm run build
   ```

---

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.
