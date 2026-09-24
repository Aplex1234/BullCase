import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildFinancialGrowthData, financialGrowthValue, FINANCIAL_GROUPS } from "../../frontend/lib/financials.ts";
import { analysisSectionPanelState, mergeAnalysisSection } from "../../frontend/lib/analysis-sections.ts";
import { buildOverviewSnapshot, buildSectionSnapshot } from "../lib/server/analysis-service.ts";

const TERMINAL_SOURCE_FILES = [
  "../../frontend/components/ResearchTerminal.tsx",
  "../../frontend/components/ResearchPages.tsx",
  "../../frontend/components/CompanyHeader.tsx",
  "../../frontend/components/CompanySearch.tsx",
  "../../frontend/components/TerminalHeader.tsx",
  "../../frontend/components/TerminalNavigation.tsx",
  "../../frontend/hooks/useCompanyAnalysis.ts",
  "../../frontend/hooks/useSecuritySearch.ts",
  "../../frontend/hooks/useTerminalTheme.ts",
];

async function readTerminalSources() {
  return (await Promise.all(TERMINAL_SOURCE_FILES.map((file) => (
    readFile(new URL(file, import.meta.url), "utf8")
  )))).join("\n");
}

const ANALYSIS_SOURCE_FILES = [
  "../lib/server/analysis.ts",
  "../lib/server/analysis-types.ts",
  "../lib/server/financial-model.ts",
  "../lib/server/nasdaq-provider.ts",
  "../lib/server/sec-provider.ts",
  "../lib/server/peer-data.ts",
];

async function readAnalysisSources() {
  return (await Promise.all(ANALYSIS_SOURCE_FILES.map((file) => (
    readFile(new URL(file, import.meta.url), "utf8")
  )))).join("\n");
}

test("runtime analysis contains no bundled financial or search substitutions", async () => {
  const runtime = await Promise.all([
    readFile(new URL("../lib/server/analysis.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/server/sec-provider.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/server/security-master.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/server/market-data.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/server/scaling-protection.ts", import.meta.url), "utf8"),
  ]).then((sources) => sources.join("\n"));
  assert.doesNotMatch(runtime, /fallback-data|fallback-snapshot|Bundled historical fallback quote|FALLBACK_ROWS/);
  assert.doesNotMatch(runtime, /const fallback = close|using isolate-local fallback/);
});

test("search provider errors remain visible to the user", async () => {
  const hook = await readFile(new URL("../../frontend/hooks/useSecuritySearch.ts", import.meta.url), "utf8");
  const search = await readFile(new URL("../../frontend/components/CompanySearch.tsx", import.meta.url), "utf8");
  assert.match(hook, /searchError/);
  assert.match(search, /search\.searchError/);
});

async function requestWorker(path = "/", init = {}) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(new URL(path, "http://localhost"), init),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

async function render() {
  return requestWorker("/", { headers: { accept: "text/html" } });
}


test("labels AI Research and separates filing date concepts", async () => {
  const component = await readTerminalSources();
  assert.match(component, /label: "AI Research"/);
  assert.match(component, />Fiscal period</);
  assert.match(component, />Report period ending</);
  assert.match(component, />Filing form</);
  assert.match(component, />Filing date</);
});

test("server-renders the BullCase terminal", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") ?? "", /s-maxage=60/);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>BullCase \| Equity Research Terminal<\/title>/i);
  assert.match(html, /BullCase/);
  assert.match(html, /Ticker or company/);
  assert.match(html, /Research software\. Not investment advice\./);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
});

