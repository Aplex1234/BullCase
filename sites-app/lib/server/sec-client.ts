import { requestProviderJson, requestProviderText } from "./provider-http.ts";
import { fetchSecResource } from "./scaling-protection.ts";

const SEC_DATA_BASE = "https://data.sec.gov";
const SEC_WWW_BASE = "https://www.sec.gov";

function secHeaders(accept: string): HeadersInit {
  return {
    "User-Agent": process.env.SEC_USER_AGENT ?? "BullCase/0.1 (contact not configured)",
    Accept: accept,
  };
}

export const secClient = {
  getSecurityMaster<T>() {
    return requestProviderJson<T>({
      provider: "SEC",
      operation: "security_master",
      url: `${SEC_WWW_BASE}/files/company_tickers_exchange.json`,
      headers: secHeaders("application/json"),
      timeoutMs: 10_000,
      fetcher: fetchSecResource,
    });
  },
  getCompanyFacts<T>(cik: string, ticker: string) {
    return requestProviderJson<T>({
      provider: "SEC",
      operation: "company_facts",
      ticker,
      url: `${SEC_DATA_BASE}/api/xbrl/companyfacts/CIK${cik}.json`,
      headers: secHeaders("application/json"),
      timeoutMs: 12_000,
      fetcher: fetchSecResource,
    });
  },
  getSubmissions<T>(cik: string, ticker: string, timeoutMs = 12_000) {
    return requestProviderJson<T>({
      provider: "SEC",
      operation: "submissions",
      ticker,
      url: `${SEC_DATA_BASE}/submissions/CIK${cik}.json`,
      headers: secHeaders("application/json"),
      timeoutMs,
      fetcher: fetchSecResource,
    });
  },
  getFilingDocument(url: string, ticker?: string | null) {
    return requestProviderText({
      provider: "SEC",
      operation: "filing_document",
      ticker,
      url,
      headers: secHeaders("text/html,application/xhtml+xml"),
      timeoutMs: 10_000,
      fetcher: fetchSecResource,
    });
  },
};
