"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import PageLayout from "@/components/ui/PageLayout";
import CurrencySelect from "@/components/CurrencySelect";
import { LogOut, Sparkles, ArrowRight, Settings, Mail, ShieldCheck, CheckCircle } from "@/components/ui/Icons";
import { useLanguage, type Lang } from "@/lib/i18n";
import {
  getToken, getStoredUser, setStoredUser, clearToken, getMe, updatePreferences,
  getDefaultCurrency, setDefaultCurrencyLocal,
} from "@/lib/api";

const TEAL = "#176B5B";

export default function SettingsPage() {
  const router = useRouter();
  const { lang, setLanguage, t } = useLanguage();

  const [email, setEmail] = useState<string>("");
  const [currency, setCurrency] = useState<string>("TRY");
  const [emailWeekly, setEmailWeekly] = useState<boolean | null>(null);
  const [plan, setPlan] = useState<string>("free");
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    if (!getToken() || !getStoredUser()) { router.replace("/login"); return; }
    setEmail(getStoredUser()?.email ?? "");
    setCurrency(getDefaultCurrency());
    setPlan(getStoredUser()?.plan ?? "free");
    getMe()
      .then((me) => {
        setEmail(me.email);
        setCurrency(me.display_currency || "TRY");
        setEmailWeekly(me.email_weekly_enabled);
        setPlan(me.plan || "free");
        // keep localStorage in sync with server truth
        const u = getStoredUser();
        if (u) setStoredUser({ ...u, display_currency: me.display_currency, language: me.language });
      })
      .catch(() => null);
  }, [router]);

  const flashSaved = () => { setSavedFlash(true); setTimeout(() => setSavedFlash(false), 1800); };

  const handleLanguage = (next: Lang) => {
    setLanguage(next);
    updatePreferences({ language: next }).then(() => {
      const u = getStoredUser();
      if (u) setStoredUser({ ...u, language: next });
      flashSaved();
    }).catch(() => null);
  };

  const handleCurrency = (code: string) => {
    setCurrency(code);
    setDefaultCurrencyLocal(code); // updates localStorage + broadcasts to open pages
    updatePreferences({ display_currency: code }).then(flashSaved).catch(() => null);
  };

  const handleEmailWeekly = () => {
    if (emailWeekly === null) return;
    const next = !emailWeekly;
    setEmailWeekly(next);
    updatePreferences({ email_weekly_enabled: next }).then(flashSaved).catch(() => setEmailWeekly(!next));
  };

  const handleLogout = () => {
    clearToken();
    router.push("/login");
  };

  const isPaid = plan !== "free";
  const planName = plan === "free" ? t("pricing.freeName") : plan.charAt(0).toUpperCase() + plan.slice(1);

  return (
    <PageLayout title={t("settings.title")} subtitle={t("settings.subtitle")} maxWidth="md">
      {savedFlash && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1.5 px-4 py-2 rounded-lg text-white text-sm shadow-lg shadow-black/20" style={{ backgroundColor: TEAL }}>
          <CheckCircle size={15} /> {t("settings.saved")}
        </div>
      )}

      <div className="space-y-4">
        {/* ── Plan ── */}
        <Section icon={<Sparkles size={16} />} title={t("settings.plan")}>
          <div className="flex items-center justify-between gap-4 py-4 flex-wrap">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-ink text-base font-semibold">{planName}</p>
                {isPaid && (
                  <span className="text-[10px] uppercase tracking-wider text-[#176B5B] bg-[#176B5B]/10 px-2 py-0.5 rounded-full font-semibold">
                    {t("settings.planCurrent")}
                  </span>
                )}
              </div>
              <p className="text-ink-mute text-xs mt-0.5">
                {isPaid ? t("settings.planPaidHint") : t("settings.planFreeHint")}
              </p>
            </div>
            <Link
              href="/upgrade"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-white text-sm font-semibold shadow-sm transition-colors shrink-0"
              style={{ backgroundColor: TEAL }}
            >
              <Sparkles size={15} />
              {isPaid ? t("settings.managePlan") : t("settings.upgradeCta")}
              <ArrowRight size={15} />
            </Link>
          </div>
        </Section>

        {/* ── Preferences ── */}
        <Section icon={<Settings size={16} />} title={t("settings.preferences")}>
          <Row label={t("settings.language")}>
            <div className="flex rounded-lg overflow-hidden border border-line text-xs font-semibold">
              {(["tr", "en"] as const).map((l) => {
                const active = lang === l;
                return (
                  <button
                    key={l}
                    onClick={() => handleLanguage(l)}
                    className={`px-3.5 py-1.5 transition-colors ${active ? "text-white" : "text-ink-mute hover:text-ink-soft"}`}
                    style={active ? { backgroundColor: TEAL } : undefined}
                  >
                    {l.toUpperCase()}
                  </button>
                );
              })}
            </div>
          </Row>
          <Row label={t("settings.currency")} hint={t("settings.currencyHint")} last>
            <div className="w-44"><CurrencySelect value={currency} onChange={handleCurrency} /></div>
          </Row>
        </Section>

        {/* ── Notifications ── */}
        <Section icon={<Mail size={16} />} title={t("settings.notifications")}>
          <Row label={t("settings.weeklyEmail")} hint={t("settings.weeklyEmailHint")} last>
            <button
              onClick={handleEmailWeekly}
              disabled={emailWeekly === null}
              aria-pressed={!!emailWeekly}
              className={`relative w-11 h-6 rounded-full transition-colors shrink-0 disabled:opacity-40 ${emailWeekly ? "" : "bg-surface-2"}`}
              style={emailWeekly ? { backgroundColor: TEAL } : undefined}
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${emailWeekly ? "translate-x-5" : ""}`} />
            </button>
          </Row>
        </Section>

        {/* ── Account ── */}
        <Section icon={<ShieldCheck size={16} />} title={t("settings.account")}>
          <div className="py-4 space-y-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-full text-white text-base font-semibold flex items-center justify-center shrink-0" style={{ backgroundColor: TEAL }}>
                {email?.[0]?.toUpperCase() ?? "?"}
              </div>
              <div className="min-w-0">
                <p className="text-ink text-sm font-medium truncate">{email}</p>
                <p className="text-ink-mute text-xs">{planName} · {t("settings.account")}</p>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-line text-ink-soft hover:text-danger hover:border-danger/40 text-sm font-medium transition-colors"
            >
              <LogOut size={15} /> {t("settings.logout")}
            </button>
          </div>
        </Section>
      </div>
    </PageLayout>
  );
}

// ── presentational pieces ────────────────────────────────────────────────────

function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="bg-surface border border-line rounded-2xl overflow-hidden">
      <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-line">
        <span className="w-8 h-8 rounded-lg bg-brand/10 text-brand flex items-center justify-center shrink-0">{icon}</span>
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
      </div>
      <div className="px-5">{children}</div>
    </section>
  );
}

function Row({ label, hint, children, last }: { label: string; hint?: string; children: ReactNode; last?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-4 py-4 ${last ? "" : "border-b border-line"}`}>
      <div className="min-w-0">
        <p className="text-ink text-sm">{label}</p>
        {hint && <p className="text-ink-mute text-xs mt-0.5">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
