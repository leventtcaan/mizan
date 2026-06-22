"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PieChart, Calendar, CreditCard, Layers } from "@/components/ui/Icons";
import { useLanguage } from "@/lib/i18n";

const TABS = [
  { href: "/transactions", labelKey: "nav.transactions", icon: PieChart },
  { href: "/cashflow", labelKey: "nav.calendar", icon: Calendar },
  { href: "/subscriptions", labelKey: "nav.subscriptions", icon: CreditCard },
  { href: "/installments", labelKey: "nav.installments", icon: Layers },
];

/** Shared sub-navigation that makes the four money pages read as one surface. */
export default function MoneyTabs() {
  const pathname = usePathname();
  const { t } = useLanguage();

  return (
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
  );
}
