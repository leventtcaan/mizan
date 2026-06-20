"use client";

import { useState } from "react";
import { createTransaction, type Transaction } from "@/lib/api";
import { CATEGORY_LABELS } from "@/lib/categories";

const CATEGORIES = [
  "market", "restoran", "ulasim", "eglence", "saglik",
  "fatura", "giyim", "nakit_atm", "transfer", "iade",
  "vergi", "teknoloji", "diger",
] as const;

interface InitialValues {
  amount?: string;
  transaction_type?: "debit" | "credit";
  description?: string;
  transaction_date?: string;
  category?: string;
}

interface Props {
  onClose: () => void;
  onSuccess: (tx: Transaction) => void;
  initialValues?: InitialValues;
}

export default function AddTransactionModal({ onClose, onSuccess, initialValues }: Props) {
  const [amount, setAmount] = useState(initialValues?.amount ?? "");
  const [type, setType] = useState<"debit" | "credit">(initialValues?.transaction_type ?? "debit");
  const [description, setDescription] = useState(initialValues?.description ?? "");
  const [date, setDate] = useState(initialValues?.transaction_date ?? new Date().toISOString().slice(0, 10));
  const [category, setCategory] = useState(initialValues?.category ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const tx = await createTransaction({
        amount,
        transaction_type: type,
        description,
        transaction_date: date,
        category: category || undefined,
      });
      onSuccess(tx);
    } catch (err) {
      setError(err instanceof Error ? err.message : "İşlem eklenemedi");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md mx-4 bg-gray-900 rounded-2xl border border-gray-800 p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-white">İşlem Ekle</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300 text-xl leading-none"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Type toggle */}
          <div>
            <label className="block text-xs text-gray-500 mb-1.5">İşlem Türü</label>
            <div className="flex rounded-lg overflow-hidden border border-gray-700 text-sm">
              <button
                type="button"
                onClick={() => setType("debit")}
                className={`flex-1 py-2 transition-colors ${type === "debit" ? "bg-red-900/60 text-red-300" : "bg-gray-800 text-gray-400 hover:text-gray-300"}`}
              >
                Gider
              </button>
              <button
                type="button"
                onClick={() => setType("credit")}
                className={`flex-1 py-2 transition-colors ${type === "credit" ? "bg-green-900/60 text-green-300" : "bg-gray-800 text-gray-400 hover:text-gray-300"}`}
              >
                Gelir
              </button>
            </div>
          </div>

          {/* Amount */}
          <div>
            <label className="block text-xs text-gray-500 mb-1.5">Tutar (₺)</label>
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
              placeholder="0.00"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs text-gray-500 mb-1.5">Açıklama</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
              placeholder="İşlem açıklaması"
              maxLength={200}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* Date */}
          <div>
            <label className="block text-xs text-gray-500 mb-1.5">Tarih</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* Category (optional) */}
          <div>
            <label className="block text-xs text-gray-500 mb-1.5">
              Kategori <span className="text-gray-600">(boş bırakılırsa otomatik)</span>
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500"
            >
              <option value="">Otomatik belirle</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{CATEGORY_LABELS[c] ?? c}</option>
              ))}
            </select>
          </div>

          {error && (
            <p className="text-red-400 text-sm">{error}</p>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm text-gray-300 transition-colors"
            >
              İptal
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-sm font-medium text-white transition-colors"
            >
              {loading ? "Ekleniyor..." : "Ekle"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
