"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { getToken, getStoredUser, clearToken, getNetWorthSuggestions, updatePreferences } from "@/lib/api";
import { BarChart2, Upload, LogOut, Menu, X, Scale, Home, Settings } from "@/components/ui/Icons";
import { useLanguage, type Lang } from "@/lib/i18n";
import NotificationDropdown from "@/components/NotificationDropdown";
import CurrencyMenu from "@/components/ui/CurrencyMenu";

const HIDDEN_PATHS = ["/login", "/onboarding"];

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
  const [mobileOpen, setMobileOpen] = useState(false);
  const [suggestionCount, setSuggestionCount] = useState(0);

  // The four money pages (transactions / cashflow / subscriptions / installments)
  // are unified under one "Money Flow" entry; they share the MoneyTabs sub-nav.
  const MONEY_PATHS = ["/transactions", "/cashflow", "/subscriptions", "/installments"];
  const NAV_LINKS = [
    { href: "/home", label: t("nav.home"), icon: <Home size={16} />, match: ["/home"] },
    { href: "/transactions", label: t("nav.money"), icon: <PieChartMini />, match: MONEY_PATHS },
    { href: "/networth", label: t("nav.networth"), icon: <Scale size={16} />, match: ["/networth"] },
    { href: "/progress", label: t("nav.progress"), icon: <BarChart2 size={16} />, match: ["/progress"] },
  ];

  useEffect(() => {
    const user = getStoredUser();
    if (user && getToken()) {
      setUserEmail(user.email);
      getNetWorthSuggestions()
        .then((suggs) => setSuggestionCount(suggs.filter((s) => s.status === "pending").length))
        .catch(() => setSuggestionCount(0));
    } else {
      setUserEmail(null);
      setSuggestionCount(0);
    }
  }, [pathname]);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

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
              const showBadge = link.href === "/networth" && suggestionCount > 0;
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
                  {showBadge && (
                    <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
                      {suggestionCount}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>

          {/* Right side */}
          <div className="hidden md:flex items-center gap-2 shrink-0">
            {/* Language toggle */}
            <div className="flex rounded-lg overflow-hidden border border-[#2A2A2A] text-xs font-medium">
              <button
                onClick={() => handleLangSwitch("tr")}
                className={`px-2 py-1 transition-colors ${lang === "tr" ? "bg-indigo-600 text-white" : "text-gray-400 hover:text-gray-200"}`}
              >
                TR
              </button>
              <button
                onClick={() => handleLangSwitch("en")}
                className={`px-2 py-1 transition-colors ${lang === "en" ? "bg-indigo-600 text-white" : "text-gray-400 hover:text-gray-200"}`}
              >
                EN
              </button>
            </div>

            <CurrencyMenu />
            <NotificationDropdown />
            <Link
              href="/settings"
              title={t("settings.title")}
              className={`p-1.5 rounded-lg transition-colors ${pathname === "/settings" ? "text-white bg-[#2A2A2A]" : "text-gray-500 hover:text-gray-300 hover:bg-[#2A2A2A]"}`}
            >
              <Settings size={16} />
            </Link>
            <span className="text-gray-500 text-xs truncate max-w-[140px]">{userEmail}</span>
            <Link
              href="/upload"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-sm font-medium text-white transition-colors"
            >
              <Upload size={14} />
              {t("nav.upload")}
            </Link>
            <button
              onClick={handleLogout}
              title={t("nav.logout")}
              className="p-1.5 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-[#2A2A2A] transition-colors"
            >
              <LogOut size={16} />
            </button>
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
              href="/settings"
              className={`flex items-center gap-3 px-3 py-3 rounded-lg text-sm transition-colors ${pathname === "/settings" ? "text-white bg-[#2A2A2A]" : "text-gray-300 hover:text-white hover:bg-[#1A1A1A]"}`}
            >
              <Settings size={16} />
              {t("settings.title")}
            </Link>
            <div className="pt-3 border-t border-[#2A2A2A] flex items-center justify-between">
              <span className="text-gray-500 text-xs">{userEmail}</span>
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
