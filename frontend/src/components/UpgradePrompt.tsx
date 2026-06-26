"use client";

import Link from "next/link";
import { Sparkles, CheckCircle, ArrowRight } from "@/components/ui/Icons";
import { useLanguage } from "@/lib/i18n";

/**
 * Shown when a free user hits a paid-only feature (HTTP 403 `upgrade_required`).
 * `feature` keys into the `upgradePrompt.<feature>` locale block for the headline,
 * description and the concrete list of what they're missing.
 *
 * variant="card"   — full attention block for a dedicated page (reports, simulator)
 * variant="teaser" — compact inline panel that sits among other content (nw guidance)
 */
export default function UpgradePrompt({
  feature,
  variant = "card",
  icon,
}: {
  feature: "reports" | "simulator" | "guidance";
  variant?: "card" | "teaser";
  icon?: React.ReactNode;
}) {
  const { t, tList } = useLanguage();
  const base = `upgradePrompt.${feature}`;
  const features = tList(`${base}.features`);

  if (variant === "teaser") {
    return (
      <div className="rounded-2xl border border-[#176B5B]/30 bg-[#176B5B]/[0.06] p-5">
        <div className="flex items-center gap-2 mb-2">
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-[#176B5B] bg-[#176B5B]/10 px-2 py-0.5 rounded-full">
            <Sparkles size={11} /> {t("upgradePrompt.badge")}
          </span>
        </div>
        <h3 className="text-base font-bold text-ink">{t(`${base}.title`)}</h3>
        <p className="text-sm text-ink-soft leading-relaxed mt-1.5">{t(`${base}.desc`)}</p>
        <ul className="mt-3 space-y-1.5">
          {features.map((f) => (
            <li key={f} className="flex items-start gap-2 text-sm text-ink-soft">
              <CheckCircle size={15} className="text-[#176B5B] shrink-0 mt-0.5" />
              <span>{f}</span>
            </li>
          ))}
        </ul>
        <Link
          href="/upgrade"
          className="mt-4 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#176B5B] hover:bg-[#125848] text-white text-sm font-semibold transition-colors"
        >
          <Sparkles size={14} /> {t("upgradePrompt.teaserCta")} <ArrowRight size={14} />
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto rounded-2xl border border-[#176B5B]/30 bg-[#176B5B]/[0.05] p-8 sm:p-10 text-center shadow-lg shadow-[#176B5B]/10">
      <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[#176B5B]/12 text-[#176B5B] mb-5">
        {icon ?? <Sparkles size={26} />}
      </div>
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-[#176B5B] bg-[#176B5B]/10 px-2.5 py-1 rounded-full">
        <Sparkles size={11} /> {t("upgradePrompt.badge")}
      </span>
      <h2 className="text-2xl font-bold text-ink mt-4">{t(`${base}.title`)}</h2>
      <p className="text-ink-soft leading-relaxed mt-2.5 max-w-lg mx-auto">{t(`${base}.desc`)}</p>

      <ul className="mt-7 space-y-3 text-left max-w-md mx-auto">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2.5 text-sm text-ink-soft">
            <CheckCircle size={18} className="text-[#176B5B] shrink-0 mt-0.5" />
            <span>{f}</span>
          </li>
        ))}
      </ul>

      <Link
        href="/upgrade"
        className="mt-8 inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-[#176B5B] hover:bg-[#125848] text-white text-sm font-semibold shadow-sm transition-colors"
      >
        <Sparkles size={16} /> {t("upgradePrompt.cta")} <ArrowRight size={16} />
      </Link>
      <p className="text-ink-mute text-xs mt-4">{t("upgradePrompt.note")}</p>
    </div>
  );
}
