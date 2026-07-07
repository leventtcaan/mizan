"use client";

import { useEffect, useState } from "react";
import { getToken, getReferralInfo, type ReferralInfo } from "@/lib/api";
import { Sparkles, CheckCircle, X, Mail } from "@/components/ui/Icons";
import { useLanguage } from "@/lib/i18n";

// One referral surface, three contexts:
//   hero     — Home, shown once after onboarding (dismissible; feels like a reward)
//   upgrade  — /upgrade, framed as the no-payment path to Pro
//   settings — Settings, the permanent prominent version with the running count
// All copy is honest about the actual mechanics: referrer +1 month Pro per signup,
// friend starts with a 7-day Pro trial.

const HERO_DISMISS_KEY = "mizan_ref_prompt_done";

export function heroReferralDismissed(): boolean {
  if (typeof window === "undefined") return true;
  return localStorage.getItem(HERO_DISMISS_KEY) === "1";
}

export default function ReferralCard({
  variant,
  onDismiss,
}: {
  variant: "hero" | "upgrade" | "settings";
  onDismiss?: () => void;
}) {
  const { t } = useLanguage();
  const [info, setInfo] = useState<ReferralInfo | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!getToken()) return;
    getReferralInfo().then(setInfo).catch(() => null);
  }, []);

  const copy = () => {
    if (!info) return;
    navigator.clipboard?.writeText(info.link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      // Copying counts as "seen and used" — the hero doesn't need to come back.
      if (variant === "hero") localStorage.setItem(HERO_DISMISS_KEY, "1");
    }).catch(() => null);
  };

  const share = async () => {
    if (!info) return;
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share({ title: "Clarifin", text: t("referral.shareText"), url: info.link });
        if (variant === "hero") localStorage.setItem(HERO_DISMISS_KEY, "1");
        return;
      } catch { /* user cancelled — fall through to copy */ }
    }
    copy();
  };

  const dismiss = () => {
    localStorage.setItem(HERO_DISMISS_KEY, "1");
    onDismiss?.();
  };

  if (!info) return null;

  const rewardChips = (
    <div className="flex flex-wrap gap-2">
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#176B5B]/10 text-[#176B5B] text-xs font-semibold">
        <Sparkles size={12} /> {t("referral.youChip")}
      </span>
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#176B5B]/10 text-[#176B5B] text-xs font-semibold">
        <Mail size={12} /> {t("referral.friendChip")}
      </span>
    </div>
  );

  const linkRow = (
    <div className="flex items-center gap-2 flex-wrap">
      <code className="flex-1 min-w-0 truncate px-3 py-2.5 rounded-lg bg-canvas/70 border border-line text-sm text-ink-soft">
        {info.link}
      </code>
      <button
        onClick={share}
        className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-[#176B5B] hover:bg-[#125848] text-white text-sm font-semibold shadow-sm transition-colors"
      >
        {copied ? <><CheckCircle size={15} /> {t("referral.copied")}</> : t("referral.copy")}
      </button>
    </div>
  );

  if (variant === "hero") {
    return (
      <div className="relative overflow-hidden rounded-2xl border border-[#176B5B]/30 p-5 mb-6"
        style={{ background: "linear-gradient(120deg, rgba(23,107,91,0.10), rgba(23,107,91,0.03) 60%)" }}>
        <button onClick={dismiss} aria-label={t("common.close")}
          className="absolute top-3 right-3 p-1.5 rounded-lg text-ink-mute hover:text-ink hover:bg-surface-2 transition-colors">
          <X size={15} />
        </button>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-[#176B5B] mb-1.5">
          {t("referral.eyebrow")}
        </p>
        <h3 className="text-ink text-lg font-bold leading-snug mb-1">{t("referral.headline")}</h3>
        <p className="text-ink-soft text-sm mb-3 max-w-lg">{t("referral.sub")}</p>
        <div className="mb-3">{rewardChips}</div>
        {linkRow}
      </div>
    );
  }

  if (variant === "upgrade") {
    return (
      <div className="rounded-2xl border border-line bg-surface p-5">
        <div className="flex items-center gap-2.5 mb-2">
          <span className="w-9 h-9 rounded-xl bg-[#176B5B]/10 flex items-center justify-center shrink-0">
            <Mail size={17} className="text-[#176B5B]" />
          </span>
          <div>
            <h3 className="text-ink text-sm font-bold leading-tight">{t("referral.upgradeTitle")}</h3>
            <p className="text-ink-mute text-xs mt-0.5">{t("referral.upgradeSub")}</p>
          </div>
        </div>
        {linkRow}
        {info.referred_count > 0 && (
          <p className="text-[#176B5B] text-xs font-medium mt-2.5">
            {t("referral.countLine").replace(/\{n\}/g, String(info.referred_count))}
          </p>
        )}
      </div>
    );
  }

  // settings — the permanent, prominent version
  return (
    <div className="relative overflow-hidden rounded-2xl border border-[#176B5B]/30 p-5 sm:p-6"
      style={{ background: "linear-gradient(120deg, rgba(23,107,91,0.10), rgba(23,107,91,0.03) 60%)" }}>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-[#176B5B] mb-1.5">
        {t("referral.eyebrow")}
      </p>
      <h3 className="text-ink text-xl font-bold leading-snug mb-1">{t("referral.headline")}</h3>
      <p className="text-ink-soft text-sm mb-3 max-w-lg">{t("referral.sub")}</p>
      <div className="mb-4">{rewardChips}</div>
      {linkRow}
      <p className={`text-xs font-medium mt-3 ${info.referred_count > 0 ? "text-[#176B5B]" : "text-ink-mute"}`}>
        {info.referred_count > 0
          ? t("referral.countLine").replace(/\{n\}/g, String(info.referred_count))
          : t("referral.countZero")}
      </p>
    </div>
  );
}
