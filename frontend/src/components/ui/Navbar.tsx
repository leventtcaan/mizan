"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { getToken, getStoredUser, clearToken, getNetWorthSuggestions } from "@/lib/api";
import { BarChart2, CreditCard, Layers, Upload, LogOut, Menu, X, Scale } from "@/components/ui/Icons";

const HIDDEN_PATHS = ["/login", "/onboarding"];

interface NavLink {
  href: string;
  label: string;
  icon: React.ReactNode;
}

const NAV_LINKS: NavLink[] = [
  { href: "/transactions", label: "İşlemler", icon: <PieChartMini /> },
  { href: "/networth", label: "Net Değer", icon: <Scale size={16} /> },
  { href: "/progress", label: "İlerleme", icon: <BarChart2 size={16} /> },
  { href: "/subscriptions", label: "Abonelikler", icon: <CreditCard size={16} /> },
  { href: "/installments", label: "Taksitler", icon: <Layers size={16} /> },
];

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
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [emailEnabled, setEmailEnabled] = useState<boolean | null>(null);
  const [suggestionCount, setSuggestionCount] = useState(0);

  useEffect(() => {
    const user = getStoredUser();
    if (user && getToken()) {
      setUserEmail(user.email);
      // Fetch pending suggestions count (silent on error)
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

  return (
    <>
      <nav className="fixed top-0 left-0 right-0 z-50 bg-[#0A0A0A]/95 backdrop-blur-md border-b border-[#2A2A2A]">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
          {/* Logo */}
          <Link href="/transactions" className="text-white font-bold text-lg tracking-tight shrink-0">
            Mizan
          </Link>

          {/* Desktop nav links */}
          <div className="hidden md:flex items-center gap-1 flex-1 justify-center">
            {NAV_LINKS.map((link) => {
              const isActive = pathname === link.href || pathname.startsWith(link.href + "/");
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
            <span className="text-gray-500 text-xs truncate max-w-[140px]">{userEmail}</span>
            <Link
              href="/upload"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-sm font-medium text-white transition-colors"
            >
              <Upload size={14} />
              Yükle
            </Link>
            <button
              onClick={handleLogout}
              title="Çıkış"
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
              const isActive = pathname === link.href;
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
            <div className="pt-3 border-t border-[#2A2A2A] flex items-center justify-between">
              <span className="text-gray-500 text-xs">{userEmail}</span>
              <div className="flex gap-2">
                <Link
                  href="/upload"
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600 text-sm font-medium text-white"
                >
                  <Upload size={14} />
                  Yükle
                </Link>
                <button
                  onClick={handleLogout}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#2A2A2A] text-sm text-gray-300"
                >
                  <LogOut size={14} />
                  Çıkış
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
