"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getStoredUser, setStoredUser, completeOnboarding,
  uploadStatement, createAsset, createReceivable, createLiability, createTransaction,
  type UploadResponse,
} from "@/lib/api";
import { FileText, ArrowRight, BarChart2, Scale, CreditCard } from "@/components/ui/Icons";
import CurrencySelect from "@/components/CurrencySelect";
import { useLanguage } from "@/lib/i18n";

type Step = 1 | 2 | 3;
type Goal = "spending" | "networth" | "debt";
const DEFAULT_CURRENCY = "TRY";
const TOP_CURRENCIES = ["TRY", "USD", "EUR", "GBP", "CHF", "JPY", "AED"];

const inputClass = "w-full bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-600";

// Map backend reason code → i18n key under upload.uploadResult.
function uploadReasonKey(result: UploadResponse): string {
  switch (result.reason) {
    case "encrypted_pdf": return "upload.uploadResult.encrypted";
    case "scanned_image": return "upload.uploadResult.scanned";
    case "ocr_unavailable": return "upload.uploadResult.ocrFailed";
    case "parse_error": return "upload.uploadResult.failed";
    case "unrecognized_format": return "upload.uploadResult.empty";
    default: return "upload.uploadResult.empty";
  }
}

function CurrencyChips({ value, onChange, otherLabel }: { value: string; onChange: (c: string) => void; otherLabel: string }) {
  const [showFull, setShowFull] = useState(!TOP_CURRENCIES.includes(value));
  const chip = (active: boolean) =>
    `px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${active ? "bg-indigo-600 border-indigo-600 text-white" : "border-[#2A2A2A] text-gray-400 hover:text-gray-200 hover:border-[#3A3A3A]"}`;
  return (
    <div className="mb-4">
      <div className="flex flex-wrap gap-1.5">
        {TOP_CURRENCIES.map((c) => (
          <button key={c} type="button" onClick={() => { onChange(c); setShowFull(false); }} className={chip(value === c && !showFull)}>{c}</button>
        ))}
        <button type="button" onClick={() => setShowFull((s) => !s)} className={chip(showFull || !TOP_CURRENCIES.includes(value))}>{otherLabel}</button>
      </div>
      {showFull && <div className="mt-2"><CurrencySelect value={value} onChange={onChange} /></div>}
    </div>
  );
}

