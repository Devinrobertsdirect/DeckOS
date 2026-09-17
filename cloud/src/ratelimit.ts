/*
 * ratelimit.ts — tiny in-process fixed-window rate limiter (no deps).
 *
 * Good enough to stop brute-force, enumeration, and cost-amplification abuse on
 * a single-process deployment. For a multi-instance deployment, swap the Map for
 * a shared store (Redis) behind the same middleware shape.
 */
import type { Request, Response, NextFunction } from "express";

type Bucket = { count: number; reset: number };

export function rateLimit(opts: {
  windowMs: number;
  max: number;
  key: (req: Request) => string;
  name?: string;
}) {
  const hits = new Map<string, Bucket>();
  let lastSweep = 0;

  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    // Opportunistic cleanup so the map can't grow without bound.
    if (now - lastSweep > opts.windowMs) {
      for (const [k, b] of hits) if (now > b.reset) hits.delete(k);
      lastSweep = now;
    }
    const k = `${opts.name ?? "rl"}:${opts.key(req)}`;
    let b = hits.get(k);
    if (!b || now > b.reset) {
      b = { count: 0, reset: now + opts.windowMs };
      hits.set(k, b);
    }
    b.count++;
    if (b.count > opts.max) {
      res.setHeader("Retry-After", Math.ceil((b.reset - now) / 1000));
      res.status(429).json({ error: "rate_limited", retryAfterMs: b.reset - now });
      return;
    }
    next();
  };
}

/** Key by client IP (needs `app.set('trust proxy', …)` behind a proxy). */
export const byIp = (req: Request): string => req.ip || req.socket.remoteAddress || "unknown";
