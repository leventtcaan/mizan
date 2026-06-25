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
      <div className="flex items-center gap-2 mb-6 overflow-x-auto -mx-1 px-1 pb-1">
      {TABS.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(tab.href + "/");
        const Icon = tab.icon;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold whitespace-nowrap transition-colors ${
              active
                ? "bg-[#176B5B] text-white shadow-sm"
                : "bg-surface border border-line text-ink-soft hover:border-[#176B5B] hover:text-[#176B5B]"
            }`}
          >
            <Icon size={15} />
            {t(tab.labelKey)}
          </Link>
        );
      })}
      </div>
    </>
  );
}
