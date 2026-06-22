"use client";

import { useState } from "react";
import { createLiability, LiabilityItem } from "@/lib/api";
import { X } from "@/components/ui/Icons";
import CurrencySelect from "@/components/CurrencySelect";
import { useLanguage } from "@/lib/i18n";

const LIABILITY_TYPE_KEYS = [
  "mortgage", "auto_loan", "personal_loan", "credit_card",
  "student_loan", "family_debt", "other_liability",
] as const;

interface Props {
  onClose: () => void;
  onAdded: (liability: LiabilityItem) => void;
}

export default function AddLiabilityModal({ onClose, onAdded }: Props) {
  const { t } = useLanguage();
  const [name, setName] = useState("");
  const [liabilityType, setLiabilityType] = useState("personal_loan");
  const [currency, setCurrency] = useState("TRY");
  const [totalAmount, setTotalAmount] = useState("");
  const [remainingAmount, setRemainingAmount] = useState("");
  const [monthlyPayment, setMonthlyPayment] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [interestRate, setInterestRate] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const liability = await createLiability({
        name,
        liability_type: liabilityType,
        currency,
        total_amount: totalAmount,
        remaining_amount: remainingAmount || totalAmount,
        monthly_payment: monthlyPayment || undefined,
        due_date: dueDate || undefined,
        interest_rate: interestRate || undefined,
        notes: notes || undefined,
      });
      onAdded(liability);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setLoading(false);
    }
  };

  const inputClass = "w-full bg-[#0F0F0F] border border-[#2A2A2A] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-600";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-2xl w-full max-w-md mx-4 p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-white font-semibold text-lg">{t("nw.addLiability")}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors"><X size={20} /></button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1">{t("common.name")}</label>
            <input value={name} onChange={(e) => setName(e.target.value)} required className={inputClass} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">{t("common.type")}</label>
              <select value={liabilityType} onChange={(e) => setLiabilityType(e.target.value)} className={inputClass}>
                {LIABILITY_TYPE_KEYS.map((k) => {
                  const key = `liabilityType.${k}`;
                  const label = t(key) !== key ? t(key) : k;
                  return <option key={k} value={k}>{label}</option>;
                })}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">{t("common.currency")}</label>
              <CurrencySelect value={currency} onChange={setCurrency} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">{t("nw.total")}</label>
              <input type="number" min="0" step="0.01" value={totalAmount} onChange={(e) => setTotalAmount(e.target.value)} placeholder="0.00" required className={inputClass} />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">{t("nw.remaining")}</label>
              <input type="number" min="0" step="0.01" value={remainingAmount} onChange={(e) => setRemainingAmount(e.target.value)} className={inputClass} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">{t("nw.monthly")} ({t("common.optional")})</label>
              <input type="number" min="0" step="0.01" value={monthlyPayment} onChange={(e) => setMonthlyPayment(e.target.value)} placeholder="0.00" className={inputClass} />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">% ({t("common.optional")})</label>
              <input type="number" min="0" step="0.01" value={interestRate} onChange={(e) => setInterestRate(e.target.value)} className={inputClass} />
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">{t("nw.due")} ({t("common.optional")})</label>
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputClass} />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">{t("common.notes")} ({t("common.optional")})</label>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} />
          </div>

          {error && <p className="text-red-400 text-xs">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 rounded-lg border border-[#2A2A2A] text-sm text-gray-400 hover:text-gray-200 transition-colors">
              {t("common.cancel")}
            </button>
            <button type="submit" disabled={loading || !name || !totalAmount} className="flex-1 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium text-white transition-colors">
              {loading ? t("common.loading") : t("common.add")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
