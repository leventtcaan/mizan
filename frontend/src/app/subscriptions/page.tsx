"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getSubscriptions, flagSubscription, getSubscriptionSummary, getStoredUser,
  type SubscriptionItem, type SubscriptionSummary,
} from "@/lib/api";
import PageLayout from "@/components/ui/PageLayout";
import MoneyTabs from "@/components/ui/MoneyTabs";
import { useLanguage } from "@/lib/i18n";

function fmt(amount: string, locale?: string): string {
  return new Intl.NumberFormat(locale, { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(parseFloat(amount));
}

function fmt2(amount: string, locale?: string): string {
  return new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(parseFloat(amount));
}

const FLAG_ACTIVE: Record<string, string> = {
  essential: "bg-emerald-900 border-emerald-700 text-emerald-300",
  review: "bg-amber-900 border-amber-700 text-amber-300",
  cancelled: "bg-red-950 border-red-800 text-red-400",
};

const FLAG_IDLE: Record<string, string> = {
  essential: "border-[#2A2A2A] text-gray-500 hover:border-emerald-800 hover:text-emerald-400",
  review: "border-[#2A2A2A] text-gray-500 hover:border-amber-800 hover:text-amber-400",
  cancelled: "border-[#2A2A2A] text-gray-500 hover:border-red-900 hover:text-red-400",
};

export default function SubscriptionsPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const [subs, setSubs] = useState<SubscriptionItem[]>([]);
  const [summary, setSummary] = useState<SubscriptionSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [flagging, setFlagging] = useState<string | null>(null);

  const FLAG_LABELS: Record<string, string> = {
    essential: t("subscriptions.flagEssential"),
    review: t("subscriptions.flagReview"),
    cancelled: t("subscriptions.flagCancelled"),
  };

  useEffect(() => {
    if (!getStoredUser()) { router.replace("/login"); return; }
    Promise.all([getSubscriptions(), getSubscriptionSummary()])
      .then(([subsData, sumData]) => {
        setSubs(subsData.subscriptions);
        setSummary(sumData);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [router]);

  const handleFlag = async (merchantKey: string, flag: "essential" | "review" | "cancelled") => {
    const sub = subs.find((s) => s.merchant_key === merchantKey);
    const newFlag = sub?.flag === flag ? null : flag;
    setSubs((prev) => prev.map((s) => s.merchant_key === merchantKey ? { ...s, flag: newFlag } : s));
    if (newFlag) {
      setFlagging(merchantKey);
      try {
        await flagSubscription(merchantKey, newFlag);
        const sumData = await getSubscriptionSummary();
        setSummary(sumData);
      } catch {
        setSubs((prev) => prev.map((s) => s.merchant_key === merchantKey ? { ...s, flag: sub?.flag ?? null } : s));
      } finally {
        setFlagging(null);
      }
    }
  };

  function getCategoryLabel(cat: string): string {
    const key = `category.${cat}`;
    const label = t(key);
    return label !== key ? label : cat;
  }

  const activeSubs = subs.filter((s) => s.flag !== "cancelled");
  const reviewSubs = subs.filter((s) => s.flag === "review");
  const cancelledSubs = subs.filter((s) => s.flag === "cancelled");
  const totalMonthly = parseFloat(summary?.total_monthly_cost ?? "0");
  const potentialSavings = parseFloat(summary?.potential_savings ?? "0");

  return (
    <PageLayout title={t("subscriptions.title")} subtitle={t("subscriptions.subtitle")}>
      <MoneyTabs />

      {loading && (
        <div className="space-y-3">
          {[1,2,3].map(i => <div key={i} className="h-32 rounded-xl bg-[#1A1A1A] animate-pulse" />)}
        </div>
      )}

      {!loading && subs.length === 0 && (
        <div className="text-center py-20 text-gray-500 bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl">
          <p className="text-base text-gray-400">{t("subscriptions.noSubscriptions")}</p>
          <p className="text-sm mt-2">{t("subscriptions.noSubscriptionsHint")}</p>
        </div>
      )}

      {!loading && subs.length > 0 && (
        <>
          {/* Hero */}
          <div className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-6 mb-6">
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-5">
              <div>
                <p className="text-gray-500 text-sm mb-2">{t("subscriptions.heroLabel")}</p>
                <p className={`text-5xl font-bold ${totalMonthly > 500 ? "text-red-400" : "text-white"}`}>
                  {fmt(String(totalMonthly))}
                </p>
                <p className="text-gray-500 text-sm mt-2">{summary?.count ?? 0} {t("subscriptions.activeCount")}</p>
              </div>
              {potentialSavings > 0 && (
                <div className="bg-emerald-950 border border-emerald-800 rounded-xl px-5 py-4">
                  <p className="text-emerald-500 text-xs mb-1">{t("subscriptions.savingsPotential")}</p>
                  <p className="text-emerald-300 text-2xl font-bold">{fmt(String(potentialSavings))}</p>
                  <p className="text-emerald-700 text-xs mt-0.5">{t("subscriptions.perMonth")}</p>
                </div>
              )}
            </div>
          </div>

          {/* Active subs */}
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">{t("subscriptions.active")}</h2>
          <div className="space-y-3 mb-8">
            {activeSubs.map((sub) => (
              <div
                key={sub.merchant_key}
                className={`bg-[#1A1A1A] rounded-xl border p-5 transition-colors ${
                  sub.flag === "review"
                    ? "border-amber-800/50"
                    : sub.flag === "essential"
                    ? "border-emerald-800/50"
                    : "border-[#2A2A2A]"
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1.5">
                      <h3 className="font-semibold text-white">{sub.merchant}</h3>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-[#2A2A2A] text-gray-400">
                        {getCategoryLabel(sub.category)}
                      </span>
                      {sub.frequency === "weekly" && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-blue-950 border border-blue-900 text-blue-400">
                          {t("subscriptions.weekly")}
                        </span>
                      )}
                    </div>
                    <div className="flex gap-4 text-xs text-gray-500 flex-wrap">
                      <span>{t("subscriptions.lastSeen")}: {new Date(sub.last_seen).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</span>
                      <span>{sub.months_active} {t("subscriptions.monthsActive")}</span>
                      <span>{t("subscriptions.totalPaid")}: {fmt2(sub.total_paid_all_time)}</span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-2xl font-bold text-white">{fmt2(sub.avg_amount)}</p>
                    <p className="text-xs text-gray-500">
                      {sub.frequency === "weekly" ? t("subscriptions.perWeek") : t("subscriptions.perMonth")}
                    </p>
                  </div>
                </div>

                <div className="flex gap-2 mt-4 flex-wrap">
                  {(["essential", "review", "cancelled"] as const).map((flag) => {
                    const isActive = sub.flag === flag;
                    return (
                      <button
                        key={flag}
                        disabled={flagging === sub.merchant_key}
                        onClick={() => handleFlag(sub.merchant_key, flag)}
                        className={`text-xs px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-50 ${
                          isActive ? FLAG_ACTIVE[flag] : `bg-transparent ${FLAG_IDLE[flag]}`
                        }`}
                      >
                        {FLAG_LABELS[flag]}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Review summary */}
          {reviewSubs.length > 0 && (
            <div className="bg-amber-950/20 border border-amber-800/30 rounded-xl p-5 mb-6">
              <h2 className="text-amber-300 font-semibold mb-3 text-sm">{t("subscriptions.review")}</h2>
              <div className="space-y-2">
                {reviewSubs.map((sub) => (
                  <div key={sub.merchant_key} className="flex justify-between items-center text-sm">
                    <span className="text-gray-300">{sub.merchant}</span>
                    <span className="text-amber-400 font-medium">
                      {fmt2(sub.avg_amount)}{sub.frequency === "weekly" ? t("subscriptions.perWeek") : t("subscriptions.perMonth")}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-4 pt-3 border-t border-amber-800/30 flex justify-between items-center">
                <span className="text-gray-400 text-sm">{t("subscriptions.savingsTotal")}</span>
                <span className="text-emerald-400 font-bold">{fmt(String(potentialSavings))}{t("subscriptions.perMonth")}</span>
              </div>
            </div>
          )}

          {/* Cancelled */}
          {cancelledSubs.length > 0 && (
            <div>
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">{t("subscriptions.cancelled")}</h2>
              <div className="space-y-2">
                {cancelledSubs.map((sub) => (
                  <div key={sub.merchant_key} className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-lg px-4 py-3 flex justify-between items-center">
                    <span className="text-gray-600 line-through text-sm">{sub.merchant}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-gray-600 text-sm line-through">{fmt2(sub.avg_amount)}{t("subscriptions.perMonth")}</span>
                      <button
                        onClick={() => handleFlag(sub.merchant_key, "cancelled")}
                        className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
                      >
                        {t("subscriptions.restore")}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </PageLayout>
  );
}
