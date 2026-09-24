import { requestProviderText } from "./provider-http.ts";

export const googleNewsClient = {
  getIndustryFeed(query: string, ticker?: string | null) {
    const params = new URLSearchParams({ q: `${query} stocks`, hl: "en-US", gl: "US", ceid: "US:en" });
    return requestProviderText({
      provider: "Google News",
      operation: "industry_news",
      ticker,
      url: `https://news.google.com/rss/search?${params}`,
      headers: {
        Accept: "application/rss+xml, application/xml, text/xml",
        "User-Agent": "Mozilla/5.0 (compatible; BullCase/0.2; financial research)",
      },
      timeoutMs: 7_000,
    });
  },
};
