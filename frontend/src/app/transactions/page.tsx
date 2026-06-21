"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getTransactions, getInsights, getBatches, getStoredUser, clearToken,
  getEmailPreferences, setEmailPreferences,
  type Transaction, type InsightResponse, type BatchSummary,
} from "@/lib/api";
import TransactionTable from "@/components/TransactionTable";
import SpendingChart from "@/components/SpendingChart";
import AddTransactionModal from "@/components/AddTransactionModal";
import ChatPanel from "@/components/ChatPanel";
import PageLayout from "@/components/ui/PageLayout";
import { Plus, Mail } from "@/components/ui/Icons";

type LoadState = "loading" | "ready" | "error";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("tr-TR", { day: "2-digit", month: "short", year: "numeric" });
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

  const pageActions = (
    <div className="flex items-center gap-2">
      {emailEnabled !== null && (
        <button
          onClick={handleEmailToggle}
          disabled={emailToggling}
          title="Haftalık özet e-postası"
          className={`p-2 rounded-lg border transition-colors disabled:opacity-50 ${
            emailEnabled
              ? "bg-indigo-950 border-indigo-800 text-indigo-400 hover:bg-indigo-900"
              : "bg-[#1A1A1A] border-[#2A2A2A] text-gray-500 hover:text-gray-300"
          }`}
        >
          <Mail size={16} />
        </button>
      )}
      <button
        onClick={() => setShowAddModal(true)}
        className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#1A1A1A] border border-[#2A2A2A] hover:bg-[#2A2A2A] text-sm text-gray-300 transition-colors"
      >
        <Plus size={14} />
        Ekle
      </button>
    </div>
  );

  return (
    <PageLayout title="İşlemler" subtitle={txState === "ready" ? `${transactions.length} işlem` : undefined} action={pageActions}>

      {/* Batch selector */}
      {batches.length > 0 && (
        <div className="mb-6 bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="text-sm text-gray-400">
              {!showAll && latestBatch ? (
                <>
                  <span className="text-gray-500">Son ekstre: </span>
                  <span className="text-gray-200">{formatDate(latestBatch.min_date)} – {formatDate(latestBatch.max_date)}</span>
                  <span className="text-gray-600 ml-2">· {latestBatch.transaction_count} işlem</span>
                </>
              ) : (
                <>
                  <span className="text-gray-500">Tüm ekstreler: </span>
                  <span className="text-gray-200">{batches.length} yükleme</span>
                  <span className="text-gray-600 ml-2">· {batches.reduce((s, b) => s + b.transaction_count, 0)} ham işlem</span>
                </>
              )}
            </div>
            <div className="flex items-center gap-2">
              <div className="flex rounded-lg overflow-hidden border border-[#2A2A2A] text-xs">
                <button
                  onClick={() => setShowAll(false)}
                  className={`px-3 py-1.5 transition-colors ${!showAll ? "bg-indigo-600 text-white" : "bg-[#1A1A1A] text-gray-400 hover:text-gray-300"}`}
                >
                  Son Ekstre
                </button>
                <button
                  onClick={() => setShowAll(true)}
                  className={`px-3 py-1.5 transition-colors ${showAll ? "bg-indigo-600 text-white" : "bg-[#1A1A1A] text-gray-400 hover:text-gray-300"}`}
                >
                  Tüm Ekstreler
                </button>
              </div>
              {batches.length > 1 && (
                <button
                  onClick={() => setShowBatchHistory((v) => !v)}
                  className="px-3 py-1.5 rounded-lg bg-[#1A1A1A] border border-[#2A2A2A] hover:bg-[#2A2A2A] text-xs text-gray-400 transition-colors"
                >
                  {showBatchHistory ? "Kapat" : "Geçmiş"}
                </button>
              )}
            </div>
          </div>

          {showBatchHistory && (
            <div className="mt-4 border-t border-[#2A2A2A] pt-4 space-y-1.5">
              {batches.map((b, i) => (
                <div
                  key={b.batch_id}
                  className="flex items-center justify-between text-xs text-gray-400 py-2 px-3 rounded-lg bg-[#0F0F0F]"
                >
                  <div className="flex items-center gap-2">
                    {i === 0 && (
                      <span className="px-1.5 py-0.5 rounded bg-indigo-900 text-indigo-300 text-[10px] font-medium">Son</span>
                    )}
                    <span className="text-gray-300">{formatDate(b.min_date)} – {formatDate(b.max_date)}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span>{b.transaction_count} işlem</span>
                    <span className="text-gray-600">Yüklendi: {formatDate(b.uploaded_at)}</span>
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

      {/* Transactions table */}
      {txState === "loading" && (
        <div className="space-y-2 mt-8">
          {[1,2,3,4,5].map(i => (
            <div key={i} className="h-14 bg-[#1A1A1A] rounded-xl animate-pulse" />
          ))}
        </div>
      )}
      {txState === "error" && (
        <div className="mt-8 bg-red-950/40 border border-red-900/40 rounded-xl p-6 text-center">
          <p className="text-red-400">İşlemler yüklenemedi. Backend bağlantısını kontrol edin.</p>
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
