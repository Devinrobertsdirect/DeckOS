import { Router } from "express";

/**
 * GET /api/yt/resolve?q=<spoken query> — keyless YouTube search.
 *
 * The robot's face is a Chromium kiosk showing our SPA; "robot play <query>"
 * needs a real videoId to hand the in-app IFrame player. The browser can't search
 * YouTube (CORS + the old IFrame search API is dead), so we do it here: fetch the
 * public results page server-side (Node has no CORS), pull the ordered videoIds
 * out of the ytInitialData blob, and return the top few. The client plays ids[0]
 * and auto-advances to ids[1], ids[2]… if a video turns out to be embed-disabled.
 * No YouTube Data API key required. Best-effort + resilient: any failure returns
 * a clean error the overlay can speak.
 */
const router = Router();

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

router.get("/yt/resolve", async (req, res) => {
  const q = String(req.query["q"] ?? "").trim();
  if (!q) {
    res.status(400).json({ ok: false, error: "q required" });
    return;
  }
  try {
    // sp=EgIQAQ%3D%3D restricts to videos; the CONSENT/SOCS cookies skip the EU
    // consent interstitial that would otherwise replace the results markup.
    const url =
      `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}` +
      `&sp=EgIQAQ%253D%253D&gl=US&hl=en`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const r = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": UA,
        "Accept-Language": "en-US,en;q=0.9",
        "Cookie": "CONSENT=YES+cb.20210328-17-p0.en+FX+000; SOCS=CAI",
      },
    }).finally(() => clearTimeout(timer));
    if (!r.ok) {
      res.status(502).json({ ok: false, error: `youtube ${r.status}` });
      return;
    }
    const html = await r.text();

    const ids: string[] = [];
    const seen = new Set<string>();
    const re = /"videoId":"([\w-]{11})"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null && ids.length < 8) {
      const id = m[1]!;
      if (!seen.has(id)) { seen.add(id); ids.push(id); }
    }

    // Best-effort: the first result's title, for the overlay caption.
    let title = "";
    const tm = html.match(/"title":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"/);
    if (tm?.[1]) {
      try { title = JSON.parse(`"${tm[1]}"`); } catch { title = tm[1]; }
    }

    if (ids.length === 0) {
      res.status(404).json({ ok: false, error: "no results", query: q });
      return;
    }
    res.json({ ok: true, query: q, title, ids });
  } catch (err) {
    res.status(502).json({ ok: false, error: String(err) });
  }
});

export default router;
