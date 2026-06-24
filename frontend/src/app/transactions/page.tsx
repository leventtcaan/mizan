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
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="text-gray-500">
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

  const latestBatch = batches[0] ?? null;

  // The breakdown/table below cover the uploaded statement window, NOT the calendar-month
  // spine at the top. Label them explicitly so the two windows never read as one.
  const spendingPeriod = showAll
    ? t("tx.spendingAll")
    : latestBatch
      ? dateRangeLabel(latestBatch.min_date, latestBatch.max_date, lang)
      : undefined;

  const titleBadge = txState === "ready" && transactions.length > 0 ? (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-[#2C2922] text-gray-400">
      {transactions.length}
    </span>
  ) : undefined;

  const pageActions = (
    <button
      onClick={() => setShowAddModal(true)}
      className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#2C2922] hover:border-[#3C3832] hover:bg-[#1C1915] text-sm text-gray-400 hover:text-gray-200 transition-colors"
    >
      <Plus size={14} />
      {t("tx.addManual")}
    </button>
  );

  return (
    <PageLayout title={t("tx.title")} titleBadge={titleBadge} action={pageActions}>
      <MoneyTabs />

      {batches.length > 0 && (
        <div className="mb-6 bg-[#1C1915] border border-[#2C2922] rounded-xl p-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-2 text-sm min-w-0">
              <CalendarIcon />
              <span className="text-gray-500 shrink-0">
                {!showAll ? `${t("tx.latestBatch")}:` : `${t("tx.allBatches")}:`}
              </span>
              {!showAll && latestBatch ? (
                <>
                  <span className="text-gray-200 font-medium">
                    {formatDate(latestBatch.min_date, lang)} – {formatDate(latestBatch.max_date, lang)}
                  </span>
                  <span className="text-gray-600 shrink-0">·&nbsp;{latestBatch.transaction_count}</span>
                </>
              ) : (
                <>
                  <span className="text-gray-200 font-medium">{batches.length}</span>
                  <span className="text-gray-600 shrink-0">
                    ·&nbsp;{batches.reduce((s, b) => s + b.transaction_count, 0)}
                  </span>
                </>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <div className="flex rounded-full overflow-hidden border border-[#2C2922] text-xs">
                <button
                  onClick={() => setShowAll(false)}
                  className={`px-3.5 py-1.5 transition-colors font-medium ${
                    !showAll ? "bg-indigo-600 text-white" : "bg-transparent text-gray-500 hover:text-gray-300"
                  }`}
                >
                  {t("tx.latestBatch")}
                </button>
                <button
                  onClick={() => setShowAll(true)}
                  className={`px-3.5 py-1.5 transition-colors font-medium ${
                    showAll ? "bg-indigo-600 text-white" : "bg-transparent text-gray-500 hover:text-gray-300"
                  }`}
                >
                  {t("tx.allBatches")}
                </button>
              </div>
              {batches.length > 1 && (
                <button
                  onClick={() => setShowBatchHistory((v) => !v)}
                  className="px-3 py-1.5 rounded-full border border-[#2C2922] hover:border-[#3C3832] hover:bg-[#2C2922] text-xs text-gray-500 hover:text-gray-300 transition-colors"
                >
                  {showBatchHistory ? t("common.close") : t("tx.batchHistory")}
                </button>
              )}
            </div>
          </div>

          {showBatchHistory && (
            <div className="mt-4 border-t border-[#2C2922] pt-4 space-y-1.5">
              {batches.map((b, i) => (
                <div
                  key={b.batch_id}
                  className="flex items-center justify-between text-xs py-2 px-3 rounded-lg bg-[#11100E] border border-[#2C2922]"
                >
                  <div className="flex items-center gap-2">
                    {i === 0 && (
                      <span className="px-1.5 py-0.5 rounded-full bg-indigo-950 border border-indigo-900 text-indigo-400 text-[10px] font-medium">
                        {t("tx.newest")}
                      </span>
                    )}
                    <span className="text-gray-300 font-medium">
                      {formatDate(b.min_date, lang)} – {formatDate(b.max_date, lang)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-gray-600">
                    <span className="text-gray-400">{b.transaction_count}</span>
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
        <div className="bg-[#1C1915] border border-[#2C2922] rounded-2xl p-10 text-center">
          <p className="text-gray-300 text-base font-medium">{t("tx.empty")}</p>
          <p className="text-gray-500 text-sm mt-1.5 mb-5">{t("tx.uploadCTA")}</p>
          <div className="flex items-center justify-center gap-3 flex-wrap">
            <Link href="/upload" className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-sm font-medium text-white transition-colors">
              {t("nav.upload")}
            </Link>
            <button onClick={() => setShowAddModal(true)} className="px-4 py-2 rounded-lg border border-[#2C2922] hover:border-[#3C3832] text-sm text-gray-300 transition-colors">
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
        <p className="text-[11px] text-gray-600 mb-3">{t("tx.currencyNote")}</p>
      )}

      {/* Filter bar */}
      {txState === "ready" && transactions.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("tx.searchPlaceholder")}
            className="flex-1 min-w-[160px] bg-[#1C1915] border border-[#2C2922] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-600"
          />
          <div className="flex rounded-lg overflow-hidden border border-[#2C2922] text-xs">
            {(["all", "debit", "credit"] as const).map((tf) => (
              <button
                key={tf}
                onClick={() => setTypeFilter(tf)}
                className={`px-3 py-2 font-medium transition-colors ${typeFilter === tf ? "bg-indigo-600 text-white" : "text-gray-500 hover:text-gray-300"}`}
              >
                {t(`tx.filter.${tf}`)}
              </button>
            ))}
          </div>
          <select
            value={catFilter}
            onChange={(e) => setCatFilter(e.target.value)}
            className="bg-[#1C1915] border border-[#2C2922] rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none focus:border-indigo-600"
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
        <div className="space-y-px mt-4 rounded-xl overflow-hidden border border-[#2C2922]">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className={`h-14 animate-pulse ${i % 2 !== 0 ? "bg-[#13110D]" : "bg-[#11100E]"}`} />
          ))}
        </div>
      )}
      {txState === "error" && (
        <div className="mt-8 bg-red-950/40 border border-red-900/40 rounded-xl p-6 text-center">
          <p className="text-red-400 text-sm">{t("common.error")}</p>
        </div>
      )}
      {txState === "ready" && filtered.length > 0 && (
        <TransactionTable transactions={filtered} onCategoryCorrection={handleCategoryCorrection} />
      )}
      {txState === "ready" && filtered.length === 0 && transactions.length > 0 && (
        <div className="mt-4 bg-[#1C1915] border border-[#2C2922] rounded-xl p-8 text-center text-gray-500 text-sm">
          {t("tx.noMatches")}
        </div>
      )}

      {showAddModal && (
        <AddTransactionModal onClose={() => setShowAddModal(false)} onSuccess={handleTransactionAdded} />
      )}
    </PageLayout>
  );
}
