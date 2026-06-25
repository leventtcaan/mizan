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
  const [hovered, setHovered] = useState<string | null>(null);
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
    <div className="mb-8 p-5 rounded-2xl bg-surface border border-line shadow-sm">
      <div className="flex items-baseline justify-between mb-4">
        <div className="min-w-0">
          <p className="text-xs text-ink-mute uppercase tracking-widest font-semibold">{t("tx.spending")}</p>
          {periodLabel && <p className="text-[11px] text-ink-mute mt-0.5">{periodLabel}</p>}
        </div>
        <p className="text-lg text-ink font-bold tabular-nums">
          {fmt(totalSpend)}
          {mixed && <span className="ml-1 text-[10px] text-amber-500 font-normal">≈</span>}
        </p>
      </div>

      {/* Stacked proportion bar — the whole month at a glance; hover a slice/row to focus it */}
      <div className="flex h-3 rounded-full overflow-hidden mb-5 gap-px bg-canvas" onMouseLeave={() => setHovered(null)}>
        {rows.map((r) => {
          const share = (r.amount / totalSpend) * 100;
          const dim = hovered !== null && hovered !== r.slug;
          return (
            <div
              key={r.slug}
              onMouseEnter={() => setHovered(r.slug)}
              title={`${r.label} · ${share.toFixed(0)}%`}
              className="h-full transition-all duration-200 cursor-default first:rounded-l-full last:rounded-r-full"
              style={{ width: `${share}%`, backgroundColor: r.color, opacity: dim ? 0.3 : 1 }}
            />
          );
        })}
      </div>

      <div className="space-y-0.5" onMouseLeave={() => setHovered(null)}>
        {rows.map((r) => {
          const share = (r.amount / totalSpend) * 100;
          const active = hovered === r.slug;
          const dim = hovered !== null && !active;
          return (
            <div
              key={r.slug}
              onMouseEnter={() => setHovered(r.slug)}
              className={`flex items-center gap-3 -mx-2 px-2 py-1.5 rounded-lg transition-colors ${active ? "bg-[#176B5B]/[0.06]" : ""}`}
              style={{ opacity: dim ? 0.55 : 1 }}
            >
              <div className="flex items-center gap-2 w-28 shrink-0 min-w-0">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: r.color }} />
                <span className={`text-xs truncate transition-colors ${active ? "text-ink font-medium" : "text-ink-soft"}`}>{r.label}</span>
              </div>
              <div className="flex-1 h-2.5 rounded-full bg-canvas overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{ width: `${Math.max(3, (r.amount / max) * 100)}%`, backgroundColor: r.color }}
                />
              </div>
              <div className="w-28 shrink-0 text-right">
                <span className={`text-xs tabular-nums ${active ? "text-ink font-semibold" : "text-ink-soft"}`}>{fmt(r.amount)}</span>
                <span className="text-[10px] text-ink-mute ml-1.5 tabular-nums">{share.toFixed(0)}%</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
