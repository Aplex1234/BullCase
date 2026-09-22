/** Cloudflare Worker entry point for the AplexAnalysis Sites application. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { refreshDueCompanies, warmPopularCompanies } from "../lib/server/analysis-service";
import { pruneCacheEvents } from "../lib/server/analysis-cache";
import { pruneScalingState, stampTrustedClientIdentity } from "../lib/server/scaling-protection";
import {
  analysisEdgeCacheKeys,
  edgeCacheKey,
  edgeCachePolicy,
  isEdgeCacheableResponse,
  matchEdgeApiResponse,
  prepareEdgeCachedResponse,
  prepareEdgeClientResponse,
  type EdgeCacheLike,
} from "../lib/server/edge-cache";

interface Env {
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": "base-uri 'self'; object-src 'none'; frame-ancestors 'self' https://chatgpt.com https://*.chatgpt.com; form-action 'self'",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
};

function getDefaultEdgeCache() {
  if (typeof caches === "undefined" || !("default" in caches)) return null;
  return (caches as unknown as { default: EdgeCacheLike }).default;
}

function withSecurityHeaders(response: Response) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const edgePolicy = edgeCachePolicy(request);
    const edgeCache = edgePolicy ? getDefaultEdgeCache() : null;

    if (edgeCache) {
      try {
        const cachedResponse = await matchEdgeApiResponse(request, edgeCache);
        if (cachedResponse) return withSecurityHeaders(cachedResponse);
      } catch (error) {
        console.warn("[edge-cache] lookup failed; continuing to the application", { error });
      }
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      const response = await handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
      return withSecurityHeaders(response);
    }

    if (request.method === "GET" && url.pathname.startsWith("/_next/static/")) {
      const response = await env.ASSETS.fetch(request);
      if (response.ok) {
        const headers = new Headers(response.headers);
        headers.set("Cache-Control", "public, max-age=31536000, immutable");
        return withSecurityHeaders(new Response(response.body, { status: response.status, statusText: response.statusText, headers }));
      }
    }

    const appRequest = url.pathname.startsWith("/api/") ? await stampTrustedClientIdentity(request) : request;
    const response = await handler.fetch(appRequest, env, ctx);
    if (request.method === "POST" && /\/api\/v1\/companies\/[^/]+\/analysis$/.test(url.pathname) && response.ok) {
      const cache = getDefaultEdgeCache();
      if (cache) {
        ctx.waitUntil(Promise.all(analysisEdgeCacheKeys(request).map((key) => cache.delete(key)))
          .catch((error) => console.warn("[edge-cache] refresh purge failed", { error })));
      }
    }
    if (edgePolicy) {
      const secured = withSecurityHeaders(response);
      const cacheable = edgeCache != null && isEdgeCacheableResponse(secured);
      if (cacheable) {
        ctx.waitUntil(edgeCache.put(edgeCacheKey(request), prepareEdgeCachedResponse(secured.clone()))
          .catch((error) => console.warn("[edge-cache] write failed", { error })));
      }
      return prepareEdgeClientResponse(secured, cacheable ? "MISS" : "BYPASS");
    }
    if (request.method === "GET" && url.pathname === "/" && response.ok) {
      const headers = new Headers(response.headers);
      const signedIn = request.headers.has("oai-authenticated-user-id");
      headers.set("Cache-Control", signedIn ? "private, no-store" : "public, max-age=0, s-maxage=60, stale-while-revalidate=300");
      return withSecurityHeaders(new Response(response.body, { status: response.status, statusText: response.statusText, headers }));
    }
    return withSecurityHeaders(response);
  },
  async scheduled(_controller: unknown, _env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(Promise.all([refreshDueCompanies(8), warmPopularCompanies(100, 2), pruneCacheEvents(30), pruneScalingState()]));
  },
};

export default worker;
