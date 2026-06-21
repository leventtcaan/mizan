"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getTransactions, getInsights, getBatches, getStoredUser,
  getEmailPreferences, setEmailPreferences,
  type Transaction, type InsightResponse, type BatchSummary,
} from "@/lib/api";
import TransactionTable from "@/components/TransactionTable";
import SpendingChart from "@/components/SpendingChart";
import AddTransactionModal from "@/components/AddTransactionModal";
import ChatPanel from "@/components/ChatPanel";
import PageLayout from "@/components/ui/PageLayout";
import { Plus } from "@/components/ui/Icons";

type LoadState = "loading" | "ready" | "error";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("tr-TR", { day: "2-digit", month: "short", year: "numeric" });
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

function EmailToggle({
  enabled,
  toggling,
  onToggle,
}: {
  enabled: boolean;
  toggling: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center gap-3 bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl px-4 py-2.5">
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-gray-300 leading-none">Haftalık Özet E-postası</p>
        <p className="text-[10px] text-gray-600 mt-0.5">Her Pazartesi gelen kutunuza</p>
      </div>
      <button
        onClick={onToggle}
        disabled={toggling}
        className={`relative shrink-0 w-10 h-5 rounded-full transition-colors duration-200 disabled:opacity-50 focus:outline-none ${
          enabled ? "bg-indigo-600" : "bg-[#2A2A2A]"
        }`}
        title={enabled ? "E-posta özetini kapat" : "E-posta özetini aç"}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200 ${
            enabled ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </button>
      <span className={`text-xs font-medium w-10 shrink-0 ${enabled ? "text-indigo-400" : "text-gray-600"}`}>
        {enabled ? "Açık" : "Kapalı"}
      </span>
    </div>
  );
}

export default function TransactionsPage() {
  const router = useRouter();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [insight, setInsight] = useState<InsightResponse | null>(null);
  const [txState, setTxState] = useState<LoadState>("loading");
  const [insightState, setInsightState] = useState<LoadState>("loading");
  const [showAll, setShowAll] = useState(false);
  const [showBatchHistory, setShowBatchHistory] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [emailEnabled, setEmailEnabled] = useState<boolean | null>(null);
  const [emailToggling, setEmailToggling] = useState(false);

  useEffect(() => {
    const user = getStoredUser();
    if (!user) { router.replace("/login"); return; }

    getBatches().then(setBatches).catch(() => {});

    getEmailPreferences()
      .then((prefs) => setEmailEnabled(prefs.email_weekly_enabled))
      .catch(() => {});

    getInsights()
      .then((data) => { setInsight(data); setInsightState("ready"); })
      .catch(() => setInsightState("error"));
  }, []);

  useEffect(() => {
    setTxState("loading");
    getTransactions(showAll)
      .then((data) => { setTransactions(data); setTxState("ready"); })
      .catch(() => setTxState("error"));
  }, [showAll]);

  const handleCategoryCorrection = (txId: string, newCategory: string) => {
    setTransactions((prev) =>
      prev.map((t) => (t.id === txId ? { ...t, category: newCategory } : t))
    );
  };

  const handleEmailToggle = async () => {
    if (emailEnabled === null || emailToggling) return;
    const next = !emailEnabled;
    setEmailToggling(true);
    try {
      await setEmailPreferences(next);
      setEmailEnabled(next);
    } catch {
      // silent
    } finally {
      setEmailToggling(false);
    }
  };

  const handleTransactionAdded = (tx: Transaction) => {
    setTransactions((prev) => [tx, ...prev]);
    setShowAddModal(false);
    getBatches().then(setBatches).catch(() => {});
  };

  const latestBatch = batches[0] ?? null;

  // Transaction count badge
  const titleBadge = txState === "ready" && transactions.length > 0 ? (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-[#2A2A2A] text-gray-400">
      {transactions.length}
    </span>
  ) : undefined;

  // Page-level actions: outlined "+ Ekle" only
  const pageActions = (
    <button
      onClick={() => setShowAddModal(true)}
      className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#2A2A2A] hover:border-[#3A3A3A] hover:bg-[#1A1A1A] text-sm text-gray-400 hover:text-gray-200 transition-colors"
    >
      <Plus size={14} />
      Manuel Ekle
    </button>
  );

  return (
    <PageLayout title="İşlemler" titleBadge={titleBadge} action={pageActions}>

      {/* Email preference toggle card */}
      {emailEnabled !== null && (
        <div className="mb-5">
          <EmailToggle
            enabled={emailEnabled}
            toggling={emailToggling}
            onToggle={handleEmailToggle}
          />
        </div>
      )}

      {/* Batch selector */}
      {batches.length > 0 && (
        <div className="mb-6 bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            {/* Info side */}
            <div className="flex items-center gap-2 text-sm min-w-0">
              <CalendarIcon />
              <span className="text-gray-500 shrink-0">
                {!showAll ? "Son ekstre:" : "Tüm ekstreler:"}
              </span>
              {!showAll && latestBatch ? (
                <>
                  <span className="text-gray-200 font-medium">
                    {formatDate(latestBatch.min_date)} – {formatDate(latestBatch.max_date)}
                  </span>
                  <span className="text-gray-600 shrink-0">·&nbsp;{latestBatch.transaction_count} işlem</span>
                </>
              ) : (
                <>
                  <span className="text-gray-200 font-medium">{batches.length} yükleme</span>
                  <span className="text-gray-600 shrink-0">
                    ·&nbsp;{batches.reduce((s, b) => s + b.transaction_count, 0)} ham işlem
                  </span>
                </>
              )}
            </div>

            {/* Controls */}
            <div className="flex items-center gap-2 shrink-0">
              <div className="flex rounded-full overflow-hidden border border-[#2A2A2A] text-xs">
                <button
                  onClick={() => setShowAll(false)}
                  className={`px-3.5 py-1.5 transition-colors font-medium ${
                    !showAll
                      ? "bg-indigo-600 text-white"
                      : "bg-transparent text-gray-500 hover:text-gray-300"
                  }`}
                >
                  Son Ekstre
                </button>
                <button
                  onClick={() => setShowAll(true)}
                  className={`px-3.5 py-1.5 transition-colors font-medium ${
                    showAll
                      ? "bg-indigo-600 text-white"
                      : "bg-transparent text-gray-500 hover:text-gray-300"
                  }`}
                >
                  Tüm Ekstreler
                </button>
              </div>
              {batches.length > 1 && (
                <button
                  onClick={() => setShowBatchHistory((v) => !v)}
                  className="px-3 py-1.5 rounded-full border border-[#2A2A2A] hover:border-[#3A3A3A] hover:bg-[#2A2A2A] text-xs text-gray-500 hover:text-gray-300 transition-colors"
                >
                  {showBatchHistory ? "Kapat" : "Geçmiş"}
                </button>
              )}
            </div>
          </div>

          {/* Batch history list */}
          {showBatchHistory && (
            <div className="mt-4 border-t border-[#2A2A2A] pt-4 space-y-1.5">
              {batches.map((b, i) => (
                <div
                  key={b.batch_id}
                  className="flex items-center justify-between text-xs py-2 px-3 rounded-lg bg-[#0F0F0F] border border-[#2A2A2A]"
                >
                  <div className="flex items-center gap-2">
                    {i === 0 && (
                      <span className="px-1.5 py-0.5 rounded-full bg-indigo-950 border border-indigo-900 text-indigo-400 text-[10px] font-medium">
                        Son
                      </span>
                    )}
                    <span className="text-gray-300 font-medium">
                      {formatDate(b.min_date)} – {formatDate(b.max_date)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-gray-600">
                    <span className="text-gray-400">{b.transaction_count} işlem</span>
                    <span>Yüklendi: {formatDate(b.uploaded_at)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Chat coach */}
      {insightState === "loading" && (
        <div className="mb-8 bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl flex items-center justify-center" style={{ height: 380 }}>
          <p className="text-gray-600 text-sm animate-pulse">Koç hazırlanıyor...</p>
        </div>
      )}
      {insightState !== "loading" && (
        <ChatPanel initialInsight={insight?.insight ?? null} />
      )}

      {/* Spending chart */}
      {txState === "ready" && transactions.length > 0 && (
        <SpendingChart transactions={transactions} />
      )}

      {/* Transaction table */}
      {txState === "loading" && (
        <div className="space-y-px mt-8 rounded-xl overflow-hidden border border-[#2A2A2A]">
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className={`h-14 animate-pulse ${i % 2 !== 0 ? "bg-[#111]" : "bg-[#0F0F0F]"}`}
            />
          ))}
        </div>
      )}
      {txState === "error" && (
        <div className="mt-8 bg-red-950/40 border border-red-900/40 rounded-xl p-6 text-center">
          <p className="text-red-400 text-sm">İşlemler yüklenemedi. Backend bağlantısını kontrol edin.</p>
        </div>
      )}
      {txState === "ready" && (
        <TransactionTable
          transactions={transactions}
          onCategoryCorrection={handleCategoryCorrection}
        />
      )}

      {showAddModal && (
        <AddTransactionModal
          onClose={() => setShowAddModal(false)}
          onSuccess={handleTransactionAdded}
        />
      )}
    </PageLayout>
  );
}
