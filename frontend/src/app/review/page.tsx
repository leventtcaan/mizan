"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import PageLayout from "@/components/ui/PageLayout";
import { ArrowRight, Plus, X as XIcon, TrendingUp, TrendingDown, CheckCircle } from "@/components/ui/Icons";
import CurrencySelect from "@/components/CurrencySelect";
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

/** "Jun 1 – Jun 30" style label from two ISO dates (noon-anchored, no tz day-shift). */
function fmtRange(start: string, end: string): string {
  const fmt = (iso: string) => {
    if (!iso) return "";
    const d = new Date(`${iso}T12:00:00`);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };
  const a = fmt(start);
  const b = fmt(end);
  if (!a && !b) return "";
  return a === b ? a : `${a} – ${b}`;
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

  // Batches whose currency was NOT detected in the file — the stamped currency is an
  // inferred fallback the user must confirm before we trust it. (In the URL so a refresh
  // preserves the prompt.)
  const inferredSet = useMemo(
    () => new Set((params.get("inferred") || "").split(",").map((s) => s.trim()).filter(Boolean)),
    [params],
  );

  const [rows, setRows] = useState<EditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // For inferred batches: has the user confirmed the currency yet? Detected batches
  // are never gated. Keyed by batch_id.
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});

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

  // Currency-aware money formatter. Crypto/commodity codes (BTC, XAU) aren't valid ISO
  // currencies → Intl throws → fall back to "1,234 CODE".
  const money = useCallback((n: number, cur: string) => {
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency: cur, maximumFractionDigits: cur === "TRY" ? 0 : 2 }).format(n);
    } catch {
      return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(n)} ${cur}`;
    }
  }, []);

  // Per-batch metadata derived from the rows + the inferred set. Drives the currency
  // confidence indicator and the confirmation gate.
  const batches = useMemo(() => {
    return batchIds
      .map((bid, idx) => {
        const bRows = rows.filter((r) => r.batch_id === bid);
        const dates = bRows.map((r) => r.transaction_date).filter(Boolean).sort();
        return {
          id: bid,
          index: idx,
          count: bRows.length,
          currency: bRows[0]?.currency || "TRY",
          inferred: inferredSet.has(bid),
          start: dates[0] || "",
          end: dates[dates.length - 1] || "",
        };
      })
      .filter((b) => b.count > 0);
  }, [batchIds, rows, inferredSet]);

  // Totals are grouped by currency — never summed across currencies. Two TRY statements
  // + one BRL statement show as separate TRY and BRL totals, not one mixed number.
  const byCurrency = useMemo(() => {
    const m = new Map<string, { income: number; expenses: number }>();
    for (const r of rows) {
      const c = r.currency || "TRY";
      const cur = m.get(c) || { income: 0, expenses: 0 };
      if (r.transaction_type === "credit") cur.income += toNum(r.amount);
      else cur.expenses += toNum(r.amount);
      m.set(c, cur);
    }
    return [...m.entries()]
      .map(([currency, v]) => ({ currency, income: v.income, expenses: v.expenses, net: v.income - v.expenses }))
      .sort((a, b) => a.currency.localeCompare(b.currency));
  }, [rows]);

  // A batch's currency is "settled" if it was detected in the file, or the user has
  // confirmed the inferred fallback. Unsettled inferred batches block the CTA.
  const pendingCurrency = batches.some((b) => b.inferred && !confirmed[b.id]);

  const changeBatchCurrency = useCallback((bid: string, code: string) => {
    setRows((prev) => prev.map((r) => (r.batch_id === bid ? { ...r, currency: code } : r)));
  }, []);
  const confirmBatchCurrency = useCallback((bid: string) => {
    setConfirmed((prev) => ({ ...prev, [bid]: true }));
  }, []);
  const reopenBatchCurrency = useCallback((bid: string) => {
    setConfirmed((prev) => ({ ...prev, [bid]: false }));
  }, []);

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

  const confirm = useCallback(async () => {
    if (saving) return;
    // Confirm the currency of every inferred statement before anything is trusted.
    if (pendingCurrency) { setError(t("review.currencyConfirmHint")); return; }
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
  }, [rows, batchIds, saving, router, t, isOnboarding, pendingCurrency]);

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

  const inputCls = "bg-[#11100E] border border-[#2C2922] rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-600";

  const flaggedCount = highAmount.size + duplicates.size;

  return (
    <PageLayout title={t("review.title")} maxWidth="xl">
      <FlowStepper labels={[t("review.stepUpload"), t("review.stepReview"), t("review.stepDone")]} />

      {/* Warm intro — frames this as Mizan showing its work, not a QA request */}
      <p className="text-gray-400 text-sm leading-relaxed mb-5 max-w-2xl">
        {t("review.introPre")} <span className="text-white font-semibold">{rows.length}</span> {t("review.introPost")}
      </p>

      {/* Currency confidence + confirmation — make it obvious what was detected vs assumed,
          and force a choice when the file revealed no currency. */}
      <div className="mb-4 space-y-2">
        {batches.map((b) => {
          const settled = !b.inferred || confirmed[b.id];
          const rangeLabel = fmtRange(b.start, b.end);
          const stmtLabel = batches.length > 1
            ? `${t("review.statementLabel")} ${b.index + 1}${rangeLabel ? ` · ${rangeLabel}` : ""}`
            : rangeLabel;

          // Inferred + not yet confirmed → the confirmation step.
          if (b.inferred && !confirmed[b.id]) {
            return (
              <div key={b.id} className="p-4 rounded-xl bg-amber-950/25 border border-amber-800/40">
                <div className="flex items-center gap-2 mb-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                  <p className="text-amber-200 text-sm font-semibold">{t("review.currencyConfirmTitle")}</p>
                </div>
                {stmtLabel && <p className="text-amber-300/70 text-xs mb-2.5 pl-3.5">{stmtLabel}</p>}
                <p className="text-gray-400 text-sm mb-3 pl-3.5">{t("review.currencyConfirmPrompt")}</p>
                <div className="flex flex-wrap items-center gap-2 pl-3.5">
                  <div className="w-44">
                    <CurrencySelect value={b.currency} onChange={(code) => changeBatchCurrency(b.id, code)} />
                  </div>
                  <button
                    onClick={() => confirmBatchCurrency(b.id)}
                    className="px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors"
                  >
                    {t("review.currencyConfirmBtn")}
                  </button>
                </div>
              </div>
            );
          }

          // Settled → a compact confidence badge. Detected vs (inferred &) confirmed.
          return (
            <div key={b.id} className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-[#1C1915] border border-[#2C2922] text-xs">
              <CheckCircle size={14} className="text-emerald-400 shrink-0" />
              <span className="text-gray-400">{t("review.currencyLabel")}:</span>
              <span className="text-white font-semibold">{b.currency}</span>
              <span className="text-gray-600">
                · {b.inferred ? t("review.currencyConfirmed") : t("review.currencyDetected")}
              </span>
              {stmtLabel && <span className="text-gray-600 truncate">· {stmtLabel}</span>}
              {b.inferred && settled && (
                <button
                  onClick={() => reopenBatchCurrency(b.id)}
                  className="ml-auto text-indigo-400 hover:text-indigo-300 transition-colors shrink-0"
                >
                  {t("review.currencyChange")}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Summary bar — per currency, never mixed into one number */}
      <div className="mb-4 p-4 rounded-xl bg-[#1C1915] border border-[#2C2922]">
        <p className="text-[11px] font-semibold tracking-wide text-gray-500 uppercase mb-2.5">{t("review.addsUpTo")}</p>
        <div className="space-y-2.5">
          {byCurrency.map((c) => (
            <div key={c.currency} className="flex flex-wrap items-center gap-x-6 gap-y-2">
              {byCurrency.length > 1 && (
                <span className="text-[11px] font-semibold text-gray-400 bg-[#11100E] border border-[#2C2922] rounded px-1.5 py-0.5">{c.currency}</span>
              )}
              <span className="text-emerald-400 font-semibold tabular-nums text-sm flex items-center gap-1">
                <TrendingUp size={14} /> {money(c.income, c.currency)} <span className="text-gray-500 font-normal text-xs">{t("review.income")}</span>
              </span>
              <span className="text-red-400 font-semibold tabular-nums text-sm flex items-center gap-1">
                <TrendingDown size={14} /> {money(c.expenses, c.currency)} <span className="text-gray-500 font-normal text-xs">{t("review.expenses")}</span>
              </span>
              <span className={`font-semibold tabular-nums text-sm ${c.net >= 0 ? "text-white" : "text-orange-400"}`}>
                {c.net >= 0 ? "" : "−"}{money(Math.abs(c.net), c.currency)} <span className="text-gray-500 font-normal text-xs">{t("review.net")}</span>
              </span>
            </div>
          ))}
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
      <div className="hidden sm:block overflow-x-auto rounded-xl border border-[#2C2922]">
        <table className="w-full text-sm min-w-[720px]">
          <thead>
            <tr className="bg-[#1C1915] text-left text-gray-500 text-xs">
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
                  className={`border-t border-[#2C2922] ${flagged ? "bg-amber-950/20" : "bg-[#11100E]"}`}
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
              className={`rounded-xl border p-3 ${flagged ? "bg-amber-950/20 border-amber-800/40" : "bg-[#11100E] border-[#2C2922]"}`}>
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
          className="px-5 py-3 rounded-xl bg-[#1C1915] border border-[#2C2922] hover:bg-[#2C2922] text-gray-300 font-semibold transition-colors disabled:opacity-50">
          {t("review.startOver")}
        </button>
        <button onClick={confirm} disabled={saving || rows.length === 0 || pendingCurrency}
          title={pendingCurrency ? t("review.currencyConfirmHint") : undefined}
          className="flex-1 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed font-semibold transition-colors flex items-center justify-center gap-2">
          {saving ? (
            <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> {t("review.saving")}</>
          ) : (
            <>{t("review.confirm")} <ArrowRight size={16} /></>
          )}
        </button>
      </div>
      {pendingCurrency && (
        <p className="text-amber-300/80 text-xs mt-2 text-right">{t("review.currencyConfirmHint")}</p>
      )}
    </PageLayout>
  );
}

export default function ReviewPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#11100E]" />}>
      <ReviewContent />
    </Suspense>
  );
}
