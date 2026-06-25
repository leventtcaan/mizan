"use client";

import { useState } from "react";
import { createReceivable, updateReceivable, getDefaultCurrency, ReceivableItem } from "@/lib/api";
import { X, DollarSign } from "@/components/ui/Icons";
import CurrencySelect from "@/components/CurrencySelect";
import { useLanguage } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";

interface Props {
  onClose: () => void;
  onAdded: (receivable: ReceivableItem) => void;
  onUpdated?: (receivable: ReceivableItem) => void;
  editData?: ReceivableItem | null;
}

export default function AddReceivableModal({ onClose, onAdded, onUpdated, editData }: Props) {
  const { t } = useLanguage();
  const { resolved } = useTheme();
  const surfaceBg = resolved === "dark" ? "#1C1915" : "#FFFFFF";
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

  const inputClass = "w-full bg-canvas border border-line rounded-lg px-3 py-2.5 text-sm text-ink placeholder:text-ink-mute focus:outline-none focus:border-[#176B5B] focus:ring-2 focus:ring-[#176B5B]/20 transition-shadow";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="border border-line rounded-2xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto shadow-2xl shadow-black/30" style={{ backgroundColor: surfaceBg }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-9 h-9 rounded-xl bg-warn/10 flex items-center justify-center shrink-0"><DollarSign size={17} className="text-warn" /></span>
            <h2 className="text-ink font-semibold text-lg truncate">
              {isEdit ? `${t("common.edit")}: ${editData!.from_person}` : t("nw.addReceivable")}
            </h2>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-ink-mute hover:text-ink hover:bg-surface-2 transition-colors shrink-0"><X size={18} /></button>
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
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2.5 rounded-lg border border-line text-sm font-medium text-ink-soft hover:bg-surface-2 transition-colors">
              {t("common.cancel")}
            </button>
            <button type="submit" disabled={loading || !fromPerson || !amount} className="flex-1 px-4 py-2.5 rounded-lg bg-[#176B5B] hover:bg-[#125848] disabled:opacity-50 disabled:cursor-not-allowed text-sm font-semibold text-white transition-colors">
              {loading ? t("common.loading") : isEdit ? t("common.save") : t("common.add")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
