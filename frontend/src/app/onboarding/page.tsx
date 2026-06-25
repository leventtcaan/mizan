"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  getStoredUser, setStoredUser, completeOnboarding,
  uploadStatement, updatePreferences, isPaidPlan,
  type UploadResponse,
} from "@/lib/api";
import { FileText, ArrowRight, CheckCircle, Plus, Sparkles } from "@/components/ui/Icons";
import AddTransactionModal from "@/components/AddTransactionModal";
import MimGuide from "@/components/companion/MimGuide";
import { useLanguage } from "@/lib/i18n";

// Onboarding: upload statement(s) → (review → brief) or a plain welcome → Home.
type Step = 1 | 2;
const STEP_COUNT = 2;

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
  const [name, setName] = useState<string>("");
  const [accountType, setAccountType] = useState<"personal" | "business">("personal");
  const [error, setError] = useState<string | null>(null);
  const [currency, setCurrency] = useState("USD");
  const paid = isPaidPlan();

  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploads, setUploads] = useState<UploadEntry[]>([]);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualCount, setManualCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [goal, setGoal] = useState<string>("");
  const [finishing, setFinishing] = useState(false);

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
    if (user.email_verified === false) { router.replace("/verify"); return; }
    setName(user.display_name?.trim() || "");
    if (user.account_type) setAccountType(user.account_type);
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

  // Step 1 always advances to the goal step (step 2). The real AI read happens later
  // in /brief (statement path), never here — so onboarding makes no LLM call.
  const next = () => { setError(null); setStep(2); };
  const back = () => { setError(null); setStep(1); };

  // Save the chosen goal (server + local), then route: a parsed statement goes through
  // /review → /brief (which marks onboarding done); otherwise finish straight to Home.
  const finishOnboarding = async () => {
    setFinishing(true);
    setError(null);
    if (goal) {
      try { await updatePreferences({ primary_goal: goal }); } catch { /* non-blocking */ }
      const u = getStoredUser();
      if (u) setStoredUser({ ...u, primary_goal: goal });
    }
    if (hasStatement) {
      const ids = successUploads.map((u) => u.result.job_id).join(",");
      const inferred = successUploads
        .filter((u) => u.result.currency_detected === false)
        .map((u) => u.result.job_id);
      const q = new URLSearchParams({ batch_ids: ids, onboarding: "1" });
      if (inferred.length) q.set("inferred", inferred.join(","));
      router.push(`/review?${q.toString()}`);
      return;
    }
    await markDone();
    router.push("/home");
  };

  const goalKeys = accountType === "business"
    ? ["manage_cashflow", "track_receivables", "reduce_costs", "grow_business", "track_everything"]
    : ["understand_spending", "pay_off_debt", "grow_net_worth", "save_more", "track_everything"];

  const greet = name ? `${name}, ` : "";
  const mimS1 = lang === "tr"
    ? `${greet}${accountType === "business" ? "ekstre veya hesap dökümü" : "banka ekstreni"} yükle — saniyeler içinde okuyup panona dökeyim.`
    : `${greet}drop a ${accountType === "business" ? "statement or export" : "bank statement"} and I'll read it into your dashboard in seconds.`;
  const mimS2 = lang === "tr"
    ? "Son bir şey: en çok neye odaklanalım? Panonu buna göre düzenleyeceğim."
    : "One last thing: what should we focus on? I'll shape your dashboard around it.";

  const progressPct = (step / STEP_COUNT) * 100;

  return (
    <div className="min-h-screen bg-canvas text-ink flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        {/* Logo + progress */}
        <div className="mb-8">
          <p className="text-center text-ink-mute text-sm mb-5 font-medium tracking-widest uppercase">Mizan</p>
          <div className="w-full h-1 bg-surface-2 rounded-full overflow-hidden">
            <div className="h-full bg-[#176B5B] rounded-full transition-all duration-500" style={{ width: `${progressPct}%` }} />
          </div>
          <div className="flex justify-between text-[11px] text-ink-mute mt-2">
            <span>{t("setup.stepUpload")}</span>
            <span>{step} / {STEP_COUNT}</span>
          </div>
        </div>

        {/* Mim — present through every step */}
        <div className="mb-6">
          <MimGuide message={step === 1 ? mimS1 : mimS2} mood={step === 1 ? "calm" : "happy"} size={56} />
        </div>

        {/* STEP 1 — STATEMENTS */}
        {step === 1 && (
          <div>
            <h1 className="text-2xl font-bold mb-1.5">{t("onboarding.flow.s1Title")}</h1>
            <p className="text-ink-mute text-sm mb-5">{t("onboarding.flow.s1Sub")}</p>

            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) handleUpload(f); }}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-2xl p-7 text-center cursor-pointer transition-all mb-3 ${dragging ? "border-[#176B5B] bg-[#176B5B]/[0.07]" : "border-line hover:border-[#176B5B]/60 hover:bg-[#176B5B]/[0.03]"}`}
            >
              <input ref={fileInputRef} type="file" accept=".pdf,.csv,.xlsx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); }} />
              <div className="w-12 h-12 rounded-2xl bg-[#176B5B]/10 flex items-center justify-center mx-auto mb-3">
                <FileText size={22} className="text-[#176B5B]" />
              </div>
              {uploading ? (
                <span className="text-ink-mute text-sm">{t("onboarding.uploading")}</span>
              ) : (
                <>
                  <p className="text-ink-soft text-sm font-medium">{uploads.length > 0 ? t("onboarding.flow.addAnother") : t("onboarding.dropHere")}</p>
                  <p className="text-ink-mute text-xs mt-1">{t("onboarding.pdfCsvMax")}</p>
                </>
              )}
            </div>

            <button
              onClick={() => setManualOpen(true)}
              className="w-full mb-4 flex items-center justify-center gap-1.5 text-ink-mute hover:text-ink-soft text-sm transition-colors py-2"
            >
              <Plus size={15} /> {t("onboarding.flow.addManual")}
            </button>

            {manualCount > 0 && (
              <div className="mb-3 p-3 rounded-xl bg-pos/10 border border-pos/30 flex items-center gap-2 text-sm">
                <CheckCircle size={14} className="text-pos shrink-0" />
                <span className="text-pos">{manualCount} {t("onboarding.flow.manualAdded")}</span>
              </div>
            )}

            {/* Running count — rewarding */}
            {hasStatement && (
              <div className="mb-3 p-4 rounded-xl bg-pos/10 border border-pos/30">
                <p className="text-pos text-sm font-semibold mb-2">
                  {successUploads.length} {t("onboarding.flow.statementsLoaded")} · {totalTxCount} {t("onboarding.flow.txCount")}
                </p>
                <div className="space-y-1">
                  {uploads.map((u, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      {u.result.status === "success" ? (
                        <><CheckCircle size={13} className="text-pos shrink-0" /><span className="text-ink-mute truncate">{u.filename}</span><span className="text-ink-mute">· {u.result.transaction_count}</span></>
                      ) : (
                        <><span className="text-warn shrink-0">!</span><span className="text-warn truncate">{u.filename}</span></>
                      )}
                    </div>
                  ))}
                </div>
                <div className="flex gap-4 text-xs mt-2 pt-2 border-t border-pos/20">
                  <span className="text-ink-mute">{t("onboarding.flow.incomeSeen")}: <span className="text-pos font-semibold">{money(parsedIncome)}</span></span>
                  <span className="text-ink-mute">{t("onboarding.flow.expensesSeen")}: <span className="text-neg font-semibold">{money(parsedExpenses)}</span></span>
                </div>
              </div>
            )}

            {uploads.some((u) => u.result.status !== "success") && !hasStatement && (
              <div className="mb-3 p-3 rounded-xl bg-warn/10 border border-warn/30 text-warn text-sm text-center">
                {t(uploadReasonKey(uploads[uploads.length - 1].result))}
              </div>
            )}

            {error && <p className="text-neg text-sm mb-3">{error}</p>}

            <button onClick={next} className="w-full py-3.5 rounded-xl bg-[#176B5B] hover:bg-[#125848] text-white font-semibold transition-colors flex items-center justify-center gap-2">
              {t("onboarding.continue")} <ArrowRight size={18} />
            </button>
            <button onClick={goHome} className="w-full mt-3 text-center text-ink-mute hover:text-ink-soft text-sm transition-colors">
              {t("onboarding.flow.skipForNow")}
            </button>
          </div>
        )}

        {/* STEP 2 — GOAL (tailored by account type) + free-tier AI upsell */}
        {step === 2 && (
          <div>
            <h2 className="text-2xl font-bold mb-1.5">
              {accountType === "business" ? t("setup.goalTitleBusiness") : t("setup.goalTitlePersonal")}
            </h2>
            <p className="text-ink-mute text-sm mb-5">{t("setup.goalSub")}</p>

            <div className="space-y-2 mb-5">
              {goalKeys.map((k) => {
                const active = goal === k;
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setGoal(k)}
                    aria-pressed={active}
                    className={`w-full flex items-center justify-between gap-3 text-left px-4 py-3 rounded-xl border transition-colors ${
                      active ? "border-[#176B5B] bg-[#176B5B]/[0.07]" : "border-line hover:border-[#176B5B]/50"
                    }`}
                  >
                    <span className={`text-sm ${active ? "text-[#176B5B] font-semibold" : "text-ink-soft"}`}>
                      {t(`setup.goal.${k}`)}
                    </span>
                    {active && <CheckCircle size={16} className="text-[#176B5B] shrink-0" />}
                  </button>
                );
              })}
            </div>

            {/* Free-tier: show what AI would add, motivate upgrade — no LLM call made */}
            {!paid && (
              <div className="mb-5 rounded-xl border border-[#176B5B]/30 bg-[#176B5B]/[0.06] p-4">
                <div className="flex items-center gap-2 mb-1.5">
                  <Sparkles size={16} className="text-[#176B5B] shrink-0" />
                  <p className="text-sm font-semibold text-ink">{t("setup.freeAiTitle")}</p>
                </div>
                <p className="text-ink-mute text-sm mb-3 leading-relaxed">{t("setup.freeAiBody")}</p>
                <Link href="/upgrade" className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#176B5B] hover:text-[#125848] transition-colors">
                  {t("setup.freeAiCta")} <ArrowRight size={15} />
                </Link>
              </div>
            )}

            {error && <p className="text-neg text-sm mb-4">{error}</p>}

            <div className="flex gap-3">
              <button onClick={back} disabled={finishing} className="flex-1 py-3.5 rounded-xl bg-surface border border-line hover:bg-surface-2 font-semibold transition-colors text-ink-soft disabled:opacity-50">
                ← {t("common.back")}
              </button>
              <button onClick={finishOnboarding} disabled={finishing} className="flex-[2] py-3.5 rounded-xl bg-[#176B5B] hover:bg-[#125848] text-white disabled:opacity-50 font-semibold transition-colors flex items-center justify-center gap-2">
                {finishing ? t("onboarding.flow.creating") : <>{t("onboarding.flow.seeDashboard")} <ArrowRight size={18} /></>}
              </button>
            </div>
          </div>
        )}
      </div>

      {manualOpen && (
        <AddTransactionModal
          onClose={() => setManualOpen(false)}
          onSuccess={() => { setManualCount((c) => c + 1); setManualOpen(false); }}
        />
      )}
    </div>
  );
}
