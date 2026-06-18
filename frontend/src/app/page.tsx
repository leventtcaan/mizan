"use client";

/**
 * WHAT: Landing page — displays brand name, tagline, connectivity status, and nav links.
 * WHY: Entry point for all users; links to upload and transactions complete the core flow.
 * BREAKS IF REMOVED: No entry point for users.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { checkHealth, getToken, getStoredUser } from "@/lib/api";

type ConnectionStatus = "loading" | "ok" | "error";

export default function HomePage() {
  const [status, setStatus] = useState<ConnectionStatus>("loading");
  const [userEmail, setUserEmail] = useState<string | null>(null);

  useEffect(() => {
    checkHealth()
      .then(() => setStatus("ok"))
      .catch(() => setStatus("error"));

    // WHY: localStorage only available after hydration — read token here, not at render.
    if (getToken()) {
      setUserEmail(getStoredUser()?.email ?? null);
    }
  }, []);

  const statusConfig: Record<ConnectionStatus, { label: string; dotClass: string }> = {
    loading: { label: "Bağlanıyor...", dotClass: "bg-yellow-400 animate-pulse" },
    ok:      { label: "Sistem aktif",  dotClass: "bg-green-500" },
    error:   { label: "Bağlantı hatası", dotClass: "bg-red-500" },
  };

  const { label, dotClass } = statusConfig[status];
  const isLoggedIn = userEmail !== null;

  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-gray-950 text-white">
      {isLoggedIn && (
        <div className="absolute top-4 right-4 flex items-center gap-3">
          <span className="text-gray-500 text-xs">{userEmail}</span>
          <Link
            href="/transactions"
            className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm text-gray-300 transition-colors"
          >
            İşlemlerim
          </Link>
        </div>
      )}

      <h1 className="text-7xl font-bold mb-4 tracking-tight">Mizan</h1>
      <p className="text-xl text-gray-400 mb-16">Harcama davranışını anla.</p>

      <div className="flex items-center gap-3 px-5 py-3 rounded-full bg-gray-900 border border-gray-800">
        <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${dotClass}`} />
        <span className="text-sm text-gray-300">{label}</span>
      </div>

      <div className="mt-12 flex gap-4">
        <Link
          href={isLoggedIn ? "/transactions" : "/login"}
          className="px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 font-semibold text-sm transition-colors"
        >
          {isLoggedIn ? "Devam Et" : "Başla"}
        </Link>
        {isLoggedIn && (
          <Link
            href="/upload"
            className="px-6 py-3 rounded-xl bg-gray-800 hover:bg-gray-700 font-semibold text-sm transition-colors text-gray-300"
          >
            Ekstre Yükle
          </Link>
        )}
      </div>
    </main>
  );
}
