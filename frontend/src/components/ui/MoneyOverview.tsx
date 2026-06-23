"use client";

import { useEffect, useState } from "react";
import { TrendingUp, TrendingDown, RefreshCw, Wallet } from "@/components/ui/Icons";
import {
  getCashFlowSummary, getRecurring, getDefaultCurrency, CURRENCY_CHANGE_EVENT,
  type CashFlowSummary, type RecurringSummary,
} from "@/lib/api";
import { useLanguage } from "@/lib/i18n";
import { currentMonthLabel } from "@/lib/period";

function fmt(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency", currency, maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value)} ${currency}`;
  }
}

/** Money Flow spine: a compact at-a-glance header above every Money Flow tab. */
export default function MoneyOverview() {
  const { t, lang } = useLanguage();
  const [ccy, setCcy] = useState("TRY");
  const [cashflow, setCashflow] = useState<CashFlowSummary | null>(null);
  const [recurring, setRecurring] = useState<RecurringSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const apply = (code: string) => setCcy(code);
    apply(getDefaultCurrency());
    const handler = (e: Event) => apply((e as CustomEvent<string>).detail);
    window.addEventListener(CURRENCY_CHANGE_EVENT, handler);
    return () => window.removeEventListener(CURRENCY_CHANGE_EVENT, handler);
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      getCashFlowSummary(30, ccy).catch(() => null),
      getRecurring(ccy).then((r) => r.summary).catch(() => null),
    ]).then(([cf, rec]) => {
      if (!active) return;
      setCashflow(cf);
      setRecurring(rec);
    }).finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [ccy]);

  if (loading) {
    return <div className="mb-6 h-[88px] rounded-2xl bg-[#1A1A1A] border border-[#2A2A2A] animate-pulse" />;
  }
  if (!cashflow) return null;

  const income = parseFloat(cashflow.month_income_actual) || 0;
  const expenses = parseFloat(cashflow.month_expenses_actual) || 0;
  const net = income - expenses;
  const commitments = recurring ? parseFloat(recurring.monthly_total) || 0 : 0;
  const projected = parseFloat(cashflow.projected_month_end) || 0;

  const Stat = ({ label, value, color, icon }: { label: string; value: string; color: string; icon?: React.ReactNode }) => (
    <div className="flex-1 min-w-[120px]">
      <div className="flex items-center gap-1.5 text-gray-500 text-[11px] mb-1">{icon}{label}</div>
      <p className={`text-base font-semibold tabular-nums ${color}`}>{value}</p>
    </div>
  );

  return (
    <div className="mb-6 bg-[#1A1A1A] border border-[#2A2A2A] rounded-2xl p-5">
      {/* Explicit window — income/expenses/net below are this calendar month, never an ambiguous "this month". */}
      <p className="text-[11px] font-semibold tracking-wide text-gray-500 uppercase mb-3">
        {currentMonthLabel(lang)} · {t("money.periodTag")}
      </p>
      <div className="flex flex-wrap gap-y-4 gap-x-6">
        <Stat
          label={t("money.income")}
          value={`+${fmt(income, ccy)}`}
          color="text-emerald-400"
          icon={<TrendingUp size={12} className="text-emerald-400" />}
        />
        <Stat
          label={t("money.expenses")}
          value={`−${fmt(expenses, ccy)}`}
          color="text-red-400"
          icon={<TrendingDown size={12} className="text-red-400" />}
        />
        <Stat
          label={t("money.net")}
          value={`${net >= 0 ? "" : "−"}${fmt(Math.abs(net), ccy)}`}
          color={net >= 0 ? "text-white" : "text-orange-400"}
        />
        <Stat
          label={t("money.commitments")}
          value={fmt(commitments, ccy)}
          color="text-gray-200"
          icon={<RefreshCw size={12} className="text-gray-500" />}
        />
        <Stat
          label={t("money.projectedMonthEnd")}
          value={fmt(projected, ccy)}
          color={projected >= 0 ? "text-indigo-300" : "text-red-400"}
          icon={<Wallet size={12} className="text-gray-500" />}
        />
      </div>
    </div>
  );
}
