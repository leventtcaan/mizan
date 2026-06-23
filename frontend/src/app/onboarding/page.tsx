"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getStoredUser, setStoredUser, completeOnboarding,
  uploadStatement, createTransaction, analyzeOnboarding,
  type UploadResponse, type OnboardingConflict,
} from "@/lib/api";
import { FileText, ArrowRight, Brain, CheckCircle } from "@/components/ui/Icons";
import CurrencySelect from "@/components/CurrencySelect";
import { useLanguage } from "@/lib/i18n";

// Linear, skippable flow — only the two highest-value questions:
//   1 Statements (upload as many as you like)  →  2 Monthly income  →  3 First impression
// Assets & liabilities moved to a one-time guided tour on Home (less friction, more honest).
type Step = 1 | 2 | 3;
const STEP_COUNT = 3;

const TOP_CURRENCIES = ["TRY", "USD", "EUR", "GBP", "CHF", "JPY", "AED"];

const inputClass = "w-full bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-600";

// Best-effort currency from the browser locale's region — avoids a hardcoded TRY default.
const LOCALE_CCY: Record<string, string> = {
  US: "USD", GB: "GBP", TR: "TRY", DE: "EUR", FR: "EUR", ES: "EUR", IT: "EUR",
  NL: "EUR", IE: "EUR", PT: "EUR", AT: "EUR", BE: "EUR", FI: "EUR", GR: "EUR",
  CH: "CHF", JP: "JPY", AE: "AED", SA: "SAR", CA: "CAD", AU: "AUD", IN: "INR",
  RU: "RUB", CN: "CNY", BR: "BRL", ZA: "ZAR", SE: "SEK", NO: "NOK", DK: "DKK",
  PL: "PLN", MX: "MXN", KR: "KRW", SG: "SGD", HK: "HKD", NZ: "NZD",
};
function guessLocaleCurrency(): string {
  try {
    const lang = typeof navigator !== "undefined" ? navigator.language : "en-US";
    const region = new Intl.Locale(lang).maximize().region || "US";
    return LOCALE_CCY[region] || "USD";
  } catch { return "USD"; }
}

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

type UploadEntry = { filename: string; result: UploadResponse };

