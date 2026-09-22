# Frozen financial regression baseline

These checked-in fixtures freeze the provider-derived inputs and calculated outputs used before the Phase 1 loading change.

The representative set covers:

- AAPL: large profitable technology company
- JPM: bank and financial company
- WMT: retailer and consumer company
- CAT: capital-intensive industrial company
- RIVN: loss-making company
- BRK-B: unusual share structure

`inputs/` contains complete normalized annual and quarterly financial inputs, delayed quote data, analyst estimates, peer inputs, and filing metadata captured from the production application on the date recorded in each file. `expected/` contains the resulting metrics, DCF, comparable-company value, growth-adjusted and normalized values, bear/base/bull cases, score, and buy target.

The regression test disables external access and rebuilds each result from its frozen input. Numeric comparisons use both an absolute and relative tolerance, so harmless floating-point representation differences do not create false failures.

The generator is retained only to make the origin and refresh process inspectable. Running it intentionally replaces the baseline with a new live production snapshot and should not be part of ordinary test runs.
