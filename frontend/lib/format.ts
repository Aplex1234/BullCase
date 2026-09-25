const currencyFormatters = new Map<number, Intl.NumberFormat>();
const compactCurrencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});
const compactNumberFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function formatFreshnessTime(value: string | null | undefined, dateOnly = false): string {
  if (!value) return "Unavailable";
  const source = value.trim();
  // Some quote providers supply only a calendar date. Keep that precision instead
  // of interpreting midnight in the server's or visitor's local timezone.
  if (/^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2}, \d{4}$/i.test(source)) return source;
  const isoDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(source);
  const zoneLessIsoTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(source);
  const parsed = new Date(isoDateOnly ? `${source}T00:00:00Z` : zoneLessIsoTime ? `${source}Z` : source);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("en-US", dateOnly || isoDateOnly
    ? { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }
    : { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" });
}

function currencyFormatter(digits: number): Intl.NumberFormat {
  const normalizedDigits = Math.max(0, Math.min(20, Math.trunc(digits)));
  const cached = currencyFormatters.get(normalizedDigits);
  if (cached) return cached;
  const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: normalizedDigits,
    maximumFractionDigits: normalizedDigits,
  });
  currencyFormatters.set(normalizedDigits, formatter);
  return formatter;
}

export function money(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return currencyFormatter(digits).format(value);
}

export function compactMoney(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return compactCurrencyFormatter.format(value);
}

export function compactShares(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return `${compactNumberFormatter.format(value)} shares`;
}

export function percent(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return `${(value * 100).toFixed(digits)}%`;
}

export function multiple(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return `${value.toFixed(1)}x`;
}

export function titleCase(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