export default function OnboardingPage() {
  const { t, lang } = useLanguage();
  const router = useRouter();

  const [step, setStep] = useState<Step>(1);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currency, setCurrency] = useState("USD");

  // Step 1 — statements (multiple)
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploads, setUploads] = useState<UploadEntry[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Step 2 — income (+ optional spending estimate when no statement)
  const [incomeInput, setIncomeInput] = useState("");
  const [irregularIncome, setIrregularIncome] = useState(false);
  const [spendingInput, setSpendingInput] = useState("");
  const prefillRef = useRef(false);

  // Step 3 — first impression
  const [analyzing, setAnalyzing] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<OnboardingConflict[]>([]);
  const [resolutions, setResolutions] = useState<Record<string, string>>({});
  const [creating, setCreating] = useState(false);
  const analyzedRef = useRef(false);

  const successUploads = uploads.filter((u) => u.result.status === "success");
  const hasStatement = successUploads.length > 0;
  const totalTxCount = successUploads.reduce((s, u) => s + u.result.transaction_count, 0);
  const parsedIncome = hasStatement
    ? successUploads.reduce((s, u) => s + parseFloat(u.result.parsed_income || "0"), 0) : null;
  const parsedExpenses = hasStatement
    ? successUploads.reduce((s, u) => s + parseFloat(u.result.parsed_expenses || "0"), 0) : null;

  useEffect(() => {
    const user = getStoredUser();
    if (!user) { router.replace("/login"); return; }
    setUserEmail(user.email);
    setCurrency(user.display_currency && user.display_currency.length ? user.display_currency : guessLocaleCurrency());
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
      setUploads((prev) => [...prev, { filename: file.name, result }]);
      // Adopt the statement's detected currency the first time we see one.
      if (result.status === "success" && result.currency && !hasStatement) setCurrency(result.currency);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // Pre-fill the income field with the salary/income seen in the statement(s), once.
  useEffect(() => {
    if (step === 2 && hasStatement && !prefillRef.current && !incomeInput && parsedIncome) {
      prefillRef.current = true;
      setIncomeInput(String(Math.round(parsedIncome)));
    }
  }, [step, hasStatement, parsedIncome, incomeInput]);

  // Step 3 runs the analysis pass once: conflict detection + AI first impression.
  useEffect(() => {
    if (step !== 3 || analyzedRef.current) return;
    analyzedRef.current = true;
    setAnalyzing(true);
    const inc = parseFloat(incomeInput);
    const spd = parseFloat(spendingInput);
    analyzeOnboarding({
      has_statement: hasStatement,
      parsed_income: parsedIncome,
      parsed_expenses: parsedExpenses,
      manual_income: !isNaN(inc) && inc > 0 ? inc : null,
      manual_spending: !hasStatement && !isNaN(spd) && spd > 0 ? spd : null,
      currency,
      lang,
    })
      .then((res) => {
        setSummary(res.summary);
        setConflicts(res.conflicts);
        const r: Record<string, string> = {};
        res.conflicts.forEach((c) => { r[c.field] = c.recommendation === "use_manual" ? "use_manual" : "use_statement"; });
        setResolutions(r);
      })
      .catch(() => { setSummary(null); setConflicts([]); })
      .finally(() => setAnalyzing(false));
  }, [step, hasStatement, parsedIncome, parsedExpenses, incomeInput, spendingInput, currency, lang]);

  // Final write: persist only clean data so estimates never double-count parsed data.
  const persistAndFinish = async () => {
    setCreating(true);
    setError(null);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const inc = parseFloat(incomeInput);
      const spd = parseFloat(spendingInput);
      const incomeDesc = irregularIncome ? t("onboarding.flow.incomeEntryIrregular") : t("onboarding.flow.incomeEntry");

      if (hasStatement) {
        // Income is already in the statement. Only add the part the user says is extra.
        const conflict = conflicts.find((c) => c.field === "income");
        let incomeToAdd = 0;
        if (conflict && !isNaN(inc) && inc > 0) {
          const res = resolutions.income || conflict.recommendation;
          if (res === "use_manual") incomeToAdd = Math.max(0, inc - (parsedIncome || 0));
          else if (res === "sum") incomeToAdd = inc;
          // use_statement → add nothing
        }
        if (incomeToAdd > 0) {
          await createTransaction({
            amount: String(incomeToAdd), transaction_type: "credit",
            description: incomeDesc, transaction_date: today,
            category: "diger", currency, source: "user_supplementary",
          });
        }
      } else {
        // No statement: estimates only, clearly sourced.
        if (!isNaN(inc) && inc > 0) {
          await createTransaction({
            amount: String(inc), transaction_type: "credit",
            description: incomeDesc, transaction_date: today,
            category: "diger", currency, source: "user_estimate",
          });
        }
        if (!isNaN(spd) && spd > 0) {
          await createTransaction({
            amount: String(spd), transaction_type: "debit",
            description: t("onboarding.flow.spendingEntry"), transaction_date: today,
            category: "diger", currency, source: "user_estimate",
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

  const exitOnboarding = async () => { await markDone(); router.push("/home"); };

  const next = () => { setError(null); setStep((s) => Math.min(STEP_COUNT, s + 1) as Step); };
  const back = () => { setError(null); analyzedRef.current = false; setStep((s) => Math.max(1, s - 1) as Step); };

  const progressPct = (step / STEP_COUNT) * 100;
  const incomeConflict = conflicts.find((c) => c.field === "income");

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

        {/* STEP 1 — STATEMENTS (multiple) */}
        {step === 1 && (
          <div>
            <h1 className="text-3xl font-bold mb-2">{t("onboarding.flow.s1Title")}</h1>
            <p className="text-gray-500 text-sm mb-3">{userEmail ? `${userEmail} · ` : ""}{t("onboarding.flow.s1Sub")}</p>
            <p className="text-indigo-300/80 text-xs mb-5">{t("onboarding.flow.s1Motivate")}</p>

            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) handleUpload(f); }}
              onClick={() => fileInputRef.current?.click()}
              className={`border border-dashed rounded-xl p-6 text-center cursor-pointer transition-all mb-3 ${dragging ? "border-indigo-500 bg-indigo-950/20" : "border-[#2A2A2A] hover:border-[#3A3A3A]"}`}
            >
              <input ref={fileInputRef} type="file" accept=".pdf,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); }} />
              <FileText size={22} className="text-indigo-400 mx-auto mb-2" />
              {uploading ? (
                <span className="text-gray-400 text-sm">{t("onboarding.uploading")}</span>
              ) : (
                <>
                  <p className="text-gray-300 text-sm">{uploads.length > 0 ? t("onboarding.flow.addAnother") : t("onboarding.dropHere")}</p>
                  <p className="text-gray-600 text-xs mt-1">{t("onboarding.pdfCsvMax")}</p>
                </>
              )}
            </div>

            {/* Running count — rewarding, not a chore */}
            {hasStatement && (
              <div className="mb-3 p-3 rounded-xl bg-emerald-950/30 border border-emerald-800/40">
                <p className="text-emerald-300 text-sm font-semibold mb-2">
                  {successUploads.length} {t("onboarding.flow.statementsLoaded")} · {totalTxCount} {t("onboarding.flow.txCount")}
                </p>
                <div className="space-y-1">
                  {uploads.map((u, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      {u.result.status === "success" ? (
                        <><CheckCircle size={13} className="text-emerald-400 shrink-0" /><span className="text-gray-400 truncate">{u.filename}</span><span className="text-gray-600">· {u.result.transaction_count}</span></>
                      ) : (
                        <><span className="text-amber-400 shrink-0">!</span><span className="text-amber-300/80 truncate">{u.filename}</span></>
                      )}
                    </div>
                  ))}
                </div>
                <div className="flex gap-4 text-xs mt-2 pt-2 border-t border-emerald-800/30">
                  <span className="text-gray-400">{t("onboarding.flow.incomeSeen")}: <span className="text-emerald-400 font-semibold">{money(parsedIncome)}</span></span>
                  <span className="text-gray-400">{t("onboarding.flow.expensesSeen")}: <span className="text-red-400 font-semibold">{money(parsedExpenses)}</span></span>
                </div>
              </div>
            )}

            {/* Failed/empty uploads not already in the success list */}
            {uploads.some((u) => u.result.status !== "success") && !hasStatement && (
              <div className="mb-3 p-3 rounded-xl bg-amber-950/30 border border-amber-800/40 text-amber-300 text-sm text-center">
                {t(uploadReasonKey(uploads[uploads.length - 1].result))}
              </div>
            )}

            {error && <p className="text-red-400 text-sm mb-3">{error}</p>}

            <button onClick={next} className="w-full py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 font-semibold transition-colors flex items-center justify-center gap-2">
              {hasStatement ? t("onboarding.continue") : t("onboarding.flow.enterManually")} <ArrowRight size={18} />
            </button>
            <button onClick={exitOnboarding} className="w-full mt-3 text-center text-gray-600 hover:text-gray-400 text-sm transition-colors">
              {t("onboarding.flow.skipForNow")}
            </button>
          </div>
        )}

        {/* STEP 2 — MONTHLY INCOME */}
        {step === 2 && (
          <div>
            <h2 className="text-2xl font-bold mb-2">{t("onboarding.flow.incomeTitle")}</h2>
            {hasStatement && parsedIncome ? (
              <p className="text-gray-400 text-sm mb-5">
                {t("onboarding.flow.incomeDetectedPre")} <span className="text-emerald-400 font-semibold">{money(parsedIncome)}</span> {t("onboarding.flow.incomeDetectedPost")}
              </p>
            ) : (
              <p className="text-gray-500 text-sm mb-5">{t("onboarding.flow.incomeWhyMatters")}</p>
            )}

            {!hasStatement && (
              <>
                <label className="block text-xs text-gray-500 mb-1.5 uppercase tracking-wide">{t("onboarding.flow.currencyLabel")}</label>
                <CurrencyChips value={currency} onChange={setCurrency} otherLabel={t("onboarding.flow.otherCurrency")} />
              </>
            )}

            {/* Irregular income toggle */}
            <button
              type="button"
              onClick={() => setIrregularIncome((v) => !v)}
              className={`mb-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${irregularIncome ? "bg-amber-950/40 border-amber-700 text-amber-300" : "border-[#2A2A2A] text-gray-400 hover:text-gray-200"}`}
            >
              <span className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${irregularIncome ? "bg-amber-500 border-amber-500" : "border-[#3A3A3A]"}`}>
                {irregularIncome && <span className="w-1.5 h-1.5 rounded-full bg-black" />}
              </span>
              {t("onboarding.flow.irregularIncome")}
            </button>

            <label className="block text-xs text-gray-500 mb-1.5 uppercase tracking-wide">
              {irregularIncome ? t("onboarding.flow.avgIncomeLabel") : t("onboarding.flow.incomeLabel")}
            </label>
            <div className="relative mb-5">
              <input type="number" min="0" inputMode="decimal" autoFocus value={incomeInput} onChange={(e) => setIncomeInput(e.target.value)} placeholder="0" className={`${inputClass} text-lg pr-12`} />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 text-sm">{currency}</span>
            </div>

            {/* Optional spending estimate only matters when there's no statement to read it from */}
            {!hasStatement && (
              <>
                <label className="block text-xs text-gray-500 mb-1.5 uppercase tracking-wide">{t("onboarding.flow.spendingLabel")}</label>
                <div className="relative mb-3">
                  <input type="number" min="0" inputMode="decimal" value={spendingInput} onChange={(e) => setSpendingInput(e.target.value)} placeholder="0" className={`${inputClass} pr-12`} />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 text-sm">{currency}</span>
                </div>
                <p className="text-gray-600 text-xs mb-6">{t("onboarding.flow.estimateHint")}</p>
              </>
            )}

            <NavButtons onBack={back} onNext={next} onExit={exitOnboarding} t={t} />
          </div>
        )}

        {/* STEP 3 — FIRST IMPRESSION */}
        {step === 3 && (
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

                {incomeConflict && (
                  <div className="mb-5 p-3 rounded-xl bg-amber-950/20 border border-amber-800/30">
                    <p className="text-gray-200 text-sm mb-1.5">
                      {t("onboarding.flow.conflict.incomeMismatchPre")} <b className="text-white">{money(incomeConflict.manual)}</b>{" "}
                      {t("onboarding.flow.conflict.incomeMismatchMid")} <b className="text-white">{money(incomeConflict.parsed)}</b>{" "}
                      {t("onboarding.flow.conflict.incomeMismatchPost")}
                    </p>
                    <p className="text-gray-500 text-xs mb-3">{t("onboarding.flow.conflict.mismatchHint")}</p>
                    <div className="space-y-2">
                      <ConflictOption active={resolutions.income === "use_statement"} onClick={() => setResolutions((r) => ({ ...r, income: "use_statement" }))}
                        label={`${t("onboarding.flow.conflict.useStatement")} (${money(incomeConflict.parsed)})`} />
                      <ConflictOption active={resolutions.income === "use_manual"} onClick={() => setResolutions((r) => ({ ...r, income: "use_manual" }))}
                        label={`${t("onboarding.flow.conflict.useManual")} (${money(incomeConflict.manual)})`} />
                      {incomeConflict.allow_sum && (
                        <ConflictOption active={resolutions.income === "sum"} onClick={() => setResolutions((r) => ({ ...r, income: "sum" }))}
                          label={`${t("onboarding.flow.conflict.useSum")} (${money(incomeConflict.parsed + incomeConflict.manual)})`} />
                      )}
                    </div>
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
            <button onClick={exitOnboarding} className="w-full mt-3 text-center text-gray-600 hover:text-gray-400 text-sm transition-colors">
              {t("onboarding.flow.skipForNow")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ConflictOption({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick}
      className={`w-full text-left py-2.5 px-3 rounded-lg text-xs font-medium border transition-colors ${active ? "bg-indigo-600 border-indigo-600 text-white" : "border-[#2A2A2A] text-gray-300 hover:text-white hover:border-[#3A3A3A]"}`}>
      {label}
    </button>
  );
}

function NavButtons({ onBack, onNext, onExit, t }: { onBack: () => void; onNext: () => void; onExit: () => void; t: (k: string) => string }) {
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
      <button onClick={onExit} className="w-full mt-3 text-center text-gray-600 hover:text-gray-400 text-sm transition-colors">
        {t("onboarding.flow.skipForNow")}
      </button>
    </>
  );
}
