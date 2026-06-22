"use client";

import type { Transaction } from "@/lib/api";
import { CATEGORY_COLORS, DEFAULT_CATEGORY_COLOR } from "@/lib/categories";
import { useLanguage } from "@/lib/i18n";

interface Props {
  transactions: Transaction[];
}

export default function SpendingChart({ transactions }: Props) {
  const { t } = useLanguage();

  const totals: Record<string, number> = {};
  const currencyCount: Record<string, number> = {};
  let totalSpend = 0;
  for (const tx of transactions) {
    if (tx.transaction_type !== "debit") continue;
    const cat = tx.category ?? "diger";
    const amt = parseFloat(tx.amount) || 0;
    totals[cat] = (totals[cat] ?? 0) + amt;
    totalSpend += amt;
    currencyCount[tx.currency || "TRY"] = (currencyCount[tx.currency || "TRY"] ?? 0) + 1;
  }

  const rows = Object.entries(totals)
    .sort((a, b) => b[1] - a[1])
    .map(([slug, amount]) => {
      const key = `category.${slug}`;
      const label = t(key) !== key ? t(key) : slug;
      return { slug, label, amount, color: CATEGORY_COLORS[slug] ?? DEFAULT_CATEGORY_COLOR };
    });

  if (rows.length === 0 || totalSpend === 0) return null;

  // Dominant currency for the symbol (most data is single-currency).
  const currency = Object.entries(currencyCount).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "TRY";
  const mixed = Object.keys(currencyCount).length > 1;
  const fmt = (v: number) => {
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }).format(v);
    } catch {
      return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(v)} ${currency}`;
    }
  };

  const max = rows[0].amount;

  return (
    <div className="mb-8 p-5 rounded-xl bg-[#1A1A1A] border border-[#2A2A2A]">
      <div className="flex items-baseline justify-between mb-4">
        <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold">{t("tx.spending")}</p>
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
              <div className="flex-1 h-2 rounded-full bg-[#0F0F0F] overflow-hidden">
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
