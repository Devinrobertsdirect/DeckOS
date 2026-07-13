import pino from "pino";

export const isDaemon = process.argv.includes("--daemon");

const usePretty = !isDaemon && process.env["NODE_ENV"] !== "production";

export const logger = pino({
  level: process.env["LOG_LEVEL"] ?? "info",
  ...(usePretty
    ? { transport: { target: "pino-pretty", options: { colorize: true } } }
    : {}),
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']",
  ],
});
