"use client";

/**
 * WHAT: Transaction list page — fetches and displays all categorized transactions for the dev user.
 * WHY: First screen where users see the output of the upload + LLM pipeline.
 * BREAKS IF REMOVED: No way to view processed transactions after upload.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { getTransactions, getInsights, DEV_USER_ID, type Transaction, type InsightResponse } from "@/lib/api";
import TransactionTable from "@/components/TransactionTable";

type LoadState = "loading" | "ready" | "error";

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [insight, setInsight] = useState<InsightResponse | null>(null);
  const [txState, setTxState] = useState<LoadState>("loading");
  const [insightState, setInsightState] = useState<LoadState>("loading");

  useEffect(() => {
    getTransactions(DEV_USER_ID)
      .then((data) => { setTransactions(data); setTxState("ready"); })
      .catch(() => setTxState("error"));

    getInsights(DEV_USER_ID)
      .then((data) => { setInsight(data); setInsightState("ready"); })
      .catch(() => setInsightState("error"));
  }, []);

  return (
    <main className="min-h-screen bg-gray-950 text-white px-4 py-10">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <Link href="/" className="text-gray-500 text-sm hover:text-gray-300 transition-colors">
              ← Mizan
            </Link>
            <h1 className="text-3xl font-bold mt-4">İşlemler</h1>
            {txState === "ready" && (
              <p className="text-gray-400 text-sm mt-1">
                {transactions.length} işlem bulundu
              </p>
            )}
          </div>
          <Link
            href="/upload"
            className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-sm font-medium transition-colors"
          >
            + Ekstre Yükle
          </Link>
        </div>

        {/* Coaching insight box */}
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

        {/* Transaction table */}
        {txState === "loading" && (
          <p className="text-center text-gray-500 py-16 animate-pulse">Yükleniyor...</p>
        )}
        {txState === "error" && (
          <p className="text-center text-red-400 py-16">
            İşlemler yüklenemedi. Backend bağlantısını kontrol edin.
          </p>
        )}
        {txState === "ready" && <TransactionTable transactions={transactions} />}
      </div>
    </main>
  );
}
