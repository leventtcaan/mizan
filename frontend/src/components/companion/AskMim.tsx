"use client";

import Mim from "./Mim";
import type { MimMood } from "./mood";

/**
 * Open the Mim companion with a question already typed in. Pass `scope` to bind the
 * conversation to one upload batch (a specific statement/brief), so Mim answers with
 * THAT statement's numbers instead of the user's aggregate data.
 */
export function openMim(prefill: string, scope?: { jobId: string; scopeLabel?: string }) {
  window.dispatchEvent(new CustomEvent("mizan-open-assistant", {
    detail: { prefill, jobId: scope?.jobId, scopeLabel: scope?.scopeLabel },
  }));
}

/**
 * The single "ask Mim" affordance, used everywhere a surface invites a conversation
 * (Home, the Brief, Net Worth guidance, …). One look, one entity — the mini Mim orb —
 * so all entry points read as the same companion instead of five different buttons.
 */
export default function AskMim({
  prefill, label, mood = "calm", size = 16, className = "", jobId, scopeLabel,
}: {
  prefill: string;
  label: string;
  mood?: MimMood;
  size?: number;
  className?: string;
  // When set, the conversation is scoped to this upload batch (statement/brief).
  jobId?: string;
  scopeLabel?: string;
}) {
  return (
    <button
      onClick={() => openMim(prefill, jobId ? { jobId, scopeLabel } : undefined)}
      className={`inline-flex items-center gap-1.5 text-brand hover:text-brand text-sm transition-colors ${className}`}
    >
      <Mim mood={mood} size={size} quiet />
      {label}
    </button>
  );
}
