"use client";

/**
 * WHAT: Login and register page — single form that toggles between modes.
 * WHY: Entry point for all auth; stores JWT + user info in localStorage on success.
 * BREAKS IF REMOVED: No way to create accounts or authenticate.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { login, register, setToken, setStoredUser } from "@/lib/api";

type Mode = "login" | "register";
type FormState = "idle" | "loading" | "error";

export default function LoginPage() {
  const router = useRouter();
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
      setStoredUser({ id: result.user_id, email: result.email, onboarding_completed: result.onboarding_completed });
      if (mode === "register" || !result.onboarding_completed) {
        router.push("/onboarding");
      } else {
        router.push("/transactions");
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Bir hata oluştu.");
      setState("error");
    }
  };

  return (
    <main className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <Link href="/" className="text-gray-500 text-sm hover:text-gray-300 transition-colors">
            ← Mizan
          </Link>
          <h1 className="text-3xl font-bold mt-4">
            {mode === "login" ? "Giriş Yap" : "Hesap Oluştur"}
          </h1>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">E-posta</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-gray-900 border border-gray-700 text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 transition-colors"
              placeholder="ornek@email.com"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">Şifre</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-gray-900 border border-gray-700 text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 transition-colors"
              placeholder={mode === "register" ? "En az 8 karakter" : "••••••••"}
            />
          </div>

          {state === "error" && (
            <div className="p-3 rounded-lg bg-red-950 border border-red-800">
              <p className="text-red-300 text-sm">{errorMsg}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={state === "loading"}
            className="w-full py-3 px-4 rounded-xl font-semibold bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {state === "loading"
              ? "Yükleniyor..."
              : mode === "login"
              ? "Giriş Yap"
              : "Hesap Oluştur"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-gray-500">
          {mode === "login" ? "Hesabınız yok mu?" : "Zaten hesabınız var mı?"}{" "}
          <button
            onClick={() => { setMode(mode === "login" ? "register" : "login"); setErrorMsg(""); setState("idle"); }}
            className="text-indigo-400 hover:text-indigo-300 underline"
          >
            {mode === "login" ? "Kayıt ol" : "Giriş yap"}
          </button>
        </p>
      </div>
    </main>
  );
}