test("account panel supports sign-in, encrypted provider setup, favorites, and appearance", async () => {
  const profile = await readFile(new URL("../../frontend/components/ProfilePanel.tsx", import.meta.url), "utf8");
  const header = await readFile(new URL("../../frontend/components/TerminalHeader.tsx", import.meta.url), "utf8");
  const favoriteButton = await readFile(new URL("../../frontend/components/FavoriteButton.tsx", import.meta.url), "utf8");
  const navigation = await readFile(new URL("../../frontend/components/TerminalNavigation.tsx", import.meta.url), "utf8");
  const accountRoute = await readFile(new URL("../app/api/v1/account/route.ts", import.meta.url), "utf8");
  const favoriteRoute = await readFile(new URL("../app/api/v1/account/favorites/route.ts", import.meta.url), "utf8");
  const accountSettings = await readFile(new URL("../lib/server/account-settings.ts", import.meta.url), "utf8");
  assert.match(header, /<ProfilePanel theme=\{theme\} onToggleTheme=\{onToggleTheme\}/);
  assert.doesNotMatch(header, /className="theme-toggle"/);
  assert.match(profile, /<dialog/);
  assert.match(profile, /showModal\(\)/);
  assert.match(profile, /trigger\.current\?\.focus\(\)/);
  assert.match(profile, /aria-haspopup="dialog"/);
  assert.match(profile, /type="radio"/);
  assert.match(profile, /checked=\{theme === option\}/);
  assert.match(profile, /if \(theme !== option\) onToggleTheme\(\)/);
  assert.match(profile, /Sign in with ChatGPT/);
  assert.match(profile, /type="password"/);
  assert.match(profile, /Stored encrypted/);
  assert.match(profile, /page === "favorites"/);
  assert.match(profile, /No favorites yet/);
  assert.match(profile, /heart beside your profile/);
  assert.doesNotMatch(navigation, /label: "Favorites"/);
  assert.match(header, /<FavoriteButton ticker=\{ticker\} account=\{account\}/);
  assert.match(favoriteButton, /FavoriteFilled/);
  assert.match(favoriteButton, /aria-pressed=\{favorite\}/);
  assert.match(favoriteButton, /Favorited companies are saved in Profile\./);
  assert.match(favoriteButton, /bullcase:favorites-profile-tip/);
  assert.match(accountRoute, /Cross-origin account changes are not allowed/);
  assert.match(favoriteRoute, /Cross-origin account changes are not allowed/);
  assert.match(favoriteRoute, /readBoundedJson\(request, 2048\)/);
  assert.match(accountRoute, /Cache-Control.*private, no-store/);
  assert.match(accountSettings, /AES-GCM/);
  assert.match(accountSettings, /INSERT INTO favorite_stocks/);
  assert.match(accountSettings, /DELETE FROM favorite_stocks/);
  assert.doesNotMatch(accountSettings, /console\.(?:log|warn|error).*apiKey/);
  assert.doesNotMatch(profile, /type="email"|localStorage/);
});

