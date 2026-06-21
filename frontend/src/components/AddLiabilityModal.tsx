"use client";

import { useState } from "react";
import { createLiability, LiabilityItem } from "@/lib/api";
import { X } from "@/components/ui/Icons";
import CurrencySelect from "@/components/CurrencySelect";

const LIABILITY_TYPES: { value: string; label: string }[] = [
  { value: "mortgage", label: "Konut Kredisi" },
  { value: "auto_loan", label: "Taşıt Kredisi" },
  { value: "personal_loan", label: "İhtiyaç Kredisi" },
  { value: "credit_card", label: "Kredi Kartı" },
  { value: "student_loan", label: "Eğitim Kredisi" },
  { value: "family_debt", label: "Aile / Arkadaş Borcu" },
  { value: "other_liability", label: "Diğer" },
];

interface Props {
  onClose: () => void;
  onAdded: (liability: LiabilityItem) => void;
}

export default function AddLiabilityModal({ onClose, onAdded }: Props) {
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
      setError(err instanceof Error ? err.message : "Bir hata oluştu");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-2xl w-full max-w-md mx-4 p-6 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-white font-semibold text-lg">Borç Ekle</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Ad</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="örn. Garanti konut kredisi"
              required
              className="w-full bg-[#0F0F0F] border border-[#2A2A2A] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-600"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Tür</label>
              <select
                value={liabilityType}
                onChange={(e) => setLiabilityType(e.target.value)}
                className="w-full bg-[#0F0F0F] border border-[#2A2A2A] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-600"
              >
                {LIABILITY_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Para Birimi</label>
              <CurrencySelect value={currency} onChange={setCurrency} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Toplam Tutar</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={totalAmount}
                onChange={(e) => setTotalAmount(e.target.value)}
                placeholder="0.00"
                required
                className="w-full bg-[#0F0F0F] border border-[#2A2A2A] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-600"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Kalan Borç</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={remainingAmount}
                onChange={(e) => setRemainingAmount(e.target.value)}
                placeholder="Boş = toplam"
                className="w-full bg-[#0F0F0F] border border-[#2A2A2A] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-600"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Aylık Ödeme</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={monthlyPayment}
                onChange={(e) => setMonthlyPayment(e.target.value)}
                placeholder="opsiyonel"
                className="w-full bg-[#0F0F0F] border border-[#2A2A2A] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-600"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Faiz Oranı (%)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={interestRate}
                onChange={(e) => setInterestRate(e.target.value)}
                placeholder="opsiyonel"
                className="w-full bg-[#0F0F0F] border border-[#2A2A2A] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-600"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Son Ödeme Tarihi</label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full bg-[#0F0F0F] border border-[#2A2A2A] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-600"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Not (opsiyonel)</label>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="ör. banka, kredi numarası..."
              className="w-full bg-[#0F0F0F] border border-[#2A2A2A] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-600"
            />
          </div>

          {error && <p className="text-red-400 text-xs">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 rounded-lg border border-[#2A2A2A] text-sm text-gray-400 hover:text-gray-200 transition-colors"
            >
              İptal
            </button>
            <button
              type="submit"
              disabled={loading || !name || !totalAmount}
              className="flex-1 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium text-white transition-colors"
            >
              {loading ? "Ekleniyor..." : "Ekle"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
