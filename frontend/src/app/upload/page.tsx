"use client";

/**
 * WHAT: File upload page — drag-and-drop or click-to-select a PDF/CSV bank statement.
 * WHY: Entry point for the core user flow; without this the app collects no data.
 * BREAKS IF REMOVED: Users have no way to submit bank statements.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { uploadStatement, getStoredUser, clearToken, type UploadResponse } from "@/lib/api";

type UploadState = "idle" | "uploading" | "success" | "error";

export default function UploadPage() {
  const router = useRouter();
  const [state, setState] = useState<UploadState>("idle");
  const [dragOver, setDragOver] = useState(false);
  const [result, setResult] = useState<UploadResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  useEffect(() => {
    const user = getStoredUser();
    if (!user) { router.replace("/login"); return; }
    setUserEmail(user.email);
  }, [router]);

  const handleLogout = () => { clearToken(); router.push("/login"); };

  const handleFile = useCallback((file: File) => {
    setSelectedFile(file);
    setResult(null);
    setErrorMsg("");
    setState("idle");
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleUpload = useCallback(async () => {
    if (!selectedFile) return;
    setState("uploading");
    try {
      const response = await uploadStatement(selectedFile);
      setResult(response);
      setState("success");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Yükleme başarısız oldu.");
      setState("error");
    }
  }, [selectedFile]);

  return (
    <main className="min-h-screen bg-gray-950 text-white px-4 py-10">
      <div className="max-w-lg mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <Link href="/" className="text-gray-500 text-sm hover:text-gray-300 transition-colors">
              ← Mizan
            </Link>
            <h1 className="text-3xl font-bold mt-4">Ekstre Yükle</h1>
            <p className="text-gray-400 mt-1 text-sm">
              PDF veya CSV formatındaki banka ekstrenizi yükleyin.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {userEmail && (
              <span className="text-gray-500 text-xs hidden sm:block">{userEmail}</span>
            )}
            <button
              onClick={handleLogout}
              className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm text-gray-300 transition-colors"
            >
              Çıkış
            </button>
            <Link
              href="/transactions"
              className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm text-gray-300 transition-colors"
            >
              İşlemler
            </Link>
            <Link
              href="/progress"
              className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm text-gray-300 transition-colors"
            >
              İlerleme
            </Link>
          </div>
        </div>

        <div
          onDrop={handleDrop}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          className={`relative border-2 border-dashed rounded-xl p-10 text-center transition-colors cursor-pointer ${
            dragOver
              ? "border-indigo-500 bg-indigo-950"
              : "border-gray-700 bg-gray-900 hover:border-gray-500"
          }`}
          onClick={() => document.getElementById("file-input")?.click()}
        >
          <input
            id="file-input"
            type="file"
            accept=".pdf,.csv"
            className="hidden"
            onChange={handleInputChange}
          />
          <div className="text-4xl mb-3">📄</div>
          {selectedFile ? (
            <div>
              <p className="text-white font-medium">{selectedFile.name}</p>
              <p className="text-gray-400 text-sm mt-1">
                {(selectedFile.size / 1024).toFixed(1)} KB
              </p>
            </div>
          ) : (
            <div>
              <p className="text-gray-300">Dosyayı buraya sürükleyin</p>
              <p className="text-gray-500 text-sm mt-1">veya seçmek için tıklayın</p>
              <p className="text-gray-600 text-xs mt-3">PDF · CSV · Maks 10 MB</p>
            </div>
          )}
        </div>

        <button
          onClick={handleUpload}
          disabled={!selectedFile || state === "uploading"}
          className="mt-4 w-full py-3 px-4 rounded-xl font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-indigo-600 hover:bg-indigo-500 text-white"
        >
          {state === "uploading" ? "Yükleniyor..." : "Yükle ve Analiz Et"}
        </button>

        {state === "success" && result && (
          <div className="mt-6 p-4 rounded-xl bg-emerald-950 border border-emerald-800">
            <p className="text-emerald-300 font-medium">{result.message}</p>
            <p className="text-emerald-500 text-xs mt-1">İş ID: {result.job_id}</p>
            <p className="text-emerald-400 text-sm mt-3 font-semibold">
              {result.transaction_count} işlem bulundu ve kategorize edildi.
            </p>
            <Link
              href="/transactions"
              className="mt-4 inline-block text-sm text-indigo-400 hover:text-indigo-300 underline"
            >
              İşlemleri görüntüle →
            </Link>
          </div>
        )}

        {state === "error" && (
          <div className="mt-6 p-4 rounded-xl bg-red-950 border border-red-800">
            <p className="text-red-300 font-medium">Hata</p>
            <p className="text-red-400 text-sm mt-1">{errorMsg}</p>
          </div>
        )}
      </div>
    </main>
  );
}
