"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import PageLayout from "@/components/ui/PageLayout";
import CurrencySelect from "@/components/CurrencySelect";
import { LogOut, Sparkles, ArrowRight, Settings, Mail, ShieldCheck, CheckCircle, Briefcase } from "@/components/ui/Icons";
import { useLanguage, type Lang } from "@/lib/i18n";
import {
  getToken, getStoredUser, setStoredUser, clearToken, getMe, updatePreferences,
  getDefaultCurrency, setDefaultCurrencyLocal, changePassword, INDUSTRIES, TEAM_SIZES,
} from "@/lib/api";

const TEAL = "#176B5B";
const inputCls =
  "w-full bg-canvas border border-line rounded-lg px-3 py-2 text-ink text-sm placeholder:text-ink-mute focus:outline-none focus:border-[#176B5B] focus:ring-2 focus:ring-[#176B5B]/20 transition-shadow";

export default function SettingsPage() {
  const router = useRouter();
  const { lang, setLanguage, t } = useLanguage();

  const [email, setEmail] = useState<string>("");
  const [currency, setCurrency] = useState<string>("TRY");
  const [emailWeekly, setEmailWeekly] = useState<boolean | null>(null);
  const [plan, setPlan] = useState<string>("free");
  const [savedFlash, setSavedFlash] = useState(false);

  // Profile
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [accountType, setAccountType] = useState<"personal" | "business">("personal");
  const [companyName, setCompanyName] = useState("");
  const [industry, setIndustry] = useState("");
  const [teamSize, setTeamSize] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);

  // Password change
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwDone, setPwDone] = useState(false);

  useEffect(() => {
    if (!getToken() || !getStoredUser()) { router.replace("/login"); return; }
    const su = getStoredUser();
    setEmail(su?.email ?? "");
    setCurrency(getDefaultCurrency());
    setPlan(su?.plan ?? "free");
    setName(su?.display_name ?? "");
    setAccountType(su?.account_type ?? "personal");
    getMe()
      .then((me) => {
        setEmail(me.email);
        setCurrency(me.display_currency || "TRY");
        setEmailWeekly(me.email_weekly_enabled);
        setPlan(me.plan || "free");
        setName(me.full_name ?? "");
        setPhone(me.phone ?? "");
        setAccountType((me.account_type as "personal" | "business") ?? "personal");
        setCompanyName(me.company_name ?? "");
        setIndustry(me.industry ?? "");
        setTeamSize(me.team_size ?? "");
        // keep localStorage in sync with server truth
        const u = getStoredUser();
        if (u) setStoredUser({
          ...u, display_currency: me.display_currency, language: me.language,
          display_name: me.full_name ?? undefined,
          account_type: (me.account_type as "personal" | "business") ?? u.account_type,
          company_name: me.company_name ?? undefined, industry: me.industry ?? undefined,
          team_size: me.team_size ?? undefined, phone: me.phone ?? undefined,
        });
      })
      .catch(() => null);
  }, [router]);

  const flashSaved = () => { setSavedFlash(true); setTimeout(() => setSavedFlash(false), 1800); };

  const handleSaveProfile = async () => {
    setProfileSaving(true);
    try {
      const isBiz = accountType === "business";
      await updatePreferences({
        full_name: name.trim(),
        phone: phone.trim() || "",
        account_type: accountType,
        company_name: isBiz ? (companyName.trim() || "") : "",
        industry: isBiz ? (industry || "") : "",
        team_size: isBiz ? (teamSize || "") : "",
      });
      const u = getStoredUser();
      if (u) setStoredUser({
        ...u, display_name: name.trim() || undefined, account_type: accountType,
        company_name: isBiz ? (companyName.trim() || undefined) : undefined,
        industry: isBiz ? (industry || undefined) : undefined,
        team_size: isBiz ? (teamSize || undefined) : undefined,
        phone: phone.trim() || undefined,
      });
      flashSaved();
    } catch { /* surfaced minimally */ }
    finally { setProfileSaving(false); }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwError(null); setPwDone(false);
    if (newPw !== confirmPw) { setPwError(t("settings.passwordMismatch")); return; }
    setPwSaving(true);
    try {
      await changePassword(curPw, newPw);
      setPwDone(true); setCurPw(""); setNewPw(""); setConfirmPw("");
    } catch (err) {
      setPwError(err instanceof Error ? err.message : t("common.error"));
    } finally { setPwSaving(false); }
  };

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

        {/* ── Profile ── */}
        <Section icon={<Briefcase size={16} />} title={t("settings.profile")}>
          <div className="py-4 space-y-4">
            <div>
              <label className="block text-xs text-ink-mute mb-1.5">{t("settings.name")}</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("settings.namePlaceholder")} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs text-ink-mute mb-1.5">{t("settings.email")}</label>
              <input value={email} disabled className={`${inputCls} opacity-70 cursor-not-allowed`} />
            </div>
            <div>
              <label className="block text-xs text-ink-mute mb-1.5">{t("settings.phone")} <span className="text-ink-mute/70">· {t("common.optional")}</span></label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" placeholder="+90 ..." className={inputCls} />
            </div>

            <div>
              <label className="block text-xs text-ink-mute mb-1.5">{t("settings.accountType")}</label>
              <div className="flex rounded-lg overflow-hidden border border-line text-xs font-semibold w-fit">
                {(["personal", "business"] as const).map((at) => (
                  <button key={at} type="button" onClick={() => setAccountType(at)}
                    className={`px-3.5 py-1.5 transition-colors ${accountType === at ? "text-white" : "text-ink-mute hover:text-ink-soft"}`}
                    style={accountType === at ? { backgroundColor: TEAL } : undefined}>
                    {t(`settings.${at}`)}
                  </button>
                ))}
              </div>
            </div>

            {accountType === "business" && (
              <div className="space-y-4 rounded-xl border border-line p-3">
                <div>
                  <label className="block text-xs text-ink-mute mb-1.5">{t("settings.company")}</label>
                  <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} className={inputCls} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-ink-mute mb-1.5">{t("settings.industry")}</label>
                    <select value={industry} onChange={(e) => setIndustry(e.target.value)} className={inputCls}>
                      <option value="">—</option>
                      {INDUSTRIES.map((o) => <option key={o.value} value={o.value}>{lang === "tr" ? o.tr : o.en}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-ink-mute mb-1.5">{t("settings.teamSize")}</label>
                    <select value={teamSize} onChange={(e) => setTeamSize(e.target.value)} className={inputCls}>
                      <option value="">—</option>
                      {TEAM_SIZES.map((o) => <option key={o.value} value={o.value}>{lang === "tr" ? o.tr : o.en}</option>)}
                    </select>
                  </div>
                </div>
              </div>
            )}

            <button onClick={handleSaveProfile} disabled={profileSaving}
              className="px-4 py-2 rounded-lg text-white text-sm font-semibold shadow-sm transition-colors disabled:opacity-50"
              style={{ backgroundColor: TEAL }}>
              {profileSaving ? t("common.loading") : t("settings.save")}
            </button>
          </div>
        </Section>

        {/* ── Preferences ── (overflowVisible so the currency dropdown isn't clipped) */}
        <Section icon={<Settings size={16} />} title={t("settings.preferences")} overflowVisible>
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

        {/* ── Security ── */}
        <Section icon={<ShieldCheck size={16} />} title={t("settings.security")}>
          <form onSubmit={handleChangePassword} className="py-4 space-y-3">
            <p className="text-ink text-sm font-medium">{t("settings.changePassword")}</p>
            <input type="password" autoComplete="current-password" value={curPw} onChange={(e) => setCurPw(e.target.value)}
              placeholder={t("settings.currentPassword")} className={inputCls} required />
            <input type="password" autoComplete="new-password" value={newPw} onChange={(e) => setNewPw(e.target.value)}
              placeholder={t("settings.newPassword")} className={inputCls} required minLength={8} />
            <input type="password" autoComplete="new-password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)}
              placeholder={t("settings.confirmPassword")} className={inputCls} required minLength={8} />
            <p className="text-ink-mute text-xs">{t("settings.passwordHint")}</p>
            {pwError && <p className="text-danger text-xs">{pwError}</p>}
            {pwDone && <p className="text-pos text-xs font-medium">{t("settings.passwordChanged")}</p>}
            <button type="submit" disabled={pwSaving || !curPw || !newPw || !confirmPw}
              className="px-4 py-2 rounded-lg text-white text-sm font-semibold shadow-sm transition-colors disabled:opacity-50"
              style={{ backgroundColor: TEAL }}>
              {pwSaving ? t("common.loading") : t("settings.changePassword")}
            </button>
          </form>
        </Section>

        {/* ── Account ── */}
        <Section icon={<ShieldCheck size={16} />} title={t("settings.account")}>
          <div className="py-4 space-y-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-full text-white text-base font-semibold flex items-center justify-center shrink-0" style={{ backgroundColor: TEAL }}>
                {(name.trim() ? name.trim()[0] : email[0] || "?").toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="text-ink text-sm font-medium truncate">{name.trim() || email}</p>
                <p className="text-ink-mute text-xs truncate">{name.trim() ? email : `${planName} · ${t("settings.account")}`}</p>
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

function Section({ icon, title, children, overflowVisible }: { icon: ReactNode; title: string; children: ReactNode; overflowVisible?: boolean }) {
  return (
    <section className={`bg-surface border border-line rounded-2xl ${overflowVisible ? "" : "overflow-hidden"}`}>
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
