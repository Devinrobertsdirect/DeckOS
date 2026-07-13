# Overview

This project is a pnpm workspace monorepo utilizing TypeScript to build a comprehensive, AI-powered cyberdeck dashboard inspired by JARVIS. It aims to create a central command center for personal AI, focusing on spatial awareness, cognitive modeling, goal management, and autonomous operation. The system integrates various components, including a web-based dashboard (Deck OS), a command-line interface (DeckOS CLI), a mobile chat interface (DeckOS Mobile), and a robust API server. The overarching vision is to provide a highly interactive, intelligent, and customizable interface for managing digital and physical environments.

# User Preferences

I prefer clear and concise communication. When explaining concepts, please avoid overly technical jargon where simpler terms suffice. I value an iterative development approach, so small, frequent updates are preferred over large, infrequent ones. Before implementing any major architectural changes or introducing new external dependencies, please ask for my approval. Ensure that any code changes are well-documented and follow best practices for maintainability and readability. I do not want any changes to be made to the `artifacts` folder unless explicitly requested, as this folder contains the deployable applications.

# System Architecture

## Core Technologies

- **Monorepo**: pnpm workspaces
- **Backend**: Node.js 24, Express 5, PostgreSQL, Drizzle ORM, Zod
- **Frontend**: React, Vite, TailwindCSS, Leaflet (for spatial mapping)
- **API Codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild

## Workspace Structure

The project is organized into `artifacts` and `lib` packages:
- `artifacts/deck-os`: Web-based JARVIS-style dashboard (React, Vite, TailwindCSS). Features a Dashboard HUD, AI Router, Plugins, Memory Bank, Cognitive Model, Goal Manager, Feedback Loop, Autonomous Layer, Devices, Command Console, and a Spatial Map (`/map`) with live device tracking, geofencing, and interactive elements. Supports multiple visual modes (minimal, standard, cinematic).
- `artifacts/deck-cli`: Node.js CLI with an interactive REPL, connecting to the API via WebSocket. Provides commands for system status, AI inference, device management, memory search, and monitoring. Supports a daemon mode for structured event streaming.
- `artifacts/deck-mobile`: Mobile-first PWA chat interface (React, PWA) for interacting with the DeckOS AI via WebSocket.
- `artifacts/api-server`: Express 5 backend serving all Deck OS routes. Features a WebSocket endpoint (`/api/ws`) for real-time event broadcasting and command ingestion, and a REST API for chat, voice identity, spatial data, UCM, goals, feedback, predictions, and autonomy.

## Event Bus (`lib/event-bus`)

The central communication mechanism. All components interact exclusively through this async, non-blocking EventBus. Events are enveloped with `id`, `source`, `target`, `type`, `payload`, `timestamp` and categorized (e.g., `system.*`, `plugin.*`, `device.*`, `ai.*`). Events are persisted to a `system_events` DB table. A plugin interface allows for extensible functionality.

## API Server Bootstrap

Initializes the EventBus, PluginRegistry (auto-scans `dist/plugins/`), MemoryService, and Inference module. It handles graceful shutdown and exposes a paginated event history endpoint (`GET /api/events/history`).

## AI Router Layer

3-tier model routing gateway: CORTEX (gemma3:9b — chat/planning/reasoning), REFLEX (phi3 — classification/commands), AUTOPILOT (rule-engine — deterministic/offline). Model names and Ollama URL are configurable at runtime via `/api/config` and stored in `app_config` DB table; inference.ts reads them dynamically. The `ai_chat` plugin emits `ai.inference_started` with `{ tier, model, requestId }` before each LLM call so the frontend can show JARVIS's thinking state in real time.

## Easter Egg Engine