export default function OnboardingPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [goal, setGoal] = useState<Goal | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 2 fields
  const [spendingAmount, setSpendingAmount] = useState("");
  const [bankName, setBankName] = useState("");
  const [balance, setBalance] = useState("");
  const [debtDir, setDebtDir] = useState<"owed_to_me" | "i_owe">("owed_to_me");
  const [person, setPerson] = useState("");
  const [debtAmount, setDebtAmount] = useState("");
  const [currency, setCurrency] = useState(DEFAULT_CURRENCY);

  // Optional upload (spending path)
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<UploadResponse | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const user = getStoredUser();
    if (!user) { router.replace("/login"); return; }
    setUserEmail(user.email);
    if (user.onboarding_completed) router.replace("/home");
  }, [router]);

  const markDone = async () => {
    try {
      await completeOnboarding();
      const user = getStoredUser();
      if (user) setStoredUser({ ...user, onboarding_completed: true });
    } catch { /* non-blocking */ }
  };

  const handleSkip = async () => {
    await markDone();
    router.push("/home");
  };

  const handleFinish = async () => {
    await markDone();
    router.push("/home");
  };

  const handleUpload = async (file: File) => {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const result = await uploadStatement(file);
      setUploadResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setUploading(false);
    }
  };

  const chooseGoal = (g: Goal) => {
    setGoal(g);
    setError(null);
    setStep(2);
  };

  // Step 2 → create the one fast piece of real data, then advance to success.
  const submitStep2 = async () => {
    setError(null);
    setSubmitting(true);
    try {
      if (goal === "spending") {
        const amt = parseFloat(spendingAmount);
        if (!isNaN(amt) && amt > 0) {
          await createTransaction({
            amount: String(amt),
            transaction_type: "debit",
            description: t("onboarding.cs.spendingEntry"),
            transaction_date: new Date().toISOString().slice(0, 10),
            category: "diger",
          });
        }
        // upload (if any) already persisted via handleUpload
      } else if (goal === "networth") {
        const amt = parseFloat(balance);
        if (isNaN(amt) || amt <= 0) { setError(t("onboarding.cs.balanceError")); setSubmitting(false); return; }
        await createAsset({
          name: bankName.trim() || t("onboarding.cs.defaultBankName"),
          asset_type: "bank_account",
          currency: currency,
          current_value: String(amt),
        });
      } else if (goal === "debt") {
        const amt = parseFloat(debtAmount);
        if (!person.trim() || isNaN(amt) || amt <= 0) { setError(t("onboarding.cs.debtError")); setSubmitting(false); return; }
        if (debtDir === "owed_to_me") {
          await createReceivable({ from_person: person.trim(), amount: String(amt), currency: currency });
        } else {
          await createLiability({
            name: person.trim(),
            liability_type: "other_liability",
            currency: currency,
            total_amount: String(amt),
            remaining_amount: String(amt),
          });
        }
      }
      setStep(3);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setSubmitting(false);
    }
  };

  const progressPct = step === 1 ? 33 : step === 2 ? 66 : 100;
  const stepLabels = [t("onboarding.cs.stepGoal"), t("onboarding.cs.stepDetail"), t("onboarding.cs.stepDone")];

  const GOALS: { key: Goal; label: string; desc: string; icon: React.ReactNode }[] = [
    { key: "spending", label: t("onboarding.cs.goalSpending"), desc: t("onboarding.cs.goalSpendingDesc"), icon: <BarChart2 size={20} className="text-indigo-400" /> },
    { key: "networth", label: t("onboarding.cs.goalNetworth"), desc: t("onboarding.cs.goalNetworthDesc"), icon: <Scale size={20} className="text-emerald-400" /> },
    { key: "debt", label: t("onboarding.cs.goalDebt"), desc: t("onboarding.cs.goalDebtDesc"), icon: <CreditCard size={20} className="text-amber-400" /> },
  ];

  return (
    <div className="min-h-screen bg-[#0F0F0F] text-white flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        {/* Logo + progress */}
        <div className="mb-10">
          <p className="text-center text-gray-600 text-sm mb-5 font-medium tracking-widest uppercase">Mizan</p>
          <div className="w-full h-0.5 bg-[#2A2A2A] rounded-full overflow-hidden">
            <div className="h-full bg-indigo-500 rounded-full transition-all duration-500" style={{ width: `${progressPct}%` }} />
          </div>
          <div className="flex justify-between mt-2">
            {stepLabels.map((label, i) => (
              <span key={i} className={`text-xs ${step > i ? "text-indigo-400" : "text-gray-700"}`}>{label}</span>
            ))}
          </div>
        </div>

        {/* Step 1: Goal */}
        {step === 1 && (
          <div>
            <h1 className="text-3xl font-bold mb-2">{t("onboarding.cs.goalTitle")}</h1>
            {userEmail && <p className="text-gray-500 text-sm mb-6">{userEmail}</p>}
            <div className="space-y-3 mb-6">
              {GOALS.map((g) => (
                <button
                  key={g.key}
                  onClick={() => chooseGoal(g.key)}
                  className="w-full flex items-center gap-4 p-4 bg-[#1A1A1A] border border-[#2A2A2A] hover:border-indigo-600 rounded-xl text-left transition-colors group"
                >
                  <div className="w-10 h-10 rounded-lg bg-[#0F0F0F] border border-[#2A2A2A] flex items-center justify-center shrink-0">{g.icon}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-medium">{g.label}</p>
                    <p className="text-gray-500 text-xs">{g.desc}</p>
                  </div>
                  <ArrowRight size={16} className="text-gray-700 group-hover:text-indigo-400 transition-colors shrink-0" />
                </button>
              ))}
            </div>
            <button onClick={handleSkip} className="w-full text-center text-gray-600 hover:text-gray-400 text-sm transition-colors">
              {t("onboarding.skip")}
            </button>
          </div>
        )}

        {/* Step 2: One fast action */}
        {step === 2 && (
          <div>
            {goal === "spending" && (
              <>
                <h2 className="text-2xl font-bold mb-2">{t("onboarding.cs.spendingTitle")}</h2>
                <p className="text-gray-500 text-sm mb-6">{t("onboarding.cs.spendingSub")}</p>
                <div className="relative mb-4">
                  <input
                    type="number" min="0" inputMode="decimal" autoFocus
                    value={spendingAmount}
                    onChange={(e) => setSpendingAmount(e.target.value)}
                    placeholder={t("onboarding.cs.spendingPlaceholder")}
                    className={`${inputClass} text-lg pr-12`}
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 text-sm">{currency}</span>
                </div>

                {/* Optional upload */}
                {!uploadResult ? (
                  <div
                    onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) handleUpload(f); }}
                    onClick={() => fileInputRef.current?.click()}
                    className={`border border-dashed rounded-xl p-4 text-center cursor-pointer transition-all mb-6 ${dragging ? "border-indigo-500 bg-indigo-950/20" : "border-[#2A2A2A] hover:border-[#3A3A3A]"}`}
                  >
                    <input ref={fileInputRef} type="file" accept=".pdf,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); }} />
                    {uploading ? (
                      <span className="text-gray-400 text-sm">{t("onboarding.uploading")}</span>
                    ) : (
                      <span className="inline-flex items-center gap-2 text-gray-500 text-sm"><FileText size={15} /> {t("onboarding.cs.orUpload")}</span>
                    )}
                  </div>
                ) : uploadResult.status === "success" ? (
                  <div className="mb-6 p-3 rounded-xl bg-emerald-950/30 border border-emerald-800/40 text-emerald-300 text-sm text-center">
                    ✓ {uploadResult.transaction_count} {t("onboarding.uploadSuccess")}
                  </div>
                ) : (
                  <div className="mb-6 p-3 rounded-xl bg-amber-950/30 border border-amber-800/40 text-amber-300 text-sm text-center">
                    {t(uploadReasonKey(uploadResult))}
                  </div>
                )}
                {renderStep2Footer()}
              </>
            )}

            {goal === "networth" && (
              <>
                <h2 className="text-2xl font-bold mb-2">{t("onboarding.cs.networthTitle")}</h2>
                <p className="text-gray-500 text-sm mb-6">{t("onboarding.cs.networthSub")}</p>
                <label className="block text-xs text-gray-500 mb-1.5 uppercase tracking-wide">{t("onboarding.cs.bankNameLabel")}</label>
                <input value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder={t("onboarding.cs.bankNamePlaceholder")} className={`${inputClass} mb-4`} />
                <label className="block text-xs text-gray-500 mb-1.5 uppercase tracking-wide">{t("onboarding.cs.currencyLabel")}</label>
                <CurrencyChips value={currency} onChange={setCurrency} otherLabel={t("onboarding.cs.otherCurrency")} />
                <label className="block text-xs text-gray-500 mb-1.5 uppercase tracking-wide">{t("onboarding.cs.balanceLabel")}</label>
                <div className="relative mb-6">
                  <input type="number" min="0" inputMode="decimal" autoFocus value={balance} onChange={(e) => setBalance(e.target.value)} placeholder="0" className={`${inputClass} text-lg pr-12`} />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 text-sm">{currency}</span>
                </div>
                {renderStep2Footer()}
              </>
            )}

            {goal === "debt" && (
              <>
                <h2 className="text-2xl font-bold mb-2">{t("onboarding.cs.debtTitle")}</h2>
                <p className="text-gray-500 text-sm mb-6">{t("onboarding.cs.debtSub")}</p>
                <div className="flex gap-2 mb-4">
                  <button onClick={() => setDebtDir("owed_to_me")} className={`flex-1 py-2.5 rounded-xl text-sm font-medium border transition-colors ${debtDir === "owed_to_me" ? "bg-amber-950/40 border-amber-700 text-amber-300" : "border-[#2A2A2A] text-gray-500 hover:text-gray-300"}`}>
                    {t("onboarding.cs.debtOwedToMe")}
                  </button>
                  <button onClick={() => setDebtDir("i_owe")} className={`flex-1 py-2.5 rounded-xl text-sm font-medium border transition-colors ${debtDir === "i_owe" ? "bg-red-950/40 border-red-700 text-red-300" : "border-[#2A2A2A] text-gray-500 hover:text-gray-300"}`}>
                    {t("onboarding.cs.debtIOwe")}
                  </button>
                </div>
                <label className="block text-xs text-gray-500 mb-1.5 uppercase tracking-wide">{t("onboarding.cs.personLabel")}</label>
                <input value={person} onChange={(e) => setPerson(e.target.value)} placeholder={t("onboarding.cs.personPlaceholder")} className={`${inputClass} mb-4`} />
                <label className="block text-xs text-gray-500 mb-1.5 uppercase tracking-wide">{t("onboarding.cs.currencyLabel")}</label>
                <CurrencyChips value={currency} onChange={setCurrency} otherLabel={t("onboarding.cs.otherCurrency")} />
                <label className="block text-xs text-gray-500 mb-1.5 uppercase tracking-wide">{t("onboarding.cs.amountLabel")}</label>
                <div className="relative mb-6">
                  <input type="number" min="0" inputMode="decimal" value={debtAmount} onChange={(e) => setDebtAmount(e.target.value)} placeholder="0" className={`${inputClass} text-lg pr-12`} />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 text-sm">{currency}</span>
                </div>
                {renderStep2Footer()}
              </>
            )}
          </div>
        )}

        {/* Step 3: Done */}
        {step === 3 && (
          <div className="text-center">
            <div className="w-16 h-16 rounded-full bg-emerald-950 border border-emerald-800 flex items-center justify-center mx-auto mb-4">
              <span className="text-emerald-400 text-2xl">✓</span>
            </div>
            <h2 className="text-2xl font-bold mb-2">{t("onboarding.cs.doneTitle")}</h2>
            {(() => {
              const echo = step3Echo();
              const fallback = t("onboarding.cs.doneSub");
              return echo === fallback
                ? <p className="text-gray-500 text-sm mb-8">{fallback}</p>
                : <>
                    <p className="text-gray-300 text-sm mb-2">{echo}</p>
                    <p className="text-gray-500 text-sm mb-8">{fallback}</p>
                  </>;
            })()}
            <button onClick={handleFinish} className="w-full py-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 font-semibold transition-colors flex items-center justify-center gap-2">
              {t("onboarding.cs.seeDashboard")} <ArrowRight size={18} />
            </button>
          </div>
        )}
      </div>
    </div>
  );

  // Echo the value the user entered in Step 2, goal-appropriate. No interpolation in t().
  function step3Echo(): string {
    const money = (raw: string) => {
      const n = parseFloat(raw);
      if (isNaN(n) || n <= 0) return null;
      try {
        return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
      } catch {
        return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(n)} ${currency}`;
      }
    };
    if (goal === "networth") {
      const m = money(balance);
      if (m) return `${t("onboarding.cs.savedBalancePre")} ${m} ${t("onboarding.cs.savedBalancePost")}`;
    } else if (goal === "spending") {
      if (uploadResult && uploadResult.status === "success") {
        return `${t("onboarding.cs.savedUploadPre")} ${uploadResult.transaction_count} ${t("onboarding.cs.savedUploadPost")}`.trim();
      }
      const m = money(spendingAmount);
      if (m) return `${t("onboarding.cs.savedSpendingPre")}${m} ${t("onboarding.cs.savedSpendingPost")}`;
    } else if (goal === "debt") {
      const m = money(debtAmount);
      if (m) return `${t("onboarding.cs.savedDebtPre")} ${m} ${t("onboarding.cs.savedDebtPost")}`;
    }
    return t("onboarding.cs.doneSub");
  }

  function renderStep2Footer() {
    return (
      <>
        {error && <p className="text-red-400 text-sm mb-4">{error}</p>}
        <div className="flex gap-3">
          <button onClick={() => { setStep(1); setError(null); }} className="flex-1 py-3.5 rounded-xl bg-[#1A1A1A] border border-[#2A2A2A] hover:bg-[#2A2A2A] font-semibold transition-colors text-gray-300">
            ← {t("common.back")}
          </button>
          <button onClick={submitStep2} disabled={submitting} className="flex-[2] py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 font-semibold transition-colors flex items-center justify-center gap-2">
            {submitting ? t("onboarding.cs.saving") : <>{t("onboarding.continue")} <ArrowRight size={18} /></>}
          </button>
        </div>
        <button onClick={handleSkip} className="w-full mt-3 text-center text-gray-600 hover:text-gray-400 text-sm transition-colors">
          {t("onboarding.skip")}
        </button>
      </>
    );
  }
}
