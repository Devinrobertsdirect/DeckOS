import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const router = Router();

const CONFIG_DIR = path.join(os.homedir(), ".deckos");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

interface StoredConfig {
  provider: string;
  model: string;
  apiKey: string;
  ollamaUrl: string;
  savedAt: string;
}

function readConfig(): StoredConfig | null {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return null;
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8")) as StoredConfig;
  } catch {
    return null;
  }
}

function writeConfig(cfg: StoredConfig): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), "utf-8");
}

router.get("/config", (_req, res) => {
  const cfg = readConfig();
  if (!cfg) {
    res.json({ configured: false });
    return;
  }
  // Return everything except exposing the key length — frontend uses localStorage
  // for the actual key; this endpoint confirms configuration is present server-side.
  res.json({
    configured: true,
    config: {
      provider: cfg.provider,
      model: cfg.model,
      apiKey: cfg.apiKey,
      ollamaUrl: cfg.ollamaUrl,
      savedAt: cfg.savedAt,
    },
  });
});

router.post("/config", (req, res) => {
  const body = req.body as Partial<StoredConfig>;
  const { provider, model, apiKey = "", ollamaUrl = "" } = body;

  if (!provider || !model) {
    res.status(400).json({ error: "provider and model are required" });
    return;
  }

  const cfg: StoredConfig = {
    provider,
    model,
    apiKey,
    ollamaUrl,
    savedAt: new Date().toISOString(),
  };

  writeConfig(cfg);
  res.json({ ok: true });
});

export default router;
