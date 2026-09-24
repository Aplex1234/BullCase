"use client";

import { Suspense, lazy, useState } from "react";
import ArrowRight from "@carbon/icons-react/es/ArrowRight.js";
import Compare from "@carbon/icons-react/es/Compare.js";
import Document from "@carbon/icons-react/es/Document.js";
import Information from "@carbon/icons-react/es/Information.js";
import Renew from "@carbon/icons-react/es/Renew.js";
import ShieldAlert from "@carbon/icons-react/es/ShieldAlert.js";

import { analysisSectionPanelState } from "@/lib/analysis-sections";
import { compactMoney, money, multiple, percent, titleCase } from "@/lib/format";
import type { Analysis, AnalysisSection, ComparableCompany } from "@/lib/types";
import { Button, InlineNotification, Tag } from "./BullCasePrimitives";
import { CompanyLogo } from "./CompanyLogo";

const FinancialChart = lazy(() => import("./FinancialChart").then((module) => ({ default: module.FinancialChart })));
const FinancialExplorer = lazy(() => import("./FinancialExplorer").then((module) => ({ default: module.FinancialExplorer })));
const MultipleValuationView = lazy(() => import("./MultipleValuationView").then((module) => ({ default: module.MultipleValuationView })));
const NewsView = lazy(() => import("./NewsView").then((module) => ({ default: module.NewsView })));
const StockPriceChart = lazy(() => import("./StockPriceChart").then((module) => ({ default: module.StockPriceChart })));
const AIResearchView = lazy(() => import("./AIResearchView").then((module) => ({ default: module.AIResearchView })));

type PageKey = AnalysisSection;

const RISK_WATCH_LABELS: Record<string, string> = {
  "business-performance": "Execution problems could weaken performance",
  "climate-physical-events": "Extreme events could interrupt operations",
  "competition-innovation": "Competitors could win customers or market share",
  "customers-products-concentration": "Reliance on major customers or products increases risk",
  "cybersecurity-data-privacy": "A security incident could interrupt operations",
  "financial-liquidity": "Debt or weaker cash flow could limit flexibility",
  "intellectual-property": "Patent or licensing disputes could raise costs",
  "international-geopolitical": "Conflict or trade limits could disrupt operations",
  "macroeconomic-demand": "A slowdown could reduce customer spending",
  "people-execution": "Losing key people could slow execution",
  "regulation-legal": "New rules or lawsuits could raise costs",
  "supply-chain-operations": "Supplier problems could delay products or services",
  "transactions-strategy": "Acquisitions may not deliver expected benefits",
};

function riskWatchLabel(risk: Analysis["risks"][number]) {
  return risk.theme ? RISK_WATCH_LABELS[risk.theme] ?? risk.title : risk.title;
}

export function ResearchPages({ page, analysis, onSelectCompany, loadingSection, sectionError, onRetrySection }: {
  page: PageKey;
  analysis: Analysis;
  onSelectCompany: (ticker: string) => void;
  loadingSection: Exclude<AnalysisSection, "overview"> | null;
  sectionError: string | null;
  onRetrySection: (section: Exclude<AnalysisSection, "overview">) => void;
}) {
  if (page !== "overview") {
    const panelState = analysisSectionPanelState(analysis, page, loadingSection, sectionError);
    if (panelState === "loading") return <DeferredPanel label={`Loading ${page} data`} />;
    if (panelState === "error") return <SectionErrorState section={page} error={sectionError ?? "Additional data is unavailable."} retry={() => onRetrySection(page)} />;
  }
  if (page === "financials") return <FinancialsView analysis={analysis} />;
  if (page === "valuation") return <Suspense fallback={<DeferredPanel label="Loading valuation workspace" />}><MultipleValuationView analysis={analysis} /></Suspense>;
  if (page === "buyTarget") return <PriceRangeView analysis={analysis} />;
  if (page === "comps") return <CompsView analysis={analysis} onSelectCompany={onSelectCompany} />;
  if (page === "earnings") return <EarningsView analysis={analysis} />;
  if (page === "news") return <Suspense fallback={<DeferredPanel label="Loading company news" />}><NewsView analysis={analysis} onRetry={() => onRetrySection("news")} /></Suspense>;
  if (page === "filings") return <FilingsView analysis={analysis} />;
  if (page === "risks") return <RisksView analysis={analysis} onRetry={() => onRetrySection("risks")} />;
  if (page === "research") return <Suspense fallback={<DeferredPanel label="Loading AI Research" />}><AIResearchView key={analysis.company.ticker} ticker={analysis.company.ticker} companyName={analysis.company.name} /></Suspense>;
  return <OverviewView analysis={analysis} />;
}

