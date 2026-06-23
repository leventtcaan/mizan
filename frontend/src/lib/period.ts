/**
 * Time-window labels — every financial figure must say exactly which window it covers.
 * Never show a bare "this month": always the explicit calendar month or date range.
 */

/** Current calendar month, e.g. "Haziran 2026" / "June 2026". */
export function currentMonthLabel(lang: string): string {
  return new Date().toLocaleDateString(lang === "tr" ? "tr-TR" : "en-US", {
    month: "long",
    year: "numeric",
  });
}

/** A date range, noon-anchored to avoid timezone day-shift, e.g. "18 May – 18 Haz". */
export function dateRangeLabel(startISO: string, endISO: string, lang: string): string {
  const loc = lang === "tr" ? "tr-TR" : "en-US";
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
  const s = new Date(startISO + "T12:00:00").toLocaleDateString(loc, opts);
  const e = new Date(endISO + "T12:00:00").toLocaleDateString(loc, opts);
  return `${s} – ${e}`;
}
