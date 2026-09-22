import { normalizeTicker, resolveSecurity } from "./security-master.ts";
import { extractRiskFactorThemes } from "./risk-factors.ts";
import { summarizeCompanyDescription } from "./company-description.ts";
import { extractPeerBusinessContext } from "./peer-selection.ts";
import {
  normalizeCompanyFacts,
  normalizeQuarterlyCompanyFacts,
  type SecCompanyFacts,
} from "./sec-normalizer.ts";
import { FinancialDataUnavailableError } from "./provider-errors.ts";
import { secClient } from "./sec-client.ts";
import { fetchNasdaqProfile } from "./nasdaq-provider.ts";
import type { CompanyRisk, Filing, FinancialFingerprint, FinancialSource } from "./analysis-types.ts";

const RISK_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const riskCache = new Map<string, { expiresAt: number; risks: CompanyRisk[] }>();
const filingDocumentCache = new Map<string, { expiresAt: number; html: string }>();

async function fetchFilingDocumentUrl(sourceUrl: string) {
  const cached = filingDocumentCache.get(sourceUrl);
  if (cached && cached.expiresAt > Date.now()) return cached.html;
  const html = await secClient.getFilingDocument(sourceUrl);
  filingDocumentCache.set(sourceUrl, { expiresAt: Date.now() + RISK_CACHE_TTL_MS, html });
  return html;
}

export async function fetchPeerFilingContext(filing: Filing | undefined) {
  if (!filing) return "";
  return extractPeerBusinessContext(await fetchFilingDocumentUrl(filing.source_url));
}

