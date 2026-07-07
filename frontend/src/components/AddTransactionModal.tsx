"use client";

import { useState } from "react";
import { createTransaction, updateTransaction, getDefaultCurrency, type Transaction } from "@/lib/api";
import { X, ArrowDown, ArrowUp, CheckCircle } from "@/components/ui/Icons";
import CurrencySelect from "@/components/CurrencySelect";
import { useLanguage } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";

const CATEGORIES = [
  "market", "restoran", "ulasim", "eglence", "saglik",
  "fatura", "giyim", "nakit_atm", "transfer", "iade",
  "vergi", "teknoloji", "diger",
] as const;

function fmtMoney(amount: string, currency: string): string {
  const n = parseFloat(amount);
  if (isNaN(n)) return "";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(n);
  } catch {
    return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(n)} ${currency}`;
  }
}

const inputClass = "w-full bg-canvas border border-line rounded-lg px-3 py-2.5 text-ink text-sm placeholder:text-ink-mute focus:outline-none focus:border-[#176B5B] focus:ring-2 focus:ring-[#176B5B]/20 transition-shadow";

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
  // When set, the modal EDITS this transaction (PUT) instead of creating a new one.
  editData?: Transaction | null;
}

export default function AddTransactionModal({ onClose, onSuccess, initialValues, editData }: Props) {
  const { t } = useLanguage();
  // Explicit opaque surface from the resolved theme — guarantees a solid background
  // regardless of CSS-var/token resolution (overlays must never be see-through).
  const { resolved } = useTheme();
  const surfaceBg = resolved === "dark" ? "#1C1915" : "#FFFFFF";
  // Explicit accent fills (matching --c-neg / --c-pos) so the selected type button is
  // clearly filled — solid bg-<token> utilities aren't painting reliably at runtime.
  const NEG = resolved === "dark" ? "#D17474" : "#B54747";
  const POS = resolved === "dark" ? "#40B282" : "#1F7A5C";
  const isEdit = !!editData;
  const [amount, setAmount] = useState(editData?.amount ?? initialValues?.amount ?? "");
  const [type, setType] = useState<"debit" | "credit">(
    (editData?.transaction_type as "debit" | "credit" | undefined) ?? initialValues?.transaction_type ?? "debit"
  );
  const [description, setDescription] = useState(editData?.description ?? initialValues?.description ?? "");
  const [date, setDate] = useState(editData?.transaction_date ?? initialValues?.transaction_date ?? new Date().toISOString().slice(0, 10));
  const [category, setCategory] = useState(editData?.category ?? initialValues?.category ?? "");
  const [currency, setCurrency] = useState(editData?.currency ?? getDefaultCurrency());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const payload = {
        amount,
        transaction_type: type,
        description,
        transaction_date: date,
        category: category || undefined,
        currency: currency || undefined,
      };
      const tx = isEdit && editData
        ? await updateTransaction(editData.id, payload)
        : await createTransaction(payload);
      onSuccess(tx);
      if (isEdit) window.dispatchEvent(new Event("mizan-data-changed"));
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
      <div className="w-full max-w-md mx-4 rounded-2xl border border-line p-6 shadow-2xl shadow-black/30" style={{ backgroundColor: surfaceBg }}>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-ink">{isEdit ? t("tx.editTitle") : t("tx.addManual")}</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-ink-mute hover:text-ink-soft hover:bg-surface-2 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Type — two clear, color-coded buttons */}
          <div>
            <label className="block text-xs text-ink-mute mb-2 uppercase tracking-wide">{t("common.type")}</label>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => setType("debit")}
                aria-pressed={type === "debit"}
                style={type === "debit" ? { backgroundColor: NEG, borderColor: NEG, color: "#FFFFFF" } : undefined}
                className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-semibold border transition-colors ${type === "debit" ? "shadow-sm" : "bg-canvas text-ink-mute border-line hover:text-ink-soft hover:border-ink/30"}`}
              >
                {type === "debit" ? <CheckCircle size={15} /> : <ArrowDown size={15} />} {t("progress.spending")}
              </button>
              <button
                type="button"
                onClick={() => setType("credit")}
                aria-pressed={type === "credit"}
                style={type === "credit" ? { backgroundColor: POS, borderColor: POS, color: "#FFFFFF" } : undefined}
                className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-semibold border transition-colors ${type === "credit" ? "shadow-sm" : "bg-canvas text-ink-mute border-line hover:text-ink-soft hover:border-ink/30"}`}
              >
                {type === "credit" ? <CheckCircle size={15} /> : <ArrowUp size={15} />} {t("progress.income")}
              </button>
            </div>
          </div>

          {/* Amount + currency dropdown */}
          <div className="flex gap-3">
            <div className="flex-1 min-w-0">
              <label className="block text-xs text-ink-mute mb-1.5 uppercase tracking-wide">{t("common.amount")}</label>
              <input
                type="number" min="0.01" step="0.01"
                value={amount} onChange={(e) => setAmount(e.target.value)}
                required placeholder="0.00" className={inputClass}
              />
            </div>
            <div className="w-40 shrink-0">
              <label className="block text-xs text-ink-mute mb-1.5 uppercase tracking-wide">{t("common.currency")}</label>
              <CurrencySelect value={currency} onChange={setCurrency} />
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

          {/* Category — empty = auto-detect by the backend (LLM) */}
          <div>
            <label className="block text-xs text-ink-mute mb-1.5 uppercase tracking-wide">
              {t("goals.category")} <span className="text-ink-mute normal-case">({t("common.optional")})</span>
            </label>
            <select
              value={category} onChange={(e) => setCategory(e.target.value)}
              className={inputClass}
            >
              <option value="">{t("tx.autoCategory")}</option>
              {CATEGORIES.map((c) => {
                const key = `category.${c}`;
                const label = t(key) !== key ? t(key) : c;
                return <option key={c} value={c}>{label}</option>;
              })}
            </select>
            {!category && <p className="text-[11px] text-ink-mute mt-1.5">{t("tx.autoCategoryHint")}</p>}
          </div>

          {/* Live preview — what will be saved */}
          {amount && parseFloat(amount) > 0 && (
            <div className="flex items-center justify-between rounded-xl bg-surface-2 px-3.5 py-2.5">
              <span className="text-xs text-ink-mute">{isEdit ? t("tx.willSave") : t("tx.willAdd")}</span>
              <span className="text-sm font-semibold tabular-nums">
                <span className={type === "credit" ? "text-pos" : "text-neg"}>
                  {type === "credit" ? "+" : "−"}{fmtMoney(amount, currency)}
                </span>
                <span className="text-ink-mute font-normal"> · {
                  category
                    ? (t(`category.${category}`) !== `category.${category}` ? t(`category.${category}`) : category)
                    : t("tx.autoCategory")
                }</span>
              </span>
            </div>
          )}

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
              className="flex-1 py-2.5 rounded-lg bg-[#176B5B] hover:bg-[#125848] disabled:opacity-50 text-sm font-semibold text-white transition-colors"
            >
              {loading ? t("common.loading") : isEdit ? t("common.save") : t("common.add")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
