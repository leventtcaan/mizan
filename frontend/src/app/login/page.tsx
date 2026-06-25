"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { login, register, setToken, setStoredUser, detectBrowserCurrency } from "@/lib/api";
import { useLanguage, setLanguage, detectBrowserLang, type Lang } from "@/lib/i18n";

type Mode = "login" | "register";
type FormState = "idle" | "loading" | "error";

const inputClass = "w-full px-4 py-3 rounded-xl bg-surface border border-line text-ink placeholder-gray-700 focus:outline-none focus:border-brand transition-colors text-sm";

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

  return (
    <main className="min-h-screen bg-canvas text-ink flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Language toggle */}
        <div className="flex justify-end mb-4">
          <div className="flex rounded-lg overflow-hidden border border-line text-xs font-medium">
            <button onClick={() => setLanguage("tr")} className={`px-2 py-1 transition-colors ${lang === "tr" ? "bg-brand text-white" : "text-ink-mute"}`}>TR</button>
            <button onClick={() => setLanguage("en")} className={`px-2 py-1 transition-colors ${lang === "en" ? "bg-brand text-white" : "text-ink-mute"}`}>EN</button>
          </div>
        </div>

        <div className="mb-8">
          <Link href="/" className="text-ink-mute text-sm hover:text-ink-mute transition-colors">
            ← Mizan
          </Link>
          <h1 className="text-3xl font-bold mt-6">
            {mode === "login" ? t("auth.loginTitle") : t("auth.registerTitle")}
          </h1>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs text-ink-mute mb-1.5 uppercase tracking-wide">{t("auth.email")}</label>
            <input
              type="email"
              required
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
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
              placeholder="••••••••"
            />
          </div>

          {state === "error" && (
            <div className="p-3.5 rounded-xl bg-red-950/40 border border-red-800/60">
              <p className="text-neg text-sm">{errorMsg}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={state === "loading"}
            className="w-full py-3.5 px-4 rounded-xl font-semibold bg-brand hover:bg-brand-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {state === "loading" ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                {t("common.loading")}
              </span>
            ) : mode === "login" ? t("auth.loginBtn") : t("auth.registerBtn")}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-ink-mute">
          <button
            onClick={() => { setMode(mode === "login" ? "register" : "login"); setErrorMsg(""); setState("idle"); }}
            className="text-brand hover:text-brand transition-colors"
          >
            {mode === "login" ? t("auth.registerSwitch") : t("auth.loginSwitch")}
          </button>
        </p>
      </div>
    </main>
  );
}
