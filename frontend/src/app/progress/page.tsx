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
import { CATEGORY_LABELS } from "@/lib/categories";
import GoalsPanel from "@/components/GoalsPanel";
import PersonalityCard from "@/components/PersonalityCard";
import AlertsPanel from "@/components/AlertsPanel";
import InflationPanel from "@/components/InflationPanel";
import PageLayout from "@/components/ui/PageLayout";

type LoadState = "loading" | "ready" | "error";

function formatTL(value: string | number): string {
  const n = typeof value === "string" ? parseFloat(value) : value;
  return new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n) + " ₺";
}

function trendIcon(trend: "up" | "down" | "same", isSpend: boolean): { icon: string; color: string } {
  if (trend === "same") return { icon: "→", color: "text-gray-400" };
  if (isSpend) {
    return trend === "up"
      ? { icon: "↑", color: "text-red-400" }
      : { icon: "↓", color: "text-emerald-400" };
  }
  return trend === "up"
    ? { icon: "↑", color: "text-emerald-400" }
    : { icon: "↓", color: "text-red-400" };
}

function monthLabel(key: string): string {
  const [year, month] = key.split("-");
  const d = new Date(parseInt(year), parseInt(month) - 1, 1);
  return d.toLocaleDateString("tr-TR", { month: "short", year: "numeric" });
}

function formatShortDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso + "T00:00:00").toLocaleDateString("tr-TR", { day: "2-digit", month: "short", year: "numeric" });
}

