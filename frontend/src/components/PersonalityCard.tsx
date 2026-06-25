"use client";

import { useEffect, useState } from "react";
import { getPersonality, PersonalityData } from "@/lib/api";
import { useLanguage } from "@/lib/i18n";
import Mim from "@/components/companion/Mim";

// Each personality type gets one accent hex + an emoji. Colours are applied via
// inline style (theme-independent, reliable) as soft washes / discs / borders;
// readable text stays on ink tokens so it works on both light and dark cards.
const TYPE_META: Record<string, { hex: string; icon: string }> = {
  "Anlık Karar Verici": { hex: "#B0741E", icon: "⚡" },
  "Planlı Harcayan":    { hex: "#1F7A5C", icon: "📋" },
  "Tasarruf Odaklı":    { hex: "#0F8A78", icon: "🏦" },
  "Konfor Odaklı":      { hex: "#8A6FB0", icon: "✨" },
  "Dengesiz Harcayan":  { hex: "#5B7A99", icon: "📊" },
};
const DEFAULT_META = { hex: "#64748B", icon: "💡" };

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
      <div className="bg-surface border border-line rounded-2xl p-6 animate-pulse">
        <div className="flex items-center gap-4 mb-5">
          <div className="w-14 h-14 rounded-2xl bg-surface-2" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-28 bg-surface-2 rounded" />
            <div className="h-5 w-44 bg-surface-2 rounded" />
          </div>
        </div>
        <div className="h-4 w-full bg-surface-2/70 rounded mb-2" />
        <div className="h-4 w-3/4 bg-surface-2/70 rounded" />
      </div>
    );
  }

  if (!data || data.type === "Henüz Analiz Yok") return null;

  const meta = TYPE_META[data.type] ?? DEFAULT_META;
  const { hex, icon } = meta;

  return (
    <div
      className="bg-surface border border-line rounded-2xl overflow-hidden shadow-sm"
      style={{ borderLeft: `3px solid ${hex}` }}
    >
      {/* ── Identity hero ── */}
      <div className="relative p-6">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: `linear-gradient(135deg, ${hex}14, transparent 58%)` }}
        />
        <div className="relative flex items-start gap-4">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl shrink-0"
            style={{ backgroundColor: `${hex}1F`, border: `1px solid ${hex}55` }}
          >
            {icon}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] uppercase tracking-wider text-ink-mute mb-0.5">{t("progress.personality")}</p>
            <h3 className="text-xl font-bold text-ink leading-tight truncate">{data.type}</h3>
            <div className="mt-2 h-1 w-12 rounded-full" style={{ backgroundColor: hex }} />
          </div>
          {data.cached && <span className="text-[11px] text-ink-mute shrink-0">{t("progress.cached")}</span>}
        </div>
        {data.description && (
          <p className="relative text-ink-soft text-[15px] leading-relaxed mt-4">{data.description}</p>
        )}
      </div>

      {/* ── Strengths / Watch-out — two distinct panels with a hairline seam ── */}
      {(data.strengths.length > 0 || data.watch_out.length > 0) && (
        <div className="grid sm:grid-cols-2 gap-px bg-line border-t border-line">
          {data.strengths.length > 0 && (
            <InsightPanel
              label={t("progress.pStrengths")}
              count={data.strengths.length}
              items={data.strengths}
              tone="pos"
            />
          )}
          {data.watch_out.length > 0 && (
            <InsightPanel
              label={t("progress.pWatchOut")}
              count={data.watch_out.length}
              items={data.watch_out}
              tone="warn"
            />
          )}
        </div>
      )}

      {/* ── Mim's tip ── */}
      {data.tip && (
        <div className="flex items-start gap-3 p-5 border-t border-line bg-brand/[0.06]">
          <div className="w-8 h-8 rounded-xl bg-brand/10 flex items-center justify-center shrink-0">
            <Mim size={22} quiet />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-brand mb-0.5">{t("progress.pTip")}</p>
            <p className="text-sm text-ink-soft leading-relaxed">{data.tip}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function InsightPanel({
  label, count, items, tone,
}: { label: string; count: number; items: string[]; tone: "pos" | "warn" }) {
  const isPos = tone === "pos";
  const dot = isPos ? "#1F7A5C" : "#B0741E";
  return (
    <div className="bg-surface p-5">
      <div className="flex items-center gap-2 mb-3">
        <span
          className="w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0"
          style={{ backgroundColor: dot }}
        >
          {isPos ? "✓" : "!"}
        </span>
        <span className={`text-xs font-semibold uppercase tracking-wider ${isPos ? "text-pos" : "text-warn"}`}>{label}</span>
        <span className="text-[11px] text-ink-mute tabular-nums">{count}</span>
      </div>
      <ul className="space-y-2">
        {items.map((s, i) => (
          <li key={i} className="flex gap-2.5 text-sm text-ink-soft leading-relaxed">
            <span className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: dot }} />
            <span className="min-w-0">{s}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
