"use client";

import { useState } from "react";
import { createLiability, updateLiability, getDefaultCurrency, LiabilityItem } from "@/lib/api";
import { X, TrendingDown, ChevronDown } from "@/components/ui/Icons";
import CurrencySelect from "@/components/CurrencySelect";
import { useLanguage } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";

const LIABILITY_TYPE_KEYS = [
  "mortgage", "auto_loan", "personal_loan", "credit_card",
  "student_loan", "family_debt", "other_liability",
] as const;

// Seed values for a fresh liability (e.g. auto-filled from a detected credit-card statement).
export interface LiabilityPrefill {
  name?: string;
  liability_type?: string;
  currency?: string;
  remaining_amount?: string;
  fromStatement?: boolean;
}

interface Props {
  onClose: () => void;
  onAdded: (liability: LiabilityItem) => void;
  onUpdated?: (liability: LiabilityItem) => void;
  editData?: LiabilityItem | null;
  prefill?: LiabilityPrefill | null;
}

export default function AddLiabilityModal({ onClose, onAdded, onUpdated, editData, prefill }: Props) {
  const { t } = useLanguage();
  const { resolved } = useTheme();
  const surfaceBg = resolved === "dark" ? "#1C1915" : "#FFFFFF";
  const isEdit = !!editData;

  const [name, setName] = useState(editData?.name ?? prefill?.name ?? "");
  const [liabilityType, setLiabilityType] = useState(editData?.liability_type ?? prefill?.liability_type ?? "personal_loan");
  // New entries default to the user's display currency; edits/prefills keep their own.
  const [currency, setCurrency] = useState(() => editData?.currency ?? prefill?.currency ?? getDefaultCurrency());
  // The one number that matters for net worth: what you owe right now.
  const [amountOwed, setAmountOwed] = useState(editData?.remaining_amount ?? prefill?.remaining_amount ?? "");

  // Optional extras (cash-flow / progress) — hidden by default.
  const [originalAmount, setOriginalAmount] = useState(editData?.total_amount ?? "");
  const [monthlyPayment, setMonthlyPayment] = useState(editData?.monthly_payment ?? "");
  const [dueDate, setDueDate] = useState(editData?.due_date ?? "");
  const [interestRate, setInterestRate] = useState(editData?.interest_rate ?? "");
  const [reminderDays, setReminderDays] = useState<string>(editData?.reminder_days != null ? String(editData.reminder_days) : "7");
  const [notes, setNotes] = useState(editData?.notes ?? "");
  // Open details by default when editing, or when a statement prefill wants reviewing.
  const [showDetails, setShowDetails] = useState(isEdit || !!prefill);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const body = {
        name,
        liability_type: liabilityType,
        currency,
        // If no original amount is given, treat the owed amount as the whole balance.
        total_amount: originalAmount || amountOwed,
        remaining_amount: amountOwed,
        monthly_payment: monthlyPayment || undefined,
        due_date: dueDate || undefined,
        interest_rate: interestRate || undefined,
        reminder_days: reminderDays ? Math.max(0, Math.min(30, parseInt(reminderDays, 10) || 0)) : undefined,
        notes: notes || undefined,
      };
      if (isEdit && editData) {
        const updated = await updateLiability(editData.id, body);
        onUpdated?.(updated);
      } else {
        const liability = await createLiability(body);
        onAdded(liability);
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
            <span className="w-9 h-9 rounded-xl bg-neg/10 flex items-center justify-center shrink-0"><TrendingDown size={17} className="text-neg" /></span>
            <h2 className="text-ink font-semibold text-lg truncate">
              {isEdit ? `${t("common.edit")}: ${editData!.name}` : t("nw.addLiability")}
            </h2>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-ink-mute hover:text-ink hover:bg-surface-2 transition-colors shrink-0"><X size={18} /></button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {prefill?.fromStatement && (
            <div className="rounded-lg bg-[#176B5B]/10 border border-[#176B5B]/30 px-3 py-2.5 text-xs text-[#176B5B]">
              {t("nw.fromStatementLiability")}
            </div>
          )}
          <div>
            <label className="block text-xs text-ink-mute mb-1">{t("common.name")}</label>
            <input value={name} autoFocus onChange={(e) => setName(e.target.value)} required className={inputClass} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-ink-mute mb-1">{t("common.type")}</label>
              <select value={liabilityType} onChange={(e) => setLiabilityType(e.target.value)} className={inputClass}>
                {LIABILITY_TYPE_KEYS.map((k) => {
                  const key = `liabilityType.${k}`;
                  const label = t(key) !== key ? t(key) : k;
                  return <option key={k} value={k}>{label}</option>;
                })}
              </select>
            </div>
            <div>
              <label className="block text-xs text-ink-mute mb-1">{t("common.currency")}</label>
              <CurrencySelect value={currency} onChange={setCurrency} />
            </div>
          </div>

          <div>
            <label className="block text-xs text-ink-mute mb-1">{t("nw.remaining")}</label>
            <input type="number" min="0" step="0.01" inputMode="decimal" value={amountOwed} onChange={(e) => setAmountOwed(e.target.value)} placeholder="0.00" required className={inputClass} />
          </div>

          <div className="border-t border-line">
            <button type="button" onClick={() => setShowDetails((v) => !v)}
              className="flex items-center gap-1.5 text-xs text-ink-mute hover:text-ink-soft transition-colors py-1.5">
              <ChevronDown size={14} className={`transition-transform ${showDetails ? "rotate-180" : ""}`} />
              {t("assetForm.moreDetails")}
            </button>
            {showDetails && (
              <div className="space-y-4 pt-2">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-ink-mute mb-1">{t("nw.total")} ({t("common.optional")})</label>
                    <input type="number" min="0" step="0.01" value={originalAmount} onChange={(e) => setOriginalAmount(e.target.value)} placeholder="0.00" className={inputClass} />
                  </div>
                  <div>
                    <label className="block text-xs text-ink-mute mb-1">{t("nw.monthly")} ({t("common.optional")})</label>
                    <input type="number" min="0" step="0.01" value={monthlyPayment} onChange={(e) => setMonthlyPayment(e.target.value)} placeholder="0.00" className={inputClass} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-ink-mute mb-1">% ({t("common.optional")})</label>
                    <input type="number" min="0" step="0.01" value={interestRate} onChange={(e) => setInterestRate(e.target.value)} className={inputClass} />
                  </div>
                  <div>
                    <label className="block text-xs text-ink-mute mb-1">{t("nw.due")} ({t("common.optional")})</label>
                    <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputClass} />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-ink-mute mb-1">{t("nw.reminderLabel")}</label>
                  <div className="flex items-center gap-2">
                    <input type="number" min="0" max="30" step="1" value={reminderDays}
                      onChange={(e) => setReminderDays(e.target.value)} className={`${inputClass} w-20`} />
                    <span className="text-xs text-ink-mute">{t("nw.reminderSuffix")}</span>
                  </div>
                  <p className="text-[11px] text-ink-mute mt-1.5">{t("nw.reminderHint")}</p>
                </div>
                <div>
                  <label className="block text-xs text-ink-mute mb-1">{t("common.notes")} ({t("common.optional")})</label>
                  <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} />
                </div>
              </div>
            )}
          </div>

          {error && <p className="text-neg text-xs">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2.5 rounded-lg border border-line text-sm font-medium text-ink-soft hover:bg-surface-2 transition-colors">
              {t("common.cancel")}
            </button>
            <button type="submit" disabled={loading || !name || !amountOwed} className="flex-1 px-4 py-2.5 rounded-lg bg-[#176B5B] hover:bg-[#125848] disabled:opacity-50 disabled:cursor-not-allowed text-sm font-semibold text-white transition-colors">
              {loading ? t("common.loading") : isEdit ? t("common.save") : t("common.add")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