export default function ProgressPage() {
  const router = useRouter();
  const [progress, setProgress] = useState<ProgressResponse | null>(null);
  const [comparison, setComparison] = useState<ComparisonResponse | null>(null);
  const [progressState, setProgressState] = useState<LoadState>("loading");
  const [comparisonState, setComparisonState] = useState<LoadState>("loading");

  useEffect(() => {
    const user = getStoredUser();
    if (!user) { router.replace("/login"); return; }

    getProgress()
      .then((d) => { setProgress(d); setProgressState("ready"); })
      .catch(() => setProgressState("error"));

    getComparison()
      .then((d) => { setComparison(d); setComparisonState("ready"); })
      .catch(() => setComparisonState("error"));
  }, []);

  const chartData = progress?.months.map((m) => ({
    month: monthLabel(m.month),
    "Harcama": Math.round(parseFloat(m.total_spent)),
    "Gelir": Math.round(parseFloat(m.total_income)),
  })) ?? [];

  const monthsWithData = chartData.filter((d) => d["Harcama"] > 0 || d["Gelir"] > 0);
  const hasChart = monthsWithData.length > 0;
  const hasEnoughForTrend = monthsWithData.length >= 2;

  return (
    <PageLayout title="İlerleme" subtitle="Aylık harcama trendi ve karşılaştırma">

      {/* Context row */}
      {progressState === "ready" && progress && (
        <div className="mb-6 bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-4 flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
          <span className="text-gray-400">
            <span className="text-gray-600">Ekstre: </span>
            <span className="text-gray-200">{progress.batch_count}</span>
          </span>
          <span className="text-gray-400">
            <span className="text-gray-600">Toplam işlem: </span>
            <span className="text-gray-200">{progress.total_transactions}</span>
          </span>
          {progress.min_date && progress.max_date && (
            <span className="text-gray-400">
              <span className="text-gray-600">Tarih aralığı: </span>
              <span className="text-gray-200">{formatShortDate(progress.min_date)} – {formatShortDate(progress.max_date)}</span>
            </span>
          )}
          {progress.batch_count > 1 && (
            <span className="text-indigo-400 text-xs self-center">çakışan işlemler tekilleştirildi</span>
          )}
          {progress.cached && (
            <span className="text-gray-600 text-xs self-center ml-auto">önbellekten</span>
          )}
        </div>
      )}

      {/* Line chart */}
      <div className="mb-6 bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-6">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-5">
          Aylık Trend (Son 3 Ay)
        </p>
        {progressState === "loading" && (
          <div className="h-52 flex items-center justify-center">
            <p className="text-gray-600 text-sm animate-pulse">Yükleniyor...</p>
          </div>
        )}
        {progressState === "error" && (
          <div className="h-52 flex items-center justify-center">
            <p className="text-red-400 text-sm">Veri yüklenemedi.</p>
          </div>
        )}
        {progressState === "ready" && !hasChart && (
          <div className="h-52 flex items-center justify-center">
            <p className="text-gray-600 text-sm">Karşılaştırma için en az bir ay verisi gerekiyor.</p>
          </div>
        )}
        {progressState === "ready" && hasChart && !hasEnoughForTrend && (
          <div className="h-52 flex items-center justify-center">
            <p className="text-gray-600 text-sm text-center">
              Karşılaştırma için en az 2 ay verisi gerekli — şu an sadece 1 ay görünüyor.
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
                  formatter={(value: number) => [`₺${value.toLocaleString("tr-TR")}`, undefined]}
                />
                <Line type="monotone" dataKey="Harcama" stroke="#ef4444" strokeWidth={2} dot={{ fill: "#ef4444", r: 3, strokeWidth: 0 }} />
                <Line type="monotone" dataKey="Gelir" stroke="#10b981" strokeWidth={2} dot={{ fill: "#10b981", r: 3, strokeWidth: 0 }} />
              </LineChart>
            </ResponsiveContainer>
            <div className="flex gap-4 mt-3 justify-end">
              <span className="flex items-center gap-1.5 text-xs text-gray-500">
                <span className="w-3 h-0.5 bg-red-400 inline-block rounded" /> Harcama
              </span>
              <span className="flex items-center gap-1.5 text-xs text-gray-500">
                <span className="w-3 h-0.5 bg-emerald-400 inline-block rounded" /> Gelir
              </span>
            </div>
          </>
        )}
      </div>

      {/* Personality */}
      <div className="mb-6">
        <PersonalityCard />
      </div>

      {/* Alerts */}
      <div className="mb-6">
        <AlertsPanel />
      </div>

      {/* Inflation */}
      <InflationPanel />

      {/* Goals */}
      <GoalsPanel />

      {/* Category comparison */}
      <div className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-6">
        <div className="flex items-center justify-between mb-5">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
            Kategori Karşılaştırması
          </p>
          {comparisonState === "ready" && comparison && (
            <span className="text-gray-600 text-xs">
              {monthLabel(comparison.last_month)} → {monthLabel(comparison.this_month)}
            </span>
          )}
        </div>

        {comparisonState === "loading" && (
          <div className="py-8 text-center">
            <p className="text-gray-600 text-sm animate-pulse">Analiz yapılıyor...</p>
          </div>
        )}
        {comparisonState === "error" && (
          <p className="text-red-400 text-sm py-4 text-center">Karşılaştırma yüklenemedi.</p>
        )}
        {comparisonState === "ready" && comparison && comparison.categories.length === 0 && (
          <p className="text-gray-600 text-sm py-4 text-center">Karşılaştırma için iki aylık veriye ihtiyaç var.</p>
        )}
        {comparisonState === "ready" && comparison && comparison.categories.length > 0 && (
          <div className="space-y-4">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#2A2A2A]">
                    <th className="text-left text-xs font-medium text-gray-500 pb-3 pr-4">Kategori</th>
                    <th className="text-right text-xs font-medium text-gray-500 pb-3 px-4">Geçen Ay</th>
                    <th className="text-right text-xs font-medium text-gray-500 pb-3 px-4">Bu Ay</th>
                    <th className="text-right text-xs font-medium text-gray-500 pb-3 pl-4">Değişim</th>
                  </tr>
                </thead>
                <tbody>
                  {comparison.categories.map((cat, i) => {
                    const { icon, color } = trendIcon(cat.trend, true);
                    const pctStr = cat.change_pct === 0
                      ? "—"
                      : `${cat.trend === "up" ? "+" : ""}${cat.change_pct.toFixed(1)}%`;
                    return (
                      <tr
                        key={cat.category}
                        className={`border-b border-[#2A2A2A] last:border-0 ${i % 2 === 0 ? "" : "bg-[#0F0F0F]/50"}`}
                      >
                        <td className="py-3 pr-4 text-gray-200 font-medium">
                          {CATEGORY_LABELS[cat.category] ?? cat.category}
                        </td>
                        <td className="py-3 px-4 text-right text-gray-500 font-mono text-xs">
                          {formatTL(cat.last_month)}
                        </td>
                        <td className="py-3 px-4 text-right text-gray-200 font-mono text-xs">
                          {formatTL(cat.this_month)}
                        </td>
                        <td className={`py-3 pl-4 text-right font-mono text-xs font-semibold ${color}`}>
                          {icon} {pctStr}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* LLM insight cards */}
            <div className="space-y-2 pt-2">
              {comparison.categories.map((cat) => (
                <div
                  key={cat.category}
                  className="flex items-start gap-3 px-4 py-3 rounded-lg bg-[#0F0F0F] border border-[#2A2A2A]"
                >
                  <span className="text-gray-600 text-xs font-medium min-w-[5rem] pt-0.5">
                    {CATEGORY_LABELS[cat.category] ?? cat.category}
                  </span>
                  <p className="text-gray-300 text-sm leading-relaxed">{cat.insight}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </PageLayout>
  );
}