function SectionErrorState({ section, error, retry }: { section: Exclude<AnalysisSection, "overview">; error: string; retry: () => void }) {
  return (
    <div className="error-state section-error-state">
      <InlineNotification kind="error" title={`Could not load ${section}`} subtitle={error} hideCloseButton />
      <Button kind="tertiary" renderIcon={Renew} onClick={retry}>Try again</Button>
    </div>
  );
}
function DeferredPanel({ label }: { label: string }) {
  return <div className="market-chart-loading deferred-panel" role="status" aria-live="polite" aria-label={label}><span /><span /><span /></div>;
}

function OverviewView({ analysis }: { analysis: Analysis }) {
  const headline = analysis.headline;
  const growthTone = (value: number | null) => value == null ? "neutral" : value >= 0 ? "positive" : "negative";
  return (
    <div className="page-stack">
      <section className="overview-primary-grid">
        <Suspense fallback={<DeferredPanel label="Loading price history" />}>
          <StockPriceChart ticker={analysis.company.ticker} />
        </Suspense>
        <aside className="conviction-panel">
          <h3 className="workspace-panel-title">Valuation summary</h3>
          <div className="conviction-heading">
            <div><span>BULLCASE SCORE</span><strong>{headline.score}<small>/100</small></strong></div>
            <Tag type={headline.score >= 70 ? "green" : headline.score >= 50 ? "cool-gray" : "red"}>{headline.rating}</Tag>
          </div>

          <div className="conviction-values">
            <DataRow label="Base estimate" value={money(headline.base_value)} subvalue={`${percent(headline.upside)} from market`} />
            <DataRow label="Bear estimate" value={money(headline.bear_value)} />
            <DataRow label="Bull estimate" value={money(headline.bull_value)} />
          </div>
          <div className="conviction-foot">
            <span>Forward PEG</span>
            <strong>{analysis.valuation.growth_projection.peg_ratio == null ? "N/A" : analysis.valuation.growth_projection.peg_ratio.toFixed(2)}</strong>
            <small>Target: {analysis.valuation.growth_projection.target_peg.toFixed(1)} or lower</small>
          </div>
        </aside>
      </section>

      <section className="key-highlights">
        <div className="key-highlights-heading">
          <h3>Key highlights</h3>

        </div>
        <div className="key-highlights-grid">
          <MetricCell label="Revenue" value={compactMoney(analysis.latest.revenue)} detail={`${percent(analysis.metrics.revenue_growth_yoy)} annual growth`} tone={growthTone(analysis.metrics.revenue_growth_yoy)} />
          <MetricCell label="Net income" value={compactMoney(analysis.latest.net_income)} detail={`${percent(analysis.metrics.net_income_growth_yoy)} annual growth`} tone={growthTone(analysis.metrics.net_income_growth_yoy)} />
          <MetricCell label="Free cash flow" value={compactMoney(analysis.latest.free_cash_flow)} detail={`${percent(analysis.metrics.fcf_growth_yoy)} annual growth`} tone={growthTone(analysis.metrics.fcf_growth_yoy)} />
          <MetricCell label="P / E" value={multiple(analysis.metrics.pe)} detail="Current price / annual EPS" />
          <MetricCell label="Price / book" value={multiple(analysis.metrics.price_to_book)} detail="Market cap / book equity" />
        </div>
      </section>

      <section className="company-brief" aria-labelledby="company-brief-title">
        <div className="company-brief-heading">
          <Information size={18} aria-hidden="true" />
          <div>
            <h3 id="company-brief-title">What the company does</h3>
            <span>{analysis.company.sector || "Public company"}</span>
          </div>
        </div>
        <div className="company-brief-copy">
          <p>{analysis.company.description || "Company description unavailable."}</p>
          {analysis.company.description && (
            <a href={analysis.company.description_source_url} target="_blank" rel="noreferrer">
              Source: {analysis.company.description_source}
            </a>
          )}
        </div>
      </section>

      <section className="content-section">
        <SectionHeading title="Financial trajectory" detail="Annual financials" />
        <Suspense fallback={<DeferredPanel label="Loading financial chart" />}>
          <FinancialChart periods={analysis.financials} />
        </Suspense>
      </section>

      <section className="split-section">
        <div>
          <SectionHeading title="Key metrics" detail={`Latest fiscal year: ${analysis.financials.at(-1)?.fiscal_year}`} />
          <div className="metric-table">
            <DataRow label="Revenue" value={compactMoney(analysis.latest.revenue)} />
            <DataRow label="Revenue CAGR" value={percent(analysis.metrics.revenue_cagr)} />
            <DataRow label="Operating margin" value={percent(analysis.metrics.operating_margin)} />
            <DataRow label="Free cash flow" value={compactMoney(analysis.latest.free_cash_flow)} />
            <DataRow label="FCF margin" value={percent(analysis.metrics.fcf_margin)} />
            <DataRow label="ROIC" value={percent(analysis.metrics.roic)} />
            <DataRow label="Net debt" value={compactMoney(analysis.metrics.net_debt)} />
            <DataRow label="P / FCF" value={multiple(analysis.metrics.price_to_fcf)} />
          </div>
        </div>
        <div>
          <SectionHeading title="Score breakdown" />
          <div className="score-matrix">
            {Object.entries(analysis.score.categories).map(([category, score]) => (
              <div key={category}>
                <span>{titleCase(category)}</span>
                <strong>{score}</strong>
                <small>{percent(analysis.score.weights[category], 0)} weight</small>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="thesis-strip">
        <div>
          <span>MODEL READ</span>
          <h3>{headline.rating} at {money(headline.current_price)}</h3>
        </div>
        <p>{analysis.valuation.reverse_dcf.interpretation} {analysis.valuation.methodology}</p>
      </section>
    </div>
  );
}

function MetricCell({ label, value, detail, tone }: { label: string; value: string; detail: string; tone?: string }) {
  return <div className="metric-cell"><span>{label}</span><strong>{value}</strong><small className={tone}>{detail}</small></div>;
}

function SectionHeading({ title, detail }: { title: string; detail?: string }) {
  return <div className="section-heading"><h3>{title}</h3>{detail && <p>{detail}</p>}</div>;
}

function DataRow({ label, value, subvalue }: { label: string; value: string; subvalue?: string }) {
  return <div className="data-row"><span>{label}{subvalue && <small>{subvalue}</small>}</span><strong>{value}</strong></div>;
}

function FinancialsView({ analysis }: { analysis: Analysis }) {
  const estimates = analysis.analyst_estimates;
  return (
    <div className="page-stack">
      <section className="financials-intro">
        <div>
          <h2>Financial explorer</h2>

        </div>
        <div className="coverage-summary">
          <span>History</span>
          <strong>{analysis.financials[0]?.fiscal_year}-{analysis.financials.at(-1)?.fiscal_year}</strong>
          <small>{analysis.financials.length} annual and {analysis.quarterly_financials.length} quarterly periods</small>
        </div>
      </section>
      <section className="financial-explorer-section">
        <Suspense fallback={<DeferredPanel label="Loading financial explorer" />}>
          <FinancialExplorer annualPeriods={analysis.financials} quarterlyPeriods={analysis.quarterly_financials} />
        </Suspense>
        <p className="table-note">Quarterly cash flow values are shown as stand-alone quarters. Q4 may be calculated as the fiscal-year total minus Q1, Q2 and Q3. Missing values are shown as N/A.</p>
      </section>
      <section className="analyst-estimates-section">
        <div className="analyst-estimates-heading">
          <div>
            <h3>Analyst EPS estimates</h3>

          </div>
          <a href={estimates.source_url} target="_blank" rel="noreferrer">Source: {estimates.provider}</a>
        </div>
        {estimates.quarterly.length || estimates.annual.length ? (
          <div className="estimate-tables-grid">
            <EstimateTable title="Quarterly estimates" rows={estimates.quarterly} />
            <EstimateTable title="Annual estimates" rows={estimates.annual} />
          </div>
        ) : (
          <div className="estimate-empty"><strong>No consensus estimates available</strong><span>Nasdaq did not return forward EPS estimates for this security.</span></div>
        )}
        <p className="estimate-disclosure">{estimates.disclosure}</p>
      </section>
    </div>
  );
}

function EstimateTable({ title, rows }: { title: string; rows: Analysis["analyst_estimates"]["quarterly"] }) {
  const eps = (value: number | null) => value == null ? "N/A" : `$${value.toFixed(2)}`;
  return (
    <div className="estimate-table-block">
      <h4>{title}</h4>
      {rows.length ? (
        <>
        <span className="horizontal-scroll-hint">Swipe sideways to see all estimate columns</span>
        <div className="estimate-table-scroll">
          <table className="research-table estimate-table">
            <thead><tr><th>Period</th><th>Consensus EPS</th><th>Range</th><th>Analysts</th><th>Revisions</th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.period}>
                  <th>{row.period}</th>
                  <td>{eps(row.consensus_eps)}</td>
                  <td>{eps(row.low_eps)} to {eps(row.high_eps)}</td>
                  <td>{row.analyst_count ?? "N/A"}</td>
                  <td>{row.revisions_up == null && row.revisions_down == null
                    ? "N/A"
                    : <><span className="revision-up">{row.revisions_up == null ? "N/A" : `+${row.revisions_up}`}</span> / <span className="revision-down">{row.revisions_down == null ? "N/A" : `-${row.revisions_down}`}</span></>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      ) : <p className="estimate-table-empty">No estimates available.</p>}
    </div>
  );
}

function PriceRangeView({ analysis }: { analysis: Analysis }) {
  const [userDiscount, setUserDiscount] = useState(0);
  const currentPrice = analysis.quote.price;
  const bearValue = analysis.headline.bear_value;
  const baseValue = analysis.headline.base_value ?? analysis.headline.fair_value;
  const bullValue = analysis.headline.bull_value;
  const entryPrice = baseValue == null ? null : baseValue * (1 - userDiscount / 100);
  const assumptions = analysis.valuation.assumptions;
  const methodRows = [
    { key: "dcf", label: "Discounted cash flow", basis: "Cash flow model" },
    { key: "comparable_companies", label: "Comparable companies", basis: "Peer earnings" },
    { key: "growth_adjusted", label: "Growth adjusted", basis: "Earnings and growth" },
    { key: "normalized_multiple", label: "Normalized multiple", basis: "Historical earnings" },
  ];
  const assumptionRows = [
    { label: "Forecast period", value: `${assumptions.forecast_years} years`, source: "Model input" },
    { label: "Revenue growth", value: percent(assumptions.revenue_growth), source: "Historical financials, model capped" },
    { label: "Free cash flow margin", value: percent(assumptions.fcf_margin), source: "Historical financials, model capped" },
    { label: "Discount rate", value: percent(assumptions.wacc), source: "Model input" },
    { label: "Terminal growth", value: percent(assumptions.terminal_growth), source: "Model input" },
  ];
  const marketComparison = (value: number | null) => {
    if (value == null || !Number.isFinite(value) || currentPrice <= 0) return "Comparison unavailable";
    const difference = value / currentPrice - 1;
    if (Math.abs(difference) < 0.0005) return "In line with market";
    return `${percent(Math.abs(difference))} ${difference > 0 ? "above" : "below"} market`;
  };
  const scenarios = [
    { label: "Bear", value: bearValue, note: "Downside model", tone: "bear" },
    { label: "Base", value: baseValue, note: "Blended estimate", tone: "base" },
    { label: "Bull", value: bullValue, note: "Upside model", tone: "bull" },
  ];
  const discountInputId = `entry-discount-${analysis.company.ticker}`;

  return (
    <div className="page-stack price-range-page">
      <section className="price-range-intro" aria-labelledby="price-range-title">
        <div>
          <span className="price-range-kicker">VALUATION RANGE</span>
          <h2 id="price-range-title">Model estimates, not a target</h2>
          <p>See what drives the range, then set your own entry threshold.</p>
        </div>
        <div className="price-market-reference">
          <span>MARKET REFERENCE</span>
          <strong>{money(currentPrice)}</strong>
          <small>As of {analysis.quote.as_of || "Timestamp not supplied"}</small>
        </div>
      </section>

      <section className="price-range-scenarios" aria-labelledby="scenario-heading">
        <header className="price-range-section-head">
          <div>
            <h3 id="scenario-heading">Valuation scenarios</h3>
            <p>Per share in {analysis.quote.currency}.</p>
          </div>
          <span>{money(bearValue)} to {money(bullValue)}</span>
        </header>
        <div className="price-scenario-grid">
          {scenarios.map((scenario) => (
            <article key={scenario.label} className={`price-scenario is-${scenario.tone}`}>
              <div>
                <span>{scenario.label}</span>
                <small>{scenario.note}</small>
              </div>
              <strong>{money(scenario.value)}</strong>
              <p>{marketComparison(scenario.value)}</p>
            </article>
          ))}
        </div>
      </section>

      <div className="price-range-detail-sheet">
        <div className="price-range-two-column">
          <section className="price-range-panel" aria-labelledby="methods-heading">
            <header className="price-range-panel-head">
              <h3 id="methods-heading">Method values</h3>
              <span>Per share</span>
            </header>
            <div className="price-method-list">
              {methodRows.map((method) => (
                <div className="price-method-row" key={method.key}>
                  <div><span>{method.label}</span><small>{method.basis}</small></div>
                  <strong>{money(analysis.valuation.methods[method.key])}</strong>
                </div>
              ))}
            </div>
            <p className="price-range-panel-note"><strong>Current blend:</strong> {analysis.valuation.methodology}</p>
          </section>

          <section className="price-range-panel" aria-labelledby="inputs-heading">
            <header className="price-range-panel-head">
              <h3 id="inputs-heading">Inputs behind the range</h3>
              <span>Current model</span>
            </header>
            <div className="price-assumption-list">
              {assumptionRows.map((assumption) => (
                <div className="price-assumption-row" key={assumption.label}>
                  <div><span>{assumption.label}</span><small>{assumption.source}</small></div>
                  <strong>{assumption.value}</strong>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="price-range-two-column price-range-decision-row">
          <section className="price-range-panel price-expectations" aria-labelledby="expectations-heading">
            <header className="price-range-panel-head">
              <h3 id="expectations-heading">Market expectations</h3>
              <span>Reverse DCF</span>
            </header>
            <div className="price-expectation-grid">
              <div><span>Growth implied by price</span><strong>{percent(analysis.valuation.reverse_dcf.implied_revenue_growth)}</strong></div>
              <div><span>Growth used by model</span><strong>{percent(assumptions.revenue_growth)}</strong></div>
            </div>
            <p className="price-range-panel-note">{analysis.valuation.reverse_dcf.interpretation}</p>
          </section>

          <section className="price-range-panel price-entry-panel" aria-labelledby="entry-heading">
            <header className="price-range-panel-head">
              <h3 id="entry-heading">Your entry price</h3>
              <span>Your input</span>
            </header>
            <div className="price-entry-content">
              <div className="price-entry-result">
                <div><span>ENTRY PRICE</span><strong>{money(entryPrice)}</strong></div>
                <small>{marketComparison(entryPrice)}</small>
              </div>
              <label htmlFor={discountInputId}>
                <span>Discount from base</span>
                <output htmlFor={discountInputId}>{userDiscount}%</output>
              </label>
              <input
                id={discountInputId}
                type="range"
                min="0"
                max="40"
                step="1"
                value={userDiscount}
                disabled={baseValue == null}
                onChange={(event) => setUserDiscount(Number(event.target.value))}
              />
              <div className="price-entry-scale"><span>0%</span><span>20%</span><span>40%</span></div>
              <p>This threshold comes only from your selected discount. It is not an BullCase recommendation.</p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function CompsView({ analysis, onSelectCompany }: { analysis: Analysis; onSelectCompany: (ticker: string) => void }) {
  const target: ComparableCompany = {
    ticker: analysis.company.ticker,
    name: analysis.company.name,
    sector: analysis.company.sector,
    industry: analysis.company.industry,
    price: analysis.quote.price,
    market_cap: analysis.metrics.market_cap ?? null,
    revenue_growth: analysis.metrics.revenue_growth_yoy ?? null,
    net_income_growth: analysis.metrics.net_income_growth_yoy ?? null,
    gross_margin: analysis.metrics.gross_margin ?? null,
    operating_margin: analysis.metrics.operating_margin ?? null,
    fcf_margin: analysis.metrics.fcf_margin ?? null,
    roic: analysis.metrics.roic ?? null,
    pe: analysis.metrics.pe ?? null,
    price_to_book: analysis.metrics.price_to_book ?? null,
    price_fcf: analysis.metrics.price_to_fcf ?? null,
    fcf_yield: analysis.metrics.fcf_yield ?? null,
    fiscal_year: analysis.financials.at(-1)!.fiscal_year,
    quote_as_of: analysis.quote.as_of,
    selection_reason: "The company currently being analyzed.",
    selection_score: 100,
    selection_factors: [],
    selection_source: analysis.company.description_source,
    selection_source_url: analysis.company.description_source_url,
  };
  const rows = [target, ...analysis.comps];
  const median = (values: Array<number | null>) => {
    const sorted = values.filter((value): value is number => value != null && Number.isFinite(value)).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  };
  const peerMedianPe = median(analysis.comps.map((company) => company.pe && company.pe > 0 ? company.pe : null));
  const peerMedianRevenueGrowth = median(analysis.comps.map((company) => company.revenue_growth));
  const peerMedianOperatingMargin = median(analysis.comps.map((company) => company.operating_margin));
  const growthClass = (value: number | null) => value == null ? "" : value >= 0 ? "is-positive" : "is-negative";
  const fiscalYears = [...new Set(rows.map((row) => row.fiscal_year).filter(Boolean))].sort((a, b) => b - a);
  const fiscalCoverage = fiscalYears.length === 1 ? `Fiscal ${fiscalYears[0]}` : `Fiscal years ${fiscalYears.join(", ")}`;
  const spread = (value: number | null, benchmark: number | null) => value == null || benchmark == null ? null : value - benchmark;
  const peSpread = peerMedianPe && target.pe ? target.pe / peerMedianPe - 1 : null;
  const spreadLabel = (value: number | null, unit: "percent" | "multiple") => {
    if (value == null) return "Peer comparison unavailable";
    if (unit === "multiple") return `${value >= 0 ? "+" : ""}${percent(value)} vs peer median`;
    return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)} pts vs peer median`;
  };

  return (
    <div className="page-stack comps-page">
      <section className="comps-hero" aria-labelledby="comps-heading">
        <div className="comps-hero-copy">
          <div className="comps-hero-label"><Compare size={18} aria-hidden="true" /><span>PEER BENCHMARK</span></div>
          <h2 id="comps-heading">Comparable companies</h2>
          <div className="comps-industry-line"><strong>{analysis.company.industry || "Industry not classified"}</strong><span>{analysis.company.sector || "SEC reporting company"}</span></div>
        </div>
        <div className="comps-peer-map" aria-label={`${analysis.company.name} peer set`}>
          <div className="comps-target-node">
            <CompanyLogo ticker={analysis.company.ticker} name={analysis.company.name} size="md" />
            <div><span>Target company</span><strong>{analysis.company.ticker}</strong></div>
          </div>
          <div className="comps-peer-node-list">
            {analysis.comps.slice(0, 4).map((peer) => (
              <button type="button" key={peer.ticker} onClick={() => onSelectCompany(peer.ticker)} aria-label={`Open ${peer.name} profile`}>
                <CompanyLogo ticker={peer.ticker} name={peer.name} size="xs" />
                <span>{peer.ticker}</span>
              </button>
            ))}
            {!analysis.comps.length && <p>No qualified peers available</p>}
          </div>
          <div className="comps-universe-panel">
            <div><span>Selected</span><strong>{analysis.comps.length}</strong></div>
            <div><span>Reviewed</span><strong>{analysis.peer_selection.candidates_considered}</strong></div>
            <small>Quality floor 55 / 100 · {analysis.peer_selection.source_provider}</small>
          </div>
        </div>
      </section>

      <section className="comps-snapshot" aria-label="Target versus peer medians">
        <article><span>P / E</span><strong>{multiple(target.pe)}</strong><small>{spreadLabel(peSpread, "multiple")}</small></article>
        <article><span>Revenue growth</span><strong>{percent(target.revenue_growth)}</strong><small className={growthClass(spread(target.revenue_growth, peerMedianRevenueGrowth))}>{spreadLabel(spread(target.revenue_growth, peerMedianRevenueGrowth), "percent")}</small></article>
        <article><span>Operating margin</span><strong>{percent(target.operating_margin)}</strong><small className={growthClass(spread(target.operating_margin, peerMedianOperatingMargin))}>{spreadLabel(spread(target.operating_margin, peerMedianOperatingMargin), "percent")}</small></article>
        <article><span>Market value</span><strong>{compactMoney(target.market_cap)}</strong><small>{multiple(peerMedianPe)} peer median P / E</small></article>
      </section>

      {analysis.comps.length > 0 && (
        <section className="peer-directory" aria-labelledby="peer-directory-heading">
          <div className="comps-section-heading">
            <div><h3 id="peer-directory-heading">Peers</h3></div>
            <span>{analysis.comps.length} profiles</span>
          </div>
          <div className="peer-directory-grid">
            {analysis.comps.map((peer) => (
              <button key={peer.ticker} type="button" className="peer-profile-card" onClick={() => onSelectCompany(peer.ticker)} aria-label={`Open ${peer.name} profile`}>
                <div className="peer-profile-identity"><CompanyLogo ticker={peer.ticker} name={peer.name} size="md" /><div><strong>{peer.name}</strong><small>{peer.ticker}</small></div><ArrowRight size={18} aria-hidden="true" /></div>
                <div className="peer-profile-metrics"><span><small>Market cap</small><strong>{compactMoney(peer.market_cap)}</strong></span><span><small>Revenue growth</small><strong className={growthClass(peer.revenue_growth)}>{percent(peer.revenue_growth)}</strong></span><span><small>P / E</small><strong>{multiple(peer.pe)}</strong></span></div>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="comps-matrix-section" aria-labelledby="comps-matrix-heading">
        <div className="comps-section-heading">
          <div><h3 id="comps-matrix-heading">Comparison</h3></div>
          <span>{rows.length} companies</span>
        </div>
        <span className="horizontal-scroll-hint">Swipe sideways to compare every metric</span>
        <div className="comps-matrix-scroll">
          <table className="comps-matrix-table">
            <thead>
              <tr><th scope="col">Company</th><th scope="col">Market cap</th><th scope="col">Revenue growth</th><th scope="col">Earnings growth</th><th scope="col">Gross margin</th><th scope="col">Operating margin</th><th scope="col">P / E</th><th scope="col">Price / book</th></tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const isTarget = row.ticker === analysis.company.ticker;
                return (
                  <tr key={row.ticker} className={isTarget ? "is-target" : ""}>
                    <th scope="row">
                      <button type="button" className="comps-company-link" onClick={() => onSelectCompany(row.ticker)} aria-label={isTarget ? `Open ${row.name} overview` : `Open ${row.name} profile`}>
                        <CompanyLogo ticker={row.ticker} name={row.name} size="sm" className="comps-company-avatar" />
                        <span className="comps-company-copy"><strong>{row.name}</strong><small>{row.ticker}</small></span>
                      </button>
                    </th>
                    <td>{compactMoney(row.market_cap)}</td>
                    <td className={growthClass(row.revenue_growth)}>{percent(row.revenue_growth)}</td>
                    <td className={growthClass(row.net_income_growth)}>{percent(row.net_income_growth)}</td>
                    <td>{percent(row.gross_margin)}</td>
                    <td>{percent(row.operating_margin)}</td>
                    <td>{multiple(row.pe)}</td>
                    <td>{multiple(row.price_to_book)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!analysis.comps.length && <div className="comps-empty"><p>{analysis.provenance.comparables || "No strong operating peers were identified. The comparison stays empty instead of adding weak industry matches."}</p></div>}
        <div className="comps-data-foot"><span>{fiscalCoverage}</span><a href={analysis.peer_selection.source_url} target="_blank" rel="noreferrer">Source</a></div>
      </section>

      {analysis.comps.length > 0 && (
        <details className="comps-source-details">
          <summary>Sources and filing dates</summary>
          <div className="comps-section-heading">
            <div><h3>Peer sources</h3></div>
            <span>{analysis.peer_selection.selection_version}</span>
          </div>
          <div className="peer-rationale-list">
            {analysis.comps.map((peer) => (
              <article key={peer.ticker}>
                <button type="button" className="peer-rationale-link" onClick={() => onSelectCompany(peer.ticker)}>
                  <CompanyLogo ticker={peer.ticker} name={peer.name} size="xs" />
                  <span>{peer.ticker}</span><strong>{peer.name}</strong><ArrowRight size={16} aria-hidden="true" />
                </button>
                <a href={peer.selection_source_url} target="_blank" rel="noreferrer">{peer.selection_source}</a>
                {peer.selection_evidence?.map((evidence) => (
                  <div key={`${evidence.accession}:${evidence.competitor}`}>
                    <a href={evidence.sourceUrl} target="_blank" rel="noreferrer">{evidence.reporter} annual filing, {evidence.filingDate}</a>
                    <small> Accession {evidence.accession}</small>
                  </div>
                ))}
              </article>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function EarningsView({ analysis }: { analysis: Analysis }) {
  const latest = analysis.financials.at(-1)!;
  return (
    <div className="page-stack">
      <section className="split-section">
        <div>
          <SectionHeading title="Annual earnings" detail={`Fiscal ${latest.fiscal_year} versus prior year`} />
          <div className="score-matrix">
            <MetricCell label="Revenue growth" value={percent(analysis.metrics.revenue_growth_yoy)} detail="year over year" />
            <MetricCell label="EPS growth" value={percent(analysis.metrics.eps_growth_yoy)} detail="year over year" />
            <MetricCell label="FCF growth" value={percent(analysis.metrics.fcf_growth_yoy)} detail="year over year" />
            <MetricCell label="FCF conversion" value={percent(analysis.metrics.fcf_conversion)} detail="of net income" />
          </div>
        </div>
        <div className="earnings-quality">
          <SectionHeading title="Earnings quality" />
          <div className="big-stat">{analysis.score.categories.earnings_quality}<small>/100</small></div>
          <p className="body-copy">Profitable in {analysis.metrics.earnings_positive_years} of {analysis.metrics.history_years} years. Operating-margin variability: {percent(analysis.metrics.operating_margin_volatility)}.</p>
        </div>
      </section>
    </div>
  );
}

function filingDateLabel(value: string | null) {
  if (!value) return "Not available";
  const date = new Date(`${value}T12:00:00Z`);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date);
}

function fiscalPeriodForFiling(analysis: Analysis, filing: Analysis["filings"][number]) {
  if (!filing.report_date) return filing.form === "8-K" ? "Not applicable" : "Not identified";
  const period = [...analysis.financials, ...analysis.quarterly_financials]
    .find((candidate) => candidate.period_end === filing.report_date);
  if (!period) return filing.form === "8-K" ? "Not applicable" : "Not identified";
  return period.fiscal_quarter ? `Q${period.fiscal_quarter} FY ${period.fiscal_year}` : `FY ${period.fiscal_year}`;
}

function FilingsView({ analysis }: { analysis: Analysis }) {
  return (
    <div className="page-stack">
      <section className="table-section">
        <SectionHeading title="SEC filings" />
        {analysis.filings.length ? (
          <div className="filings-table-scroll"><table className="research-table filings-table">
            <thead><tr><th>Fiscal period</th><th>Report period ending</th><th>Filing form</th><th>Filing date</th><th>Accession</th><th>Source</th></tr></thead>
            <tbody>{analysis.filings.map((filing) => (
              <tr key={filing.accession_number}>
                <th>{fiscalPeriodForFiling(analysis, filing)}</th>
                <td>{filingDateLabel(filing.report_date)}</td>
                <td><Tag type="cool-gray">{filing.form}</Tag></td>
                <td>{filingDateLabel(filing.filing_date)}</td>
                <td className="mono">{filing.accession_number}</td>
                <td><a href={filing.source_url} target="_blank" rel="noreferrer">Open filing</a></td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <div className="empty-state"><Document size={32} /><h3>No filing index in offline mode</h3><p>Financial statement provenance is still available per metric through the API.</p></div>}
      </section>
    </div>
  );
}

function RisksView({ analysis, onRetry }: { analysis: Analysis; onRetry: () => void }) {
  const filedRisks = analysis.risks.filter((risk) => risk.kind === "filing_theme" || risk.severity === "filed");
  const overviewRisks = filedRisks.slice(0, 4);
  const filing = filedRisks[0];
  const filingDate = filing?.filing_date
    ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${filing.filing_date}T12:00:00Z`))
    : "Unavailable";
  return (
    <div className="page-stack risk-page">
      <section className="risk-overview-hero" aria-labelledby="risk-overview-heading">
        <div className="risk-overview-copy">
          <div className="risk-overview-label"><ShieldAlert size={20} aria-hidden="true" /><span>RISK OVERVIEW</span></div>
          <h2 id="risk-overview-heading">Risks</h2>
          <div className="risk-overview-watch">
            <h3>What to watch</h3>
            <ul aria-label="Important risks to watch">
              {overviewRisks.map((risk) => <li key={risk.theme ?? risk.title}>{riskWatchLabel(risk)}</li>)}
            </ul>
          </div>
        </div>
      </section>
      {filedRisks.length ? (
        <section className="risk-dossier" aria-labelledby="risk-dossier-heading">
          <header className="risk-dossier-header">
            <div>
              <span className="risk-kicker">ANNUAL FILING REVIEW</span>
              <h2 id="risk-dossier-heading">Company-disclosed themes</h2>
              <p>The company does not rank these themes by severity.</p>
            </div>
          </header>
          <div className="risk-filing-bar">
            <div><span>Document</span><strong>{filing?.form ?? "Annual filing"}</strong></div>
            <div><span>Section</span><strong>{filing?.item ?? "Risk Factors"}</strong></div>
            <div><span>Filed</span><strong>{filingDate}</strong></div>
            <div><span>Source</span>{filing?.source_url ? <a href={filing.source_url} target="_blank" rel="noreferrer">Open on SEC.gov <ArrowRight size={14} /></a> : <strong>Unavailable</strong>}</div>
          </div>
          <div className="risk-theme-list">
            {filedRisks.map((risk, index) => (
              <article key={risk.theme ?? risk.title}>
                <span className="risk-theme-number">{String(index + 1).padStart(2, "0")}</span>
                <div className="risk-theme-copy">
                  <div className="risk-theme-label"><span>Company disclosed</span>{risk.form && <small>{risk.form}</small>}</div>
                  <h3>{risk.title}</h3>
                  <p>{risk.detail}</p>
                  {risk.evidence?.[0] && (
                    <details>
                      <summary>View filing evidence</summary>
                      <blockquote>{risk.evidence[0]}</blockquote>
                    </details>
                  )}
                </div>
              </article>
            ))}
          </div>
          <footer className="risk-method-note"><Information size={16} /><p>BullCase groups related filing statements into themes and keeps an evidence excerpt for review. Summaries are research aids, not a replacement for reading the full filing.</p></footer>
        </section>
      ) : (
        <section className="risk-fallback" aria-labelledby="risk-fallback-heading">
          <header><span className="risk-kicker">SOURCE ERROR</span><h2 id="risk-fallback-heading">Risk disclosures unavailable</h2><p>The latest annual filing risk section could not be loaded or summarized. No substitute risk data has been generated.</p></header>
          <InlineNotification kind="error" lowContrast title="Could not load filing risks" subtitle="Try the SEC source again. BullCase will not replace missing filing disclosures with modeled risks." hideCloseButton />
          <Button kind="tertiary" renderIcon={Renew} onClick={onRetry}>Retry filing risks</Button>
        </section>
      )}
    </div>
  );
}

