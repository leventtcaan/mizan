"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  uploadStatement, getStoredUser, UploadCapError, EmailNotVerifiedError, type UploadResponse,
} from "@/lib/api";
import PageLayout from "@/components/ui/PageLayout";
import MimGuide from "@/components/companion/MimGuide";
import Mim from "@/components/companion/Mim";
import BlurredBriefTeaser from "@/components/BlurredBriefTeaser";
import {
  FileText, ArrowRight, CheckCircle, ShieldCheck, Sparkles, Mail, Upload,
  Brain, Layers, RefreshCw,
} from "@/components/ui/Icons";
import { useLanguage, type Lang } from "@/lib/i18n";

type FileState = "queued" | "uploading" | "done" | "error";
type FileEntry = {
  file: File;
  state: FileState;
  result?: UploadResponse;
  error?: string;
};

// Map backend reason code → i18n key under upload.uploadResult.
function reasonKey(result: UploadResponse): string {
  switch (result.reason) {
    case "encrypted_pdf": return "upload.uploadResult.encrypted";
    case "scanned_image": return "upload.uploadResult.scanned";
    case "ocr_unavailable": return "upload.uploadResult.ocrFailed";
    case "parse_error": return "upload.uploadResult.failed";
    case "unrecognized_format": return "upload.uploadResult.empty";
    default: return "upload.uploadResult.empty";
  }
}

