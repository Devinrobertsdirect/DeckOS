import { Router } from "express";
import { exec }   from "child_process";
import { promisify } from "util";
import { logger } from "../lib/logger.js";
import { getConfig } from "../lib/app-config.js";
import { bus } from "../lib/bus.js";

const router   = Router();
const execAsync = promisify(exec);

const OPENCLAW_PORT   = 18789;
const CLAWHUB_API     = "https://clawhub.ai/api/v1";
const WSL_DISTRO      = "Ubuntu";
const IS_WINDOWS      = process.platform === "win32";

// Install script — official OpenClaw installer
const OPENCLAW_INSTALL_CMD =
  `curl -fsSL https://openclaw.ai/install.sh | bash`;

type ClawSkill = {
  slug:         string;
  name:         string;
  author:       string;
  category:     string;
  description:  string;
  installCount: number;
  tags:         string[];
};

// ── WSL2 helpers ───────────────────────────────────────────────────────────

/**
 * Run a command inside WSL2 Ubuntu (Windows) or directly on Linux/Mac.
 * Returns { stdout, stderr } — rejects on non-zero exit.
 */
async function runInEnv(cmd: string): Promise<{ stdout: string; stderr: string }> {
  if (IS_WINDOWS) {
    return execAsync(`wsl -d ${WSL_DISTRO} -- bash -c ${JSON.stringify(cmd)}`, {
      timeout: 30_000,
    });
  }
  return execAsync(cmd, { timeout: 30_000 });
}

/**
 * Check whether the WSL Ubuntu distro is installed and running.
 * Returns null if not on Windows (always OK on Linux).
 */
async function detectWsl(): Promise<{ available: boolean; distros: string[] }> {
  if (!IS_WINDOWS) return { available: true, distros: [] };
  try {
    const { stdout } = await execAsync("wsl --list --quiet", { timeout: 5_000 });
    // stdout may contain UTF-16 null bytes on older Windows — strip them
    const distros = stdout
      .replace(/\0/g, "")
      .split(/\r?\n/)
      .map((d) => d.trim())
      .filter(Boolean);
    const available = distros.some((d) =>
      d.toLowerCase().startsWith(WSL_DISTRO.toLowerCase()),
    );
    return { available, distros };
  } catch {
    return { available: false, distros: [] };
  }
}

/**
 * Check whether the `openclaw` binary exists inside the Ubuntu environment.
 */
async function isOpenClawInstalled(): Promise<boolean> {
  try {
    await runInEnv("which openclaw || command -v openclaw");
    return true;
  } catch {
    return false;
  }
}

/**
 * Check whether the OpenClaw gateway is already listening on OPENCLAW_PORT.
 * WSL2 port-forwards automatically, so localhost works from Windows too.
 */
async function isOpenClawRunning(): Promise<boolean> {
  const endpoints = [
    `http://localhost:${OPENCLAW_PORT}/api/tags`,
    `http://localhost:${OPENCLAW_PORT}/`,
    `http://localhost:${OPENCLAW_PORT}/health`,
  ];
  for (const url of endpoints) {
    try {
      const ctrl = new AbortController();
      setTimeout(() => ctrl.abort(), 2_000);
      const res = await fetch(url, { signal: ctrl.signal });
      if (res.status < 500) return true;
    } catch {
      // try next endpoint
    }
  }
  return false;
}

async function getOpenClawModel(): Promise<string> {
  try {
    return (await getConfig("OPENCLAW_MODEL")) ?? process.env["OPENCLAW_MODEL"] ?? "default";
  } catch {
    return process.env["OPENCLAW_MODEL"] ?? "default";
  }
}

// ── GET /api/openclaw/status ───────────────────────────────────────────────

router.get("/openclaw/status", async (_req, res) => {
  const [running, model, wsl, installed] = await Promise.all([
    isOpenClawRunning(),
    getOpenClawModel(),
    detectWsl(),
    isOpenClawInstalled(),
  ]);
  res.json({
    running,
    installed,
    gateway: `http://localhost:${OPENCLAW_PORT}`,
    model,
    port: OPENCLAW_PORT,
    platform: process.platform,
    wsl: IS_WINDOWS
      ? { available: wsl.available, distro: WSL_DISTRO, distros: wsl.distros }
      : null,
    docsUrl: "https://docs.openclaw.ai",
    clawHubUrl: "https://clawhub.ai",
  });
});

