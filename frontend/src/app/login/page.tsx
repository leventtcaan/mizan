"use client";

import { useLayoutEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { login, register, forgotPassword, restoreAccount, setToken, setStoredUser, getStoredUser, detectBrowserCurrency, detectBrowserCountry, detectTimezone, INDUSTRIES, TEAM_SIZES, TOS_VERSION } from "@/lib/api";
import { useLanguage, setLanguage, detectBrowserLang, type Lang } from "@/lib/i18n";
import ThemeToggle from "@/components/ui/ThemeToggle";
import MimGuide from "@/components/companion/MimGuide";
import CountrySelect from "@/components/CountrySelect";
import { Sparkles, Home as HomeIcon, Briefcase } from "@/components/ui/Icons";

type Mode = "login" | "register";
type FormState = "idle" | "loading" | "error";
type AccountType = "personal" | "business";

const inputClass =
  "w-full px-4 py-3 rounded-xl bg-canvas border border-line text-ink placeholder:text-ink-mute " +
  "focus:outline-none focus:border-[#176B5B] focus:ring-2 focus:ring-[#176B5B]/20 transition-shadow text-sm";

export default function LoginPage() {
  const router = useRouter();
  const { lang, t } = useLanguage();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [accountType, setAccountType] = useState<AccountType>("personal");
  const [companyName, setCompanyName] = useState("");
  const [industry, setIndustry] = useState("");
  const [teamSize, setTeamSize] = useState("");
  const [country, setCountry] = useState("");
  const [tosAccepted, setTosAccepted] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [state, setState] = useState<FormState>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  // A paid plan chosen on the landing pricing section (?plan=plus|pro).
  const [selectedPlan, setSelectedPlan] = useState<"plus" | "pro" | null>(null);
  // Inline forgot-password panel state.
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);
  const [forgotBusy, setForgotBusy] = useState(false);
  // Deleted account within its 30-day recovery window — offer restore.
  const [recoverable, setRecoverable] = useState(false);

  // Open directly on register when arriving via /login?mode=register (landing CTAs).
  // useLayoutEffect (not useEffect) so the flip happens BEFORE the first paint — with
  // client-side navigation from the landing page there is no visible login-tab flash.
  useLayoutEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("mode") === "register") setMode("register");
    const p = params.get("plan");
    if (p === "plus" || p === "pro") setSelectedPlan(p);
    setCountry(detectBrowserCountry()); // pre-select; user can change
  }, []);

  const switchMode = (next: Mode) => {
    if (next === mode) return;
    setMode(next);
    setErrorMsg("");
    setState("idle");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Consent gate (register only) — required, and unbundled from marketing.
    if (mode === "register" && !tosAccepted) {
      setErrorMsg(t("setup.tosError"));
      setState("error");
      return;
    }
    // Business accounts must name the company.
    if (mode === "register" && accountType === "business" && !companyName.trim()) {
      setErrorMsg(t("setup.companyRequired"));
      setState("error");
      return;
    }
    setState("loading");
    setErrorMsg("");
    try {
      const result = mode === "login"
        ? await login(email, password)
        : await register(email, password, {
            full_name: name.trim() || undefined,
            country: country || undefined,
            marketing_consent: marketing,
            tos_accepted: tosAccepted,
            tos_version: TOS_VERSION,
            account_type: accountType,
            company_name: accountType === "business" ? (companyName.trim() || undefined) : undefined,
            industry: accountType === "business" ? (industry || undefined) : undefined,
            team_size: accountType === "business" ? (teamSize || undefined) : undefined,
            timezone: detectTimezone(),
          });
      setToken(result.access_token);
      if (mode === "register") localStorage.removeItem("mizan_ref"); // referral consumed
      const resolvedLang: Lang = (result.language === "tr" || result.language === "en")
        ? result.language
        : detectBrowserLang();
      const resolvedCurrency = result.display_currency ?? detectBrowserCurrency();
      // On register, capture the first-impression profile (name + how they'll use
      // Mizan) so the rest of setup and Home can personalize immediately. On login,
      // preserve whatever profile is already stored locally.
      const prior = getStoredUser();
      setStoredUser({
        id: result.user_id, email: result.email,
        onboarding_completed: result.onboarding_completed,
        language: resolvedLang, display_currency: resolvedCurrency,
        is_admin: result.is_admin ?? false, email_verified: result.email_verified, plan: result.plan,
        display_name: mode === "register" ? (name.trim() || undefined) : (result.full_name ?? prior?.display_name),
        account_type: mode === "register" ? accountType : ((result.account_type as "personal" | "business" | undefined) ?? prior?.account_type),
        country: mode === "register" ? (country || undefined) : (result.country ?? prior?.country),
        primary_goal: result.primary_goal ?? prior?.primary_goal,
        company_name: mode === "register" ? (companyName.trim() || undefined) : (result.company_name ?? prior?.company_name),
        industry: mode === "register" ? (industry || undefined) : (result.industry ?? prior?.industry),
        team_size: mode === "register" ? (teamSize || undefined) : (result.team_size ?? prior?.team_size),
        phone: result.phone ?? prior?.phone,
      });
      setLanguage(resolvedLang);
      if (mode === "register" && selectedPlan) {
        router.push(`/upgrade?plan=${selectedPlan}`);
      } else if (!result.email_verified) {
        router.push(`/verify?email=${encodeURIComponent(result.email)}&sent=1`);
      } else if (mode === "register" || !result.onboarding_completed) {
        router.push("/onboarding");
      } else {
        router.push("/home");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("common.error");
      // Deleted-but-recoverable account (credentials already verified server-side):
      // offer restoration instead of a dead-end error.
      if (msg === "account_deleted_recoverable") {
        setRecoverable(true);
        setState("idle");
        return;
      }
      setErrorMsg(msg);
      setState("error");
    }
  };

  const handleRestore = async () => {
    setState("loading");
    try {
      const result = await restoreAccount(email, password);
      setToken(result.access_token);
      const resolvedLang: Lang = (result.language === "tr" || result.language === "en")
        ? result.language : detectBrowserLang();
      setStoredUser({
        id: result.user_id, email: result.email,
        onboarding_completed: result.onboarding_completed,
        language: resolvedLang, display_currency: result.display_currency ?? detectBrowserCurrency(),
        is_admin: result.is_admin ?? false, email_verified: result.email_verified, plan: result.plan,
        display_name: result.full_name ?? undefined,
        account_type: (result.account_type as "personal" | "business" | undefined) ?? undefined,
      });
      setLanguage(resolvedLang);
      router.push(result.email_verified ? "/home" : `/verify?email=${encodeURIComponent(result.email)}`);
    } catch {
      setRecoverable(false);
      setErrorMsg(t("auth.errorInvalid"));
      setState("error");
    }
  };

  const isRegister = mode === "register";
  const mimLine = isRegister
    ? (lang === "tr"
        ? "Merhaba, ben Clar. Paranı tek bir yerde toplamana yardım edeceğim. Önce hesabını oluşturalım."
        : "Hi, I'm Clar. I'll help you see all your money in one place. First, let's create your account.")
    : (lang === "tr"
        ? "Tekrar hoş geldin. Kaldığın yerden devam edelim."
        : "Welcome back. Let's pick up where you left off.");

  return (
    <main className="min-h-screen bg-canvas text-ink flex flex-col">
      {/* Top bar — logo + language + theme */}
      <header className="flex items-center justify-between px-6 py-5 max-w-6xl mx-auto w-full">
        <Link href="/" className="text-lg font-bold tracking-tight text-ink hover:text-[#176B5B] transition-colors">
          Clarifin
        </Link>
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-1.5">
            {(["tr", "en"] as const).map((l) => (
              <button
                key={l}
                onClick={() => setLanguage(l)}
                aria-pressed={lang === l}
                className={`inline-flex items-center h-9 px-3 rounded-lg text-xs font-semibold transition-colors ${
                  lang === l
                    ? "bg-[#176B5B] text-white border border-[#176B5B]"
                    : "bg-transparent text-ink-soft border border-ink/30 hover:border-[#176B5B] hover:text-ink"
                }`}
              >
                {l.toUpperCase()}
              </button>
            ))}
          </div>
          <ThemeToggle size="sm" />
        </div>
      </header>

      {/* Centered auth card */}
      <div className="flex-1 flex items-center justify-center px-4 pb-20">
        <div className="w-full max-w-md">
          {/* Mim — present from the very first screen */}
          <div className="mb-5">
            <MimGuide message={mimLine} mood={isRegister ? "happy" : "calm"} size={56} />
          </div>

          <div className="rounded-2xl border border-line bg-surface shadow-xl shadow-ink/5 p-7 sm:p-8">
            <div className="mb-6">
              <h1 className="text-2xl font-bold tracking-tight">
                {isRegister ? t("auth.registerTitle") : t("auth.loginTitle")}
              </h1>
              <p className="text-ink-mute text-sm mt-1.5">
                {isRegister ? t("auth.registerSubtitle") : t("auth.loginSubtitle")}
              </p>
            </div>

            {/* Selected-plan banner (from the landing pricing CTA) */}
            {isRegister && selectedPlan && (
              <div className="mb-6 rounded-xl border border-[#176B5B]/30 bg-[#176B5B]/5 px-4 py-3 flex items-center gap-2.5">
                <Sparkles size={16} className="text-[#176B5B] shrink-0" />
                <p className="text-ink-soft text-sm">
                  {lang === "tr"
                    ? `${selectedPlan === "plus" ? "Plus" : "Pro"} planını seçtin. Devam etmek için hesabını oluştur.`
                    : `You selected the ${selectedPlan === "plus" ? "Plus" : "Pro"} plan. Create your account to continue.`}
                </p>
              </div>
            )}

            {/* Mode tabs */}
            <div className="grid grid-cols-2 gap-2.5 mb-6">
              {([["login", t("auth.loginBtn")], ["register", t("auth.registerBtn")]] as [Mode, string][]).map(
                ([m, label]) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => switchMode(m)}
                    aria-pressed={mode === m}
                    className={`py-2.5 rounded-xl text-sm font-semibold border transition-colors ${
                      mode === m
                        ? "bg-[#176B5B] text-white border-[#176B5B] shadow-sm"
                        : "bg-surface text-ink border-ink/30 hover:border-[#176B5B] hover:text-[#176B5B]"
                    }`}
                  >
                    {label}
                  </button>
                ),
              )}
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Name — register only; helps Mim greet & personalize from day one */}
              {isRegister && (
                <div>
                  <label className="block text-xs text-ink-mute mb-1.5 uppercase tracking-wide">
                    {t("setup.nameLabel")} <span className="normal-case text-ink-mute/70">· {t("setup.optional")}</span>
                  </label>
                  <input
                    type="text"
                    autoComplete="given-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className={inputClass}
                    placeholder={t("setup.namePlaceholder")}
                  />
                </div>
              )}

              <div>
                <label className="block text-xs text-ink-mute mb-1.5 uppercase tracking-wide">{t("auth.email")}</label>
                <input
                  type="email" required autoComplete="email"
                  value={email} onChange={(e) => setEmail(e.target.value)}
                  className={inputClass} placeholder="example@email.com"
                />
              </div>

              <div>
                <label className="block text-xs text-ink-mute mb-1.5 uppercase tracking-wide">{t("auth.password")}</label>
                <input
                  type="password" required autoComplete={isRegister ? "new-password" : "current-password"}
                  value={password} onChange={(e) => setPassword(e.target.value)}
                  className={inputClass} placeholder="••••••••"
                />
                {isRegister && <p className="text-ink-mute text-xs mt-1.5">{t("auth.passwordHint")}</p>}
                {!isRegister && (
                  <div className="mt-1.5 text-right">
                    <button type="button" onClick={() => { setForgotOpen((v) => !v); setForgotSent(false); }}
                      className="text-xs text-ink-mute hover:text-[#176B5B] transition-colors">
                      {t("auth.forgotLink")}
                    </button>
                  </div>
                )}
              </div>

              {/* Inline forgot-password panel — email-based reset link */}
              {!isRegister && forgotOpen && (
                <div className="rounded-xl border border-line bg-surface-2/50 p-3.5">
                  {forgotSent ? (
                    <p className="text-pos text-xs">{t("auth.forgotSent")}</p>
                  ) : (
                    <>
                      <p className="text-ink-soft text-xs mb-2">{t("auth.forgotSub")}</p>
                      <div className="flex gap-2">
                        <input
                          type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                          className={inputClass + " !py-2 text-xs"} placeholder="example@email.com"
                        />
                        <button type="button" disabled={!email.trim() || forgotBusy}
                          onClick={async () => {
                            setForgotBusy(true);
                            try { await forgotPassword(email.trim()); setForgotSent(true); }
                            catch { setForgotSent(true); /* same non-enumerating message */ }
                            finally { setForgotBusy(false); }
                          }}
                          className="shrink-0 px-3 py-2 rounded-lg bg-[#176B5B] hover:bg-[#125848] text-white text-xs font-semibold transition-colors disabled:opacity-50">
                          {forgotBusy ? "…" : t("auth.forgotSend")}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Account type — register only; tailors Mizan to personal vs business */}
              {isRegister && (
                <div>
                  <label className="block text-xs text-ink-mute mb-1.5 uppercase tracking-wide">{t("setup.useTitle")}</label>
                  <div className="grid grid-cols-2 gap-2.5">
                    {([
                      ["personal", t("setup.personal"), t("setup.personalDesc"), <HomeIcon key="p" size={16} />],
                      ["business", t("setup.business"), t("setup.businessDesc"), <Briefcase key="b" size={16} />],
                    ] as [AccountType, string, string, React.ReactNode][]).map(([val, label, desc, icon]) => {
                      const active = accountType === val;
                      return (
                        <button
                          key={val}
                          type="button"
                          onClick={() => setAccountType(val)}
                          aria-pressed={active}
                          className={`text-left p-3 rounded-xl border transition-colors ${
                            active
                              ? "border-[#176B5B] bg-[#176B5B]/[0.07]"
                              : "border-line hover:border-[#176B5B]/50"
                          }`}
                        >
                          <span className={`flex items-center gap-1.5 text-sm font-semibold ${active ? "text-[#176B5B]" : "text-ink"}`}>
                            {icon}{label}
                          </span>
                          <span className="block text-ink-mute text-xs mt-0.5">{desc}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Business profile — register + business only */}
              {isRegister && accountType === "business" && (
                <div className="space-y-3 rounded-xl border border-line p-3">
                  <div>
                    <label className="block text-xs text-ink-mute mb-1.5 uppercase tracking-wide">{t("setup.companyLabel")}</label>
                    <input
                      type="text" value={companyName} onChange={(e) => setCompanyName(e.target.value)}
                      className={inputClass} placeholder={t("setup.companyPlaceholder")}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-ink-mute mb-1.5 uppercase tracking-wide">{t("setup.industryLabel")}</label>
                      <select value={industry} onChange={(e) => setIndustry(e.target.value)} className={inputClass}>
                        <option value="">—</option>
                        {INDUSTRIES.map((o) => <option key={o.value} value={o.value}>{lang === "tr" ? o.tr : o.en}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-ink-mute mb-1.5 uppercase tracking-wide">{t("setup.teamSizeLabel")}</label>
                      <select value={teamSize} onChange={(e) => setTeamSize(e.target.value)} className={inputClass}>
                        <option value="">—</option>
                        {TEAM_SIZES.map((o) => <option key={o.value} value={o.value}>{lang === "tr" ? o.tr : o.en}</option>)}
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {/* Country — register only; required (currency + privacy regime) */}
              {isRegister && (
                <div>
                  <label className="block text-xs text-ink-mute mb-1.5 uppercase tracking-wide">{t("setup.countryLabel")}</label>
                  <CountrySelect value={country} onChange={setCountry} placeholder={t("setup.countryPlaceholder")} />
                </div>
              )}

              {/* Consent — register only. ToS required + unbundled from marketing (GDPR/KVKK). */}
              {isRegister && (
                <div className="space-y-2.5 pt-1">
                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={tosAccepted}
                      onChange={(e) => setTosAccepted(e.target.checked)}
                      className="mt-0.5 w-4 h-4 shrink-0 accent-[#176B5B]"
                    />
                    <span className="text-ink-soft text-xs leading-relaxed">
                      {lang === "tr" ? (
                        <>
                          <Link href="/terms" target="_blank" className="text-[#176B5B] hover:underline font-medium">{t("setup.terms")}</Link>
                          {" ve "}
                          <Link href="/privacy" target="_blank" className="text-[#176B5B] hover:underline font-medium">{t("setup.privacy")}</Link>
                          {"'nı okudum ve kabul ediyorum."}
                        </>
                      ) : (
                        <>
                          {"I agree to the "}
                          <Link href="/terms" target="_blank" className="text-[#176B5B] hover:underline font-medium">{t("setup.terms")}</Link>
                          {" and "}
                          <Link href="/privacy" target="_blank" className="text-[#176B5B] hover:underline font-medium">{t("setup.privacy")}</Link>
                          {"."}
                        </>
                      )}
                    </span>
                  </label>
                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={marketing}
                      onChange={(e) => setMarketing(e.target.checked)}
                      className="mt-0.5 w-4 h-4 shrink-0 accent-[#176B5B]"
                    />
                    <span className="text-ink-mute text-xs leading-relaxed">{t("setup.marketing")}</span>
                  </label>
                </div>
              )}

              {state === "error" && (
                <div className="p-3.5 rounded-xl bg-neg/10 border border-neg/30">
                  <p className="text-neg text-sm">{errorMsg}</p>
                </div>
              )}

              {/* Deleted account within its recovery window — offer to bring it back */}
              {recoverable && (
                <div className="p-4 rounded-xl bg-warn/10 border border-warn/30 space-y-2.5">
                  <p className="text-ink text-sm font-semibold">{t("auth.recoverableTitle")}</p>
                  <p className="text-ink-soft text-xs leading-relaxed">{t("auth.recoverableBody")}</p>
                  <button type="button" onClick={handleRestore} disabled={state === "loading"}
                    className="px-4 py-2 rounded-lg bg-[#176B5B] hover:bg-[#125848] text-white text-xs font-semibold transition-colors disabled:opacity-50">
                    {t("auth.restoreBtn")}
                  </button>
                </div>
              )}

              <button
                type="submit"
                disabled={state === "loading"}
                className="w-full py-3.5 px-4 rounded-xl font-semibold bg-[#176B5B] hover:bg-[#125848] text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {state === "loading" ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    {t("common.loading")}
                  </span>
                ) : isRegister ? t("auth.registerBtn") : t("auth.loginBtn")}
              </button>
            </form>
          </div>

          <p className="text-center text-ink-mute text-xs mt-5">
            {lang === "tr"
              ? "Banka girişi yok. Kart yok. İstediğinde iptal et."
              : "No bank login. No credit card. Cancel anytime."}
          </p>
        </div>
      </div>
    </main>
  );
}