`artifacts/api-server/src/lib/easter-eggs.ts` — pre-LLM intercept layer that checks the user's message against a library of Iron Man / Tony Stark movie quote triggers. When a match is found, the scripted in-universe response is returned instantly (`modelUsed: "easter-egg-v1"`) without touching the LLM. Checks run in both the WS chat handler (`lib/bootstrap.ts`) and the `ai_chat` plugin. Responses are persona-aware: they use the AI's configured name and the correct honorific (sir/ma'am) based on the persona gender. The UI renders egg responses with a hot-rod orange `⚡ CORE.MEMORY // CLASSIFIED` badge in both the AI Chat Console and Command Console.

## Plugin System

Dynamically loaded from `dist/plugins/`, each plugin is an esbuild bundle.
- `system_monitor`: Polls system metrics and logs to memory.
- `ai_chat`: Subscribes to chat requests, enriches prompts with memory, and uses AI inference.

## User Cognitive Model (UCM)

A structured identity layer (`/api/ucm`) with 7 editable layers (identity, preferences, context, goals, behaviorPatterns, emotionalModel, domainExpertise). It's a singleton pattern in the database, with API endpoints for CRUD operations and settings. Emits bus events on changes.

## Goal Manager + Planning Engine

Manages user goals (`goals` table) with CRUD API, subgoal support, and auto-generated step-by-step plans (`goal_plans` table).

## Feedback Loop

Records user feedback signals (`feedback_signals` table) to adapt the AI's behavior profile (`behavior_profile` table) across verbosity, proactivity, tone, and confidence.

## Prediction Engine + Autonomy Controller

Generates predictions (`predictions` table) based on goals and feedback. The Autonomy Controller (`autonomy_config` table) manages execution based on safety levels (strict, moderate, permissive) and logs all actions (`autonomy_log` table).

## Memory System

- **Short-term**: PostgreSQL-based session memory with 1-hour TTL.
- **Long-term**: Persistent PostgreSQL memory with keyword search.

## Device Abstraction Layer

Supports simulated devices (sensors, actuators, displays, network) with an MQTT/WebSocket abstraction ready for various protocols.

## Command Router

Rule-based command dispatch with AI-assist. Stores full command history in PostgreSQL.

## Cognitive Loop

A persistent loop (10s tick) that emits `system.cognitive_tick` events, generates predictions every 5 minutes, handles autonomous actions, and manages goal decay and prediction pruning.

## Daily AI Briefing

`briefings` table stores AI-generated daily summaries (id, date, summary, stats JSONB, modelUsed, generatedAt). The `briefing-generator.ts` queries the past 24h of goals, autonomy_log, memory_entries, and feedback_signals, composes a structured prompt, and calls the inference pipeline. REST API: `GET /api/briefings` (archive), `GET /api/briefings/latest`, `POST /api/briefings/generate` (manual trigger). The dashboard shows a DAILY.BRIEFING tile with key stats and a "Generate Now" button. A `/briefings` archive page lists all past briefings in reverse-chronological order, expandable. Auto-generated at 06:00 via the Routine Runner (`generate_briefing` action type). Emits `briefing.generated` bus event which triggers a notification in the Notification Inbox.

## Memory Enricher

Analyzes recent memory entries to update the UCM's `preferences` and `behaviorPatterns` layers.

## Local-First Development

Includes `.env.example`, `docker-compose.yml` for a full local stack, and Dockerfiles for production images, along with Nginx configuration for the web application.

## Export / Self-Hosting

Two one-command setup scripts are provided for running Deck OS on your own hardware:

- `setup.sh` — Linux and macOS (bash 4+). Flags: `--docker` (Docker Compose path), `--start` (bare-metal + start dev servers).
- `setup.ps1` — Windows PowerShell. Flags: `-Docker`, `-Start`.

Both scripts: check Node.js 20+ and pnpm (auto-installing pnpm via corepack if missing), detect a running PostgreSQL instance, detect Ollama, copy `.env.example` → `.env` with a pause for editing, run `pnpm install --frozen-lockfile`, and run DB migrations. The Docker path uses `docker compose up -d --build` and skips all Node/Postgres steps.

See `README.md` for full setup instructions and environment variable reference.

# External Dependencies

- **pnpm**: Monorepo package manager.
- **Node.js**: Runtime environment.
- **TypeScript**: Programming language.
- **Express**: Web application framework.
- **PostgreSQL**: Primary database.
- **Drizzle ORM**: Object-relational mapper for PostgreSQL.
- **Zod**: Schema declaration and validation library.
- **Orval**: OpenAPI spec code generator.
- **esbuild**: Bundler for JavaScript and TypeScript.
- **React**: Frontend JavaScript library.
- **Vite**: Frontend build tool.
- **TailwindCSS**: CSS framework.
- **Leaflet**: Open-source JavaScript library for interactive maps.
- **OpenStreetMap**: Map data provider used with Leaflet.
- **Ollama**: Local LLM inference engine.
- **llama.cpp**: High-performance inference for LLaMA models.
- **OpenAI-compatible APIs**: Integration with OpenAI-like services.
- **ws**: WebSocket library for Node.js.
- **chalk**: Terminal string styling.
- **Docker**: Containerization platform.
- **Nginx**: Web server and reverse proxy.