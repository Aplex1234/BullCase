import { requestProviderText } from "./provider-http.ts";

export type PolicyFeed = "monetary" | "banking";
const FEEDS: Record<PolicyFeed, string> = {
  monetary: "https://www.federalreserve.gov/feeds/press_monetary.xml",
  banking: "https://www.federalreserve.gov/feeds/press_bcreg.xml",
};

export function createFederalReserveClient(fetchText = requestProviderText, now = Date.now) {
  const cache = new Map<PolicyFeed, { xml: string; until: number }>();
  const pending = new Map<PolicyFeed, Promise<string>>();
  return {
    getFeed(kind: PolicyFeed): Promise<string> {
      const cached = cache.get(kind);
      if (cached && cached.until > now()) return Promise.resolve(cached.xml);
      const running = pending.get(kind);
      if (running) return running;
      const request = Promise.resolve().then(() => fetchText({
        provider: "Federal Reserve", operation: `policy_${kind}`, url: FEEDS[kind],
        headers: { Accept: "application/rss+xml, text/xml", "User-Agent": "AplexAnalysis/0.2" },
        timeoutMs: 5_000, retries: 0,
      })).then((xml) => {
        if (xml.length > 500_000 || !/<rss\b/i.test(xml) || !/<channel\b/i.test(xml)) throw new Error("Federal Reserve returned an invalid feed");
        cache.set(kind, { xml, until: now() + 30 * 60_000 });
        return xml;
      }).finally(() => pending.delete(kind));
      pending.set(kind, request);
      return request;
    },
  };
}

export const federalReserveClient = createFederalReserveClient();
