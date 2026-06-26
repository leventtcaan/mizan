"use client";

import Link from "next/link";
import Mim from "@/components/companion/Mim";
import { Sparkles, ArrowRight } from "@/components/ui/Icons";
import { useLanguage } from "@/lib/i18n";

/**
 * Shown to a free user who has spent their one monthly AI-processed upload. It renders
 * a faithful mock of the post-upload brief (Mim hero + headline flow + category bars),
 * blurred behind glass, with a crisp "Unlock every statement with Plus" overlay. The
 * point is loss aversion: they've seen the real brief once; this is the thing being
 * withheld. The numbers are illustrative, not the user's data.
 */
export default function BlurredBriefTeaser() {
  const { t } = useLanguage();

  // Illustrative category bars (label + share width + color) — purely decorative.
  const cats: { w: string; c: string }[] = [
    { w: "82%", c: "#1F7A5C" },
    { w: "61%", c: "#176B5B" },
    { w: "43%", c: "#C99A2E" },
  ];

  return (
    <div className="relative rounded-2xl overflow-hidden border border-line">
      {/* ── The (fake) brief, blurred behind glass ── */}
      <div aria-hidden className="select-none pointer-events-none blur-[6px] opacity-90 space-y-3 p-4 bg-canvas">
        {/* Mim hero + narrative */}
        <div className="flex items-start gap-3 bg-surface border border-line rounded-2xl p-5">
          <Mim size={56} mood="happy" speaking className="shrink-0" />
          <div className="flex-1 pt-1">
            <p className="text-ink font-semibold leading-snug">{t("upload.teaserNarrative")}</p>
            <div className="mt-2 h-2.5 rounded bg-surface-2 w-11/12" />
            <div className="mt-1.5 h-2.5 rounded bg-surface-2 w-3/4" />
          </div>
        </div>

        {/* Headline flow card */}
        <div className="bg-surface border border-line rounded-2xl p-6">
          <p className="text-5xl font-bold tabular-nums leading-none text-pos">+12,480</p>
          <div className="grid grid-cols-2 gap-3 mt-5">
            <div className="rounded-xl bg-surface-2 p-3">
              <p className="text-ink-mute text-[11px] mb-0.5">{t("upload.teaserIncome")}</p>
              <p className="text-pos text-lg font-bold tabular-nums">47,000</p>
            </div>
            <div className="rounded-xl bg-surface-2 p-3">
              <p className="text-ink-mute text-[11px] mb-0.5">{t("upload.teaserExpenses")}</p>
              <p className="text-neg text-lg font-bold tabular-nums">34,520</p>
            </div>
          </div>
          <div className="mt-3 flex h-1.5 rounded-full overflow-hidden bg-surface-2">
            <div style={{ width: "58%", backgroundColor: "#1F7A5C" }} />
            <div style={{ width: "42%", backgroundColor: "#B54747" }} />
          </div>
        </div>

        {/* Category bars */}
        <div className="bg-surface border border-line rounded-2xl p-5 space-y-3">
          {cats.map((c, i) => (
            <div key={i}>
              <div className="flex justify-between mb-1">
                <span className="h-2.5 w-24 rounded bg-surface-2 inline-block" />
                <span className="h-2.5 w-12 rounded bg-surface-2 inline-block" />
              </div>
              <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden">
                <div className="h-full rounded-full" style={{ width: c.w, backgroundColor: c.c }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Crisp unlock overlay ── */}
      <div className="absolute inset-0 flex items-center justify-center p-6"
        style={{ background: "linear-gradient(180deg, rgba(0,0,0,0.04), rgba(0,0,0,0.10))" }}>
        <div className="text-center max-w-sm rounded-2xl bg-surface/95 border border-[#176B5B]/30 shadow-xl px-6 py-6">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-[#176B5B]/12 text-[#176B5B] mb-3">
            <Sparkles size={22} />
          </div>
          <h3 className="text-lg font-bold text-ink">{t("upload.teaserUnlockTitle")}</h3>
          <p className="text-ink-soft text-sm leading-relaxed mt-1.5">{t("upload.teaserUnlockBody")}</p>
          <Link
            href="/upgrade"
            className="mt-4 inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#176B5B] hover:bg-[#125848] text-white text-sm font-semibold shadow-sm transition-colors"
          >
            <Sparkles size={15} /> {t("upgradePrompt.teaserCta")} <ArrowRight size={15} />
          </Link>
        </div>
      </div>
    </div>
  );
}
