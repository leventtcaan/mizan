"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import PageLayout from "@/components/ui/PageLayout";
import MoneyTabs from "@/components/ui/MoneyTabs";
import CurrencySelect from "@/components/CurrencySelect";
import { Calendar, ArrowDown, ArrowUp, RefreshCw, Plus, X } from "@/components/ui/Icons";
import {
  getToken,
  getCashFlowUpcoming,
  getCashFlowSummary,
  createLiability,
  getDefaultCurrency,
  CURRENCY_CHANGE_EVENT,
  CashFlowItem,
  CashFlowSummary,
} from "@/lib/api";
import { useLanguage } from "@/lib/i18n";

const DAYS_OPTIONS = [7, 14, 30, 60, 90];

function formatDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function isToday(iso: string): boolean {
  return iso === new Date().toISOString().slice(0, 10);
}

function isTomorrow(iso: string): boolean {
  const t = new Date();
  t.setDate(t.getDate() + 1);
  return iso === t.toISOString().slice(0, 10);
}

function fmt(value: number, currency = "TRY"): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value)} ${currency}`;
  }
}

function fmtAmount(amount: string, currency: string): string {
  const n = parseFloat(amount);
  if (isNaN(n)) return `${amount} ${currency}`;
  return fmt(n, currency);
}

interface AddPaymentFormData {
  name: string;
  amount: string;
  currency: string;
  due_date: string;
}

function AddPaymentModal({
  onClose,
  onAdded,
  t,
}: {
  onClose: () => void;
  onAdded: () => void;
  t: (key: string) => string;
}) {
  const [form, setForm] = useState<AddPaymentFormData>({
    name: "",
    amount: "",
    currency: "TRY",
    due_date: new Date().toISOString().slice(0, 10),
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!form.name.trim() || !form.amount || !form.due_date) {
      setError(t("common.error"));
      return;
    }
    const amt = parseFloat(form.amount);
    if (isNaN(amt) || amt <= 0) {
      setError(t("common.error"));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await createLiability({
        name: form.name.trim(),
        liability_type: "other_liability",
        currency: form.currency,
        total_amount: form.amount,
        remaining_amount: form.amount,
        monthly_payment: form.amount,
        due_date: form.due_date,
      });
      onAdded();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common.error"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
      <div className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-2xl p-6 w-full max-w-sm shadow-xl">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-white font-semibold">{t("cashflow.addPaymentTitle")}</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-gray-400 mb-1 block">{t("cashflow.paymentName")}</label>
            <input
              type="text"
              placeholder={t("cashflow.paymentNamePlaceholder")}
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              className="w-full bg-[#0F0F0F] border border-[#2A2A2A] rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-600"
            />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-xs text-gray-400 mb-1 block">{t("common.amount")}</label>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={form.amount}
                onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))}
                className="w-full bg-[#0F0F0F] border border-[#2A2A2A] rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-600"
              />
            </div>
            <div className="w-28">
              <label className="text-xs text-gray-400 mb-1 block">{t("common.currency")}</label>
              <CurrencySelect value={form.currency} onChange={(v) => setForm((p) => ({ ...p, currency: v })) } />
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">{t("common.date")}</label>
            <input
              type="date"
              value={form.due_date}
              onChange={(e) => setForm((p) => ({ ...p, due_date: e.target.value }))}
              className="w-full bg-[#0F0F0F] border border-[#2A2A2A] rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-600"
            />
          </div>
        </div>

        {error && <p className="text-red-400 text-xs mt-3">{error}</p>}

        <div className="flex gap-2 mt-5">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 rounded-lg border border-[#2A2A2A] text-gray-400 hover:text-gray-200 text-sm transition-colors"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="flex-1 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium transition-colors"
          >
            {loading ? t("cashflow.addingBtn") : t("common.add")}
          </button>
        </div>
      </div>
    </div>
  );
}

function ItemIcon({ type, urgent }: { type: string; urgent: boolean }) {
  const icon =
    type === "liability_payment" ? <ArrowDown size={14} className="text-red-400" /> :
    (type === "income" || type === "recurring_income") ? <ArrowUp size={14} className="text-emerald-400" /> :
    <RefreshCw size={14} className="text-orange-400" />;

  return (
    <div className={`relative flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
      type === "liability_payment" ? "bg-red-950/40" :
      (type === "income" || type === "recurring_income") ? "bg-emerald-950/40" :
      "bg-orange-950/40"
    }`}>
      {icon}
      {urgent && <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-red-500 animate-ping" />}
    </div>
  );
}

export default function CashFlowPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const [days, setDays] = useState(30);
  const [displayCurrency, setDisplayCurrency] = useState("TRY");
  const [items, setItems] = useState<CashFlowItem[]>([]);
  const [summary, setSummary] = useState<CashFlowSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAddPayment, setShowAddPayment] = useState(false);

  const TYPE_CONFIG = {
    liability_payment: { label: t("cashflow.types.liabilityPayment"), color: "text-red-400", sign: "−" },
    subscription: { label: t("cashflow.types.subscription"), color: "text-orange-400", sign: "−" },
    income: { label: t("cashflow.types.income"), color: "text-emerald-400", sign: "+" },
    recurring_income: { label: t("cashflow.types.recurringIncome"), color: "text-emerald-400", sign: "+" },
  } as Record<string, { label: string; color: string; sign: string }>;

  useEffect(() => {
    if (!getToken()) { router.push("/login"); return; }
    loadAll();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Honor the user's preferred display currency and react to Settings changes.
  useEffect(() => {
    setDisplayCurrency(getDefaultCurrency());
    const handler = (e: Event) => setDisplayCurrency((e as CustomEvent<string>).detail);
    window.addEventListener(CURRENCY_CHANGE_EVENT, handler);
    return () => window.removeEventListener(CURRENCY_CHANGE_EVENT, handler);
  }, []);

  useEffect(() => {
    if (!loading) loadAll();
  }, [days, displayCurrency]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [it, sum] = await Promise.all([
        getCashFlowUpcoming(days, displayCurrency),
        getCashFlowSummary(days, displayCurrency),
      ]);
      setItems(it);
      setSummary(sum);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [days, displayCurrency]);

  // Refresh after the global assistant confirms an action (e.g. add_liability).
  useEffect(() => {
    const handler = () => { void loadAll(); };
    window.addEventListener("mizan-data-changed", handler);
    return () => window.removeEventListener("mizan-data-changed", handler);
  }, [loadAll]);

  const grouped: Record<string, CashFlowItem[]> = {};
  for (const item of items) {
    if (!grouped[item.date]) grouped[item.date] = [];
    grouped[item.date].push(item);
  }
  const sortedDates = Object.keys(grouped).sort();

  const incomeTotal = parseFloat(summary?.total_expected_income ?? "0");
  const paymentsTotal = parseFloat(summary?.total_expected_payments ?? "0");
  const netTotal = parseFloat(summary?.projected_net ?? "0");
  const liquidAssets = parseFloat(summary?.liquid_assets ?? "0");

  const urgentCount = items.filter((i) => i.urgent).length;

  function dateBadge(iso: string): string | null {
    if (isToday(iso)) return t("cashflow.today");
    if (isTomorrow(iso)) return t("cashflow.tomorrow");
    return null;
  }

  return (
    <PageLayout
      title={t("cashflow.title")}
      subtitle={t("cashflow.subtitle")}
      maxWidth="lg"
      action={
        <button
          onClick={() => setShowAddPayment(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#2A2A2A] text-indigo-400 hover:text-indigo-300 text-sm transition-colors"
        >
          <Plus size={14} />
          {t("cashflow.addPayment")}
        </button>
      }
    >
      <MoneyTabs />
      {showAddPayment && (
        <AddPaymentModal
          onClose={() => setShowAddPayment(false)}
          onAdded={loadAll}
          t={t}
        />
      )}

      {/* Controls */}
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <div className="flex items-center gap-1 bg-[#1A1A1A] border border-[#2A2A2A] rounded-full p-1">
          {DAYS_OPTIONS.map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                days === d ? "bg-indigo-600 text-white" : "text-gray-400 hover:text-gray-200"
              }`}
            >
              {d}{t("cashflow.days")}
            </button>
          ))}
        </div>
        <div className="w-44">
          <CurrencySelect value={displayCurrency} onChange={setDisplayCurrency} />
        </div>
        {urgentCount > 0 && (
          <span className="px-2.5 py-1 rounded-full bg-red-950/50 border border-red-800/40 text-red-400 text-xs font-medium animate-pulse">
            {urgentCount} {t("cashflow.urgent")}
          </span>
        )}
      </div>

      {/* Summary Card */}
      {loading ? (
        <div className="h-32 bg-[#1A1A1A] border border-[#2A2A2A] rounded-2xl animate-pulse mb-6" />
      ) : summary && (
        <div className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-2xl p-6 mb-6">
          <p className="text-gray-500 text-xs mb-4">{t("cashflow.upcomingPrefix")} {days} {t("cashflow.days")}</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-gray-500 text-xs mb-1">{t("cashflow.expectedIncome")}</p>
              <p className="text-emerald-400 font-semibold tabular-nums">{fmt(incomeTotal, displayCurrency)}</p>
            </div>
            <div>
              <p className="text-gray-500 text-xs mb-1">{t("cashflow.expectedPayments")}</p>
              <p className="text-red-400 font-semibold tabular-nums">{fmt(paymentsTotal, displayCurrency)}</p>
            </div>
            <div>
              <p className="text-gray-500 text-xs mb-1">{t("cashflow.projectedNet")}</p>
              <p className={`font-semibold tabular-nums ${netTotal >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {netTotal >= 0 ? "+" : ""}{fmt(netTotal, displayCurrency)}
              </p>
            </div>
            <div>
              <p className="text-gray-500 text-xs mb-1">{t("cashflow.liquidAssets")}</p>
              <p className="text-gray-200 font-semibold tabular-nums">{fmt(liquidAssets, displayCurrency)}</p>
              {summary.liquid_to_payments_ratio !== null && (
                <p className={`text-xs mt-0.5 ${
                  summary.liquid_to_payments_ratio < 1 ? "text-red-400" :
                  summary.liquid_to_payments_ratio < 2 ? "text-amber-400" : "text-gray-500"
                }`}>
                  {(summary.liquid_to_payments_ratio * 100).toFixed(0)}{t("cashflow.coveragePct")}
                </p>
              )}
            </div>
          </div>

          {summary.warning && (
            <div className="mt-4 flex items-start gap-2 bg-red-950/30 border border-red-800/40 rounded-xl px-4 py-3">
              <span className="text-red-400 text-sm shrink-0">⚠</span>
              <p className="text-red-200 text-xs leading-relaxed">{summary.warning}</p>
            </div>
          )}
        </div>
      )}

      {/* Timeline */}
      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="space-y-2">
              <div className="h-4 w-32 bg-[#1A1A1A] rounded animate-pulse" />
              <div className="h-14 bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl animate-pulse" />
            </div>
          ))}
        </div>
      ) : sortedDates.length === 0 ? (
        <div className="bg-[#1A1A1A] border border-[#2A2A2A] border-dashed rounded-2xl p-12 text-center">
          <Calendar size={32} className="text-gray-700 mx-auto mb-3" />
          <p className="text-gray-500 text-sm">{t("cashflow.noItems")}</p>
          <p className="text-gray-600 text-xs mt-2">{t("cashflow.noItemsHint")}</p>
        </div>
      ) : (
        <div className="space-y-6">
          {sortedDates.map((dateStr) => {
            const dayItems = grouped[dateStr];
            const badge = dateBadge(dateStr);
            const hasUrgent = dayItems.some((i) => i.urgent);

            return (
              <div key={dateStr}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-semibold text-gray-400">{formatDate(dateStr)}</span>
                  {badge && (
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      badge === t("cashflow.today")
                        ? "bg-indigo-900/50 text-indigo-300 border border-indigo-700/40"
                        : "bg-[#2A2A2A] text-gray-400"
                    }`}>
                      {badge}
                    </span>
                  )}
                  {hasUrgent && !badge && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-950/50 text-red-400 border border-red-800/30">
                      {t("cashflow.urgent")}
                    </span>
                  )}
                </div>

                <div className={`bg-[#1A1A1A] border rounded-xl overflow-hidden ${
                  hasUrgent ? "border-red-800/30" : "border-[#2A2A2A]"
                }`}>
                  {dayItems.map((item, idx) => {
                    const cfg = TYPE_CONFIG[item.type] ?? TYPE_CONFIG.subscription;
                    return (
                      <div
                        key={`${dateStr}-${idx}`}
                        className={`flex items-center gap-3 px-4 py-3 ${
                          idx < dayItems.length - 1 ? "border-b border-[#2A2A2A]" : ""
                        } ${item.urgent ? "bg-red-950/10" : ""}`}
                      >
                        <ItemIcon type={item.type} urgent={item.urgent} />
                        <div className="flex-1 min-w-0">
                          <p className="text-gray-100 text-sm truncate">{item.description}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                              item.type === "liability_payment" ? "bg-red-950/30 text-red-400" :
                              item.type === "subscription" ? "bg-orange-950/30 text-orange-400" :
                              "bg-emerald-950/30 text-emerald-400"
                            }`}>
                              {cfg.label}
                            </span>
                            {item.source === "subscription" && (
                              <span className="text-[10px] text-gray-600">{t("cashflow.fromHistory")}</span>
                            )}
                            {item.source === "recurring_income" && (
                              <span className="text-[10px] text-gray-600">{t("cashflow.types.recurringIncome")}</span>
                            )}
                          </div>
                        </div>
                        <p className={`text-sm font-semibold tabular-nums shrink-0 ${cfg.color}`}>
                          {cfg.sign}{fmtAmount(item.amount, item.currency)}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Legend */}
      {!loading && sortedDates.length > 0 && (
        <div className="mt-8 flex flex-wrap gap-4 text-xs text-gray-600">
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-500" />{t("cashflow.legend.creditPayment")}</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-orange-500" />{t("cashflow.legend.subscriptionEstimate")}</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500" />{t("cashflow.legend.incomeReceivable")}</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-500 animate-ping inline-block" />{t("cashflow.legend.withinDays")}</span>
        </div>
      )}
    </PageLayout>
  );
}
