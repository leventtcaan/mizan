"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { uploadStatement, acceptSuggestion, dismissSuggestion, getStoredUser, type UploadResponse, type SuggestionItem } from "@/lib/api";
import PageLayout from "@/components/ui/PageLayout";
import { FileText, ArrowRight, Zap } from "@/components/ui/Icons";
import { useLanguage } from "@/lib/i18n";

type UploadState = "idle" | "uploading" | "success" | "error";

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
  const [state, setState] = useState<UploadState>("idle");
  const [dragOver, setDragOver] = useState(false);
  const [result, setResult] = useState<UploadResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [pendingSuggestions, setPendingSuggestions] = useState<SuggestionItem[]>([]);

  useEffect(() => {
    const user = getStoredUser();
    if (!user) { router.replace("/login"); return; }
  }, [router]);

  const handleFile = useCallback((file: File) => {
    setSelectedFile(file);
    setResult(null);
    setErrorMsg("");
    setState("idle");
  }, []);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleUpload = useCallback(async () => {
    if (!selectedFile) return;
    setState("uploading");
    try {
      const response = await uploadStatement(selectedFile);
      // A clean parse leads with the Post-Upload Brief — the narrative read of the
      // statement — instead of dumping the user straight into the transaction table.
      // Empty/failed parses stay here to show the actionable amber message.
      if (response.status === "success") {
        router.push(`/brief?job_id=${response.job_id}`);
        return;
      }
      setResult(response);
      setState("success");
      if (response.suggestions && response.suggestions.length > 0) {
        setPendingSuggestions(response.suggestions.filter((s) => s.status === "pending"));
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : t("upload.error"));
      setState("error");
    }
  }, [selectedFile, t]);

  const handleAcceptSuggestion = async (id: string) => {
    await acceptSuggestion(id).catch(() => {});
    setPendingSuggestions((prev) => prev.filter((s) => s.id !== id));
  };

  const handleDismissSuggestion = async (id: string) => {
    await dismissSuggestion(id).catch(() => {});
    setPendingSuggestions((prev) => prev.filter((s) => s.id !== id));
  };

  return (
    <PageLayout title={t("upload.title")} subtitle={t("upload.subtitle")} maxWidth="sm">
      <div
        onDrop={handleDrop}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        className={`relative border-2 border-dashed rounded-xl p-12 text-center transition-all cursor-pointer mb-4 ${
          dragOver
            ? "border-indigo-500 bg-indigo-950/20"
            : "border-[#2A2A2A] bg-[#1A1A1A] hover:border-[#3A3A3A]"
        }`}
        onClick={() => document.getElementById("file-input")?.click()}
      >
        <input
          id="file-input"
          type="file"
          accept=".pdf,.csv,.xlsx"
          className="hidden"
          onChange={handleInputChange}
        />
        {selectedFile ? (
          <div>
            <div className="w-12 h-12 rounded-xl bg-indigo-950 border border-indigo-800 flex items-center justify-center mx-auto mb-3">
              <FileText size={22} className="text-indigo-400" />
            </div>
            <p className="text-white font-medium">{selectedFile.name}</p>
            <p className="text-gray-500 text-sm mt-1">{(selectedFile.size / 1024).toFixed(1)} KB</p>
          </div>
        ) : (
          <div>
            <div className="w-12 h-12 rounded-xl bg-[#2A2A2A] flex items-center justify-center mx-auto mb-3">
              <FileText size={22} className="text-gray-400" />
            </div>
            <p className="text-gray-300 font-medium">{t("upload.dropHint")}</p>
            <p className="text-gray-600 text-sm mt-1">{t("upload.or")} {t("upload.browse")}</p>
            <p className="text-gray-700 text-xs mt-3">{t("upload.formats")} · {t("upload.maxSize")}</p>
          </div>
        )}
      </div>

      <button
        onClick={handleUpload}
        disabled={!selectedFile || state === "uploading"}
        className="w-full py-3 px-4 rounded-xl font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-indigo-600 hover:bg-indigo-500 text-white"
      >
        {state === "uploading" ? (
          <span className="flex items-center justify-center gap-2">
            <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            {t("upload.uploading")}
          </span>
        ) : t("upload.title")}
      </button>

      {state === "success" && result && (
        <div className="mt-5 space-y-3">
          {result.status === "success" ? (
            <div className="bg-emerald-950/40 border border-emerald-800/60 rounded-xl p-5">
              <p className="text-emerald-300 font-semibold text-lg">{result.transaction_count} {t("upload.uploadResult.successTitle")}</p>
              <p className="text-emerald-500 text-sm mt-1">{result.message}</p>
              <Link
                href="/transactions"
                className="mt-4 inline-flex items-center gap-2 text-indigo-400 hover:text-indigo-300 text-sm transition-colors"
              >
                {t("upload.viewTransactions")} <ArrowRight size={14} />
              </Link>
            </div>
          ) : (
            <div className="bg-amber-950/30 border border-amber-800/40 rounded-xl p-5">
              <p className="text-amber-300 font-semibold">{t(reasonKey(result))}</p>
            </div>
          )}

          {pendingSuggestions.length > 0 && (
            <div className="bg-[#1A1A1A] border border-amber-900/30 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <Zap size={14} className="text-amber-400" />
                <p className="text-amber-300 text-sm font-semibold">{t("nw.suggestions")}</p>
              </div>
              <div className="space-y-2">
                {pendingSuggestions.map((s) => (
                  <div key={s.id} className="flex items-start justify-between gap-3 py-2 border-t border-[#2A2A2A] first:border-t-0 first:pt-0">
                    <div className="flex-1 min-w-0">
                      <p className="text-gray-300 text-xs">{s.reason}</p>
                      <p className="text-amber-400 text-xs font-semibold mt-0.5">
                        {parseFloat(s.suggested_change) >= 0 ? "+" : ""}
                        {parseFloat(s.suggested_change).toLocaleString()} {s.currency}
                      </p>
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      <button
                        onClick={() => handleAcceptSuggestion(s.id)}
                        className="px-2.5 py-1 rounded-lg bg-indigo-600/20 text-indigo-400 border border-indigo-800/40 text-xs font-medium hover:bg-indigo-600/30 transition-colors"
                      >
                        {t("nw.accept")}
                      </button>
                      <button
                        onClick={() => handleDismissSuggestion(s.id)}
                        className="px-2.5 py-1 rounded-lg bg-[#2A2A2A] text-gray-400 text-xs hover:text-gray-200 transition-colors"
                      >
                        {t("nw.rejectSuggestion")}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {state === "error" && (
        <div className="mt-5 bg-red-950/40 border border-red-800/60 rounded-xl p-5">
          <p className="text-red-400 font-medium">{t("common.error")}</p>
          <p className="text-red-500 text-sm mt-1">{errorMsg}</p>
        </div>
      )}
    </PageLayout>
  );
}
