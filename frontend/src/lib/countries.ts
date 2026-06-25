// ISO 3166-1 alpha-2 country codes. Display names are resolved at render time via
// Intl.DisplayNames in the user's language (so we store codes, not 200×2 strings).
// We only persist the 2-letter code — it drives default currency/formatting and,
// critically, which privacy regime (GDPR/KVKK/…) applies to the account.
export const COUNTRY_CODES: string[] = [
  "AE", "AF", "AL", "AM", "AO", "AR", "AT", "AU", "AZ", "BA", "BD", "BE", "BG", "BH",
  "BI", "BJ", "BN", "BO", "BR", "BW", "BY", "BZ", "CA", "CD", "CG", "CH", "CI", "CL",
  "CM", "CN", "CO", "CR", "CU", "CY", "CZ", "DE", "DK", "DO", "DZ", "EC", "EE", "EG",
  "ES", "ET", "FI", "FJ", "FR", "GA", "GB", "GE", "GH", "GR", "GT", "HK", "HN", "HR",
  "HT", "HU", "ID", "IE", "IL", "IN", "IQ", "IR", "IS", "IT", "JM", "JO", "JP", "KE",
  "KG", "KH", "KR", "KW", "KZ", "LA", "LB", "LK", "LT", "LU", "LV", "LY", "MA", "MD",
  "ME", "MG", "MK", "ML", "MM", "MN", "MO", "MT", "MU", "MV", "MX", "MY", "MZ", "NA",
  "NG", "NI", "NL", "NO", "NP", "NZ", "OM", "PA", "PE", "PH", "PK", "PL", "PT", "PY",
  "QA", "RO", "RS", "RU", "RW", "SA", "SD", "SE", "SG", "SI", "SK", "SN", "SO", "SV",
  "SY", "TH", "TJ", "TM", "TN", "TR", "TW", "TZ", "UA", "UG", "US", "UY", "UZ", "VE",
  "VN", "YE", "ZA", "ZM", "ZW",
];

/** Localized country name for a code, falling back to the raw code. */
export function countryName(code: string, lang: string): string {
  try {
    const dn = new Intl.DisplayNames([lang === "tr" ? "tr" : "en"], { type: "region" });
    return dn.of(code) || code;
  } catch {
    return code;
  }
}

/** Country codes sorted by their localized display name. */
export function sortedCountries(lang: string): { code: string; name: string }[] {
  return COUNTRY_CODES
    .map((code) => ({ code, name: countryName(code, lang) }))
    .sort((a, b) => a.name.localeCompare(b.name, lang === "tr" ? "tr" : "en"));
}
