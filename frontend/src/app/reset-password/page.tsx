"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { resetPassword } from "@/lib/api";
import { useLanguage } from "@/lib/i18n";
import MimGuide from "@/components/companion/MimGuide";
import { CheckCircle } from "@/components/ui/Icons";

const inputClass =
  "w-full px-4 py-3 rounded-xl bg-canvas border border-line text-ink placeholder:text-ink-mute " +
  "focus:outline-none focus:border-[#176B5B] focus:ring-2 focus:ring-[#176B5B]/20 transition-shadow text-sm";

export default function ResetPasswordPage() {
  const router = useRouter();
  const { t, lang } = useLanguage();
  // Token from ?token= — read AFTER mount. `window` is undefined during SSR/prerender,
  // and a lazy useState initializer never re-runs on the client, so the token must be
  // pulled in an effect. `ready` gates the invalid-link message so it can't flash before
  // the URL has actually been read.
  const [token, setToken] = useState("");
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get("token") ?? "");
    setReady(true);
  }, []);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) { setError(t("auth.errorShort")); return; }
    if (password !== confirm) { setError(t("auth.resetMismatch")); return; }
    setError(null);
    setBusy(true);
    try {
      await resetPassword(token, password);
      setDone(true);
      setTimeout(() => router.push("/login"), 2500);
    } catch {
      setError(t("auth.resetInvalid"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-canvas text-ink flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8">
          <p className="text-center text-ink-mute text-sm font-medium tracking-widest uppercase">Clarifin</p>
        </div>

        <div className="mb-6">
          <MimGuide
            message={lang === "tr" ? "Yeni bir şifre seçelim — güvenli bir tane olsun." : "Let's pick a new password — make it a strong one."}
            mood="calm" size={56}
          />
        </div>

        <div className="bg-surface border border-line rounded-2xl p-6 shadow-sm">
          {done ? (
            <div className="text-center py-4">
              <span className="mx-auto mb-3 w-11 h-11 rounded-2xl bg-pos/10 flex items-center justify-center">
                <CheckCircle size={22} className="text-pos" />
              </span>
              <p className="text-ink font-semibold">{t("auth.resetDone")}</p>
              <Link href="/login" className="inline-block mt-3 text-[#176B5B] text-sm font-medium hover:underline">
                {t("auth.backToLogin")}
              </Link>
            </div>
          ) : (
            <>
              <h1 className="text-xl font-bold mb-1">{t("auth.resetTitle")}</h1>
              <p className="text-ink-mute text-sm mb-5">{t("auth.resetSub")}</p>

              <form onSubmit={submit} className="space-y-4">
                <div>
                  <label className="block text-xs text-ink-mute mb-1.5 uppercase tracking-wide">{t("auth.newPassword")}</label>
                  <input type="password" required autoComplete="new-password" value={password}
                    onChange={(e) => setPassword(e.target.value)} className={inputClass} placeholder="••••••••" />
                  <p className="text-ink-mute text-xs mt-1.5">{t("auth.passwordHint")}</p>
                </div>
                <div>
                  <label className="block text-xs text-ink-mute mb-1.5 uppercase tracking-wide">{t("auth.confirmPassword")}</label>
                  <input type="password" required autoComplete="new-password" value={confirm}
                    onChange={(e) => setConfirm(e.target.value)} className={inputClass} placeholder="••••••••" />
                </div>

                {error && <p className="text-neg text-sm">{error}</p>}

                <button type="submit" disabled={busy || !token}
                  className="w-full py-3 rounded-xl bg-[#176B5B] hover:bg-[#125848] text-white font-semibold transition-colors disabled:opacity-50">
                  {busy ? "…" : t("auth.resetBtn")}
                </button>
                {ready && !token && <p className="text-warn text-xs text-center">{t("auth.resetInvalid")}</p>}
              </form>

              <div className="mt-4 text-center">
                <Link href="/login" className="text-ink-mute text-xs hover:text-ink-soft transition-colors">
                  {t("auth.backToLogin")}
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
