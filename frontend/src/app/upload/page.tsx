"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { uploadStatement, getStoredUser, type UploadResponse } from "@/lib/api";
import PageLayout from "@/components/ui/PageLayout";
import { FileText, ArrowRight, CheckCircle, ShieldCheck } from "@/components/ui/Icons";
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
          dragOver ? "border-indigo-500 bg-indigo-950/20" : "border-[#2C2922] bg-[#1C1915] hover:border-[#3C3832]"
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
        <div className="w-12 h-12 rounded-xl bg-[#2C2922] flex items-center justify-center mx-auto mb-3">
          <FileText size={22} className="text-gray-400" />
        </div>
        <p className="text-gray-300 font-medium">{t("upload.dropHintMulti")}</p>
        <p className="text-gray-600 text-sm mt-1">{t("upload.or")} {t("upload.browse")}</p>
        <p className="text-gray-700 text-xs mt-3">{t("upload.formats")} · {t("upload.maxSize")}</p>
      </div>

      {/* Queued / processed file list */}
      {entries.length > 0 && (
        <div className="mb-4 space-y-2">
          {entries.map((e, i) => (
            <div key={`${e.file.name}-${i}`} className="flex items-center gap-3 p-3 rounded-lg bg-[#1C1915] border border-[#2C2922]">
              <span className="shrink-0">
                {e.state === "uploading" ? (
                  <span className="block w-4 h-4 border-2 border-white/30 border-t-indigo-400 rounded-full animate-spin" />
                ) : e.state === "done" && e.result?.status === "success" ? (
                  <CheckCircle size={16} className="text-emerald-400" />
                ) : e.state === "error" || (e.state === "done" && e.result?.status !== "success") ? (
                  <span className="text-amber-400 text-sm font-bold">!</span>
                ) : (
                  <FileText size={16} className="text-gray-500" />
                )}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm truncate">{e.file.name}</p>
                <p className="text-xs text-gray-500">
                  {e.state === "uploading" ? t("upload.uploading")
                    : e.state === "done" && e.result?.status === "success" ? `${e.result.transaction_count} ${t("upload.uploadResult.successTitle")}`
                    : e.state === "done" && e.result ? t(reasonKey(e.result))
                    : e.state === "error" ? (e.error || t("upload.error"))
                    : `${(e.file.size / 1024).toFixed(0)} KB`}
                </p>
              </div>
              {!processing && e.state === "queued" && (
                <button onClick={() => removeEntry(i)} className="shrink-0 text-gray-600 hover:text-gray-300 text-sm transition-colors px-1">×</button>
              )}
            </div>
          ))}
        </div>
      )}

      <button
        onClick={handleProcess}
        disabled={entries.length === 0 || processing}
        className="w-full py-3 px-4 rounded-xl font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center gap-2"
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

      {noneSucceeded && (
        <div className="mt-4 bg-amber-950/30 border border-amber-800/40 rounded-xl p-4 text-amber-300 text-sm text-center">
          {t("upload.noneSucceeded")}
        </div>
      )}

      {/* Privacy reassurance — honest, plain account of what happens to the file */}
      <div className="mt-6 rounded-xl bg-[#1C1915] border border-[#2C2922] p-4">
        <div className="flex items-center gap-2 mb-3">
          <ShieldCheck size={16} className="text-emerald-400 shrink-0" />
          <p className="text-sm font-medium text-gray-200">{t("upload.privacyTitle")}</p>
        </div>
        <ul className="space-y-2">
          {["privacy1", "privacy2", "privacy3"].map((k) => (
            <li key={k} className="flex gap-2 text-xs text-gray-500 leading-relaxed">
              <span className="text-gray-600 shrink-0 mt-px">•</span>
              <span>{t(`upload.${k}`)}</span>
            </li>
          ))}
        </ul>
      </div>
    </PageLayout>
  );
}