test("keeps the quote concise and lets users dismiss source warnings", async () => {
  const terminal = await readFile(new URL("../../frontend/components/ResearchTerminal.tsx", import.meta.url), "utf8");
  const notification = await readFile(new URL("../../frontend/components/BullCasePrimitives.tsx", import.meta.url), "utf8");
  const companyHeader = await readFile(new URL("../../frontend/components/CompanyHeader.tsx", import.meta.url), "utf8");
  const terminalHeader = await readFile(new URL("../../frontend/components/TerminalHeader.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(terminalHeader, /Coverage|SEC \+ public news/);
  assert.doesNotMatch(companyHeader, /Delayed market price|>Market price<|\svia\s/);
  assert.match(companyHeader, /As of \{analysis\.quote\.as_of\}/);
  assert.match(notification, /aria-label=\{`Dismiss \$\{title\.toLowerCase\(\)\}`\}/);
  assert.match(notification, /onClick=\{onClose\}/);
  assert.match(terminal, /dismissedWarnings\.has\(warningKey\)/);
  assert.match(terminal, /onClose=\{\(\) => dismissSourceWarning\(warningKey\)\}/);
});

test("keeps the comps matrix readable and horizontally contained", async () => {
  const css = await readFile(new URL("../../frontend/app/premium.css", import.meta.url), "utf8");
  const workspaceCss = await readFile(new URL("../../frontend/app/analyst-workspace.css", import.meta.url), "utf8");
  const component = await readTerminalSources();
  const analysis = await readAnalysisSources();
  assert.match(css, /\.comps-matrix-scroll\s*\{[^}]*overflow-x:\s*auto/s);
  assert.match(css, /\.comps-matrix-table\s*\{[^}]*width:\s*100%[^}]*min-width:\s*1120px/s);
  assert.match(css, /\.comps-company-link\s*\{[^}]*text-align:\s*left/s);
  assert.match(workspaceCss, /\.comps-page \.peer-profile-card\s*\{[^}]*min-height:\s*0[^}]*align-content:\s*start/s);
  assert.match(workspaceCss, /\.comps-page \.comps-matrix-table tbody th,[\s\S]*?\.comps-page \.comps-matrix-table tbody td\s*\{[^}]*vertical-align:\s*middle/s);
  assert.doesNotMatch(component, /<p>\{analysis\.comps\.length \?/);
  assert.match(analysis, /selection_score >= minimumDisplayScore/);
  assert.match(analysis, /leaves the set empty instead of showing companies with weak product, customer, or business-model overlap/);
});

test("makes comparable company profiles directly navigable", async () => {
  const component = await readTerminalSources();
  assert.match(component, /onClick=\{\(\) => onSelectCompany\(peer\.ticker\)\}/);
  assert.match(component, /aria-label=\{`Open \$\{peer\.name\} profile`\}/);
});

test("opens every selected company on Overview", async () => {
  const terminal = await readFile(new URL("../../frontend/components/ResearchTerminal.tsx", import.meta.url), "utf8");
  assert.match(terminal, /const selectTicker = useCallback\(\(nextTicker: string\) => \{[\s\S]*?setTicker\(nextTicker\);[\s\S]*?setActivePage\("overview"\);/);
  assert.match(terminal, /useSecuritySearch\(ticker, selectTicker\)/);
  assert.match(terminal, /const openCompanyProfile = useCallback\(\(nextTicker: string\) => \{\s*if \(!openTicker\(nextTicker\)\) return;\s*\}, \[openTicker\]\)/);
});

test("shows the company snapshot only on the intentionally preserved tabs", async () => {
  const component = await readTerminalSources();
  assert.match(component, /COMPANY_HEADER_PAGES = new Set<AnalysisSection>\(\[[\s\S]*?"overview"[\s\S]*?"buyTarget"[\s\S]*?"earnings"[\s\S]*?"filings"[\s\S]*?\]\)/);
  assert.match(component, /COMPANY_HEADER_PAGES\.has\(activePage\) && \(/);
  assert.match(component, /className="comps-peer-map"/);
  assert.match(component, /className="risk-overview-hero"/);
  assert.match(component, /RISK_WATCH_LABELS/);
  assert.match(component, />What to watch</);
  assert.doesNotMatch(component, /className="risk-overview-themes"/);
});

test("keeps restored startup focus from opening the security search menu", async () => {
  const component = await readTerminalSources();
  assert.doesNotMatch(component, /onFocus=\{[\s\S]*?setOpen\(true\)/);
  assert.match(component, /onPointerDown=\{\(\) => \{\s*search\.setOpen\(true\)/);
  assert.match(component, /onChange=\{\(event\) => search\.changeInput\(event\.target\.value\)\}/);
  assert.match(component, /aria-activedescendant=\{search\.open && search\.highlightedIndex >= 0/);
  assert.match(component, /event\.key === "Escape"[\s\S]*?search\.close\(\)/);
});

test("keeps the full research navigation reachable on short desktop screens", async () => {
  const css = await readFile(new URL("../../frontend/app/premium.css", import.meta.url), "utf8");
  assert.match(css, /\.sidebar nav\s*\{[^}]*min-height:\s*0[^}]*overflow-y:\s*auto/s);
});

test("returns a lightweight cold Overview before scheduling a protected full warm", async () => {
  const route = await readFile(new URL("../app/api/v1/companies/[ticker]/analysis/route.ts", import.meta.url), "utf8");
  const service = await readFile(new URL("../lib/server/analysis-service.ts", import.meta.url), "utf8");
  assert.match(route, /rebuildOverviewFromComponentCaches/);
  assert.match(route, /overviewOnly\s*\?\s*await rebuildOverviewFromComponentCaches\(normalizedTicker, forceRefresh\)/);
  const overviewBuilder = service.match(/export async function rebuildOverviewFromComponentCaches[\s\S]*?\r?\n}\r?\n/)?.[0] ?? "";
  assert.match(overviewBuilder, /loadFinancials/);
  assert.match(overviewBuilder, /loadQuote/);
  assert.match(overviewBuilder, /Promise\.all/);
  assert.doesNotMatch(overviewBuilder, /loadPeers|loadEstimates|loadNews|loadRisks/);
  assert.match(route, /async function warmFullAnalysis\(request: Request, ticker: string\)/);
  assert.match(route, /coordinateAnalysisBuild\(`\$\{ticker\}:full`, async \(\) => \{[\s\S]*?enforceRequestLimit\(request, "cold-build"\);[\s\S]*?rebuildAnalysisFromComponentCaches\(ticker\)/);
  assert.match(route, /if \(overviewOnly\) void scheduleBackgroundRefresh\(warmFullAnalysis\(request, normalizedTicker\)\)/);
});

test("loads expensive research sections independently after Overview", async () => {
  const route = await readFile(new URL("../app/api/v1/companies/[ticker]/analysis/route.ts", import.meta.url), "utf8");
  const service = await readFile(new URL("../lib/server/analysis-service.ts", import.meta.url), "utf8");
  const component = await readTerminalSources();
  const api = await readFile(new URL("../../frontend/lib/api.ts", import.meta.url), "utf8");
  assert.match(route, /rebuildAnalysisSectionFromComponentCaches/);
  assert.match(route, /buildSectionSnapshot/);
  assert.match(api, /AnalysisSection/);
  assert.match(component, /isAnalysisSectionLoaded\(analysis, activePage\)/);
  assert.match(component, /fetchAnalysis\(ticker, controller\.signal, requestedSection, forceRefresh\)/);
  assert.match(service, /section === "comps"[\s\S]*?loadPeers/);
  assert.match(service, /section === "risks"[\s\S]*?loadRisks/);
  assert.match(service, /section === "news"[\s\S]*?loadNews/);
  assert.match(service, /\["earnings", "financials"\]\.includes\(section\)[\s\S]*?loadEstimates/);
});

test("starts a shared full warm immediately after every successful Overview", async () => {
  const component = await readFile(new URL("../../frontend/hooks/useCompanyAnalysis.ts", import.meta.url), "utf8");
  const api = await readFile(new URL("../../frontend/lib/api.ts", import.meta.url), "utf8");
  const hostedApi = await readFile(new URL("../lib/api.ts", import.meta.url), "utf8");
  assert.match(component, /import \{ fetchAnalysis, warmAnalysis \} from "@\/lib\/api"/);
  assert.match(component, /fetchAnalysis\(ticker, controller\.signal, "overview"\)[\s\S]*?\.then\(\(value\) => \{[\s\S]*?warmAnalysis\(ticker\)/);
  assert.match(component, /warmAnalysis\(ticker\)[\s\S]*?setAnalysis\(\(current\)/);
  assert.match(api, /const fullAnalysisRequests = new Map<string, Promise<Analysis>>\(\)/);
  assert.match(api, /export function warmAnalysis\(ticker: string\)/);
  assert.match(api, /fullAnalysisRequests\.get\(key\)[\s\S]*?waitForPromise\(warming, signal\)/);
  assert.match(hostedApi, /warmAnalysis/);
});

test("keeps cached Overview reads ahead of any cold rebuild", async () => {
  const route = await readFile(new URL("../app/api/v1/companies/[ticker]/analysis/route.ts", import.meta.url), "utf8");
  const cachedBranch = route.match(/if \(cached\) \{[\s\S]*?\r?\n {4}\}/)?.[0] ?? "";
  assert.match(route, /forceRefresh \|\| requestedSection \? null : await readCachedAnalysis/);
  assert.match(cachedBranch, /buildOverviewSnapshot\(analysis\)/);
  assert.match(cachedBranch, /cache: cached\.isFresh \? "hit" : "stale"/);
  assert.doesNotMatch(cachedBranch, /rebuildAnalysisFromComponentCaches/);
});

test("uses canonical tickers and current component caches for requested sections", async () => {
  const route = await readFile(new URL("../app/api/v1/companies/[ticker]/analysis/route.ts", import.meta.url), "utf8");
  assert.match(route, /normalizeTicker\(ticker\)/);
  assert.match(route, /forceRefresh \|\| requestedSection \? null : await readCachedAnalysis/);
  assert.match(route, /rebuildAnalysisSectionFromComponentCaches\(normalizedTicker, requestedSection, forceRefresh\)/);
});

test("provides a manual company refresh that bypasses the relevant component caches", async () => {
  const route = await readFile(new URL("../app/api/v1/companies/[ticker]/analysis/route.ts", import.meta.url), "utf8");
  const service = await readFile(new URL("../lib/server/analysis-service.ts", import.meta.url), "utf8");
  const component = await readTerminalSources();
  const api = await readFile(new URL("../../frontend/lib/api.ts", import.meta.url), "utf8");
  assert.match(component, /aria-label=\{refreshing \? "Refreshing data" : "Refresh data"\}/);
  assert.doesNotMatch(component, />\{refreshing \? "Refreshing data" : "Refresh data"\}</);
  assert.match(component, /fetchAnalysis\(refreshTicker, undefined, refreshSection, true\)/);
  assert.match(api, /method: forceRefresh \? "POST" : "GET"/);
  assert.doesNotMatch(api, /params\.set\("refresh", "1"\)/);
  assert.match(route, /MANUAL_REFRESH_COOLDOWN_MS = 60_000/);
  assert.match(route, /status: 429/);
  assert.match(route, /"Retry-After": "60"/);
  assert.match(route, /rebuildOverviewFromComponentCaches\(normalizedTicker, forceRefresh\)/);
  assert.match(route, /forceRefresh \? "no-store"/);
  assert.match(service, /loadFinancials\(ticker, forceRefresh\)/);
  assert.match(service, /loadQuote\(ticker, financials\.data, forceRefresh\)/);
  assert.doesNotMatch(component, /Cached, refresh pending/);
  assert.match(component, /Refresh failed/);
  assert.match(route, /cached\.isFresh \? "cached" : "stale"/);
});

test("adds baseline response security headers without exposing cache diagnostics", async () => {
  const response = await render();
  assert.match(response.headers.get("content-security-policy") ?? "", /object-src 'none'/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
  assert.match(response.headers.get("permissions-policy") ?? "", /camera=\(\)/);

  const cacheStatus = await requestWorker("/api/v1/cache/status");
  assert.equal(cacheStatus.status, 404);
  assert.deepEqual(await cacheStatus.json(), { detail: "Not found" });
  assert.equal(cacheStatus.headers.get("cache-control"), "no-store");
});

test("bounds and validates state-changing valuation requests", async () => {
  const oversized = await requestWorker("/api/v1/companies/aapl/valuation", {
    method: "POST",
    headers: { "content-length": "8193" },
    body: "{}",
  });
  assert.equal(oversized.status, 413);

  const body = JSON.stringify({ assumptions: { wacc: 0 } });
  const invalid = await requestWorker("/api/v1/companies/aapl/valuation", {
    method: "POST",
    headers: { "content-length": String(Buffer.byteLength(body)), "content-type": "application/json" },
    body,
  });
  assert.equal(invalid.status, 422);
  assert.deepEqual(await invalid.json(), {
    detail: "Valuation input must be between 0.01 and 0.5.",
    code: "invalid_request",
  });

  const inconsistentBody = JSON.stringify({ assumptions: { wacc: 0.05, terminal_growth: 0.05 } });
  const inconsistent = await requestWorker("/api/v1/companies/aapl/valuation", {
    method: "POST",
    headers: { "content-length": String(Buffer.byteLength(inconsistentBody)), "content-type": "application/json" },
    body: inconsistentBody,
  });
  assert.equal(inconsistent.status, 422);
  assert.deepEqual(await inconsistent.json(), {
    detail: "Terminal growth must be lower than WACC.",
    code: "invalid_request",
  });
});

test("rejects unsupported analysis views instead of silently building the full analysis", async () => {
  const response = await requestWorker("/api/v1/companies/aapl/analysis?view=typo");
  assert.equal(response.status, 422);
  assert.deepEqual(await response.json(), {
    detail: "Unsupported analysis view.",
    code: "invalid_request",
  });
});

test("keeps price-chart errors scoped to the range that failed", async () => {
  const component = await readFile(new URL("../../frontend/components/StockPriceChart.tsx", import.meta.url), "utf8");
  assert.match(component, /const \[errors, setErrors\] = useState<Record<string, string>>\(\{\}\)/);
  assert.match(component, /const error = errors\[historyKey\] \?\? null/);
  assert.doesNotMatch(component, /Daily closing prices/);
});

test("keeps server and browser freshness labels deterministic and the brand link usable", async () => {
  const component = await readTerminalSources();
  const header = await readFile(new URL("../../frontend/components/TerminalHeader.tsx", import.meta.url), "utf8");
  const companyHeader = await readFile(new URL("../../frontend/components/CompanyHeader.tsx", import.meta.url), "utf8");
  const easterEgg = await readFile(new URL("../../frontend/components/TerminalEasterEgg.tsx", import.meta.url), "utf8");
  const notFound = await readFile(new URL("../app/not-found.tsx", import.meta.url), "utf8");
  assert.match(component, /timeZone: "UTC"/);
  assert.match(component, /aria-label="Go to BullCase overview"/);
  assert.match(component, /onHome=\{\(\) => openCompanyProfile\("AAPL"\)\}/);
  assert.match(header, /logoClicks\.current >= 5/);
  assert.match(header, /onEasterEgg\("market"\)/);
  assert.match(header, /const now = performance\.now\(\)/);
  assert.match(header, /now - lastLogoClick\.current > 325/);
  assert.match(header, /now - firstLogoClick\.current > 1100/);
  assert.match(header, /logoClicks\.current \+= 1;\s*onHome\(\);/);
  assert.doesNotMatch(header, /homeTimer|resetTimer|setTimeout/);
  assert.match(companyHeader, /analysis\.company\.ticker === "GME"/);
  assert.match(companyHeader, /gmeClicks\.current >= 3/);
  assert.doesNotMatch(companyHeader, /analysis\.company\.ticker === "AAPL"/);
  assert.match(easterEgg, /GAMESTOP \/ JANUARY 2021/);
  assert.match(easterEgg, /Bulls and bears market party/);
  assert.match(easterEgg, /To the moon!/);
  const animationCss = await readFile(new URL("../../frontend/components/terminal-easter-egg.css", import.meta.url), "utf8");
  assert.match(animationCss, /prefers-reduced-motion: reduce/);
  assert.match(notFound, /404 \/ PAGE NOT FOUND/);
  assert.match(notFound, /href="\/"/);
});

test("keeps excluded Overview sections explicitly unavailable", () => {
  const overview = buildOverviewSnapshot({
    financials: [],
    quarterly_financials: [],
    analyst_estimates: { quarterly: [], annual: [], provider: "Nasdaq", as_of: null, source_url: "https://example.com", disclosure: "Test" },
    comps: [], filings: [], risks: [], news: { items: [], fetched_at: "2026-08-15T00:00:00.000Z", providers: [], industry_query: null, warnings: [] },
    freshness: {
      page_status: "cached",
      financials: { status: "cached", as_of: "2026-01-01", fresh_until: null, source: "SEC" },
      quote: { status: "cached", as_of: "2026-08-15", fresh_until: null, source: "Nasdaq" },
      analyst_estimates: { status: "cached", as_of: "2026-08-15", fresh_until: null, source: "Nasdaq" },
      comps: { status: "cached", as_of: "2026-08-15", fresh_until: null, source: "Peers" },
      news: { status: "cached", as_of: "2026-08-15", fresh_until: null, source: "Yahoo" },
      risks: { status: "cached", as_of: "2026-01-01", fresh_until: null, source: "SEC" },
      summary: { status: "cached", as_of: null, fresh_until: null, source: "Summary" },
    },
  });
  assert.equal(overview.freshness.news.status, "unavailable");
  assert.equal(overview.freshness.analyst_estimates.status, "unavailable");
  assert.equal(overview.freshness.financials.status, "cached");
  assert.equal(overview.freshness.quote.status, "cached");

  const financials = buildSectionSnapshot({
    ...overview,
    analyst_estimates: { quarterly: [{ period: "Q1" }], annual: [{ period: "FY" }], provider: "Nasdaq", as_of: "2026-08-15", source_url: "https://example.com", disclosure: "Test" },
    freshness: {
      ...overview.freshness,
      analyst_estimates: { status: "cached", as_of: "2026-08-15", fresh_until: null, source: "Nasdaq" },
    },
  }, "financials");
  assert.equal(financials.analyst_estimates.annual.length, 1);
  assert.equal(financials.freshness.analyst_estimates.status, "cached");
});

test("keeps quote attribution clickable and Price Range navigation connected", async () => {
  const component = await readTerminalSources();
  assert.match(component, /href=\{analysis\.quote\.source_url\}/);
  assert.match(component, /page === "buyTarget"\) return <PriceRangeView/);
  assert.match(component, /key: "buyTarget", label: "Price Range"/);
  assert.match(component, /Model estimates, not a target/);
  assert.match(component, /type="range"/);
  assert.match(component, /It is not an BullCase recommendation/);
  assert.match(component, /price-range-detail-sheet/);
  assert.doesNotMatch(component, /BULLCASE BUY TARGET|SAFETY FACTOR|label="Buy target"/);
  assert.doesNotMatch(component, /price-range-sources|>Data used</);
  assert.match(component, /Timestamp not supplied/);
});

test("shows mobile horizontal-scroll hints and quarterly YoY and QoQ comparisons", async () => {
  const terminal = await readTerminalSources();
  const explorer = await readFile(new URL("../../frontend/components/FinancialExplorer.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../../frontend/app/premium.css", import.meta.url), "utf8");
  assert.match(terminal, /Swipe sideways for more sections/);
  assert.match(terminal, /Swipe sideways to compare every metric/);
  assert.match(explorer, /"YoY"/);
  assert.match(explorer, /"QoQ"/);
  assert.match(explorer, /N\/M/);
  assert.match(explorer, /YoY growth/);
  assert.match(explorer, /QoQ growth/);
  assert.match(explorer, /financial-growth-badge/);
  assert.match(css, /\.financial-growth-badge[\s\S]*?font:\s*12px/);
  assert.match(css, /@media \(max-width: 960px\)[\s\S]*?\.horizontal-scroll-hint\s*\{[\s\S]*?display:\s*block/);
});

test("plots quarterly YoY and QoQ growth on a separate percentage scale", () => {
  const periods = Array.from({ length: 6 }, (_, index) => ({
    fiscal_year: index < 4 ? 2025 : 2026,
    fiscal_quarter: (index % 4) + 1,
    period_type: `Q${(index % 4) + 1}`,
    period_end: null,
    filed_at: null,
    accession_number: null,
    form: "10-Q",
    currency: "USD",
    values: { revenue: [100, 110, 120, 130, 150, 165][index], net_income: [10, 11, 12, 13, 15, 16.5][index] },
    provenance: {},
  }));
  const incomeGroup = FINANCIAL_GROUPS.find((group) => group.key === "income");
  const yoy = buildFinancialGrowthData(periods, incomeGroup, "yoy");
  const qoq = buildFinancialGrowthData(periods, incomeGroup, "qoq");

  assert.equal(yoy[4].revenue, 50);
  assert.ok(Math.abs(qoq[5].revenue - 10) < 1e-9);
  assert.equal(financialGrowthValue(-10, -20, "money"), null);
  assert.ok(Math.abs(financialGrowthValue(0.3, 0.25, "percent") - 5) < 1e-9);
});

test("keeps deferred-section loading and errors scoped to the requested page", () => {
  const analysis = {
    data_scope: "partial",
    loaded_sections: ["overview", "comps"],
  };

  assert.equal(analysisSectionPanelState(analysis, "comps", "news", null), "content");
  assert.equal(analysisSectionPanelState(analysis, "news", "news", null), "loading");
  assert.equal(analysisSectionPanelState(analysis, "news", null, "News is unavailable"), "error");
});

test("partial responses without section metadata do not masquerade as loaded content", () => {
  assert.equal(analysisSectionPanelState({ data_scope: "partial" }, "news", null, null), "loading");
  assert.equal(analysisSectionPanelState({ data_scope: "partial" }, "news", null, "Retry News"), "error");
  assert.equal(analysisSectionPanelState({ data_scope: "full" }, "news", null, null), "content");
});

test("merges a deferred section without erasing freshness from previously loaded pages", () => {
  const current = {
    data_scope: "partial",
    loaded_sections: ["overview", "comps"],
    financials: [{ fiscal_year: 2025 }],
    quarterly_financials: [],
    analyst_estimates: { annual: [] },
    comps: [{ ticker: "MSFT" }],
    peer_selection: { source_provider: "SEC" },
    filings: [],
    risks: [],
    news: { items: [] },
    freshness: {
      page_status: "cached",
      comps: { status: "cached", as_of: "2026-08-10T00:00:00.000Z", source: "Peer cache" },
      news: { status: "unavailable", as_of: null, source: "Loads with News" },
    },
    provenance: {
      comparables: "SEC peer selection",
      peer_snapshot_as_of: "2026-08-10T00:00:00.000Z",
      news: "Loads with News",
      warnings: ["Existing warning"],
    },
  };
  const next = {
    ...current,
    loaded_sections: ["overview", "news"],
    comps: [],
    peer_selection: { source_provider: "Unavailable" },
    news: { items: [{ id: "news-1" }] },
    freshness: {
      ...current.freshness,
      page_status: "live",
      comps: { status: "unavailable", as_of: null, source: "Loads with Comps" },
      news: { status: "live", as_of: "2026-08-12T00:00:00.000Z", source: "Yahoo Finance" },
    },
    provenance: {
      ...current.provenance,
      comparables: "Loads with Comps",
      peer_snapshot_as_of: "",
      news: "Yahoo Finance",
      warnings: ["New warning"],
    },
  };

  const merged = mergeAnalysisSection(current, next, "news");
  assert.deepEqual(merged.comps, current.comps);
  assert.equal(merged.freshness.comps.as_of, current.freshness.comps.as_of);
  assert.equal(merged.freshness.news.as_of, next.freshness.news.as_of);
  assert.equal(merged.provenance.comparables, current.provenance.comparables);
  assert.equal(merged.provenance.news, next.provenance.news);
  assert.deepEqual(merged.provenance.warnings, ["Existing warning", "New warning"]);
});

test("merges analyst estimates returned with the Financials section", () => {
  const current = {
    data_scope: "overview", loaded_sections: ["overview"], financials: [], quarterly_financials: [],
    analyst_estimates: { annual: [], quarterly: [] }, comps: [], filings: [], risks: [], news: { items: [] },
    freshness: { analyst_estimates: { status: "unavailable" } },
    provenance: { analyst_estimates: "Loads with Earnings", warnings: [] },
  };
  const next = {
    ...current, data_scope: "partial", loaded_sections: ["overview", "financials"],
    analyst_estimates: { annual: [{ period: "FY 2027" }], quarterly: [{ period: "Q1 2027" }] },
    freshness: { analyst_estimates: { status: "cached" } },
    provenance: { analyst_estimates: "Nasdaq analyst consensus", warnings: [] },
  };
  const merged = mergeAnalysisSection(current, next, "financials");
  assert.equal(merged.analyst_estimates.annual.length, 1);
  assert.equal(merged.freshness.analyst_estimates.status, "cached");
  assert.equal(merged.provenance.analyst_estimates, "Nasdaq analyst consensus");
});

test("coordinates shared refreshes and gradually warms popular companies", async () => {
  const cache = await readFile(new URL("../lib/server/cache-refresh.ts", import.meta.url), "utf8");
  const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  const api = await readFile(new URL("../../frontend/lib/api.ts", import.meta.url), "utf8");
  assert.match(cache, /cache_refresh_leases/);
  assert.match(cache, /acquireCacheRefreshLease/);
  assert.match(worker, /warmPopularCompanies/);
  assert.match(api, /prefetchAnalysis/);
});
