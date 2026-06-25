"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  verifyEmail, resendVerification, getStoredUser, setStoredUser, getToken, postAuthRoute,
} from "@/lib/api";
import { useLanguage } from "@/lib/i18n";
import MimGuide from "@/components/companion/MimGuide";
import { CheckCircle, Mail } from "@/components/ui/Icons";

type State = "verifying" | "success" | "error" | "notice";

function VerifyInner() {
  const router = useRouter();
  const { t, lang } = useLanguage();
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

  // Where to go once verified: the gate-aware destination (onboarding if pending,
  // else home); if there's no session (link opened elsewhere), send them to log in.
  const continueHref = !getToken() ? "/login" : postAuthRoute();

  const mim: Record<State, { msg: string; mood: "calm" | "happy" | "concerned" | "thinking" }> = {
    verifying: {
      msg: lang === "tr" ? "Doğruluyorum, bir saniye…" : "Verifying you in, one moment…",
      mood: "thinking",
    },
    notice: {
      msg: lang === "tr"
        ? "Neredeyse hazırız. Sana bir doğrulama e-postası gönderdim — gelen kutunu bir kontrol et, gerisini ben hallederim."
        : "Almost there. I sent you a verification email — go check your inbox and I'll take it from here.",
      mood: "calm",
    },
    error: {
      msg: lang === "tr"
        ? "Bu bağlantı işe yaramadı (süresi dolmuş olabilir). Yeni bir tane göndereyim mi?"
        : "That link didn't work (it may have expired). Want me to send a fresh one?",
      mood: "concerned",
    },
    success: {
      msg: lang === "tr" ? "Harika! Hesabın doğrulandı. Hadi paranı düzene sokalım." : "Perfect — your account is verified. Let's get your money in order.",
      mood: "happy",
    },
  };

  return (
    <main className="min-h-screen bg-canvas text-ink flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <Link href="/" className="text-ink-mute text-sm hover:text-ink-soft transition-colors">← Mizan</Link>
        </div>

        {/* Mim guides the moment */}
        <div className="mb-6">
          <MimGuide message={mim[state].msg} mood={mim[state].mood} size={56} speaking={state !== "verifying"} />
        </div>

        <div className="rounded-2xl border border-line bg-surface shadow-xl shadow-ink/5 p-7 text-center">
          {state === "verifying" && (
            <div className="py-4">
              <span className="inline-block w-8 h-8 border-2 border-line border-t-[#176B5B] rounded-full animate-spin" />
              <p className="text-ink-mute text-sm mt-4">{t("verify.verifying")}</p>
            </div>
          )}

          {state === "success" && (
            <>
              <div className="w-14 h-14 rounded-2xl bg-pos/15 flex items-center justify-center mx-auto mb-5">
                <CheckCircle size={28} className="text-pos" />
              </div>
              <h1 className="text-xl font-bold mb-2">{t("verify.successTitle")}</h1>
              <p className="text-ink-mute text-sm mb-6">{t("verify.successBody")}</p>
              <button
                onClick={() => router.push(continueHref)}
                className="w-full py-3.5 px-4 rounded-xl font-semibold bg-[#176B5B] hover:bg-[#125848] text-white transition-colors"
              >
                {t("verify.continue")}
              </button>
            </>
          )}

          {(state === "notice" || state === "error") && (
            <>
              <div className="w-14 h-14 rounded-2xl bg-[#176B5B]/10 flex items-center justify-center mx-auto mb-5">
                <Mail size={26} className="text-[#176B5B]" />
              </div>
              <h1 className="text-xl font-bold mb-2">
                {state === "error" ? t("verify.errorTitle") : t("verify.noticeTitle")}
              </h1>
              <p className="text-ink-soft text-sm mb-1">{t("verify.checkEmail")}</p>
              {emailParam && <p className="text-ink-mute text-xs mb-6 break-all">{emailParam}</p>}

              <button
                onClick={handleResend}
                disabled={!emailParam || resent}
                className="w-full py-3.5 px-4 rounded-xl font-semibold bg-[#176B5B] hover:bg-[#125848] text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {resent ? t("verify.resent") : t("verify.resend")}
              </button>
              <p className="mt-5 text-sm text-ink-mute">
                <Link href="/login" className="text-[#176B5B] hover:text-[#125848] font-medium transition-colors">
                  {t("verify.backToLogin")}
                </Link>
              </p>
            </>
          )}
        </div>
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
