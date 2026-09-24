"use client";

import Renew from "@carbon/icons-react/es/Renew.js";
import { useEffect, useRef } from "react";

import type { RefreshStatus } from "@/hooks/useCompanyAnalysis";
import { compactMoney, money, multiple } from "@/lib/format";
import type { Analysis } from "@/lib/types";
import { Tag } from "./BullCasePrimitives";
import { CompanyLogo } from "./CompanyLogo";

function freshnessTime(value: string | null | undefined, dateOnly = false) {
  if (!value) return "Unavailable";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("en-US", dateOnly
    ? { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }
    : { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" });
}

function freshnessDisplay(
  item: NonNullable<Analysis["freshness"]>["financials"],
  dateOnly = false,
) {
  if (item.status === "unavailable") return "Unavailable";
  return item.as_of ? freshnessTime(item.as_of, dateOnly) : "Timestamp not supplied";
}

export function CompanyHeader({
  analysis,
  refreshing,
  refreshStatus,
  onRefresh,
  onGmeEasterEgg,
}: {
  analysis: Analysis;
  refreshing: boolean;
  refreshStatus: RefreshStatus | null;
  onRefresh: () => void;
  onGmeEasterEgg: () => void;
}) {
  const classification = [analysis.company.sector, analysis.company.industry].filter(Boolean).join(" / ");
  const peg = analysis.valuation.growth_projection.peg_ratio;
  const freshness = analysis.freshness;
  const statusLabel = refreshing
    ? "Refreshing"
    : refreshStatus?.outcome === "error"
      ? "Refresh failed"
      : freshness?.page_status === "stale" || freshness?.page_status === "refreshing"
        ? "Stale"
        : "Fresh";
  const statusTone = statusLabel === "Refresh failed"
    ? "red"
    : statusLabel === "Stale"
      ? "warm-gray"
      : "green";
  const quoteProvider = analysis.quote.provider.replace(/\s+delayed quote$/i, "");
  const gmeClicks = useRef(0);
  const gmeResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    gmeClicks.current = 0;
    if (gmeResetTimer.current) clearTimeout(gmeResetTimer.current);
    return () => {
      if (gmeResetTimer.current) clearTimeout(gmeResetTimer.current);
    };
  }, [analysis.company.ticker]);

  function handleGmeLogoClick() {
    if (gmeResetTimer.current) clearTimeout(gmeResetTimer.current);
    gmeClicks.current += 1;
    if (gmeClicks.current >= 3) {
      gmeClicks.current = 0;
      gmeResetTimer.current = null;
      onGmeEasterEgg();
      return;
    }
    gmeResetTimer.current = setTimeout(() => { gmeClicks.current = 0; }, 1400);
  }

  return (
    <section className="company-header">
      <div className="company-identity">
        {analysis.company.ticker === "GME" ? <button type="button" className="company-logo-easter-trigger" aria-label="GameStop logo" onClick={handleGmeLogoClick}>
          <CompanyLogo ticker={analysis.company.ticker} name={analysis.company.name} size="lg" priority className="company-avatar" />
        </button> : <CompanyLogo ticker={analysis.company.ticker} name={analysis.company.name} size="lg" priority className="company-avatar" />}
        <div className="company-overview">
          <div className="company-title-row">
            <h1>{analysis.company.name}</h1>
            <span>{analysis.company.ticker}</span>
            <Tag type={statusTone}>{statusLabel}</Tag>
            <button
              type="button"
              className={`company-refresh-button${refreshing ? " is-refreshing" : ""}`}
              aria-label={refreshing ? "Refreshing data" : "Refresh data"}
              title={refreshing ? "Refreshing data" : "Refresh data"}
              disabled={refreshing}
              onClick={onRefresh}
            >
              <Renew size={16} aria-hidden="true" />
            </button>
          </div>
          <span className="company-refresh-status" aria-live="polite">{refreshStatus?.message}</span>
          <p>{analysis.company.exchange || "US listed"} / {classification || "SEC reporting company"}</p>
        </div>
      </div>
      <div className="company-quote">
          <div className="company-price-line">
            <strong>{money(analysis.quote.price)}</strong>
          </div>
          <small>
            As of {analysis.quote.as_of}, {analysis.quote.source_url ? (
              <a
                href={analysis.quote.source_url}
                target="_blank"
                rel="noreferrer"
                aria-label={`Open ${analysis.quote.provider} source`}
              >
                {quoteProvider}
              </a>
            ) : quoteProvider}
          </small>
      </div>
      <div className="company-snapshot" aria-label="Company market snapshot">
        <div><span>Market cap</span><strong>{compactMoney(analysis.metrics.market_cap)}</strong></div>
        <div><span>P / E</span><strong>{multiple(analysis.metrics.pe)}</strong></div>
        <div><span>PEG</span><strong>{peg == null ? "N/A" : peg.toFixed(2)}</strong></div>
        <div><span>Price / book</span><strong>{multiple(analysis.metrics.price_to_book)}</strong></div>
      </div>
      {freshness && (
        <details className="company-source-details">
          <summary>Source timestamps and freshness</summary>
        <div className="freshness-strip" aria-label="Data freshness">
          <div><span>Financial filing</span><strong>{freshnessDisplay(freshness.financials, true)}</strong><small>{freshness.financials.status}</small></div>
          <div><span>Quote updated</span><strong>{freshnessDisplay(freshness.quote)}</strong><small>{freshness.quote.status}</small></div>
          <div><span>Estimates updated</span><strong>{freshnessDisplay(freshness.analyst_estimates)}</strong><small>{freshness.analyst_estimates.status}</small></div>
          <div><span>Comparable set</span><strong>{freshnessDisplay(freshness.comps)}</strong><small>{freshness.comps.status}</small></div>
        </div>
        </details>
      )}
    </section>
  );
}
