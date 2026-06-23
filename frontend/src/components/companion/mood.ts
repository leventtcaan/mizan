/**
 * Mim — the companion that lives inside Mizan.
 * Named after م (mīm), the letter that begins "Mizan". Mim is the soul of the balance:
 * it greets you, reads your money, and tells you the one thing that matters.
 *
 * Mim has no opinions of its own — its mood is a deterministic read of your finances,
 * so it never lies and never performs. Good state → it's bright and calm. Trouble → it leans in.
 */

export type MimMood = "calm" | "happy" | "concerned" | "alert" | "thinking";

export interface MoodPalette {
  /** Bright inner core of the orb. */
  core: string;
  /** Mood color — the body of the orb and its glow. */
  body: string;
  /** Soft outer halo. */
  glow: string;
}

export const MOOD_PALETTE: Record<MimMood, MoodPalette> = {
  calm: { core: "#c7d2fe", body: "#6366f1", glow: "#4338ca" },
  happy: { core: "#a7f3d0", body: "#10b981", glow: "#047857" },
  concerned: { core: "#fde68a", body: "#f59e0b", glow: "#b45309" },
  alert: { core: "#fecaca", body: "#ef4444", glow: "#b91c1c" },
  thinking: { core: "#ddd6fe", body: "#8b5cf6", glow: "#6d28d9" },
};

/** Map the Home "one sentence" tone onto Mim's mood. */
export function moodFromTone(tone: "good" | "warn" | "bad"): MimMood {
  if (tone === "good") return "happy";
  if (tone === "warn") return "concerned";
  return "alert";
}
