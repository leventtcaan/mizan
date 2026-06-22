"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import {
  getProgress, getComparison, getStoredUser,
  type ProgressResponse, type ComparisonResponse,
} from "@/lib/api";
import GoalsPanel from "@/components/GoalsPanel";
import PersonalityCard from "@/components/PersonalityCard";
import AlertsPanel from "@/components/AlertsPanel";
import InflationPanel from "@/components/InflationPanel";
import PageLayout from "@/components/ui/PageLayout";
import { useLanguage } from "@/lib/i18n";

type LoadState = "loading" | "ready" | "error";

function formatAmount(value: string | number): string {
  const n = typeof value === "string" ? parseFloat(value) : value;
  return new Intl.NumberFormat(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
}

function trendIcon(trend: "up" | "down" | "same", isSpend: boolean): { icon: string; color: string } {
  if (trend === "same") return { icon: "→", color: "text-gray-400" };
  if (isSpend) {
    return trend === "up" ? { icon: "↑", color: "text-red-400" } : { icon: "↓", color: "text-emerald-400" };
  }
  return trend === "up" ? { icon: "↑", color: "text-emerald-400" } : { icon: "↓", color: "text-red-400" };
}

function monthLabel(key: string): string {
  const [year, month] = key.split("-");
  const d = new Date(parseInt(year), parseInt(month) - 1, 1);
  return d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

function formatShortDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso + "T00:00:00").toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

export default function ProgressPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const [progress, setProgress] = useState<ProgressResponse | null>(null);
  const [comparison, setComparison] = useState<ComparisonResponse | null>(null);
  const [progressState, setProgressState] = useState<LoadState>("loading");
  const [comparisonState, setComparisonState] = useState<LoadState>("loading");

  useEffect(() => {
    const user = getStoredUser();
    if (!user) { router.replace("/login"); return; }

    const load = () => {
      getProgress()
        .then((d) => { setProgress(d); setProgressState("ready"); })
        .catch(() => setProgressState("error"));
      getComparison()
        .then((d) => { setComparison(d); setComparisonState("ready"); })
        .catch(() => setComparisonState("error"));
    };
    load();
    // Re-load after the global assistant confirms an action (e.g. re-categorize).
    window.addEventListener("mizan-data-changed", load);
    return () => window.removeEventListener("mizan-data-changed", load);
  }, [router]);

  const spendingLabel = t("progress.spending");
  const incomeLabel = t("progress.income");

  const chartData: Record<string, string | number>[] = progress?.months.map((m) => ({
    month: monthLabel(m.month),
    [spendingLabel]: Math.round(parseFloat(m.total_spent)),
    [incomeLabel]: Math.round(parseFloat(m.total_income)),
  })) ?? [];

  const monthsWithData = chartData.filter((d) => (d[spendingLabel] as number) > 0 || (d[incomeLabel] as number) > 0);
  const hasChart = monthsWithData.length > 0;
  const hasEnoughForTrend = monthsWithData.length >= 2;

  return (
    <PageLayout title={t("progress.title")} subtitle={t("progress.subtitle")}>

      {progressState === "ready" && progress && (
        <div className="mb-6 bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-4 flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
          <span className="text-gray-400">
            <span className="text-gray-600">{t("tx.allBatches")}: </span>
            <span className="text-gray-200">{progress.batch_count}</span>
          </span>
          <span className="text-gray-400">
            <span className="text-gray-600">{t("common.amount")}: </span>
            <span className="text-gray-200">{progress.total_transactions}</span>
          </span>
          {progress.min_date && progress.max_date && (
            <span className="text-gray-400">
              <span className="text-gray-600">{t("common.date")}: </span>
              <span className="text-gray-200">{formatShortDate(progress.min_date)} – {formatShortDate(progress.max_date)}</span>
            </span>
          )}
          {progress.batch_count > 1 && (
            <span className="text-indigo-400 text-xs self-center">{t("progress.deduped")}</span>
          )}
          {progress.cached && (
            <span className="text-gray-600 text-xs self-center ml-auto">{t("progress.cached")}</span>
          )}
        </div>
      )}

      <div className="mb-6 bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-6">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-5">
          {t("progress.subtitle")}
        </p>
        {progressState === "loading" && (
          <div className="h-52 flex items-center justify-center">
            <p className="text-gray-600 text-sm animate-pulse">{t("common.loading")}</p>
          </div>
        )}
        {progressState === "error" && (
          <div className="h-52 flex items-center justify-center">
            <p className="text-red-400 text-sm">{t("common.error")}</p>
          </div>
        )}
        {progressState === "ready" && !hasChart && (
          <div className="h-52 flex items-center justify-center">
            <p className="text-gray-600 text-sm">{t("progress.noData")}</p>
          </div>
        )}
        {progressState === "ready" && hasChart && !hasEnoughForTrend && (
          <div className="h-52 flex items-center justify-center">
            <p className="text-gray-600 text-sm text-center">
              {t("progress.needMoreMonths")} — {t("progress.oneMonthNote")}
            </p>
          </div>
        )}
        {progressState === "ready" && hasEnoughForTrend && (
          <>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={chartData} margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2A2A2A" />
                <XAxis dataKey="month" tick={{ fill: "#6b7280", fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis
                  tick={{ fill: "#4b5563", fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: "#1A1A1A", border: "1px solid #2A2A2A", borderRadius: 8 }}
                  labelStyle={{ color: "#e5e7eb", fontSize: 12 }}
                  itemStyle={{ fontSize: 12 }}
                  formatter={(value: number) => [value.toLocaleString(), undefined]}
                />
                <Line type="monotone" dataKey={spendingLabel} stroke="#ef4444" strokeWidth={2} dot={{ fill: "#ef4444", r: 3, strokeWidth: 0 }} />
                <Line type="monotone" dataKey={incomeLabel} stroke="#10b981" strokeWidth={2} dot={{ fill: "#10b981", r: 3, strokeWidth: 0 }} />
              </LineChart>
            </ResponsiveContainer>
            <div className="flex gap-4 mt-3 justify-end">
              <span className="flex items-center gap-1.5 text-xs text-gray-500">
                <span className="w-3 h-0.5 bg-red-400 inline-block rounded" /> {spendingLabel}
              </span>
              <span className="flex items-center gap-1.5 text-xs text-gray-500">
                <span className="w-3 h-0.5 bg-emerald-400 inline-block rounded" /> {incomeLabel}
              </span>
            </div>
          </>
        )}
      </div>

      <div className="mb-6">
        <PersonalityCard />
      </div>

      <div className="mb-6">
        <AlertsPanel />
      </div>

      <InflationPanel />

      <GoalsPanel />

      <div className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-6">
        <div className="flex items-center justify-between mb-5">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
            {t("progress.comparison")}
          </p>
          {comparisonState === "ready" && comparison && (
            <span className="text-gray-600 text-xs">
              {monthLabel(comparison.last_month)} → {monthLabel(comparison.this_month)}
            </span>
          )}
        </div>

        {comparisonState === "loading" && (
          <div className="py-8 text-center">
            <p className="text-gray-600 text-sm animate-pulse">{t("common.loading")}</p>
          </div>
        )}
        {comparisonState === "error" && (
          <p className="text-red-400 text-sm py-4 text-center">{t("common.error")}</p>
        )}
        {comparisonState === "ready" && comparison && comparison.categories.length === 0 && (
          <p className="text-gray-600 text-sm py-4 text-center">{t("progress.needMoreMonths")}</p>
        )}
        {comparisonState === "ready" && comparison && comparison.categories.length > 0 && (
          <div className="space-y-4">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#2A2A2A]">
                    <th className="text-left text-xs font-medium text-gray-500 pb-3 pr-4">{t("goals.category")}</th>
                    <th className="text-right text-xs font-medium text-gray-500 pb-3 px-4">{t("progress.lastMonth")}</th>
                    <th className="text-right text-xs font-medium text-gray-500 pb-3 px-4">{t("progress.thisMonth")}</th>
                    <th className="text-right text-xs font-medium text-gray-500 pb-3 pl-4">{t("progress.change")}</th>
                  </tr>
                </thead>
                <tbody>
                  {comparison.categories.map((cat, i) => {
                    const { icon, color } = trendIcon(cat.trend, true);
                    const pctStr = cat.change_pct === 0 ? "—" : `${cat.trend === "up" ? "+" : ""}${cat.change_pct.toFixed(1)}%`;
                    const catKey = `category.${cat.category}`;
                    const catLabel = t(catKey) !== catKey ? t(catKey) : cat.category;
                    return (
                      <tr key={cat.category} className={`border-b border-[#2A2A2A] last:border-0 ${i % 2 === 0 ? "" : "bg-[#0F0F0F]/50"}`}>
                        <td className="py-3 pr-4 text-gray-200 font-medium">{catLabel}</td>
                        <td className="py-3 px-4 text-right text-gray-500 font-mono text-xs">{formatAmount(cat.last_month)}</td>
                        <td className="py-3 px-4 text-right text-gray-200 font-mono text-xs">{formatAmount(cat.this_month)}</td>
                        <td className={`py-3 pl-4 text-right font-mono text-xs font-semibold ${color}`}>{icon} {pctStr}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="space-y-2 pt-2">
              {comparison.categories.map((cat) => {
                const catKey = `category.${cat.category}`;
                const catLabel = t(catKey) !== catKey ? t(catKey) : cat.category;
                return (
                  <div key={cat.category} className="flex items-start gap-3 px-4 py-3 rounded-lg bg-[#0F0F0F] border border-[#2A2A2A]">
                    <span className="text-gray-600 text-xs font-medium min-w-[5rem] pt-0.5">{catLabel}</span>
                    <p className="text-gray-300 text-sm leading-relaxed">{cat.insight}</p>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </PageLayout>
  );
}
