"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown } from "@/components/ui/Icons";
import {
  getDefaultCurrency, setDefaultCurrencyLocal, updatePreferences, CURRENCY_CHANGE_EVENT,
} from "@/lib/api";
import { useLanguage } from "@/lib/i18n";

const TOP = ["TRY", "USD", "EUR", "GBP", "CHF", "JPY", "AED"];

/** Persistent app-wide currency switcher in the navbar. Saves to prefs + broadcasts. */
export default function CurrencyMenu() {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("TRY");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCurrent(getDefaultCurrency());
    const handler = (e: Event) => setCurrent((e as CustomEvent<string>).detail);
    window.addEventListener(CURRENCY_CHANGE_EVENT, handler);
    return () => window.removeEventListener(CURRENCY_CHANGE_EVENT, handler);
  }, []);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const choose = (code: string) => {
    setCurrent(code);
    setOpen(false);
    setDefaultCurrencyLocal(code);          // updates localStorage + broadcasts to all pages
    updatePreferences({ display_currency: code }).catch(() => null);  // persists to account
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 px-2 py-1.5 rounded-lg border border-line text-ink-soft hover:text-ink hover:border-[#3C3832] text-xs font-medium transition-colors"
        title={t("settings.currency")}
      >
        {current}
        <ChevronDown size={13} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-36 bg-surface border border-line rounded-xl shadow-2xl z-50 overflow-hidden py-1">
          {TOP.map((c) => (
            <button
              key={c}
              onClick={() => choose(c)}
              className={`w-full text-left px-3 py-1.5 text-sm transition-colors ${
                c === current ? "text-ink bg-surface-2" : "text-ink-mute hover:text-ink-soft hover:bg-surface-2/50"
              }`}
            >
              {c}
            </button>
          ))}
          <Link
            href="/settings"
            onClick={() => setOpen(false)}
            className="block px-3 py-1.5 text-xs text-brand hover:text-brand border-t border-line mt-1"
          >
            {t("settings.currencyMore")}
          </Link>
        </div>
      )}
    </div>
  );
}
