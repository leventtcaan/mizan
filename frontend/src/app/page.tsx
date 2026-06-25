"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { getToken, getStoredUser } from "@/lib/api";
import {
  Brain, Scale, Sparkles, Mail, ShieldCheck, FileText, MessageCircle,
  ArrowRight, TrendingUp, CheckCircle, CreditCard, Sun, Moon, Monitor,
} from "@/components/ui/Icons";
import { useLanguage } from "@/lib/i18n";
import { useTheme, type ThemePref } from "@/lib/theme";

// Hero sparkline geometry. cy = vertical position in the 320×70 viewBox (lower =
// higher net worth); amt = the value (in millions) shown in the hover tooltip.
const SPARK_CY = [56, 51, 54, 44, 40, 35, 28, 19, 12];
const SPARK_AMT = [0.92, 1.0, 0.97, 1.08, 1.12, 1.16, 1.2, 1.23, 1.24];
const SPARK_MONTHS_TR = ["Eki", "Kas", "Ara", "Oca", "Şub", "Mar", "Nis", "May", "Haz"];
const SPARK_MONTHS_EN = ["Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun"];

export default function LandingPage() {
  const { t, tList, lang, setLanguage } = useLanguage();
  const { pref: themePref, setTheme } = useTheme();
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [annual, setAnnual] = useState(true);
  const howRef = useRef<HTMLElement>(null);
  const pricingRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (getToken()) setUserEmail(getStoredUser()?.email ?? null);
  }, []);

  const isLoggedIn = userEmail !== null;
  // "Ücretsiz başla" sends new visitors to the register form; logged-in users continue to /home.
  const startHref = isLoggedIn ? "/home" : "/login?mode=register";
  // Logo: landing for logged-out visitors, the app home for logged-in users.
  const logoHref = isLoggedIn ? "/home" : "/";
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

  // Hero sparkline hover state + locale-aware tooltip formatting (₺/, vs $/.).
  const [activePoint, setActivePoint] = useState<number | null>(null);
  const sym = (t("landing.mockNetWorthValue").trim()[0]) || "₺";
  const dec = lang === "tr" ? "," : ".";
  const sparkMonths = lang === "tr" ? SPARK_MONTHS_TR : SPARK_MONTHS_EN;

  const perMo = t("pricing.perMonthShort");
  const perYr = t("pricing.perYearShort");

  type Tier = {
    id: string; name: string; tagline: string;
    // TRY (shown when lang === "tr") and USD (shown when lang === "en"). Never both.
    monthly: string; yearly: string; yearlyMo: string | null;
    usdMonthly: string; usdYearly: string; usdMo: string | null;
    features: string[]; cta: string; href: string; highlight: boolean;
  };
  const TIERS: Tier[] = [
    {
      id: "free", name: t("pricing.freeName"), tagline: t("pricing.freeTagline"),
      monthly: "₺0", yearly: "₺0", yearlyMo: null, usdMonthly: "$0", usdYearly: "$0", usdMo: null,
      features: tList("pricing.freeFeatures"), cta: t("pricing.freeCta"),
      href: startHref, highlight: false,
    },
    {
      id: "plus", name: "Plus", tagline: t("pricing.plusTagline"),
      monthly: "₺199", yearly: "₺1.690", yearlyMo: "₺141", usdMonthly: "$7", usdYearly: "$59", usdMo: "$5",
      features: tList("pricing.plusFeatures"), cta: t("pricing.plusCta"),
      href: upgradeHref, highlight: true,
    },
    {
      id: "pro", name: "Pro", tagline: t("pricing.proTagline"),
      monthly: "₺349", yearly: "₺2.990", yearlyMo: "₺249", usdMonthly: "$12", usdYearly: "$99", usdMo: "$8",
      features: tList("pricing.proFeatures"), cta: t("pricing.proCta"),
      href: upgradeHref, highlight: false,
    },
  ];

  const TRUST = [
    { icon: CreditCard, label: t("pricing.trustNoBank") },
    { icon: ShieldCheck, label: t("pricing.trustEncrypt") },
    // Inline (locale files are out of scope this change): cancel-anytime, not a refund promise.
    { icon: CheckCircle, label: lang === "tr" ? "Dilediğinde iptal et." : "Cancel anytime." },
  ];

  return (
    <main className="min-h-screen bg-canvas text-ink overflow-x-hidden">
      {/* Nav — everything on one baseline (items-center), consistent h-9 controls.
          Teal accents are the literal brand teal #176B5B in BOTH themes (the
          theme `action` token lightens in dark mode; the spec wants it fixed). */}
      <nav className="flex items-center justify-between gap-4 px-6 py-4 max-w-6xl mx-auto">
        {/* Logo — clean wordmark, clickable (→ / when logged out, /home when in) */}
        <Link href={logoHref} className="text-lg font-bold tracking-tight text-ink hover:text-[#176B5B] transition-colors">
          Mizan
        </Link>

        <div className="flex items-center gap-2 sm:gap-3">
          {/* Pricing — a pill button matching the navbar control style */}
          <button
            onClick={() => pricingRef.current?.scrollIntoView({ behavior: "smooth" })}
            className="hidden sm:inline-flex items-center h-9 px-4 rounded-lg border border-ink/30 text-sm font-medium text-ink-soft hover:text-[#176B5B] hover:border-[#176B5B] transition-colors"
          >
            {t("pricing.navLink")}
          </button>

          {/* Language toggle — two buttons; active filled teal, inactive outline */}
          <div className="flex items-center gap-1.5">
            {(["tr", "en"] as const).map((l) => (
              <button
                key={l}
                onClick={() => setLanguage(l)}
                aria-pressed={lang === l}
                className={`inline-flex items-center h-9 px-3 rounded-lg text-xs font-semibold transition-colors ${
                  lang === l
                    ? "bg-[#176B5B] text-white border border-[#176B5B]"
                    : "bg-transparent text-ink-soft border border-ink/35 hover:border-[#176B5B] hover:text-ink"
                }`}
              >
                {l.toUpperCase()}
              </button>
            ))}
          </div>

          {/* Theme toggle — segmented sun/moon/monitor; click switches instantly */}
          <div className="inline-flex items-center h-9 gap-0.5 rounded-lg border border-ink/35 bg-surface px-0.5">
            {([
              { value: "light", Icon: Sun },
              { value: "dark", Icon: Moon },
              { value: "system", Icon: Monitor },
            ] as { value: ThemePref; Icon: typeof Sun }[]).map(({ value, Icon }) => (
              <button
                key={value}
                onClick={() => setTheme(value)}
                aria-label={value}
                aria-pressed={themePref === value}
                className={`inline-flex items-center justify-center w-7 h-7 rounded-md transition-colors ${
                  themePref === value
                    ? "bg-[#176B5B] text-white"
                    : "text-ink-soft hover:text-[#176B5B] hover:bg-surface-2"
                }`}
              >
                <Icon size={16} />
              </button>
            ))}
          </div>

          {/* Secondary — visible border that flips with the theme (dark-on-light, light-on-dark) */}
          {!isLoggedIn && (
            <Link
              href="/login"
              className="inline-flex items-center h-9 px-4 rounded-lg border border-ink/30 hover:border-ink/55 text-sm font-medium text-ink transition-colors"
            >
              {t("landing.signIn")}
            </Link>
          )}

          {/* Primary CTA — solid teal #176B5B, white text, never transparent */}
          <Link
            href={startHref}
            className="inline-flex items-center h-9 px-4 rounded-lg bg-[#176B5B] hover:bg-[#125848] text-white text-sm font-semibold shadow-sm transition-colors"
          >
            {isLoggedIn ? t("landing.continue") : t("landing.ctaPrimary")}
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative px-6 pt-12 pb-24 max-w-6xl mx-auto">
        <div className="relative grid lg:grid-cols-[1fr_1.2fr] gap-10 lg:gap-14 items-center">
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
                href={startHref}
                className="inline-flex items-center justify-center gap-2 px-7 py-3.5 rounded-xl bg-[#176B5B] hover:bg-[#125848] text-white font-semibold shadow-sm transition-colors"
              >
                {isLoggedIn ? t("landing.continue") : t("landing.ctaPrimary")} <ArrowRight size={18} />
              </Link>
              <button
                onClick={() => howRef.current?.scrollIntoView({ behavior: "smooth" })}
                className="inline-flex items-center justify-center px-7 py-3.5 rounded-xl bg-surface hover:bg-surface-2 border-2 border-ink/40 hover:border-[#176B5B] font-semibold text-ink hover:text-[#176B5B] transition-colors"
              >
                {t("landing.ctaSecondary")}
              </button>
            </div>
            <p className="text-ink-mute text-xs mt-4">{t("landing.ctaNote")}</p>
          </div>

          {/* Product preview — a clean browser/app window frame, soft shadow, no glow.
              Sized up so it reads as a real product showcase, not a thumbnail. */}
          <div className="relative lg:-mr-6">
            <div className="rounded-2xl border border-line bg-surface shadow-2xl shadow-ink/10 overflow-hidden">
              {/* window chrome */}
              <div className="flex items-center gap-2 px-5 py-4 border-b border-line bg-surface-2">
                <span className="w-3 h-3 rounded-full bg-line-strong" />
                <span className="w-3 h-3 rounded-full bg-line-strong" />
                <span className="w-3 h-3 rounded-full bg-line-strong" />
                <div className="ml-3 flex-1 max-w-[300px]">
                  <div className="h-6 rounded-md bg-surface border border-line flex items-center px-2.5 text-[11px] text-ink-mute">
                    mizan.app/home
                  </div>
                </div>
              </div>
              {/* screen */}
              <div className="p-6 sm:p-8">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-ink-mute text-xs uppercase tracking-wider">{t("landing.mockNetWorth")}</p>
                    <p className="text-4xl sm:text-5xl font-bold tabular-nums mt-1.5">{t("landing.mockNetWorthValue")}</p>
                  </div>
                  <span className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-pos/10 text-pos text-sm font-semibold">
                    <TrendingUp size={14} /> {t("landing.mockDelta")}
                  </span>
                </div>
                {/* Sparkline — hover any point for its date + value */}
                <div className="relative mt-4 h-20" onMouseLeave={() => setActivePoint(null)}>
                  <svg viewBox="0 0 320 70" className="w-full h-20 block" preserveAspectRatio="none">
                    <defs>
                      <linearGradient id="spark" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="rgb(var(--c-brand))" stopOpacity="0.35" />
                        <stop offset="100%" stopColor="rgb(var(--c-brand))" stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    <path d="M0 56 L40 51 L80 54 L120 44 L160 40 L200 35 L240 28 L280 19 L320 12 L320 70 L0 70 Z" fill="url(#spark)" />
                    <path d="M0 56 L40 51 L80 54 L120 44 L160 40 L200 35 L240 28 L280 19 L320 12" fill="none" stroke="rgb(var(--c-brand))" strokeWidth="2.5" />
                    {/* invisible hover hit-areas, one per data point */}
                    {SPARK_CY.map((_, i) => (
                      <rect
                        key={i}
                        x={Math.max(0, i * 40 - 20)}
                        y="0"
                        width="40"
                        height="70"
                        fill="transparent"
                        className="cursor-pointer"
                        onMouseEnter={() => setActivePoint(i)}
                      />
                    ))}
                  </svg>
                  {/* active dot — HTML (not SVG) so it isn't stretched by the non-uniform scale */}
                  <span
                    className={`absolute w-2.5 h-2.5 rounded-full bg-[#176B5B] ring-2 ring-surface -translate-x-1/2 -translate-y-1/2 pointer-events-none transition-opacity duration-150 ${activePoint !== null ? "opacity-100" : "opacity-0"}`}
                    style={activePoint !== null ? { left: `${(activePoint * 40 / 320) * 100}%`, top: `${(SPARK_CY[activePoint] / 70) * 100}%` } : undefined}
                  />
                  {/* tooltip */}
                  <div
                    className={`absolute z-10 -translate-x-1/2 -translate-y-full pointer-events-none transition-opacity duration-150 ${activePoint !== null ? "opacity-100" : "opacity-0"}`}
                    style={activePoint !== null ? { left: `${(activePoint * 40 / 320) * 100}%`, top: `${(SPARK_CY[activePoint] / 70) * 100}%` } : undefined}
                  >
                    <div className="mb-2 px-2 py-1 rounded-md bg-ink text-canvas text-[11px] font-semibold whitespace-nowrap shadow-md">
                      {activePoint !== null && `${sparkMonths[activePoint]} · ${sym}${SPARK_AMT[activePoint].toFixed(2).replace(".", dec)}M`}
                    </div>
                  </div>
                </div>
                {/* Asset rows — hover highlights with a soft teal background */}
                <div className="mt-5 space-y-1">
                  {[
                    { dot: "#16a34a", label: t("landing.mockCash"), val: t("landing.mockCashValue") },
                    { dot: "#d97706", label: t("landing.mockCrypto"), val: "0.42 BTC" },
                    { dot: "rgb(var(--c-brand))", label: t("landing.mockProperty"), val: t("landing.mockPropertyValue") },
                  ].map((r) => (
                    <div
                      key={r.label}
                      className="flex items-center justify-between text-base rounded-lg -mx-2 px-2 py-2 hover:bg-[#176B5B]/10 transition-colors cursor-default"
                    >
                      <span className="flex items-center gap-2.5 text-ink-soft">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: r.dot }} />{r.label}
                      </span>
                      <span className="text-ink font-medium tabular-nums">{r.val}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-6 pt-5 border-t border-line">
                  <p className="text-[11px] uppercase tracking-wider text-brand mb-1.5 flex items-center gap-1">
                    <Sparkles size={12} /> {t("landing.mockBriefLabel")}
                  </p>
                  <p className="text-ink-soft text-[15px] leading-relaxed">{t("landing.mockBrief")}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Loop — tinted band so it reads as a distinct section */}
      <section ref={howRef} className="border-t border-line bg-surface-2 py-24 px-6">
        <div className="max-w-5xl mx-auto">
          <p className="text-center text-ink-mute text-xs uppercase tracking-widest mb-3">{t("landing.loopEyebrow")}</p>
          <h2 className="text-3xl font-bold text-center mb-16">{t("landing.loopTitle")}</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {STEPS.map((s, i) => (
              <div key={s.title} className="relative bg-surface border border-line rounded-xl p-6 transition-all duration-200 hover:-translate-y-1 hover:border-[#176B5B]/50 hover:shadow-md">
                {/* Prominent icon on its own row; step number is small and secondary. */}
                <div className="w-12 h-12 rounded-xl bg-[#176B5B]/10 border border-[#176B5B]/30 flex items-center justify-center mb-5">
                  <s.icon size={22} className="text-[#176B5B]" />
                </div>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-ink-mute text-xs font-semibold tabular-nums">{`0${i + 1}`}</span>
                  <h3 className="font-semibold text-ink">{s.title}</h3>
                </div>
                <p className="text-ink-mute text-sm leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-24 px-6 bg-canvas border-t border-line">
        <div className="max-w-5xl mx-auto">
          <p className="text-center text-ink-mute text-xs uppercase tracking-widest mb-3">{t("landing.featEyebrow")}</p>
          <h2 className="text-3xl font-bold text-center mb-16">{t("landing.featTitle")}</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {FEATURES.map((f) => (
              <div key={f.title} className="group bg-surface border border-line hover:border-[#176B5B]/50 rounded-xl p-5 transition-all duration-200 hover:-translate-y-1 hover:shadow-md">
                <div className="w-10 h-10 rounded-lg bg-[#176B5B]/10 border border-[#176B5B]/30 flex items-center justify-center mb-4 group-hover:bg-[#176B5B]/15 transition-colors">
                  <f.icon size={20} className="text-[#176B5B]" />
                </div>
                <h3 className="font-semibold text-ink mb-1.5">{f.title}</h3>
                <p className="text-ink-mute text-sm leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Simulator spotlight — tinted band */}
      <section className="py-24 px-6 border-t border-line bg-surface-2">
        <div className="max-w-5xl mx-auto grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <p className="text-brand text-xs uppercase tracking-widest mb-3 flex items-center gap-2">
              <Sparkles size={13} /> {t("landing.simEyebrow")}
            </p>
            <h2 className="text-3xl font-bold mb-4">{t("landing.simTitle")}</h2>
            <p className="text-ink-mute text-lg leading-relaxed mb-6">{t("landing.simDesc")}</p>
            <div className="space-y-2">
              {simQuestions.map((q) => (
                <div key={q} className="flex items-start gap-2 px-3 py-2 rounded-lg bg-surface border border-line border-l-2 border-l-transparent text-ink-soft text-sm transition-colors hover:border-l-[#176B5B] hover:bg-surface-2">
                  <MessageCircle size={14} className="text-[#176B5B] shrink-0 mt-0.5" /> {q}
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

          {/* Billing toggle — two clearly distinct buttons; active = solid teal */}
          <div className="flex items-center justify-center gap-3 mb-12">
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

          {/* Tiers */}
          <div className="grid md:grid-cols-3 gap-5 items-start">
            {TIERS.map((tier) => {
              const free = tier.monthly === "₺0";
              return (
                <div
                  key={tier.id}
                  className={`relative rounded-2xl p-6 flex flex-col ${
                    tier.highlight
                      ? "bg-[#176B5B]/5 border-2 border-[#176B5B] shadow-lg shadow-[#176B5B]/15 md:-mt-3 md:mb-3"
                      : "bg-surface border border-line"
                  }`}
                >
                  {/* "Most popular" badge — straddles the top edge, solid teal, white text */}
                  {tier.highlight && (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-[#176B5B] text-white text-xs font-semibold shadow-sm whitespace-nowrap">
                      {t("pricing.popular")}
                    </span>
                  )}

                  <h3 className={`text-lg font-bold ${tier.highlight ? "text-brand" : ""}`}>{tier.name}</h3>
                  <p className="text-ink-mute text-sm mt-1 mb-5 min-h-[2.5rem]">{tier.tagline}</p>

                  {/* Price */}
                  <div className="mb-6">
                    {free ? (
                      <div className="text-4xl font-bold tabular-nums">{lang === "tr" ? "₺0" : "$0"}</div>
                    ) : annual ? (
                      <>
                        <div className="flex items-baseline gap-1">
                          <span className={`text-4xl font-bold tabular-nums ${tier.highlight ? "text-brand" : ""}`}>{lang === "tr" ? tier.yearly : tier.usdYearly}</span>
                          <span className="text-ink-mute text-sm">/{perYr}</span>
                        </div>
                        <p className="text-ink-mute text-xs mt-1.5 tabular-nums">
                          {lang === "tr" ? `≈ ${tier.yearlyMo}/${perMo}` : `≈ ${tier.usdMo}/${perMo}`}
                        </p>
                      </>
                    ) : (
                      <div className="flex items-baseline gap-1">
                        <span className={`text-4xl font-bold tabular-nums ${tier.highlight ? "text-brand" : ""}`}>{lang === "tr" ? tier.monthly : tier.usdMonthly}</span>
                        <span className="text-ink-mute text-sm">/{perMo}</span>
                      </div>
                    )}
                  </div>

                  {/* CTA — highlighted tier gets the solid action-teal button */}
                  <Link
                    href={tier.href}
                    className={`block text-center px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors mb-6 ${
                      tier.highlight
                        ? "bg-[#176B5B] hover:bg-[#125848] text-white shadow-sm"
                        : "bg-surface border border-ink/30 hover:border-[#176B5B] text-ink hover:text-[#176B5B]"
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

      {/* Global / sources — tinted band */}
      <section className="py-20 px-6 bg-surface-2 border-t border-line">
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

      {/* Final CTA — strong close: dark teal card, social proof, one bold line */}
      {!isLoggedIn && (
        <section className="py-24 px-6 border-t border-line">
          <div className="max-w-4xl mx-auto rounded-3xl bg-[#0C2723] px-8 py-16 sm:py-20 text-center">
            {/* Trust statement (no data required) */}
            <span className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/10 text-[#6FE0CE] text-xs font-semibold mb-7">
              <ShieldCheck size={13} />
              {lang === "tr"
                ? "Banka girişi yok. Kart yok. İstediğinde iptal et."
                : "No bank login. No credit card. Cancel anytime."}
            </span>
            <h2 className="text-4xl sm:text-5xl font-bold text-white tracking-tight leading-[1.05] mb-4">
              {lang === "tr" ? "Paranı tahmin etmeyi bırak." : "Stop guessing where your money goes."}
            </h2>
            <p className="text-white/55 text-lg mb-9 max-w-xl mx-auto">
              {lang === "tr"
                ? "İlk ekstreni yükle, 60 saniyede ilk brifingini al."
                : "Upload your first statement and get your first brief in 60 seconds."}
            </p>
            <Link
              href={startHref}
              className="inline-flex items-center gap-2 px-10 py-4 rounded-xl bg-white hover:bg-white/90 text-[#0C2723] font-bold text-lg shadow-lg shadow-black/20 transition-colors"
            >
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
