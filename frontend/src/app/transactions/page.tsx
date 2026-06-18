"use client";

/**
 * WHAT: Transaction list page — fetches and displays categorized transactions + coaching insight.
 * WHY: First screen where users see the output of the upload + LLM pipeline.
 * BREAKS IF REMOVED: No way to view processed transactions after upload.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getTransactions, getInsights, getStoredUser, clearToken, type Transaction, type InsightResponse } from "@/lib/api";
import TransactionTable from "@/components/TransactionTable";
import SpendingChart from "@/components/SpendingChart";

type LoadState = "loading" | "ready" | "error";

export default function TransactionsPage() {
  const router = useRouter();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [insight, setInsight] = useState<InsightResponse | null>(null);
  const [txState, setTxState] = useState<LoadState>("loading");
  const [insightState, setInsightState] = useState<LoadState>("loading");
  const [userEmail, setUserEmail] = useState<string | null>(null);

  useEffect(() => {
    const user = getStoredUser();
    if (!user) {
      router.replace("/login");
      return;
    }
    setUserEmail(user.email);

    getTransactions()
      .then((data) => { setTransactions(data); setTxState("ready"); })
      .catch(() => setTxState("error"));


    getInsights()
      .then((data) => { setInsight(data); setInsightState("ready"); })
      .catch(() => setInsightState("error"));
  }, []);

  const handleCategoryCorrection = (txId: string, newCategory: string) => {
    setTransactions((prev) =>
      prev.map((t) => (t.id === txId ? { ...t, category: newCategory } : t))
    );
  };

  const handleLogout = () => {
    clearToken();
    router.push("/login");
  };

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
              <p className="text-gray-400 text-sm mt-1">{transactions.length} işlem bulundu</p>
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
            <Link
              href="/upload"
              className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-sm font-medium transition-colors"
            >
              + Ekstre Yükle
            </Link>
          </div>
        </div>

        <div className="mb-8 p-5 rounded-xl bg-gray-900 border border-gray-800">
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-2 font-semibold">
            Davranışsal Analiz
          </p>
          {insightState === "loading" && (
            <p className="text-gray-400 text-sm animate-pulse">Analiz yapılıyor...</p>
          )}
          {insightState === "ready" && insight && (
            <p className="text-gray-200 text-sm leading-relaxed">{insight.insight}</p>
          )}
          {insightState === "error" && (
            <p className="text-gray-500 text-sm">Analiz yüklenemedi.</p>
          )}
        </div>

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
    </main>
  );
}
