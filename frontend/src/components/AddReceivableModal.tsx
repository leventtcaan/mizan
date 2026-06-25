"use client";

import { useState } from "react";
import { createReceivable, updateReceivable, getDefaultCurrency, ReceivableItem } from "@/lib/api";
import { X } from "@/components/ui/Icons";
import CurrencySelect from "@/components/CurrencySelect";
import { useLanguage } from "@/lib/i18n";

interface Props {
  onClose: () => void;
  onAdded: (receivable: ReceivableItem) => void;
  onUpdated?: (receivable: ReceivableItem) => void;
  editData?: ReceivableItem | null;
}

export default function AddReceivableModal({ onClose, onAdded, onUpdated, editData }: Props) {
  const { t } = useLanguage();
  const isEdit = !!editData;

  const [fromPerson, setFromPerson] = useState(editData?.from_person ?? "");
  const [amount, setAmount] = useState(editData?.amount ?? "");
  // New entries default to the user's display currency; edits keep their own.
  const [currency, setCurrency] = useState(() => editData?.currency ?? getDefaultCurrency());
  const [expectedDate, setExpectedDate] = useState(editData?.expected_date ?? "");
  const [notes, setNotes] = useState(editData?.notes ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const body = {
        from_person: fromPerson,
        amount,
        currency,
        expected_date: expectedDate || undefined,
        notes: notes || undefined,
      };
      if (isEdit && editData) {
        const updated = await updateReceivable(editData.id, body);
        onUpdated?.(updated);
      } else {
        const receivable = await createReceivable(body);
        onAdded(receivable);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setLoading(false);
    }
  };

  const inputClass = "w-full bg-canvas border border-line rounded-lg px-3 py-2 text-sm text-ink placeholder-gray-600 focus:outline-none focus:border-brand";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-surface border border-line rounded-2xl w-full max-w-md mx-4 p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-ink font-semibold text-lg">
            {isEdit ? `${t("common.edit")}: ${editData!.from_person}` : t("nw.addReceivable")}
          </h2>
          <button onClick={onClose} className="text-ink-mute hover:text-ink-soft transition-colors"><X size={20} /></button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs text-ink-mute mb-1">{t("common.name")}</label>
            <input value={fromPerson} onChange={(e) => setFromPerson(e.target.value)} required className={inputClass} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-ink-mute mb-1">{t("common.amount")}</label>
              <input type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" required className={inputClass} />
            </div>
            <div>
              <label className="block text-xs text-ink-mute mb-1">{t("common.currency")}</label>
              <CurrencySelect value={currency} onChange={setCurrency} />
            </div>
          </div>

          <div>
            <label className="block text-xs text-ink-mute mb-1">{t("common.date")} ({t("common.optional")})</label>
            <input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} className={inputClass} />
          </div>

          <div>
            <label className="block text-xs text-ink-mute mb-1">{t("common.notes")} ({t("common.optional")})</label>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} />
          </div>

          {error && <p className="text-neg text-xs">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 rounded-lg border border-line text-sm text-ink-mute hover:text-ink-soft transition-colors">
              {t("common.cancel")}
            </button>
            <button type="submit" disabled={loading || !fromPerson || !amount} className="flex-1 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium text-white transition-colors">
              {loading ? t("common.loading") : isEdit ? t("common.save") : t("common.add")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
