"use client";

import { useEffect, useState } from "react";
import { getPersonality, PersonalityData } from "@/lib/api";
import { useLanguage } from "@/lib/i18n";

const TYPE_CONFIG: Record<string, {
  accent: string;
  icon: string;
  badgeBg: string;
  badgeText: string;
  dotColor: string;
}> = {
  "Anlık Karar Verici": {
    accent: "border-l-orange-500",
    icon: "⚡",
    badgeBg: "bg-orange-950 border-orange-800",
    badgeText: "text-orange-300",
    dotColor: "bg-orange-500",
  },
  "Planlı Harcayan": {
    accent: "border-l-emerald-500",
    icon: "📋",
    badgeBg: "bg-emerald-950 border-emerald-800",
    badgeText: "text-emerald-300",
    dotColor: "bg-emerald-500",
  },
  "Tasarruf Odaklı": {
    accent: "border-l-blue-500",
    icon: "🏦",
    badgeBg: "bg-blue-950 border-blue-800",
    badgeText: "text-blue-300",
    dotColor: "bg-blue-500",
  },
  "Konfor Odaklı": {
    accent: "border-l-purple-500",
    icon: "✨",
    badgeBg: "bg-purple-950 border-purple-800",
    badgeText: "text-purple-300",
    dotColor: "bg-purple-500",
  },
  "Dengesiz Harcayan": {
    accent: "border-l-yellow-500",
    icon: "📊",
    badgeBg: "bg-yellow-950 border-yellow-800",
    badgeText: "text-yellow-300",
    dotColor: "bg-yellow-500",
  },
};

const DEFAULT_CONFIG = {
  accent: "border-l-gray-600",
  icon: "💡",
  badgeBg: "bg-[#2A2A2A] border-[#3A3A3A]",
  badgeText: "text-gray-300",
  dotColor: "bg-gray-500",
};

export default function PersonalityCard() {
  const { t } = useLanguage();
  const [data, setData] = useState<PersonalityData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getPersonality()
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-6 animate-pulse mb-6">
        <div className="h-5 w-48 bg-[#2A2A2A] rounded mb-3" />
        <div className="h-4 w-full bg-[#2A2A2A]/60 rounded mb-2" />
        <div className="h-4 w-3/4 bg-[#2A2A2A]/60 rounded" />
      </div>
    );
  }

  if (!data || data.type === "Henüz Analiz Yok") return null;

  const cfg = TYPE_CONFIG[data.type] ?? DEFAULT_CONFIG;

  return (
    <div className={`bg-[#1A1A1A] border border-[#2A2A2A] border-l-2 ${cfg.accent} rounded-xl p-6 mb-6`}>
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex items-center gap-3">
          <div className="text-2xl">{cfg.icon}</div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">{t("progress.personality")}</p>
            <span className={`inline-flex items-center gap-1.5 text-sm font-semibold px-3 py-1 rounded-full border ${cfg.badgeBg} ${cfg.badgeText}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${cfg.dotColor}`} />
              {data.type}
            </span>
          </div>
        </div>
        {data.cached && <span className="text-xs text-gray-600 shrink-0">{t("progress.cached")}</span>}
      </div>

      <p className="text-gray-300 text-sm leading-relaxed mb-5">{data.description}</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
        {data.strengths.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-emerald-500 uppercase tracking-wider mb-2">✓</p>
            <ul className="space-y-1.5">
              {data.strengths.map((s, i) => (
                <li key={i} className="flex gap-2 text-sm text-gray-300 items-start">
                  <span className="text-emerald-500 shrink-0 mt-0.5">✓</span>
                  {s}
                </li>
              ))}
            </ul>
          </div>
        )}
        {data.watch_out.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-amber-500 uppercase tracking-wider mb-2">!</p>
            <ul className="space-y-1.5">
              {data.watch_out.map((w, i) => (
                <li key={i} className="flex gap-2 text-sm text-gray-300 items-start">
                  <span className="text-amber-500 shrink-0 mt-0.5">!</span>
                  {w}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {data.tip && (
        <div className="bg-indigo-950/30 border border-indigo-900/40 rounded-lg p-3">
          <p className="text-sm text-gray-300">{data.tip}</p>
        </div>
      )}
    </div>
  );
}
