"use client";

/**
 * WHAT: Bar chart of debit spending grouped by category.
 * WHY: Gives users a visual summary alongside the coaching text — pattern recognition
 *      is faster from a chart than from reading a table of numbers.
 * BREAKS IF REMOVED: Transactions page loses the spending summary visualization.
 */

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import type { Transaction } from "@/lib/api";

const CATEGORY_COLORS: Record<string, string> = {
  market: "#6366f1",
  restoran: "#f59e0b",
  ulasim: "#10b981",
  eglence: "#ec4899",
  saglik: "#14b8a6",
  giyim: "#8b5cf6",
  faturalar: "#f97316",
  teknoloji: "#3b82f6",
  iade:      "#14b8a6",
  vergi:     "#ef4444",
  diger:     "#6b7280",
};

const DEFAULT_COLOR = "#6b7280";

interface ChartDatum {
  category: string;
  amount: number;
  color: string;
}

interface Props {
  transactions: Transaction[];
}

export default function SpendingChart({ transactions }: Props) {
  const totals: Record<string, number> = {};

  for (const t of transactions) {
    if (t.transaction_type !== "debit") continue;
    const cat = t.category ?? "diger";
    totals[cat] = (totals[cat] ?? 0) + parseFloat(t.amount);
  }

  const data: ChartDatum[] = Object.entries(totals)
    .sort((a, b) => b[1] - a[1])
    .map(([cat, amount]) => ({
      category: cat,
      amount: Math.round(amount),
      color: CATEGORY_COLORS[cat] ?? DEFAULT_COLOR,
    }));

  if (data.length === 0) return null;

  return (
    <div className="mb-8 p-5 rounded-xl bg-gray-900 border border-gray-800">
      <p className="text-xs text-gray-500 uppercase tracking-wide mb-4 font-semibold">
        Kategoriye Göre Harcama (₺)
      </p>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 0, right: 8, left: 8, bottom: 0 }}>
          <XAxis
            dataKey="category"
            tick={{ fill: "#9ca3af", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: "#6b7280", fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: number) =>
              v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)
            }
          />
          <Tooltip
            contentStyle={{ backgroundColor: "#111827", border: "1px solid #374151", borderRadius: 8 }}
            labelStyle={{ color: "#e5e7eb", fontSize: 12 }}
            itemStyle={{ color: "#d1d5db", fontSize: 12 }}
            formatter={(value: number) => [`₺${value.toLocaleString("tr-TR")}`, "Harcama"]}
          />
          <Bar dataKey="amount" radius={[4, 4, 0, 0]}>
            {data.map((entry) => (
              <Cell key={entry.category} fill={entry.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
