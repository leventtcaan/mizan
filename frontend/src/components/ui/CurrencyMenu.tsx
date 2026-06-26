"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "@/components/ui/Icons";
import {
  getDefaultCurrency, setDefaultCurrencyLocal, updatePreferences, CURRENCY_CHANGE_EVENT,
  getCurrencyList, type CurrencyList, type CurrencyEntry,
} from "@/lib/api";
import { useLanguage } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";

const TOP = ["TRY", "USD", "EUR", "GBP", "CHF", "JPY", "AED"];

/** Persistent app-wide currency switcher in the navbar. Picking ANY currency (the top-7
 *  quick list or the full searchable list) applies immediately — saves to prefs + broadcasts
 *  to every open page — without leaving for the settings screen. */
export default function CurrencyMenu() {
  const { t } = useLanguage();
  const { resolved } = useTheme();
  const surfaceBg = resolved === "dark" ? "#1C1915" : "#FFFFFF";
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("TRY");
  const [showAll, setShowAll] = useState(false);
  const [query, setQuery] = useState("");
  const [list, setList] = useState<CurrencyList | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCurrent(getDefaultCurrency());
    const handler = (e: Event) => setCurrent((e as CustomEvent<string>).detail);
    window.addEventListener(CURRENCY_CHANGE_EVENT, handler);
    return () => window.removeEventListener(CURRENCY_CHANGE_EVENT, handler);
  }, []);

  // Load the full currency list lazily, the first time the user opens "all currencies".
  useEffect(() => {
    if (showAll && !list) getCurrencyList().then(setList).catch(() => null);
  }, [showAll, list]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  // Reset the sub-view whenever the menu closes.
  useEffect(() => {
    if (!open) { setShowAll(false); setQuery(""); }
  }, [open]);

  const choose = (code: string) => {
    setCurrent(code);
    setOpen(false);
    setDefaultCurrencyLocal(code);          // updates localStorage + broadcasts to all pages
    updatePreferences({ display_currency: code }).catch(() => null);  // persists to account
  };

  const allEntries: CurrencyEntry[] = list ? [...list.fiat, ...list.crypto, ...list.commodities] : [];
  const filtered = query
    ? allEntries.filter(
        (e) =>
          e.code.toLowerCase().includes(query.toLowerCase()) ||
          e.name.toLowerCase().includes(query.toLowerCase()),
      )
    : allEntries;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 px-2 py-1.5 rounded-lg border border-line text-ink-soft hover:text-ink hover:border-[#176B5B] text-xs font-medium transition-colors"
        title={t("settings.currency")}
      >
        {current}
        <ChevronDown size={13} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-2 w-52 border border-line rounded-xl shadow-xl shadow-black/20 ring-1 ring-black/5 z-50 overflow-hidden"
          style={{ backgroundColor: surfaceBg }}
        >
          {!showAll ? (
            <div className="py-1">
              {TOP.map((c) => (
                <button
                  key={c}
                  onClick={() => choose(c)}
                  className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                    c === current ? "text-[#176B5B] bg-[#176B5B]/10 font-semibold" : "text-ink-soft hover:bg-surface-2"
                  }`}
                >
                  {c}
                </button>
              ))}
              <button
                onClick={() => setShowAll(true)}
                className="block w-full text-left px-3 py-2 text-xs text-[#176B5B] hover:bg-surface-2 border-t border-line mt-1 transition-colors"
              >
                {t("settings.currencyMore")}
              </button>
            </div>
          ) : (
            <div>
              <div className="p-2 border-b border-line">
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("currencySelect.searchPlaceholder")}
                  className="w-full bg-canvas border border-line rounded-md px-2.5 py-1.5 text-xs text-ink placeholder:text-ink-mute focus:outline-none focus:border-[#176B5B]"
                />
              </div>
              <div className="max-h-60 overflow-y-auto py-1">
                {!list && (
                  <p className="text-ink-mute text-xs text-center py-3">{t("currencySelect.loading")}</p>
                )}
                {list && filtered.length === 0 && (
                  <p className="text-ink-mute text-xs text-center py-3">{t("currencySelect.noResults")}</p>
                )}
                {filtered.map((e) => (
                  <button
                    key={e.code}
                    onClick={() => choose(e.code)}
                    className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between transition-colors ${
                      e.code === current ? "text-[#176B5B] bg-[#176B5B]/10 font-semibold" : "text-ink-soft hover:bg-surface-2"
                    }`}
                  >
                    <span className="font-semibold text-xs w-12 shrink-0">{e.code}</span>
                    <span className="text-ink-mute text-xs flex-1 text-right truncate">{e.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
