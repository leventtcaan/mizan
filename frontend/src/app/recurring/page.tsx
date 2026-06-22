"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import PageLayout from "@/components/ui/PageLayout";
import MoneyTabs from "@/components/ui/MoneyTabs";
import { ChevronDown, ChevronUp } from "@/components/ui/Icons";
import { card } from "@/lib/design";
import { useLanguage } from "@/lib/i18n";
import {
  getToken, getRecurring, flagSubscription, getDefaultCurrency, CURRENCY_CHANGE_EVENT,
  type RecurringSubscription, type RecurringInstallment, type RecurringSummary,
} from "@/lib/api";

const FLAGS = ["essential", "review", "cancelled"] as const;
const FLAG_ACTIVE: Record<string, string> = {
  essential: "bg-emerald-900 border-emerald-700 text-emerald-300",
  review: "bg-amber-900 border-amber-700 text-amber-300",
  cancelled: "bg-red-950 border-red-800 text-red-400",
};

export default function RecurringPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const [subs, setSubs] = useState<RecurringSubscription[]>([]);
  const [installments, setInstallments] = useState<RecurringInstallment[]>([]);
  const [summary, setSummary] = useState<RecurringSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [ccy, setCcy] = useState("TRY");
  const [flagging, setFlagging] = useState<string | null>(null);
  const [earlyOpen, setEarlyOpen] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setCcy(getDefaultCurrency());
    const h = (e: Event) => setCcy((e as CustomEvent<string>).detail);
    window.addEventListener(CURRENCY_CHANGE_EVENT, h);
    return () => window.removeEventListener(CURRENCY_CHANGE_EVENT, h);
  }, []);

  const load = useCallback(() => {
    getRecurring()
      .then((r) => { setSubs(r.subscriptions); setInstallments(r.installments); setSummary(r.summary); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!getToken()) { router.push("/login"); return; }
    load();
  }, [router, load]);

  useEffect(() => {
    const h = () => load();
    window.addEventListener("mizan-data-changed", h);
    return () => window.removeEventListener("mizan-data-changed", h);
  }, [load]);

  const fmt = (v: number) => {
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency: ccy, maximumFractionDigits: 0 }).format(v);
    } catch {
      return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(v)} ${ccy}`;
    }
  };
  const catLabel = (c: string) => (t(`category.${c}`) !== `category.${c}` ? t(`category.${c}`) : c);

  const handleFlag = async (key: string, flag: "essential" | "review" | "cancelled") => {
    const sub = subs.find((s) => s.merchant_key === key);
    const next = sub?.flag === flag ? null : flag;
    setSubs((prev) => prev.map((s) => (s.merchant_key === key ? { ...s, flag: next } : s)));
    if (next) {
      setFlagging(key);
      try { await flagSubscription(key, next); load(); }
      catch { setSubs((prev) => prev.map((s) => (s.merchant_key === key ? { ...s, flag: sub?.flag ?? null } : s))); }
      finally { setFlagging(null); }
    }
  };

  const activeSubs = subs.filter((s) => s.flag !== "cancelled");
  const isEmpty = !loading && subs.length === 0 && installments.length === 0;

  return (
    <PageLayout title={t("money.recurringTitle")} subtitle={t("money.recurringSubtitle")} maxWidth="lg">
      <MoneyTabs />

      {loading && (
        <div className="space-y-3">{[1, 2, 3].map((i) => <div key={i} className="h-28 rounded-xl bg-[#1A1A1A] animate-pulse" />)}</div>
      )}

      {isEmpty && (
        <div className="text-center py-20 bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl text-gray-500">
          <p className="text-base text-gray-400">{t("money.noRecurring")}</p>
          <p className="text-sm mt-2 max-w-sm mx-auto">{t("money.noRecurringHint")}</p>
        </div>
      )}

      {!loading && !isEmpty && (
        <>
          {/* Summary */}
          {summary && (
            <div className={`${card} mb-6`}>
              <div className="flex flex-wrap gap-y-4 gap-x-8">
                <div>
                  <p className="text-gray-500 text-xs mb-1">{t("money.fixedMonthly")}</p>
                  <p className="text-3xl font-bold text-white tabular-nums">{fmt(parseFloat(summary.monthly_total))}</p>
                </div>
                <div>
                  <p className="text-gray-500 text-xs mb-1">{t("money.subscriptions")}</p>
                  <p className="text-lg font-semibold text-gray-200 tabular-nums">{fmt(parseFloat(summary.subscription_monthly))}</p>
                  <p className="text-gray-600 text-xs">{summary.subscription_count}</p>
                </div>
                <div>
                  <p className="text-gray-500 text-xs mb-1">{t("money.installments")}</p>
                  <p className="text-lg font-semibold text-gray-200 tabular-nums">{fmt(parseFloat(summary.installment_monthly))}</p>
                  <p className="text-gray-600 text-xs">{summary.installment_count}</p>
                </div>
                {parseFloat(summary.potential_savings) > 0 && (
                  <div>
                    <p className="text-emerald-600 text-xs mb-1">{t("money.potentialSavings")}</p>
                    <p className="text-lg font-semibold text-emerald-400 tabular-nums">{fmt(parseFloat(summary.potential_savings))}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Subscriptions */}
          {activeSubs.length > 0 && (
            <>
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">{t("money.subscriptions")}</h2>
              <div className="space-y-3 mb-8">
                {activeSubs.map((s) => (
                  <div key={s.merchant_key} className={`${card}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <h3 className="font-semibold text-white truncate">{s.merchant}</h3>
                          <span className="text-xs px-2 py-0.5 rounded-full bg-[#2A2A2A] text-gray-400">{catLabel(s.category)}</span>
                          {s.frequency === "weekly" && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-blue-950 border border-blue-900 text-blue-400">{t("subscriptions.weekly")}</span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500">{s.months_active} {t("subscriptions.monthsActive")}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-xl font-bold text-white tabular-nums">{fmt(parseFloat(s.avg_amount))}</p>
                        <p className="text-xs text-gray-500">{s.frequency === "weekly" ? t("subscriptions.perWeek") : t("subscriptions.perMonth")}</p>
                      </div>
                    </div>
                    <div className="flex gap-2 mt-3">
                      {FLAGS.map((f) => (
                        <button
                          key={f}
                          disabled={flagging === s.merchant_key}
                          onClick={() => handleFlag(s.merchant_key, f)}
                          className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors disabled:opacity-50 ${
                            s.flag === f ? FLAG_ACTIVE[f] : "border-[#2A2A2A] text-gray-500 hover:text-gray-300"
                          }`}
                        >
                          {t(`subscriptions.flag${f.charAt(0).toUpperCase()}${f.slice(1)}`)}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Installments */}
          {installments.length > 0 && (
            <>
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">{t("money.installments")}</h2>
              <div className="space-y-4">
                {installments.map((p) => {
                  const open = earlyOpen[p.merchant_key] ?? false;
                  const pctPaid = p.total_plan_months > 0 ? Math.min(100, (p.months_detected / p.total_plan_months) * 100) : 0;
                  return (
                    <div key={p.merchant_key} className={`${card}`}>
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <h3 className="font-semibold text-white truncate">{p.merchant}</h3>
                            <span className="text-xs px-2 py-0.5 rounded-full bg-[#2A2A2A] text-gray-400">{catLabel(p.category)}</span>
                            {p.source === "explicit" && (
                              <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-950 border border-indigo-900 text-indigo-400">{t("installments.explicit")}</span>
                            )}
                          </div>
                          <p className="text-xs text-gray-500">{p.months_detected}/{p.total_plan_months} {t("installments.paid")}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-xl font-bold text-white tabular-nums">{fmt(p.monthly_amount)}</p>
                          <p className="text-xs text-gray-500">/{t("cashflow.legend.payment")}</p>
                        </div>
                      </div>
                      <div className="h-2 rounded-full bg-[#0F0F0F] overflow-hidden mb-3">
                        <div className="h-full rounded-full bg-indigo-500" style={{ width: `${pctPaid}%` }} />
                      </div>
                      {p.estimated_remaining > 0 ? (
                        <>
                          <button
                            onClick={() => setEarlyOpen((prev) => ({ ...prev, [p.merchant_key]: !prev[p.merchant_key] }))}
                            className="flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                          >
                            {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                            {t("installments.earlyPayoffQ")}
                          </button>
                          {open && (
                            <div className="mt-3 grid grid-cols-3 gap-3">
                              <div className="bg-[#0F0F0F] rounded-lg p-3">
                                <p className="text-gray-500 text-xs mb-0.5">{t("installments.remaining")}</p>
                                <p className="text-white font-semibold text-sm">{p.estimated_remaining}</p>
                              </div>
                              <div className="bg-amber-950/30 border border-amber-900/20 rounded-lg p-3">
                                <p className="text-amber-600 text-xs mb-0.5">{t("installments.realCost")}</p>
                                <p className="text-amber-400 font-semibold text-sm">{fmt(p.real_cost_with_opportunity)}</p>
                              </div>
                              <div className="bg-[#0F0F0F] rounded-lg p-3">
                                <p className="text-gray-500 text-xs mb-0.5">{t("installments.opportunityLoss")}</p>
                                <p className="text-amber-400 font-semibold text-sm">{fmt(p.opportunity_loss)}</p>
                              </div>
                            </div>
                          )}
                        </>
                      ) : (
                        <span className="text-emerald-400 text-xs">{t("installments.completed")} ✓</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}
    </PageLayout>
  );
}
