"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getInstallments, getInstallmentSummary, getStoredUser,
  type InstallmentPlan, type InstallmentSummary,
} from "@/lib/api";
import PageLayout from "@/components/ui/PageLayout";
import { ChevronDown, ChevronUp } from "@/components/ui/Icons";
import { useLanguage } from "@/lib/i18n";

function fmtN(n: number, decimals = 0, locale?: string): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
}

function ProgressBar({ current, total, paidLabel }: { current: number; total: number; paidLabel: string }) {
  const pct = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
  return (
    <div>
      <div className="flex justify-between text-xs text-gray-500 mb-1.5">
        <span>{current}/{total} {paidLabel}</span>
        <span className="font-medium text-gray-400">{pct}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-[#2A2A2A] overflow-hidden">
        <div
          className="h-full rounded-full bg-indigo-500 transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default function InstallmentsPage() {
  const { t } = useLanguage();
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

  function getCategoryLabel(cat: string): string {
    const key = `category.${cat}`;
    const label = t(key);
    return label !== key ? label : cat;
  }

  const plans = data?.plans ?? [];
  const monthsFree = summary?.months_until_debt_free ?? 0;

  return (
    <PageLayout title={t("installments.title")} subtitle={t("installments.subtitle")}>

      {loading && (
        <div className="space-y-3">
          {[1,2,3].map(i => <div key={i} className="h-44 rounded-xl bg-[#1A1A1A] animate-pulse" />)}
        </div>
      )}

      {!loading && plans.length === 0 && (
        <div className="text-center py-20 bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl text-gray-500">
          <p className="text-base text-gray-400">{t("installments.noPlans")}</p>
          <p className="text-sm mt-2 max-w-sm mx-auto">{t("installments.noPlansHint")}</p>
        </div>
      )}

      {!loading && plans.length > 0 && (
        <>
          {/* Hero */}
          <div className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-6 mb-6">
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-6">
              <div>
                <p className="text-gray-500 text-sm mb-2">{t("installments.monthlyBurden")}</p>
                <p className="text-5xl font-bold text-white">{fmtN(summary?.total_monthly_burden ?? 0)}</p>
                <p className="text-gray-500 text-sm mt-2">{plans.length} {t("installments.activePlans")}</p>
              </div>

              <div className="flex flex-col gap-3">
                {monthsFree > 0 && (
                  <div className="bg-indigo-950 border border-indigo-800 rounded-xl px-5 py-3 text-right">
                    <p className="text-indigo-400 text-xs mb-0.5">{t("installments.debtFreeLabel")}</p>
                    <p className="text-indigo-200 text-xl font-bold">{monthsFree} {t("installments.debtFree")}</p>
                  </div>
                )}
                {summary?.income_pct != null && (
                  <div className={`rounded-xl border px-5 py-3 text-right ${
                    summary.income_pct > 30
                      ? "bg-red-950 border-red-800"
                      : "bg-[#2A2A2A] border-[#3A3A3A]"
                  }`}>
                    <p className="text-gray-400 text-xs mb-0.5">{t("installments.incomePct")}</p>
                    <p className={`text-xl font-bold ${summary.income_pct > 30 ? "text-red-300" : "text-white"}`}>
                      %{fmtN(summary.income_pct, 1)}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {summary && summary.total_opportunity_loss > 0 && (
              <div className="mt-5 pt-5 border-t border-[#2A2A2A]">
                <p className="text-gray-500 text-xs">
                  {t("installments.opportunityCostLabel")}
                  <span className="text-amber-400 font-semibold ml-1">
                    {fmtN(summary.total_opportunity_loss)} {t("installments.opportunityLoss")}
                  </span>
                </p>
              </div>
            )}
          </div>

          {/* LLM insight */}
          {data?.insight && (
            <div className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-4 mb-6">
              <p className="text-gray-300 text-sm leading-relaxed italic">"{data.insight}"</p>
            </div>
          )}

          {/* Plan cards */}
          <div className="space-y-4 mb-8">
            {plans.map((plan) => {
              const earlyOpen = showEarlyPayoff[plan.merchant_key] ?? false;
              return (
                <div key={plan.merchant_key} className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-5">
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1.5">
                        <h3 className="font-semibold text-white">{plan.merchant}</h3>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-[#2A2A2A] text-gray-400">
                          {getCategoryLabel(plan.category)}
                        </span>
                        {plan.source === "explicit" && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-950 border border-indigo-900 text-indigo-400">
                            {t("installments.explicit")}
                          </span>
                        )}
                      </div>
                      <div className="flex gap-4 text-xs text-gray-500 flex-wrap">
                        <span>{new Date(plan.first_seen).toLocaleDateString(undefined, { month: "short", year: "numeric" })}</span>
                        <span>→ {new Date(plan.last_seen).toLocaleDateString(undefined, { month: "short", year: "numeric" })}</span>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-2xl font-bold text-white">{fmtN(plan.monthly_amount, 2)}</p>
                      <p className="text-xs text-gray-500">/{t("cashflow.legend.payment")}</p>
                    </div>
                  </div>

                  <div className="mb-4">
                    <ProgressBar current={plan.months_detected} total={plan.total_plan_months} paidLabel={t("installments.paid")} />
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
                    <div className="bg-[#0F0F0F] rounded-lg p-3">
                      <p className="text-gray-500 text-xs mb-0.5">{t("installments.paid")}</p>
                      <p className="text-white font-semibold text-sm">{fmtN(plan.total_paid, 0)}</p>
                    </div>
                    <div className="bg-[#0F0F0F] rounded-lg p-3">
                      <p className="text-gray-500 text-xs mb-0.5">{t("installments.remaining")}</p>
                      <p className="text-white font-semibold text-sm">
                        {plan.estimated_remaining > 0 ? `${plan.estimated_remaining}` : t("installments.completed")}
                      </p>
                    </div>
                    <div className="bg-amber-950/30 border border-amber-900/20 rounded-lg p-3">
                      <p className="text-amber-600 text-xs mb-0.5">{t("installments.realCost")}</p>
                      <p className="text-amber-400 font-semibold text-sm">{fmtN(plan.real_cost_with_opportunity, 0)}</p>
                      <p className="text-amber-800 text-xs">{t("installments.withOpportunityCost")}</p>
                    </div>
                  </div>

                  {plan.estimated_remaining > 0 && (
                    <div>
                      <button
                        onClick={() => setShowEarlyPayoff(prev => ({ ...prev, [plan.merchant_key]: !prev[plan.merchant_key] }))}
                        className="flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                      >
                        {earlyOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        {t("installments.earlyPayoffQ")}
                      </button>

                      {earlyOpen && (
                        <div className="mt-3 bg-indigo-950/20 border border-indigo-900/30 rounded-xl p-4">
                          <p className="text-indigo-300 text-sm font-medium mb-3">{t("installments.earlyPayoffTitle")}</p>
                          <div className="space-y-2 text-sm">
                            <div className="flex justify-between">
                              <span className="text-gray-400">{t("installments.remainingPrincipal")}</span>
                              <span className="text-white">{fmtN(plan.total_nominal, 0)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-400">{t("installments.opportunitySavings")}</span>
                              <span className="text-emerald-400">+ {fmtN(plan.opportunity_loss, 0)}</span>
                            </div>
                            <div className="flex justify-between border-t border-indigo-900/30 pt-2 mt-1">
                              <span className="text-gray-300 font-medium">{t("installments.totalGain")}</span>
                              <span className="text-emerald-300 font-bold">{fmtN(plan.opportunity_loss, 0)}</span>
                            </div>
                          </div>
                          <p className="text-indigo-500 text-xs mt-3">{t("installments.disclaimer")}</p>
                        </div>
                      )}
                    </div>
                  )}

                  {plan.estimated_remaining === 0 && (
                    <p className="text-emerald-500 text-xs">{t("installments.completedPlan")}</p>
                  )}
                </div>
              );
            })}
          </div>

          <p className="text-gray-700 text-xs text-center">{t("installments.disclaimer")}</p>
        </>
      )}
    </PageLayout>
  );
}
