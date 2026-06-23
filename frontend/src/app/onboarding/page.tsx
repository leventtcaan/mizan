"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getStoredUser, setStoredUser, getDefaultCurrency, completeOnboarding,
  uploadStatement, createAsset, createLiability, createTransaction, analyzeOnboarding,
  type UploadResponse, type OnboardingConflict, type TransactionSource,
} from "@/lib/api";
import { FileText, ArrowRight, Brain } from "@/components/ui/Icons";
import CurrencySelect from "@/components/CurrencySelect";
import { useLanguage } from "@/lib/i18n";

// Linear, skippable, < 30s-per-step flow:
//   1 Statement  →  2 Income & spending  →  3 Top asset  →  4 Debts  →  5 First impression
type Step = 1 | 2 | 3 | 4 | 5;
const STEP_COUNT = 5;

const TOP_CURRENCIES = ["TRY", "USD", "EUR", "GBP", "CHF", "JPY", "AED"];
const ASSET_TYPES = ["bank_account", "real_estate", "crypto", "stock", "other_asset"] as const;
const LIAB_TYPES = ["mortgage", "auto_loan", "credit_card", "personal_loan", "other_liability"] as const;

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
  const { t, lang } = useLanguage();
  const router = useRouter();

  const [step, setStep] = useState<Step>(1);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currency, setCurrency] = useState("TRY");

  // Step 1 — statement
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<UploadResponse | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Step 2 — income & spending (semantics depend on whether a statement was parsed)
  const [incomeInput, setIncomeInput] = useState("");
  const [spendingInput, setSpendingInput] = useState("");

  // Step 3 — top asset
  const [assetType, setAssetType] = useState<typeof ASSET_TYPES[number]>("bank_account");
  const [assetName, setAssetName] = useState("");
  const [assetValue, setAssetValue] = useState("");

  // Step 4 — debt
  const [hasDebt, setHasDebt] = useState<boolean | null>(null);
  const [liabType, setLiabType] = useState<typeof LIAB_TYPES[number]>("credit_card");
  const [liabRemaining, setLiabRemaining] = useState("");
  const [liabMonthly, setLiabMonthly] = useState("");

  // Step 5 — first impression
  const [analyzing, setAnalyzing] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<OnboardingConflict[]>([]);
  const [resolutions, setResolutions] = useState<{ income?: "skip" | "add"; spending?: "skip" | "add" }>({});
  const [creating, setCreating] = useState(false);
  const analyzedRef = useRef(false);

  const hasStatement = uploadResult?.status === "success";
  const parsedIncome = hasStatement ? parseFloat(uploadResult!.parsed_income || "0") : null;
  const parsedExpenses = hasStatement ? parseFloat(uploadResult!.parsed_expenses || "0") : null;

  useEffect(() => {
    const user = getStoredUser();
    if (!user) { router.replace("/login"); return; }
    setUserEmail(user.email);
    setCurrency(getDefaultCurrency());
    if (user.onboarding_completed) router.replace("/home");
  }, [router]);

  const money = useCallback((n: number | null, ccy = currency) => {
    if (n == null || isNaN(n)) return "—";
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency: ccy, maximumFractionDigits: 0 }).format(n);
    } catch {
      return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(n)} ${ccy}`;
    }
  }, [currency]);

  const markDone = async () => {
    try {
      await completeOnboarding();
      const user = getStoredUser();
      if (user) setStoredUser({ ...user, onboarding_completed: true });
    } catch { /* non-blocking */ }
  };

  const handleUpload = async (file: File) => {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const result = await uploadStatement(file);
      setUploadResult(result);
      if (result.status === "success" && result.currency) setCurrency(result.currency);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setUploading(false);
    }
  };

  // Step 5 runs the analysis pass once: conflict detection + AI first impression.
  useEffect(() => {
    if (step !== 5 || analyzedRef.current) return;
    analyzedRef.current = true;
    setAnalyzing(true);
    const inc = parseFloat(incomeInput);
    const spd = parseFloat(spendingInput);
    const av = parseFloat(assetValue);
    const rem = parseFloat(liabRemaining);
    const mon = parseFloat(liabMonthly);
    analyzeOnboarding({
      has_statement: !!hasStatement,
      parsed_income: parsedIncome,
      parsed_expenses: parsedExpenses,
      manual_income: !isNaN(inc) && inc > 0 ? inc : null,
      manual_spending: !isNaN(spd) && spd > 0 ? spd : null,
      asset: !isNaN(av) && av > 0 ? { asset_type: assetType, value: av } : null,
      liability: hasDebt && !isNaN(rem) && rem > 0
        ? { liability_type: liabType, remaining: rem, monthly_payment: !isNaN(mon) && mon > 0 ? mon : null }
        : null,
      currency,
      lang,
    })
      .then((res) => {
        setSummary(res.summary);
        setConflicts(res.conflicts);
        const r: { income?: "skip" | "add"; spending?: "skip" | "add" } = {};
        res.conflicts.forEach((c) => {
          r[c.field] = c.recommendation === "use_statement" ? "skip" : "add";
        });
        setResolutions(r);
      })
      .catch(() => { setSummary(null); setConflicts([]); })
      .finally(() => setAnalyzing(false));
  }, [step, hasStatement, parsedIncome, parsedExpenses, incomeInput, spendingInput, assetValue,
      liabRemaining, liabMonthly, hasDebt, assetType, liabType, currency, lang]);

  // Final write: only persist what's clean. Conflicts resolved to "skip" are not written,
  // so estimates never get double-counted against parsed statement data.
  const persistAndFinish = async () => {
    setCreating(true);
    setError(null);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const src: TransactionSource = hasStatement ? "user_supplementary" : "user_estimate";
      const inc = parseFloat(incomeInput);
      const spd = parseFloat(spendingInput);
      const incomeConflict = conflicts.find((c) => c.field === "income");
      const spendConflict = conflicts.find((c) => c.field === "spending");
      const skipIncome = incomeConflict ? resolutions.income === "skip" : false;
      const skipSpending = spendConflict ? resolutions.spending === "skip" : false;

      if (!isNaN(inc) && inc > 0 && !skipIncome) {
        await createTransaction({
          amount: String(inc), transaction_type: "credit",
          description: t("onboarding.flow.incomeEntry"), transaction_date: today,
          category: "diger", currency, source: src,
        });
      }
      if (!isNaN(spd) && spd > 0 && !skipSpending) {
        await createTransaction({
          amount: String(spd), transaction_type: "debit",
          description: t("onboarding.flow.spendingEntry"), transaction_date: today,
          category: "diger", currency, source: src,
        });
      }

      const av = parseFloat(assetValue);
      if (!isNaN(av) && av > 0) {
        await createAsset({
          name: assetName.trim() || t(`onboarding.flow.asset.${assetType}`),
          asset_type: assetType, currency, current_value: String(av),
        });
      }

      if (hasDebt) {
        const rem = parseFloat(liabRemaining);
        if (!isNaN(rem) && rem > 0) {
          const mon = parseFloat(liabMonthly);
          await createLiability({
            name: t(`onboarding.flow.liab.${liabType}`), liability_type: liabType, currency,
            total_amount: String(rem), remaining_amount: String(rem),
            monthly_payment: !isNaN(mon) && mon > 0 ? String(mon) : undefined,
          });
        }
      }

      await markDone();
      router.push("/home");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
      setCreating(false);
    }
  };

  const skipAll = async () => { await markDone(); router.push("/home"); };

  const next = () => { setError(null); setStep((s) => Math.min(STEP_COUNT, s + 1) as Step); };
  const back = () => { setError(null); analyzedRef.current = false; setStep((s) => Math.max(1, s - 1) as Step); };

  const progressPct = (step / STEP_COUNT) * 100;

  return (
    <div className="min-h-screen bg-[#0F0F0F] text-white flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        {/* Logo + progress */}
        <div className="mb-10">
          <p className="text-center text-gray-600 text-sm mb-5 font-medium tracking-widest uppercase">Mizan</p>
          <div className="w-full h-0.5 bg-[#2A2A2A] rounded-full overflow-hidden">
            <div className="h-full bg-indigo-500 rounded-full transition-all duration-500" style={{ width: `${progressPct}%` }} />
          </div>
          <p className="text-right text-[11px] text-gray-700 mt-2">{step} / {STEP_COUNT}</p>
        </div>

        {/* STEP 1 — STATEMENT */}
        {step === 1 && (
          <div>
            <h1 className="text-3xl font-bold mb-2">{t("onboarding.flow.s1Title")}</h1>
            <p className="text-gray-500 text-sm mb-6">{userEmail ? `${userEmail} · ` : ""}{t("onboarding.flow.s1Sub")}</p>

            {!uploadResult || uploadResult.status !== "success" ? (
              <div
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) handleUpload(f); }}
                onClick={() => fileInputRef.current?.click()}
                className={`border border-dashed rounded-xl p-8 text-center cursor-pointer transition-all mb-3 ${dragging ? "border-indigo-500 bg-indigo-950/20" : "border-[#2A2A2A] hover:border-[#3A3A3A]"}`}
              >
                <input ref={fileInputRef} type="file" accept=".pdf,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); }} />
                <FileText size={22} className="text-indigo-400 mx-auto mb-2" />
                {uploading ? (
                  <span className="text-gray-400 text-sm">{t("onboarding.uploading")}</span>
                ) : (
                  <>
                    <p className="text-gray-300 text-sm">{t("onboarding.dropHere")}</p>
                    <p className="text-gray-600 text-xs mt-1">{t("onboarding.pdfCsvMax")}</p>
                  </>
                )}
              </div>
            ) : (
              <div className="mb-3 p-4 rounded-xl bg-emerald-950/30 border border-emerald-800/40 text-sm">
                <p className="text-emerald-300 font-medium mb-2">✓ {uploadResult.transaction_count} {t("onboarding.uploadSuccess")}</p>
                <div className="flex gap-4 text-xs">
                  <span className="text-gray-400">{t("onboarding.flow.incomeSeen")}: <span className="text-emerald-400 font-semibold">{money(parsedIncome)}</span></span>
                  <span className="text-gray-400">{t("onboarding.flow.expensesSeen")}: <span className="text-red-400 font-semibold">{money(parsedExpenses)}</span></span>
                </div>
              </div>
            )}

            {uploadResult && uploadResult.status !== "success" && (
              <div className="mb-3 p-3 rounded-xl bg-amber-950/30 border border-amber-800/40 text-amber-300 text-sm text-center">
                {t(uploadReasonKey(uploadResult))}
              </div>
            )}

            {error && <p className="text-red-400 text-sm mb-3">{error}</p>}

            <button onClick={next} className="w-full py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 font-semibold transition-colors flex items-center justify-center gap-2">
              {hasStatement ? t("onboarding.continue") : t("onboarding.flow.enterManually")} <ArrowRight size={18} />
            </button>
            <button onClick={skipAll} className="w-full mt-3 text-center text-gray-600 hover:text-gray-400 text-sm transition-colors">
              {t("onboarding.skip")}
            </button>
          </div>
        )}

        {/* STEP 2 — INCOME & SPENDING (adaptive) */}
        {step === 2 && (
          <div>
            {hasStatement ? (
              <>
                <h2 className="text-2xl font-bold mb-2">{t("onboarding.flow.s2aTitle")}</h2>
                <p className="text-gray-500 text-sm mb-5">{t("onboarding.flow.s2aSub")}</p>
                <div className="mb-5 p-3 rounded-xl bg-[#1A1A1A] border border-[#2A2A2A] flex gap-4 text-xs">
                  <span className="text-gray-400">{t("onboarding.flow.incomeSeen")}: <span className="text-emerald-400 font-semibold">{money(parsedIncome)}</span></span>
                  <span className="text-gray-400">{t("onboarding.flow.expensesSeen")}: <span className="text-red-400 font-semibold">{money(parsedExpenses)}</span></span>
                </div>
                <label className="block text-xs text-gray-500 mb-1.5 uppercase tracking-wide">{t("onboarding.flow.extraIncomeLabel")}</label>
                <div className="relative mb-4">
                  <input type="number" min="0" inputMode="decimal" value={incomeInput} onChange={(e) => setIncomeInput(e.target.value)} placeholder="0" className={`${inputClass} pr-12`} />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 text-sm">{currency}</span>
                </div>
                <label className="block text-xs text-gray-500 mb-1.5 uppercase tracking-wide">{t("onboarding.flow.extraSpendingLabel")}</label>
                <div className="relative mb-6">
                  <input type="number" min="0" inputMode="decimal" value={spendingInput} onChange={(e) => setSpendingInput(e.target.value)} placeholder="0" className={`${inputClass} pr-12`} />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 text-sm">{currency}</span>
                </div>
              </>
            ) : (
              <>
                <h2 className="text-2xl font-bold mb-2">{t("onboarding.flow.s2bTitle")}</h2>
                <p className="text-gray-500 text-sm mb-5">{t("onboarding.flow.s2bSub")}</p>
                <label className="block text-xs text-gray-500 mb-1.5 uppercase tracking-wide">{t("onboarding.flow.currencyLabel")}</label>
                <CurrencyChips value={currency} onChange={setCurrency} otherLabel={t("onboarding.flow.otherCurrency")} />
                <label className="block text-xs text-gray-500 mb-1.5 uppercase tracking-wide">{t("onboarding.flow.incomeLabel")}</label>
                <div className="relative mb-4">
                  <input type="number" min="0" inputMode="decimal" value={incomeInput} onChange={(e) => setIncomeInput(e.target.value)} placeholder="0" className={`${inputClass} pr-12`} />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 text-sm">{currency}</span>
                </div>
                <label className="block text-xs text-gray-500 mb-1.5 uppercase tracking-wide">{t("onboarding.flow.spendingLabel")}</label>
                <div className="relative mb-3">
                  <input type="number" min="0" inputMode="decimal" value={spendingInput} onChange={(e) => setSpendingInput(e.target.value)} placeholder="0" className={`${inputClass} pr-12`} />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 text-sm">{currency}</span>
                </div>
                <p className="text-gray-600 text-xs mb-6">{t("onboarding.flow.estimateHint")}</p>
              </>
            )}
            <NavButtons onBack={back} onNext={next} onSkip={next} t={t} />
          </div>
        )}

        {/* STEP 3 — TOP ASSET */}
        {step === 3 && (
          <div>
            <h2 className="text-2xl font-bold mb-2">{t("onboarding.flow.s3Title")}</h2>
            <p className="text-gray-500 text-sm mb-5">{t("onboarding.flow.s3Sub")}</p>
            <label className="block text-xs text-gray-500 mb-1.5 uppercase tracking-wide">{t("onboarding.flow.assetTypeLabel")}</label>
            <div className="flex flex-wrap gap-1.5 mb-4">
              {ASSET_TYPES.map((a) => (
                <button key={a} type="button" onClick={() => setAssetType(a)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${assetType === a ? "bg-indigo-600 border-indigo-600 text-white" : "border-[#2A2A2A] text-gray-400 hover:text-gray-200 hover:border-[#3A3A3A]"}`}>
                  {t(`onboarding.flow.asset.${a}`)}
                </button>
              ))}
            </div>
            <label className="block text-xs text-gray-500 mb-1.5 uppercase tracking-wide">{t("onboarding.flow.assetNameLabel")}</label>
            <input value={assetName} onChange={(e) => setAssetName(e.target.value)} placeholder={t("onboarding.flow.assetNamePlaceholder")} className={`${inputClass} mb-4`} />
            <label className="block text-xs text-gray-500 mb-1.5 uppercase tracking-wide">{t("onboarding.flow.assetValueLabel")}</label>
            <div className="relative mb-6">
              <input type="number" min="0" inputMode="decimal" value={assetValue} onChange={(e) => setAssetValue(e.target.value)} placeholder="0" className={`${inputClass} text-lg pr-12`} />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 text-sm">{currency}</span>
            </div>
            <NavButtons onBack={back} onNext={next} onSkip={next} t={t} />
          </div>
        )}

        {/* STEP 4 — DEBT */}
        {step === 4 && (
          <div>
            <h2 className="text-2xl font-bold mb-2">{t("onboarding.flow.s4Title")}</h2>
            <p className="text-gray-500 text-sm mb-5">{t("onboarding.flow.s4Sub")}</p>
            <div className="flex gap-2 mb-5">
              <button onClick={() => setHasDebt(false)} className={`flex-1 py-2.5 rounded-xl text-sm font-medium border transition-colors ${hasDebt === false ? "bg-emerald-950/40 border-emerald-700 text-emerald-300" : "border-[#2A2A2A] text-gray-500 hover:text-gray-300"}`}>
                {t("onboarding.flow.noDebt")}
              </button>
              <button onClick={() => setHasDebt(true)} className={`flex-1 py-2.5 rounded-xl text-sm font-medium border transition-colors ${hasDebt === true ? "bg-red-950/40 border-red-700 text-red-300" : "border-[#2A2A2A] text-gray-500 hover:text-gray-300"}`}>
                {t("onboarding.flow.yesDebt")}
              </button>
            </div>

            {hasDebt && (
              <>
                <label className="block text-xs text-gray-500 mb-1.5 uppercase tracking-wide">{t("onboarding.flow.liabTypeLabel")}</label>
                <div className="flex flex-wrap gap-1.5 mb-4">
                  {LIAB_TYPES.map((l) => (
                    <button key={l} type="button" onClick={() => setLiabType(l)}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${liabType === l ? "bg-indigo-600 border-indigo-600 text-white" : "border-[#2A2A2A] text-gray-400 hover:text-gray-200 hover:border-[#3A3A3A]"}`}>
                      {t(`onboarding.flow.liab.${l}`)}
                    </button>
                  ))}
                </div>
                <label className="block text-xs text-gray-500 mb-1.5 uppercase tracking-wide">{t("onboarding.flow.remainingLabel")}</label>
                <div className="relative mb-4">
                  <input type="number" min="0" inputMode="decimal" value={liabRemaining} onChange={(e) => setLiabRemaining(e.target.value)} placeholder="0" className={`${inputClass} pr-12`} />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 text-sm">{currency}</span>
                </div>
                <label className="block text-xs text-gray-500 mb-1.5 uppercase tracking-wide">{t("onboarding.flow.monthlyLabel")}</label>
                <div className="relative mb-6">
                  <input type="number" min="0" inputMode="decimal" value={liabMonthly} onChange={(e) => setLiabMonthly(e.target.value)} placeholder="0" className={`${inputClass} pr-12`} />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 text-sm">{currency}</span>
                </div>
              </>
            )}
            <NavButtons onBack={back} onNext={next} onSkip={next} t={t} />
          </div>
        )}

        {/* STEP 5 — FIRST IMPRESSION */}
        {step === 5 && (
          <div>
            <div className="flex items-center gap-2 mb-4">
              <Brain size={18} className="text-indigo-400" />
              <h2 className="text-2xl font-bold">{t("onboarding.flow.impressionTitle")}</h2>
            </div>

            {analyzing ? (
              <div className="space-y-3 mb-6">
                <div className="h-3 w-full bg-[#2A2A2A] rounded animate-pulse" />
                <div className="h-3 w-2/3 bg-[#2A2A2A] rounded animate-pulse" />
                <p className="text-gray-500 text-sm">{t("onboarding.flow.analyzing")}</p>
              </div>
            ) : (
              <>
                {summary ? (
                  <div className="mb-5 p-4 rounded-xl bg-indigo-950/30 border border-indigo-800/40">
                    <p className="text-gray-100 text-sm leading-relaxed">{summary}</p>
                  </div>
                ) : (
                  <p className="text-gray-400 text-sm mb-5">{t("onboarding.flow.impressionFallback")}</p>
                )}

                {conflicts.length > 0 && (
                  <div className="mb-5 space-y-3">
                    <p className="text-xs font-bold tracking-wider text-amber-400 uppercase">{t("onboarding.flow.confirmTitle")}</p>
                    {conflicts.map((c) => (
                      <div key={c.field} className="p-3 rounded-xl bg-amber-950/20 border border-amber-800/30">
                        <p className="text-gray-200 text-sm mb-2">{t(`onboarding.flow.conflict.${c.kind}`)}</p>
                        <div className="flex gap-4 text-xs mb-3">
                          <span className="text-gray-500">{t("onboarding.flow.conflictStatementLabel")}: <span className="text-gray-300 font-semibold">{money(c.parsed)}</span></span>
                          <span className="text-gray-500">{t("onboarding.flow.conflictYouLabel")}: <span className="text-gray-300 font-semibold">{money(c.manual)}</span></span>
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => setResolutions((r) => ({ ...r, [c.field]: "skip" }))}
                            className={`flex-1 py-2 rounded-lg text-xs font-medium border transition-colors ${resolutions[c.field] === "skip" ? "bg-indigo-600 border-indigo-600 text-white" : "border-[#2A2A2A] text-gray-400 hover:text-gray-200"}`}>
                            {t("onboarding.flow.choiceSkip")}
                          </button>
                          <button onClick={() => setResolutions((r) => ({ ...r, [c.field]: "add" }))}
                            className={`flex-1 py-2 rounded-lg text-xs font-medium border transition-colors ${resolutions[c.field] === "add" ? "bg-indigo-600 border-indigo-600 text-white" : "border-[#2A2A2A] text-gray-400 hover:text-gray-200"}`}>
                            {t("onboarding.flow.choiceAdd")}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {error && <p className="text-red-400 text-sm mb-4">{error}</p>}

            <div className="flex gap-3">
              <button onClick={back} disabled={creating} className="flex-1 py-3.5 rounded-xl bg-[#1A1A1A] border border-[#2A2A2A] hover:bg-[#2A2A2A] font-semibold transition-colors text-gray-300 disabled:opacity-50">
                ← {t("common.back")}
              </button>
              <button onClick={persistAndFinish} disabled={creating || analyzing} className="flex-[2] py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 font-semibold transition-colors flex items-center justify-center gap-2">
                {creating ? t("onboarding.flow.creating") : <>{t("onboarding.flow.seeDashboard")} <ArrowRight size={18} /></>}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function NavButtons({ onBack, onNext, onSkip, t }: { onBack: () => void; onNext: () => void; onSkip: () => void; t: (k: string) => string }) {
  return (
    <>
      <div className="flex gap-3">
        <button onClick={onBack} className="flex-1 py-3.5 rounded-xl bg-[#1A1A1A] border border-[#2A2A2A] hover:bg-[#2A2A2A] font-semibold transition-colors text-gray-300">
          ← {t("common.back")}
        </button>
        <button onClick={onNext} className="flex-[2] py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 font-semibold transition-colors flex items-center justify-center gap-2">
          {t("onboarding.continue")} <ArrowRight size={18} />
        </button>
      </div>
      <button onClick={onSkip} className="w-full mt-3 text-center text-gray-600 hover:text-gray-400 text-sm transition-colors">
        {t("onboarding.skip")}
      </button>
    </>
  );
}
