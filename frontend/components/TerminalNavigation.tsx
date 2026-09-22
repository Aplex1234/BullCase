"use client";

import Calculator from "@carbon/icons-react/es/Calculator.js";
import ChartHighLow from "@carbon/icons-react/es/ChartHighLow.js";
import ChartLineData from "@carbon/icons-react/es/ChartLineData.js";
import Chat from "@carbon/icons-react/es/Chat.js";
import Compare from "@carbon/icons-react/es/Compare.js";
import Dashboard from "@carbon/icons-react/es/Dashboard.js";
import Document from "@carbon/icons-react/es/Document.js";
import Information from "@carbon/icons-react/es/Information.js";
import Report from "@carbon/icons-react/es/Report.js";
import Rss from "@carbon/icons-react/es/Rss.js";
import WarningAlt from "@carbon/icons-react/es/WarningAlt.js";
import type { ComponentType } from "react";

import type { TerminalPage } from "./ResearchTerminal";

const NAV_ITEMS: Array<{
  key: TerminalPage;
  label: string;
  icon: ComponentType<{ size?: number }>;
}> = [
  { key: "overview", label: "Overview", icon: Dashboard },
  { key: "financials", label: "Financials", icon: ChartLineData },
  { key: "valuation", label: "Valuation", icon: Calculator },
  { key: "buyTarget", label: "Price Range", icon: ChartHighLow },
  { key: "comps", label: "Comps", icon: Compare },
  { key: "earnings", label: "Earnings", icon: Report },
  { key: "news", label: "News", icon: Rss },
  { key: "filings", label: "Filings", icon: Document },
  { key: "risks", label: "Risks", icon: WarningAlt },
  { key: "research", label: "AI Research", icon: Chat },
];

export function TerminalNavigation({
  activePage,
  onSelectPage,
}: {
  activePage: TerminalPage;
  onSelectPage: (page: TerminalPage) => void;
}) {
  return (
    <aside className="sidebar" aria-label="Research sections">
      <nav>
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <button
              type="button"
              key={item.key}
              className={activePage === item.key ? "nav-item active" : "nav-item"}
              aria-current={activePage === item.key ? "page" : undefined}
              onClick={() => onSelectPage(item.key)}
            >
              <Icon size={19} aria-hidden="true" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
      <span className="horizontal-scroll-hint nav-scroll-hint">Swipe sideways for more sections</span>
      {/* Reserved layout space for future account profiles, not a nonfunctional control. */}
      <div className="sidebar-profile-space" aria-hidden="true" />
      <div className="sidebar-foot">
        <Information size={16} aria-hidden="true" />
        <span>Research software. Not investment advice.</span>
      </div>
    </aside>
  );
}
