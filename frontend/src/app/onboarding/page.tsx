"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getStoredUser, setStoredUser, completeOnboarding,
  uploadStatement, updatePreferences, setDefaultCurrencyLocal,
  type UploadResponse,
} from "@/lib/api";
import { FileText, ArrowRight, CheckCircle, Plus } from "@/components/ui/Icons";
import AddTransactionModal from "@/components/AddTransactionModal";
import MimGuide from "@/components/companion/MimGuide";
import { useLanguage } from "@/lib/i18n";

// Onboarding: a single step — upload statement(s) → (review → brief) or straight to Home.
// No goal-setting page: completing onboarding lands the user on /home.

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

  const [name, setName] = useState<string>("");
  const [accountType, setAccountType] = useState<"personal" | "business">("personal");
  const [error, setError] = useState<string | null>(null);
  const [currency, setCurrency] = useState("USD");

  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploads, setUploads] = useState<UploadEntry[]>([]);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualCount, setManualCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // Default display currency after onboarding: the uploaded statement's currency, or — when
  // no statement was uploaded — USD (never the TRY backend default).
  const resolveCurrency = useCallback((): string => {
    if (hasStatement) {
      const c = successUploads[0]?.result.currency;
      if (c) return c;
    }
    return currency && currency !== "TRY" ? currency : "USD";
  }, [hasStatement, successUploads, currency]);

  const persistCurrency = useCallback(async (ccy: string) => {
    try { await updatePreferences({ display_currency: ccy }); } catch { /* non-blocking */ }
    setDefaultCurrencyLocal(ccy);  // writes localStorage StoredUser + broadcasts to open pages
  }, []);

  const markDone = async () => {
    try {
      await completeOnboarding();
      const user = getStoredUser();
      if (user) setStoredUser({ ...user, onboarding_completed: true });
    } catch { /* non-blocking */ }
  };

  // Finish: set the display currency, then route. A parsed statement goes through
  // /review → /brief (which marks onboarding done); otherwise finish straight to Home.
  const finish = async () => {
    setFinishing(true);
    setError(null);
    await persistCurrency(resolveCurrency());
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

  // Skip: set the display currency, mark done, land on Home (no review/brief detour).
  const skip = async () => {
    setFinishing(true);
    await persistCurrency(resolveCurrency());
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

  const greet = name ? `${name}, ` : "";
  const mimMsg = lang === "tr"
    ? `${greet}${accountType === "business" ? "ekstre veya hesap dökümü" : "banka ekstreni"} yükle — saniyeler içinde okuyup panona dökeyim.`
    : `${greet}drop a ${accountType === "business" ? "statement or export" : "bank statement"} and I'll read it into your dashboard in seconds.`;

  return (
    <div className="min-h-screen bg-canvas text-ink flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="mb-8">
          <p className="text-center text-ink-mute text-sm font-medium tracking-widest uppercase">Clarifin</p>
        </div>

        {/* Mim */}
        <div className="mb-6">
          <MimGuide message={mimMsg} mood="calm" size={56} />
        </div>

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

          <button onClick={finish} disabled={finishing} className="w-full py-3.5 rounded-xl bg-[#176B5B] hover:bg-[#125848] text-white font-semibold transition-colors flex items-center justify-center gap-2 disabled:opacity-50">
            {finishing ? t("onboarding.flow.creating") : <>{t("onboarding.flow.seeDashboard")} <ArrowRight size={18} /></>}
          </button>
          <button onClick={skip} disabled={finishing} className="w-full mt-3 text-center text-ink-mute hover:text-ink-soft text-sm transition-colors disabled:opacity-50">
            {t("onboarding.flow.skipForNow")}
          </button>
        </div>
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
