"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import PageLayout from "@/components/ui/PageLayout";
import CurrencySelect from "@/components/CurrencySelect";
import ReferralCard from "@/components/ReferralCard";
import { LogOut, Sparkles, ArrowRight, Settings, Mail, ShieldCheck, CheckCircle, Briefcase } from "@/components/ui/Icons";
import { useLanguage, type Lang } from "@/lib/i18n";
import {
  getToken, getStoredUser, setStoredUser, clearToken, getMe, updatePreferences, deleteMyAccount,
  getDefaultCurrency, setDefaultCurrencyLocal, changePassword, INDUSTRIES, TEAM_SIZES,
  getBillingSubscription, cancelSubscription, type BillingSubscription,
} from "@/lib/api";

const TEAL = "#176B5B";
const inputCls =
  "w-full bg-canvas border border-line rounded-lg px-3 py-2.5 text-ink text-sm placeholder:text-ink-mute focus:outline-none focus:border-[#176B5B] focus:ring-2 focus:ring-[#176B5B]/20 transition-shadow";

// Common dialing codes for the phone selector (flag + code keeps the trigger compact).
const DIAL_CODES: { iso: string; code: string }[] = [
  { iso: "TR", code: "+90" }, { iso: "US", code: "+1" }, { iso: "GB", code: "+44" },
  { iso: "DE", code: "+49" }, { iso: "FR", code: "+33" }, { iso: "NL", code: "+31" },
  { iso: "ES", code: "+34" }, { iso: "IT", code: "+39" }, { iso: "CH", code: "+41" },
  { iso: "SE", code: "+46" }, { iso: "AT", code: "+43" }, { iso: "BE", code: "+32" },
  { iso: "IE", code: "+353" }, { iso: "PT", code: "+351" }, { iso: "GR", code: "+30" },
  { iso: "PL", code: "+48" }, { iso: "NO", code: "+47" }, { iso: "DK", code: "+45" },
  { iso: "FI", code: "+358" }, { iso: "AE", code: "+971" }, { iso: "SA", code: "+966" },
  { iso: "AZ", code: "+994" }, { iso: "RU", code: "+7" }, { iso: "IN", code: "+91" },
  { iso: "CN", code: "+86" }, { iso: "JP", code: "+81" }, { iso: "KR", code: "+82" },
  { iso: "BR", code: "+55" }, { iso: "MX", code: "+52" }, { iso: "CA", code: "+1" },
  { iso: "AU", code: "+61" },
];

function isoToFlag(iso: string): string {
  try {
    return String.fromCodePoint(...[...iso.toUpperCase()].map((c) => 127397 + c.charCodeAt(0)));
  } catch { return ""; }
}

function splitPhone(full: string): { dial: string; number: string } {
  const s = (full || "").trim();
  for (const d of [...DIAL_CODES].sort((a, b) => b.code.length - a.code.length)) {
    if (s.startsWith(d.code)) return { dial: d.code, number: s.slice(d.code.length).trim() };
  }
  return { dial: "", number: s.replace(/^\+/, "").trim() };
}

type Profile = {
  name: string; phoneDial: string; phoneNumber: string;
  accountType: "personal" | "business";
  companyName: string; industry: string; teamSize: string;
};

const EMPTY_PROFILE: Profile = {
  name: "", phoneDial: "+90", phoneNumber: "",
  accountType: "personal", companyName: "", industry: "", teamSize: "",
};

