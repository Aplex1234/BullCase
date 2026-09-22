# Peer upgrade checkpoint, 2026-09-08

## Continuation after user waived usage stop

- Added regression using real-provider-style sparse descriptions; automatic semiconductor matches now require positive product overlap. Real-provider NVDA/AMD/INTC results each retain the other two; DELL retains HPQ/SMCI/HPE. The earlier AMAT/analog false positives no longer appear in these checks.
- Added conservative exact-name competition-statement candidate discovery from the already fetched filing context. It is capped at 12, rejects ambiguous names and hypothetical mentions, and never grants the reviewed-evidence exemption. Shortlist enrichment is capped at 24 including evidence candidates.
- All 133 tests and both builds/typechecks/lints passed after these changes. Frozen fixtures unchanged.
- DEPLOYMENT HELD: controlled same-input comparison using old public peer sets versus new local peers changed NVDA blended value from 170.40667317180396 to 326.0926327509589 while DCF stayed 156.3760059413339. Comparable value changed from unavailable to 948.8364710675783, driven by AMD as the only positive-P/E peer. AMD blended value changed 158.62083374065335 to 135.94740609224564, with unchanged DCF 165.2261312395541. INTC DCF/fair value stayed zero under existing formulas.
- Need user direction before adding safeguards or separating competitive peers from valuation peers, since either changes financial methodology. No formula or expected-value edits were made. Broader provenance/segment improvements and end-to-end persistence fault injection from the remaining list below are still outstanding.
- Follow-up controlled comparison aligned common peers to identical current metrics: NVDA still changes 170.40667317180396 -> 326.0926327509589 (AMD P/E 190.45165576493656, INTC P/E null). DELL, whose membership is unchanged, gives identical 225.7917162697548 before/after. Thus the NVDA impact is confirmed as membership-driven; initial mixed-cache DELL differences were data freshness, not selection. Initial AMD figures above were not fully aligned across old-only peers and should not be presented as a pure selection experiment.

The following sections describe the earlier checkpoint and its remaining backlog, updated by the continuation notes above.

Status: partial implementation, locally validated, NOT published. Production remains version 45.
User requested periodic usage checks and stopping before 2% remaining. Last check before this handoff: 5% remaining.

## Completed

- Added reviewed directed SEC competitive evidence with reporter, competitor, business segments, URL, filing date, accession. Verified current annual filings through SEC sources/providers for NVDA, AMD, INTC, HPQ, HPE, SMCI.
- Added independent reverse-evidence confidence, latest-per-reporter deduplication and age-based confidence reduction. No fabricated reverse disclosures.
- Filing-backed candidates survive absent profiles/taxonomy. Removed the exact-industry/sector prefilter; existing bounded shortlist can now see adjacent industries.
- Display filing evidence beside peer rationale. Model and component versions now 4.4; no financial formula changes.
- Cache and audit persistence fail independently without discarding valid built peers.
- Added initial semiconductor product-segment signals and disagreement filtering. This is NOT a complete segment exposure model.

## Validation

- All 131 tests passed: 45 hosted unit, 47 integration, 10 API, 10 performance, 19 frontend.
- Both TypeScript checks, both lints and both production builds passed.
- Six frozen financial fixtures unchanged; expected files were not edited.
- Local execution with real SEC/Nasdaq providers: NVDA includes AMD/INTC; AMD includes NVDA/INTC; INTC includes AMD/NVDA; DELL includes HPQ/SMCI/HPE.
- No browser interaction or visual QA performed.

## Remaining, in order

1. Tighten automatic semiconductor precision with real provider profile fixtures. Latest local output still included AMAT for AMD/INTC and analog/power vendors for INTC. Product guard passes synthetic tests but sparse/broad real descriptions weaken it. Do not call the general precision issue solved.
2. Extend beyond the small reviewed evidence registry: conservative filing-named candidate discovery, issuer/alias resolution, bounded cached evidence updates. Existing filing text is business context, not a general verified competitor extractor. Do not infer competition from mere company mentions.
3. Broaden segment/business-facet handling beyond semiconductor-specific rules without inventing revenue exposure. Current records list segments but do not estimate their importance within each company's overall business.
4. Complete provenance for legacy reviewed profile/filing peers and inferred peers, including provider/data dates. Legacy DELL seed links remain in source but structured current evidence takes display precedence. Consider removing stale duplicates after validation.
5. Review raw-score saturation and ordering: reviewed/evidence peers are grouped before automatic peers even when automatic scores are higher. Reverse confidence is explicit but ranking may saturate at 100. Also test outdated/future evidence and cap shortlisted evidence candidates if registry expands.
6. Run end-to-end request tests for persistence failure (current new tests exercise the persistence helper), missing profiles, limits and loading performance.
7. Compare old/new live-derived peer valuation effects with identical financial inputs. Frozen-input tests prove arithmetic unchanged, not that newly selected peers leave comparable valuation unchanged.
8. Rerun all checks after remaining changes. Publish only the completed, reviewed upgrade under the applicable public deployment authorization and verify production responses.

No credentials or reset credits used. No background job remains running. Resume in this checkout; do not redo completed evidence verification unless sources changed.
