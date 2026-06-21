"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  getSubscriptions, flagSubscription, getSubscriptionSummary, getStoredUser,
  type SubscriptionItem, type SubscriptionSummary,
} from "@/lib/api";
import { CATEGORY_LABELS } from "@/lib/categories";

function fmt(amount: string): string {
  const n = parseFloat(amount);
  return new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
}

function fmt2(amount: string): string {
  const n = parseFloat(amount);
  return new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

const FLAG_LABELS: Record<string, string> = {
  essential: "✓ Gerekli",
  review: "⚠ Gözden Geçir",
  cancelled: "✗ İptal Ettim",
};

const FLAG_ACTIVE_CLASSES: Record<string, string> = {
  essential: "bg-emerald-900 border-emerald-600 text-emerald-300",
  review: "bg-amber-900 border-amber-600 text-amber-300",
  cancelled: "bg-red-950 border-red-700 text-red-400 line-through",
};

const FLAG_HOVER_CLASSES: Record<string, string> = {
  essential: "hover:bg-emerald-950 hover:border-emerald-700 hover:text-emerald-400",
  review: "hover:bg-amber-950 hover:border-amber-700 hover:text-amber-400",
  cancelled: "hover:bg-red-950 hover:border-red-800 hover:text-red-400",
};

export default function SubscriptionsPage() {
  const router = useRouter();
  const [subs, setSubs] = useState<SubscriptionItem[]>([]);
  const [summary, setSummary] = useState<SubscriptionSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [flagging, setFlagging] = useState<string | null>(null); // merchant_key being flagged

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
    // Toggle off if same flag clicked again — not supported by backend yet, just UI optimism
    const newFlag = sub?.flag === flag ? null : flag;

    // Optimistic update
    setSubs((prev) =>
      prev.map((s) => s.merchant_key === merchantKey ? { ...s, flag: newFlag } : s)
    );

    if (newFlag) {
      setFlagging(merchantKey);
      try {
        await flagSubscription(merchantKey, newFlag);
        // Refresh summary
        const sumData = await getSubscriptionSummary();
        setSummary(sumData);
      } catch {
        // Revert on failure
        setSubs((prev) =>
          prev.map((s) => s.merchant_key === merchantKey ? { ...s, flag: sub?.flag ?? null } : s)
        );
      } finally {
        setFlagging(null);
      }
    }
  };

  const activeSubs = subs.filter((s) => s.flag !== "cancelled");
  const reviewSubs = subs.filter((s) => s.flag === "review");
  const cancelledSubs = subs.filter((s) => s.flag === "cancelled");
  const totalMonthly = parseFloat(summary?.total_monthly_cost ?? "0");
  const potentialSavings = parseFloat(summary?.potential_savings ?? "0");

  return (
    <main className="min-h-screen bg-gray-950 text-white px-4 py-10">
      <div className="max-w-3xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <Link href="/transactions" className="text-gray-500 text-sm hover:text-gray-300 transition-colors">
              ← İşlemler
            </Link>
            <h1 className="text-3xl font-bold mt-4">Abonelikler</h1>
            <p className="text-gray-400 text-sm mt-1">
              Tespit edilen tekrarlayan ödemeler
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              href="/progress"
              className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm text-gray-300 transition-colors"
            >
              İlerleme
            </Link>
            <Link
              href="/upload"
              className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-sm font-medium transition-colors"
            >
              + Ekstre Yükle
            </Link>
          </div>
        </div>

        {loading && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-32 rounded-xl bg-gray-900 animate-pulse" />
            ))}
          </div>
        )}

        {!loading && subs.length === 0 && (
          <div className="text-center py-20 text-gray-500">
            <p className="text-lg">Henüz tekrarlayan ödeme tespit edilmedi.</p>
            <p className="text-sm mt-2">En az 2 farklı ayda aynı tutarda ödeme görüldüğünde burası dolacak.</p>
            <Link href="/upload" className="mt-4 inline-block text-indigo-400 hover:text-indigo-300 text-sm">
              Ekstre yükle →
            </Link>
          </div>
        )}

        {!loading && subs.length > 0 && (
          <>
            {/* Hero summary */}
            <div className={`rounded-2xl p-6 mb-8 border ${
              totalMonthly > 0
                ? "bg-gray-900 border-gray-800"
                : "bg-gray-900 border-gray-800"
            }`}>
              <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
                <div>
                  <p className="text-gray-400 text-sm mb-1">Aylık abonelik harcaman</p>
                  <p className={`text-5xl font-bold ${totalMonthly > 500 ? "text-red-400" : "text-white"}`}>
                    ₺{fmt(String(totalMonthly))}
                  </p>
                  <p className="text-gray-500 text-sm mt-2">
                    {summary?.count ?? 0} aktif abonelik
                  </p>
                </div>
                {potentialSavings > 0 && (
                  <div className="bg-emerald-950 border border-emerald-800 rounded-xl px-5 py-4 text-right">
                    <p className="text-emerald-400 text-xs mb-1">Tasarruf edebilirsin</p>
                    <p className="text-emerald-300 text-2xl font-bold">₺{fmt(String(potentialSavings))}</p>
                    <p className="text-emerald-600 text-xs mt-1">gözden geçirilecekler</p>
                  </div>
                )}
              </div>
            </div>

            {/* Active subscriptions */}
            <h2 className="text-lg font-semibold mb-3 text-gray-200">Aktif Abonelikler</h2>
            <div className="space-y-3 mb-8">
              {activeSubs.map((sub) => (
                <div
                  key={sub.merchant_key}
                  className={`rounded-xl border p-5 transition-colors ${
                    sub.flag === "review"
                      ? "bg-amber-950/30 border-amber-800/50"
                      : sub.flag === "essential"
                      ? "bg-emerald-950/30 border-emerald-800/50"
                      : "bg-gray-900 border-gray-800"
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-white truncate">{sub.merchant}</h3>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-gray-800 text-gray-400">
                          {CATEGORY_LABELS[sub.category] ?? sub.category}
                        </span>
                        {sub.frequency === "weekly" && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-blue-900 text-blue-300">
                            haftalık
                          </span>
                        )}
                      </div>
                      <div className="flex gap-4 mt-2 text-sm text-gray-400 flex-wrap">
                        <span>
                          <span className="text-gray-500">Son: </span>
                          {new Date(sub.last_seen).toLocaleDateString("tr-TR", { day: "numeric", month: "short", year: "numeric" })}
                        </span>
                        <span>
                          <span className="text-gray-500">{sub.months_active} ay aktif</span>
                        </span>
                        <span>
                          <span className="text-gray-500">Toplam ödenen: </span>
                          ₺{fmt2(sub.total_paid_all_time)}
                        </span>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-2xl font-bold text-white">
                        ₺{fmt2(sub.avg_amount)}
                      </p>
                      <p className="text-xs text-gray-500">
                        /{sub.frequency === "weekly" ? "hafta" : "ay"}
                      </p>
                    </div>
                  </div>

                  {/* Flag buttons */}
                  <div className="flex gap-2 mt-4 flex-wrap">
                    {(["essential", "review", "cancelled"] as const).map((flag) => {
                      const isActive = sub.flag === flag;
                      return (
                        <button
                          key={flag}
                          disabled={flagging === sub.merchant_key}
                          onClick={() => handleFlag(sub.merchant_key, flag)}
                          className={`text-xs px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-50 ${
                            isActive
                              ? FLAG_ACTIVE_CLASSES[flag]
                              : `border-gray-700 text-gray-500 bg-transparent ${FLAG_HOVER_CLASSES[flag]}`
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

            {/* Gözden geçir summary */}
            {reviewSubs.length > 0 && (
              <div className="rounded-xl border border-amber-800/40 bg-amber-950/20 p-5 mb-8">
                <h2 className="text-amber-300 font-semibold mb-3">⚠ Gözden Geçirilecekler</h2>
                <div className="space-y-2">
                  {reviewSubs.map((sub) => (
                    <div key={sub.merchant_key} className="flex justify-between items-center text-sm">
                      <span className="text-gray-300">{sub.merchant}</span>
                      <span className="text-amber-400 font-medium">₺{fmt2(sub.avg_amount)}/{sub.frequency === "weekly" ? "hafta" : "ay"}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-4 pt-3 border-t border-amber-800/30 flex justify-between items-center">
                  <span className="text-amber-400 text-sm font-medium">Toplam tasarruf potansiyeli</span>
                  <span className="text-emerald-400 font-bold text-lg">₺{fmt(String(potentialSavings))}/ay</span>
                </div>
              </div>
            )}

            {/* Cancelled */}
            {cancelledSubs.length > 0 && (
              <div className="mt-6">
                <h2 className="text-gray-500 text-sm font-medium mb-3">İptal Edilenler</h2>
                <div className="space-y-2">
                  {cancelledSubs.map((sub) => (
                    <div
                      key={sub.merchant_key}
                      className="rounded-lg border border-gray-800 bg-gray-900/50 px-4 py-3 flex justify-between items-center"
                    >
                      <span className="text-gray-600 line-through text-sm">{sub.merchant}</span>
                      <div className="flex items-center gap-3">
                        <span className="text-gray-600 text-sm line-through">₺{fmt2(sub.avg_amount)}/ay</span>
                        <button
                          onClick={() => handleFlag(sub.merchant_key, "cancelled")}
                          className="text-xs text-gray-600 hover:text-gray-400 transition-colors"
                          title="Geri al"
                        >
                          Geri al
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