// ── POST /api/openclaw/launch ──────────────────────────────────────────────
// Install (if needed) and start the OpenClaw gateway via WSL2 Ubuntu.

router.post("/openclaw/launch", async (_req, res) => {
  const steps: string[] = [];

  // 1. Check if already running — nothing to do
  if (await isOpenClawRunning()) {
    res.json({ ok: true, alreadyRunning: true, steps: ["OpenClaw gateway already running"] });
    return;
  }

  // 2. On Windows — verify WSL2 Ubuntu exists
  if (IS_WINDOWS) {
    const wsl = await detectWsl();
    if (!wsl.available) {
      res.status(503).json({
        ok: false,
        error: `WSL2 Ubuntu distro not found. Installed distros: ${wsl.distros.join(", ") || "none"}`,
        fix: "Install Ubuntu from the Microsoft Store, then run: wsl --install -d Ubuntu",
        steps,
      });
      return;
    }
    steps.push(`WSL2 Ubuntu distro confirmed`);
  }

  // 3. Install OpenClaw if not present
  const installed = await isOpenClawInstalled();
  if (!installed) {
    steps.push("OpenClaw not found — installing via official installer…");
    logger.info("OpenClaw: not installed — running installer in Ubuntu");
    try {
      await runInEnv(OPENCLAW_INSTALL_CMD);
      steps.push("OpenClaw installed successfully");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err }, "OpenClaw install failed");
      res.status(500).json({
        ok: false,
        error: `Install failed: ${msg}`,
        fix: `Run manually in Ubuntu: ${OPENCLAW_INSTALL_CMD}`,
        steps,
      });
      return;
    }
  } else {
    steps.push("OpenClaw already installed");
  }

  // 4. Launch the gateway (detached so it survives this request)
  steps.push("Starting OpenClaw gateway…");
  try {
    const launchCmd = [
      "mkdir -p ~/.openclaw/logs",
      "nohup openclaw gateway > ~/.openclaw/logs/gateway.log 2>&1 &",
      "disown",
    ].join(" && ");

    await runInEnv(launchCmd);
    steps.push("Gateway process started (detached)");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "OpenClaw gateway launch failed");
    res.status(500).json({
      ok: false,
      error: `Launch failed: ${msg}`,
      fix: IS_WINDOWS
        ? `Open Ubuntu and run: openclaw gateway`
        : `Run: openclaw gateway`,
      steps,
    });
    return;
  }

  // 5. Wait up to 8 s for the gateway to become reachable
  steps.push("Waiting for gateway to become ready…");
  let ready = false;
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 1_000));
    if (await isOpenClawRunning()) { ready = true; break; }
  }

  if (ready) {
    steps.push("Gateway is up and accepting connections");
    res.json({ ok: true, alreadyRunning: false, steps });
  } else {
    steps.push("Gateway started but did not become reachable within 8 s — check logs in Ubuntu: ~/.openclaw/logs/gateway.log");
    res.status(202).json({ ok: false, pending: true, steps });
  }
});

// ── POST /api/openclaw/chat ────────────────────────────────────────────────
// Proxies a message to the OpenClaw gateway (which routes to Ollama locally).

