"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  uploadStatement, getStoredUser, UploadCapError, EmailNotVerifiedError, type UploadResponse,
} from "@/lib/api";
import PageLayout from "@/components/ui/PageLayout";
import MimGuide from "@/components/companion/MimGuide";
import { FileText, ArrowRight, CheckCircle, ShieldCheck, Sparkles, Mail, Upload } from "@/components/ui/Icons";
import { useLanguage } from "@/lib/i18n";

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
