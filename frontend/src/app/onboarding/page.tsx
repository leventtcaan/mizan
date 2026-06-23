"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getStoredUser, setStoredUser, completeOnboarding,
  uploadStatement, analyzeOnboarding,
  type UploadResponse,
} from "@/lib/api";
import { FileText, ArrowRight, Brain, CheckCircle } from "@/components/ui/Icons";
import { useLanguage } from "@/lib/i18n";

// Onboarding is now just: upload statement(s) → AI first impression → Home.
// No manual income/spending, no asset/liability form, no conflict resolution.
type Step = 1 | 2;
const STEP_COUNT = 2;

// Best-effort currency from the browser locale's region — only used to format the
// parsed-statement totals when the statement itself didn't reveal a currency.
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

  // Step 2 — first impression
  const [analyzing, setAnalyzing] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
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

  const goHome = async () => {
    setFinishing(true);
    await markDone();
    router.push("/home");
  };

  const handleUpload = async (file: File) => {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const result = await uploadStatement(file);
      setUploads((prev) => [...prev, { filename: file.name, result }]);
      if (result.status === "success" && result.currency && !hasStatement) setCurrency(result.currency);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // Step 2 runs the first-impression analysis once. With no statement, we skip the call
  // and show a plain welcome instead.
  useEffect(() => {
    if (step !== 2 || analyzedRef.current) return;
    analyzedRef.current = true;
    if (!hasStatement) { setSummary(null); return; }
    setAnalyzing(true);
    analyzeOnboarding({
      has_statement: true,
      parsed_income: parsedIncome,
      parsed_expenses: parsedExpenses,
      currency,
      lang,
    })
      .then((res) => setSummary(res.summary))
      .catch(() => setSummary(null))
      .finally(() => setAnalyzing(false));
  }, [step, hasStatement, parsedIncome, parsedExpenses, currency, lang]);

  // With a parsed statement, route through /review so the user can catch parse errors
  // before the brief narrates them as truth; review then hands off to /brief.
  // With no statement, fall through to step 2's plain welcome.
  const next = async () => {
    setError(null);
    if (hasStatement) {
      await markDone();
      const ids = successUploads.map((u) => u.result.job_id).join(",");
      router.push(`/review?batch_ids=${ids}`);
      return;
    }
    setStep(2);
  };
  const back = () => { setError(null); analyzedRef.current = false; setSummary(null); setStep(1); };

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
              <input ref={fileInputRef} type="file" accept=".pdf,.csv,.xlsx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); }} />
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

            {/* Failed/empty uploads when nothing succeeded yet */}
            {uploads.some((u) => u.result.status !== "success") && !hasStatement && (
              <div className="mb-3 p-3 rounded-xl bg-amber-950/30 border border-amber-800/40 text-amber-300 text-sm text-center">
                {t(uploadReasonKey(uploads[uploads.length - 1].result))}
              </div>
            )}

            {error && <p className="text-red-400 text-sm mb-3">{error}</p>}

            <button onClick={next} className="w-full py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 font-semibold transition-colors flex items-center justify-center gap-2">
              {t("onboarding.continue")} <ArrowRight size={18} />
            </button>
            <button onClick={goHome} className="w-full mt-3 text-center text-gray-600 hover:text-gray-400 text-sm transition-colors">
              {t("onboarding.flow.skipForNow")}
            </button>
          </div>
        )}

        {/* STEP 2 — FIRST IMPRESSION (or plain welcome when no statement) */}
        {step === 2 && (
          <div>
            <div className="flex items-center gap-2 mb-4">
              <Brain size={18} className="text-indigo-400" />
              <h2 className="text-2xl font-bold">{hasStatement ? t("onboarding.flow.impressionTitle") : t("onboarding.flow.welcomeTitle")}</h2>
            </div>

            {analyzing ? (
              <div className="space-y-3 mb-6">
                <div className="h-3 w-full bg-[#2A2A2A] rounded animate-pulse" />
                <div className="h-3 w-2/3 bg-[#2A2A2A] rounded animate-pulse" />
                <p className="text-gray-500 text-sm">{t("onboarding.flow.analyzing")}</p>
              </div>
            ) : (
              <div className="mb-6 p-4 rounded-xl bg-indigo-950/30 border border-indigo-800/40">
                <p className="text-gray-100 text-sm leading-relaxed">
                  {hasStatement
                    ? (summary || t("onboarding.flow.impressionFallback"))
                    : t("onboarding.flow.welcomeBody")}
                </p>
              </div>
            )}

            {error && <p className="text-red-400 text-sm mb-4">{error}</p>}

            <div className="flex gap-3">
              <button onClick={back} disabled={finishing} className="flex-1 py-3.5 rounded-xl bg-[#1A1A1A] border border-[#2A2A2A] hover:bg-[#2A2A2A] font-semibold transition-colors text-gray-300 disabled:opacity-50">
                ← {t("common.back")}
              </button>
              <button onClick={goHome} disabled={finishing || analyzing} className="flex-[2] py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 font-semibold transition-colors flex items-center justify-center gap-2">
                {finishing ? t("onboarding.flow.creating") : <>{t("onboarding.flow.seeDashboard")} <ArrowRight size={18} /></>}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