function fortyFExhibitUrls(html: string, filingUrl: string) {
  const urls: string[] = [];
  for (const match of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = match[1];
    const label = match[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    if (!/(?:ex(?:hibit)?\s*)?99(?:[._-]?1)?|annual information form|\baif\b/i.test(`${href} ${label}`)) continue;
    try {
      const url = new URL(href, filingUrl);
      if (url.protocol !== "https:" || !url.hostname.endsWith("sec.gov")) continue;
      if (!urls.includes(url.toString())) urls.push(url.toString());
    } catch {
      // Ignore malformed exhibit links in filing markup.
    }
  }
  return urls.slice(0, 4);
}

async function fetchFilingRisks(filing: Filing): Promise<CompanyRisk[]> {
  const cached = riskCache.get(filing.source_url);
  if (cached && cached.expiresAt > Date.now()) return cached.risks;

  const primaryHtml = await fetchFilingDocumentUrl(filing.source_url);
  let sourceUrl = filing.source_url;
  let themes = extractRiskFactorThemes(primaryHtml, filing.form, 8);
  if (!themes.length && filing.form === "40-F") {
    for (const exhibitUrl of fortyFExhibitUrls(primaryHtml, filing.source_url)) {
      try {
        const exhibitThemes = extractRiskFactorThemes(await fetchFilingDocumentUrl(exhibitUrl), filing.form, 8);
        if (exhibitThemes.length) {
          themes = exhibitThemes;
          sourceUrl = exhibitUrl;
          break;
        }
      } catch {
        // Continue through the small set of likely Annual Information Form exhibits.
      }
    }
  }
  const item = filing.form === "20-F" ? "Item 3.D" : filing.form === "10-K" ? "Item 1A" : "Risk Factors section";
  if (!themes.length) throw new Error(`No ${item} risk themes could be extracted from ${filing.form}`);
  const risks: CompanyRisk[] = themes.map((theme) => ({
    severity: "filed",
    kind: "filing_theme",
    theme: theme.key,
    title: theme.title,
    detail: theme.summary,
    evidence: theme.evidence,
    item,
    source_url: sourceUrl,
    filing_date: filing.filing_date,
    report_date: filing.report_date,
    accession_number: filing.accession_number,
    form: filing.form,
  }));
  riskCache.set(filing.source_url, { expiresAt: Date.now() + RISK_CACHE_TTL_MS, risks });
  return risks;
}

export async function fetchCompanyRisks(financials: FinancialSource): Promise<CompanyRisk[]> {
  const latestAnnualFiling = financials.filings.find((filing) => ["10-K", "20-F", "40-F"].includes(filing.form));
  return latestAnnualFiling ? fetchFilingRisks(latestAnnualFiling) : [];
}

export async function fetchFinancialFingerprint(rawTicker: string): Promise<FinancialFingerprint> {
  const ticker = normalizeTicker(rawTicker);
  const identity = await resolveSecurity(ticker);
  const submissions = await secClient.getSubmissions<{ filings?: { recent?: Record<string, string[]> } }>(identity.cik, ticker, 10_000);
  const recent = submissions.filings?.recent ?? {};
  const index = (recent.form ?? []).findIndex((form) => ["10-K", "10-Q", "20-F", "40-F"].includes(form));
  if (index < 0) return { accessionNumber: "none", filingDate: null, form: null };
  return {
    accessionNumber: recent.accessionNumber?.[index] ?? "none",
    filingDate: recent.filingDate?.[index] ?? null,
    form: recent.form?.[index] ?? null,
  };
}

export async function fetchFinancialSource(ticker: string, includeRisks = true): Promise<FinancialSource> {
  const identity = await resolveSecurity(ticker);
  const cik = identity.cik;
  const [facts, submissions, nasdaqProfile] = await Promise.all([
    secClient.getCompanyFacts<SecCompanyFacts>(cik, ticker),
    secClient.getSubmissions<{
      name?: string;
      sicDescription?: string;
      exchanges?: string[];
      filings?: { recent?: Record<string, string[]> };
    }>(cik, ticker),
    fetchNasdaqProfile(ticker).catch(() => null),
  ]);
  const periods = normalizeCompanyFacts(facts);
  const quarterlyPeriods = normalizeQuarterlyCompanyFacts(facts);
  if (periods.length < 3) throw new FinancialDataUnavailableError(ticker);
  const recent = submissions.filings?.recent ?? {};
  const relevantFilings = (recent.form ?? [])
    .map((form: string, index: number) => ({
      form,
      filing_date: recent.filingDate?.[index] ?? null,
      report_date: recent.reportDate?.[index] ?? null,
      accession_number: recent.accessionNumber?.[index] ?? "",
      source_url: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${String(recent.accessionNumber?.[index] ?? "").replaceAll("-", "")}/${recent.primaryDocument?.[index] ?? ""}`,
    }))
    .filter((item: Filing) => ["10-K", "10-Q", "8-K", "20-F", "40-F", "6-K"].includes(item.form));
  const filings = relevantFilings.slice(0, 20);
  const latestAnnualFiling = relevantFilings.find((filing: Filing) => ["10-K", "20-F", "40-F"].includes(filing.form));
  const filingRisks = includeRisks && latestAnnualFiling ? await fetchFilingRisks(latestAnnualFiling) : [];
  const companyName = (nasdaqProfile?.name ?? submissions.name ?? identity.name).trim();
  const nasdaqDescription = summarizeCompanyDescription(nasdaqProfile?.description ?? "", companyName);
  const descriptionSource = nasdaqDescription ? "Nasdaq company profile" : "Unavailable";
  const descriptionSourceUrl = nasdaqDescription
    ? `https://www.nasdaq.com/market-activity/stocks/${ticker.toLowerCase()}/company-profile`
    : `https://www.sec.gov/edgar/browse/?CIK=${cik}&owner=exclude`;
  return {
    profile: {
      cik,
      name: companyName,
      sector: nasdaqProfile?.sector ?? null,
      industry: nasdaqProfile?.industry ?? submissions.sicDescription ?? null,
      exchange: submissions.exchanges?.[0] ?? null,
      description: nasdaqDescription,
      description_source: descriptionSource,
      description_source_url: descriptionSourceUrl,
    },
    periods,
    quarterlyPeriods,
    filings,
    filingRisks,
  };
}
