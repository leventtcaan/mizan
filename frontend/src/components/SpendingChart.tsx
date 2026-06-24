"use client";

import { useEffect, useState } from "react";
import { getCurrencyRates, getDefaultCurrency, CURRENCY_CHANGE_EVENT, type Transaction } from "@/lib/api";
import { CATEGORY_COLORS, DEFAULT_CATEGORY_COLOR } from "@/lib/categories";
import { useLanguage } from "@/lib/i18n";

interface Props {
  transactions: Transaction[];
  /** Explicit window this breakdown covers (e.g. the statement date range) — keeps it from reading as the calendar-month spine above. */
  periodLabel?: string;
}

export default function SpendingChart({ transactions, periodLabel }: Props) {
  const { t } = useLanguage();
  const [currency, setCurrency] = useState("TRY");
  // rates[code] = units of code per 1 display currency → convert amt in code: amt / rates[code]
  const [rates, setRates] = useState<Record<string, number> | null>(null);

  useEffect(() => {
    const apply = (code: string) => {
      setCurrency(code);
      getCurrencyRates(code).then(setRates).catch(() => setRates(null));
    };
    apply(getDefaultCurrency());
    const h = (e: Event) => apply((e as CustomEvent<string>).detail);
    window.addEventListener(CURRENCY_CHANGE_EVENT, h);
    return () => window.removeEventListener(CURRENCY_CHANGE_EVENT, h);
  }, []);

  const toDisplay = (amt: number, cur: string): number => {
    const c = (cur || "TRY").toUpperCase();
    if (c === currency.toUpperCase()) return amt;
    const r = rates?.[c];
    return r && r > 0 ? amt / r : amt; // fall back to raw if rate unknown
  };

  const totals: Record<string, number> = {};
  let totalSpend = 0;
  for (const tx of transactions) {
    if (tx.transaction_type !== "debit") continue;
    const cat = tx.category ?? "diger";
    const amt = toDisplay(parseFloat(tx.amount) || 0, tx.currency || "TRY");
    totals[cat] = (totals[cat] ?? 0) + amt;
    totalSpend += amt;
  }

  const rows = Object.entries(totals)
    .sort((a, b) => b[1] - a[1])
    .map(([slug, amount]) => {
      const key = `category.${slug}`;
      const label = t(key) !== key ? t(key) : slug;
      return { slug, label, amount, color: CATEGORY_COLORS[slug] ?? DEFAULT_CATEGORY_COLOR };
    });

  if (rows.length === 0 || totalSpend === 0) return null;

  const mixed = false;
  const fmt = (v: number) => {
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }).format(v);
    } catch {
      return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(v)} ${currency}`;
    }
  };

  const max = rows[0].amount;

  return (
    <div className="mb-8 p-5 rounded-xl bg-[#1C1915] border border-[#2C2922]">
      <div className="flex items-baseline justify-between mb-4">
        <div className="min-w-0">
          <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold">{t("tx.spending")}</p>
          {periodLabel && <p className="text-[11px] text-gray-600 mt-0.5">{periodLabel}</p>}
        </div>
        <p className="text-sm text-white font-semibold tabular-nums">
          {fmt(totalSpend)}
          {mixed && <span className="ml-1 text-[10px] text-amber-500 font-normal">≈</span>}
        </p>
      </div>

      <div className="space-y-2.5">
        {rows.map((r) => {
          const share = (r.amount / totalSpend) * 100;
          return (
            <div key={r.slug} className="flex items-center gap-3">
              <div className="flex items-center gap-2 w-28 shrink-0 min-w-0">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: r.color }} />
                <span className="text-xs text-gray-300 truncate">{r.label}</span>
              </div>
              <div className="flex-1 h-2 rounded-full bg-[#11100E] overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${Math.max(3, (r.amount / max) * 100)}%`, backgroundColor: r.color }}
                />
              </div>
              <div className="w-28 shrink-0 text-right">
                <span className="text-xs text-gray-200 tabular-nums">{fmt(r.amount)}</span>
                <span className="text-[10px] text-gray-600 ml-1.5 tabular-nums">{share.toFixed(0)}%</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
