"use client";

/**
 * WHAT: Landing page — displays brand name, tagline, and live backend connectivity status.
 * WHY: Proves the full stack (browser → Next.js → FastAPI → response) is wired end-to-end.
 * BREAKS IF REMOVED: No entry point for users; Phase 0 has no visible proof of life.
 */

import { useEffect, useState } from "react";
import { checkHealth } from "@/lib/api";

type ConnectionStatus = "loading" | "ok" | "error";

export default function HomePage() {
  const [status, setStatus] = useState<ConnectionStatus>("loading");

  // WHY: useEffect runs after hydration — safe for client-side fetch.
  // ALTERNATIVE: Next.js Server Component fetch. TRADEOFF: Server fetch won't show
  // real-time browser-to-backend connectivity; it tests server-to-backend instead.
  useEffect(() => {
    checkHealth()
      .then(() => setStatus("ok"))
      .catch(() => setStatus("error"));
  }, []);

  const statusConfig: Record<
    ConnectionStatus,
    { label: string; dotClass: string }
  > = {
    loading: {
      label: "Bağlanıyor...",
      dotClass: "bg-yellow-400 animate-pulse",
    },
    ok: {
      label: "Sistem aktif",
      dotClass: "bg-green-500",
    },
    error: {
      label: "Bağlantı hatası",
      dotClass: "bg-red-500",
    },
  };

  const { label, dotClass } = statusConfig[status];

  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-gray-950 text-white">
      <h1 className="text-7xl font-bold mb-4 tracking-tight">Mizan</h1>
      <p className="text-xl text-gray-400 mb-16">Harcama davranışını anla.</p>

      <div className="flex items-center gap-3 px-5 py-3 rounded-full bg-gray-900 border border-gray-800">
        <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${dotClass}`} />
        <span className="text-sm text-gray-300">{label}</span>
      </div>
    </main>
  );
}
