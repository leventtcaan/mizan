"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import PageLayout from "@/components/ui/PageLayout";
import { ArrowRight, Plus, X as XIcon, TrendingUp, TrendingDown, CheckCircle } from "@/components/ui/Icons";
import { useLanguage } from "@/lib/i18n";
import { CATEGORY_LABELS } from "@/lib/categories";
import {
  getToken, getReviewBatch, saveReviewBatch, deleteBatch,
  completeOnboarding, getStoredUser, setStoredUser,
  type ReviewTransaction,
} from "@/lib/api";

const REVIEW_CATEGORIES = [
  "market", "restoran", "ulasim", "eglence", "saglik", "fatura",
  "giyim", "nakit_atm", "transfer", "faiz", "iade", "vergi", "teknoloji", "egitim", "diger",
];

type EditRow = {
  key: string;
  id: string | null;
  batch_id: string;
  transaction_date: string;
  description: string;
  amount: string;
  transaction_type: "debit" | "credit";
  category: string | null;
  currency: string;
};

let keyCounter = 0;
const nextKey = () => `row-${keyCounter++}`;

function toNum(s: string): number {
  return parseFloat((s || "").replace(",", ".")) || 0;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Upload → Review → Brief — shows the user this is a step in the product, not a QA chore. */
function FlowStepper({ labels }: { labels: [string, string, string] }) {
  // index 1 (Review) is the active step; 0 is already done.
  const steps = [
    { label: labels[0], state: "done" as const },
    { label: labels[1], state: "active" as const },
    { label: labels[2], state: "todo" as const },
  ];
  return (
    <div className="flex items-center gap-2 mb-5 text-xs">
      {steps.map((s, i) => (
        <div key={s.label} className="flex items-center gap-2">
          <span
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full font-medium ${
              s.state === "done" ? "text-emerald-400"
                : s.state === "active" ? "bg-indigo-600 text-white"
                : "text-gray-600"
            }`}
          >
            {s.state === "done" && <CheckCircle size={13} />}
            {s.label}
          </span>
          {i < steps.length - 1 && <span className="text-gray-700">›</span>}
        </div>
      ))}
    </div>
  );
}

function ReviewContent() {
  const router = useRouter();
  const params = useSearchParams();
  const { t } = useLanguage();

  const batchIds = useMemo(
    () => (params.get("batch_ids") || "").split(",").map((s) => s.trim()).filter(Boolean),
    [params],
  );
  // Reached from onboarding? Then THIS confirm is what completes onboarding —
  // onboarding deliberately defers completion until the review is confirmed.
  const isOnboarding = params.get("onboarding") === "1";

  const [rows, setRows] = useState<EditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!getToken()) { router.replace("/login"); return; }
    if (batchIds.length === 0) { router.replace("/upload"); return; }
    let active = true;
    Promise.all(batchIds.map((bid) =>
      getReviewBatch(bid).then((txs) => ({ bid, txs })).catch(() => ({ bid, txs: [] as ReviewTransaction[] })),
    ))
      .then((groups) => {
        if (!active) return;
        const merged: EditRow[] = [];
        for (const { bid, txs } of groups) {
          for (const tx of txs) {
            merged.push({
              key: nextKey(),
              id: tx.id,
              batch_id: bid,
              transaction_date: tx.transaction_date,
              description: tx.description,
              amount: tx.amount,
              transaction_type: tx.transaction_type,
              category: tx.category,
              currency: tx.currency,
            });
          }
        }
        if (merged.length === 0) { router.replace("/upload"); return; }
        setRows(merged);
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [batchIds, router]);

  const update = useCallback((key: string, patch: Partial<EditRow>) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }, []);

  const remove = useCallback((key: string) => {
    setRows((prev) => prev.filter((r) => r.key !== key));
  }, []);

  const addRow = useCallback(() => {
    const ccy = rows[0]?.currency || "TRY";
    const bid = batchIds[0];
    setRows((prev) => [...prev, {
      key: nextKey(), id: null, batch_id: bid,
      transaction_date: todayISO(), description: "", amount: "",
      transaction_type: "debit", category: null, currency: ccy,
    }]);
  }, [rows, batchIds]);

  const ccy = rows[0]?.currency || "TRY";
  const money = useCallback((n: number) => {
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency: ccy, maximumFractionDigits: ccy === "TRY" ? 0 : 2 }).format(n);
    } catch {
      return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(n)} ${ccy}`;
    }
  }, [ccy]);

  // --- suspicious-row detection (amber highlight + tooltip) ---
  const { highAmount, duplicates } = useMemo(() => {
    const nums = rows.map((r) => toNum(r.amount)).filter((n) => n > 0).sort((a, b) => a - b);
    const median = nums.length ? nums[Math.floor(nums.length / 2)] : 0;
    const high = new Set<string>();
    const dupCount = new Map<string, number>();
    for (const r of rows) {
      if (median > 0 && toNum(r.amount) > median * 10) high.add(r.key);
      const dk = `${r.transaction_date}|${r.description.trim().toLowerCase()}`;
      dupCount.set(dk, (dupCount.get(dk) || 0) + 1);
    }
    const dup = new Set<string>();
    for (const r of rows) {
      const dk = `${r.transaction_date}|${r.description.trim().toLowerCase()}`;
      if (r.description.trim() && (dupCount.get(dk) || 0) > 1) dup.add(r.key);
    }
    return { highAmount: high, duplicates: dup };
  }, [rows]);

  const income = rows.filter((r) => r.transaction_type === "credit").reduce((s, r) => s + toNum(r.amount), 0);
  const expenses = rows.filter((r) => r.transaction_type === "debit").reduce((s, r) => s + toNum(r.amount), 0);
  const net = income - expenses;

  const confirm = useCallback(async () => {
    if (saving) return;
    // Light client guard — backend validates too, but a friendly message beats a 422.
    const bad = rows.find((r) => !r.description.trim() || toNum(r.amount) <= 0);
    if (bad) { setError(t("review.invalidRow")); return; }
    setError(null);
    setSaving(true);
    try {
      // Group edited rows back to their source batch; new manual rows ride along with
      // whichever batch they were added under (the first one). PATCH each batch.
      for (const bid of batchIds) {
        const payload: ReviewTransaction[] = rows
          .filter((r) => r.batch_id === bid)
          .map((r) => ({
            id: r.id,
            transaction_date: r.transaction_date,
            description: r.description.trim(),
            amount: r.amount,
            transaction_type: r.transaction_type,
            category: r.category,
            currency: r.currency,
          }));
        await saveReviewBatch(bid, payload);
      }
      // Confirmed review from onboarding → now it's safe to mark onboarding complete.
      if (isOnboarding) {
        try {
          await completeOnboarding();
          const u = getStoredUser();
          if (u) setStoredUser({ ...u, onboarding_completed: true });
        } catch { /* non-blocking — the brief still loads */ }
      }
      router.push(`/brief?job_id=${batchIds[0]}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("review.saveError"));
      setSaving(false);
    }
  }, [rows, batchIds, saving, router, t, isOnboarding]);

  const cancel = useCallback(async () => {
    if (saving) return;
    if (!window.confirm(t("review.cancelConfirm"))) return;
    setSaving(true);
    await Promise.all(batchIds.map((bid) => deleteBatch(bid).catch(() => null)));
    // Keep an onboarding user inside the onboarding flow if they start over.
    router.push(isOnboarding ? "/onboarding" : "/upload");
  }, [batchIds, saving, router, t, isOnboarding]);

  if (loading) {
    return (
      <PageLayout maxWidth="xl">
        <div className="flex items-center gap-3 text-gray-400 py-20 justify-center">
          <span className="w-5 h-5 border-2 border-gray-600 border-t-indigo-400 rounded-full animate-spin" />
          <span className="text-sm">{t("review.loading")}</span>
        </div>
      </PageLayout>
    );
  }

  const inputCls = "bg-[#0F0F0F] border border-[#2A2A2A] rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-600";

  const flaggedCount = highAmount.size + duplicates.size;

  return (
    <PageLayout title={t("review.title")} maxWidth="xl">
      <FlowStepper labels={[t("review.stepUpload"), t("review.stepReview"), t("review.stepDone")]} />

      {/* Warm intro — frames this as Mizan showing its work, not a QA request */}
      <p className="text-gray-400 text-sm leading-relaxed mb-5 max-w-2xl">
        {t("review.introPre")} <span className="text-white font-semibold">{rows.length}</span> {t("review.introPost")}
      </p>

      {/* Summary bar — confident "this adds up to", not QA stats */}
      <div className="mb-4 p-4 rounded-xl bg-[#1A1A1A] border border-[#2A2A2A]">
        <p className="text-[11px] font-semibold tracking-wide text-gray-500 uppercase mb-2.5">{t("review.addsUpTo")}</p>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <span className="text-emerald-400 font-semibold tabular-nums text-sm flex items-center gap-1">
            <TrendingUp size={14} /> {money(income)} <span className="text-gray-500 font-normal text-xs">{t("review.income")}</span>
          </span>
          <span className="text-red-400 font-semibold tabular-nums text-sm flex items-center gap-1">
            <TrendingDown size={14} /> {money(expenses)} <span className="text-gray-500 font-normal text-xs">{t("review.expenses")}</span>
          </span>
          <span className={`font-semibold tabular-nums text-sm ${net >= 0 ? "text-white" : "text-orange-400"}`}>
            {net >= 0 ? "" : "−"}{money(Math.abs(net))} <span className="text-gray-500 font-normal text-xs">{t("review.net")}</span>
          </span>
        </div>
      </div>

      {/* Gentle heads-up when rows are flagged — guidance, not an error */}
      {flaggedCount > 0 && (
        <p className="flex items-center gap-2 text-amber-300/90 text-xs mb-3">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
          {t("review.flaggedHint")}
        </p>
      )}

      {/* Editable table — desktop / tablet */}
      <div className="hidden sm:block overflow-x-auto rounded-xl border border-[#2A2A2A]">
        <table className="w-full text-sm min-w-[720px]">
          <thead>
            <tr className="bg-[#1A1A1A] text-left text-gray-500 text-xs">
              <th className="px-3 py-2 font-medium">{t("review.colDate")}</th>
              <th className="px-3 py-2 font-medium">{t("review.colDescription")}</th>
              <th className="px-3 py-2 font-medium">{t("review.colAmount")}</th>
              <th className="px-3 py-2 font-medium">{t("review.colType")}</th>
              <th className="px-3 py-2 font-medium">{t("review.colCategory")}</th>
              <th className="px-3 py-2 font-medium w-8"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const flagged = highAmount.has(r.key) || duplicates.has(r.key);
              const tip = highAmount.has(r.key) ? t("review.suspiciousAmount")
                : duplicates.has(r.key) ? t("review.suspiciousDup") : "";
              return (
                <tr
                  key={r.key}
                  title={tip || undefined}
                  className={`border-t border-[#2A2A2A] ${flagged ? "bg-amber-950/20" : "bg-[#0F0F0F]"}`}
                >
                  <td className="px-3 py-2">
                    <input type="date" value={r.transaction_date}
                      onChange={(e) => update(r.key, { transaction_date: e.target.value })}
                      className={`${inputCls} w-[140px]`} />
                  </td>
                  <td className="px-3 py-2">
                    <input type="text" value={r.description}
                      onChange={(e) => update(r.key, { description: e.target.value })}
                      className={`${inputCls} w-full min-w-[180px]`} />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <input type="text" inputMode="decimal" value={r.amount}
                        onChange={(e) => update(r.key, { amount: e.target.value })}
                        className={`${inputCls} w-[100px] tabular-nums ${highAmount.has(r.key) ? "border-amber-700 text-amber-300" : ""}`} />
                      <span className="text-gray-600 text-xs">{r.currency}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <button
                      onClick={() => update(r.key, { transaction_type: r.transaction_type === "debit" ? "credit" : "debit" })}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                        r.transaction_type === "credit"
                          ? "bg-emerald-950/40 border-emerald-800/50 text-emerald-300"
                          : "bg-red-950/40 border-red-800/50 text-red-300"
                      }`}
                    >
                      {r.transaction_type === "credit" ? t("review.typeCredit") : t("review.typeDebit")}
                    </button>
                  </td>
                  <td className="px-3 py-2">
                    <select value={r.category ?? ""}
                      onChange={(e) => update(r.key, { category: e.target.value || null })}
                      className={`${inputCls} w-[130px]`}>
                      <option value="">{t("review.uncategorized")}</option>
                      {REVIEW_CATEGORIES.map((c) => (
                        <option key={c} value={c}>{CATEGORY_LABELS[c] || c}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <button onClick={() => remove(r.key)} title={t("review.deleteRow")}
                      className="text-gray-600 hover:text-red-400 transition-colors p-1">
                      <XIcon size={15} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Editable cards — mobile (no horizontal scroll; each tx is a card) */}
      <div className="sm:hidden space-y-3">
        {rows.map((r) => {
          const flagged = highAmount.has(r.key) || duplicates.has(r.key);
          const tip = highAmount.has(r.key) ? t("review.suspiciousAmount")
            : duplicates.has(r.key) ? t("review.suspiciousDup") : "";
          return (
            <div key={r.key}
              className={`rounded-xl border p-3 ${flagged ? "bg-amber-950/20 border-amber-800/40" : "bg-[#0F0F0F] border-[#2A2A2A]"}`}>
              {/* Date + delete */}
              <div className="flex items-center gap-2 mb-2.5">
                <input type="date" value={r.transaction_date}
                  onChange={(e) => update(r.key, { transaction_date: e.target.value })}
                  aria-label={t("review.colDate")} className={`${inputCls} flex-1`} />
                <button onClick={() => remove(r.key)} aria-label={t("review.deleteRow")}
                  className="shrink-0 text-gray-600 hover:text-red-400 transition-colors p-1.5">
                  <XIcon size={16} />
                </button>
              </div>

              {/* Description */}
              <label className="block text-[11px] text-gray-500 mb-1">{t("review.colDescription")}</label>
              <input type="text" value={r.description}
                onChange={(e) => update(r.key, { description: e.target.value })}
                className={`${inputCls} w-full mb-3`} />

              {/* Amount + type */}
              <div className="flex gap-3 mb-3">
                <div className="flex-1 min-w-0">
                  <label className="block text-[11px] text-gray-500 mb-1">{t("review.colAmount")}</label>
                  <div className="flex items-center gap-1.5">
                    <input type="text" inputMode="decimal" value={r.amount}
                      onChange={(e) => update(r.key, { amount: e.target.value })}
                      className={`${inputCls} w-full tabular-nums ${highAmount.has(r.key) ? "border-amber-700 text-amber-300" : ""}`} />
                    <span className="text-gray-600 text-xs shrink-0">{r.currency}</span>
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] text-gray-500 mb-1">{t("review.colType")}</label>
                  <button
                    onClick={() => update(r.key, { transaction_type: r.transaction_type === "debit" ? "credit" : "debit" })}
                    className={`px-3 py-2 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap ${
                      r.transaction_type === "credit"
                        ? "bg-emerald-950/40 border-emerald-800/50 text-emerald-300"
                        : "bg-red-950/40 border-red-800/50 text-red-300"
                    }`}>
                    {r.transaction_type === "credit" ? t("review.typeCredit") : t("review.typeDebit")}
                  </button>
                </div>
              </div>

              {/* Category */}
              <label className="block text-[11px] text-gray-500 mb-1">{t("review.colCategory")}</label>
              <select value={r.category ?? ""}
                onChange={(e) => update(r.key, { category: e.target.value || null })}
                className={`${inputCls} w-full`}>
                <option value="">{t("review.uncategorized")}</option>
                {REVIEW_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{CATEGORY_LABELS[c] || c}</option>
                ))}
              </select>

              {tip && <p className="text-amber-300/80 text-[11px] mt-2">{tip}</p>}
            </div>
          );
        })}
      </div>

      {/* Add row */}
      <button onClick={addRow}
        className="mt-3 inline-flex items-center gap-1.5 text-indigo-400 hover:text-indigo-300 text-sm transition-colors">
        <Plus size={15} /> {t("review.addRow")}
      </button>

      {error && <p className="text-red-400 text-sm mt-4">{error}</p>}

      {/* CTAs */}
      <div className="flex gap-3 mt-6">
        <button onClick={cancel} disabled={saving}
          className="px-5 py-3 rounded-xl bg-[#1A1A1A] border border-[#2A2A2A] hover:bg-[#2A2A2A] text-gray-300 font-semibold transition-colors disabled:opacity-50">
          {t("review.startOver")}
        </button>
        <button onClick={confirm} disabled={saving || rows.length === 0}
          className="flex-1 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 font-semibold transition-colors flex items-center justify-center gap-2">
          {saving ? (
            <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> {t("review.saving")}</>
          ) : (
            <>{t("review.confirm")} <ArrowRight size={16} /></>
          )}
        </button>
      </div>
    </PageLayout>
  );
}

export default function ReviewPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#0F0F0F]" />}>
      <ReviewContent />
    </Suspense>
  );
}
