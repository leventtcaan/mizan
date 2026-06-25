"use client";

import { useState } from "react";
import { createTransaction, getDefaultCurrency, type Transaction } from "@/lib/api";
import { X } from "@/components/ui/Icons";
import { useLanguage } from "@/lib/i18n";

const CATEGORIES = [
  "market", "restoran", "ulasim", "eglence", "saglik",
  "fatura", "giyim", "nakit_atm", "transfer", "iade",
  "vergi", "teknoloji", "diger",
] as const;

const inputClass = "w-full bg-canvas border border-line rounded-lg px-3 py-2.5 text-ink text-sm placeholder-gray-700 focus:outline-none focus:border-brand transition-colors";

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
  const { t } = useLanguage();
  const [amount, setAmount] = useState(initialValues?.amount ?? "");
  const [type, setType] = useState<"debit" | "credit">(initialValues?.transaction_type ?? "debit");
  const [description, setDescription] = useState(initialValues?.description ?? "");
  const [date, setDate] = useState(initialValues?.transaction_date ?? new Date().toISOString().slice(0, 10));
  const [category, setCategory] = useState(initialValues?.category ?? "");
  const [currency, setCurrency] = useState(getDefaultCurrency());
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
        currency: currency || undefined,
      });
      onSuccess(tx);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md mx-4 bg-surface rounded-2xl border border-line p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-ink">{t("tx.addManual")}</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-ink-mute hover:text-ink-soft hover:bg-surface-2 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs text-ink-mute mb-2 uppercase tracking-wide">{t("common.type")}</label>
            <div className="flex rounded-lg overflow-hidden border border-line text-sm">
              <button
                type="button"
                onClick={() => setType("debit")}
                className={`flex-1 py-2.5 font-medium transition-colors ${type === "debit" ? "bg-red-950 text-red-300 border-r border-line" : "bg-canvas text-ink-mute hover:text-ink-soft border-r border-line"}`}
              >
                {t("progress.spending")}
              </button>
              <button
                type="button"
                onClick={() => setType("credit")}
                className={`flex-1 py-2.5 font-medium transition-colors ${type === "credit" ? "bg-emerald-950 text-emerald-300" : "bg-canvas text-ink-mute hover:text-ink-soft"}`}
              >
                {t("progress.income")}
              </button>
            </div>
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-ink-mute mb-1.5 uppercase tracking-wide">{t("common.amount")}</label>
              <input
                type="number" min="0.01" step="0.01"
                value={amount} onChange={(e) => setAmount(e.target.value)}
                required placeholder="0.00" className={inputClass}
              />
            </div>
            <div className="w-24">
              <label className="block text-xs text-ink-mute mb-1.5 uppercase tracking-wide">{t("common.currency")}</label>
              <input
                type="text" value={currency}
                onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 10))}
                maxLength={10} placeholder="TRY" className={inputClass}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-ink-mute mb-1.5 uppercase tracking-wide">{t("common.description")}</label>
            <input
              type="text" value={description} onChange={(e) => setDescription(e.target.value)}
              required maxLength={200} className={inputClass}
            />
          </div>

          <div>
            <label className="block text-xs text-ink-mute mb-1.5 uppercase tracking-wide">{t("common.date")}</label>
            <input
              type="date" value={date} onChange={(e) => setDate(e.target.value)}
              required className={inputClass}
            />
          </div>

          <div>
            <label className="block text-xs text-ink-mute mb-1.5 uppercase tracking-wide">
              {t("goals.category")} <span className="text-gray-700 normal-case">({t("common.optional")})</span>
            </label>
            <select
              value={category} onChange={(e) => setCategory(e.target.value)}
              className={inputClass}
            >
              <option value="">{t("common.autoRefresh")}</option>
              {CATEGORIES.map((c) => {
                const key = `category.${c}`;
                const label = t(key) !== key ? t(key) : c;
                return <option key={c} value={c}>{label}</option>;
              })}
            </select>
          </div>

          {error && <p className="text-neg text-sm">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button
              type="button" onClick={onClose}
              className="flex-1 py-2.5 rounded-lg bg-surface-2 hover:bg-surface-3 text-sm text-ink-soft transition-colors"
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit" disabled={loading}
              className="flex-1 py-2.5 rounded-lg bg-brand hover:bg-brand-hover disabled:opacity-50 text-sm font-medium text-white transition-colors"
            >
              {loading ? t("common.loading") : t("common.add")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
