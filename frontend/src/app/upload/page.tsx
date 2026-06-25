"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  uploadStatement, getStoredUser, UploadCapError, EmailNotVerifiedError, type UploadResponse,
} from "@/lib/api";
import PageLayout from "@/components/ui/PageLayout";
import { FileText, ArrowRight, CheckCircle, ShieldCheck, Sparkles, Mail } from "@/components/ui/Icons";
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
  const { t } = useLanguage();
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
        className={`relative border-2 border-dashed rounded-xl p-12 text-center transition-all cursor-pointer mb-4 ${
          dragOver ? "border-brand bg-brand/20" : "border-line bg-surface hover:border-[#3C3832]"
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
        <div className="w-12 h-12 rounded-xl bg-surface-2 flex items-center justify-center mx-auto mb-3">
          <FileText size={22} className="text-ink-mute" />
        </div>
        <p className="text-ink-soft font-medium">{t("upload.dropHintMulti")}</p>
        <p className="text-ink-mute text-sm mt-1">{t("upload.or")} {t("upload.browse")}</p>
        <p className="text-gray-700 text-xs mt-3">{t("upload.formats")} · {t("upload.maxSize")}</p>
      </div>

      {/* Queued / processed file list */}
      {entries.length > 0 && (
        <div className="mb-4 space-y-2">
          {entries.map((e, i) => (
            <div key={`${e.file.name}-${i}`} className="flex items-center gap-3 p-3 rounded-lg bg-surface border border-line">
              <span className="shrink-0">
                {e.state === "uploading" ? (
                  <span className="block w-4 h-4 border-2 border-white/30 border-t-brand rounded-full animate-spin" />
                ) : e.state === "done" && e.result?.status === "success" ? (
                  <CheckCircle size={16} className="text-emerald-400" />
                ) : e.state === "error" || (e.state === "done" && e.result?.status !== "success") ? (
                  <span className="text-amber-400 text-sm font-bold">!</span>
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
        className="w-full py-3 px-4 rounded-xl font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-brand hover:bg-brand-hover text-white flex items-center justify-center gap-2"
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
        <div className="mt-4 bg-amber-950/30 border border-amber-800/40 rounded-xl p-4 text-amber-300 text-sm text-center">
          {t("upload.noneSucceeded")}
        </div>
      )}

      {/* Free-tier monthly upload cap reached → upgrade prompt */}
      {gate === "cap" && (
        <div className="mt-4 rounded-xl border border-brand/40 bg-brand/10 p-5 text-center">
          <div className="w-11 h-11 rounded-xl bg-brand/15 flex items-center justify-center mx-auto mb-3">
            <Sparkles size={20} className="text-brand" />
          </div>
          <p className="font-semibold text-ink mb-1">{t("upload.capTitle")}</p>
          <p className="text-ink-mute text-sm mb-4">{t("upload.capBody")}</p>
          <Link
            href="/settings"
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-brand hover:bg-brand-hover text-white text-sm font-semibold transition-colors"
          >
            {t("upload.capCta")} <ArrowRight size={16} />
          </Link>
        </div>
      )}

      {/* Email not verified → must confirm before uploading */}
      {gate === "verify" && (
        <div className="mt-4 rounded-xl border border-amber-800/40 bg-amber-950/30 p-5 text-center">
          <div className="w-11 h-11 rounded-xl bg-amber-500/15 flex items-center justify-center mx-auto mb-3">
            <Mail size={20} className="text-amber-400" />
          </div>
          <p className="font-semibold text-ink mb-1">{t("verify.noticeTitle")}</p>
          <p className="text-ink-mute text-sm mb-4">{t("verify.checkEmail")}</p>
          <Link
            href={`/verify?email=${encodeURIComponent(getStoredUser()?.email ?? "")}`}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-brand hover:bg-brand-hover text-white text-sm font-semibold transition-colors"
          >
            {t("verify.resend")} <ArrowRight size={16} />
          </Link>
        </div>
      )}

      {/* Privacy reassurance — honest, plain account of what happens to the file */}
      <div className="mt-6 rounded-xl bg-surface border border-line p-4">
        <div className="flex items-center gap-2 mb-3">
          <ShieldCheck size={16} className="text-emerald-400 shrink-0" />
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
