"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import PageLayout from "@/components/ui/PageLayout";
import AddTransactionModal from "@/components/AddTransactionModal";
import { ArrowRight, Zap, Bell, DollarSign, Brain, Upload, Plus, Scale, CheckCircle } from "@/components/ui/Icons";
import { useLanguage } from "@/lib/i18n";
import { card, cardSm, sectionHeading } from "@/lib/design";
import {
  getToken,
  getStoredUser,
  getNetWorthSummary,
  getNetWorthHistory,
  getReconciliationItems,
  scanReconciliation,
  getNotifications,
  getReceivables,
  getProgress,
  getInsights,
  generateDailyNotifications,
  markNotificationRead,
  type NetWorthSummary,
  type NetworthSnapshot,
  type ReconciliationItem,
  type AppNotification,
  type ReceivableItem,
  type ProgressResponse,
} from "@/lib/api";

const DISPLAY_CURRENCY = "TRY";

function fmt(value: number, currency = DISPLAY_CURRENCY): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: currency === "TRY" ? 0 : 2,
    }).format(value);
  } catch {
    return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value)} ${currency}`;
  }
}

function truncateSentences(text: string, count: number): string {
  const parts = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (parts.length <= count) return text.trim();
  return parts.slice(0, count).join(" ").trim();
}

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`bg-[#2A2A2A] rounded-lg animate-pulse ${className}`} />;
}

type ActionItem = {
  key: string;
  icon: React.ReactNode;
  accent: string;
  title: string;
  detail: string;
  onAction?: () => void;
  actionLabel: string;
  href?: string;
};

