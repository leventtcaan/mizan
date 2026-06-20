"use client";

import { useEffect, useState } from "react";
import { getPersonality, PersonalityData } from "@/lib/api";

const TYPE_STYLES: Record<string, { bg: string; border: string; badge: string }> = {
  "Anlık Karar Verici": {
    bg: "bg-orange-950/30",
    border: "border-orange-700/40",
    badge: "bg-orange-600 text-white",
  },
  "Planlı Harcayan": {
    bg: "bg-emerald-950/30",
    border: "border-emerald-700/40",
    badge: "bg-emerald-600 text-white",
  },
  "Tasarruf Odaklı": {
    bg: "bg-blue-950/30",
    border: "border-blue-700/40",
    badge: "bg-blue-600 text-white",
  },
  "Konfor Odaklı": {
    bg: "bg-purple-950/30",
    border: "border-purple-700/40",
    badge: "bg-purple-600 text-white",
  },
  "Dengesiz Harcayan": {
    bg: "bg-yellow-950/30",
    border: "border-yellow-700/40",
    badge: "bg-yellow-600 text-white",
  },
};

const DEFAULT_STYLE = {
  bg: "bg-gray-800/30",
  border: "border-gray-700/40",
  badge: "bg-gray-600 text-white",
};

export default function PersonalityCard() {
  const [data, setData] = useState<PersonalityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getPersonality()
      .then(setData)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="bg-gray-800/40 border border-gray-700/40 rounded-xl p-6 animate-pulse">
        <div className="h-5 w-48 bg-gray-700 rounded mb-3" />
        <div className="h-4 w-full bg-gray-700/60 rounded mb-2" />
        <div className="h-4 w-3/4 bg-gray-700/60 rounded" />
      </div>
    );
  }

  if (error || !data) {
    return null;
  }

  // No-data state — backend returns this specific type string
  if (data.type === "Henüz Analiz Yok") {
    return null;
  }

  const style = TYPE_STYLES[data.type] ?? DEFAULT_STYLE;

  return (
    <div className={`rounded-xl border p-6 ${style.bg} ${style.border}`}>
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">
            Finansal Kişilik Tipin
          </p>
          <span className={`inline-block text-sm font-semibold px-3 py-1 rounded-full ${style.badge}`}>
            {data.type}
          </span>
        </div>
        {data.cached && (
          <span className="text-xs text-gray-500 mt-1 shrink-0">önbellekten</span>
        )}
      </div>

      <p className="text-gray-300 text-sm leading-relaxed mb-5">{data.description}</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
        {data.strengths.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-emerald-400 uppercase tracking-wider mb-2">
              Güçlü Yönlerin
            </p>
            <ul className="space-y-1">
              {data.strengths.map((s, i) => (
                <li key={i} className="flex gap-2 text-sm text-gray-300">
                  <span className="text-emerald-400 mt-0.5 shrink-0">✓</span>
                  {s}
                </li>
              ))}
            </ul>
          </div>
        )}

        {data.watch_out.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-yellow-400 uppercase tracking-wider mb-2">
              Dikkat Et
            </p>
            <ul className="space-y-1">
              {data.watch_out.map((w, i) => (
                <li key={i} className="flex gap-2 text-sm text-gray-300">
                  <span className="text-yellow-400 mt-0.5 shrink-0">!</span>
                  {w}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {data.tip && (
        <div className="bg-blue-900/30 border border-blue-700/30 rounded-lg p-3">
          <p className="text-xs font-semibold text-blue-400 uppercase tracking-wider mb-1">
            İpucu
          </p>
          <p className="text-sm text-gray-300">{data.tip}</p>
        </div>
      )}
    </div>
  );
}
