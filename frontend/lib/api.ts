import type { Analysis, AnalysisSection, DcfAssumptions, SecuritySearchResult, StockPriceHistory } from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "/api/v1";
const overviewRequests = new Map<string, Promise<Analysis>>();
const fullAnalysisRequests = new Map<string, Promise<Analysis>>();

function waitForPromise<T>(promise: Promise<T>, signal?: AbortSignal, timeoutMs?: number): Promise<T> {
  if (!signal && timeoutMs == null) return promise;
  if (signal?.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
  return new Promise<T>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    };
    const fail = (error: unknown) => { cleanup(); reject(error); };
    const abort = () => fail(new DOMException("Aborted", "AbortError"));
    signal?.addEventListener("abort", abort, { once: true });
    if (timeoutMs != null) timer = setTimeout(() => fail(new Error("Research request timed out. Please retry.")), timeoutMs);
    promise.then((value) => { cleanup(); resolve(value); }, fail);
  });
}

async function parsePayload(response: Response) {
  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new Error("The research service returned an invalid response. Please retry.");
  }
  if (!response.ok) {
    const detail = typeof payload?.detail === "string" ? payload.detail : payload?.detail?.message;
    throw new Error(detail || "The research service could not complete this request.");
  }
  return payload;
}

async function parseResponse(response: Response): Promise<Analysis> {
  const payload = await parsePayload(response);
  return payload.data as Analysis;
}

async function boundedRequest<T>(url: string, init: RequestInit, parse: (response: Response) => Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const controller = new AbortController();
  try {
    return await waitForPromise(fetch(url, { ...init, signal: controller.signal }).then(parse), signal, 45_000);
  } finally {
    controller.abort();
  }
}

async function requestAnalysis(ticker: string, signal: AbortSignal | undefined, scope: AnalysisSection | "full", forceRefresh = false) {
  const params = new URLSearchParams();
  if (scope !== "full") params.set("view", scope);
  const query = params.size ? `?${params}` : "";
  return boundedRequest(`${API_URL}/companies/${encodeURIComponent(ticker)}/analysis${query}`, {
    method: forceRefresh ? "POST" : "GET",
    cache: forceRefresh ? "no-store" : undefined,
  }, parseResponse, signal);
}

export function warmAnalysis(ticker: string): Promise<Analysis> {
  const key = ticker.trim().toUpperCase();
  const existing = fullAnalysisRequests.get(key);
  if (existing) return existing;
  const request = requestAnalysis(key, undefined, "full");
  fullAnalysisRequests.set(key, request);
  void request.finally(() => {
    if (fullAnalysisRequests.get(key) === request) fullAnalysisRequests.delete(key);
  }).catch(() => undefined);
  return request;
}

export function fetchAnalysis(ticker: string, signal?: AbortSignal, scope: AnalysisSection | "full" = "full", forceRefresh = false): Promise<Analysis> {
  const key = ticker.trim().toUpperCase();
  if (forceRefresh) return requestAnalysis(key, signal, scope, true);
  if (scope !== "overview") {
    const warming = fullAnalysisRequests.get(key);
    if (warming) {
      if (scope === "full") return waitForPromise(warming, signal);
      // A selected page must not wait for unrelated providers in the full warm.
      const shared = waitForPromise(warming, signal, 300);
      return shared.catch((error) => {
        if (signal?.aborted) throw error;
        return requestAnalysis(key, signal, scope);
      });
    }
    if (scope === "full") return waitForPromise(warmAnalysis(key), signal);
    return requestAnalysis(key, signal, scope);
  }
  const existing = overviewRequests.get(key);
  if (existing) return waitForPromise(existing, signal);
  const request = requestAnalysis(key, undefined, scope);
  overviewRequests.set(key, request);
  void request.finally(() => {
    if (overviewRequests.get(key) === request) overviewRequests.delete(key);
  }).catch(() => undefined);
  return waitForPromise(request, signal);
}

export function prefetchAnalysis(ticker: string) {
  void fetchAnalysis(ticker, undefined, "overview").catch(() => undefined);
}

export async function runValuation(ticker: string, assumptions: DcfAssumptions): Promise<Analysis> {
  return boundedRequest(`${API_URL}/companies/${encodeURIComponent(ticker)}/valuation`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ assumptions }),
  }, parseResponse);
}

export async function searchSecurities(query: string, signal?: AbortSignal): Promise<SecuritySearchResult[]> {
  return boundedRequest(`${API_URL}/search?q=${encodeURIComponent(query)}&limit=8`, {
    cache: "no-store",
  }, async (response) => {
    const payload = await parsePayload(response);
    if (!Array.isArray(payload)) throw new Error("Security search returned an invalid response. Please retry.");
    return payload as SecuritySearchResult[];
  }, signal);
}

export async function fetchStockPriceHistory(ticker: string, range: "1d" | "1y" | "5y" | "max" = "1y", signal?: AbortSignal): Promise<StockPriceHistory> {
  return boundedRequest(`${API_URL}/companies/${encodeURIComponent(ticker)}/price-history?range=${range}`, {}, async (response) => {
    const payload = await parsePayload(response);
    if (!Array.isArray(payload?.data?.points)) throw new Error("Price history returned an invalid response. Please retry.");
    return payload.data as StockPriceHistory;
  }, signal);
}
