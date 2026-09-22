export const EDGE_CACHEABLE_HEADER = "x-aplex-edge-cacheable";
const EDGE_CACHE_STATUS_HEADER = "x-aplex-edge-cache";

const ANALYSIS_VIEWS = new Set([
  "overview", "financials", "valuation", "buyTarget", "comps",
  "earnings", "news", "filings", "risks", "research",
]);
const PRICE_RANGES = new Set(["1d", "1y", "5y", "max"]);

export type EdgeCachePolicy = { kind: "analysis" | "price-history" };

export type EdgeCacheLike = {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
  delete(request: Request): Promise<boolean>;
};

function hasOnlySearchParams(url: URL, allowed: Set<string>) {
  return [...url.searchParams.keys()].every((key) => allowed.has(key));
}

export function edgeCachePolicy(request: Request): EdgeCachePolicy | null {
  if (request.method !== "GET") return null;
  if (request.headers.has("authorization") || request.headers.has("cookie")) return null;
  const url = new URL(request.url);
  if (/^\/api\/v1\/companies\/[^/]+\/analysis$/.test(url.pathname)) {
    if (!hasOnlySearchParams(url, new Set(["view"]))) return null;
    const view = url.searchParams.get("view");
    return view == null || ANALYSIS_VIEWS.has(view) ? { kind: "analysis" } : null;
  }
  if (/^\/api\/v1\/companies\/[^/]+\/price-history$/.test(url.pathname)) {
    if (!hasOnlySearchParams(url, new Set(["range"]))) return null;
    const range = url.searchParams.get("range");
    return range == null || PRICE_RANGES.has(range) ? { kind: "price-history" } : null;
  }
  return null;
}

export function edgeCacheKey(request: Request) {
  const url = new URL(request.url);
  const match = url.pathname.match(/^(\/api\/v1\/companies\/)([^/]+)(\/(?:analysis|price-history))$/);
  if (match) {
    const ticker = decodeURIComponent(match[2]).trim().toUpperCase().replaceAll(".", "-");
    url.pathname = `${match[1]}${encodeURIComponent(ticker)}${match[3]}`;
  }
  url.searchParams.sort();
  return new Request(url.toString(), { method: "GET" });
}

function responseWithHeaders(response: Response, update: (headers: Headers) => void) {
  const headers = new Headers(response.headers);
  update(headers);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function matchEdgeApiResponse(request: Request, cache: EdgeCacheLike) {
  if (!edgeCachePolicy(request)) return null;
  const cached = await cache.match(edgeCacheKey(request));
  if (!cached) return null;
  const headers = new Headers(cached.headers);
  headers.set(EDGE_CACHE_STATUS_HEADER, "HIT");
  headers.set("Server-Timing", "edge-cache;desc=HIT");
  if (request.headers.get("if-none-match") && request.headers.get("if-none-match") === cached.headers.get("etag")) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(cached.body, {
    status: cached.status,
    statusText: cached.statusText,
    headers,
  });
}

export function isEdgeCacheableResponse(response: Response) {
  const cacheControl = response.headers.get("cache-control") ?? "";
  return response.status === 200
    && response.headers.get(EDGE_CACHEABLE_HEADER) !== "no"
    && /(?:^|,)\s*public\b/i.test(cacheControl)
    && !response.headers.has("set-cookie");
}

export function prepareEdgeCachedResponse(response: Response) {
  return responseWithHeaders(response, (headers) => {
    headers.delete(EDGE_CACHEABLE_HEADER);
    headers.delete(EDGE_CACHE_STATUS_HEADER);
  });
}

export function prepareEdgeClientResponse(response: Response, status: "MISS" | "BYPASS") {
  return responseWithHeaders(response, (headers) => {
    headers.delete(EDGE_CACHEABLE_HEADER);
    headers.set(EDGE_CACHE_STATUS_HEADER, status);
    const timing = headers.get("Server-Timing");
    headers.set("Server-Timing", [timing, `edge-cache;desc=${status}`].filter(Boolean).join(", "));
  });
}

export function analysisEdgeCacheKeys(request: Request) {
  const url = new URL(edgeCacheKey(request).url);
  const path = url.pathname;
  const views = [null, ...ANALYSIS_VIEWS];
  return views.map((view) => {
    const candidate = new URL(path, url.origin);
    if (view) candidate.searchParams.set("view", view);
    return new Request(candidate.toString(), { method: "GET" });
  });
}