export default function SettingsPage() {
  const router = useRouter();
  const { lang, setLanguage, t } = useLanguage();

  const [email, setEmail] = useState<string>("");
  const [currency, setCurrency] = useState<string>("TRY");
  const [emailWeekly, setEmailWeekly] = useState<boolean | null>(null);
  const [plan, setPlan] = useState<string>("free");
  const [savedFlash, setSavedFlash] = useState(false);

  // Billing (Paddle subscription state)
  const [sub, setSub] = useState<BillingSubscription | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelNote, setCancelNote] = useState<string | null>(null);

  // Profile: `loaded` is the canonical saved state; `draft` is what the edit form mutates.
  const [loaded, setLoaded] = useState<Profile>(EMPTY_PROFILE);
  const [draft, setDraft] = useState<Profile>(EMPTY_PROFILE);
  const [editingProfile, setEditingProfile] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);

  // Password change (collapsed behind a button)
  const [pwOpen, setPwOpen] = useState(false);
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);

  useEffect(() => {
    if (!getToken() || !getStoredUser()) { router.replace("/login"); return; }
    const su = getStoredUser();
    setEmail(su?.email ?? "");
    setCurrency(getDefaultCurrency());
    setPlan(su?.plan ?? "free");
    getBillingSubscription().then(setSub).catch(() => null);
    getMe()
      .then((me) => {
        setEmail(me.email);
        setCurrency(me.display_currency || "TRY");
        setEmailWeekly(me.email_weekly_enabled);
        setPlan(me.plan || "free");

        const { dial, number } = splitPhone(me.phone ?? "");
        const defaultDial = DIAL_CODES.find((d) => d.iso === (me.country || "").toUpperCase())?.code || "+90";
        const p: Profile = {
          name: me.full_name ?? "",
          phoneDial: dial || defaultDial,
          phoneNumber: number,
          accountType: (me.account_type as "personal" | "business") ?? "personal",
          companyName: me.company_name ?? "",
          industry: me.industry ?? "",
          teamSize: me.team_size ?? "",
        };
        setLoaded(p); setDraft(p);

        // keep localStorage in sync with server truth
        const u = getStoredUser();
        if (u) setStoredUser({
          ...u, display_currency: me.display_currency, language: me.language,
          display_name: me.full_name ?? undefined,
          account_type: p.accountType,
          company_name: me.company_name ?? undefined, industry: me.industry ?? undefined,
          team_size: me.team_size ?? undefined, phone: me.phone ?? undefined,
        });
      })
      .catch(() => null);
  }, [router]);

  const flashSaved = () => { setSavedFlash(true); setTimeout(() => setSavedFlash(false), 1800); };

  const startEdit = () => { setDraft(loaded); setEditingProfile(true); };
  const cancelEdit = () => { setDraft(loaded); setEditingProfile(false); };

  const handleSaveProfile = async () => {
    setProfileSaving(true);
    try {
      const isBiz = draft.accountType === "business";
      const phone = draft.phoneNumber.trim() ? `${draft.phoneDial} ${draft.phoneNumber.trim()}` : "";
      await updatePreferences({
        full_name: draft.name.trim(),
        phone,
        account_type: draft.accountType,
        company_name: isBiz ? draft.companyName.trim() : "",
        industry: isBiz ? draft.industry : "",
        team_size: isBiz ? draft.teamSize : "",
      });
      setLoaded(draft);
      setEditingProfile(false);
      const u = getStoredUser();
      if (u) setStoredUser({
        ...u, display_name: draft.name.trim() || undefined, account_type: draft.accountType,
        company_name: isBiz ? (draft.companyName.trim() || undefined) : undefined,
        industry: isBiz ? (draft.industry || undefined) : undefined,
        team_size: isBiz ? (draft.teamSize || undefined) : undefined,
        phone: phone || undefined,
      });
      flashSaved();
    } catch { /* surfaced minimally */ }
    finally { setProfileSaving(false); }
  };

  const closePassword = () => {
    setPwOpen(false); setCurPw(""); setNewPw(""); setConfirmPw(""); setPwError(null);
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwError(null);
    if (newPw !== confirmPw) { setPwError(t("settings.passwordMismatch")); return; }
    setPwSaving(true);
    try {
      await changePassword(curPw, newPw);
      closePassword();
      flashSaved();
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
    setDefaultCurrencyLocal(code);
    updatePreferences({ display_currency: code }).then(flashSaved).catch(() => null);
  };

  const handleEmailWeekly = () => {
    if (emailWeekly === null) return;
    const next = !emailWeekly;
    setEmailWeekly(next);
    updatePreferences({ email_weekly_enabled: next }).then(flashSaved).catch(() => setEmailWeekly(!next));
  };

  const handleCancelSubscription = async () => {
    if (cancelling) return;
    if (!confirm(t("settings.cancelConfirm"))) return;
    setCancelNote(null);
    setCancelling(true);
    try {
      const r = await cancelSubscription();
      setCancelNote(r.message || t("settings.cancelScheduled"));
      getBillingSubscription().then(setSub).catch(() => null);
    } catch (err) {
      setCancelNote(err instanceof Error ? err.message : t("common.error"));
    } finally { setCancelling(false); }
  };

  const fmtRenewal = (iso: string | null): string => {
    if (!iso) return "—";
    try { return new Date(iso).toLocaleDateString(lang === "tr" ? "tr-TR" : "en-US", { year: "numeric", month: "long", day: "numeric" }); }
    catch { return iso; }
  };

  const handleLogout = () => { clearToken(); router.push("/login"); };

  // Danger zone — account deletion (password re-entry required; 30-day recovery window).
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const handleDeleteAccount = async () => {
    if (!deletePassword || deleteBusy) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await deleteMyAccount(deletePassword);
      clearToken();
      router.push("/");
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : t("common.error"));
      setDeleteBusy(false);
    }
  };

  const isPaid = plan !== "free";
  const planName = plan === "free" ? t("pricing.freeName") : plan.charAt(0).toUpperCase() + plan.slice(1);
  const initials = (loaded.name.trim() ? loaded.name.trim()[0] : email[0] || "?").toUpperCase();
  const industryLabel = (v: string) => { const o = INDUSTRIES.find((x) => x.value === v); return o ? (lang === "tr" ? o.tr : o.en) : ""; };
  const teamLabel = (v: string) => { const o = TEAM_SIZES.find((x) => x.value === v); return o ? (lang === "tr" ? o.tr : o.en) : ""; };
  const loadedPhone = loaded.phoneNumber.trim() ? `${loaded.phoneDial} ${loaded.phoneNumber.trim()}` : "";

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
              <p className="text-ink-mute text-xs mt-0.5">{isPaid ? t("settings.planPaidHint") : t("settings.planFreeHint")}</p>
            </div>
            <Link href="/upgrade" className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-white text-sm font-semibold shadow-sm transition-colors shrink-0" style={{ backgroundColor: TEAL }}>
              <Sparkles size={15} />{isPaid ? t("settings.managePlan") : t("settings.upgradeCta")}<ArrowRight size={15} />
            </Link>
          </div>

          {/* Renewal + cancel (only for an active Paddle subscription) */}
          {isPaid && sub?.next_renewal && (
            <div className="flex items-center justify-between gap-4 py-4 border-t border-line flex-wrap">
              <div className="min-w-0">
                <p className="text-ink-mute text-xs uppercase tracking-wide">{t("settings.nextRenewal")}</p>
                <p className="text-ink text-sm font-medium mt-0.5">{fmtRenewal(sub.next_renewal)}</p>
                {cancelNote && <p className="text-ink-mute text-xs mt-1.5">{cancelNote}</p>}
              </div>
              {sub.manageable && (
                <button onClick={handleCancelSubscription} disabled={cancelling}
                  className="px-3.5 py-2 rounded-lg border border-line text-ink-soft hover:text-danger hover:border-danger/40 text-sm font-medium transition-colors disabled:opacity-50 shrink-0">
                  {cancelling ? t("common.loading") : t("settings.cancelPlan")}
                </button>
              )}
            </div>
          )}
        </Section>

        {/* ── Invite a friend — referral program (prominent, reward-framed) ── */}
        <ReferralCard variant="settings" />

        {/* ── Profile (read-only by default, Edit toggles the form) ── */}
        <Section
          icon={<Briefcase size={16} />}
          title={t("settings.profile")}
          hint={t("settings.profileHint")}
          action={!editingProfile ? (
            <GhostButton onClick={startEdit}>{t("settings.edit")}</GhostButton>
          ) : null}
        >
          {!editingProfile ? (
            <div className="py-2">
              {/* Identity */}
              <div className="flex items-center gap-3 py-3 border-b border-line">
                <div className="w-11 h-11 rounded-full text-white text-base font-semibold flex items-center justify-center shrink-0" style={{ backgroundColor: TEAL }}>{initials}</div>
                <div className="min-w-0">
                  <p className="text-ink text-sm font-semibold truncate">{loaded.name.trim() || t("settings.notSet")}</p>
                  <p className="text-ink-mute text-xs truncate">{email}</p>
                </div>
              </div>
              <ReadRow label={t("settings.phone")} value={loadedPhone} t={t} />
              <ReadRow label={t("settings.accountType")} value={t(`settings.${loaded.accountType}`)} t={t} last={loaded.accountType !== "business"} />
              {loaded.accountType === "business" && (
                <>
                  <ReadRow label={t("settings.company")} value={loaded.companyName} t={t} />
                  <ReadRow label={t("settings.industry")} value={industryLabel(loaded.industry)} t={t} />
                  <ReadRow label={t("settings.teamSize")} value={teamLabel(loaded.teamSize)} t={t} last />
                </>
              )}
            </div>
          ) : (
            <div className="py-4 space-y-4">
              <FieldLabel label={t("settings.name")}>
                <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder={t("settings.namePlaceholder")} className={inputCls} autoFocus />
              </FieldLabel>

              <FieldLabel label={t("settings.email")}>
                <input value={email} disabled className={`${inputCls} opacity-60 cursor-not-allowed`} />
              </FieldLabel>

              <FieldLabel label={t("settings.phone")} optional={t("common.optional")}>
                <div className="flex gap-2">
                  <select
                    value={draft.phoneDial}
                    onChange={(e) => setDraft({ ...draft, phoneDial: e.target.value })}
                    className={`${inputCls} w-28 shrink-0 tabular-nums`}
                    aria-label={t("settings.phone")}
                  >
                    {DIAL_CODES.map((d) => (
                      <option key={`${d.iso}${d.code}`} value={d.code}>{isoToFlag(d.iso)} {d.code}</option>
                    ))}
                  </select>
                  <input
                    type="tel" inputMode="tel"
                    value={draft.phoneNumber}
                    onChange={(e) => setDraft({ ...draft, phoneNumber: e.target.value })}
                    placeholder={t("settings.phoneNumber")}
                    className={inputCls}
                  />
                </div>
              </FieldLabel>

              <FieldLabel label={t("settings.accountType")}>
                <div className="flex rounded-lg overflow-hidden border border-line text-xs font-semibold w-fit">
                  {(["personal", "business"] as const).map((at) => (
                    <button key={at} type="button" onClick={() => setDraft({ ...draft, accountType: at })}
                      className={`px-4 py-2 transition-colors ${draft.accountType === at ? "text-white" : "text-ink-mute hover:text-ink-soft"}`}
                      style={draft.accountType === at ? { backgroundColor: TEAL } : undefined}>
                      {t(`settings.${at}`)}
                    </button>
                  ))}
                </div>
              </FieldLabel>

              {draft.accountType === "business" && (
                <div className="space-y-4 rounded-xl bg-canvas border border-line p-4">
                  <FieldLabel label={t("settings.company")}>
                    <input value={draft.companyName} onChange={(e) => setDraft({ ...draft, companyName: e.target.value })} className={inputCls} />
                  </FieldLabel>
                  <div className="grid grid-cols-2 gap-3">
                    <FieldLabel label={t("settings.industry")}>
                      <select value={draft.industry} onChange={(e) => setDraft({ ...draft, industry: e.target.value })} className={inputCls}>
                        <option value="">—</option>
                        {INDUSTRIES.map((o) => <option key={o.value} value={o.value}>{lang === "tr" ? o.tr : o.en}</option>)}
                      </select>
                    </FieldLabel>
                    <FieldLabel label={t("settings.teamSize")}>
                      <select value={draft.teamSize} onChange={(e) => setDraft({ ...draft, teamSize: e.target.value })} className={inputCls}>
                        <option value="">—</option>
                        {TEAM_SIZES.map((o) => <option key={o.value} value={o.value}>{lang === "tr" ? o.tr : o.en}</option>)}
                      </select>
                    </FieldLabel>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2 pt-1">
                <button onClick={handleSaveProfile} disabled={profileSaving}
                  className="px-4 py-2 rounded-lg text-white text-sm font-semibold shadow-sm transition-colors disabled:opacity-50" style={{ backgroundColor: TEAL }}>
                  {profileSaving ? t("common.loading") : t("settings.save")}
                </button>
                <button onClick={cancelEdit} disabled={profileSaving}
                  className="px-4 py-2 rounded-lg border border-line text-ink-soft hover:bg-surface-2 text-sm font-medium transition-colors disabled:opacity-50">
                  {t("common.cancel")}
                </button>
              </div>
            </div>
          )}
        </Section>

        {/* ── Preferences ── (overflowVisible so the currency dropdown isn't clipped) */}
        <Section icon={<Settings size={16} />} title={t("settings.preferences")} overflowVisible>
          <Row label={t("settings.language")}>
            <div className="flex rounded-lg overflow-hidden border border-line text-xs font-semibold">
              {(["tr", "en"] as const).map((l) => (
                <button key={l} onClick={() => handleLanguage(l)}
                  className={`px-3.5 py-1.5 transition-colors ${lang === l ? "text-white" : "text-ink-mute hover:text-ink-soft"}`}
                  style={lang === l ? { backgroundColor: TEAL } : undefined}>
                  {l.toUpperCase()}
                </button>
              ))}
            </div>
          </Row>
          <Row label={t("settings.currency")} hint={t("settings.currencyHint")} last>
            <div className="w-44"><CurrencySelect value={currency} onChange={handleCurrency} /></div>
          </Row>
        </Section>

        {/* ── Notifications ── */}
        <Section icon={<Mail size={16} />} title={t("settings.notifications")}>
          <Row label={t("settings.weeklyEmail")} hint={t("settings.weeklyEmailHint")} last>
            <button onClick={handleEmailWeekly} disabled={emailWeekly === null} aria-pressed={!!emailWeekly}
              className={`relative w-11 h-6 rounded-full transition-colors shrink-0 disabled:opacity-40 ${emailWeekly ? "" : "bg-surface-2"}`}
              style={emailWeekly ? { backgroundColor: TEAL } : undefined}>
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${emailWeekly ? "translate-x-5" : ""}`} />
            </button>
          </Row>
        </Section>

        {/* ── Security (password change collapsed behind a button) ── */}
        <Section
          icon={<ShieldCheck size={16} />}
          title={t("settings.security")}
          hint={t("settings.securityHint")}
          action={!pwOpen ? (
            <GhostButton onClick={() => { setPwError(null); setPwOpen(true); }}>{t("settings.changePassword")}</GhostButton>
          ) : null}
        >
          {!pwOpen ? (
            <div className="flex items-center justify-between py-4">
              <div className="min-w-0">
                <p className="text-ink text-sm">{t("settings.passwordSet")}</p>
                <p className="text-ink-mute text-xs mt-0.5 tracking-widest">••••••••</p>
              </div>
            </div>
          ) : (
            <form onSubmit={handleChangePassword} className="py-4 space-y-3">
              <input type="password" autoComplete="current-password" value={curPw} onChange={(e) => setCurPw(e.target.value)} placeholder={t("settings.currentPassword")} className={inputCls} required autoFocus />
              <input type="password" autoComplete="new-password" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder={t("settings.newPassword")} className={inputCls} required minLength={8} />
              <input type="password" autoComplete="new-password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} placeholder={t("settings.confirmPassword")} className={inputCls} required minLength={8} />
              <p className="text-ink-mute text-xs">{t("settings.passwordHint")}</p>
              {pwError && <p className="text-danger text-xs">{pwError}</p>}
              <div className="flex items-center gap-2 pt-1">
                <button type="submit" disabled={pwSaving || !curPw || !newPw || !confirmPw}
                  className="px-4 py-2 rounded-lg text-white text-sm font-semibold shadow-sm transition-colors disabled:opacity-50" style={{ backgroundColor: TEAL }}>
                  {pwSaving ? t("common.loading") : t("settings.changePassword")}
                </button>
                <button type="button" onClick={closePassword} disabled={pwSaving}
                  className="px-4 py-2 rounded-lg border border-line text-ink-soft hover:bg-surface-2 text-sm font-medium transition-colors disabled:opacity-50">
                  {t("common.cancel")}
                </button>
              </div>
            </form>
          )}
        </Section>

        {/* ── Account ── */}
        <Section icon={<ShieldCheck size={16} />} title={t("settings.account")}>
          <div className="py-4 space-y-4">
            <button onClick={handleLogout}
              className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-line text-ink-soft hover:text-danger hover:border-danger/40 text-sm font-medium transition-colors">
              <LogOut size={15} /> {t("settings.logout")}
            </button>

            {/* Danger zone — GDPR deletion with a 30-day recovery window */}
            <div className="border-t border-line pt-4">
              {!deleteOpen ? (
                <button onClick={() => setDeleteOpen(true)}
                  className="text-danger text-xs font-medium hover:underline">
                  {t("settings.deleteAccount")}
                </button>
              ) : (
                <div className="rounded-xl border border-danger/30 bg-danger/5 p-4 space-y-3">
                  <p className="text-ink text-sm font-semibold">{t("settings.deleteTitle")}</p>
                  <p className="text-ink-soft text-xs leading-relaxed">{t("settings.deleteExplain")}</p>
                  <input
                    type="password" autoComplete="current-password" value={deletePassword}
                    onChange={(e) => setDeletePassword(e.target.value)}
                    placeholder={t("settings.deletePasswordPh")}
                    className="w-full bg-canvas border border-line rounded-lg px-3 py-2 text-sm text-ink placeholder:text-ink-mute focus:outline-none focus:border-danger"
                  />
                  {deleteError && <p className="text-danger text-xs">{deleteError}</p>}
                  <div className="flex gap-2">
                    <button onClick={handleDeleteAccount} disabled={!deletePassword || deleteBusy}
                      className="px-4 py-2 rounded-lg bg-danger text-white text-xs font-semibold hover:opacity-90 transition-opacity disabled:opacity-50">
                      {deleteBusy ? "…" : t("settings.deleteConfirm")}
                    </button>
                    <button onClick={() => { setDeleteOpen(false); setDeletePassword(""); setDeleteError(null); }}
                      className="px-4 py-2 rounded-lg border border-line text-ink-soft text-xs font-medium hover:bg-surface-2 transition-colors">
                      {t("common.cancel")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </Section>
      </div>
    </PageLayout>
  );
}

// ── presentational pieces ────────────────────────────────────────────────────

function Section({ icon, title, hint, action, children, overflowVisible }: {
  icon: ReactNode; title: string; hint?: string; action?: ReactNode; children: ReactNode; overflowVisible?: boolean;
}) {
  return (
    <section className={`bg-surface border border-line rounded-2xl ${overflowVisible ? "" : "overflow-hidden"}`}>
      <div className="flex items-center gap-3 px-5 py-3.5 border-b border-line">
        <span className="w-8 h-8 rounded-lg bg-brand/10 text-brand flex items-center justify-center shrink-0">{icon}</span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-ink leading-tight">{title}</h2>
          {hint && <p className="text-ink-mute text-xs mt-0.5 truncate">{hint}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      <div className="px-5">{children}</div>
    </section>
  );
}

function GhostButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick}
      className="px-3 py-1.5 rounded-lg border border-line text-ink-soft hover:text-ink hover:border-[#176B5B]/50 text-xs font-medium transition-colors">
      {children}
    </button>
  );
}

function ReadRow({ label, value, t, last }: { label: string; value: string; t: (k: string) => string; last?: boolean }) {
  return (
    <div className={`flex items-start justify-between gap-4 py-3 ${last ? "" : "border-b border-line"}`}>
      <span className="text-ink-mute text-xs uppercase tracking-wide pt-0.5 shrink-0">{label}</span>
      <span className={`text-sm text-right break-words ${value ? "text-ink font-medium" : "text-ink-mute"}`}>{value || t("settings.notSet")}</span>
    </div>
  );
}

function FieldLabel({ label, optional, children }: { label: string; optional?: string; children: ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-ink-mute mb-1.5">
        {label}{optional && <span className="text-ink-mute/70"> · {optional}</span>}
      </label>
      {children}
    </div>
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
