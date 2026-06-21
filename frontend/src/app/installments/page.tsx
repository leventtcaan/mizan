"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  getInstallments, getInstallmentSummary, getStoredUser,
  type InstallmentPlan, type InstallmentSummary,
} from "@/lib/api";
import { CATEGORY_LABELS } from "@/lib/categories";

function fmtN(n: number, decimals = 0): string {
  return new Intl.NumberFormat("tr-TR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
}

function ProgressBar({ current, total }: { current: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
  return (
    <div>
      <div className="flex justify-between text-xs text-gray-500 mb-1">
        <span>{current}/{total} ödendi</span>
        <span>{pct}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-gray-800 overflow-hidden">
        <div
          className="h-full rounded-full bg-indigo-500 transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default function InstallmentsPage() {
  const router = useRouter();
  const [data, setData] = useState<{ plans: InstallmentPlan[]; insight: string | null } | null>(null);
  const [summary, setSummary] = useState<InstallmentSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [showEarlyPayoff, setShowEarlyPayoff] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!getStoredUser()) { router.replace("/login"); return; }

    Promise.all([getInstallments(), getInstallmentSummary()])
      .then(([inst, sum]) => {
        setData({ plans: inst.plans, insight: inst.insight });
        setSummary(sum);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [router]);

  const toggleEarlyPayoff = (key: string) => {
    setShowEarlyPayoff((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const plans = data?.plans ?? [];
  const monthsFree = summary?.months_until_debt_free ?? 0;

  return (
    <main className="min-h-screen bg-gray-950 text-white px-4 py-10">
      <div className="max-w-3xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <Link href="/transactions" className="text-gray-500 text-sm hover:text-gray-300 transition-colors">
              ← İşlemler
            </Link>
            <h1 className="text-3xl font-bold mt-4">Taksitler</h1>
            <p className="text-gray-400 text-sm mt-1">Tespit edilen taksit planları ve gerçek maliyet</p>
          </div>
          <div className="flex gap-2">
            <Link
              href="/subscriptions"
              className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm text-gray-300 transition-colors"
            >
              Abonelikler
            </Link>
            <Link
              href="/progress"
              className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm text-gray-300 transition-colors"
            >
              İlerleme
            </Link>
          </div>
        </div>

        {loading && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-44 rounded-xl bg-gray-900 animate-pulse" />
            ))}
          </div>
        )}

        {!loading && plans.length === 0 && (
          <div className="text-center py-20 text-gray-500">
            <p className="text-lg">Taksit planı tespit edilmedi.</p>
            <p className="text-sm mt-2 max-w-sm mx-auto">
              En az 3 ardışık ayda aynı tutarda işlem görüldüğünde veya ekstre açıklamasında
              "TAKSİT" ifadesi geçtiğinde burada görünür.
            </p>
            <Link href="/upload" className="mt-4 inline-block text-indigo-400 hover:text-indigo-300 text-sm">
              Ekstre yükle →
            </Link>
          </div>
        )}

        {!loading && plans.length > 0 && (
          <>
            {/* Hero summary */}
            <div className="rounded-2xl bg-gray-900 border border-gray-800 p-6 mb-8">
              <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-6">
                <div>
                  <p className="text-gray-400 text-sm mb-1">Aylık taksit yükümlülüğünüz</p>
                  <p className="text-5xl font-bold text-white">
                    ₺{fmtN(summary?.total_monthly_burden ?? 0)}
                  </p>
                  <p className="text-gray-500 text-sm mt-2">
                    {plans.length} aktif plan
                  </p>
                </div>

                <div className="flex flex-col gap-3 text-right">
                  {monthsFree > 0 && (
                    <div className="bg-indigo-950 border border-indigo-800 rounded-xl px-5 py-3">
                      <p className="text-indigo-400 text-xs mb-0.5">Taksit yükünden kurtulma</p>
                      <p className="text-indigo-200 text-xl font-bold">{monthsFree} ay sonra</p>
                    </div>
                  )}
                  {summary?.income_pct !== null && summary?.income_pct !== undefined && (
                    <div className={`rounded-xl border px-5 py-3 ${
                      summary.income_pct > 30
                        ? "bg-red-950 border-red-800"
                        : "bg-gray-800 border-gray-700"
                    }`}>
                      <p className="text-gray-400 text-xs mb-0.5">Gelirin yüzdesi</p>
                      <p className={`text-xl font-bold ${
                        summary.income_pct > 30 ? "text-red-300" : "text-white"
                      }`}>
                        %{fmtN(summary.income_pct, 1)}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Opportunity cost summary */}
              {summary && summary.total_opportunity_loss > 0 && (
                <div className="mt-5 pt-5 border-t border-gray-800">
                  <p className="text-gray-500 text-xs">
                    Fırsat maliyeti (kalan taksitler için %40 yıllık getiri varsayımıyla):
                    <span className="text-amber-400 font-semibold ml-1">
                      ₺{fmtN(summary.total_opportunity_loss)} kayıp
                    </span>
                  </p>
                </div>
              )}
            </div>

            {/* LLM insight */}
            {data?.insight && (
              <div className="bg-gray-900 border border-gray-700 rounded-xl p-4 mb-8">
                <p className="text-gray-300 text-sm leading-relaxed italic">"{data.insight}"</p>
              </div>
            )}

            {/* Installment cards */}
            <div className="space-y-4 mb-8">
              {plans.map((plan) => {
                const earlyOpen = showEarlyPayoff[plan.merchant_key] ?? false;

                return (
                  <div
                    key={plan.merchant_key}
                    className="rounded-xl bg-gray-900 border border-gray-800 p-5"
                  >
                    {/* Top row */}
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-semibold text-white truncate">{plan.merchant}</h3>
                          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-800 text-gray-400">
                            {CATEGORY_LABELS[plan.category] ?? plan.category}
                          </span>
                          {plan.source === "explicit" && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-900 text-indigo-300">
                              Ekstre'den
                            </span>
                          )}
                        </div>
                        <div className="flex gap-4 mt-1.5 text-xs text-gray-500 flex-wrap">
                          <span>İlk ödeme: {new Date(plan.first_seen).toLocaleDateString("tr-TR", { month: "short", year: "numeric" })}</span>
                          <span>Son: {new Date(plan.last_seen).toLocaleDateString("tr-TR", { month: "short", year: "numeric" })}</span>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-2xl font-bold text-white">₺{fmtN(plan.monthly_amount, 2)}</p>
                        <p className="text-xs text-gray-500">/ay</p>
                      </div>
                    </div>

                    {/* Progress bar */}
                    <div className="mb-4">
                      <ProgressBar
                        current={plan.months_detected}
                        total={plan.total_plan_months}
                      />
                    </div>

                    {/* Stats row */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
                      <div className="bg-gray-800/60 rounded-lg p-3">
                        <p className="text-gray-500 text-xs mb-0.5">Ödenen</p>
                        <p className="text-white font-semibold text-sm">₺{fmtN(plan.total_paid, 0)}</p>
                      </div>
                      <div className="bg-gray-800/60 rounded-lg p-3">
                        <p className="text-gray-500 text-xs mb-0.5">Kalan taksit</p>
                        <p className="text-white font-semibold text-sm">
                          {plan.estimated_remaining > 0 ? `${plan.estimated_remaining} ay` : "Tamamlandı ✓"}
                        </p>
                      </div>
                      <div className="bg-amber-950/40 border border-amber-900/30 rounded-lg p-3">
                        <p className="text-amber-600 text-xs mb-0.5">Gerçek maliyet</p>
                        <p className="text-amber-400 font-semibold text-sm">
                          ₺{fmtN(plan.real_cost_with_opportunity, 0)}
                        </p>
                        <p className="text-amber-700 text-xs">fırsat maliyetiyle</p>
                      </div>
                    </div>

                    {/* Early payoff toggle */}
                    {plan.estimated_remaining > 0 && (
                      <div>
                        <button
                          onClick={() => toggleEarlyPayoff(plan.merchant_key)}
                          className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                        >
                          {earlyOpen ? "▲ Erken ödeme bilgisini gizle" : "▼ Erken ödeyebilirim — ne kadar tasarruf ederim?"}
                        </button>

                        {earlyOpen && (
                          <div className="mt-3 bg-indigo-950/30 border border-indigo-900/40 rounded-xl p-4">
                            <p className="text-indigo-300 text-sm font-medium mb-2">
                              Erken Ödeme Analizi
                            </p>
                            <div className="space-y-1.5 text-sm">
                              <div className="flex justify-between">
                                <span className="text-gray-400">Kalan anapara</span>
                                <span className="text-white">₺{fmtN(plan.total_nominal, 0)}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-400">Fırsat maliyeti tasarrufu</span>
                                <span className="text-emerald-400">+ ₺{fmtN(plan.opportunity_loss, 0)}</span>
                              </div>
                              <div className="flex justify-between border-t border-indigo-900/40 pt-1.5 mt-1.5">
                                <span className="text-gray-300 font-medium">Toplam kazanım</span>
                                <span className="text-emerald-300 font-bold">₺{fmtN(plan.opportunity_loss, 0)}</span>
                              </div>
                            </div>
                            <p className="text-indigo-400 text-xs mt-3">
                              %40 yıllık getiri varsayımıyla hesaplanmıştır. Bankanızın erken ödeme
                              koşullarını kontrol edin.
                            </p>
                          </div>
                        )}
                      </div>
                    )}

                    {plan.estimated_remaining === 0 && (
                      <p className="text-emerald-500 text-xs">✓ Bu taksit planı tamamlandı</p>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Disclaimer */}
            <p className="text-gray-600 text-xs text-center">
              Taksit sayıları tahmindir. Kesin bilgi için bankanızın ekstre veya uygulamasını kontrol edin.
              Fırsat maliyeti hesabı %40 yıllık getiri varsayımına dayanır (2024 TCMB faiz dönemi).
            </p>
          </>
        )}
      </div>
    </main>
  );
}
