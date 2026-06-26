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

// "23" → an ISO date for the NEXT occurrence of that day-of-month (the backend reads only
// the day for the monthly recurrence, but a real upcoming date reads naturally on the card).
function dueDateFromDay(dayStr: string): string | undefined {
  const day = parseInt(dayStr, 10);
  if (!Number.isFinite(day) || day < 1 || day > 31) return undefined;
  const t0 = new Date(); t0.setHours(0, 0, 0, 0);
  const y = t0.getFullYear(), m = t0.getMonth();
  const onDay = (yy: number, mm: number) => new Date(yy, mm, Math.min(day, new Date(yy, mm + 1, 0).getDate()));
  let dt = onDay(y, m);
  if (dt < t0) dt = onDay(m === 11 ? y + 1 : y, (m + 1) % 12);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

function dayFromISO(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = /^\d{4}-\d{2}-(\d{2})/.exec(iso);
  return m ? String(parseInt(m[1], 10)) : "";
}

export default function AddLiabilityModal({ onClose, onAdded, onUpdated, editData, prefill }: Props) {
  const { t } = useLanguage();
  const { resolved } = useTheme();
  const surfaceBg = resolved === "dark" ? "#1C1915" : "#FFFFFF";
  const isEdit = !!editData;

  // ── Essentials (always visible) ──
  const [name, setName] = useState(editData?.name ?? prefill?.name ?? "");
  const [liabilityType, setLiabilityType] = useState(editData?.liability_type ?? prefill?.liability_type ?? "personal_loan");
  const [currency, setCurrency] = useState(() => editData?.currency ?? prefill?.currency ?? getDefaultCurrency());
  const [amountOwed, setAmountOwed] = useState(editData?.remaining_amount ?? prefill?.remaining_amount ?? "");

  // ── Recurring (progressive) — only an existing monthly payment opts in by default ──
  const [recurring, setRecurring] = useState<boolean>(!!editData?.monthly_payment);
  const [monthlyPayment, setMonthlyPayment] = useState(editData?.monthly_payment ?? "");
  const [paymentDay, setPaymentDay] = useState(dayFromISO(editData?.due_date));
  const [endDate, setEndDate] = useState(editData?.end_date ?? "");
  const [reminderDays, setReminderDays] = useState<string>(editData?.reminder_days != null ? String(editData.reminder_days) : "7");

  // ── Extra context (collapsed) ──
  const [originalAmount, setOriginalAmount] = useState(editData?.total_amount ?? "");
  const [interestRate, setInterestRate] = useState(editData?.interest_rate ?? "");
  const [notes, setNotes] = useState(editData?.notes ?? "");
  const [showDetails, setShowDetails] = useState(isEdit && (!!editData?.total_amount || !!editData?.interest_rate || !!editData?.notes));

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A recurring obligation needs both the amount and the day to be schedulable.
  const recurringReady = !recurring || (!!monthlyPayment && !!paymentDay);
  const canSubmit = !!name && !!amountOwed && recurringReady && !loading;

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
        // Recurring fields are only sent when this is a monthly obligation.
        monthly_payment: recurring ? (monthlyPayment || undefined) : undefined,
        due_date: recurring ? dueDateFromDay(paymentDay) : undefined,
        end_date: recurring ? (endDate || undefined) : undefined,
        reminder_days: recurring && reminderDays
          ? Math.max(0, Math.min(30, parseInt(reminderDays, 10) || 0))
          : undefined,
        interest_rate: interestRate || undefined,
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
  const segBtn = (active: boolean) =>
    `flex-1 px-3 py-2 rounded-lg text-sm border transition-colors ${
      active ? "bg-[#176B5B]/10 border-[#176B5B]/40 text-[#176B5B] font-medium" : "bg-canvas border-line text-ink-soft hover:border-[#176B5B]"
    }`;

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

          {/* name */}
          <div>
            <label className="block text-xs text-ink-mute mb-1">{t("common.name")}</label>
            <input value={name} autoFocus onChange={(e) => setName(e.target.value)} required className={inputClass} />
          </div>

          {/* type + currency */}
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

          {/* amount owed */}
          <div>
            <label className="block text-xs text-ink-mute mb-1">{t("nw.remaining")}</label>
            <input type="number" min="0" step="0.01" inputMode="decimal" value={amountOwed} onChange={(e) => setAmountOwed(e.target.value)} placeholder="0.00" required className={inputClass} />
          </div>

          {/* recurring? — the progressive fork */}
          <div>
            <label className="block text-xs text-ink-mute mb-1.5">{t("nw.paymentKind")}</label>
            <div className="flex gap-2">
              <button type="button" onClick={() => setRecurring(false)} className={segBtn(!recurring)}>{t("nw.oneTime")}</button>
              <button type="button" onClick={() => setRecurring(true)} className={segBtn(recurring)}>{t("nw.monthlyRecurring")}</button>
            </div>
          </div>

          {/* recurring configuration — only when monthly */}
          {recurring && (
            <div className="space-y-4 rounded-xl bg-surface-2/60 border border-line p-3.5">
              <p className="text-[11px] text-ink-mute">{t("nw.recurringExplainer")}</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-ink-mute mb-1">{t("nw.monthlyAmount")}</label>
                  <input type="number" min="0" step="0.01" inputMode="decimal" value={monthlyPayment}
                    onChange={(e) => setMonthlyPayment(e.target.value)} placeholder="0.00" className={inputClass} />
                </div>
                <div>
                  <label className="block text-xs text-ink-mute mb-1">{t("nw.paymentDay")}</label>
                  <input type="number" min="1" max="31" step="1" inputMode="numeric" value={paymentDay}
                    onChange={(e) => setPaymentDay(e.target.value)} placeholder="23" className={inputClass} />
                </div>
              </div>
              <p className="text-[11px] text-ink-mute -mt-2">{t("nw.paymentDayHint")}</p>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-ink-mute mb-1">{t("nw.reminderLabel")}</label>
                  <div className="flex items-center gap-2">
                    <input type="number" min="0" max="30" step="1" value={reminderDays}
                      onChange={(e) => setReminderDays(e.target.value)} className={`${inputClass} w-16`} />
                    <span className="text-[11px] text-ink-mute">{t("nw.reminderSuffix")}</span>
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-ink-mute mb-1">{t("nw.endDateLabel")} ({t("common.optional")})</label>
                  <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={inputClass} />
                </div>
              </div>

              {!recurringReady && <p className="text-warn text-[11px]">{t("nw.recurringNeedsFields")}</p>}
            </div>
          )}

          {/* extra context */}
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
                    <label className="block text-xs text-ink-mute mb-1">% ({t("common.optional")})</label>
                    <input type="number" min="0" step="0.01" value={interestRate} onChange={(e) => setInterestRate(e.target.value)} className={inputClass} />
                  </div>
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
            <button type="submit" disabled={!canSubmit} className="flex-1 px-4 py-2.5 rounded-lg bg-[#176B5B] hover:bg-[#125848] disabled:opacity-50 disabled:cursor-not-allowed text-sm font-semibold text-white transition-colors">
              {loading ? t("common.loading") : isEdit ? t("common.save") : t("common.add")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
