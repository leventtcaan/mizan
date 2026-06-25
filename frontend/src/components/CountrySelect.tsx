"use client";

import { useMemo } from "react";
import { sortedCountries } from "@/lib/countries";
import { useLanguage } from "@/lib/i18n";

/**
 * Native country picker — accessible, type-to-search out of the box, and reliable
 * across browsers. Options are localized via Intl.DisplayNames and sorted by name.
 */
export default function CountrySelect({
  value, onChange, placeholder, id,
}: {
  value: string;
  onChange: (code: string) => void;
  placeholder: string;
  id?: string;
}) {
  const { lang } = useLanguage();
  const countries = useMemo(() => sortedCountries(lang), [lang]);

  return (
    <select
      id={id}
      required
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`w-full px-4 py-3 rounded-xl bg-canvas border border-line text-sm transition-shadow
        focus:outline-none focus:border-[#176B5B] focus:ring-2 focus:ring-[#176B5B]/20
        ${value ? "text-ink" : "text-ink-mute"}`}
    >
      <option value="" disabled>{placeholder}</option>
      {countries.map((c) => (
        <option key={c.code} value={c.code} className="text-ink">{c.name}</option>
      ))}
    </select>
  );
}
