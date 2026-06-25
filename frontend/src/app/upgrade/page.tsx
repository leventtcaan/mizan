"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import PageLayout from "@/components/ui/PageLayout";
import { CheckCircle, Sparkles, ShieldCheck } from "@/components/ui/Icons";
import { useLanguage } from "@/lib/i18n";
import { getToken, getStoredUser, getMe } from "@/lib/api";

const INTEREST_KEY = "mizan_upgrade_interest";

type PlanId = "free" | "plus" | "pro";

export default function UpgradePage() {
  const router = useRouter();
  const { t, tList, lang } = useLanguage();

  const [currentPlan, setCurrentPlan] = useState<PlanId>("free");
  const [annual, setAnnual] = useState(true);
  const [interest, setInterest] = useState<PlanId | null>(null);

  useEffect(() => {
    if (!getToken() || !getStoredUser()) { router.replace("/login"); return; }
    // instant from storage, then reconcile with the server
    const stored = getStoredUser();
    if (stored?.plan === "plus" || stored?.plan === "pro") setCurrentPlan(stored.plan);
    getMe().then((me) => setCurrentPlan((me.plan as PlanId) || "free")).catch(() => null);
    const saved = localStorage.getItem(INTEREST_KEY);
    if (saved === "plus" || saved === "pro") setInterest(saved);
  }, [router]);

  const markInterest = (plan: PlanId) => {
    setInterest(plan);
    try { localStorage.setItem(INTEREST_KEY, plan); } catch { /* ignore */ }
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
      tr: { m: "₺199", y: "₺1.690", yMo: "₺141" }, usd: { m: "$7", y: "$59", yMo: "$5" },
      features: tList("pricing.plusFeatures"),
    },
    {
      id: "pro", name: "Pro", tagline: t("pricing.proTagline"), highlight: false,
      tr: { m: "₺349", y: "₺2.990", yMo: "₺249" }, usd: { m: "$12", y: "$99", yMo: "$8" },
      features: tList("pricing.proFeatures"),
    },
  ];

  return (
    <PageLayout title={t("upgrade.title")} subtitle={t("upgrade.subtitle")} maxWidth="lg">
      {/* Honest banner — payment isn't live yet */}
      <div className="mb-8 rounded-xl border border-[#176B5B]/30 bg-[#176B5B]/5 px-4 py-3.5 flex items-start gap-2.5">
        <Sparkles size={18} className="text-[#176B5B] shrink-0 mt-0.5" />
        <p className="text-ink-soft text-sm leading-relaxed">{t("upgrade.banner")}</p>
      </div>

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
          const interested = interest === p.id;
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
                ) : interested ? (
                  <div className="text-center px-4 py-2.5 rounded-xl text-sm font-semibold bg-pos/10 text-pos border border-pos/30 flex items-center justify-center gap-1.5">
                    <CheckCircle size={15} /> {t("upgrade.interestedDone")}
                  </div>
                ) : (
                  <button
                    onClick={() => markInterest(p.id)}
                    className={`w-full text-center px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
                      p.highlight
                        ? "bg-[#176B5B] hover:bg-[#125848] text-white shadow-sm"
                        : "bg-surface border border-ink/30 hover:border-[#176B5B] text-ink hover:text-[#176B5B]"
                    }`}
                  >
                    {t("upgrade.interestedCta")}
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

      {/* Trust line */}
      <div className="mt-10 flex items-center justify-center gap-2 text-ink-mute text-sm">
        <ShieldCheck size={16} className="text-[#176B5B]" />
        {lang === "tr"
          ? "Banka girişi yok. Kart yok. İstediğinde iptal et."
          : "No bank login. No credit card. Cancel anytime."}
      </div>
    </PageLayout>
  );
}
