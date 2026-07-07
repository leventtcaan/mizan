"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  getTransactions, getBatches, getStoredUser,
  type Transaction, type BatchSummary,
} from "@/lib/api";
import TransactionTable from "@/components/TransactionTable";
import SpendingChart from "@/components/SpendingChart";
import AddTransactionModal from "@/components/AddTransactionModal";
import PageLayout from "@/components/ui/PageLayout";
import MoneyTabs from "@/components/ui/MoneyTabs";
import { CATEGORY_COLORS } from "@/lib/categories";
import { Plus } from "@/components/ui/Icons";
import { useLanguage } from "@/lib/i18n";
import { dateRangeLabel } from "@/lib/period";

type LoadState = "loading" | "ready" | "error";

function formatDate(iso: string, lang: string): string {
  return new Date(iso).toLocaleDateString(lang === "tr" ? "tr-TR" : undefined, { day: "2-digit", month: "short", year: "numeric" });
}

function CalendarIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="text-ink-mute">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

const TX_CATEGORIES = [
  "market", "restoran", "ulasim", "eglence", "saglik", "fatura",
  "giyim", "nakit_atm", "transfer", "iade", "vergi", "teknoloji", "diger",
];

export default function TransactionsPage() {
  const { t, lang } = useLanguage();
  const router = useRouter();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [txState, setTxState] = useState<LoadState>("loading");
  const [showAll, setShowAll] = useState(false);
  const [showBatchHistory, setShowBatchHistory] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  // Filters
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "debit" | "credit">("all");
  const [catFilter, setCatFilter] = useState<string>("all");

  useEffect(() => {
    const user = getStoredUser();
    if (!user) { router.replace("/login"); return; }
    getBatches().then(setBatches).catch(() => {});
  }, []);

  useEffect(() => {
    setTxState("loading");
    getTransactions(showAll)
      .then((data) => { setTransactions(data); setTxState("ready"); })
      .catch(() => setTxState("error"));
  }, [showAll]);

  // Refresh after the global assistant confirms an action (e.g. re-categorize).
  useEffect(() => {
    const handler = () => {
      getTransactions(showAll).then(setTransactions).catch(() => {});
    };
    window.addEventListener("mizan-data-changed", handler);
    return () => window.removeEventListener("mizan-data-changed", handler);
  }, [showAll]);

  const handleCategoryCorrection = (txId: string, newCategory: string) => {
    setTransactions((prev) => prev.map((tx) => (tx.id === txId ? { ...tx, category: newCategory } : tx)));
  };

  const filtered = transactions.filter((tx) => {
    if (typeFilter !== "all" && tx.transaction_type !== typeFilter) return false;
    if (catFilter !== "all" && (tx.category ?? "diger") !== catFilter) return false;
    if (search.trim() && !tx.description.toLowerCase().includes(search.trim().toLowerCase())) return false;
    return true;
  });

  const handleTransactionAdded = (tx: Transaction) => {
    setTransactions((prev) => [tx, ...prev]);
    setShowAddModal(false);
    getBatches().then(setBatches).catch(() => {});
  };

  const handleTransactionEdited = (tx: Transaction) => {
    setTransactions((prev) => prev.map((t2) => (t2.id === tx.id ? tx : t2)));
    setEditingTx(null);
  };

  const handleTransactionDeleted = (txId: string) => {
    setTransactions((prev) => prev.filter((t2) => t2.id !== txId));
  };

  const latestBatch = batches[0] ?? null;

  // The breakdown/table below cover the uploaded statement window, NOT the calendar-month
  // spine at the top. Label them explicitly (prefixed "Statement period") so the two
  // windows never read as one.
  const spendingPeriod = showAll
    ? t("tx.spendingAll")
    : latestBatch
      ? `${t("tx.statementPeriod")} · ${dateRangeLabel(latestBatch.min_date, latestBatch.max_date, lang)}`
      : undefined;

  const titleBadge = txState === "ready" && transactions.length > 0 ? (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-[#176B5B] text-white tabular-nums">
      {transactions.length}
    </span>
  ) : undefined;

  const pageActions = (
    <button
      onClick={() => setShowAddModal(true)}
      className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#176B5B] hover:bg-[#125848] text-sm font-semibold text-white shadow-sm transition-colors"
    >
      <Plus size={15} />
      {t("tx.addManual")}
    </button>
  );

  return (
    <PageLayout title={t("tx.title")} titleBadge={titleBadge} action={pageActions}>
      <MoneyTabs />

      {batches.length > 0 && (
        <div className="mb-6 bg-surface border border-line rounded-xl p-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-2 text-sm min-w-0">
              <CalendarIcon />
              <span className="text-ink-mute shrink-0">
                {!showAll ? `${t("tx.latestBatch")}:` : `${t("tx.allBatches")}:`}
              </span>
              {!showAll && latestBatch ? (
                <>
                  <span className="text-ink-soft font-medium">
                    {formatDate(latestBatch.min_date, lang)} – {formatDate(latestBatch.max_date, lang)}
                  </span>
                  <span className="text-ink-mute shrink-0">·&nbsp;{latestBatch.transaction_count}</span>
                </>
              ) : (
                <>
                  <span className="text-ink-soft font-medium">{batches.length}</span>
                  <span className="text-ink-mute shrink-0">
                    ·&nbsp;{batches.reduce((s, b) => s + b.transaction_count, 0)}
                  </span>
                </>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <div className="flex rounded-full overflow-hidden border border-line text-xs">
                <button
                  onClick={() => setShowAll(false)}
                  className={`px-3.5 py-1.5 transition-colors font-medium ${
                    !showAll ? "bg-[#176B5B] text-white" : "bg-transparent text-ink-mute hover:text-ink-soft"
                  }`}
                >
                  {t("tx.latestBatch")}
                </button>
                <button
                  onClick={() => setShowAll(true)}
                  className={`px-3.5 py-1.5 transition-colors font-medium ${
                    showAll ? "bg-[#176B5B] text-white" : "bg-transparent text-ink-mute hover:text-ink-soft"
                  }`}
                >
                  {t("tx.allBatches")}
                </button>
              </div>
              {batches.length > 1 && (
                <button
                  onClick={() => setShowBatchHistory((v) => !v)}
                  className="px-3 py-1.5 rounded-full border border-line hover:border-[#176B5B] hover:bg-surface-2 text-xs text-ink-mute hover:text-ink-soft transition-colors"
                >
                  {showBatchHistory ? t("common.close") : t("tx.batchHistory")}
                </button>
              )}
            </div>
          </div>

          {showBatchHistory && (
            <div className="mt-4 border-t border-line pt-4 space-y-1.5">
              {batches.map((b, i) => (
                <div
                  key={b.batch_id}
                  className="flex items-center justify-between text-xs py-2 px-3 rounded-lg bg-canvas border border-line"
                >
                  <div className="flex items-center gap-2">
                    {i === 0 && (
                      <span className="px-1.5 py-0.5 rounded-full bg-[#176B5B]/10 border border-[#176B5B]/20 text-[#176B5B] text-[10px] font-semibold">
                        {t("tx.newest")}
                      </span>
                    )}
                    <span className="text-ink-soft font-medium">
                      {formatDate(b.min_date, lang)} – {formatDate(b.max_date, lang)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-ink-mute">
                    <span className="text-ink-mute">{b.transaction_count}</span>
                    <span>{formatDate(b.uploaded_at, lang)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Empty state — brand-new account, no transactions yet */}
      {txState === "ready" && transactions.length === 0 && (
        <div className="bg-surface border border-line rounded-2xl p-10 text-center">
          <p className="text-ink-soft text-base font-medium">{t("tx.empty")}</p>
          <p className="text-ink-mute text-sm mt-1.5 mb-5">{t("tx.uploadCTA")}</p>
          <div className="flex items-center justify-center gap-3 flex-wrap">
            <Link href="/upload" className="px-4 py-2 rounded-lg bg-[#176B5B] hover:bg-[#125848] text-sm font-semibold text-white transition-colors">
              {t("nav.upload")}
            </Link>
            <button onClick={() => setShowAddModal(true)} className="px-4 py-2 rounded-lg border border-line hover:border-[#176B5B] hover:text-[#176B5B] text-sm text-ink-soft transition-colors">
              {t("tx.addManual")}
            </button>
          </div>
        </div>
      )}

      {txState === "ready" && transactions.length > 0 && (
        <SpendingChart transactions={transactions} periodLabel={spendingPeriod} />
      )}

      {/* Currency note: uploaded transactions are recorded in their stored currency (default TRY). */}
      {txState === "ready" && transactions.length > 0 && (
        <p className="text-[11px] text-ink-mute mb-3">{t("tx.currencyNote")}</p>
      )}

      {/* Filter bar */}
      {txState === "ready" && transactions.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("tx.searchPlaceholder")}
            className="flex-1 min-w-[160px] bg-surface border border-line rounded-lg px-3 py-2 text-sm text-ink placeholder:text-ink-mute focus:outline-none focus:border-[#176B5B] focus:ring-2 focus:ring-[#176B5B]/20 transition-shadow"
          />
          <div className="flex rounded-lg overflow-hidden border border-line text-xs">
            {(["all", "debit", "credit"] as const).map((tf) => (
              <button
                key={tf}
                onClick={() => setTypeFilter(tf)}
                className={`px-3 py-2 font-medium transition-colors ${typeFilter === tf ? "bg-[#176B5B] text-white" : "text-ink-mute hover:text-ink-soft"}`}
              >
                {t(`tx.filter.${tf}`)}
              </button>
            ))}
          </div>
          <select
            value={catFilter}
            onChange={(e) => setCatFilter(e.target.value)}
            className="bg-surface border border-line rounded-lg px-3 py-2 text-sm text-ink-soft focus:outline-none focus:border-[#176B5B]"
          >
            <option value="all">{t("tx.filter.allCategories")}</option>
            {TX_CATEGORIES.map((c) => (
              <option key={c} value={c} style={{ color: CATEGORY_COLORS[c] }}>
                {t(`category.${c}`) !== `category.${c}` ? t(`category.${c}`) : c}
              </option>
            ))}
          </select>
        </div>
      )}

      {txState === "loading" && (
        <div className="space-y-px mt-4 rounded-xl overflow-hidden border border-line">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-14 animate-pulse bg-surface-2" />
          ))}
        </div>
      )}
      {txState === "error" && (
        <div className="mt-8 bg-neg/10 border border-neg/30 rounded-xl p-6 text-center">
          <p className="text-neg text-sm">{t("common.error")}</p>
        </div>
      )}
      {txState === "ready" && filtered.length > 0 && (
        <TransactionTable
          transactions={filtered}
          onCategoryCorrection={handleCategoryCorrection}
          onEdit={setEditingTx}
          onDeleted={handleTransactionDeleted}
        />
      )}
      {txState === "ready" && filtered.length === 0 && transactions.length > 0 && (
        <div className="mt-4 bg-surface border border-line rounded-xl p-8 text-center text-ink-mute text-sm">
          {t("tx.noMatches")}
        </div>
      )}

      {editingTx && (
        <AddTransactionModal editData={editingTx} onClose={() => setEditingTx(null)} onSuccess={handleTransactionEdited} />
      )}
      {showAddModal && (
        <AddTransactionModal onClose={() => setShowAddModal(false)} onSuccess={handleTransactionAdded} />
      )}
    </PageLayout>
  );
}
