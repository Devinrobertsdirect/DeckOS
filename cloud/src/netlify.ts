/**
 * netlify.ts — Nobi Cloud as a Netlify Function (v2) behind the site.
 *
 * Declares its own path (/api/*), so the pages call the cloud on their own
 * origin — no CORS, no second host, no Replit. Storage is Netlify Blobs
 * (blob-store.ts): v2 functions get the full Blobs environment, including the
 * strongly-consistent endpoint, which handler-style functions do not.
 * The Web Request is translated into the Lambda shape serverless-http speaks,
 * and its result back into a Response. The WebSocket relay isn't available
 * here — the shop, the web face and "sync my Nobi" are plain HTTP.
 */
import serverless from "serverless-http";
import { createApp } from "./app.js";
import { BlobStore } from "./blob-store.js";

type LambdaResult = { statusCode: number; headers?: Record<string, string>; multiValueHeaders?: Record<string, string[]>; body?: string; isBase64Encoded?: boolean };
type LambdaHandler = (event: unknown, context: unknown) => Promise<LambdaResult>;
let cached: LambdaHandler | null = null;

export default async (request: Request): Promise<Response> => {
  if (!cached) {
    const { app } = createApp(new BlobStore());
    cached = serverless(app, { binary: ["audio/*", "image/*", "application/octet-stream"] }) as unknown as LambdaHandler;
  }
  const url = new URL(request.url);
  // Serve both the declared /api/* path and a direct function call.
  const path = url.pathname.replace(/^\/\.netlify\/functions\/cloud(?=\/|$)/, "").replace(/^\/api(?=\/|$)/, "") || "/";
  const headers: Record<string, string> = {};
  request.headers.forEach((v, k) => { headers[k] = v; });
  const body = Buffer.from(await request.arrayBuffer());
  const event = {
    httpMethod: request.method, path, rawUrl: request.url, headers,
    queryStringParameters: Object.fromEntries(url.searchParams), multiValueQueryStringParameters: {},
    body: body.toString("base64"), isBase64Encoded: true,
    requestContext: { identity: { sourceIp: headers["x-nf-client-connection-ip"] ?? headers["x-forwarded-for"]?.split(",")[0]?.trim() ?? "" } },
  };
  const res = await cached(event, {});
  const out = res.isBase64Encoded ? Buffer.from(res.body ?? "", "base64") : (res.body ?? "");
  const h = new Headers();
  for (const [k, v] of Object.entries(res.headers ?? {})) h.set(k, String(v));
  for (const [k, vs] of Object.entries(res.multiValueHeaders ?? {})) for (const v of vs) h.append(k, String(v));
  return new Response(out, { status: res.statusCode, headers: h });
};

export const config = { path: "/api/*" };
