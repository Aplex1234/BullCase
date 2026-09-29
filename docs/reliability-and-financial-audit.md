# BullCase reliability and financial audit

Audit date: September 29, 2026.

## Confirmed findings and corrections

- A fresh analysis cache could overwrite the page status even when financials or quotes were stale. Cache responses now preserve source staleness, bypass edge storage for stale results, and display saved filing and quote dates beside the company name.
- The hosted SEC contact header was not configured. Runtime configuration now declares the project and its approved contact in accordance with [SEC access guidance](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data). SEC access can still depend on provider restrictions and hosting network conditions.
- Optional risk, peer, estimate and news failures could reject a full analysis request. Those sections now remain explicitly unavailable while core financials and quotes remain usable. Required financial and quote failures still return an error.
- Current portions of term debt were treated as substitutes for short-term borrowing. The normalizer now adds these distinct components, using aggregate short-term borrowing in preference to commercial paper to prevent double counting.
- Quarterly weighted-average diluted shares were subtracted like cash-flow totals, producing negative Q4 share counts. They now use period-day weighting. Comparative figures stay associated with their original fiscal period while later reported values can update that period.
- Missing current investment totals were implicitly treated as zero. Incomplete liquidity is now labelled unavailable and blocks valuations requiring net debt. This matters for NVIDIA, whose annual marketable-securities balance is not returned in the standard Company Facts tags used here.

## Filing reconciliation

Figures below are USD billions, except shares, which are billions of shares. Free cash flow is calculated as operating cash flow less capital expenditure.

| Company and audited period | Revenue | Operating cash flow | Capex | Free cash flow | Debt | Diluted average shares |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Apple, FY2025 | 416.161 | 111.482 | 12.715 | 98.767 | 98.657 | 15.004697 |
| NVIDIA, FY2026 | 215.938 | 102.718 | 6.042 | 96.676 | 8.468 | 24.514 |
| Costco, FY2025 | 275.235 | 13.335 | 5.498 | 7.837 | 5.788 | 0.444803 |

Reference filings: [Apple FY2025 10-K](https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/aapl-20250927.htm), [NVIDIA FY2026 10-K](https://www.sec.gov/Archives/edgar/data/1045810/000104581026000021/nvda-20260125.htm), [Costco FY2025 10-K](https://www.sec.gov/Archives/edgar/data/909832/000090983225000101/cost-20250831.htm).

Apple debt previously omitted $7.979 billion of commercial paper. Corrected debt is $98.657 billion, and net debt under the existing cash-plus-current-investments convention is $43.960 billion. Apple non-current securities are excluded by that convention, rather than included as cash. NVIDIA's reported marketable securities are $51.951 billion, but cannot be replaced by cash alone when the feed omits that total.

## Verification and scope

`sites-app/tests/financial-audit.test.mjs` covers the defects using deterministic inputs. `sites-app/tests/live-financial-audit.mjs` is an opt-in SEC reconciliation for the three filings above, including positive quarterly shares, cash-flow arithmetic, market multiples and an independently calculated DCF. It requires a genuine `SEC_USER_AGENT` environment value.

Existing frozen regression input and numerical-output fixtures remain unchanged. Their normalization version label is advanced to identify the corrected implementation. Financial component, analysis and peer-cache versions are advanced so previously derived results are not reused as current calculations.

This audit covers three annual filings and selected calculation paths. It does not certify every issuer, all custom XBRL extensions, or the investment merit of modeled valuations. NVIDIA's missing investment tags remain a coverage limitation, exposed as unavailable rather than silently estimated.
