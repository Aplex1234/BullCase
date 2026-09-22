export type ProviderName = "SEC" | "Nasdaq" | "Yahoo Finance" | "Google News" | "Federal Reserve";
export type ProviderErrorCategory =
  | "provider_unavailable"
  | "provider_throttled"
  | "provider_timeout"
  | "provider_invalid_response";
export type ApplicationErrorCode =
  | "invalid_ticker"
  | "invalid_request"
  | "financial_data_unavailable"
  | "source_data_unavailable"
  | "cache_failure";

export class ApplicationError extends Error {
  readonly code: ApplicationErrorCode;
  readonly status: number;
  readonly publicMessage: string;

  constructor(code: ApplicationErrorCode, publicMessage: string, status: number, options?: ErrorOptions) {
    super(publicMessage, options);
    this.name = "ApplicationError";
    this.code = code;
    this.status = status;
    this.publicMessage = publicMessage;
  }
}

export class InvalidTickerError extends ApplicationError {
  constructor(ticker: string) {
    super("invalid_ticker", `Ticker ${ticker} was not found.`, 404);
    this.name = "InvalidTickerError";
  }
}

export class InvalidRequestError extends ApplicationError {
  constructor(message: string) {
    super("invalid_request", message, 422);
    this.name = "InvalidRequestError";
  }
}

export class FinancialDataUnavailableError extends ApplicationError {
  constructor(ticker: string) {
    super("financial_data_unavailable", `Financial data is unavailable for ${ticker}.`, 422);
    this.name = "FinancialDataUnavailableError";
  }
}

export class FinancialModelInputError extends ApplicationError {
  constructor() {
    super("financial_data_unavailable", "Required financial inputs are unavailable for this company.", 422);
    this.name = "FinancialModelInputError";
  }
}

export class SourceDataUnavailableError extends ApplicationError {
  constructor(message: string) {
    super("source_data_unavailable", message, 422);
    this.name = "SourceDataUnavailableError";
  }
}

export class CacheFailureError extends ApplicationError {
  constructor(options?: ErrorOptions) {
    super("cache_failure", "Cached research is temporarily unavailable.", 503, options);
    this.name = "CacheFailureError";
  }
}

export class ProviderRequestError extends Error {
  readonly provider: ProviderName;
  readonly operation: string;
  readonly category: ProviderErrorCategory;
  readonly ticker: string | null;
  readonly status: number | null;
  readonly requestId: string | null;
  readonly retryAfterSeconds: number | null;

  constructor(options: {
    provider: ProviderName;
    operation: string;
    category: ProviderErrorCategory;
    ticker?: string | null;
    status?: number | null;
    requestId?: string | null;
    retryAfterSeconds?: number | null;
    message: string;
    cause?: unknown;
  }) {
    super(options.message, { cause: options.cause });
    this.name = `${options.provider.replaceAll(" ", "")}ProviderError`;
    this.provider = options.provider;
    this.operation = options.operation;
    this.category = options.category;
    this.ticker = options.ticker ?? null;
    this.status = options.status ?? null;
    this.requestId = options.requestId ?? null;
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
  }
}

export type PublicApiError = {
  status: number;
  code: ApplicationErrorCode | ProviderErrorCategory | "internal_error";
  detail: string;
  retryAfterSeconds?: number;
};

export function toPublicApiError(error: unknown, fallbackDetail: string): PublicApiError {
  if (error instanceof ApplicationError) {
    return { status: error.status, code: error.code, detail: error.publicMessage };
  }
  if (error instanceof ProviderRequestError) {
    const throttled = error.category === "provider_throttled";
    return {
      status: 503,
      code: throttled ? "provider_throttled" : "provider_unavailable",
      detail: throttled
        ? "A required data provider is busy. Please try again shortly."
        : "A required data provider is temporarily unavailable. Please try again.",
      ...(error.retryAfterSeconds == null ? {} : { retryAfterSeconds: error.retryAfterSeconds }),
    };
  }
  return { status: 500, code: "internal_error", detail: fallbackDetail };
}

export function safeProviderWarning(error: unknown, fallback: string) {
  if (error instanceof ProviderRequestError) {
    return error.category === "provider_throttled"
      ? "The live provider is busy."
      : "The live provider is temporarily unavailable.";
  }
  if (error instanceof ApplicationError) return error.publicMessage;
  return fallback;
}
