"use client";

import { useEffect, useState } from "react";
import { TrendingUp, TrendingDown, RefreshCw, Wallet } from "@/components/ui/Icons";
import {
  getCashFlowSummary, getRecurring, getDefaultCurrency, getToken, CURRENCY_CHANGE_EVENT,
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
  // Lazy-init from the stored display currency so the first fetch uses the right
  // currency instead of fetching TRY and then re-fetching once the effect runs.
  const [ccy, setCcy] = useState(() => getDefaultCurrency());
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
    // No token yet → skip the authenticated calls (prevents 401 noise pre-auth).
    if (!getToken()) { setLoading(false); return; }
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
    return <div className="mb-6 h-[88px] rounded-2xl bg-surface border border-line animate-pulse" />;
  }
  if (!cashflow) return null;

  const income = parseFloat(cashflow.month_income_actual) || 0;
  const expenses = parseFloat(cashflow.month_expenses_actual) || 0;
  const net = income - expenses;
  const commitments = recurring ? parseFloat(recurring.monthly_total) || 0 : 0;
  const projected = parseFloat(cashflow.projected_month_end) || 0;

  const Foot = ({ label, value, color, icon }: { label: string; value: string; color: string; icon?: React.ReactNode }) => (
    <div className="flex-1 min-w-[130px]">
      <div className="flex items-center gap-1.5 text-ink-mute text-[11px] mb-1">{icon}{label}</div>
      <p className={`text-sm font-semibold tabular-nums ${color}`}>{value}</p>
    </div>
  );

  return (
    <div className="mb-6 bg-surface border border-line rounded-2xl p-5 shadow-sm">
      {/* Explicit window — income/expenses/net below are this calendar month, never an ambiguous "this month". */}
      <p className="text-[11px] font-semibold tracking-widest text-ink-mute uppercase mb-4">
        {currentMonthLabel(lang)} · {t("money.periodTag")}
      </p>

      {/* Headline: net for the month, with income/expenses chips alongside */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p className="text-ink-mute text-xs mb-1">{t("money.net")}</p>
          <p className={`text-3xl sm:text-4xl font-bold tabular-nums leading-none ${net >= 0 ? "text-ink" : "text-neg"}`}>
            {net >= 0 ? "+" : "−"}{fmt(Math.abs(net), ccy)}
          </p>
        </div>
        <div className="flex items-stretch gap-2">
          <div className="rounded-xl bg-pos/10 px-3 py-2">
            <div className="flex items-center gap-1 text-pos text-[11px] font-medium mb-0.5"><TrendingUp size={12} /> {t("money.income")}</div>
            <p className="text-pos text-sm font-bold tabular-nums">+{fmt(income, ccy)}</p>
          </div>
          <div className="rounded-xl bg-neg/10 px-3 py-2">
            <div className="flex items-center gap-1 text-neg text-[11px] font-medium mb-0.5"><TrendingDown size={12} /> {t("money.expenses")}</div>
            <p className="text-neg text-sm font-bold tabular-nums">−{fmt(expenses, ccy)}</p>
          </div>
        </div>
      </div>

      {/* Footnotes: fixed monthly commitments + projected month-end */}
      <div className="flex flex-wrap gap-y-3 gap-x-6 mt-5 pt-4 border-t border-line">
        <Foot
          label={t("money.commitments")}
          value={fmt(commitments, ccy)}
          color="text-ink-soft"
          icon={<RefreshCw size={12} className="text-ink-mute" />}
        />
        <Foot
          label={t("money.projectedMonthEnd")}
          value={fmt(projected, ccy)}
          color={projected >= 0 ? "text-[#176B5B]" : "text-neg"}
          icon={<Wallet size={12} className="text-ink-mute" />}
        />
      </div>
    </div>
  );
}
