"use client";

import { useEffect, useRef, useState } from "react";
import { getCurrencyList, type CurrencyList, type CurrencyEntry } from "@/lib/api";
import { useLanguage } from "@/lib/i18n";

interface Props {
  value: string;
  onChange: (code: string) => void;
  className?: string;
}

export default function CurrencySelect({ value, onChange, className = "" }: Props) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [list, setList] = useState<CurrencyList | null>(null);
  const [loading, setLoading] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getCurrencyList()
      .then((data) => setList(data))
      .catch(() => {
        // silent — static fallback
        setList({
          fiat: [
            { code: "TRY", name: t("currencySelect.nameTRY") },
            { code: "USD", name: "US Dollar" },
            { code: "EUR", name: "Euro" },
            { code: "GBP", name: "British Pound" },
            { code: "CHF", name: "Swiss Franc" },
            { code: "JPY", name: "Japanese Yen" },
          ],
          crypto: [
            { code: "BTC", name: "Bitcoin" },
            { code: "ETH", name: "Ethereum" },
          ],
          commodities: [
            { code: "XAU", name: t("currencySelect.nameXAU") },
            { code: "XAG", name: t("currencySelect.nameXAG") },
          ],
        });
      })
      .finally(() => setLoading(false));
  }, []);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function filterEntries(entries: CurrencyEntry[]): CurrencyEntry[] {
    if (!query) return entries;
    const q = query.toLowerCase();
    return entries.filter(
      (e) => e.code.toLowerCase().includes(q) || e.name.toLowerCase().includes(q)
    );
  }

  function findCurrentName(): string {
    if (!list) return value;
    const all = [...list.fiat, ...list.crypto, ...list.commodities];
    return all.find((e) => e.code === value)?.name ?? value;
  }

  function handleSelect(code: string) {
    onChange(code);
    setOpen(false);
    setQuery("");
  }

  const fiatFiltered = list ? filterEntries(list.fiat) : [];
  const cryptoFiltered = list ? filterEntries(list.crypto) : [];
  const commodityFiltered = list ? filterEntries(list.commodities) : [];
  const hasResults = fiatFiltered.length > 0 || cryptoFiltered.length > 0 || commodityFiltered.length > 0;

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full bg-canvas border border-line rounded-lg px-3 py-2 text-sm text-ink text-left flex items-center justify-between focus:outline-none focus:border-brand transition-colors"
      >
        {loading ? (
          <span className="text-ink-mute">{t("currencySelect.loading")}</span>
        ) : (
          <span>
            <span className="font-semibold text-brand">{value}</span>
            <span className="text-ink-mute ml-1.5 text-xs">— {findCurrentName()}</span>
          </span>
        )}
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`text-ink-mute transition-transform ${open ? "rotate-180" : ""}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-canvas border border-line rounded-lg shadow-xl overflow-hidden">
          {/* Search */}
          <div className="p-2 border-b border-line">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("currencySelect.searchPlaceholder")}
              className="w-full bg-surface border border-line rounded-md px-2.5 py-1.5 text-xs text-ink placeholder-gray-600 focus:outline-none focus:border-brand"
            />
          </div>

          {/* Options */}
          <div className="max-h-56 overflow-y-auto">
            {!hasResults && (
              <p className="text-ink-mute text-xs text-center py-4">{t("currencySelect.noResults")}</p>
            )}

            {fiatFiltered.length > 0 && (
              <div>
                <p className="px-3 py-1.5 text-[10px] font-semibold text-ink-mute uppercase tracking-wider bg-[#13110D]">
                  {t("currencySelect.fiatGroup")}
                </p>
                {fiatFiltered.map((e) => (
                  <button
                    key={e.code}
                    type="button"
                    onClick={() => handleSelect(e.code)}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-surface transition-colors flex items-center justify-between ${
                      e.code === value ? "bg-brand/40 text-brand" : "text-ink"
                    }`}
                  >
                    <span className="font-semibold text-xs w-12 shrink-0">{e.code}</span>
                    <span className="text-ink-mute text-xs flex-1 text-right truncate">{e.name}</span>
                  </button>
                ))}
              </div>
            )}

            {cryptoFiltered.length > 0 && (
              <div>
                <p className="px-3 py-1.5 text-[10px] font-semibold text-ink-mute uppercase tracking-wider bg-[#13110D]">
                  {t("currencySelect.cryptoGroup")}
                </p>
                {cryptoFiltered.map((e) => (
                  <button
                    key={e.code}
                    type="button"
                    onClick={() => handleSelect(e.code)}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-surface transition-colors flex items-center justify-between ${
                      e.code === value ? "bg-brand/40 text-brand" : "text-ink"
                    }`}
                  >
                    <span className="font-semibold text-xs w-12 shrink-0">{e.code}</span>
                    <span className="text-ink-mute text-xs flex-1 text-right truncate">{e.name}</span>
                  </button>
                ))}
              </div>
            )}

            {commodityFiltered.length > 0 && (
              <div>
                <p className="px-3 py-1.5 text-[10px] font-semibold text-ink-mute uppercase tracking-wider bg-[#13110D]">
                  {t("currencySelect.commodityGroup")}
                </p>
                {commodityFiltered.map((e) => (
                  <button
                    key={e.code}
                    type="button"
                    onClick={() => handleSelect(e.code)}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-surface transition-colors flex items-center justify-between ${
                      e.code === value ? "bg-brand/40 text-brand" : "text-ink"
                    }`}
                  >
                    <span className="font-semibold text-xs w-12 shrink-0">{e.code}</span>
                    <span className="text-ink-mute text-xs flex-1 text-right truncate">{e.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
