"use client";

import { useState } from "react";
import type { GuidanceFinding } from "@/lib/api";
import { ChevronDown, ChevronUp, ArrowRight, Bell, RefreshCw, Target, Plus } from "@/components/ui/Icons";
import Mim from "@/components/companion/Mim";

const SEV: Record<string, { dot: string; chip: string; border: string }> = {
  high:   { dot: "bg-red-500",    chip: "text-red-300 bg-red-950/40 border-red-900/40",       border: "border-l-red-600/60" },
  medium: { dot: "bg-amber-500",  chip: "text-amber-300 bg-amber-950/40 border-amber-900/40", border: "border-l-amber-600/60" },
  low:    { dot: "bg-sky-500",    chip: "text-sky-300 bg-sky-950/40 border-sky-900/40",       border: "border-l-sky-600/50" },
};

const ACTION_ICON: Record<string, React.ReactNode> = {
  discuss: <Mim size={14} quiet />,
  set_goal: <Target size={13} />,
  create_alert: <Bell size={13} />,
  refresh_prices: <RefreshCw size={13} />,
  add_liability: <Plus size={13} />,
};

export default function GuidancePanel({
  findings,
  loading,
  onAction,
  t,
}: {
  findings: GuidanceFinding[];
  loading: boolean;
  onAction: (f: GuidanceFinding) => void;
  t: (k: string) => string;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  if (loading) {
    return <div className="mb-6 h-32 rounded-2xl bg-surface border border-line animate-pulse" />;
  }
  if (!findings || findings.length === 0) {
    return (
      <div className="mb-6 bg-surface border border-line rounded-2xl p-5 flex items-center gap-3">
        <div className="w-8 h-8 flex items-center justify-center shrink-0">
          <Mim size={30} mood="happy" quiet />
        </div>
        <div>
          <p className="text-ink-soft text-sm font-medium">{t("nw.guidance.allClearTitle")}</p>
          <p className="text-ink-mute text-xs">{t("nw.guidance.allClearDesc")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-6 bg-surface border border-line rounded-2xl overflow-hidden">
      <div className="flex items-center gap-2 px-5 pt-4 pb-3">
        <div className="w-7 h-7 flex items-center justify-center">
          <Mim size={26} quiet />
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-ink">{t("nw.guidance.title")}</p>
          <p className="text-[11px] text-ink-mute">{t("nw.guidance.subtitle")}</p>
        </div>
      </div>

      <div className="divide-y divide-surface-2">
        {findings.map((f) => {
          const sev = SEV[f.severity] ?? SEV.low;
          const open = expanded[f.id] ?? false;
          return (
            <div key={f.id} className={`border-l-2 ${sev.border} px-5 py-3.5`}>
              <button
                onClick={() => setExpanded((p) => ({ ...p, [f.id]: !p[f.id] }))}
                className="w-full flex items-start gap-2.5 text-left"
              >
                <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${sev.dot}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-ink-soft text-sm font-medium leading-snug">{f.observation}</p>
                  {!open && <p className="text-ink-mute text-xs mt-0.5 line-clamp-1">{f.context}</p>}
                </div>
                <span className="mt-0.5 text-ink-mute">{open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}</span>
              </button>

              {open && (
                <div className="pl-[18px] mt-2 space-y-2">
                  <p className="text-ink-mute text-sm leading-relaxed">{f.context}</p>
                  <p className="text-ink-soft text-sm leading-relaxed">{f.why}</p>
                  <div className="flex items-start gap-2 bg-canvas border border-line rounded-lg px-3 py-2">
                    <ArrowRight size={14} className="text-brand mt-0.5 shrink-0" />
                    <p className="text-ink-soft text-sm leading-relaxed flex-1">{f.move}</p>
                  </div>
                  {f.action && (
                    <button
                      onClick={() => onAction(f)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand/90 hover:bg-brand-hover text-white text-xs font-medium transition-colors"
                    >
                      {ACTION_ICON[f.action.type]}
                      {t(`nw.guidance.action.${f.action.type}`)}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="px-5 py-2.5 text-[10px] text-ink-mute border-t border-line bg-[#16130F]">
        {t("nw.guidance.disclaimer")}
      </p>
    </div>
  );
}