export default function UploadPage() {
  const router = useRouter();
  const { t, lang } = useLanguage();
  const [dragOver, setDragOver] = useState(false);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [processing, setProcessing] = useState(false);
  // A blocking gate that interrupts the whole upload run, vs a per-file parse error.
  const [gate, setGate] = useState<null | "cap" | "verify">(null);

  useEffect(() => {
    if (!getStoredUser()) router.replace("/login");
  }, [router]);

  const addFiles = useCallback((files: FileList | File[]) => {
    const incoming = Array.from(files).map((file): FileEntry => ({ file, state: "queued" }));
    if (incoming.length) setEntries((prev) => [...prev, ...incoming]);
  }, []);

  const removeEntry = useCallback((idx: number) => {
    setEntries((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  // Upload each queued file sequentially, then route to /review with the batch ids of
  // every successful parse. Empty/failed files stay listed with an actionable message.
  const handleProcess = useCallback(async () => {
    if (!entries.length || processing) return;
    setProcessing(true);
    setGate(null);

    const batchIds: string[] = [];
    for (let i = 0; i < entries.length; i++) {
      if (entries[i].state === "done") {
        if (entries[i].result?.status === "success") batchIds.push(entries[i].result!.job_id);
        continue;
      }
      setEntries((prev) => prev.map((e, j) => (j === i ? { ...e, state: "uploading" } : e)));
      try {
        const result = await uploadStatement(entries[i].file);
        setEntries((prev) => prev.map((e, j) => (j === i ? { ...e, state: "done", result } : e)));
        if (result.status === "success") batchIds.push(result.job_id);
      } catch (err) {
        // Account-level blocks (cap reached, email unverified) stop the whole run and
        // show a dedicated prompt rather than a per-file parse error.
        if (err instanceof UploadCapError || err instanceof EmailNotVerifiedError) {
          setGate(err instanceof UploadCapError ? "cap" : "verify");
          setEntries((prev) => prev.map((e, j) => (j === i ? { ...e, state: "queued" } : e)));
          break;
        }
        const msg = err instanceof Error ? err.message : t("upload.error");
        setEntries((prev) => prev.map((e, j) => (j === i ? { ...e, state: "error", error: msg } : e)));
      }
    }

    setProcessing(false);
    if (batchIds.length > 0) {
      // Batches whose currency was NOT detected in the file → review must confirm it
      // before trusting the inferred fallback. Carried in the URL so a refresh keeps it.
      const inferred = entries
        .filter((e) => e.result?.status === "success" && e.result.currency_detected === false)
        .map((e) => e.result!.job_id);
      const q = new URLSearchParams({ batch_ids: batchIds.join(",") });
      if (inferred.length) q.set("inferred", inferred.join(","));
      router.push(`/review?${q.toString()}`);
    }
  }, [entries, processing, router, t]);

  const allDone = entries.length > 0 && entries.every((e) => e.state === "done" || e.state === "error");
  const noneSucceeded = allDone && !entries.some((e) => e.result?.status === "success");

  // While the run is in flight, take over the page with an animated "what Mim is doing"
  // screen instead of a bare spinner.
  if (processing) {
    return (
      <PageLayout title={t("upload.title")} subtitle={t("upload.subtitle")} maxWidth="sm">
        <ProcessingOverlay lang={lang} fileCount={entries.length} />
      </PageLayout>
    );
  }

  return (
    <PageLayout title={t("upload.title")} subtitle={t("upload.subtitle")} maxWidth="sm">
      <div
        onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); }}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        className={`relative border-2 border-dashed rounded-2xl p-10 sm:p-12 text-center transition-all cursor-pointer mb-4 ${
          dragOver
            ? "border-[#176B5B] bg-[#176B5B]/[0.07] scale-[1.01]"
            : "border-line bg-surface hover:border-[#176B5B]/60 hover:bg-[#176B5B]/[0.03]"
        }`}
        onClick={() => document.getElementById("file-input")?.click()}
      >
        <input
          id="file-input"
          type="file"
          accept=".pdf,.csv,.xlsx"
          multiple
          className="hidden"
          onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }}
        />
        <div className="w-14 h-14 rounded-2xl bg-[#176B5B]/10 flex items-center justify-center mx-auto mb-4">
          <Upload size={24} className="text-[#176B5B]" />
        </div>
        <p className="text-ink font-semibold">{t("upload.dropHintMulti")}</p>
        <p className="text-ink-mute text-sm mt-1">{t("upload.or")}</p>
        <span className="inline-flex items-center gap-1.5 mt-3 px-4 py-2 rounded-lg bg-surface border border-line text-sm font-medium text-ink-soft">
          <FileText size={15} /> {t("upload.browse")}
        </span>
        <p className="text-ink-mute text-xs mt-4">{t("upload.formats")} · {t("upload.maxSize")}</p>
      </div>

      {/* Queued / processed file list */}
      {entries.length > 0 && (
        <div className="mb-4 space-y-2">
          {entries.map((e, i) => (
            <div key={`${e.file.name}-${i}`} className="flex items-center gap-3 p-3 rounded-lg bg-surface border border-line">
              <span className="shrink-0">
                {e.state === "uploading" ? (
                  <span className="block w-4 h-4 border-2 border-line border-t-[#176B5B] rounded-full animate-spin" />
                ) : e.state === "done" && e.result?.status === "success" ? (
                  <CheckCircle size={16} className="text-pos" />
                ) : e.state === "error" || (e.state === "done" && e.result?.status !== "success") ? (
                  <span className="text-warn text-sm font-bold">!</span>
                ) : (
                  <FileText size={16} className="text-ink-mute" />
                )}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-ink text-sm truncate">{e.file.name}</p>
                <p className="text-xs text-ink-mute">
                  {e.state === "uploading" ? t("upload.uploading")
                    : e.state === "done" && e.result?.status === "success" ? `${e.result.transaction_count} ${t("upload.uploadResult.successTitle")}`
                    : e.state === "done" && e.result ? t(reasonKey(e.result))
                    : e.state === "error" ? (e.error || t("upload.error"))
                    : `${(e.file.size / 1024).toFixed(0)} KB`}
                </p>
              </div>
              {!processing && e.state === "queued" && (
                <button onClick={() => removeEntry(i)} className="shrink-0 text-ink-mute hover:text-ink-soft text-sm transition-colors px-1">×</button>
              )}
            </div>
          ))}
        </div>
      )}

      <button
        onClick={handleProcess}
        disabled={entries.length === 0 || processing}
        className="w-full py-3 px-4 rounded-xl font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-[#176B5B] hover:bg-[#125848] text-white flex items-center justify-center gap-2"
      >
        {processing ? (
          <>
            <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            {t("upload.uploading")}
          </>
        ) : (
          <>{t("upload.processReview")} <ArrowRight size={16} /></>
        )}
      </button>

      {noneSucceeded && !gate && (
        <div className="mt-4 bg-warn/10 border border-warn/30 rounded-xl p-4 text-warn text-sm text-center">
          {t("upload.noneSucceeded")}
        </div>
      )}

      {/* Free-tier monthly upload cap reached → show what AI parsing does, motivate upgrade */}
      {gate === "cap" && (
        <div className="mt-4 space-y-4">
          <MimGuide
            mood="thinking"
            size={52}
            message={lang === "tr"
              ? "Bu ay ücretsiz yükleme hakkını kullandın. Plus ile her ekstreyi sınırsız okuyabilirim."
              : "You've used this month's free upload. With Plus I can read every statement for you, no limits."}
          />
          {/* The brief they'd be getting — shown blurred behind an unlock overlay (loss aversion). */}
          <BlurredBriefTeaser />
          <div className="rounded-2xl border border-[#176B5B]/30 bg-[#176B5B]/[0.06] p-5">
            <div className="flex items-center gap-2 mb-1">
              <Sparkles size={18} className="text-[#176B5B] shrink-0" />
              <p className="font-semibold text-ink">{t("upload.capTitle")}</p>
            </div>
            <p className="text-ink-mute text-sm mb-4">{t("upload.capBody")}</p>
            <ul className="space-y-2 mb-5">
              {(lang === "tr"
                ? ["Sınırsız ekstre yükleme", "Her ekstre için AI okuması ve özeti", "Otomatik kategorilendirme ve tekrarlayan ödeme tespiti"]
                : ["Unlimited statement uploads", "An AI read and summary of every statement", "Automatic categorization & recurring-charge detection"]
              ).map((line, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-ink-soft">
                  <CheckCircle size={15} className="text-pos shrink-0 mt-0.5" /> <span>{line}</span>
                </li>
              ))}
            </ul>
            <Link
              href="/upgrade"
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-[#176B5B] hover:bg-[#125848] text-white text-sm font-semibold transition-colors"
            >
              {t("upload.capCta")} <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      )}

      {/* Email not verified → must confirm before uploading */}
      {gate === "verify" && (
        <div className="mt-4 rounded-xl border border-warn/30 bg-warn/10 p-5 text-center">
          <div className="w-11 h-11 rounded-xl bg-warn/15 flex items-center justify-center mx-auto mb-3">
            <Mail size={20} className="text-warn" />
          </div>
          <p className="font-semibold text-ink mb-1">{t("verify.noticeTitle")}</p>
          <p className="text-ink-mute text-sm mb-4">{t("verify.checkEmail")}</p>
          <Link
            href={`/verify?email=${encodeURIComponent(getStoredUser()?.email ?? "")}`}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-[#176B5B] hover:bg-[#125848] text-white text-sm font-semibold transition-colors"
          >
            {t("verify.resend")} <ArrowRight size={16} />
          </Link>
        </div>
      )}

      {/* Privacy reassurance — honest, plain account of what happens to the file */}
      <div className="mt-6 rounded-xl bg-surface border border-line p-4">
        <div className="flex items-center gap-2 mb-3">
          <ShieldCheck size={16} className="text-pos shrink-0" />
          <p className="text-sm font-medium text-ink-soft">{t("upload.privacyTitle")}</p>
        </div>
        <ul className="space-y-2">
          {["privacy1", "privacy2", "privacy3"].map((k) => (
            <li key={k} className="flex gap-2 text-xs text-ink-mute leading-relaxed">
              <span className="text-ink-mute shrink-0 mt-px">•</span>
              <span>{t(`upload.${k}`)}</span>
            </li>
          ))}
        </ul>
      </div>
    </PageLayout>
  );
}

// ── Animated "what Mim is doing" processing screen ──────────────────────────────
// Drives a plausible step progression on a timer (the backend doesn't stream progress),
// holding on the final step until the run completes. Pure SVG/CSS — no dependencies.
function ProcessingOverlay({ lang, fileCount }: { lang: Lang; fileCount: number }) {
  const steps = lang === "tr"
    ? [
        { Icon: FileText, label: "Ekstreni okuyorum", sub: "Sayfaları tarıyor ve metni çıkarıyorum" },
        { Icon: Layers, label: "İşlemleri ayıklıyorum", sub: "Her satırı tarih, tutar ve açıklamaya ayırıyorum" },
        { Icon: Brain, label: "Harcamaları sınıflandırıyorum", sub: "Her işlemi doğru kategoriye yerleştiriyorum" },
        { Icon: RefreshCw, label: "Tekrarlayan ödemeleri buluyorum", sub: "Abonelikleri ve düzenli ödemeleri tespit ediyorum" },
        { Icon: Sparkles, label: "Brifingini hazırlıyorum", sub: "Önemli olanı tek bir okumada topluyorum" },
      ]
    : [
        { Icon: FileText, label: "Reading your statement", sub: "Scanning the pages and pulling out the text" },
        { Icon: Layers, label: "Extracting transactions", sub: "Splitting each line into date, amount and description" },
        { Icon: Brain, label: "Categorizing spending", sub: "Placing every transaction in the right category" },
        { Icon: RefreshCw, label: "Finding recurring charges", sub: "Spotting subscriptions and regular payments" },
        { Icon: Sparkles, label: "Preparing your brief", sub: "Pulling what matters into a single read" },
      ];

  const [step, setStep] = useState(0);
  useEffect(() => {
    // Earlier steps move briskly; the last one is held (it's where the real wait lives).
    if (step >= steps.length - 1) return;
    const id = setTimeout(() => setStep((s) => Math.min(s + 1, steps.length - 1)), step === 0 ? 1100 : 1600);
    return () => clearTimeout(id);
  }, [step, steps.length]);

  const active = steps[step];
  // Visible progress: advance per step but never claim 100% until we actually route away.
  const pct = step >= steps.length - 1 ? 92 : Math.round(((step + 1) / steps.length) * 100);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-line bg-surface px-6 py-9 sm:px-8 sm:py-10 text-center shadow-sm">
      <style>{`
        @keyframes clfRing { 0% { transform: scale(.65); opacity:.5 } 100% { transform: scale(2); opacity:0 } }
        @keyframes clfShimmer { 0% { transform: translateX(-110%) } 100% { transform: translateX(320%) } }
        @keyframes clfBlink { 0%,80%,100% { opacity:.2 } 40% { opacity:1 } }
        @keyframes clfPop { 0% { transform: scale(.3); opacity:0 } 60% { transform: scale(1.18) } 100% { transform: scale(1); opacity:1 } }
        @keyframes clfRowIn { from { opacity:0; transform: translateY(7px) } to { opacity:1; transform:none } }
        @keyframes clfFloatY { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-8px) } }
      `}</style>

      {/* soft top wash */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-28" style={{ background: "radial-gradient(120% 100% at 50% 0%, rgba(23,107,91,0.12), transparent 70%)" }} />

      {/* Mim, haloed by pulsing rings + a couple of drifting motes */}
      <div className="relative mx-auto mb-5 flex items-center justify-center" style={{ width: 132, height: 132 }}>
        {[0, 1, 2].map((i) => (
          <span key={i} className="absolute rounded-full"
            style={{
              width: 92, height: 92, border: "1.5px solid rgba(23,107,91,0.5)",
              animation: `clfRing ${2.8}s ease-out ${i * 0.9}s infinite`,
            }} />
        ))}
        <span className="absolute rounded-full" style={{ width: 6, height: 6, background: "#176B5B", top: 10, left: 24, opacity: 0.7, animation: "clfFloatY 3.2s ease-in-out infinite" }} />
        <span className="absolute rounded-full" style={{ width: 4, height: 4, background: "#176B5B", bottom: 16, right: 22, opacity: 0.6, animation: "clfFloatY 2.6s ease-in-out .6s infinite" }} />
        <Mim mood="thinking" size={92} speaking />
      </div>

      {/* Mim narrates the current step */}
      <p className="text-ink font-semibold text-lg leading-snug">{active.label}</p>
      <p className="text-ink-mute text-sm mt-1 max-w-xs mx-auto">{active.sub}</p>
      {fileCount > 1 && (
        <p className="text-ink-mute text-xs mt-2">
          {lang === "tr" ? `${fileCount} ekstre işleniyor` : `Processing ${fileCount} statements`}
        </p>
      )}

      {/* Step checklist */}
      <div className="mt-7 space-y-2 text-left max-w-sm mx-auto">
        {steps.map((s, i) => {
          const done = i < step;
          const isActive = i === step;
          const StepIcon = s.Icon;
          return (
            <div key={i}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors ${
                isActive ? "bg-[#176B5B]/[0.07] border border-[#176B5B]/25" : "border border-transparent"
              }`}
              style={{ animation: `clfRowIn .4s ease ${i * 0.06}s both` }}
            >
              <span className={`relative w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-colors ${
                done ? "text-white" : isActive ? "text-[#176B5B]" : "text-ink-mute"
              }`}
                style={done ? { backgroundColor: "#176B5B" } : isActive ? { boxShadow: "0 0 0 1.5px rgba(23,107,91,0.4) inset" } : { boxShadow: "0 0 0 1.5px rgb(var(--c-line)) inset" }}
              >
                {done ? (
                  <span style={{ animation: "clfPop .35s ease both" }}><CheckCircle size={16} /></span>
                ) : (
                  <StepIcon size={15} className={isActive ? "animate-pulse" : ""} />
                )}
              </span>
              <span className={`flex-1 text-sm ${done ? "text-ink-soft" : isActive ? "text-ink font-medium" : "text-ink-mute"}`}>
                {s.label}
              </span>
              {isActive && (
                <span className="flex items-center gap-1 shrink-0">
                  {[0, 1, 2].map((d) => (
                    <span key={d} className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "#176B5B", animation: `clfBlink 1.1s ease-in-out ${d * 0.18}s infinite` }} />
                  ))}
                </span>
              )}
              {done && <CheckCircle size={15} className="text-pos shrink-0" />}
            </div>
          );
        })}
      </div>

      {/* Indeterminate-yet-advancing progress bar with a moving shimmer */}
      <div className="relative mt-7 h-1.5 rounded-full bg-surface-2 overflow-hidden max-w-sm mx-auto">
        <div className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-out" style={{ width: `${pct}%`, backgroundColor: "#176B5B" }} />
        <div className="absolute inset-y-0 w-1/3" style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.55), transparent)", animation: "clfShimmer 1.5s linear infinite" }} />
      </div>
    </div>
  );
}