router.post("/openclaw/chat", async (req, res) => {
  const { message, sessionId, stream = false } = req.body as {
    message: string;
    sessionId?: string;
    stream?: boolean;
  };

  if (!message?.trim()) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  const running = await isOpenClawRunning();
  if (!running) {
    res.status(503).json({
      error: "OpenClaw gateway is not running",
      fix: "POST /api/openclaw/launch to auto-install and start it via WSL2 Ubuntu",
      docsUrl: "https://docs.openclaw.ai/windows",
    });
    return;
  }

  const model   = await getOpenClawModel();
  const sid     = sessionId?.trim() || `deck-os-${Date.now()}`;
  const startMs = Date.now();

  try {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 60_000);

    // OpenClaw gateway follows Ollama's /api/chat format
    const ollamaBody = {
      model,
      messages: [{ role: "user", content: message }],
      stream: false,
    };

    const response = await fetch(`http://localhost:${OPENCLAW_PORT}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ollamaBody),
      signal: ctrl.signal,
    });

    if (!response.ok) {
      throw new Error(`OpenClaw gateway responded with HTTP ${response.status}`);
    }

    const data = await response.json() as Record<string, unknown>;
    const reply =
      (data["message"] as Record<string, string> | undefined)?.["content"] ??
      (data["response"] as string | undefined) ??
      "";

    const latencyMs = Date.now() - startMs;

    bus.emit({
      source: "openclaw",
      target: null,
      type: "ai.chat.response",
      payload: { response: reply, sessionId: sid, modelUsed: model, latencyMs },
    });

    res.json({ response: reply, sessionId: sid, modelUsed: model, latencyMs });
  } catch (err) {
    logger.error({ err }, "OpenClaw chat proxy error");
    res.status(502).json({
      error: `OpenClaw error: ${err instanceof Error ? err.message : "Unknown error"}`,
    });
  }
});

// ── GET /api/openclaw/skills ───────────────────────────────────────────────
// Returns ClawHub skills. Tries the live API first, falls back to curated list.

router.get("/openclaw/skills", async (req, res) => {
  const q        = ((req.query["q"] as string) ?? "").toLowerCase();
  const category = (req.query["category"] as string) ?? "";
  const limit    = Math.min(Number(req.query["limit"] ?? 50), 200);

  try {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (category) params.set("category", category);
    params.set("limit", String(limit));

    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 5_000);

    const apiRes = await fetch(`${CLAWHUB_API}/skills?${params}`, {
      signal: ctrl.signal,
      headers: { Accept: "application/json", "User-Agent": "DeckOS/1.0" },
    });

    if (apiRes.ok) {
      const raw = await apiRes.json() as Record<string, unknown>;
      // Normalize ClawHub API format (items|data|skills) → skills
      const skills = (raw["skills"] ?? raw["items"] ?? raw["data"] ?? []) as ClawSkill[];
      if (Array.isArray(skills) && skills.length > 0) {
        res.json({ skills, total: skills.length, source: "clawhub" });
        return;
      }
      // Empty response from API — fall through to curated
    }
  } catch {
    // fall through to curated list
  }

  const all     = CURATED_SKILLS;
  const matched = all.filter((s) => {
    const qOk  = !q || s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q) || s.tags.some((t) => t.includes(q));
    const cOk  = !category || s.category === category;
    return qOk && cOk;
  });

  res.json({ skills: matched.slice(0, limit), total: matched.length, source: "curated" });
});

// ── GET /api/openclaw/skills/categories ───────────────────────────────────

router.get("/openclaw/skills/categories", (_req, res) => {
  const cats = [...new Set(CURATED_SKILLS.map((s) => s.category))].sort();
  res.json({ categories: cats });
});

// ── POST /api/openclaw/skills/install ─────────────────────────────────────
// Returns the installation command — actual execution happens in WSL.

router.post("/openclaw/skills/install", (req, res) => {
  const { slug } = req.body as { slug?: string };

  if (!slug || !/^[\w-]+\/[\w-]+$/.test(slug)) {
    res.status(400).json({ error: "Invalid skill slug (expected: author/skill-name)" });
    return;
  }

  const [author, name] = slug.split("/");
  res.json({
    slug,
    installCommand: `clawhub install ${slug}`,
    manualPath: `~/.openclaw/skills/${author}/${name}/`,
    instructions: [
      "Option A — ClawHub CLI (inside WSL):",
      `  clawhub install ${slug}`,
      "",
      "Option B — paste the GitHub URL directly into your OpenClaw chat:",
      `  https://github.com/openclaw/skills/tree/main/skills/${slug}`,
      "",
      "Option C — manual copy:",
      `  Copy skill folder into ~/.openclaw/skills/${author}/${name}/`,
    ].join("\n"),
    clawHubUrl: `https://clawhub.ai/${slug}`,
  });
});

