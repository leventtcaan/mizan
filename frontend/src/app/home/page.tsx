"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import PageLayout from "@/components/ui/PageLayout";
import AddTransactionModal from "@/components/AddTransactionModal";
import {
  ArrowRight, Zap, Bell, DollarSign, Brain, Upload, Plus, Scale, CheckCircle,
  TrendingUp, TrendingDown, Calendar, X as XIcon, CreditCard, Wallet,
} from "@/components/ui/Icons";
import { useLanguage } from "@/lib/i18n";
import { card, cardSm, sectionHeading } from "@/lib/design";
import {
  getToken, getStoredUser,
  getNetWorthSummary, getNetWorthHistory, getCashFlowSummary, getCashFlowUpcoming,
  getReconciliationItems, scanReconciliation, getNotifications, getReceivables,
  getProgress, getInsights, generateDailyNotifications, getNetWorthAttribution,
  getDefaultCurrency, CURRENCY_CHANGE_EVENT,
  markNotificationRead, updateReconciliationItemStatus,
  type NetWorthSummary, type NetworthSnapshot, type CashFlowSummary, type CashFlowItem,
  type ReconciliationItem, type AppNotification, type ReceivableItem, type ProgressResponse,
  type NetWorthAttribution,
} from "@/lib/api";

// Mutable module default kept in sync with the user's preferred currency, so the
// many fmt(value) calls below format in the right currency without threading a prop.
let ACTIVE_CCY = "TRY";

function fmt(value: number, currency = ACTIVE_CCY): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency", currency, maximumFractionDigits: currency === "TRY" ? 0 : 2,
    }).format(value);
  } catch {
    return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value)} ${currency}`;
  }
}

function pct(n: number): string {
  return `${n >= 0 ? "" : "−"}${Math.abs(n).toFixed(0)}%`;
}

function daysUntil(dateStr: string): number {
  const d = new Date(dateStr);
  const now = new Date();
  d.setHours(0, 0, 0, 0); now.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - now.getTime()) / 86400000);
}

function truncateSentences(text: string, count: number): string {
  const parts = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  return parts.length <= count ? text.trim() : parts.slice(0, count).join(" ").trim();
}

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`bg-[#2A2A2A] rounded-lg animate-pulse ${className}`} />;
}

// Map reconciliation issue_type → translated title (mirrors networth page).
const RECON_TITLE_KEY: Record<string, string> = {
  overdue_receivable: "nw.recon.overdueTitle",
  received_receivable_missing_asset: "nw.recon.missingAssetTitle",
  possible_duplicate_transaction: "nw.recon.duplicateTitle",
  large_transaction_review: "nw.recon.largeTxTitle",
};

type Urgency = "today" | "week" | "whenever";
type ActionItem = {
  key: string; urgency: Urgency; icon: React.ReactNode; accent: string;
  title: string; detail: string; href?: string; onDismiss?: () => void;
};

const URGENCY_ORDER: Urgency[] = ["today", "week", "whenever"];

