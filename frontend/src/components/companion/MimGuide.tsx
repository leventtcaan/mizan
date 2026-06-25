"use client";

import Mim from "@/components/companion/Mim";
import type { MimMood } from "@/components/companion/mood";
import { useTheme } from "@/lib/theme";

/**
 * Mim as a guiding presence — the companion plus a speech bubble. Used across the
 * first-impression flow (register, verify, onboarding) so Mim is a real character
 * from the very first moment, not a chat button.
 *
 * Purely presentational: the message is always scripted by the caller, so this
 * NEVER triggers an LLM call (free / unverified users see Mim's personality without
 * any AI cost).
 */
export default function MimGuide({
  message,
  sub,
  mood = "calm",
  size = 60,
  speaking = true,
}: {
  message: string;
  sub?: string;
  mood?: MimMood;
  size?: number;
  speaking?: boolean;
}) {
  // Explicit bubble fill so it always reads as an opaque card in both themes.
  const { resolved } = useTheme();
  const bubbleBg = resolved === "dark" ? "#1C1915" : "#FFFFFF";

  return (
    <div className="flex items-start gap-3">
      <div className="shrink-0">
        <Mim size={size} mood={mood} speaking={speaking} />
      </div>
      <div className="relative flex-1 min-w-0 mt-1.5">
        {/* tail pointing toward Mim */}
        <span
          className="absolute -left-1.5 top-3.5 w-3 h-3 rotate-45 border-l border-b border-line"
          style={{ backgroundColor: bubbleBg }}
        />
        <div
          className="relative rounded-2xl border border-line px-4 py-3 shadow-sm"
          style={{ backgroundColor: bubbleBg }}
        >
          <p className="text-ink-soft text-sm leading-relaxed">{message}</p>
          {sub && <p className="text-ink-mute text-xs mt-1 leading-relaxed">{sub}</p>}
        </div>
      </div>
    </div>
  );
}
