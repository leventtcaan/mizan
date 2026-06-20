"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import {
  getProgress, getComparison, getStoredUser, clearToken,
  type ProgressResponse, type ComparisonResponse,
} from "@/lib/api";
import { CATEGORY_LABELS } from "@/lib/categories";
import GoalsPanel from "@/components/GoalsPanel";
import PersonalityCard from "@/components/PersonalityCard";
import AlertsPanel from "@/components/AlertsPanel";

type LoadState = "loading" | "ready" | "error";

function formatTL(value: string | number): string {
  const n = typeof value === "string" ? parseFloat(value) : value;
  return new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n) + " ₺";
}

function trendIcon(trend: "up" | "down" | "same", isSpend: boolean): { icon: string; color: string } {
  if (trend === "same") return { icon: "→", color: "text-gray-400" };
  // For spending: up is bad (red), down is good (green)
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

export default function ProgressPage() {
  const router = useRouter();
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProgressResponse | null>(null);
  const [comparison, setComparison] = useState<ComparisonResponse | null>(null);
  const [progressState, setProgressState] = useState<LoadState>("loading");
  const [comparisonState, setComparisonState] = useState<LoadState>("loading");

  useEffect(() => {
    const user = getStoredUser();
    if (!user) { router.replace("/login"); return; }
    setUserEmail(user.email);

    getProgress()
      .then((d) => { setProgress(d); setProgressState("ready"); })
      .catch(() => setProgressState("error"));

    getComparison()
      .then((d) => { setComparison(d); setComparisonState("ready"); })
      .catch(() => setComparisonState("error"));
  }, []);

  const handleLogout = () => { clearToken(); router.push("/login"); };

  // Build line chart data: [{month: "Haz 2026", spent: 339, income: 1500}, ...]
  const chartData = progress?.months.map((m) => ({
    month: monthLabel(m.month),
    "Harcama": Math.round(parseFloat(m.total_spent)),
    "Gelir": Math.round(parseFloat(m.total_income)),
  })) ?? [];

  const monthsWithData = chartData.filter((d) => d["Harcama"] > 0 || d["Gelir"] > 0);
  const hasChart = monthsWithData.length > 0;
  const hasEnoughForTrend = monthsWithData.length >= 2;

  function formatShortDate(iso: string | null): string {
    if (!iso) return "—";
    const d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString("tr-TR", { day: "2-digit", month: "short", year: "numeric" });
  }

  return (
    <main className="min-h-screen bg-gray-950 text-white px-4 py-10">
      <div className="max-w-4xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <Link href="/transactions" className="text-gray-500 text-sm hover:text-gray-300 transition-colors">
              ← İşlemler
            </Link>
            <h1 className="text-3xl font-bold mt-4">İlerleme</h1>
            <p className="text-gray-400 text-sm mt-1">Aylık harcama trendi ve karşılaştırma</p>
          </div>
          <div className="flex items-center gap-3">
            {userEmail && (
              <span className="text-gray-500 text-xs hidden sm:block">{userEmail}</span>
            )}
            <button
              onClick={handleLogout}
              className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm text-gray-300 transition-colors"
            >
              Çıkış
            </button>
          </div>
        </div>

        {/* Context header */}
        {progressState === "ready" && progress && (
          <div className="mb-6 p-4 rounded-xl bg-gray-900 border border-gray-800 text-sm flex flex-wrap gap-x-4 gap-y-1 text-gray-400">
            <span>
              <span className="text-gray-500">Ekstre: </span>
              <span className="text-gray-300">{progress.batch_count}</span>
            </span>
            <span>
              <span className="text-gray-500">Toplam işlem: </span>
              <span className="text-gray-300">{progress.total_transactions}</span>
            </span>
            {progress.min_date && progress.max_date && (
              <span>
                <span className="text-gray-500">Tarih aralığı: </span>
                <span className="text-gray-300">
                  {formatShortDate(progress.min_date)} – {formatShortDate(progress.max_date)}
                </span>
              </span>
            )}
            {progress.batch_count > 1 && (
              <span className="text-indigo-400 text-xs self-center">
                · çakışan işlemler tekilleştirildi
              </span>
            )}
            {progress.cached && (
              <span className="text-gray-600 text-xs self-center ml-auto">önbellekten</span>
            )}
          </div>
        )}

        {/* Monthly trend chart */}
        <div className="mb-8 p-5 rounded-xl bg-gray-900 border border-gray-800">
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-4 font-semibold">
            Aylık Trend (Son 3 Ay)
          </p>
          {progressState === "loading" && (
            <p className="text-gray-400 text-sm animate-pulse py-8 text-center">Yükleniyor...</p>
          )}
          {progressState === "error" && (
            <p className="text-red-400 text-sm py-8 text-center">Veri yüklenemedi.</p>
          )}
          {progressState === "ready" && !hasChart && (
            <p className="text-gray-500 text-sm py-8 text-center">
              Karşılaştırma için en az bir ay verisi gerekiyor.
            </p>
          )}
          {progressState === "ready" && hasChart && !hasEnoughForTrend && (
            <p className="text-gray-500 text-sm py-4 text-center">
              Karşılaştırma için en az 2 ay verisi gerekli — şu an sadece 1 ay görünüyor.
            </p>
          )}
          {progressState === "ready" && hasEnoughForTrend && (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={chartData} margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                <XAxis dataKey="month" tick={{ fill: "#9ca3af", fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis
                  tick={{ fill: "#6b7280", fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: "#111827", border: "1px solid #374151", borderRadius: 8 }}
                  labelStyle={{ color: "#e5e7eb", fontSize: 12 }}
                  itemStyle={{ fontSize: 12 }}
                  formatter={(value: number) => [`₺${value.toLocaleString("tr-TR")}`, undefined]}
                />
                <Line type="monotone" dataKey="Harcama" stroke="#ef4444" strokeWidth={2} dot={{ fill: "#ef4444", r: 4 }} />
                <Line type="monotone" dataKey="Gelir" stroke="#10b981" strokeWidth={2} dot={{ fill: "#10b981", r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
          {progressState === "ready" && hasEnoughForTrend && (
            <div className="flex gap-4 mt-3 justify-end">
              <span className="flex items-center gap-1 text-xs text-gray-400">
                <span className="w-3 h-0.5 bg-red-400 inline-block rounded" /> Harcama
              </span>
              <span className="flex items-center gap-1 text-xs text-gray-400">
                <span className="w-3 h-0.5 bg-emerald-400 inline-block rounded" /> Gelir
              </span>
            </div>
          )}
        </div>

        {/* Financial personality */}
        <div className="mb-6">
          <PersonalityCard />
        </div>

        {/* Proactive pattern alerts */}
        <div className="mb-6">
          <AlertsPanel />
        </div>

        {/* Budget goals */}
        <GoalsPanel />

        {/* Category comparison table + LLM insights */}
        <div className="mb-8 p-5 rounded-xl bg-gray-900 border border-gray-800">
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-4 font-semibold">
            Kategori Karşılaştırması
            {comparisonState === "ready" && comparison && (
              <span className="normal-case font-normal text-gray-600 ml-2">
                {monthLabel(comparison.last_month)} → {monthLabel(comparison.this_month)}
              </span>
            )}
          </p>

          {comparisonState === "loading" && (
            <p className="text-gray-400 text-sm animate-pulse py-4 text-center">Analiz yapılıyor...</p>
          )}
          {comparisonState === "error" && (
            <p className="text-red-400 text-sm py-4 text-center">Karşılaştırma yüklenemedi.</p>
          )}
          {comparisonState === "ready" && comparison && comparison.categories.length === 0 && (
            <p className="text-gray-500 text-sm py-4 text-center">
              Karşılaştırma için iki aylık veriye ihtiyaç var.
            </p>
          )}
          {comparisonState === "ready" && comparison && comparison.categories.length > 0 && (
            <div className="space-y-4">
              <div className="overflow-x-auto rounded-lg border border-gray-800">
                <table className="w-full text-sm text-left">
                  <thead className="bg-gray-800 text-gray-400 uppercase text-xs tracking-wide">
                    <tr>
                      <th className="px-4 py-2">Kategori</th>
                      <th className="px-4 py-2 text-right">Geçen Ay</th>
                      <th className="px-4 py-2 text-right">Bu Ay</th>
                      <th className="px-4 py-2 text-right">Değişim</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800">
                    {comparison.categories.map((cat) => {
                      const { icon, color } = trendIcon(cat.trend, true);
                      const pctStr = cat.change_pct === 0
                        ? "—"
                        : `${cat.trend === "up" ? "+" : ""}${cat.change_pct.toFixed(1)}%`;
                      return (
                        <tr key={cat.category} className="bg-gray-950 hover:bg-gray-900 transition-colors">
                          <td className="px-4 py-2.5 text-gray-200 font-medium">
                            {CATEGORY_LABELS[cat.category] ?? cat.category}
                          </td>
                          <td className="px-4 py-2.5 text-right text-gray-400 font-mono text-xs">
                            {formatTL(cat.last_month)}
                          </td>
                          <td className="px-4 py-2.5 text-right text-gray-200 font-mono text-xs">
                            {formatTL(cat.this_month)}
                          </td>
                          <td className={`px-4 py-2.5 text-right font-mono text-xs font-semibold ${color}`}>
                            {icon} {pctStr}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* LLM insight cards */}
              <div className="grid gap-2 mt-2">
                {comparison.categories.map((cat) => (
                  <div
                    key={cat.category}
                    className="flex items-start gap-3 px-3 py-2.5 rounded-lg bg-gray-800 border border-gray-700"
                  >
                    <span className="text-gray-500 text-xs font-semibold min-w-[5rem] pt-0.5">
                      {CATEGORY_LABELS[cat.category] ?? cat.category}
                    </span>
                    <p className="text-gray-300 text-sm leading-relaxed">{cat.insight}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

      </div>
    </main>
  );
}
