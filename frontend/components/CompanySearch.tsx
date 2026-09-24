"use client";

import Search from "@carbon/icons-react/es/Search.js";

import type { SecuritySearchController } from "@/hooks/useSecuritySearch";
import { Button, TextInput } from "./BullCasePrimitives";
import { CompanyLogo } from "./CompanyLogo";

export function CompanySearch({ search }: { search: SecuritySearchController }) {
  return (
    <div className="search-module">
      <label htmlFor="ticker-search">Search public companies</label>
      <form className="ticker-search" onSubmit={search.submit}>
        <div className="search-field">
          <TextInput
            id="ticker-search"
            labelText="Ticker or company"
            hideLabel
            placeholder="Ticker or company, for example AAPL or Mastercard…"
            value={search.input}
            role="combobox"
            aria-autocomplete="list"
            aria-controls="security-search-results"
            aria-expanded={search.open}
            aria-activedescendant={search.open && search.highlightedIndex >= 0
              ? `security-result-${search.highlightedIndex}`
              : undefined}
            autoComplete="off"
            onPointerDown={() => {
              search.setOpen(true);
              search.setHighlightedIndex(search.options.length ? 0 : -1);
            }}
            onBlur={() => window.setTimeout(search.close, 120)}
            onChange={(event) => search.changeInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" && search.options.length) {
                event.preventDefault();
                search.setOpen(true);
                search.setHighlightedIndex((search.highlightedIndex + 1) % search.options.length);
              } else if (event.key === "ArrowUp" && search.options.length) {
                event.preventDefault();
                search.setOpen(true);
                search.setHighlightedIndex(search.highlightedIndex <= 0
                  ? search.options.length - 1
                  : search.highlightedIndex - 1);
              } else if (event.key === "Escape") {
                search.close();
              }
            }}
          />
          {search.open && (
            <div id="security-search-results" className="search-results" role="listbox" aria-label="Security search suggestions">
              {search.results.length > 0 && (
                <div className="search-group-label" role="presentation">Matching companies</div>
              )}
              {search.results.map((result, index) => (
                <button
                  id={`security-result-${index}`}
                  key={result.listing_id}
                  type="button"
                  role="option"
                  aria-selected={index === search.highlightedIndex}
                  className={index === search.highlightedIndex ? "is-highlighted" : ""}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => search.prefetchOption(index)}
                  onClick={() => search.selectSecurity(result)}
                >
                  <CompanyLogo ticker={result.ticker} name={result.name} size="sm" alt="" />
                  <strong>{result.ticker}</strong>
                  <span>{result.name}</span>
                  <small>{result.exchange} / {result.mic}</small>
                </button>
              ))}
              {search.uniqueRecent.length > 0 && (
                <div className="search-group-label" role="presentation">Recently searched</div>
              )}
              {search.uniqueRecent.map((result, index) => {
                const optionIndex = search.results.length + index;
                return (
                  <button
                    id={`security-result-${optionIndex}`}
                    key={`recent-${result.ticker}`}
                    type="button"
                    role="option"
                    aria-selected={optionIndex === search.highlightedIndex}
                    className={optionIndex === search.highlightedIndex ? "is-highlighted" : ""}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => search.prefetchOption(optionIndex)}
                    onClick={() => search.selectSecurity(result)}
                  >
                    <CompanyLogo ticker={result.ticker} name={result.name} size="sm" alt="" />
                    <strong>{result.ticker}</strong>
                    <span>{result.name}</span>
                    <small>{result.exchange} / {result.mic}</small>
                  </button>
                );
              })}
              {search.searchError && <p role="alert">{search.searchError}</p>}
              {!search.searching && !search.searchError && search.options.length === 0 && (
                <p>{search.input.trim()
                  ? "No matching SEC-reporting companies"
                  : "Your recent searches will appear here."}</p>
              )}
            </div>
          )}
          <span className="search-status" aria-live="polite">
            {search.submitting
              ? "Finding company…"
              : search.searching
                ? "Searching securities…"
              : search.searchError ?? (search.results.length ? `${search.results.length} matches` : "")}
          </span>
        </div>
        <Button type="submit" renderIcon={Search} iconDescription="Run analysis">
          Analyze
        </Button>
      </form>
    </div>
  );
}
