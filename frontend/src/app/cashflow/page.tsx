"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import PageLayout from "@/components/ui/PageLayout";
import MoneyTabs from "@/components/ui/MoneyTabs";
import CurrencySelect from "@/components/CurrencySelect";
import { Calendar, ArrowDown, ArrowUp, RefreshCw, Plus, X, Upload } from "@/components/ui/Icons";
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
      <div className="bg-surface border border-line rounded-2xl p-6 w-full max-w-sm shadow-xl">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-ink font-semibold">{t("cashflow.addPaymentTitle")}</h3>
          <button onClick={onClose} className="text-ink-mute hover:text-ink-soft transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-ink-mute mb-1 block">{t("cashflow.paymentName")}</label>
            <input
              type="text"
              placeholder={t("cashflow.paymentNamePlaceholder")}
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              className="w-full bg-canvas border border-line rounded-lg px-3 py-2 text-ink text-sm focus:outline-none focus:border-[#176B5B] focus:ring-2 focus:ring-[#176B5B]/20"
            />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-xs text-ink-mute mb-1 block">{t("common.amount")}</label>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={form.amount}
                onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))}
                className="w-full bg-canvas border border-line rounded-lg px-3 py-2 text-ink text-sm focus:outline-none focus:border-[#176B5B] focus:ring-2 focus:ring-[#176B5B]/20"
              />
            </div>
            <div className="w-28">
              <label className="text-xs text-ink-mute mb-1 block">{t("common.currency")}</label>
              <CurrencySelect value={form.currency} onChange={(v) => setForm((p) => ({ ...p, currency: v })) } />
            </div>
          </div>
          <div>
            <label className="text-xs text-ink-mute mb-1 block">{t("common.date")}</label>
            <input
              type="date"
              value={form.due_date}
              onChange={(e) => setForm((p) => ({ ...p, due_date: e.target.value }))}
              className="w-full bg-canvas border border-line rounded-lg px-3 py-2 text-ink text-sm focus:outline-none focus:border-[#176B5B] focus:ring-2 focus:ring-[#176B5B]/20"
            />
          </div>
        </div>

        {error && <p className="text-neg text-xs mt-3">{error}</p>}

        <div className="flex gap-2 mt-5">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 rounded-lg border border-line text-ink-mute hover:text-ink-soft text-sm transition-colors"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="flex-1 px-4 py-2 rounded-lg bg-[#176B5B] hover:bg-[#125848] disabled:opacity-50 text-white text-sm font-medium transition-colors"
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
    type === "liability_payment" ? <ArrowDown size={14} className="text-neg" /> :
    (type === "income" || type === "recurring_income") ? <ArrowUp size={14} className="text-pos" /> :
    <RefreshCw size={14} className="text-warn" />;

  return (
    <div className={`relative flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
      type === "liability_payment" ? "bg-neg/10" :
      (type === "income" || type === "recurring_income") ? "bg-pos/10" :
      "bg-warn/10"
    }`}>
      {icon}
      {urgent && <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-neg animate-ping" />}
    </div>
  );
}

export default function CashFlowPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const [days, setDays] = useState(30);
  // Lazy-init from the stored display currency so the mount loadAll() fetches in the
  // right currency immediately, instead of fetching TRY first and then re-fetching once
  // the currency effect runs.
  const [displayCurrency, setDisplayCurrency] = useState(() => getDefaultCurrency());
  const [items, setItems] = useState<CashFlowItem[]>([]);
  const [summary, setSummary] = useState<CashFlowSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAddPayment, setShowAddPayment] = useState(false);

  const TYPE_CONFIG = {
    liability_payment: { label: t("cashflow.types.liabilityPayment"), color: "text-neg", sign: "−" },
    subscription: { label: t("cashflow.types.subscription"), color: "text-warn", sign: "−" },
    income: { label: t("cashflow.types.income"), color: "text-pos", sign: "+" },
    recurring_income: { label: t("cashflow.types.recurringIncome"), color: "text-pos", sign: "+" },
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
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#176B5B] hover:bg-[#125848] text-sm font-semibold text-white shadow-sm transition-colors"
        >
          <Plus size={15} />
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
        <div className="flex items-center gap-1 bg-surface border border-line rounded-full p-1">
          {DAYS_OPTIONS.map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                days === d ? "bg-[#176B5B] text-white" : "text-ink-mute hover:text-ink-soft"
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
          <span className="px-2.5 py-1 rounded-full bg-neg/10 border border-neg/30 text-neg text-xs font-medium animate-pulse">
            {urgentCount} {t("cashflow.urgent")}
          </span>
        )}
      </div>

      {/* Summary Card — hidden for a truly-empty user (no upcoming items AND no liquid),
          so the page leads with the empty state instead of a card full of zeros. */}
      {loading ? (
        <div className="h-32 bg-surface-2 border border-line rounded-2xl animate-pulse mb-6" />
      ) : summary && (sortedDates.length > 0 || liquidAssets > 0) && (
        <div className="bg-surface border border-line rounded-2xl p-6 mb-6">
          <p className="text-ink-mute text-xs mb-4">{t("cashflow.upcomingPrefix")} {days} {t("cashflow.days")}</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-ink-mute text-xs mb-1">{t("cashflow.expectedIncome")}</p>
              <p className="text-pos font-semibold tabular-nums">{fmt(incomeTotal, displayCurrency)}</p>
            </div>
            <div>
              <p className="text-ink-mute text-xs mb-1">{t("cashflow.expectedPayments")}</p>
              <p className="text-neg font-semibold tabular-nums">{fmt(paymentsTotal, displayCurrency)}</p>
            </div>
            <div>
              <p className="text-ink-mute text-xs mb-1">{t("cashflow.projectedNet")}</p>
              <p className={`font-semibold tabular-nums ${netTotal >= 0 ? "text-pos" : "text-neg"}`}>
                {netTotal >= 0 ? "+" : ""}{fmt(netTotal, displayCurrency)}
              </p>
            </div>
            <div>
              <p className="text-ink-mute text-xs mb-1">{t("cashflow.liquidAssets")}</p>
              <p className="text-ink-soft font-semibold tabular-nums">{fmt(liquidAssets, displayCurrency)}</p>
              {summary.liquid_to_payments_ratio !== null && (
                <p className={`text-xs mt-0.5 ${
                  summary.liquid_to_payments_ratio < 1 ? "text-neg" :
                  summary.liquid_to_payments_ratio < 2 ? "text-warn" : "text-ink-mute"
                }`}>
                  {(summary.liquid_to_payments_ratio * 100).toFixed(0)}{t("cashflow.coveragePct")}
                </p>
              )}
            </div>
          </div>

          {summary.warning && (
            <div className="mt-4 flex items-start gap-2 bg-neg/10 border border-neg/30 rounded-xl px-4 py-3">
              <span className="text-neg text-sm shrink-0">⚠</span>
              <p className="text-neg text-xs leading-relaxed">{summary.warning}</p>
            </div>
          )}
        </div>
      )}

      {/* Timeline */}
      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="space-y-2">
              <div className="h-4 w-32 bg-surface-2 rounded animate-pulse" />
              <div className="h-14 bg-surface-2 border border-line rounded-xl animate-pulse" />
            </div>
          ))}
        </div>
      ) : sortedDates.length === 0 ? (
        <div className="bg-surface border border-line border-dashed rounded-2xl p-12 text-center">
          <div className="w-12 h-12 rounded-2xl bg-canvas border border-line flex items-center justify-center mx-auto mb-4">
            <Calendar size={22} className="text-[#176B5B]" />
          </div>
          <p className="text-ink-soft text-sm font-medium">{t("cashflow.noItems")}</p>
          <p className="text-ink-mute text-xs mt-2 max-w-sm mx-auto">{t("cashflow.noItemsHint")}</p>
          <div className="flex items-center justify-center gap-3 mt-5">
            <button onClick={() => setShowAddPayment(true)} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#176B5B] hover:bg-[#125848] text-white text-sm font-medium transition-colors">
              <Plus size={15} /> {t("cashflow.addPayment")}
            </button>
            <Link href="/upload" className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-line text-ink-soft hover:border-[#176B5B] text-sm transition-colors">
              <Upload size={15} /> {t("nav.upload")}
            </Link>
          </div>
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
                  <span className="text-xs font-semibold text-ink-mute">{formatDate(dateStr)}</span>
                  {badge && (
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      badge === t("cashflow.today")
                        ? "bg-[#176B5B]/10 text-[#176B5B] border border-[#176B5B]/20"
                        : "bg-surface-2 text-ink-mute"
                    }`}>
                      {badge}
                    </span>
                  )}
                  {hasUrgent && !badge && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-neg/10 text-neg border border-neg/40">
                      {t("cashflow.urgent")}
                    </span>
                  )}
                </div>

                <div className={`bg-surface border rounded-xl overflow-hidden ${
                  hasUrgent ? "border-neg/40" : "border-line"
                }`}>
                  {dayItems.map((item, idx) => {
                    const cfg = TYPE_CONFIG[item.type] ?? TYPE_CONFIG.subscription;
                    return (
                      <div
                        key={`${dateStr}-${idx}`}
                        className={`flex items-center gap-3 px-4 py-3 ${
                          idx < dayItems.length - 1 ? "border-b border-line" : ""
                        } ${item.urgent ? "bg-neg/[0.06]" : ""}`}
                      >
                        <ItemIcon type={item.type} urgent={item.urgent} />
                        <div className="flex-1 min-w-0">
                          <p className="text-ink-soft text-sm truncate">{item.description}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                              item.type === "liability_payment" ? "bg-neg/10 text-neg" :
                              item.type === "subscription" ? "bg-warn/10 text-warn" :
                              "bg-pos/10 text-pos"
                            }`}>
                              {cfg.label}
                            </span>
                            {item.source === "subscription" && (
                              <span className="text-[10px] text-ink-mute">{t("cashflow.fromHistory")}</span>
                            )}
                            {item.source === "recurring_income" && (
                              <span className="text-[10px] text-ink-mute">{t("cashflow.types.recurringIncome")}</span>
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
        <div className="mt-8 flex flex-wrap gap-4 text-xs text-ink-mute">
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-neg" />{t("cashflow.legend.creditPayment")}</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-warn" />{t("cashflow.legend.subscriptionEstimate")}</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-pos" />{t("cashflow.legend.incomeReceivable")}</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-neg animate-ping inline-block" />{t("cashflow.legend.withinDays")}</span>
        </div>
      )}
    </PageLayout>
  );
}
