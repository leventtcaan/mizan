"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { login, register, setToken, setStoredUser } from "@/lib/api";
import { useLanguage, setLanguage, type Lang } from "@/lib/i18n";

type Mode = "login" | "register";
type FormState = "idle" | "loading" | "error";

const inputClass = "w-full px-4 py-3 rounded-xl bg-[#1A1A1A] border border-[#2A2A2A] text-white placeholder-gray-700 focus:outline-none focus:border-indigo-600 transition-colors text-sm";

export default function LoginPage() {
  const router = useRouter();
  const { lang, t } = useLanguage();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [state, setState] = useState<FormState>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState("loading");
    setErrorMsg("");
    try {
      const result = mode === "login"
        ? await login(email, password)
        : await register(email, password);
      setToken(result.access_token);
      setStoredUser({ id: result.user_id, email: result.email, onboarding_completed: result.onboarding_completed, language: result.language ?? "tr" });
      if (result.language && (result.language === "tr" || result.language === "en")) {
        setLanguage(result.language as Lang);
      }
      if (mode === "register" || !result.onboarding_completed) {
        router.push("/onboarding");
      } else {
        router.push("/transactions");
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : t("common.error"));
      setState("error");
    }
  };

  return (
    <main className="min-h-screen bg-[#0F0F0F] text-white flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Language toggle */}
        <div className="flex justify-end mb-4">
          <div className="flex rounded-lg overflow-hidden border border-[#2A2A2A] text-xs font-medium">
            <button onClick={() => setLanguage("tr")} className={`px-2 py-1 transition-colors ${lang === "tr" ? "bg-indigo-600 text-white" : "text-gray-400"}`}>TR</button>
            <button onClick={() => setLanguage("en")} className={`px-2 py-1 transition-colors ${lang === "en" ? "bg-indigo-600 text-white" : "text-gray-400"}`}>EN</button>
          </div>
        </div>

        <div className="mb-8">
          <Link href="/" className="text-gray-600 text-sm hover:text-gray-400 transition-colors">
            ← Mizan
          </Link>
          <h1 className="text-3xl font-bold mt-6">
            {mode === "login" ? t("auth.loginTitle") : t("auth.registerTitle")}
          </h1>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1.5 uppercase tracking-wide">{t("auth.email")}</label>
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
            <label className="block text-xs text-gray-500 mb-1.5 uppercase tracking-wide">{t("auth.password")}</label>
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
              <p className="text-red-400 text-sm">{errorMsg}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={state === "loading"}
            className="w-full py-3.5 px-4 rounded-xl font-semibold bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {state === "loading" ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                {t("common.loading")}
              </span>
            ) : mode === "login" ? t("auth.loginBtn") : t("auth.registerBtn")}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-gray-600">
          <button
            onClick={() => { setMode(mode === "login" ? "register" : "login"); setErrorMsg(""); setState("idle"); }}
            className="text-indigo-400 hover:text-indigo-300 transition-colors"
          >
            {mode === "login" ? t("auth.registerSwitch") : t("auth.loginSwitch")}
          </button>
        </p>
      </div>
    </main>
  );
}
