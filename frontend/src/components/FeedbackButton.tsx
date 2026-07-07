"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { getToken, submitFeedback } from "@/lib/api";
import { MessageSquare, X, CheckCircle } from "@/components/ui/Icons";
import { useLanguage } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";

// Public / full-attention pages don't get the feedback button (landing has its own
// world; login/verify/reset are pre-auth; onboarding + brief are focused moments).
const HIDDEN_PATHS = ["/", "/login", "/verify", "/reset-password", "/terms", "/privacy", "/onboarding", "/brief"];

const CATEGORIES = ["bug", "suggestion", "other"] as const;

export default function FeedbackButton() {
  const pathname = usePathname();
  const { t } = useLanguage();
  // Explicit theme-resolved bg — floating overlays must never be see-through
  // (same paint-quirk mitigation as every other overlay in the app).
  const { resolved } = useTheme();
  const surfaceBg = resolved === "dark" ? "#1C1915" : "#FFFFFF";

  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("suggestion");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (HIDDEN_PATHS.includes(pathname) || !getToken()) return null;

  const close = () => {
    setOpen(false);
    // Reset AFTER the closing render so a reopened modal starts fresh.
    setTimeout(() => { setSent(false); setMessage(""); setEmail(""); setError(null); }, 200);
  };

  const send = async () => {
    if (!message.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await submitFeedback({ category, message: message.trim(), email: email.trim() || undefined });
      setSent(true);
      setTimeout(close, 1800);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {/* Floating trigger — bottom-LEFT (the assistant FAB owns bottom-right) */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-5 left-5 z-40 inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full border border-line shadow-lg text-xs font-medium text-ink-soft hover:text-[#176B5B] hover:border-[#176B5B]/50 transition-colors"
        style={{ backgroundColor: surfaceBg }}
      >
        <MessageSquare size={14} /> {t("feedback.button")}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={(e) => { if (e.target === e.currentTarget) close(); }}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-line p-5 shadow-2xl shadow-black/30"
            style={{ backgroundColor: surfaceBg }}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-ink">{t("feedback.title")}</h2>
              <button onClick={close} className="p-1.5 rounded-lg text-ink-mute hover:text-ink hover:bg-surface-2 transition-colors">
                <X size={16} />
              </button>
            </div>

            {sent ? (
              <div className="py-6 text-center">
                <span className="mx-auto mb-3 w-11 h-11 rounded-2xl bg-pos/10 flex items-center justify-center">
                  <CheckCircle size={22} className="text-pos" />
                </span>
                <p className="text-ink text-sm font-medium">{t("feedback.thanks")}</p>
              </div>
            ) : (
              <div className="space-y-3.5">
                <div className="flex gap-2">
                  {CATEGORIES.map((c) => (
                    <button
                      key={c}
                      onClick={() => setCategory(c)}
                      className={`flex-1 py-2 rounded-lg text-xs font-medium border transition-colors ${
                        category === c
                          ? "bg-[#176B5B] border-[#176B5B] text-white"
                          : "bg-canvas border-line text-ink-soft hover:border-[#176B5B]"
                      }`}
                    >
                      {t(`feedback.cat.${c}`)}
                    </button>
                  ))}
                </div>

                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={4}
                  maxLength={2000}
                  placeholder={t("feedback.placeholder")}
                  className="w-full bg-canvas border border-line rounded-lg px-3 py-2.5 text-sm text-ink placeholder:text-ink-mute focus:outline-none focus:border-[#176B5B] focus:ring-2 focus:ring-[#176B5B]/20 resize-none"
                  autoFocus
                />

                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t("feedback.emailPlaceholder")}
                  className="w-full bg-canvas border border-line rounded-lg px-3 py-2.5 text-sm text-ink placeholder:text-ink-mute focus:outline-none focus:border-[#176B5B] focus:ring-2 focus:ring-[#176B5B]/20"
                />

                {error && <p className="text-neg text-xs">{error}</p>}

                <button
                  onClick={send}
                  disabled={!message.trim() || busy}
                  className="w-full py-2.5 rounded-lg bg-[#176B5B] hover:bg-[#125848] text-white text-sm font-semibold transition-colors disabled:opacity-50"
                >
                  {busy ? "…" : t("feedback.send")}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
