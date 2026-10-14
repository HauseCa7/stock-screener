export function money(v: number | null | undefined, currency = "USD"): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const sign = v < 0 ? "−" : "";
  const a = Math.abs(v);
  const sym = currency === "USD" ? "$" : currency === "CAD" ? "C$" : currency === "EUR" ? "€" : currency === "GBP" ? "£" : "";
  const suffix = sym ? "" : ` ${currency}`;
  if (a >= 1e12) return `${sign}${sym}${(a / 1e12).toFixed(2)}T${suffix}`;
  if (a >= 1e9) return `${sign}${sym}${(a / 1e9).toFixed(2)}B${suffix}`;
  if (a >= 1e6) return `${sign}${sym}${(a / 1e6).toFixed(1)}M${suffix}`;
  if (a >= 1e3) return `${sign}${sym}${(a / 1e3).toFixed(1)}K${suffix}`;
  return `${sign}${sym}${a.toFixed(2)}${suffix}`;
}

export function pct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `${v.toFixed(digits)}%`;
}

export function times(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined) return "—";
  if (v === Infinity) return "∞";
  if (!Number.isFinite(v)) return "—";
  return `${v.toFixed(digits)}x`;
}

export function num(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return v.toLocaleString(undefined, { maximumFractionDigits: digits });
}

export function fy(end: string): string {
  return end.slice(0, 7);
}

/** Per-share amounts: never abbreviated. */
export function perShare(v: number | null | undefined, currency = "USD"): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const sym = currency === "USD" ? "$" : currency === "CAD" ? "C$" : "";
  return `${v < 0 ? "−" : ""}${sym}${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
