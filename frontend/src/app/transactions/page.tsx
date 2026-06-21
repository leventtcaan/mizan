"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  getTransactions, getInsights, getBatches, getStoredUser, clearToken,
  getEmailPreferences, setEmailPreferences,
  type Transaction, type InsightResponse, type BatchSummary,
} from "@/lib/api";
import TransactionTable from "@/components/TransactionTable";
import SpendingChart from "@/components/SpendingChart";
import AddTransactionModal from "@/components/AddTransactionModal";
import ChatPanel from "@/components/ChatPanel";

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
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [showBatchHistory, setShowBatchHistory] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [emailEnabled, setEmailEnabled] = useState<boolean | null>(null);
  const [emailToggling, setEmailToggling] = useState(false);

  useEffect(() => {
    const user = getStoredUser();
    if (!user) { router.replace("/login"); return; }
    setUserEmail(user.email);

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

  const handleLogout = () => { clearToken(); router.push("/login"); };

  const handleEmailToggle = async () => {
    if (emailEnabled === null || emailToggling) return;
    const next = !emailEnabled;
    setEmailToggling(true);
    try {
      await setEmailPreferences(next);
      setEmailEnabled(next);
    } catch {
      // silent — button reverts to previous state
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

  return (
    <main className="min-h-screen bg-gray-950 text-white px-4 py-10">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <Link href="/" className="text-gray-500 text-sm hover:text-gray-300 transition-colors">
              ← Mizan
            </Link>
            <h1 className="text-3xl font-bold mt-4">İşlemler</h1>
            {txState === "ready" && (
              <p className="text-gray-400 text-sm mt-1">{transactions.length} işlem</p>
            )}
          </div>
          <div className="flex items-center gap-3">
            {userEmail && (
              <span className="text-gray-500 text-xs hidden sm:block">{userEmail}</span>
            )}
            <button
              onClick={handleLogout}
              className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm text-gray-300 transition-colors"
            >
              Çıkış
            </button>
            {emailEnabled !== null && (
              <button
                onClick={handleEmailToggle}
                disabled={emailToggling}
                title="Haftalık özet e-postası"
                className={`px-3 py-1.5 rounded-lg text-sm transition-colors disabled:opacity-50 ${
                  emailEnabled
                    ? "bg-indigo-900 hover:bg-indigo-800 text-indigo-300"
                    : "bg-gray-800 hover:bg-gray-700 text-gray-500"
                }`}
              >
                {emailEnabled ? "📧 E-posta Açık" : "📧 E-posta Kapalı"}
              </button>
            )}
            <Link
              href="/installments"
              className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm text-gray-300 transition-colors"
            >
              Taksitler
            </Link>
            <Link
              href="/subscriptions"
              className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm text-gray-300 transition-colors"
            >
              Abonelikler
            </Link>
            <Link
              href="/progress"
              className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm text-gray-300 transition-colors"
            >
              İlerleme
            </Link>
            <button
              onClick={() => setShowAddModal(true)}
              className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm text-gray-300 transition-colors"
            >
              + Ekle
            </button>
            <Link
              href="/upload"
              className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-sm font-medium transition-colors"
            >
              + Ekstre Yükle
            </Link>
          </div>
        </div>

        {/* Batch indicator + toggle */}
        {batches.length > 0 && (
          <div className="mb-6 p-4 rounded-xl bg-gray-900 border border-gray-800">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="text-sm">
                {!showAll && latestBatch ? (
                  <span className="text-gray-300">
                    <span className="text-gray-500">Son ekstre: </span>
                    {formatDate(latestBatch.min_date)} – {formatDate(latestBatch.max_date)}
                    <span className="text-gray-500 ml-2">· {latestBatch.transaction_count} işlem</span>
                  </span>
                ) : (
                  <span className="text-gray-300">
                    <span className="text-gray-500">Tüm ekstreler: </span>
                    {batches.length} yükleme
                    <span className="text-gray-500 ml-2">· toplam {batches.reduce((s, b) => s + b.transaction_count, 0)} ham işlem</span>
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <div className="flex rounded-lg overflow-hidden border border-gray-700 text-xs">
                  <button
                    onClick={() => setShowAll(false)}
                    className={`px-3 py-1.5 transition-colors ${!showAll ? "bg-indigo-600 text-white" : "bg-gray-800 text-gray-400 hover:text-gray-300"}`}
                  >
                    Son Ekstre
                  </button>
                  <button
                    onClick={() => setShowAll(true)}
                    className={`px-3 py-1.5 transition-colors ${showAll ? "bg-indigo-600 text-white" : "bg-gray-800 text-gray-400 hover:text-gray-300"}`}
                  >
                    Tüm Ekstreler
                  </button>
                </div>
                {batches.length > 1 && (
                  <button
                    onClick={() => setShowBatchHistory((v) => !v)}
                    className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-xs text-gray-400 transition-colors"
                  >
                    {showBatchHistory ? "Kapat" : "Geçmiş"}
                  </button>
                )}
              </div>
            </div>

            {showBatchHistory && (
              <div className="mt-4 border-t border-gray-800 pt-4 space-y-2">
                {batches.map((b, i) => (
                  <div
                    key={b.batch_id}
                    className="flex items-center justify-between text-xs text-gray-400 py-1.5 px-2 rounded-lg bg-gray-950"
                  >
                    <div className="flex items-center gap-2">
                      {i === 0 && (
                        <span className="px-1.5 py-0.5 rounded bg-indigo-900 text-indigo-300 text-[10px]">Son</span>
                      )}
                      <span className="text-gray-300">
                        {formatDate(b.min_date)} – {formatDate(b.max_date)}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span>{b.transaction_count} işlem</span>
                      <span className="text-gray-600">
                        Yüklendi: {formatDate(b.uploaded_at)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Conversational coach — mounts once insight state is settled to avoid flicker */}
        {insightState === "loading" && (
          <div className="mb-8 rounded-xl bg-gray-900 border border-gray-800 flex items-center justify-center" style={{ height: 420 }}>
            <p className="text-gray-600 text-sm animate-pulse">Koç hazırlanıyor...</p>
          </div>
        )}
        {insightState !== "loading" && (
          <ChatPanel initialInsight={insight?.insight ?? null} />
        )}

        {txState === "ready" && transactions.length > 0 && (
          <SpendingChart transactions={transactions} />
        )}

        {txState === "loading" && (
          <p className="text-center text-gray-500 py-16 animate-pulse">Yükleniyor...</p>
        )}
        {txState === "error" && (
          <p className="text-center text-red-400 py-16">
            İşlemler yüklenemedi. Backend bağlantısını kontrol edin.
          </p>
        )}
        {txState === "ready" && (
          <TransactionTable
            transactions={transactions}
            onCategoryCorrection={handleCategoryCorrection}
          />
        )}
      </div>

      {showAddModal && (
        <AddTransactionModal
          onClose={() => setShowAddModal(false)}
          onSuccess={handleTransactionAdded}
        />
      )}
    </main>
  );
}
