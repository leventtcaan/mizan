"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import PageLayout from "@/components/ui/PageLayout";
import CurrencySelect from "@/components/CurrencySelect";
import { LogOut } from "@/components/ui/Icons";
import { card, sectionHeading } from "@/lib/design";
import { useLanguage, type Lang } from "@/lib/i18n";
import {
  getToken, getStoredUser, setStoredUser, clearToken, getMe, updatePreferences,
  getDefaultCurrency, setDefaultCurrencyLocal,
} from "@/lib/api";

export default function SettingsPage() {
  const router = useRouter();
  const { lang, setLanguage, t } = useLanguage();

  const [email, setEmail] = useState<string>("");
  const [currency, setCurrency] = useState<string>("TRY");
  const [emailWeekly, setEmailWeekly] = useState<boolean | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    if (!getToken() || !getStoredUser()) { router.replace("/login"); return; }
    setEmail(getStoredUser()?.email ?? "");
    setCurrency(getDefaultCurrency());
    getMe()
      .then((me) => {
        setEmail(me.email);
        setCurrency(me.display_currency || "TRY");
        setEmailWeekly(me.email_weekly_enabled);
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

  return (
    <PageLayout title={t("settings.title")} subtitle={t("settings.subtitle")} maxWidth="md">
      {savedFlash && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg bg-emerald-950/80 border border-emerald-800 text-emerald-300 text-sm">
          {t("settings.saved")}
        </div>
      )}

      <div className="space-y-4">
        {/* Preferences */}
        <section className={card}>
          <p className={`${sectionHeading} mb-4`}>{t("settings.preferences")}</p>

          {/* Language */}
          <div className="flex items-center justify-between gap-4 mb-5">
            <span className="text-ink text-sm">{t("settings.language")}</span>
            <div className="flex rounded-lg overflow-hidden border border-line text-xs font-medium">
              <button onClick={() => handleLanguage("tr")} className={`px-3 py-1.5 transition-colors ${lang === "tr" ? "bg-brand text-white" : "text-ink-mute hover:text-ink-soft"}`}>TR</button>
              <button onClick={() => handleLanguage("en")} className={`px-3 py-1.5 transition-colors ${lang === "en" ? "bg-brand text-white" : "text-ink-mute hover:text-ink-soft"}`}>EN</button>
            </div>
          </div>

          {/* Default currency */}
          <div>
            <div className="flex items-center justify-between gap-4 mb-1.5">
              <span className="text-ink text-sm">{t("settings.currency")}</span>
              <div className="w-44"><CurrencySelect value={currency} onChange={handleCurrency} /></div>
            </div>
            <p className="text-ink-mute text-xs">{t("settings.currencyHint")}</p>
          </div>
        </section>

        {/* Notifications */}
        <section className={card}>
          <p className={`${sectionHeading} mb-4`}>{t("settings.notifications")}</p>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-ink text-sm">{t("settings.weeklyEmail")}</p>
              <p className="text-ink-mute text-xs">{t("settings.weeklyEmailHint")}</p>
            </div>
            <button
              onClick={handleEmailWeekly}
              disabled={emailWeekly === null}
              className={`relative w-10 h-5 rounded-full transition-colors shrink-0 disabled:opacity-40 ${emailWeekly ? "bg-brand" : "bg-surface-2"}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${emailWeekly ? "translate-x-5" : ""}`} />
            </button>
          </div>
        </section>

        {/* Account */}
        <section className={card}>
          <p className={`${sectionHeading} mb-4`}>{t("settings.account")}</p>
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-ink-mute text-xs">{t("settings.email")}</p>
              <p className="text-ink text-sm truncate">{email}</p>
            </div>
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-line text-ink-mute hover:text-red-300 hover:border-red-900 text-sm transition-colors shrink-0"
            >
              <LogOut size={15} /> {t("settings.logout")}
            </button>
          </div>
        </section>
      </div>
    </PageLayout>
  );
}
