"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { getToken, getStoredUser } from "@/lib/api";
import {
  Brain, Scale, Sparkles, Mail, ShieldCheck, FileText, MessageCircle,
  ArrowRight, TrendingUp, CheckCircle, CreditCard,
} from "@/components/ui/Icons";
import { useLanguage } from "@/lib/i18n";
import ThemeToggle from "@/components/ui/ThemeToggle";

export default function LandingPage() {
  const { t, tList, lang, setLanguage } = useLanguage();
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [annual, setAnnual] = useState(true);
  const howRef = useRef<HTMLElement>(null);
  const pricingRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (getToken()) setUserEmail(getStoredUser()?.email ?? null);
  }, []);

  const isLoggedIn = userEmail !== null;
  const primaryHref = isLoggedIn ? "/home" : "/login";
  // A logged-in visitor upgrading goes to settings; a visitor starts by signing up.
  const upgradeHref = isLoggedIn ? "/settings" : "/login";

  const STEPS = [
    { icon: FileText, title: t("landing.s1Title"), desc: t("landing.s1Desc") },
    { icon: Brain, title: t("landing.s2Title"), desc: t("landing.s2Desc") },
    { icon: Sparkles, title: t("landing.s3Title"), desc: t("landing.s3Desc") },
    { icon: Mail, title: t("landing.s4Title"), desc: t("landing.s4Desc") },
  ];

  const FEATURES = [
    { icon: Scale, title: t("landing.f1Title"), desc: t("landing.f1Desc") },
    { icon: FileText, title: t("landing.f2Title"), desc: t("landing.f2Desc") },
    { icon: Sparkles, title: t("landing.f3Title"), desc: t("landing.f3Desc") },
    { icon: MessageCircle, title: t("landing.f4Title"), desc: t("landing.f4Desc") },
    { icon: Mail, title: t("landing.f5Title"), desc: t("landing.f5Desc") },
    { icon: ShieldCheck, title: t("landing.f6Title"), desc: t("landing.f6Desc") },
  ];

  const sourceTypes = tList("landing.sourceTypes");
  const simQuestions = [t("landing.simQ1"), t("landing.simQ2"), t("landing.simQ3")];

  const perMo = t("pricing.perMonthShort");
  const perYr = t("pricing.perYearShort");

  type Tier = {
    id: string; name: string; tagline: string;
    monthly: string; yearly: string; yearlyMo: string | null; usd: string | null;
    features: string[]; cta: string; href: string; highlight: boolean;
  };
  const TIERS: Tier[] = [
    {
      id: "free", name: t("pricing.freeName"), tagline: t("pricing.freeTagline"),
      monthly: "₺0", yearly: "₺0", yearlyMo: null, usd: null,
      features: tList("pricing.freeFeatures"), cta: t("pricing.freeCta"),
      href: primaryHref, highlight: false,
    },
    {
      id: "plus", name: "Plus", tagline: t("pricing.plusTagline"),
      monthly: "₺149", yearly: "₺1.290", yearlyMo: "₺108", usd: "$49",
      features: tList("pricing.plusFeatures"), cta: t("pricing.plusCta"),
      href: upgradeHref, highlight: true,
    },
    {
      id: "pro", name: "Pro", tagline: t("pricing.proTagline"),
      monthly: "₺249", yearly: "₺2.190", yearlyMo: "₺183", usd: "$89",
      features: tList("pricing.proFeatures"), cta: t("pricing.proCta"),
      href: upgradeHref, highlight: false,
    },
  ];

  const TRUST = [
    { icon: CreditCard, label: t("pricing.trustNoBank") },
    { icon: ShieldCheck, label: t("pricing.trustEncrypt") },
    { icon: CheckCircle, label: t("pricing.trustRefund") },
  ];

  return (
    <main className="min-h-screen bg-canvas text-ink overflow-x-hidden">
      {/* Nav */}
      <nav className="flex items-center justify-between px-6 py-5 max-w-6xl mx-auto">
        <span className="text-lg font-bold tracking-tight">Mizan</span>
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => pricingRef.current?.scrollIntoView({ behavior: "smooth" })}
            className="hidden sm:block px-3 py-2 text-sm text-ink-soft hover:text-ink transition-colors"
          >
            {t("pricing.navLink")}
          </button>
          {/* Language toggle — re-renders all copy live on this page */}
          <div className="flex rounded-lg overflow-hidden border border-line text-xs font-medium">
            <button
              onClick={() => setLanguage("tr")}
              className={`px-2.5 py-1.5 transition-colors ${lang === "tr" ? "bg-brand text-white" : "text-ink-mute hover:text-ink-soft"}`}
            >
              TR
            </button>
            <button
              onClick={() => setLanguage("en")}
              className={`px-2.5 py-1.5 transition-colors ${lang === "en" ? "bg-brand text-white" : "text-ink-mute hover:text-ink-soft"}`}
            >
              EN
            </button>
          </div>
          <ThemeToggle size="sm" />
          <Link
            href={primaryHref}
            className="px-4 py-2 rounded-lg bg-surface hover:bg-surface-2 border border-line text-sm text-ink-soft transition-colors"
          >
            {isLoggedIn ? t("landing.continue") : t("landing.signIn")}
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative px-6 pt-12 pb-20 max-w-6xl mx-auto">
        <div className="relative grid lg:grid-cols-2 gap-12 items-center">
          {/* Copy */}
          <div>
            <h1 className="text-5xl sm:text-6xl font-bold tracking-tight leading-[1.04] mb-6">
              {t("landing.heroTitleA")}
              <br />
              <span className="text-brand">{t("landing.heroTitleB")}</span>
            </h1>
            <p className="text-ink-mute text-lg leading-relaxed mb-8 max-w-lg">
              {t("landing.heroDesc")}
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <Link
                href={primaryHref}
                className="inline-flex items-center justify-center gap-2 px-7 py-3.5 rounded-xl bg-brand hover:bg-brand-hover text-white font-semibold transition-colors"
              >
                {isLoggedIn ? t("landing.continue") : t("landing.ctaPrimary")} <ArrowRight size={18} />
              </Link>
              <button
                onClick={() => howRef.current?.scrollIntoView({ behavior: "smooth" })}
                className="inline-flex items-center justify-center px-7 py-3.5 rounded-xl bg-surface hover:bg-surface-2 border border-line font-semibold text-ink-soft transition-colors"
              >
                {t("landing.ctaSecondary")}
              </button>
            </div>
            <p className="text-ink-mute text-xs mt-4">{t("landing.ctaNote")}</p>
          </div>

          {/* Product preview — a clean browser/app window frame, soft shadow, no glow. */}
          <div className="relative">
            <div className="rounded-2xl border border-line bg-surface shadow-xl shadow-ink/10 overflow-hidden">
              {/* window chrome */}
              <div className="flex items-center gap-2 px-4 py-3 border-b border-line bg-surface-2">
                <span className="w-2.5 h-2.5 rounded-full bg-line-strong" />
                <span className="w-2.5 h-2.5 rounded-full bg-line-strong" />
                <span className="w-2.5 h-2.5 rounded-full bg-line-strong" />
                <div className="ml-2 flex-1 max-w-[220px]">
                  <div className="h-5 rounded-md bg-surface border border-line flex items-center px-2 text-[10px] text-ink-mute">
                    mizan.app/home
                  </div>
                </div>
              </div>
              {/* screen */}
              <div className="p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-ink-mute text-[11px] uppercase tracking-wider">{t("landing.mockNetWorth")}</p>
                    <p className="text-3xl font-bold tabular-nums mt-1">{t("landing.mockNetWorthValue")}</p>
                  </div>
                  <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-pos/10 text-pos text-xs font-semibold">
                    <TrendingUp size={12} /> {t("landing.mockDelta")}
                  </span>
                </div>
                <svg viewBox="0 0 320 60" className="w-full h-12 mt-3" preserveAspectRatio="none">
                  <defs>
                    <linearGradient id="spark" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="rgb(var(--c-brand))" stopOpacity="0.35" />
                      <stop offset="100%" stopColor="rgb(var(--c-brand))" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <path d="M0 48 L40 44 L80 46 L120 38 L160 34 L200 30 L240 24 L280 16 L320 10 L320 60 L0 60 Z" fill="url(#spark)" />
                  <path d="M0 48 L40 44 L80 46 L120 38 L160 34 L200 30 L240 24 L280 16 L320 10" fill="none" stroke="rgb(var(--c-brand))" strokeWidth="2" />
                </svg>
                <div className="mt-3 space-y-2">
                  {[
                    { dot: "#16a34a", label: t("landing.mockCash"), val: t("landing.mockCashValue") },
                    { dot: "#d97706", label: t("landing.mockCrypto"), val: "0.42 BTC" },
                    { dot: "rgb(var(--c-brand))", label: t("landing.mockProperty"), val: t("landing.mockPropertyValue") },
                  ].map((r) => (
                    <div key={r.label} className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2 text-ink-soft">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: r.dot }} />{r.label}
                      </span>
                      <span className="text-ink-soft tabular-nums">{r.val}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-4 pt-4 border-t border-line">
                  <p className="text-[10px] uppercase tracking-wider text-brand mb-1 flex items-center gap-1">
                    <Sparkles size={11} /> {t("landing.mockBriefLabel")}
                  </p>
                  <p className="text-ink-soft text-sm leading-relaxed">{t("landing.mockBrief")}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Loop */}
      <section ref={howRef} className="border-t border-line py-24 px-6">
        <div className="max-w-5xl mx-auto">
          <p className="text-center text-ink-mute text-xs uppercase tracking-widest mb-3">{t("landing.loopEyebrow")}</p>
          <h2 className="text-3xl font-bold text-center mb-16">{t("landing.loopTitle")}</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {STEPS.map((s, i) => (
              <div key={s.title} className="relative bg-surface border border-line rounded-xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="w-11 h-11 rounded-xl bg-brand/10 border border-brand/30 flex items-center justify-center">
                    <s.icon size={20} className="text-brand" />
                  </div>
                  <span className="text-line-strong font-bold text-3xl leading-none">{i + 1}</span>
                </div>
                <h3 className="font-semibold text-ink mb-1.5">{s.title}</h3>
                <p className="text-ink-mute text-sm leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-24 px-6 bg-canvas">
        <div className="max-w-5xl mx-auto">
          <p className="text-center text-ink-mute text-xs uppercase tracking-widest mb-3">{t("landing.featEyebrow")}</p>
          <h2 className="text-3xl font-bold text-center mb-16">{t("landing.featTitle")}</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {FEATURES.map((f) => (
              <div key={f.title} className="group bg-surface border border-line hover:border-brand/50 rounded-xl p-5 transition-colors">
                <div className="w-10 h-10 rounded-lg bg-brand/10 border border-brand/30 flex items-center justify-center mb-4 group-hover:bg-brand/15 transition-colors">
                  <f.icon size={20} className="text-brand" />
                </div>
                <h3 className="font-semibold text-ink mb-1.5">{f.title}</h3>
                <p className="text-ink-mute text-sm leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Simulator spotlight */}
      <section className="py-24 px-6 border-t border-line">
        <div className="max-w-5xl mx-auto grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <p className="text-brand text-xs uppercase tracking-widest mb-3 flex items-center gap-2">
              <Sparkles size={13} /> {t("landing.simEyebrow")}
            </p>
            <h2 className="text-3xl font-bold mb-4">{t("landing.simTitle")}</h2>
            <p className="text-ink-mute text-lg leading-relaxed mb-6">{t("landing.simDesc")}</p>
            <div className="space-y-2">
              {simQuestions.map((q) => (
                <div key={q} className="flex items-start gap-2 px-3 py-2 rounded-lg bg-surface border border-line text-ink-soft text-sm">
                  <MessageCircle size={14} className="text-brand shrink-0 mt-0.5" /> {q}
                </div>
              ))}
            </div>
          </div>
          <div className="bg-surface border border-line rounded-2xl p-5">
            <svg viewBox="0 0 320 160" className="w-full">
              <defs>
                <linearGradient id="cone" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="rgb(var(--c-brand))" stopOpacity="0.18" />
                  <stop offset="100%" stopColor="rgb(var(--c-brand))" stopOpacity="0.03" />
                </linearGradient>
              </defs>
              {[40, 80, 120].map((y) => <line key={y} x1="0" y1={y} x2="320" y2={y} stroke="rgb(var(--c-line))" strokeWidth="1" />)}
              <path d="M0 120 L80 96 L160 70 L240 44 L320 20 L320 56 L240 78 L160 100 L80 116 L0 124 Z" fill="url(#cone)" />
              <path d="M0 122 L80 114 L160 106 L240 98 L320 90" fill="none" stroke="rgb(var(--c-text-muted))" strokeWidth="2" strokeDasharray="4 4" />
              <path d="M0 122 L80 106 L160 85 L240 60 L320 38" fill="none" stroke="rgb(var(--c-brand))" strokeWidth="2.5" />
            </svg>
            <div className="flex items-center gap-4 mt-3 text-xs text-ink-mute">
              <span className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed border-ink-mute" /> {t("sim.baseline")}</span>
              <span className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-brand" /> {t("sim.scenario")}</span>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section ref={pricingRef} className="py-24 px-6 bg-canvas border-t border-line">
        <div className="max-w-5xl mx-auto">
          <p className="text-center text-ink-mute text-xs uppercase tracking-widest mb-3">{t("pricing.eyebrow")}</p>
          <h2 className="text-3xl sm:text-4xl font-bold text-center mb-3">{t("pricing.title")}</h2>
          <p className="text-center text-ink-mute mb-8 max-w-xl mx-auto">{t("pricing.subtitle")}</p>

          {/* Billing toggle */}
          <div className="flex items-center justify-center gap-3 mb-12">
            <div className="inline-flex items-center rounded-xl border border-line bg-surface p-1">
              <button
                onClick={() => setAnnual(false)}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${!annual ? "bg-brand text-white" : "text-ink-mute hover:text-ink-soft"}`}
              >
                {t("pricing.monthly")}
              </button>
              <button
                onClick={() => setAnnual(true)}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${annual ? "bg-brand text-white" : "text-ink-mute hover:text-ink-soft"}`}
              >
                {t("pricing.yearly")}
              </button>
            </div>
            <span className="text-xs font-semibold text-pos bg-pos/10 px-2.5 py-1 rounded-full">{t("pricing.yearlySave")}</span>
          </div>

          {/* Tiers */}
          <div className="grid md:grid-cols-3 gap-5 items-start">
            {TIERS.map((tier) => {
              const free = tier.monthly === "₺0";
              return (
                <div
                  key={tier.id}
                  className={`relative bg-surface rounded-2xl p-6 flex flex-col ${
                    tier.highlight
                      ? "border-2 border-brand shadow-lg shadow-brand/10 md:-mt-3 md:mb-3"
                      : "border border-line"
                  }`}
                >
                  {tier.highlight && (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-brand text-white text-xs font-semibold shadow-sm">
                      {t("pricing.popular")}
                    </span>
                  )}

                  <h3 className="text-lg font-bold">{tier.name}</h3>
                  <p className="text-ink-mute text-sm mt-1 mb-5 min-h-[2.5rem]">{tier.tagline}</p>

                  {/* Price */}
                  <div className="mb-6">
                    {free ? (
                      <div className="text-4xl font-bold tabular-nums">₺0</div>
                    ) : annual ? (
                      <>
                        <div className="flex items-baseline gap-1">
                          <span className="text-4xl font-bold tabular-nums">{tier.yearly}</span>
                          <span className="text-ink-mute text-sm">/{perYr}</span>
                        </div>
                        <p className="text-ink-mute text-xs mt-1.5 tabular-nums">
                          ≈ {tier.yearlyMo}/{perMo} · ≈ {tier.usd}/{perYr}
                        </p>
                      </>
                    ) : (
                      <div className="flex items-baseline gap-1">
                        <span className="text-4xl font-bold tabular-nums">{tier.monthly}</span>
                        <span className="text-ink-mute text-sm">/{perMo}</span>
                      </div>
                    )}
                  </div>

                  {/* CTA */}
                  <Link
                    href={tier.href}
                    className={`block text-center px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors mb-6 ${
                      tier.highlight
                        ? "bg-brand hover:bg-brand-hover text-white"
                        : "bg-surface border border-line hover:border-brand/60 text-ink hover:text-brand"
                    }`}
                  >
                    {tier.cta}
                  </Link>

                  {/* Features */}
                  <ul className="space-y-2.5">
                    {tier.features.map((f) => (
                      <li key={f} className="flex items-start gap-2 text-sm text-ink-soft">
                        <CheckCircle size={16} className="text-brand shrink-0 mt-0.5" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>

          {/* Trust signals */}
          <div className="mt-12 flex flex-wrap items-center justify-center gap-x-8 gap-y-3">
            {TRUST.map((item) => (
              <span key={item.label} className="flex items-center gap-2 text-sm text-ink-mute">
                <item.icon size={16} className="text-brand shrink-0" />
                {item.label}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Global / sources */}
      <section className="py-20 px-6 bg-canvas border-t border-line">
        <div className="max-w-4xl mx-auto text-center">
          <p className="text-ink-mute text-xs uppercase tracking-widest mb-3">{t("landing.globalEyebrow")}</p>
          <h2 className="text-3xl font-bold mb-3">{t("landing.globalTitle")}</h2>
          <p className="text-ink-mute mb-8">{t("landing.globalDesc")}</p>
          <div className="flex flex-wrap justify-center gap-2.5 mb-10">
            {Array.isArray(sourceTypes) && sourceTypes.map((s) => (
              <span key={s} className="px-4 py-2 rounded-lg bg-surface border border-line text-ink-soft text-sm font-medium">{s}</span>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-4 max-w-lg mx-auto">
            {[t("landing.stat1"), t("landing.stat2"), t("landing.stat3")].map((s) => (
              <div key={s} className="bg-surface border border-line rounded-xl py-4">
                <p className="text-brand font-semibold text-sm">{s}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      {!isLoggedIn && (
        <section className="py-24 px-6 border-t border-line">
          <div className="max-w-3xl mx-auto text-center bg-surface border border-line rounded-2xl px-6 py-14">
            <h2 className="text-4xl font-bold mb-4">{t("landing.ctaTitle")}</h2>
            <p className="text-ink-mute mb-8 text-lg">{t("landing.ctaSubtitle")}</p>
            <Link href="/login" className="inline-flex items-center gap-2 px-10 py-4 rounded-xl bg-brand hover:bg-brand-hover text-white font-semibold text-base transition-colors">
              {t("landing.ctaBtn")} <ArrowRight size={20} />
            </Link>
          </div>
        </section>
      )}

      {/* Footer */}
      <footer className="border-t border-line py-8 px-6 text-center text-ink-mute text-sm">
        {t("landing.footer")}
      </footer>
    </main>
  );
}
