"use client";

import { useEffect, useState } from "react";
import { getPersonality, PersonalityData } from "@/lib/api";
import { useLanguage } from "@/lib/i18n";

// Literal-hex arbitrary classes (written out statically so Tailwind's JIT keeps
// them) — theme-independent accent colours that read correctly on both the light
// and dark card surface, unlike the old dark-only *-950 / *-300 palette.
const TYPE_CONFIG: Record<string, {
  accent: string;
  icon: string;
  badgeBg: string;
  badgeText: string;
  dotColor: string;
}> = {
  "Anlık Karar Verici": {
    accent: "border-l-[#B0741E]", icon: "⚡",
    badgeBg: "bg-[#B0741E]/12 border-[#B0741E]/35", badgeText: "text-[#B0741E]", dotColor: "bg-[#B0741E]",
  },
  "Planlı Harcayan": {
    accent: "border-l-[#1F7A5C]", icon: "📋",
    badgeBg: "bg-[#1F7A5C]/12 border-[#1F7A5C]/35", badgeText: "text-[#1F7A5C]", dotColor: "bg-[#1F7A5C]",
  },
  "Tasarruf Odaklı": {
    accent: "border-l-[#0F5C5E]", icon: "🏦",
    badgeBg: "bg-[#0F5C5E]/12 border-[#0F5C5E]/35", badgeText: "text-[#0F5C5E]", dotColor: "bg-[#0F5C5E]",
  },
  "Konfor Odaklı": {
    accent: "border-l-[#8A6FB0]", icon: "✨",
    badgeBg: "bg-[#8A6FB0]/12 border-[#8A6FB0]/35", badgeText: "text-[#8A6FB0]", dotColor: "bg-[#8A6FB0]",
  },
  "Dengesiz Harcayan": {
    accent: "border-l-[#5B7A99]", icon: "📊",
    badgeBg: "bg-[#5B7A99]/12 border-[#5B7A99]/35", badgeText: "text-[#5B7A99]", dotColor: "bg-[#5B7A99]",
  },
};

const DEFAULT_CONFIG = {
  accent: "border-l-line-strong",
  icon: "💡",
  badgeBg: "bg-surface-2 border-line",
  badgeText: "text-ink-soft",
  dotColor: "bg-[#94A3B8]",
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
      <div className="bg-surface border border-line rounded-xl p-6 animate-pulse mb-6">
        <div className="h-5 w-48 bg-surface-2 rounded mb-3" />
        <div className="h-4 w-full bg-surface-2/60 rounded mb-2" />
        <div className="h-4 w-3/4 bg-surface-2/60 rounded" />
      </div>
    );
  }

  if (!data || data.type === "Henüz Analiz Yok") return null;

  const cfg = TYPE_CONFIG[data.type] ?? DEFAULT_CONFIG;

  return (
    <div className={`bg-surface border border-line border-l-2 ${cfg.accent} rounded-xl p-6 mb-6`}>
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex items-center gap-3">
          <div className="text-2xl">{cfg.icon}</div>
          <div>
            <p className="text-xs text-ink-mute uppercase tracking-wider mb-1">{t("progress.personality")}</p>
            <span className={`inline-flex items-center gap-1.5 text-sm font-semibold px-3 py-1 rounded-full border ${cfg.badgeBg} ${cfg.badgeText}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${cfg.dotColor}`} />
              {data.type}
            </span>
          </div>
        </div>
        {data.cached && <span className="text-xs text-ink-mute shrink-0">{t("progress.cached")}</span>}
      </div>

      <p className="text-ink-soft text-sm leading-relaxed mb-5">{data.description}</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
        {data.strengths.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-pos uppercase tracking-wider mb-2">✓</p>
            <ul className="space-y-1.5">
              {data.strengths.map((s, i) => (
                <li key={i} className="flex gap-2 text-sm text-ink-soft items-start">
                  <span className="text-pos shrink-0 mt-0.5">✓</span>
                  {s}
                </li>
              ))}
            </ul>
          </div>
        )}
        {data.watch_out.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-warn uppercase tracking-wider mb-2">!</p>
            <ul className="space-y-1.5">
              {data.watch_out.map((w, i) => (
                <li key={i} className="flex gap-2 text-sm text-ink-soft items-start">
                  <span className="text-warn shrink-0 mt-0.5">!</span>
                  {w}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {data.tip && (
        <div className="bg-brand/10 border border-brand/30 rounded-lg p-3">
          <p className="text-sm text-ink-soft">{data.tip}</p>
        </div>
      )}
    </div>
  );
}
