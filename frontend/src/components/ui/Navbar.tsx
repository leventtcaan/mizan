"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { getToken, getStoredUser, clearToken, updatePreferences } from "@/lib/api";
import { BarChart2, Upload, LogOut, Menu, X, Scale, Home, Settings, Sparkles, FileText, ShieldCheck } from "@/components/ui/Icons";
import { useLanguage, type Lang } from "@/lib/i18n";
import NotificationDropdown from "@/components/NotificationDropdown";
import CurrencyMenu from "@/components/ui/CurrencyMenu";

const HIDDEN_PATHS = ["/login", "/onboarding", "/brief"];

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
      <nav className="fixed top-0 left-0 right-0 z-50 bg-[#0A0A0A]/95 backdrop-blur-md border-b border-[#2A2A2A]">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
          {/* Logo */}
          <Link href="/home" className="text-white font-bold text-lg tracking-tight shrink-0">
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
                      ? "text-white bg-[#2A2A2A]"
                      : "text-gray-400 hover:text-gray-200 hover:bg-[#1A1A1A]"
                  }`}
                >
                  {link.icon}
                  {link.label}
                </Link>
              );
            })}
          </div>

          {/* Right side — currency · notifications · upload · account menu */}
          <div className="hidden md:flex items-center gap-2 shrink-0">
            <CurrencyMenu />
            <NotificationDropdown />
            <Link
              href="/upload"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-sm font-medium text-white transition-colors"
            >
              <Upload size={14} />
              {t("nav.upload")}
            </Link>

            {/* Account menu — folds language, settings, logout, email into one avatar */}
            <div className="relative" ref={accountRef}>
              <button
                onClick={() => setAccountOpen((v) => !v)}
                className="w-8 h-8 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold flex items-center justify-center transition-colors"
                title={userEmail ?? ""}
              >
                {userEmail?.[0]?.toUpperCase() ?? "?"}
              </button>
              {accountOpen && (
                <div className="absolute right-0 mt-2 w-56 bg-[#161616] border border-[#2A2A2A] rounded-xl shadow-2xl shadow-black/50 py-2 z-50">
                  <div className="px-3 py-2 border-b border-[#2A2A2A]">
                    <p className="text-gray-500 text-[10px] uppercase tracking-wider">{t("settings.account")}</p>
                    <p className="text-gray-200 text-sm truncate">{userEmail}</p>
                  </div>
                  <div className="px-3 py-2 flex items-center justify-between">
                    <span className="text-gray-400 text-sm">{t("settings.language")}</span>
                    <div className="flex rounded-lg overflow-hidden border border-[#2A2A2A] text-xs font-medium">
                      <button onClick={() => handleLangSwitch("tr")} className={`px-2 py-1 transition-colors ${lang === "tr" ? "bg-indigo-600 text-white" : "text-gray-400 hover:text-gray-200"}`}>TR</button>
                      <button onClick={() => handleLangSwitch("en")} className={`px-2 py-1 transition-colors ${lang === "en" ? "bg-indigo-600 text-white" : "text-gray-400 hover:text-gray-200"}`}>EN</button>
                    </div>
                  </div>
                  <Link href="/simulator" className="flex items-center gap-2 px-3 py-2 text-sm text-gray-300 hover:bg-[#1A1A1A] transition-colors">
                    <Sparkles size={15} /> {t("nav.simulator")}
                  </Link>
                  <Link href="/settings" className="flex items-center gap-2 px-3 py-2 text-sm text-gray-300 hover:bg-[#1A1A1A] transition-colors">
                    <Settings size={15} /> {t("settings.title")}
                  </Link>
                  {isAdmin && (
                    <Link href="/admin" className="flex items-center gap-2 px-3 py-2 text-sm text-amber-300 hover:bg-[#1A1A1A] transition-colors">
                      <ShieldCheck size={15} /> Admin
                    </Link>
                  )}
                  <button onClick={handleLogout} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-[#1A1A1A] transition-colors">
                    <LogOut size={15} /> {t("nav.logout")}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Mobile hamburger */}
          <button
            onClick={() => setMobileOpen((v) => !v)}
            className="md:hidden p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-[#2A2A2A] transition-colors"
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
          <div className="absolute top-14 left-0 right-0 bg-[#0F0F0F] border-b border-[#2A2A2A] px-4 py-4 space-y-1">
            {NAV_LINKS.map((link) => {
              const isActive = link.match.some((p) => pathname === p || pathname.startsWith(p + "/"));
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`flex items-center gap-3 px-3 py-3 rounded-lg text-sm transition-colors ${
                    isActive
                      ? "text-white bg-[#2A2A2A]"
                      : "text-gray-300 hover:text-white hover:bg-[#1A1A1A]"
                  }`}
                >
                  {link.icon}
                  {link.label}
                </Link>
              );
            })}
            <Link
              href="/simulator"
              className={`flex items-center gap-3 px-3 py-3 rounded-lg text-sm transition-colors ${pathname === "/simulator" ? "text-white bg-[#2A2A2A]" : "text-gray-300 hover:text-white hover:bg-[#1A1A1A]"}`}
            >
              <Sparkles size={16} />
              {t("nav.simulator")}
            </Link>
            <Link
              href="/settings"
              className={`flex items-center gap-3 px-3 py-3 rounded-lg text-sm transition-colors ${pathname === "/settings" ? "text-white bg-[#2A2A2A]" : "text-gray-300 hover:text-white hover:bg-[#1A1A1A]"}`}
            >
              <Settings size={16} />
              {t("settings.title")}
            </Link>
            {isAdmin && (
              <Link
                href="/admin"
                className={`flex items-center gap-3 px-3 py-3 rounded-lg text-sm transition-colors ${pathname === "/admin" ? "text-white bg-[#2A2A2A]" : "text-amber-300 hover:text-white hover:bg-[#1A1A1A]"}`}
              >
                <ShieldCheck size={16} />
                Admin
              </Link>
            )}
            <div className="pt-3 border-t border-[#2A2A2A] space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-gray-500 text-xs truncate">{userEmail}</span>
                {/* Currency + notifications — parity with the desktop top bar */}
                <div className="flex items-center gap-2 shrink-0">
                  <CurrencyMenu />
                  <NotificationDropdown />
                </div>
              </div>
              <div className="flex gap-2 items-center">
                {/* Language toggle (mobile) */}
                <div className="flex rounded-lg overflow-hidden border border-[#2A2A2A] text-xs font-medium">
                  <button
                    onClick={() => handleLangSwitch("tr")}
                    className={`px-2 py-1 ${lang === "tr" ? "bg-indigo-600 text-white" : "text-gray-400"}`}
                  >
                    TR
                  </button>
                  <button
                    onClick={() => handleLangSwitch("en")}
                    className={`px-2 py-1 ${lang === "en" ? "bg-indigo-600 text-white" : "text-gray-400"}`}
                  >
                    EN
                  </button>
                </div>
                <Link
                  href="/upload"
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600 text-sm font-medium text-white"
                >
                  <Upload size={14} />
                  {t("nav.upload")}
                </Link>
                <button
                  onClick={handleLogout}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#2A2A2A] text-sm text-gray-300"
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
