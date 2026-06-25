"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  verifyEmail, resendVerification, getStoredUser, setStoredUser, getToken,
} from "@/lib/api";
import { useLanguage } from "@/lib/i18n";
import { CheckCircle, Mail } from "@/components/ui/Icons";

type State = "verifying" | "success" | "error" | "notice";

function VerifyInner() {
  const router = useRouter();
  const { t } = useLanguage();
  const params = useSearchParams();
  const token = params.get("token");
  const emailParam = params.get("email") || getStoredUser()?.email || "";

  const [state, setState] = useState<State>(token ? "verifying" : "notice");
  const [resent, setResent] = useState(false);
  const ran = useRef(false);

  useEffect(() => {
    if (!token || ran.current) return;
    ran.current = true; // guard React StrictMode double-invoke
    verifyEmail(token)
      .then((me) => {
        const stored = getStoredUser();
        if (stored) setStoredUser({ ...stored, email_verified: true, plan: me.plan });
        setState("success");
      })
      .catch(() => setState("error"));
  }, [token]);

  const handleResend = async () => {
    if (!emailParam) return;
    await resendVerification(emailParam);
    setResent(true);
  };

  // Where to go once verified: continue onboarding if pending, else home; if there's
  // no session (link opened elsewhere), send them to log in.
  const continueHref = !getToken()
    ? "/login"
    : getStoredUser()?.onboarding_completed ? "/home" : "/onboarding";

  return (
    <main className="min-h-screen bg-canvas text-ink flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm text-center">
        <Link href="/" className="text-ink-mute text-sm hover:text-ink-soft transition-colors">← Mizan</Link>

        {state === "verifying" && (
          <div className="mt-10">
            <span className="inline-block w-8 h-8 border-2 border-line border-t-brand rounded-full animate-spin" />
            <p className="text-ink-mute text-sm mt-4">{t("verify.verifying")}</p>
          </div>
        )}

        {state === "success" && (
          <div className="mt-10">
            <div className="w-14 h-14 rounded-2xl bg-emerald-500/15 flex items-center justify-center mx-auto mb-5">
              <CheckCircle size={28} className="text-emerald-500" />
            </div>
            <h1 className="text-2xl font-bold mb-2">{t("verify.successTitle")}</h1>
            <p className="text-ink-mute text-sm mb-7">{t("verify.successBody")}</p>
            <button
              onClick={() => router.push(continueHref)}
              className="w-full py-3.5 px-4 rounded-xl font-semibold bg-brand hover:bg-brand-hover text-white transition-colors"
            >
              {t("verify.continue")}
            </button>
          </div>
        )}

        {(state === "notice" || state === "error") && (
          <div className="mt-10">
            <div className="w-14 h-14 rounded-2xl bg-brand/15 flex items-center justify-center mx-auto mb-5">
              <Mail size={26} className="text-brand" />
            </div>
            <h1 className="text-2xl font-bold mb-2">
              {state === "error" ? t("verify.errorTitle") : t("verify.noticeTitle")}
            </h1>
            {/* The requested friendly line */}
            <p className="text-ink-soft text-sm mb-1">{t("verify.checkEmail")}</p>
            {emailParam && <p className="text-ink-mute text-xs mb-7 break-all">{emailParam}</p>}

            <button
              onClick={handleResend}
              disabled={!emailParam || resent}
              className="w-full py-3.5 px-4 rounded-xl font-semibold bg-brand hover:bg-brand-hover text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {resent ? t("verify.resent") : t("verify.resend")}
            </button>
            <p className="mt-6 text-sm text-ink-mute">
              <Link href="/login" className="text-brand hover:text-brand-hover transition-colors">
                {t("verify.backToLogin")}
              </Link>
            </p>
          </div>
        )}
      </div>
    </main>
  );
}

export default function VerifyPage() {
  return (
    <Suspense fallback={null}>
      <VerifyInner />
    </Suspense>
  );
}
