"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PieChart, Calendar, RefreshCw } from "@/components/ui/Icons";
import { useLanguage } from "@/lib/i18n";
import MoneyOverview from "@/components/ui/MoneyOverview";

const TABS = [
  { href: "/transactions", labelKey: "money.activity", icon: PieChart },
  { href: "/cashflow", labelKey: "money.upcoming", icon: Calendar },
  { href: "/recurring", labelKey: "money.recurring", icon: RefreshCw },
];

/** Shared sub-navigation: the Money Flow section reads as one surface (past / future / recurring). */
export default function MoneyTabs() {
  const pathname = usePathname();
  const { t } = useLanguage();

  return (
    <>
      <MoneyOverview />
      <div className="flex items-center gap-1 mb-6 overflow-x-auto -mx-1 px-1 pb-1">
      {TABS.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(tab.href + "/");
        const Icon = tab.icon;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm whitespace-nowrap transition-colors ${
              active
                ? "bg-indigo-600 text-white"
                : "bg-[#1A1A1A] border border-[#2A2A2A] text-gray-400 hover:text-gray-200 hover:border-[#3A3A3A]"
            }`}
          >
            <Icon size={14} />
            {t(tab.labelKey)}
          </Link>
        );
      })}
      </div>
    </>
  );
}
