"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { login, register, setToken, setStoredUser, detectBrowserCurrency } from "@/lib/api";
import { useLanguage, setLanguage, detectBrowserLang, type Lang } from "@/lib/i18n";
import ThemeToggle from "@/components/ui/ThemeToggle";

type Mode = "login" | "register";
type FormState = "idle" | "loading" | "error";

const inputClass =
  "w-full px-4 py-3 rounded-xl bg-canvas border border-line text-ink placeholder:text-ink-mute " +
  "focus:outline-none focus:border-[#176B5B] focus:ring-2 focus:ring-[#176B5B]/20 transition-shadow text-sm";

export default function LoginPage() {
  const router = useRouter();
  const { lang, t } = useLanguage();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [state, setState] = useState<FormState>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  // Open directly on the register form when arriving via /login?mode=register
  // (the landing "Ücretsiz başla" CTAs). Read on mount from the URL — no
  // useSearchParams, so the page keeps prerendering without a Suspense boundary.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("mode") === "register") {
      setMode("register");
    }
  }, []);

  const switchMode = (next: Mode) => {
    if (next === mode) return;
    setMode(next);
    setErrorMsg("");
    setState("idle");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState("loading");
    setErrorMsg("");
    try {
      const result = mode === "login"
        ? await login(email, password)
        : await register(email, password);
      setToken(result.access_token);
      // Fall back to the browser locale (not a hardcoded tr/TRY) when the backend omits a preference.
      const resolvedLang: Lang = (result.language === "tr" || result.language === "en")
        ? result.language
        : detectBrowserLang();
      const resolvedCurrency = result.display_currency ?? detectBrowserCurrency();
      setStoredUser({ id: result.user_id, email: result.email, onboarding_completed: result.onboarding_completed, language: resolvedLang, display_currency: resolvedCurrency, is_admin: result.is_admin ?? false, email_verified: result.email_verified, plan: result.plan });
      setLanguage(resolvedLang);
      // Email must be verified before upload/AI features unlock. Send unverified
      // accounts (new registrations included) to the verify screen first.
      if (!result.email_verified) {
        router.push(`/verify?email=${encodeURIComponent(result.email)}&sent=1`);
      } else if (mode === "register" || !result.onboarding_completed) {
        router.push("/onboarding");
      } else {
        router.push("/home");
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : t("common.error"));
      setState("error");
    }
  };

  const isRegister = mode === "register";

  return (
    <main className="min-h-screen bg-canvas text-ink flex flex-col">
      {/* Top bar — logo + language + theme, matching the landing chrome */}
      <header className="flex items-center justify-between px-6 py-5 max-w-6xl mx-auto w-full">
        <Link href="/" className="text-lg font-bold tracking-tight text-ink hover:text-[#176B5B] transition-colors">
          Mizan
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
          <div className="rounded-2xl border border-line bg-surface shadow-xl shadow-ink/5 p-7 sm:p-8">
            {/* Header */}
            <div className="mb-6">
              <h1 className="text-2xl font-bold tracking-tight">
                {isRegister ? t("auth.registerTitle") : t("auth.loginTitle")}
              </h1>
              <p className="text-ink-mute text-sm mt-1.5">
                {isRegister ? t("auth.registerSubtitle") : t("auth.loginSubtitle")}
              </p>
            </div>

            {/* Mode tabs */}
            <div className="flex p-1 rounded-xl bg-surface-2 border border-line mb-6">
              {([["login", t("auth.loginBtn")], ["register", t("auth.registerBtn")]] as [Mode, string][]).map(
                ([m, label]) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => switchMode(m)}
                    aria-pressed={mode === m}
                    className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${
                      mode === m ? "bg-surface text-ink shadow-sm" : "text-ink-mute hover:text-ink-soft"
                    }`}
                  >
                    {label}
                  </button>
                ),
              )}
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs text-ink-mute mb-1.5 uppercase tracking-wide">{t("auth.email")}</label>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={inputClass}
                  placeholder="example@email.com"
                />
              </div>

              <div>
                <label className="block text-xs text-ink-mute mb-1.5 uppercase tracking-wide">{t("auth.password")}</label>
                <input
                  type="password"
                  required
                  autoComplete={isRegister ? "new-password" : "current-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={inputClass}
                  placeholder="••••••••"
                />
                {isRegister && <p className="text-ink-mute text-xs mt-1.5">{t("auth.passwordHint")}</p>}
              </div>

              {state === "error" && (
                <div className="p-3.5 rounded-xl bg-neg/10 border border-neg/30">
                  <p className="text-neg text-sm">{errorMsg}</p>
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

          {/* Reassurance line under the card */}
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
