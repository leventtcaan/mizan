"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import PageLayout from "@/components/ui/PageLayout";
import ReferralCard from "@/components/ReferralCard";
import { CheckCircle, Sparkles, ShieldCheck } from "@/components/ui/Icons";
import { useLanguage } from "@/lib/i18n";
import { getToken, getStoredUser, setStoredUser, getMe } from "@/lib/api";
import { openCheckout, paddleConfigured } from "@/lib/paddle";

type PlanId = "free" | "plus" | "pro";

export default function UpgradePage() {
  const router = useRouter();
  const { t, tList, lang } = useLanguage();

  const [currentPlan, setCurrentPlan] = useState<PlanId>("free");
  const [annual, setAnnual] = useState(true);
  const [busy, setBusy] = useState<PlanId | null>(null);   // plan whose checkout is opening
  const [activating, setActivating] = useState(false);     // post-checkout, waiting for webhook
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!getToken() || !getStoredUser()) { router.replace("/login"); return; }
    // instant from storage, then reconcile with the server
    const stored = getStoredUser();
    if (stored?.plan === "plus" || stored?.plan === "pro") setCurrentPlan(stored.plan);
    getMe().then((me) => setCurrentPlan((me.plan as PlanId) || "free")).catch(() => null);
  }, [router]);

  // After checkout completes, the Paddle webhook upgrades the plan server-side. Poll
  // /auth/me a few times to reflect it, then sync local state + storage.
  const pollForUpgrade = async (target: PlanId) => {
    setActivating(true);
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 2500));
      try {
        const me = await getMe();
        if (me.plan === target || me.plan === "pro") {
          setCurrentPlan((me.plan as PlanId) || "free");
          const u = getStoredUser();
          if (u) setStoredUser({ ...u, plan: me.plan });
          setActivating(false);
          setNotice(t("upgrade.activated"));
          // Let Clar reappear with a "you unlocked X" welcome for the new plan.
          window.dispatchEvent(new Event("clar-plan-changed"));
          return;
        }
      } catch { /* keep polling */ }
    }
    // Webhook may still be in flight — reassure rather than error.
    setActivating(false);
    setNotice(t("upgrade.activationPending"));
  };

  const handleCheckout = async (plan: PlanId) => {
    if (plan === "free" || busy) return;
    setNotice(null);
    if (!paddleConfigured()) { setNotice(t("upgrade.notConfigured")); return; }
    const me = getStoredUser();
    if (!me) { router.replace("/login"); return; }
    setBusy(plan);
    try {
      const ok = await openCheckout({
        plan,
        cycle: annual ? "yearly" : "monthly",
        email: me.email,
        userId: me.id,
        onComplete: () => void pollForUpgrade(plan),
      });
      if (!ok) setNotice(t("upgrade.checkoutError"));
    } catch {
      setNotice(t("upgrade.checkoutError"));
    } finally {
      setBusy(null);
    }
  };

  const perMo = t("pricing.perMonthShort");
  const perYr = t("pricing.perYearShort");

  type Plan = {
    id: PlanId; name: string; tagline: string; highlight: boolean;
    tr: { m: string; y: string; yMo: string | null };
    usd: { m: string; y: string; yMo: string | null };
    features: string[];
  };
  const PLANS: Plan[] = [
    {
      id: "free", name: t("pricing.freeName"), tagline: t("pricing.freeTagline"), highlight: false,
      tr: { m: "₺0", y: "₺0", yMo: null }, usd: { m: "$0", y: "$0", yMo: null },
      features: tList("pricing.freeFeatures"),
    },
    {
      id: "plus", name: "Plus", tagline: t("pricing.plusTagline"), highlight: true,
      tr: { m: "₺249", y: "₺2.090", yMo: "₺174" }, usd: { m: "$9", y: "$79", yMo: "$7" },
      features: tList("pricing.plusFeatures"),
    },
    {
      id: "pro", name: "Pro", tagline: t("pricing.proTagline"), highlight: false,
      tr: { m: "₺449", y: "₺3.790", yMo: "₺316" }, usd: { m: "$19", y: "$169", yMo: "$14" },
      features: tList("pricing.proFeatures"),
    },
  ];

  return (
    <PageLayout title={t("upgrade.title")} subtitle={t("upgrade.subtitle")} maxWidth="lg">
      {/* Secure-checkout note (Paddle is the Merchant of Record) */}
      <div className="mb-8 rounded-xl border border-[#176B5B]/30 bg-[#176B5B]/5 px-4 py-3.5 flex items-start gap-2.5">
        <ShieldCheck size={18} className="text-[#176B5B] shrink-0 mt-0.5" />
        <p className="text-ink-soft text-sm leading-relaxed">{t("upgrade.securedByPaddle")}</p>
      </div>

      {notice && (
        <div className="mb-6 rounded-xl border border-line bg-surface px-4 py-3 flex items-center gap-2.5">
          {activating
            ? <span className="w-4 h-4 border-2 border-line border-t-[#176B5B] rounded-full animate-spin shrink-0" />
            : <CheckCircle size={16} className="text-[#176B5B] shrink-0" />}
          <p className="text-ink-soft text-sm">{notice}</p>
        </div>
      )}

      {/* Billing toggle */}
      <div className="flex items-center justify-center gap-3 mb-10">
        <div className="inline-flex items-center gap-1.5 rounded-xl border border-ink/15 bg-surface p-1">
          <button
            onClick={() => setAnnual(false)}
            className={`px-5 py-2 rounded-lg text-sm font-semibold transition-colors ${!annual ? "bg-[#176B5B] text-white shadow-sm" : "text-ink-soft hover:text-ink"}`}
          >
            {t("pricing.monthly")}
          </button>
          <button
            onClick={() => setAnnual(true)}
            className={`px-5 py-2 rounded-lg text-sm font-semibold transition-colors ${annual ? "bg-[#176B5B] text-white shadow-sm" : "text-ink-soft hover:text-ink"}`}
          >
            {t("pricing.yearly")}
          </button>
        </div>
        <span className="text-xs font-semibold text-pos bg-pos/10 px-2.5 py-1 rounded-full">{t("pricing.yearlySave")}</span>
      </div>

      {/* Plans */}
      <div className="grid md:grid-cols-3 gap-5 items-start">
        {PLANS.map((p) => {
          const free = p.id === "free";
          const isCurrent = currentPlan === p.id;
          const price = lang === "tr" ? p.tr : p.usd;
          return (
            <div
              key={p.id}
              className={`relative rounded-2xl p-6 flex flex-col ${
                p.highlight ? "bg-[#176B5B]/5 border-2 border-[#176B5B] shadow-lg shadow-[#176B5B]/15" : "bg-surface border border-line"
              }`}
            >
              {p.highlight && !isCurrent && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-[#176B5B] text-white text-xs font-semibold shadow-sm whitespace-nowrap">
                  {t("pricing.popular")}
                </span>
              )}
              {isCurrent && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-ink text-canvas text-xs font-semibold shadow-sm whitespace-nowrap">
                  {t("upgrade.currentBadge")}
                </span>
              )}

              <h3 className={`text-lg font-bold ${p.highlight ? "text-[#176B5B]" : ""}`}>{p.name}</h3>
              <p className="text-ink-mute text-sm mt-1 mb-5 min-h-[2.5rem]">{p.tagline}</p>

              {/* Price */}
              <div className="mb-6">
                {free ? (
                  <div className="text-4xl font-bold tabular-nums">{price.m}</div>
                ) : annual ? (
                  <>
                    <div className="flex items-baseline gap-1">
                      <span className={`text-4xl font-bold tabular-nums ${p.highlight ? "text-[#176B5B]" : ""}`}>{price.y}</span>
                      <span className="text-ink-mute text-sm">/{perYr}</span>
                    </div>
                    <p className="text-ink-mute text-xs mt-1.5 tabular-nums">≈ {price.yMo}/{perMo}</p>
                  </>
                ) : (
                  <div className="flex items-baseline gap-1">
                    <span className={`text-4xl font-bold tabular-nums ${p.highlight ? "text-[#176B5B]" : ""}`}>{price.m}</span>
                    <span className="text-ink-mute text-sm">/{perMo}</span>
                  </div>
                )}
              </div>

              {/* CTA */}
              <div className="mb-6">
                {isCurrent ? (
                  <div className="text-center px-4 py-2.5 rounded-xl text-sm font-semibold bg-surface-2 text-ink-mute border border-line">
                    {t("upgrade.currentBadge")}
                  </div>
                ) : free ? (
                  <div className="text-center px-4 py-2.5 rounded-xl text-sm font-medium text-ink-mute">
                    {t("upgrade.alwaysFree")}
                  </div>
                ) : (
                  <button
                    onClick={() => handleCheckout(p.id)}
                    disabled={busy !== null || activating}
                    className={`w-full text-center px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
                      p.highlight
                        ? "bg-[#176B5B] hover:bg-[#125848] text-white shadow-sm"
                        : "bg-surface border border-ink/30 hover:border-[#176B5B] text-ink hover:text-[#176B5B]"
                    }`}
                  >
                    {busy === p.id ? t("upgrade.opening") : t(p.id === "pro" ? "pricing.proCta" : "pricing.plusCta")}
                  </button>
                )}
              </div>

              {/* Features */}
              <ul className="space-y-2.5">
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-ink-soft">
                    <CheckCircle size={16} className="text-[#176B5B] shrink-0 mt-0.5" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      {/* The no-payment path: referrals. Every invited friend = a month of Pro. */}
      <div className="mt-8 max-w-2xl mx-auto">
        <ReferralCard variant="upgrade" />
      </div>

      {/* Trust line */}
      <div className="mt-10 flex items-center justify-center gap-2 text-ink-mute text-sm">
        <ShieldCheck size={16} className="text-[#176B5B]" />
        {lang === "tr"
          ? "Banka girişi yok. Ücretsiz plan süresiz kullanılabilir."
          : "No bank login. The free plan stays free, with no time limit."}
      </div>
    </PageLayout>
  );
}
