import { requestProviderJson } from "./provider-http.ts";

const NASDAQ_API_BASE = "https://api.nasdaq.com/api";

const NASDAQ_HEADERS: HeadersInit = {
  "User-Agent": "Mozilla/5.0 (compatible; BullCase/0.1; financial research)",
  Accept: "application/json, text/plain, */*",
  Origin: "https://www.nasdaq.com",
  Referer: "https://www.nasdaq.com/",
};

function symbol(ticker: string) {
  return ticker.replaceAll("-", ".");
}

function get<T>(operation: string, path: string, ticker?: string | null, timeoutMs = 8_000) {
  return requestProviderJson<T>({
    provider: "Nasdaq",
    operation,
    ticker,
    url: `${NASDAQ_API_BASE}${path}`,
    headers: NASDAQ_HEADERS,
    timeoutMs,
  });
}

export const nasdaqClient = {
  getCompanyProfile<T>(ticker: string) {
    return get<T>("company_profile", `/company/${symbol(ticker)}/company-profile`, ticker);
  },
  getAnalystForecast<T>(ticker: string) {
    return get<T>("analyst_forecast", `/analyst/${symbol(ticker)}/earnings-forecast`, ticker);
  },
  getStockUniverse<T>(params: URLSearchParams) {
    return get<T>("stock_screener", `/screener/stocks?${params}`, null, 10_000);
  },
  getQuoteInfo<T>(ticker: string) {
    return get<T>("quote_info", `/quote/${symbol(ticker)}/info?assetclass=stocks`, ticker);
  },
  getQuoteSummary<T>(ticker: string) {
    return get<T>("quote_summary", `/quote/${symbol(ticker)}/summary?assetclass=stocks`, ticker);
  },
  getHistorical<T>(ticker: string, params: URLSearchParams) {
    return get<T>("price_history", `/quote/${symbol(ticker)}/historical?${params}`, ticker, 10_000);
  },
  getCompanyNews<T>(ticker: string) {
    const query = encodeURIComponent(`${symbol(ticker)}|stocks`);
    return get<T>("company_news", `/news/topic/articlebysymbol?q=${query}&limit=16&offset=0`, ticker, 7_000);
  },
};
