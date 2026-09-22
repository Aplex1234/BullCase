import type { NewsFeed } from "./news.ts";
import type { FinancialValues, NormalizedPeriod } from "./sec-normalizer.ts";

export type Values = FinancialValues;
export type Period = NormalizedPeriod;

export type CompanyProfile = {
  cik: string;
  name: string;
  sector: string | null;
  industry: string | null;
  exchange: string | null;
  description: string | null;
  description_source: string;
  description_source_url: string;
};

export type Filing = {
  form: string;
  filing_date: string | null;
  report_date: string | null;
  accession_number: string;
  source_url: string;
};

export type CompanyRisk = {
  severity: "filed" | "high" | "medium" | "low";
  kind?: "filing_theme" | "quantitative_indicator";
  theme?: string;
  title: string;
  detail: string;
  evidence?: string[];
  item?: string;
  source_url?: string;
  filing_date?: string | null;
  report_date?: string | null;
  accession_number?: string;
  form?: string;
};

export type FinancialSource = {
  profile: CompanyProfile;
  periods: Period[];
  quarterlyPeriods: Period[];
  filings: Filing[];
  filingRisks: CompanyRisk[];
};

export type Quote = {
  price: number;
  market_cap: number | null;
  as_of: string;
  currency: string;
  provider: string;
  source_url: string | null;
  is_delayed: boolean;
};

export type ComparableCompany = {
  ticker: string;
  name: string;
  sector: string | null;
  industry: string | null;
  price: number;
  market_cap: number | null;
  revenue_growth: number | null;
  net_income_growth: number | null;
  gross_margin: number | null;
  operating_margin: number | null;
  fcf_margin: number | null;
  roic: number | null;
  pe: number | null;
  price_to_book: number | null;
  price_fcf: number | null;
  fcf_yield: number | null;
  fiscal_year: number;
  quote_as_of: string;
  selection_reason: string;
  selection_score: number;
  selection_factors: string[];
  selection_source: string;
  selection_source_url: string;
  selection_evidence?: import("./peer-evidence.ts").PeerEvidence[];
};

export type NasdaqProfile = {
  name: string | null;
  sector: string | null;
  industry: string | null;
  description: string | null;
};

export type NasdaqScreenerRow = {
  symbol?: string;
  name?: string;
  marketCap?: string;
  sector?: string;
  industry?: string;
};

export type AnalystEstimateRow = {
  period: string;
  consensus_eps: number | null;
  high_eps: number | null;
  low_eps: number | null;
  analyst_count: number | null;
  revisions_up: number | null;
  revisions_down: number | null;
};

export type AnalystEstimates = {
  quarterly: AnalystEstimateRow[];
  annual: AnalystEstimateRow[];
  provider: string;
  as_of: string | null;
  source_url: string;
  disclosure: string;
};

export type PeerSet = {
  companies: ComparableCompany[];
  methodology: string;
  source_provider: string;
  source_url: string;
  source_as_of: string;
  candidates_considered: number;
  selection_version: string;
};

export type ComparableCompanyDataLoader = (ticker: string) => Promise<{
  financials: FinancialSource;
  quote: Quote;
}>;

export type AnalysisSources = {
  allowUnavailableValuation?: boolean;
  financials?: FinancialSource;
  financialSourceMode?: string;
  quote?: Quote;
  analystEstimates?: AnalystEstimates;
  peerSet?: PeerSet;
  newsFeed?: NewsFeed;
  warnings?: string[];
};

export type FinancialFingerprint = {
  accessionNumber: string;
  filingDate: string | null;
  form: string | null;
};

export type Assumptions = {
  forecast_years: number;
  revenue_growth: number | null;
  fcf_margin: number | null;
  wacc: number;
  terminal_growth: number;
};
