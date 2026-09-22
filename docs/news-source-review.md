# News source addition

Luna extra-high research task: 01a08483-0b2e-7470-add9-918884ec8793. Research-only task, no app edits by researcher.

Added Federal Reserve monetary-policy RSS for all companies and banking-policy RSS for financial-company classifications. These are policy context, NOT company journalism. Maximum two entries per feed, original dates/links, no publisher logos/images, no fabricated ticker match. Documents cache for 30 minutes per isolate with single-flight; existing per-company D1 news caching remains in place. A five-second deadline and zero retries bound requests. Only the two configured URLs are fetched. Failure produces the existing partial-coverage warning.

Official documentation and permission reviewed:
- https://www.federalreserve.gov/feeds/feeds.htm
- https://www.federalreserve.gov/disclaimer.htm (Board content generally public domain; attribution required; third-party material and logos excluded)
- https://www.federalreserve.gov/feeds/press_monetary.xml
- https://www.federalreserve.gov/feeds/press_bcreg.xml

Both RSS endpoints returned valid live XML. Entries older than 90 days, future dates, missing dates, and off-domain links are excluded. One entry from each added feed can occupy the existing 24-item limit; no extra list growth.

Not added: PR Newswire/BBC feeds without business permission; Alpha Vantage/Marketaux free personal-use plans; Finnhub without appropriate token and display terms; GDELT (live test throttled, publisher-content rights unresolved); issuer IR feeds without verified access and issuer-specific reuse permission. No subscriptions, keys, or permissions were purchased or inferred.

Also fixed short-symbol matching (e.g. ordinary English "A" is not Agilent ticker evidence) and added canonical-URL deduplication alongside title deduplication.