export default function HomePage() {
  const router = useRouter();
  const { lang, t } = useLanguage();
  const [ccy, setCcy] = useState("TRY");

  // Sync the user's preferred currency into local state + the module fmt default,
  // and react live when it's changed from Settings.
  useEffect(() => {
    const apply = (code: string) => { ACTIVE_CCY = code; setCcy(code); };
    apply(getDefaultCurrency());
    const handler = (e: Event) => apply((e as CustomEvent<string>).detail);
    window.addEventListener(CURRENCY_CHANGE_EVENT, handler);
    return () => window.removeEventListener(CURRENCY_CHANGE_EVENT, handler);
  }, []);

  // "1 gün", "3 gün" (non-abbreviated)
  const dayLabel = (n: number) => `${n} ${n === 1 ? t("home.day") : t("home.days")}`;
  // Localize backend "Receivable: X" prefix → "Alacak: X"
  const flowLabel = (f: CashFlowItem) =>
    f.description.startsWith("Receivable: ")
      ? `${t("home.receivable")}: ${f.description.slice("Receivable: ".length)}`
      : f.description;
  // Route each cash-flow item to the page where it's actually managed.
  const hrefForFlow = (f: CashFlowItem) =>
    f.source === "liability" ? "/networth"
      : f.source === "receivable" ? "/networth"
      : f.source === "subscription" ? "/recurring"
      : "/cashflow";

  // Snapshot (net worth + ratios + health)
  const [summary, setSummary] = useState<NetWorthSummary | null>(null);
  const [snapshots, setSnapshots] = useState<NetworthSnapshot[] | null>(null);
  const [cashflow, setCashflow] = useState<CashFlowSummary | null>(null);
  const [attribution, setAttribution] = useState<NetWorthAttribution | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(true);

  // Action center
  const [reconItems, setReconItems] = useState<ReconciliationItem[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [overdueReceivables, setOverdueReceivables] = useState<ReceivableItem[]>([]);
  const [urgentFlows, setUrgentFlows] = useState<CashFlowItem[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [actionsLoading, setActionsLoading] = useState(true);

  // Cash flow pulse
  const [progress, setProgress] = useState<ProgressResponse | null>(null);
  const [pulseLoading, setPulseLoading] = useState(true);

  // Upcoming obligations
  const [upcoming, setUpcoming] = useState<CashFlowItem[]>([]);
  const [upcomingLoading, setUpcomingLoading] = useState(true);

  // Insight
  const [insight, setInsight] = useState<string | null>(null);
  const [insightLoading, setInsightLoading] = useState(true);

  const [txModalOpen, setTxModalOpen] = useState(false);

  // One-time guided tour: nudge the user to add assets/liabilities once they reach Home,
  // instead of forcing it as an onboarding form step. Shown a single time, ever.
  const [tourVisible, setTourVisible] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (localStorage.getItem("mizan_tour_shown") !== "1") {
      localStorage.setItem("mizan_tour_shown", "1");
      setTourVisible(true);
    }
  }, []);

  const loadAll = useCallback((scan: boolean) => {
    Promise.all([
      getNetWorthSummary(ccy).catch(() => null),
      getNetWorthHistory(90).catch(() => null),
      getCashFlowSummary(30, ccy).catch(() => null),
    ]).then(([s, h, cf]) => { setSummary(s); setSnapshots(h); setCashflow(cf); })
      .finally(() => setSnapshotLoading(false));

    getNetWorthAttribution(ccy).then(setAttribution).catch(() => setAttribution(null));

    // On event-driven refresh, skip the heavy scan/generate (avoids re-creating items);
    // just re-read the current open items.
    const prep = scan
      ? scanReconciliation().catch(() => null).then(() => generateDailyNotifications(lang).catch(() => null))
      : Promise.resolve();
    prep
      .then(() => Promise.all([
        getReconciliationItems("open").catch(() => []),
        getNotifications().catch(() => []),
        getReceivables().catch(() => []),
        getCashFlowUpcoming(30, ccy).catch(() => []),
      ]))
      .then(([items, notifs, receivables, flows]) => {
        setReconItems(items);
        setNotifications(notifs.filter((n) => !n.is_read));
        setOverdueReceivables(receivables.filter((r) => r.status === "overdue"));
        setUrgentFlows(flows.filter((f) => f.urgent || f.overdue));
      })
      .finally(() => setActionsLoading(false));

    getProgress().then(setProgress).catch(() => null).finally(() => setPulseLoading(false));

    getCashFlowUpcoming(30, ccy).then((f) => setUpcoming(f)).catch(() => null).finally(() => setUpcomingLoading(false));

    getInsights().then((r) => setInsight(r.insight?.trim() || null)).catch(() => null).finally(() => setInsightLoading(false));
  }, [lang, ccy]);

  useEffect(() => {
    if (!getToken() || !getStoredUser()) { router.replace("/login"); return; }
    loadAll(true);
  }, [router, loadAll]);

  // Refresh after the global assistant confirms an action.
  useEffect(() => {
    const handler = () => loadAll(false);
    window.addEventListener("mizan-data-changed", handler);
    return () => window.removeEventListener("mizan-data-changed", handler);
  }, [loadAll]);

  const hasAssets = summary != null && (summary.total_assets_try > 0 || summary.total_liabilities_try > 0);

  // Cold-start completion signals for the getting-started checklist.
  const hasBank = !!summary && Object.entries(summary.assets_by_type || {}).some(([k, v]) => (k === "bank_account" || k === "cash") && v > 0);
  const hasDebt = !!summary && (summary.total_liabilities_try > 0 || Object.keys(summary.liabilities_by_type || {}).length > 0);
  const hasStatement = !!progress && ((progress.total_transactions ?? 0) > 0 || progress.months.length > 0);
  const checklist = [
    { done: hasBank, label: t("home.checklist.bank"), href: "/networth" },
    { done: hasDebt, label: t("home.checklist.debt"), href: "/networth" },
    { done: hasStatement, label: t("home.checklist.statement"), href: "/upload" },
  ];
  // A user who uploaded a statement (transactions, no assets) is NOT cold-start:
  // lead with the cash-flow pulse + insight, not the "add net worth" checklist.
  const hasData = hasAssets || hasStatement;
  const statementOnly = hasStatement && !hasAssets;

  // --- derived: net worth delta ---
  const nwDelta = (() => {
    if (!snapshots || snapshots.length < 2 || !summary) return null;
    const prev = parseFloat(snapshots[snapshots.length - 2].net_worth_usd);
    const curr = parseFloat(snapshots[snapshots.length - 1].net_worth_usd);
    if (!prev || isNaN(prev) || isNaN(curr)) return null;
    const p = ((curr - prev) / Math.abs(prev)) * 100;
    return { value: summary.net_worth_try * (p / 100), pct: p, positive: curr - prev >= 0 };
  })();

  // --- derived: ratios ---
  const liquidityRatio = (() => {
    if (!summary || !cashflow || summary.total_assets_try <= 0) return null;
    return Math.max(0, Math.min(1, parseFloat(cashflow.liquid_assets) / summary.total_assets_try));
  })();
  const debtRatio = (() => {
    if (!summary || summary.total_assets_try <= 0) return null;
    return Math.max(0, summary.total_liabilities_try / summary.total_assets_try);
  })();
  const health: "healthy" | "warning" | "critical" | null = (() => {
    if (debtRatio == null && liquidityRatio == null) return null;
    const d = debtRatio ?? 0;
    const l = liquidityRatio ?? 1;
    if (d > 0.7 || l < 0.05) return "critical";
    if (d > 0.4 || l < 0.15) return "warning";
    return "healthy";
  })();
  const HEALTH_STYLE = {
    healthy: { dot: "bg-emerald-400", text: "text-emerald-400", bg: "bg-emerald-950/40 border-emerald-800/40" },
    warning: { dot: "bg-amber-400", text: "text-amber-400", bg: "bg-amber-950/40 border-amber-800/40" },
    critical: { dot: "bg-red-400", text: "text-red-400", bg: "bg-red-950/40 border-red-800/40" },
  } as const;

  // --- derived: month pulse ---
  // TRY→display factor derived from the backend's own converted month expense total,
  // so transaction-derived figures (categories) show in the chosen currency too.
  const ccyFactor = (() => {
    if (!progress || !cashflow || progress.months.length === 0) return 1;
    const rawExpense = parseFloat(progress.months[progress.months.length - 1].total_spent) || 0;
    const convExpense = parseFloat(cashflow.month_expenses_actual) || 0;
    return rawExpense > 0 && convExpense > 0 ? convExpense / rawExpense : 1;
  })();

  const monthLine = (() => {
    if (!progress || progress.months.length === 0) return null;
    const m = progress.months[progress.months.length - 1];
    const prevM = progress.months.length >= 2 ? progress.months[progress.months.length - 2] : null;
    // Prefer the backend's converted actuals; fall back to raw progress while cashflow loads.
    const income = cashflow ? parseFloat(cashflow.month_income_actual) || 0 : parseFloat(m.total_income) || 0;
    const expense = cashflow ? parseFloat(cashflow.month_expenses_actual) || 0 : parseFloat(m.total_spent) || 0;
    const net = income - expense;
    // Trend is a percentage → currency-agnostic, computed from raw progress.
    const prevNet = prevM ? (parseFloat(prevM.total_income) || 0) - (parseFloat(prevM.total_spent) || 0) : null;
    const curNetRaw = (parseFloat(m.total_income) || 0) - (parseFloat(m.total_spent) || 0);
    const trend = prevNet != null && prevNet !== 0 ? ((curNetRaw - prevNet) / Math.abs(prevNet)) * 100 : null;
    const savingsRate = income > 0 ? (net / income) * 100 : null;
    return { income, expense, net, trend, savingsRate, byCategory: m.by_category };
  })();

  const topCategories = (() => {
    if (!monthLine) return [];
    const entries = Object.entries(monthLine.byCategory)
      .map(([k, v]) => [k, (parseFloat(v) || 0) * ccyFactor] as [string, number])
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    const max = entries.length ? entries[0][1] : 1;
    return entries.map(([cat, val]) => ({ cat, val, width: Math.max(6, (val / max) * 100) }));
  })();

  // Month-anchored projection: liquid + (expected income − expected payments) for rest of month.
  const projectedMonthEnd = (() => {
    if (!cashflow) return null;
    return parseFloat(cashflow.projected_month_end);
  })();

  // --- derived: net worth shrank driver (top expense category) ---
  const shrankDriver = (() => {
    if (!nwDelta || nwDelta.positive || topCategories.length === 0) return null;
    return topCategories[0].cat;
  })();

  // --- build action center ---
  const actionItems: ActionItem[] = [];
  overdueReceivables.forEach((r) => {
    const k = `recv-${r.id}`;
    if (dismissed.has(k)) return;
    actionItems.push({
      key: k, urgency: "today", icon: <DollarSign size={16} />, accent: "text-orange-400",
      title: `${r.from_person} · ${fmt(parseFloat(r.amount), r.currency)}`, detail: t("home.overdue"),
      href: "/networth", onDismiss: () => setDismissed((s) => new Set(s).add(k)),
    });
  });
  urgentFlows.forEach((f, i) => {
    const k = `flow-${i}-${f.date}-${f.description}`;
    if (dismissed.has(k)) return;
    const isPayment = f.type === "liability_payment" || f.type === "subscription";
    const du = daysUntil(f.date);
    // Only receivables can be genuinely overdue; payments are recurring (never overdue).
    const detail = f.overdue ? t("home.overdue") : du <= 0 ? t("home.dueToday") : dayLabel(du);
    actionItems.push({
      key: k, urgency: (f.overdue || du <= 0) ? "today" : "week",
      icon: isPayment ? <CreditCard size={16} /> : <Wallet size={16} />,
      accent: f.overdue ? "text-red-400" : "text-amber-400",
      title: `${flowLabel(f)} · ${fmt(parseFloat(f.amount), f.currency)}`,
      detail,
      href: hrefForFlow(f), onDismiss: () => setDismissed((s) => new Set(s).add(k)),
    });
  });
  reconItems.forEach((item) => {
    const k = `recon-${item.id}`;
    if (dismissed.has(k)) return;
    actionItems.push({
      key: k, urgency: item.severity === "high" ? "today" : item.severity === "medium" ? "week" : "whenever",
      icon: <Zap size={16} />,
      accent: item.severity === "high" ? "text-red-400" : item.severity === "medium" ? "text-amber-400" : "text-gray-400",
      title: RECON_TITLE_KEY[item.issue_type] ? t(RECON_TITLE_KEY[item.issue_type]) : item.title,
      detail: item.description, href: "/networth",
      onDismiss: () => {
        setDismissed((s) => new Set(s).add(k));
        updateReconciliationItemStatus(item.id, "dismissed").catch(() => null);
      },
    });
  });
  notifications.forEach((n) => {
    const k = `notif-${n.id}`;
    if (dismissed.has(k)) return;
    actionItems.push({
      key: k, urgency: n.type === "alert" ? "today" : n.type === "warning" ? "week" : "whenever",
      icon: <Bell size={16} />,
      accent: n.type === "alert" ? "text-red-400" : n.type === "warning" ? "text-amber-400" : "text-indigo-400",
      title: n.title, detail: n.message,
      onDismiss: () => {
        setDismissed((s) => new Set(s).add(k));
        markNotificationRead(n.id).catch(() => null);
      },
    });
  });
  const sortedActions = actionItems
    .sort((a, b) => URGENCY_ORDER.indexOf(a.urgency) - URGENCY_ORDER.indexOf(b.urgency))
    .slice(0, 5);
  const groupedActions: Record<Urgency, ActionItem[]> = { today: [], week: [], whenever: [] };
  sortedActions.forEach((a) => groupedActions[a.urgency].push(a));
  const URGENCY_LABEL: Record<Urgency, string> = {
    today: t("home.today"), week: t("home.thisWeekGroup"), whenever: t("home.whenever"),
  };

  // upcoming obligations (compact, 30d, top 5 by date)
  const sortedUpcoming = [...upcoming].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()).slice(0, 5);

  return (
    <PageLayout maxWidth="md">
      <div className="flex flex-col gap-4 mt-2">

        {/* 1 — FINANCIAL SNAPSHOT
            Hidden for statement-only users so the Cash Flow Pulse leads (no premature
            "add your net worth" checklist right after they uploaded a statement). */}
        {!statementOnly && (
        <section className={card}>
          {snapshotLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-10 w-56" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : !hasAssets ? (
            <div>
              <p className={sectionHeading}>{t("home.netWorth")}</p>
              <p className="text-lg font-bold text-white mt-2">{t("home.addNetWorth")}</p>
              <p className="text-gray-500 text-sm mt-1 mb-4">{t("home.addNetWorthSub")}</p>
              <div className="space-y-2">
                {checklist.map((item, i) => (
                  <Link
                    key={i}
                    href={item.href}
                    className="flex items-center gap-3 p-3 rounded-lg bg-[#0F0F0F] border border-[#2A2A2A] hover:border-indigo-700 transition-colors group"
                  >
                    {item.done ? (
                      <CheckCircle size={18} className="text-emerald-400 shrink-0" />
                    ) : (
                      <span className="w-[18px] h-[18px] rounded-full border-2 border-[#3A3A3A] shrink-0" />
                    )}
                    <span className={`flex-1 text-sm ${item.done ? "text-gray-500 line-through" : "text-white"}`}>{item.label}</span>
                    {!item.done && <ArrowRight size={14} className="text-gray-700 group-hover:text-indigo-400 transition-colors shrink-0" />}
                  </Link>
                ))}
              </div>
            </div>
          ) : (
            <div>
              {/* headline */}
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className={sectionHeading}>{t("home.netWorth")}</p>
                  <div className="flex items-end flex-wrap gap-3 mt-2">
                    <span className={`text-4xl font-bold tabular-nums ${summary!.net_worth_try >= 0 ? "text-white" : "text-red-400"}`}>
                      {fmt(summary!.net_worth_try)}
                    </span>
                    {nwDelta && (
                      <span className={`text-sm font-semibold tabular-nums px-2 py-1 rounded-lg mb-1 ${nwDelta.positive ? "bg-emerald-950/50 text-emerald-400" : "bg-red-950/50 text-red-400"}`}>
                        {nwDelta.positive ? "▲ +" : "▼ "}{fmt(nwDelta.value)}
                        <span className="text-xs ml-1 opacity-70">({nwDelta.pct >= 0 ? "+" : ""}{nwDelta.pct.toFixed(1)}%)</span>
                      </span>
                    )}
                  </div>
                  {nwDelta && (
                    <p className="text-gray-500 text-xs mt-1.5 flex items-center gap-1">
                      {nwDelta.positive
                        ? <><TrendingUp size={12} className="text-emerald-400" /> {t("home.grew")}</>
                        : <><TrendingDown size={12} className="text-red-400" /> {t("home.shrank")}{shrankDriver && <> · {t("home.driver")}: {t(`category.${shrankDriver}`)}</>}</>}
                    </p>
                  )}
                </div>
                {/* health signal */}
                {health && (
                  <div className={`shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-full border ${HEALTH_STYLE[health].bg}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${HEALTH_STYLE[health].dot}`} />
                    <span className={`text-xs font-semibold ${HEALTH_STYLE[health].text}`}>{t(`home.${health}`)}</span>
                  </div>
                )}
              </div>

              {/* why it moved — change attribution */}
              {attribution && attribution.drivers.length > 0 && (
                <div className="mt-3 pt-3 border-t border-[#2A2A2A]">
                  <p className="text-[10px] font-bold tracking-wider text-gray-600 mb-2">{t("home.story.title")}</p>
                  <div className="flex flex-wrap gap-2">
                    {attribution.drivers.map((d, i) => (
                      <span
                        key={i}
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium ${
                          d.direction === "up" ? "bg-emerald-950/40 text-emerald-300" : "bg-red-950/40 text-red-300"
                        }`}
                      >
                        {d.direction === "up" ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                        <span className="text-gray-400 font-normal">{d.label}</span>
                        {d.direction === "up" ? "+" : "−"}{fmt(d.amount)}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* ratios */}
              <div className="grid grid-cols-2 gap-3 mt-4">
                <div className="bg-[#0F0F0F] border border-[#2A2A2A] rounded-lg p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500 text-xs">{t("home.liquidity")}</span>
                    <span className="text-white text-sm font-semibold tabular-nums">{liquidityRatio != null ? pct(liquidityRatio * 100) : "—"}</span>
                  </div>
                  <div className="mt-2 h-1.5 rounded-full bg-[#2A2A2A] overflow-hidden">
                    <div className="h-full rounded-full bg-sky-400" style={{ width: `${(liquidityRatio ?? 0) * 100}%` }} />
                  </div>
                  <p className="text-gray-600 text-[10px] mt-1">{t("home.liquidityHint")}</p>
                </div>
                <div className="bg-[#0F0F0F] border border-[#2A2A2A] rounded-lg p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500 text-xs">{t("home.debtRatio")}</span>
                    <span className="text-white text-sm font-semibold tabular-nums">{debtRatio != null ? pct(debtRatio * 100) : "—"}</span>
                  </div>
                  <div className="mt-2 h-1.5 rounded-full bg-[#2A2A2A] overflow-hidden">
                    <div
                      className={`h-full rounded-full ${(debtRatio ?? 0) > 0.7 ? "bg-red-400" : (debtRatio ?? 0) > 0.4 ? "bg-amber-400" : "bg-emerald-400"}`}
                      style={{ width: `${Math.min(100, (debtRatio ?? 0) * 100)}%` }}
                    />
                  </div>
                  <p className="text-gray-600 text-[10px] mt-1">&nbsp;</p>
                </div>
              </div>
            </div>
          )}
        </section>
        )}

        {/* 2 — ACTION CENTER */}
        <section className={`${card} ${statementOnly ? "order-3" : ""}`}>
          <div className="flex items-center justify-between mb-3">
            <p className={sectionHeading}>{t("home.needsAttention")}</p>
            <Link href="/networth" className="text-indigo-400 text-xs hover:text-indigo-300 transition-colors flex items-center gap-1">
              {t("home.viewAll")} <ArrowRight size={12} />
            </Link>
          </div>

          {actionsLoading ? (
            <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
          ) : sortedActions.length === 0 ? (
            !hasAssets && !hasStatement ? (
              <Link href="/networth" className="flex items-center gap-3 p-3 rounded-lg bg-[#0F0F0F] border border-[#2A2A2A] hover:border-indigo-700 transition-colors group">
                <Scale size={18} className="text-emerald-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-medium">{t("home.firstActionTitle")}</p>
                  <p className="text-gray-500 text-xs">{t("home.firstActionSub")}</p>
                </div>
                <ArrowRight size={14} className="text-gray-700 group-hover:text-indigo-400 transition-colors shrink-0" />
              </Link>
            ) : (
              <div className="flex items-center gap-3 py-3">
                <CheckCircle size={20} className="text-emerald-400 shrink-0" />
                <p className="text-white text-sm font-medium">{t("home.allClear")}</p>
              </div>
            )
          ) : (
            <div className="space-y-3">
              {URGENCY_ORDER.filter((u) => groupedActions[u].length > 0).map((u) => (
                <div key={u}>
                  <p className="text-[10px] font-bold tracking-wider text-gray-600 mb-1.5">{URGENCY_LABEL[u]}</p>
                  <ul className="space-y-2">
                    {groupedActions[u].map((item) => (
                      <li key={item.key} className="flex items-center gap-2.5 p-3 rounded-lg bg-[#0F0F0F] border border-[#2A2A2A]">
                        <span className={`shrink-0 ${item.accent}`}>{item.icon}</span>
                        {item.href ? (
                          <Link href={item.href} className="flex-1 min-w-0 group">
                            <p className="text-white text-sm font-medium truncate group-hover:text-indigo-300 transition-colors">{item.title}</p>
                            <p className="text-gray-500 text-xs truncate">{item.detail}</p>
                          </Link>
                        ) : (
                          <div className="flex-1 min-w-0">
                            <p className="text-white text-sm font-medium truncate">{item.title}</p>
                            <p className="text-gray-500 text-xs truncate">{item.detail}</p>
                          </div>
                        )}
                        {item.onDismiss && (
                          <button onClick={item.onDismiss} title={t("home.dismiss")} className="shrink-0 text-gray-600 hover:text-gray-300 transition-colors p-1">
                            <XIcon size={14} />
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 3 — CASH FLOW PULSE */}
        <section className={`${card} ${statementOnly ? "order-1" : ""}`}>
          <div className="flex items-center justify-between mb-3">
            <p className={sectionHeading}>{t("home.cashflowPulse")}</p>
            <Link href="/transactions" className="text-indigo-400 text-xs hover:text-indigo-300 transition-colors flex items-center gap-1">
              {t("home.viewTransactions")} <ArrowRight size={12} />
            </Link>
          </div>

          {pulseLoading ? (
            <div className="space-y-3"><Skeleton className="h-8 w-full" /><Skeleton className="h-16 w-full" /></div>
          ) : !monthLine ? (
            <div>
              <p className="text-gray-400 text-sm mb-3">{t("home.noMonthData")}</p>
              <div className="flex flex-wrap gap-2">
                <Link href="/upload" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0F0F0F] border border-[#2A2A2A] hover:border-indigo-700 text-xs text-white transition-colors">
                  <Upload size={13} className="text-indigo-400" /> {t("home.uploadStatement")}
                </Link>
                <button onClick={() => setTxModalOpen(true)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0F0F0F] border border-[#2A2A2A] hover:border-indigo-700 text-xs text-white transition-colors">
                  <Plus size={13} className="text-amber-400" /> {t("home.addTransaction")}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* income / expense / net + trend */}
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
                <span className="text-emerald-400 font-semibold tabular-nums">+{fmt(monthLine.income)} <span className="text-gray-500 font-normal text-xs">{t("home.income")}</span></span>
                <span className="text-red-400 font-semibold tabular-nums">-{fmt(monthLine.expense)} <span className="text-gray-500 font-normal text-xs">{t("home.expense")}</span></span>
                <span className={`font-semibold tabular-nums ${monthLine.net >= 0 ? "text-white" : "text-orange-400"}`}>
                  {monthLine.net >= 0 ? "" : "−"}{fmt(Math.abs(monthLine.net))} <span className="text-gray-500 font-normal text-xs">{t("home.net")}</span>
                </span>
                {monthLine.trend != null && (
                  <span className={`text-xs flex items-center gap-0.5 ${monthLine.trend >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {monthLine.trend >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                    {pct(monthLine.trend)} <span className="text-gray-600">{t("home.vsLastMonth")}</span>
                  </span>
                )}
              </div>

              {/* projected month-end + savings rate */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-[#0F0F0F] border border-[#2A2A2A] rounded-lg p-3">
                  <p className="text-gray-500 text-xs">{t("home.projectedMonthEnd")}</p>
                  <p className={`text-base font-semibold tabular-nums mt-1 ${projectedMonthEnd != null && projectedMonthEnd < 0 ? "text-red-400" : "text-white"}`}>
                    {projectedMonthEnd != null ? fmt(projectedMonthEnd) : "—"}
                  </p>
                </div>
                <div className="bg-[#0F0F0F] border border-[#2A2A2A] rounded-lg p-3">
                  <p className="text-gray-500 text-xs">{t("home.savingsRate")}</p>
                  <p className={`text-base font-semibold tabular-nums mt-1 ${monthLine.savingsRate != null && monthLine.savingsRate < 0 ? "text-orange-400" : "text-emerald-400"}`}>
                    {monthLine.savingsRate != null ? pct(monthLine.savingsRate) : "—"}
                  </p>
                </div>
              </div>

              {/* top categories — CSS bars */}
              {topCategories.length > 0 && (
                <div>
                  <p className="text-gray-500 text-xs mb-2">{t("home.topSpending")}</p>
                  <div className="space-y-2">
                    {topCategories.map((c) => (
                      <div key={c.cat} className="flex items-center gap-3">
                        <span className="text-gray-400 text-xs w-20 shrink-0 truncate">{t(`category.${c.cat}`)}</span>
                        <div className="flex-1 h-2 rounded-full bg-[#2A2A2A] overflow-hidden">
                          <div className="h-full rounded-full bg-indigo-500" style={{ width: `${c.width}%` }} />
                        </div>
                        <span className="text-gray-300 text-xs tabular-nums w-20 text-right shrink-0">{fmt(c.val)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        {/* 4 — UPCOMING OBLIGATIONS */}
        <section className={`${card} ${statementOnly ? "order-4" : ""}`}>
          <div className="flex items-center justify-between mb-3">
            <p className={sectionHeading}>{t("home.upcoming")}</p>
            <Link href="/cashflow" className="text-indigo-400 text-xs hover:text-indigo-300 transition-colors flex items-center gap-1">
              {t("home.viewCalendar")} <ArrowRight size={12} />
            </Link>
          </div>

          {upcomingLoading ? (
            <div className="space-y-2">{[1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : sortedUpcoming.length === 0 ? (
            <p className="text-gray-500 text-sm">{t("home.noUpcoming")}</p>
          ) : (
            <ul className="space-y-1.5">
              {sortedUpcoming.map((f, i) => {
                const du = daysUntil(f.date);
                const inflow = f.type === "income" || f.type === "recurring_income";
                return (
                  <li key={`${f.date}-${f.description}-${i}`} className="flex items-center gap-3 py-1.5">
                    <span className={`shrink-0 ${inflow ? "text-emerald-400" : f.overdue ? "text-red-400" : "text-gray-500"}`}>
                      {inflow ? <Wallet size={15} /> : <Calendar size={15} />}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm truncate">{flowLabel(f)}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`text-sm font-medium tabular-nums ${inflow ? "text-emerald-400" : "text-gray-200"}`}>
                        {inflow ? "+" : "−"}{fmt(parseFloat(f.amount), f.currency)}
                      </p>
                      <p className={`text-[10px] ${f.overdue ? "text-red-400 font-medium" : "text-gray-600"}`}>
                        {f.overdue ? t("home.overdue") : du <= 0 ? t("home.dueToday") : dayLabel(du)}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* 5 — ONE SMART INSIGHT */}
        <section className={`${card} ${statementOnly ? "order-2" : ""}`}>
          <div className="flex items-center gap-2 mb-2">
            <Brain size={15} className="text-indigo-400" />
            <p className={sectionHeading}>{t("home.aiTitle")}</p>
          </div>
          {insightLoading ? (
            <div className="space-y-2"><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-2/3" /></div>
          ) : insight ? (
            <div>
              <p className="text-gray-200 text-sm leading-relaxed">{truncateSentences(insight, 2)}</p>
              <Link href="/transactions" className="text-indigo-400 text-xs hover:text-indigo-300 transition-colors mt-2 inline-flex items-center gap-1">
                {t("home.continue")} <ArrowRight size={12} />
              </Link>
            </div>
          ) : (
            <p className="text-gray-400 text-sm leading-relaxed">{t("home.welcomeInsight")}</p>
          )}
        </section>

        {/* 6 — QUICK ENTRY */}
        <section className={statementOnly ? "order-5" : ""}>
          <p className={`${sectionHeading} mb-2 px-1`}>{t("home.quickActions")}</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Link href="/upload" className={`${cardSm} flex items-center gap-3 hover:border-indigo-700 transition-colors`}>
              <Upload size={18} className="text-indigo-400 shrink-0" />
              <span className="text-white text-sm font-medium">{t("home.uploadStatement")}</span>
            </Link>
            <Link href="/networth" className={`${cardSm} flex items-center gap-3 hover:border-indigo-700 transition-colors`}>
              <Scale size={18} className="text-emerald-400 shrink-0" />
              <span className="text-white text-sm font-medium">{t("home.addAsset")}</span>
            </Link>
            <button onClick={() => setTxModalOpen(true)} className={`${cardSm} flex items-center gap-3 hover:border-indigo-700 transition-colors text-left`}>
              <Plus size={18} className="text-amber-400 shrink-0" />
              <span className="text-white text-sm font-medium">{t("home.addTransaction")}</span>
            </button>
          </div>
          <div className="flex gap-3 mt-3">
            <Link href="/networth" className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-[#2A2A2A] text-gray-400 hover:text-gray-200 hover:border-[#3A3A3A] text-xs font-medium transition-colors">
              <CreditCard size={14} /> {t("home.addDebt")}
            </Link>
            <Link href="/networth" className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-[#2A2A2A] text-gray-400 hover:text-gray-200 hover:border-[#3A3A3A] text-xs font-medium transition-colors">
              <DollarSign size={14} /> {t("home.addReceivable")}
            </Link>
          </div>
        </section>
      </div>

      {txModalOpen && (
        <AddTransactionModal onClose={() => setTxModalOpen(false)} onSuccess={() => setTxModalOpen(false)} />
      )}

      {/* One-time guided tour — floating, non-blocking coach card */}
      {tourVisible && (
        <div className="fixed bottom-4 inset-x-4 sm:inset-x-auto sm:right-6 sm:bottom-6 sm:max-w-sm z-40">
          <div className="bg-[#1A1A1A] border border-indigo-800/50 rounded-2xl p-4 shadow-2xl shadow-black/50">
            <div className="flex items-start gap-3">
              <span className="shrink-0 w-9 h-9 rounded-lg bg-indigo-950 border border-indigo-800/50 flex items-center justify-center">
                <Scale size={18} className="text-indigo-400" />
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-gray-200 text-sm leading-relaxed mb-3">{t("home.tour.text")}</p>
                <div className="flex flex-wrap gap-2">
                  <Link
                    href="/networth?add=asset"
                    onClick={() => setTourVisible(false)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-colors"
                  >
                    {t("home.tour.addAsset")} <ArrowRight size={13} />
                  </Link>
                  <button
                    onClick={() => setTourVisible(false)}
                    className="px-3 py-2 rounded-lg border border-[#2A2A2A] text-gray-400 hover:text-gray-200 text-xs font-medium transition-colors"
                  >
                    {t("home.tour.later")}
                  </button>
                </div>
              </div>
              <button onClick={() => setTourVisible(false)} title={t("home.dismiss")} className="shrink-0 text-gray-600 hover:text-gray-300 transition-colors">
                <XIcon size={14} />
              </button>
            </div>
          </div>
        </div>
      )}
    </PageLayout>
  );
}
