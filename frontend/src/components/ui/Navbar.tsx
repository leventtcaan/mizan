"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { getToken, getStoredUser, setStoredUser, clearToken, updatePreferences, getMe } from "@/lib/api";
import { BarChart2, Upload, LogOut, Menu, X, Scale, Home, Settings, Sparkles, FileText, ShieldCheck } from "@/components/ui/Icons";
import { useLanguage, type Lang } from "@/lib/i18n";
import NotificationDropdown from "@/components/NotificationDropdown";
import CurrencyMenu from "@/components/ui/CurrencyMenu";
import ThemeToggle from "@/components/ui/ThemeToggle";

// "/" (landing) has its own header, so the global navbar stays hidden there —
// otherwise a logged-in visitor to the landing page sees two navbars.
const HIDDEN_PATHS = ["/", "/login", "/onboarding", "/brief", "/verify"];

function PieChartMini() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21.21 15.89A10 10 0 1 1 8 2.83" />
      <path d="M22 12A10 10 0 0 0 12 2v10z" />
    </svg>
  );
}

export default function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const { lang, setLanguage, t } = useLanguage();
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);

  // The money pages (transactions / cashflow / recurring) are unified under one
  // "Money Flow" entry; they share the MoneyTabs sub-nav.
  const MONEY_PATHS = ["/transactions", "/cashflow", "/recurring"];
  // Reports is a top-level destination (the artifact someone replacing Excel wants);
  // the Simulator lives in the account menu as a power-user tool.
  const NAV_LINKS = [
    { href: "/home", label: t("nav.home"), icon: <Home size={16} />, match: ["/home"] },
    { href: "/transactions", label: t("nav.money"), icon: <PieChartMini />, match: MONEY_PATHS },
    { href: "/networth", label: t("nav.networth"), icon: <Scale size={16} />, match: ["/networth"] },
    { href: "/reports", label: t("report.title"), icon: <FileText size={16} />, match: ["/reports"] },
    { href: "/progress", label: t("nav.progress"), icon: <BarChart2 size={16} />, match: ["/progress"] },
  ];

  useEffect(() => {
    const user = getStoredUser();
    if (user && getToken()) {
      setUserEmail(user.email);
      setIsAdmin(Boolean(user.is_admin));
    } else {
      setUserEmail(null);
      setIsAdmin(false);
    }
  }, [pathname]);

  // Reconcile admin status from the server once per mount. Covers sessions created
  // before is_admin existed in the token, and users promoted in the DB after login —
  // otherwise the Admin link never appears for a real admin with a stale stored user.
  useEffect(() => {
    if (!getToken() || !getStoredUser()) return;
    getMe()
      .then((me) => {
        setIsAdmin(me.is_admin);
        const stored = getStoredUser();
        if (stored && stored.is_admin !== me.is_admin) {
          setStoredUser({ ...stored, is_admin: me.is_admin });
        }
      })
      .catch(() => { /* offline / token expired — keep the stored value */ });
  }, []);

  useEffect(() => {
    setMobileOpen(false);
    setAccountOpen(false);
  }, [pathname]);

  // Close the account menu on outside click.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (accountRef.current && !accountRef.current.contains(e.target as Node)) setAccountOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  if (HIDDEN_PATHS.includes(pathname)) return null;
  if (!userEmail) return null;

  const handleLogout = () => {
    clearToken();
    setUserEmail(null);
    router.push("/login");
  };

  const handleLangSwitch = (newLang: Lang) => {
    setLanguage(newLang);
    updatePreferences({ language: newLang }).catch(() => null);
  };

  return (
    <>
      <nav className="fixed top-0 left-0 right-0 z-50 bg-canvas/95 backdrop-blur-md border-b border-line">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
          {/* Logo */}
          <Link href="/home" className="text-ink font-bold text-lg tracking-tight shrink-0">
            Mizan
          </Link>

          {/* Desktop nav links */}
          <div className="hidden md:flex items-center gap-1 flex-1 justify-center">
            {NAV_LINKS.map((link) => {
              const isActive = link.match.some((p) => pathname === p || pathname.startsWith(p + "/"));
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                    isActive
                      ? "text-ink bg-surface-2"
                      : "text-ink-mute hover:text-ink-soft hover:bg-surface"
                  }`}
                >
                  {link.icon}
                  {link.label}
                </Link>
              );
            })}
          </div>

          {/* Right side — theme · currency · notifications · upload · account menu */}
          <div className="hidden md:flex items-center gap-2 shrink-0">
            <ThemeToggle />
            <CurrencyMenu />
            <NotificationDropdown />
            <Link
              href="/upload"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand hover:bg-brand-hover text-sm font-medium text-white transition-colors"
            >
              <Upload size={14} />
              {t("nav.upload")}
            </Link>

            {/* Account menu — folds language, settings, logout, email into one avatar */}
            <div className="relative" ref={accountRef}>
              <button
                onClick={() => setAccountOpen((v) => !v)}
                className="w-8 h-8 rounded-full bg-brand hover:bg-brand-hover text-white text-sm font-semibold flex items-center justify-center transition-colors"
                title={userEmail ?? ""}
              >
                {userEmail?.[0]?.toUpperCase() ?? "?"}
              </button>
              {accountOpen && (
                <div className="absolute right-0 mt-2 w-56 bg-surface border border-line rounded-xl shadow-2xl shadow-black/50 py-2 z-50">
                  <div className="px-3 py-2 border-b border-line">
                    <p className="text-ink-mute text-[10px] uppercase tracking-wider">{t("settings.account")}</p>
                    <p className="text-ink-soft text-sm truncate">{userEmail}</p>
                  </div>
                  <div className="px-3 py-2 flex items-center justify-between">
                    <span className="text-ink-mute text-sm">{t("settings.language")}</span>
                    <div className="flex rounded-lg overflow-hidden border border-line text-xs font-medium">
                      <button onClick={() => handleLangSwitch("tr")} className={`px-2 py-1 transition-colors ${lang === "tr" ? "bg-brand text-white" : "text-ink-mute hover:text-ink-soft"}`}>TR</button>
                      <button onClick={() => handleLangSwitch("en")} className={`px-2 py-1 transition-colors ${lang === "en" ? "bg-brand text-white" : "text-ink-mute hover:text-ink-soft"}`}>EN</button>
                    </div>
                  </div>
                  <Link href="/simulator" className="flex items-center gap-2 px-3 py-2 text-sm text-ink-soft hover:bg-surface transition-colors">
                    <Sparkles size={15} /> {t("nav.simulator")}
                  </Link>
                  <Link href="/settings" className="flex items-center gap-2 px-3 py-2 text-sm text-ink-soft hover:bg-surface transition-colors">
                    <Settings size={15} /> {t("settings.title")}
                  </Link>
                  {isAdmin && (
                    <Link href="/admin" className="flex items-center gap-2 px-3 py-2 text-sm text-amber-300 hover:bg-surface transition-colors">
                      <ShieldCheck size={15} /> Admin
                    </Link>
                  )}
                  <button onClick={handleLogout} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-danger hover:bg-surface transition-colors">
                    <LogOut size={15} /> {t("nav.logout")}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Mobile hamburger */}
          <button
            onClick={() => setMobileOpen((v) => !v)}
            className="md:hidden p-1.5 rounded-lg text-ink-mute hover:text-ink hover:bg-surface-2 transition-colors"
          >
            {mobileOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </nav>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setMobileOpen(false)}
          />
          <div className="absolute top-14 left-0 right-0 bg-canvas border-b border-line px-4 py-4 space-y-1">
            {NAV_LINKS.map((link) => {
              const isActive = link.match.some((p) => pathname === p || pathname.startsWith(p + "/"));
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`flex items-center gap-3 px-3 py-3 rounded-lg text-sm transition-colors ${
                    isActive
                      ? "text-ink bg-surface-2"
                      : "text-ink-soft hover:text-ink hover:bg-surface"
                  }`}
                >
                  {link.icon}
                  {link.label}
                </Link>
              );
            })}
            <Link
              href="/simulator"
              className={`flex items-center gap-3 px-3 py-3 rounded-lg text-sm transition-colors ${pathname === "/simulator" ? "text-ink bg-surface-2" : "text-ink-soft hover:text-ink hover:bg-surface"}`}
            >
              <Sparkles size={16} />
              {t("nav.simulator")}
            </Link>
            <Link
              href="/settings"
              className={`flex items-center gap-3 px-3 py-3 rounded-lg text-sm transition-colors ${pathname === "/settings" ? "text-ink bg-surface-2" : "text-ink-soft hover:text-ink hover:bg-surface"}`}
            >
              <Settings size={16} />
              {t("settings.title")}
            </Link>
            {isAdmin && (
              <Link
                href="/admin"
                className={`flex items-center gap-3 px-3 py-3 rounded-lg text-sm transition-colors ${pathname === "/admin" ? "text-ink bg-surface-2" : "text-amber-300 hover:text-ink hover:bg-surface"}`}
              >
                <ShieldCheck size={16} />
                Admin
              </Link>
            )}
            <div className="pt-3 border-t border-line space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-ink-mute text-xs truncate">{userEmail}</span>
                {/* Currency + notifications — parity with the desktop top bar */}
                <div className="flex items-center gap-2 shrink-0">
                  <CurrencyMenu />
                  <NotificationDropdown />
                </div>
              </div>
              <div className="flex gap-2 items-center">
                {/* Language toggle (mobile) */}
                <div className="flex rounded-lg overflow-hidden border border-line text-xs font-medium">
                  <button
                    onClick={() => handleLangSwitch("tr")}
                    className={`px-2 py-1 ${lang === "tr" ? "bg-brand text-white" : "text-ink-mute"}`}
                  >
                    TR
                  </button>
                  <button
                    onClick={() => handleLangSwitch("en")}
                    className={`px-2 py-1 ${lang === "en" ? "bg-brand text-white" : "text-ink-mute"}`}
                  >
                    EN
                  </button>
                </div>
                <Link
                  href="/upload"
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand text-sm font-medium text-white"
                >
                  <Upload size={14} />
                  {t("nav.upload")}
                </Link>
                <button
                  onClick={handleLogout}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-surface-2 text-sm text-ink-soft"
                >
                  <LogOut size={14} />
                  {t("nav.logout")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