// ── Curated skill catalog (offline fallback) ───────────────────────────────
// 73 skills across 11 categories — sorted by category then install count

const CURATED_SKILLS: ClawSkill[] = [

  // ── PRODUCTIVITY ─────────────────────────────────────────────────────────
  { slug: "github/github",           name: "GitHub",            author: "github",          category: "productivity",  description: "Manage repos, issues, PRs, branches, and code reviews from your assistant.",                              installCount: 14200, tags: ["git", "code", "devops", "github"] },
  { slug: "google/gmail",            name: "Gmail",             author: "google",          category: "productivity",  description: "Read, compose, search, and send emails through Gmail.",                                                  installCount:  8900, tags: ["email", "google", "gmail"] },
  { slug: "calendar/google",         name: "Google Calendar",   author: "google",          category: "productivity",  description: "Create and query Google Calendar events, check free/busy slots.",                                        installCount:  6100, tags: ["calendar", "scheduling", "google"] },
  { slug: "obsidian/obsidian",       name: "Obsidian",          author: "obsidian",        category: "productivity",  description: "Read, write, and search notes in your Obsidian vault. Integrates with the Memory Bank.",                 installCount:  6100, tags: ["obsidian", "notes", "knowledge", "markdown", "vault"] },
  { slug: "notion/notion",           name: "Notion",            author: "notion",          category: "productivity",  description: "Read and write Notion pages, databases, and blocks with natural language.",                             installCount:  7400, tags: ["notes", "docs", "notion", "productivity"] },
  { slug: "jira/jira",               name: "Jira",              author: "jira",            category: "productivity",  description: "Create, update, and track Jira tickets, sprints, and epics.",                                           installCount:  5100, tags: ["jira", "project-management", "agile"] },
  { slug: "linear/linear",           name: "Linear",            author: "linear",          category: "productivity",  description: "Manage Linear issues, cycles, projects, and teams.",                                                    installCount:  4300, tags: ["linear", "issues", "project"] },
  { slug: "todoist/todoist",         name: "Todoist",           author: "todoist",         category: "productivity",  description: "Manage tasks, projects, and reminders in Todoist.",                                                    installCount:  3800, tags: ["tasks", "todo", "productivity"] },
  { slug: "nevo-david/postiz",       name: "Postiz",            author: "nevo-david",      category: "productivity",  description: "Schedule and publish social media content across all major platforms.",                                 installCount:  3600, tags: ["social", "scheduling", "marketing"] },

  // ── COMMUNICATION ────────────────────────────────────────────────────────
  { slug: "steipete/slack",          name: "Slack",             author: "steipete",        category: "communication", description: "Send messages, manage channels, and search Slack workspaces.",                                          installCount:  9800, tags: ["slack", "messaging", "team"] },
  { slug: "discord/discord",         name: "Discord",           author: "discord",         category: "communication", description: "Send messages to Discord channels and read server activity.",                                          installCount:  7100, tags: ["discord", "messaging", "gaming"] },
  { slug: "telegram/telegram",       name: "Telegram",          author: "telegram",        category: "communication", description: "Send and receive Telegram messages through your assistant.",                                           installCount:  5900, tags: ["telegram", "messaging"] },
  { slug: "whatsapp/whatsapp",       name: "WhatsApp",          author: "whatsapp",        category: "communication", description: "Send WhatsApp messages and read conversations via the WhatsApp Business API.",                         installCount:  8300, tags: ["whatsapp", "messaging", "mobile"] },
  { slug: "microsoft/teams",         name: "Microsoft Teams",   author: "microsoft",       category: "communication", description: "Post messages, create meetings, and read channels in Microsoft Teams.",                                installCount:  5400, tags: ["teams", "microsoft", "messaging", "enterprise"] },
  { slug: "gmail/compose",           name: "Email Compose",     author: "gmail",           category: "communication", description: "Draft and send rich-text emails with AI-generated content.",                                          installCount:  4200, tags: ["email", "compose", "gmail"] },

  // ── DEVOPS ───────────────────────────────────────────────────────────────
  { slug: "git/local",               name: "Local Git",         author: "git",             category: "devops",        description: "Run git operations on local repositories — commit, push, diff, log.",                                  installCount:  8400, tags: ["git", "version-control", "local"] },
  { slug: "docker/docker",           name: "Docker",            author: "docker",          category: "devops",        description: "Manage containers, images, networks, and volumes with natural language.",                              installCount:  6700, tags: ["docker", "containers", "devops"] },
  { slug: "npm/npm",                 name: "NPM / pnpm",        author: "npm",             category: "devops",        description: "Manage node packages, run scripts, and audit dependencies.",                                           installCount:  5200, tags: ["npm", "pnpm", "node", "packages"] },
  { slug: "kubernetes/k8s",          name: "Kubernetes",        author: "kubernetes",      category: "devops",        description: "Query pods, deployments, services, and cluster health.",                                              installCount:  3900, tags: ["kubernetes", "k8s", "devops", "cloud"] },
  { slug: "github/actions",          name: "GitHub Actions",    author: "github",          category: "devops",        description: "Trigger, monitor, and inspect CI/CD workflow runs and job logs.",                                     installCount:  5800, tags: ["github-actions", "ci", "cd", "devops", "pipelines"] },
  { slug: "terraform/terraform",     name: "Terraform",         author: "terraform",       category: "devops",        description: "Apply, plan, and inspect Terraform infrastructure as code from your assistant.",                       installCount:  4700, tags: ["terraform", "iac", "infrastructure", "cloud", "devops"] },
  { slug: "ansible/ansible",         name: "Ansible",           author: "ansible",         category: "devops",        description: "Run Ansible playbooks to automate server provisioning and configuration.",                            installCount:  3600, tags: ["ansible", "automation", "provisioning", "devops", "homelab"] },
  { slug: "cloudflare/cloudflare",   name: "Cloudflare",        author: "cloudflare",      category: "devops",        description: "Manage DNS records, Cloudflare Tunnels, Workers, and page rules.",                                   installCount:  5100, tags: ["cloudflare", "dns", "tunnels", "cdn", "networking"] },
  { slug: "vercel/vercel",           name: "Vercel",            author: "vercel",          category: "devops",        description: "Deploy and manage Vercel projects, view build logs and domains.",                                    installCount:  4100, tags: ["vercel", "deploy", "hosting"] },

  // ── DATA ─────────────────────────────────────────────────────────────────
  { slug: "postgres/database",       name: "PostgreSQL",        author: "postgres",        category: "data",          description: "Run natural-language queries against PostgreSQL databases.",                                           installCount:  6500, tags: ["sql", "database", "postgres"] },
  { slug: "mysql/database",          name: "MySQL / MariaDB",   author: "mysql",           category: "data",          description: "Query and manage MySQL and MariaDB databases with natural language.",                                 installCount:  5800, tags: ["mysql", "mariadb", "sql", "database"] },
  { slug: "mongodb/database",        name: "MongoDB",           author: "mongodb",         category: "data",          description: "Query collections, insert documents, and aggregate MongoDB databases.",                              installCount:  4200, tags: ["mongodb", "nosql", "database", "documents"] },
  { slug: "redis/redis",             name: "Redis",             author: "redis",           category: "data",          description: "Get, set, and inspect keys in Redis — useful for cache inspection and queue management.",            installCount:  3700, tags: ["redis", "cache", "queue", "key-value"] },
  { slug: "sqlite/sqlite",           name: "SQLite",            author: "sqlite",          category: "data",          description: "Read and query local SQLite database files with natural language.",                                  installCount:  4900, tags: ["sqlite", "sql", "local", "database", "offline"] },

  // ── RESEARCH ─────────────────────────────────────────────────────────────
  { slug: "web/search",              name: "Web Search",        author: "web",             category: "research",      description: "Search the web and retrieve up-to-date information in real time.",                                    installCount: 11000, tags: ["search", "web", "research", "browse"] },
  { slug: "wikipedia/wiki",          name: "Wikipedia",         author: "wikipedia",       category: "research",      description: "Fetch and summarize Wikipedia articles on any topic.",                                              installCount:  7200, tags: ["wikipedia", "knowledge", "research"] },
  { slug: "perplexity/perplexity",   name: "Perplexity AI",     author: "perplexity",      category: "research",      description: "Real-time AI-powered research with cited sources — ask complex questions and get grounded answers.", installCount:  6900, tags: ["perplexity", "ai", "research", "citations", "real-time"] },
  { slug: "searxng/searxng",         name: "SearXNG",           author: "searxng",         category: "research",      description: "Private, self-hosted meta search engine — search without being tracked.",                            installCount:  2800, tags: ["searxng", "search", "privacy", "self-hosted"] },
  { slug: "wolfram/alpha",           name: "Wolfram Alpha",     author: "wolfram",         category: "research",      description: "Computation engine for math, science, dates, unit conversions, and data lookups.",                   installCount:  4100, tags: ["wolfram", "math", "computation", "science", "calculator"] },
  { slug: "arxiv/arxiv",             name: "arXiv",             author: "arxiv",           category: "research",      description: "Search and summarize research papers from arXiv.",                                                  installCount:  2900, tags: ["research", "papers", "science", "arxiv"] },

  // ── SYSTEM / LOCAL ───────────────────────────────────────────────────────
  { slug: "filesystem/local",        name: "Local Files",       author: "filesystem",      category: "system",        description: "Read, write, list, and manage files and directories on your machine.",                                installCount: 12100, tags: ["files", "local", "filesystem", "system"] },
  { slug: "shell/execute",           name: "Shell Execute",     author: "shell",           category: "system",        description: "Run shell commands and scripts locally (requires confirmation).",                                    installCount:  9300, tags: ["shell", "bash", "terminal", "system"] },
  { slug: "code/interpreter",        name: "Code Interpreter",  author: "code",            category: "system",        description: "Execute Python or JavaScript locally — analyse data, run scripts, compute results in real time.",    installCount:  7400, tags: ["python", "code", "execute", "scripts", "data-analysis"] },
  { slug: "browser/puppeteer",       name: "Browser Control",   author: "browser",         category: "system",        description: "Automate web browsers — scrape, fill forms, take screenshots.",                                     installCount:  4800, tags: ["browser", "puppeteer", "automation", "scrape"] },
  { slug: "ntfy/ntfy",               name: "ntfy",              author: "ntfy",            category: "system",        description: "Push notifications to your phone or desktop via ntfy — triggered by any AI action or alert.",       installCount:  3300, tags: ["ntfy", "notifications", "push", "alerts", "self-hosted"] },

  // ── AI / AGENTS ──────────────────────────────────────────────────────────
  { slug: "ollama/ollama",           name: "Ollama Control",    author: "ollama",          category: "ai",            description: "Manage Ollama models, pull new models, and monitor local inference.",                                 installCount:  8700, tags: ["ollama", "models", "llm", "local-ai"] },
  { slug: "openai/gpt",              name: "OpenAI GPT",        author: "openai",          category: "ai",            description: "Route prompts to OpenAI models (GPT-4o, o1, etc.) with full tool-calling support.",                  installCount:  6900, tags: ["openai", "gpt", "cloud-ai"] },
  { slug: "anthropic/claude",        name: "Anthropic Claude",  author: "anthropic",       category: "ai",            description: "Route prompts to Claude 3.5 Sonnet and Haiku — excellent for analysis and long-context tasks.",     installCount:  5600, tags: ["anthropic", "claude", "cloud-ai", "sonnet"] },
  { slug: "memory/vector",           name: "Vector Memory",     author: "memory",          category: "ai",            description: "Semantic search and retrieval across your personal memory store.",                                   installCount:  5100, tags: ["memory", "vectors", "embeddings", "rag"] },
  { slug: "whisper/transcribe",      name: "Whisper STT",       author: "whisper",         category: "ai",            description: "Transcribe audio files locally using Whisper — meetings, voice memos, podcasts.",                   installCount:  6200, tags: ["whisper", "speech-to-text", "transcription", "local-ai", "audio"] },
  { slug: "elevenlabs/tts",          name: "ElevenLabs TTS",    author: "elevenlabs",      category: "ai",            description: "Generate lifelike voice responses with ElevenLabs — give JARVIS a custom voice.",                   installCount:  4800, tags: ["elevenlabs", "tts", "voice", "speech", "jarvis"] },
  { slug: "comfyui/comfyui",         name: "ComfyUI",           author: "comfyui",         category: "ai",            description: "Run local Stable Diffusion image generation workflows via ComfyUI API.",                            installCount:  3900, tags: ["comfyui", "stable-diffusion", "image", "local-ai", "generation"] },

  // ── MEDIA / CONTENT ──────────────────────────────────────────────────────
  { slug: "spotify/spotify",         name: "Spotify",           author: "spotify",         category: "media",         description: "Play, pause, skip, and search Spotify — 'JARVIS, play something chill to code to'.",                installCount:  9400, tags: ["spotify", "music", "playback", "streaming"] },
  { slug: "youtube/summarize",       name: "YouTube Summarizer",author: "youtube",         category: "media",         description: "Download transcripts and generate summaries of YouTube videos.",                                    installCount:  4600, tags: ["youtube", "video", "summarize", "media"] },
  { slug: "obs/studio",              name: "OBS Studio",        author: "obs",             category: "media",         description: "Control OBS Studio — start/stop streams and recordings, switch scenes from your assistant.",       installCount:  3100, tags: ["obs", "streaming", "recording", "broadcast", "media"] },
  { slug: "image/generate",          name: "Image Generate",    author: "image",           category: "media",         description: "Generate images with Stable Diffusion or DALL-E from text prompts.",                               installCount:  5800, tags: ["image", "generation", "stable-diffusion", "dalle"] },
  { slug: "pdf/reader",              name: "PDF Reader",        author: "pdf",             category: "media",         description: "Extract and summarize text from PDF files.",                                                       installCount:  7100, tags: ["pdf", "documents", "extract", "read"] },

  // ── HOMELAB ──────────────────────────────────────────────────────────────
  { slug: "home-assistant/hass",     name: "Home Assistant",    author: "home-assistant",  category: "homelab",       description: "Control smart home devices, automations, scenes, and sensors via Home Assistant.",                   installCount:  9200, tags: ["home-assistant", "smart-home", "iot", "automation", "jarvis"] },
  { slug: "tailscale/tailscale",     name: "Tailscale",         author: "tailscale",       category: "homelab",       description: "View mesh network peers, check VPN status, and manage Tailscale devices.",                         installCount:  5600, tags: ["tailscale", "vpn", "networking", "mesh", "homelab"] },
  { slug: "grafana/grafana",         name: "Grafana",           author: "grafana",         category: "homelab",       description: "Query Grafana dashboards and Prometheus metrics — ask about CPU, memory, or any time-series data.", installCount:  5200, tags: ["grafana", "monitoring", "metrics", "prometheus", "dashboards"] },
  { slug: "portainer/portainer",     name: "Portainer",         author: "portainer",       category: "homelab",       description: "Manage Docker containers, stacks, and volumes via Portainer — pairs with the Docker skill.",       installCount:  4600, tags: ["portainer", "docker", "containers", "ui", "homelab"] },
  { slug: "proxmox/proxmox",         name: "Proxmox VE",        author: "proxmox",         category: "homelab",       description: "Manage VMs, LXC containers, storage, and node health on Proxmox Virtual Environment.",            installCount:  3100, tags: ["proxmox", "vm", "virtualization", "homelab", "server"] },
  { slug: "nextcloud/nextcloud",     name: "Nextcloud",         author: "nextcloud",       category: "homelab",       description: "Browse files, manage contacts and calendar, and share links via your self-hosted Nextcloud.",      installCount:  4300, tags: ["nextcloud", "cloud", "files", "self-hosted", "storage"] },
  { slug: "immich/immich",           name: "Immich",            author: "immich",          category: "homelab",       description: "Search your self-hosted photo library — 'JARVIS, find photos from my trip to Tokyo last year'.",  installCount:  3800, tags: ["immich", "photos", "memories", "self-hosted", "gallery"] },
  { slug: "pihole/pihole",           name: "Pi-hole",           author: "pihole",          category: "homelab",       description: "Check DNS stats, manage blocklists, and control ad-blocking on your Pi-hole instance.",           installCount:  6100, tags: ["pihole", "dns", "ad-blocking", "privacy", "homelab"] },
  { slug: "uptimekuma/monitor",      name: "Uptime Kuma",       author: "uptimekuma",      category: "homelab",       description: "Check uptime status of all monitored services and get incident history from Uptime Kuma.",         installCount:  4900, tags: ["uptime-kuma", "monitoring", "status", "self-hosted", "alerts"] },
  { slug: "plex/plex",               name: "Plex",              author: "plex",            category: "homelab",       description: "Browse your Plex library, control playback, and manage media from your assistant.",               installCount:  4400, tags: ["plex", "media", "streaming", "homelab"] },
  { slug: "jellyfin/jellyfin",       name: "Jellyfin",          author: "jellyfin",        category: "homelab",       description: "Self-hosted media control — browse libraries, manage users, and control playback.",               installCount:  3700, tags: ["jellyfin", "media", "self-hosted", "homelab"] },
  { slug: "overseerr/overseerr",     name: "Overseerr",         author: "overseerr",       category: "homelab",       description: "Request movies and TV shows — JARVIS sends them to Radarr/Sonarr to download automatically.",     installCount:  3200, tags: ["overseerr", "media-requests", "plex", "jellyfin", "radarr", "sonarr"] },
  { slug: "paperless/paperless-ngx", name: "Paperless-ngx",     author: "paperless",       category: "homelab",       description: "Search your document inbox — 'JARVIS, find the invoice from last month'.",                        installCount:  2900, tags: ["paperless", "documents", "ocr", "archive", "self-hosted"] },
  { slug: "wol/wake-on-lan",         name: "Wake-on-LAN",       author: "wol",             category: "homelab",       description: "Power on any machine on your network by name — 'JARVIS, wake the gaming PC'.",                    installCount:  3500, tags: ["wol", "wake-on-lan", "power", "network", "homelab"] },
  { slug: "zigbee2mqtt/z2m",         name: "Zigbee2MQTT",       author: "zigbee2mqtt",     category: "homelab",       description: "Control Zigbee devices directly — lights, sensors, switches — without a cloud gateway.",          installCount:  2700, tags: ["zigbee", "mqtt", "smart-home", "iot", "self-hosted"] },
  { slug: "frigate/nvr",             name: "Frigate NVR",       author: "frigate",         category: "homelab",       description: "Query your AI security cameras — 'JARVIS, did anyone approach the front door today?'.",           installCount:  2400, tags: ["frigate", "cameras", "nvr", "security", "ai", "homelab"] },

  // ── AUTOMATION ───────────────────────────────────────────────────────────
  { slug: "n8n/n8n",                 name: "N8N",               author: "n8n",             category: "automation",    description: "Trigger and inspect N8N workflow automations — self-hosted Zapier with 400+ integrations.",        installCount:  5700, tags: ["n8n", "automation", "workflows", "self-hosted", "integrations"] },
  { slug: "nodered/nodered",         name: "Node-RED",          author: "nodered",         category: "automation",    description: "Deploy and control Node-RED flows for IoT, home automation, and data pipelines.",                 installCount:  3900, tags: ["node-red", "automation", "iot", "flows", "homelab"] },

  // ── SECURITY ─────────────────────────────────────────────────────────────
  { slug: "bitwarden/bitwarden",     name: "Bitwarden",         author: "bitwarden",       category: "security",      description: "Look up passwords and secure notes from your Bitwarden vault (read-only by default).",           installCount:  4900, tags: ["bitwarden", "passwords", "secrets", "security", "vault"] },
  { slug: "onepassword/1password",   name: "1Password",         author: "onepassword",     category: "security",      description: "Retrieve credentials and secure notes from your 1Password vaults (read-only).",                 installCount:  4300, tags: ["1password", "passwords", "secrets", "security", "vault"] },
  { slug: "vaultwarden/vw",          name: "Vaultwarden",       author: "vaultwarden",     category: "security",      description: "Self-hosted Bitwarden-compatible vault — manage items and collections on your own server.",      installCount:  2100, tags: ["vaultwarden", "bitwarden", "self-hosted", "passwords", "vault"] },
];

export default router;
