import {
  ProviderRequestError,
  type ProviderErrorCategory,
  type ProviderName,
} from "./provider-errors.ts";

export type ProviderRequestOptions = {
  provider: ProviderName;
  operation: string;
  url: string;
  ticker?: string | null;
  headers?: HeadersInit;
  timeoutMs: number;
  retries?: number;
  fetcher?: typeof fetch;
};

function requestIdFrom(response: Response | null) {
  return response?.headers.get("cf-ray")
    ?? response?.headers.get("x-request-id")
    ?? response?.headers.get("x-correlation-id")
    ?? null;
}

function retryAfterSeconds(response: Response | null) {
  const raw = response?.headers.get("retry-after");
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.max(1, Math.ceil((date - Date.now()) / 1000)) : null;
}

function errorCategory(error: unknown, response: Response | null): ProviderErrorCategory {
  if (response?.status === 429) return "provider_throttled";
  if (error instanceof SyntaxError) return "provider_invalid_response";
  if (error instanceof DOMException && ["AbortError", "TimeoutError"].includes(error.name)) return "provider_timeout";
  if (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name)) return "provider_timeout";
  return "provider_unavailable";
}

function logProviderFailure(error: ProviderRequestError, durationMs: number) {
  console.warn("[provider] request failed", {
    provider: error.provider,
    ticker: error.ticker,
    operation: error.operation,
    status: error.status,
    requestId: error.requestId,
    durationMs,
    category: error.category,
    message: error.message.slice(0, 300),
  });
}

export function providerInvalidResponse(
  provider: ProviderName,
  operation: string,
  ticker: string | null,
  message: string,
) {
  const error = new ProviderRequestError({
    provider,
    operation,
    category: "provider_invalid_response",
    ticker,
    message,
  });
  logProviderFailure(error, 0);
  return error;
}

async function providerRequest<T>(options: ProviderRequestOptions, parse: (response: Response) => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  const fetcher = options.fetcher ?? fetch;
  const maxAttempts = Math.max(1, Math.trunc(options.retries ?? 0) + 1);
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let response: Response | null = null;
    try {
      response = await fetcher(options.url, {
        headers: options.headers,
        signal: AbortSignal.timeout(options.timeoutMs),
      });
      if (!response.ok) throw new Error(`${options.provider} ${options.operation} returned ${response.status}`);
      return await parse(response);
    } catch (error) {
      lastError = error;
      const category = errorCategory(error, response);
      const retryable = category === "provider_throttled" || category === "provider_unavailable";
      if (attempt < maxAttempts && retryable) continue;
      const providerError = error instanceof ProviderRequestError
        ? error
        : new ProviderRequestError({
            provider: options.provider,
            operation: options.operation,
            category,
            ticker: options.ticker,
            status: response?.status ?? null,
            requestId: requestIdFrom(response),
            retryAfterSeconds: retryAfterSeconds(response),
            message: error instanceof Error ? error.message : `${options.provider} request failed`,
            cause: error,
          });
      logProviderFailure(providerError, Date.now() - startedAt);
      throw providerError;
    }
  }

  throw lastError;
}

export function requestProviderJson<T>(options: ProviderRequestOptions) {
  return providerRequest(options, (response) => response.json() as Promise<T>);
}

export function requestProviderText(options: ProviderRequestOptions) {
  return providerRequest(options, (response) => response.text());
}
