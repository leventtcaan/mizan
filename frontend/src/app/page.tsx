"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { getToken, getStoredUser } from "@/lib/api";
import {
  Brain, Scale, Sparkles, Mail, ShieldCheck, FileText, MessageCircle,
  ArrowRight, TrendingUp,
} from "@/components/ui/Icons";
import { useLanguage } from "@/lib/i18n";
import ThemeToggle from "@/components/ui/ThemeToggle";

export default function LandingPage() {
  const { t, tList, lang, setLanguage } = useLanguage();
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const howRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (getToken()) setUserEmail(getStoredUser()?.email ?? null);
  }, []);

  const isLoggedIn = userEmail !== null;
  const primaryHref = isLoggedIn ? "/home" : "/login";

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

  return (
    <main className="min-h-screen bg-canvas text-ink overflow-x-hidden">
      {/* Nav */}
      <nav className="flex items-center justify-between px-6 py-5 max-w-6xl mx-auto">
        <span className="text-lg font-bold tracking-tight">Mizan</span>
        <div className="flex items-center gap-2.5">
          {/* Language toggle — works on the landing page itself (re-renders copy live) */}
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
      <section className="relative px-6 pt-10 pb-20 max-w-6xl mx-auto">
        <div className="relative grid lg:grid-cols-2 gap-12 items-center">
          {/* Copy */}
          <div>
            {/* Solid, authoritative type — one restrained accent line, no rainbow gradient. */}
            <h1 className="text-5xl sm:text-6xl font-bold tracking-tight leading-[1.04] mb-6 mt-2">
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
                className="inline-flex items-center justify-center gap-2 px-7 py-3.5 rounded-xl bg-brand hover:bg-brand-hover font-semibold transition-colors"
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

          {/* Product preview mock — depth from a soft shadow, not a glowing orb. */}
          <div className="relative">
            <div className="relative bg-surface border border-line rounded-2xl p-5 shadow-2xl shadow-black/50">
              {/* net worth */}
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-ink-mute text-[11px] uppercase tracking-wider">{t("landing.mockNetWorth")}</p>
                  <p className="text-3xl font-bold tabular-nums mt-1">{t("landing.mockNetWorthValue")}</p>
                </div>
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-950/50 text-emerald-400 text-xs font-semibold">
                  <TrendingUp size={12} /> {t("landing.mockDelta")}
                </span>
              </div>
              {/* sparkline */}
              <svg viewBox="0 0 320 60" className="w-full h-12 mt-3" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="spark" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="rgb(var(--c-brand))" stopOpacity="0.4" />
                    <stop offset="100%" stopColor="rgb(var(--c-brand))" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <path d="M0 48 L40 44 L80 46 L120 38 L160 34 L200 30 L240 24 L280 16 L320 10 L320 60 L0 60 Z" fill="url(#spark)" />
                <path d="M0 48 L40 44 L80 46 L120 38 L160 34 L200 30 L240 24 L280 16 L320 10" fill="none" stroke="rgb(var(--c-brand))" strokeWidth="2" />
              </svg>
              {/* asset rows */}
              <div className="mt-3 space-y-2">
                {[
                  { dot: "#22c55e", label: t("landing.mockCash"), val: t("landing.mockCashValue") },
                  { dot: "#f59e0b", label: t("landing.mockCrypto"), val: "0.42 BTC" },
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
              {/* brief snippet */}
              <div className="mt-4 pt-4 border-t border-line">
                <p className="text-[10px] uppercase tracking-wider text-brand/80 mb-1 flex items-center gap-1">
                  <Sparkles size={11} /> {t("landing.mockBriefLabel")}
                </p>
                <p className="text-ink-soft text-sm leading-relaxed">{t("landing.mockBrief")}</p>
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
                  <div className="w-11 h-11 rounded-xl bg-brand/15 border border-brand/50 flex items-center justify-center">
                    <s.icon size={20} className="text-brand" />
                  </div>
                  <span className="text-ink-mute font-bold text-3xl leading-none">{i + 1}</span>
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
              <div key={f.title} className="group bg-surface border border-line hover:border-brand/60 rounded-xl p-5 transition-colors">
                <div className="w-10 h-10 rounded-lg bg-brand/15 border border-brand/50 flex items-center justify-center mb-4 group-hover:bg-brand/50 transition-colors">
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
          {/* simulator chart mock — baseline (dashed) vs scenario (solid) + uncertainty cone */}
          <div className="bg-surface border border-line rounded-2xl p-5">
            <svg viewBox="0 0 320 160" className="w-full">
              <defs>
                <linearGradient id="cone" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="rgb(var(--c-brand))" stopOpacity="0.18" />
                  <stop offset="100%" stopColor="rgb(var(--c-brand))" stopOpacity="0.03" />
                </linearGradient>
              </defs>
              {/* grid lines */}
              {[40, 80, 120].map((y) => <line key={y} x1="0" y1={y} x2="320" y2={y} stroke="rgb(var(--c-line))" strokeWidth="1" />)}
              {/* uncertainty cone around scenario */}
              <path d="M0 120 L80 96 L160 70 L240 44 L320 20 L320 56 L240 78 L160 100 L80 116 L0 124 Z" fill="url(#cone)" />
              {/* baseline (dashed) */}
              <path d="M0 122 L80 114 L160 106 L240 98 L320 90" fill="none" stroke="#6b7280" strokeWidth="2" strokeDasharray="4 4" />
              {/* scenario (solid) */}
              <path d="M0 122 L80 106 L160 85 L240 60 L320 38" fill="none" stroke="rgb(var(--c-brand))" strokeWidth="2.5" />
            </svg>
            <div className="flex items-center gap-4 mt-3 text-xs text-ink-mute">
              <span className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed border-gray-500" /> {t("sim.baseline")}</span>
              <span className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-brand" /> {t("sim.scenario")}</span>
            </div>
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

      {/* CTA — a calm, contained panel instead of a glowing gradient band. */}
      {!isLoggedIn && (
        <section className="py-24 px-6 border-t border-line">
          <div className="max-w-3xl mx-auto text-center bg-surface border border-line rounded-2xl px-6 py-14">
            <h2 className="text-4xl font-bold mb-4">{t("landing.ctaTitle")}</h2>
            <p className="text-ink-mute mb-8 text-lg">{t("landing.ctaSubtitle")}</p>
            <Link href="/login" className="inline-flex items-center gap-2 px-10 py-4 rounded-xl bg-brand hover:bg-brand-hover font-semibold text-base transition-colors">
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