export default function HomePage() {
  const router = useRouter();
  const { lang, t } = useLanguage();

  // Section 1 — headline
  const [summary, setSummary] = useState<NetWorthSummary | null>(null);
  const [snapshots, setSnapshots] = useState<NetworthSnapshot[] | null>(null);
  const [headlineLoading, setHeadlineLoading] = useState(true);

  // Section 2 — action items
  const [reconItems, setReconItems] = useState<ReconciliationItem[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [overdueReceivables, setOverdueReceivables] = useState<ReceivableItem[]>([]);
  const [actionsLoading, setActionsLoading] = useState(true);

  // Section 3 — this month
  const [progress, setProgress] = useState<ProgressResponse | null>(null);
  const [progressLoading, setProgressLoading] = useState(true);

  // Section 4 — AI observation
  const [insight, setInsight] = useState<string | null>(null);
  const [insightLoading, setInsightLoading] = useState(true);

  // Quick action modal
  const [txModalOpen, setTxModalOpen] = useState(false);

  useEffect(() => {
    if (!getToken() || !getStoredUser()) {
      router.replace("/login");
      return;
    }

    // Section 1 — net worth + history
    Promise.all([
      getNetWorthSummary(DISPLAY_CURRENCY).catch(() => null),
      getNetWorthHistory(90).catch(() => null),
    ])
      .then(([s, h]) => {
        setSummary(s);
        setSnapshots(h);
      })
      .finally(() => setHeadlineLoading(false));

    // Section 2 — action items (scan first, then read)
    scanReconciliation()
      .catch(() => null)
      .then(() => generateDailyNotifications(lang).catch(() => null))
      .then(() =>
        Promise.all([
          getReconciliationItems("open").catch(() => []),
          getNotifications().catch(() => []),
          getReceivables().catch(() => []),
        ]),
      )
      .then(([items, notifs, receivables]) => {
        setReconItems(items.slice(0, 5));
        setNotifications(notifs.filter((n) => !n.is_read).slice(0, 3));
        setOverdueReceivables(receivables.filter((r) => r.status === "overdue").slice(0, 3));
      })
      .finally(() => setActionsLoading(false));

    // Section 3 — this month
    getProgress()
      .then(setProgress)
      .catch(() => null)
      .finally(() => setProgressLoading(false));

    // Section 4 — AI observation
    getInsights()
      .then((res) => setInsight(res.insight?.trim() || null))
      .catch(() => null)
      .finally(() => setInsightLoading(false));
  }, [router, lang]);

  // Net worth delta from last 2 snapshots (computed in USD %, applied to display value)
  const nwDelta: { value: number; pct: number; positive: boolean } | null = (() => {
    if (!snapshots || snapshots.length < 2 || !summary) return null;
    const prev = parseFloat(snapshots[snapshots.length - 2].net_worth_usd);
    const curr = parseFloat(snapshots[snapshots.length - 1].net_worth_usd);
    if (!prev || isNaN(prev) || isNaN(curr)) return null;
    const pct = ((curr - prev) / Math.abs(prev)) * 100;
    const value = summary.net_worth_try * (pct / 100);
    return { value, pct, positive: curr - prev >= 0 };
  })();

  const hasAssets = summary != null && (summary.total_assets_try > 0 || summary.total_liabilities_try > 0);

  // Build unified action list
  const actionItems: ActionItem[] = [];
  reconItems.forEach((item) => {
    actionItems.push({
      key: `recon-${item.id}`,
      icon: <Zap size={16} />,
      accent: item.severity === "high" ? "text-red-400" : item.severity === "medium" ? "text-amber-400" : "text-gray-400",
      title: item.title,
      detail: item.description,
      actionLabel: t("home.review"),
      href: "/networth",
    });
  });
  overdueReceivables.forEach((r) => {
    actionItems.push({
      key: `recv-${r.id}`,
      icon: <DollarSign size={16} />,
      accent: "text-orange-400",
      title: `${r.from_person} · ${fmt(parseFloat(r.amount), r.currency)}`,
      detail: t("home.overdue"),
      actionLabel: t("home.review"),
      href: "/networth",
    });
  });
  notifications.forEach((n) => {
    actionItems.push({
      key: `notif-${n.id}`,
      icon: <Bell size={16} />,
      accent: n.type === "alert" ? "text-red-400" : n.type === "warning" ? "text-amber-400" : "text-indigo-400",
      title: n.title,
      detail: n.message,
      actionLabel: t("home.continue"),
      onAction: () => {
        markNotificationRead(n.id).catch(() => null);
        setNotifications((prev) => prev.filter((x) => x.id !== n.id));
      },
    });
  });

  // This month line
  const monthLine = (() => {
    if (!progress || progress.months.length === 0) return null;
    const m = progress.months[progress.months.length - 1];
    const income = parseFloat(m.total_income) || 0;
    const expense = parseFloat(m.total_spent) || 0;
    return { income, expense, net: income - expense };
  })();

  // Sparkline points from monthly net (last 4)
  const sparkPoints = (() => {
    if (!progress || progress.months.length < 2) return null;
    const nets = progress.months.slice(-4).map((m) => (parseFloat(m.total_income) || 0) - (parseFloat(m.total_spent) || 0));
    const min = Math.min(...nets);
    const max = Math.max(...nets);
    const range = max - min || 1;
    const w = 80;
    const h = 24;
    return nets
      .map((v, i) => {
        const x = (i / (nets.length - 1)) * w;
        const y = h - ((v - min) / range) * h;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  })();

  return (
    <PageLayout maxWidth="md">
      <div className="space-y-4 mt-2">
        {/* 1 — HEADLINE */}
        <section className={card}>
          {headlineLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-10 w-56" />
            </div>
          ) : !hasAssets ? (
            <Link href="/networth" className="flex items-center justify-between group">
              <div>
                <p className={sectionHeading}>{t("home.netWorth")}</p>
                <p className="text-xl font-bold text-white mt-2 group-hover:text-indigo-400 transition-colors">
                  {t("home.addNetWorth")} <ArrowRight size={18} className="inline -mt-1" />
                </p>
                <p className="text-gray-500 text-sm mt-1">{t("home.addNetWorthSub")}</p>
              </div>
              <Scale size={28} className="text-gray-700 shrink-0" />
            </Link>
          ) : (
            <div>
              <p className={sectionHeading}>{t("home.netWorth")}</p>
              <div className="flex items-end flex-wrap gap-3 mt-2">
                <span className={`text-4xl font-bold tabular-nums ${summary!.net_worth_try >= 0 ? "text-white" : "text-red-400"}`}>
                  {fmt(summary!.net_worth_try)}
                </span>
                {nwDelta && (
                  <span
                    className={`text-sm font-semibold tabular-nums px-2 py-1 rounded-lg mb-1 ${
                      nwDelta.positive ? "bg-emerald-950/50 text-emerald-400" : "bg-red-950/50 text-red-400"
                    }`}
                  >
                    {nwDelta.positive ? "▲ +" : "▼ "}
                    {fmt(nwDelta.value)}
                    <span className="text-xs ml-1 opacity-70">({nwDelta.pct >= 0 ? "+" : ""}{nwDelta.pct.toFixed(1)}%)</span>
                  </span>
                )}
              </div>
              {nwDelta && <p className="text-gray-500 text-xs mt-1.5">{t("home.thisWeek")}</p>}
            </div>
          )}
        </section>

        {/* 2 — ACTION ITEMS */}
        <section className={card}>
          <div className="flex items-center justify-between mb-3">
            <p className={sectionHeading}>{t("home.needsAttention")}</p>
            <Link href="/networth" className="text-indigo-400 text-xs hover:text-indigo-300 transition-colors flex items-center gap-1">
              {t("home.viewAll")} <ArrowRight size={12} />
            </Link>
          </div>

          {actionsLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-full" />)}
            </div>
          ) : actionItems.length === 0 ? (
            <div className="flex items-center gap-3 py-3">
              <CheckCircle size={20} className="text-emerald-400 shrink-0" />
              <div>
                <p className="text-white text-sm font-medium">{t("home.allClear")}</p>
                <p className="text-gray-500 text-xs">{t("home.allClearSub")}</p>
              </div>
            </div>
          ) : (
            <ul className="space-y-2">
              {actionItems.map((item) => {
                const Inner = (
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-[#0F0F0F] border border-[#2A2A2A] hover:border-[#3A3A3A] transition-colors">
                    <span className={`shrink-0 ${item.accent}`}>{item.icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm font-medium truncate">{item.title}</p>
                      <p className="text-gray-500 text-xs truncate">{item.detail}</p>
                    </div>
                    <span className="text-indigo-400 text-xs font-medium shrink-0 flex items-center gap-1">
                      {item.actionLabel} <ArrowRight size={12} />
                    </span>
                  </div>
                );
                return (
                  <li key={item.key}>
                    {item.href ? (
                      <Link href={item.href}>{Inner}</Link>
                    ) : (
                      <button onClick={item.onAction} className="w-full text-left">{Inner}</button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* 3 — THIS MONTH */}
        <section className={card}>
          <div className="flex items-center justify-between mb-3">
            <p className={sectionHeading}>{t("home.thisMonth")}</p>
            <Link href="/transactions" className="text-indigo-400 text-xs hover:text-indigo-300 transition-colors flex items-center gap-1">
              {t("home.viewTransactions")} <ArrowRight size={12} />
            </Link>
          </div>

          {progressLoading ? (
            <Skeleton className="h-8 w-full" />
          ) : !monthLine ? (
            <p className="text-gray-500 text-sm">{t("home.noMonthData")}</p>
          ) : (
            <div className="flex items-center justify-between gap-4">
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
                <span className="text-emerald-400 font-semibold tabular-nums">
                  +{fmt(monthLine.income)} <span className="text-gray-500 font-normal text-xs">{t("home.income")}</span>
                </span>
                <span className="text-red-400 font-semibold tabular-nums">
                  -{fmt(monthLine.expense)} <span className="text-gray-500 font-normal text-xs">{t("home.expense")}</span>
                </span>
                <span className={`font-semibold tabular-nums ${monthLine.net >= 0 ? "text-white" : "text-orange-400"}`}>
                  {monthLine.net >= 0 ? "" : "−"}{fmt(Math.abs(monthLine.net))} <span className="text-gray-500 font-normal text-xs">{t("home.net")}</span>
                </span>
              </div>
              {sparkPoints && (
                <svg width="80" height="24" viewBox="0 0 80 24" className="shrink-0 hidden sm:block">
                  <polyline
                    points={sparkPoints}
                    fill="none"
                    stroke={monthLine.net >= 0 ? "#34d399" : "#fb923c"}
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </div>
          )}
        </section>

        {/* 4 — AI OBSERVATION (skip silently if none) */}
        {(insightLoading || insight) && (
          <section className={card}>
            <div className="flex items-center gap-2 mb-2">
              <Brain size={15} className="text-indigo-400" />
              <p className={sectionHeading}>{t("home.aiTitle")}</p>
            </div>
            {insightLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            ) : (
              <div>
                <p className="text-gray-200 text-sm leading-relaxed">{truncateSentences(insight!, 2)}</p>
                <Link href="/transactions" className="text-indigo-400 text-xs hover:text-indigo-300 transition-colors mt-2 inline-flex items-center gap-1">
                  {t("home.continue")} <ArrowRight size={12} />
                </Link>
              </div>
            )}
          </section>
        )}

        {/* 5 — QUICK ACTIONS */}
        <section>
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
        </section>
      </div>

      {txModalOpen && (
        <AddTransactionModal
          onClose={() => setTxModalOpen(false)}
          onSuccess={() => setTxModalOpen(false)}
        />
      )}
    </PageLayout>
  );
}
