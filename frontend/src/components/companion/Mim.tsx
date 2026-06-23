"use client";

import { useId } from "react";
import { MimMood, MOOD_PALETTE } from "./mood";

interface MimProps {
  mood?: MimMood;
  size?: number;
  /** Subtle extra liveliness — e.g. while greeting or while the assistant is composing. */
  speaking?: boolean;
  /** Static, glow-free variant for inline/icon use (next to text, in buttons, on bubbles). */
  quiet?: boolean;
  className?: string;
}

/** Per-mood mouth path on a 100×100 canvas. Minimal, never cartoonish. */
const MOUTH: Record<MimMood, string> = {
  happy: "M40 62 Q50 72 60 62",
  calm: "M42 64 Q50 68 58 64",
  concerned: "M42 66 Q50 63 58 66",
  alert: "M44 64 Q50 71 56 64",
  thinking: "M44 65 Q50 67 56 65",
};

/**
 * Mim — a living orb. Pure SVG + CSS; no dependencies, no images.
 * Breathes, blinks, glows; its color and expression are driven entirely by mood.
 */
export default function Mim({ mood = "calm", size = 44, speaking = false, quiet = false, className = "" }: MimProps) {
  const uid = useId().replace(/:/g, "");
  const p = MOOD_PALETTE[mood];
  const eyeY = mood === "thinking" ? 41 : 43;

  return (
    <div
      className={`relative inline-block ${className}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {/* Soft outer glow — sits behind the orb, breathes on its own rhythm. (Off in quiet mode.) */}
      {!quiet && (
        <div
          className="absolute inset-0 rounded-full mim-glow"
          style={{
            background: `radial-gradient(circle, ${p.glow}66 0%, transparent 70%)`,
            filter: "blur(6px)",
          }}
        />
      )}
      <svg
        viewBox="0 0 100 100"
        width={size}
        height={size}
        className={`relative ${quiet ? "" : `mim-float ${speaking ? "mim-speaking" : ""}`}`}
      >
        <defs>
          <radialGradient id={`mim-body-${uid}`} cx="38%" cy="32%" r="72%">
            <stop offset="0%" stopColor={p.core} />
            <stop offset="55%" stopColor={p.body} />
            <stop offset="100%" stopColor={p.glow} />
          </radialGradient>
        </defs>

        {/* Balance-beam ring — a quiet nod to the scales. */}
        <circle cx="50" cy="50" r="46" fill="none" stroke={p.body} strokeOpacity="0.25" strokeWidth="1.5" />

        {/* The orb. */}
        <g className={quiet ? "" : "mim-breathe"}>
          <circle cx="50" cy="50" r="38" fill={`url(#mim-body-${uid})`} />
          {/* Top highlight — gives the orb volume. */}
          <ellipse cx="40" cy="34" rx="13" ry="9" fill="#ffffff" opacity="0.28" />

          {/* Face. */}
          <g className={quiet ? "" : "mim-eyes"} fill="#1e1b2e">
            <ellipse cx="39" cy={eyeY} rx="3.4" ry="4.6" />
            <ellipse cx="61" cy={eyeY} rx="3.4" ry="4.6" />
            {/* Catchlights — the spark of being alive. */}
            <circle cx="40.4" cy={eyeY - 1.6} r="1.1" fill="#ffffff" opacity="0.9" />
            <circle cx="62.4" cy={eyeY - 1.6} r="1.1" fill="#ffffff" opacity="0.9" />
          </g>
          <path
            d={MOUTH[mood]}
            fill="none"
            stroke="#1e1b2e"
            strokeWidth="2.4"
            strokeLinecap="round"
          />
        </g>
      </svg>
    </div>
  );
}
