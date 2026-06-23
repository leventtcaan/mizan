"use client";

import Mim from "./Mim";
import type { MimMood } from "./mood";

/** Open the Mim companion with a question already typed in. */
export function openMim(prefill: string) {
  window.dispatchEvent(new CustomEvent("mizan-open-assistant", { detail: { prefill } }));
}

/**
 * The single "ask Mim" affordance, used everywhere a surface invites a conversation
 * (Home, the Brief, Net Worth guidance, …). One look, one entity — the mini Mim orb —
 * so all entry points read as the same companion instead of five different buttons.
 */
export default function AskMim({
  prefill, label, mood = "calm", size = 16, className = "",
}: {
  prefill: string;
  label: string;
  mood?: MimMood;
  size?: number;
  className?: string;
}) {
  return (
    <button
      onClick={() => openMim(prefill)}
      className={`inline-flex items-center gap-1.5 text-indigo-400 hover:text-indigo-300 text-sm transition-colors ${className}`}
    >
      <Mim mood={mood} size={size} quiet />
      {label}
    </button>
  );
}
