import { requestProviderJson } from "./provider-http.ts";

const YAHOO_API_BASE = "https://query1.finance.yahoo.com";
const YAHOO_HEADERS: HeadersInit = {
  "User-Agent": "Mozilla/5.0 (compatible; BullCase/0.1; financial research)",
  Accept: "application/json, text/plain, */*",
};

export const yahooClient = {
  getChart<T>(ticker: string, params: URLSearchParams) {
    return requestProviderJson<T>({
      provider: "Yahoo Finance",
      operation: "price_history",
      ticker,
      url: `${YAHOO_API_BASE}/v8/finance/chart/${encodeURIComponent(ticker)}?${params}`,
      headers: YAHOO_HEADERS,
      timeoutMs: 10_000,
    });
  },
  getCompanyNews<T>(ticker: string) {
    const params = new URLSearchParams({
      q: ticker,
      quotesCount: "0",
      newsCount: "16",
      enableFuzzyQuery: "false",
    });
    return requestProviderJson<T>({
      provider: "Yahoo Finance",
      operation: "company_news",
      ticker,
      url: `${YAHOO_API_BASE}/v1/finance/search?${params}`,
      headers: YAHOO_HEADERS,
      timeoutMs: 7_000,
    });
  },
};
