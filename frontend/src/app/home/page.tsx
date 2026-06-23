"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import PageLayout from "@/components/ui/PageLayout";
import AddTransactionModal from "@/components/AddTransactionModal";
import { ArrowRight, Upload, Plus, Scale, Sparkles, Wallet, CheckCircle, Brain } from "@/components/ui/Icons";
import { useLanguage } from "@/lib/i18n";
import {
  getToken, getStoredUser,
  getNetWorthSummary, getCashFlowSummary, getCashFlowUpcoming,
  getReceivables, getReconciliationItems,
  getDefaultCurrency, CURRENCY_CHANGE_EVENT,
  type NetWorthSummary, type CashFlowSummary, type CashFlowItem,
  type ReceivableItem, type ReconciliationItem,
} from "@/lib/api";

let ACTIVE_CCY = "TRY";
function fmt(value: number, currency = ACTIVE_CCY): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: currency === "TRY" ? 0 : 2 }).format(value);
  } catch {
    return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value)} ${currency}`;
  }
}
function daysUntil(dateStr: string): number {
  const d = new Date(dateStr); const now = new Date();
  d.setHours(0, 0, 0, 0); now.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - now.getTime()) / 86400000);
}

type Tone = "good" | "warn" | "bad";
type NeedItem = { key: string; title: string; detail: string; href: string; severity: number };

const RECON_TITLE_KEY: Record<string, string> = {
  overdue_receivable: "nw.recon.overdueTitle",
  received_receivable_missing_asset: "nw.recon.missingAssetTitle",
  possible_duplicate_transaction: "nw.recon.duplicateTitle",
  large_transaction_review: "nw.recon.largeTxTitle",
  duplicate_statement: "nw.recon.duplicateTitle",
};

export default function HomePage() {
  const router = useRouter();
  const { t, lang } = useLanguage();
  const [ccy, setCcy] = useState("TRY");
  const [name, setName] = useState("");
  const [mounted, setMounted] = useState(false);

  const [summary, setSummary] = useState<NetWorthSummary | null>(null);
  const [cashflow, setCashflow] = useState<CashFlowSummary | null>(null);
  const [upcoming, setUpcoming] = useState<CashFlowItem[]>([]);
  const [receivables, setReceivables] = useState<ReceivableItem[]>([]);
  const [recon, setRecon] = useState<ReconciliationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [txModalOpen, setTxModalOpen] = useState(false);

  useEffect(() => {
    const apply = (code: string) => { ACTIVE_CCY = code; setCcy(code); };
    apply(getDefaultCurrency());
    const h = (e: Event) => apply((e as CustomEvent<string>).detail);
    window.addEventListener(CURRENCY_CHANGE_EVENT, h);
    return () => window.removeEventListener(CURRENCY_CHANGE_EVENT, h);
  }, []);

  const loadAll = useCallback(() => {
    Promise.all([
      getNetWorthSummary(ccy).catch(() => null),
      getCashFlowSummary(30, ccy).catch(() => null),
      getCashFlowUpcoming(30, ccy).catch(() => [] as CashFlowItem[]),
      getReceivables().catch(() => [] as ReceivableItem[]),
      getReconciliationItems("open").catch(() => [] as ReconciliationItem[]),
    ]).then(([s, cf, up, rec, rc]) => {
      setSummary(s); setCashflow(cf); setUpcoming(up || []);
      setReceivables(rec || []); setRecon(rc || []);
    }).finally(() => { setLoading(false); setTimeout(() => setMounted(true), 30); });
  }, [ccy]);

  useEffect(() => {
    if (!getToken() || !getStoredUser()) { router.replace("/login"); return; }
    setName((getStoredUser()?.email ?? "").split("@")[0]);
    loadAll();
  }, [router, loadAll]);

  useEffect(() => {
    const h = () => loadAll();
    window.addEventListener("mizan-data-changed", h);
    return () => window.removeEventListener("mizan-data-changed", h);
  }, [loadAll]);

  // ── derived ──
  const income = cashflow ? parseFloat(cashflow.month_income_actual) || 0 : 0;
  const expenses = cashflow ? parseFloat(cashflow.month_expenses_actual) || 0 : 0;
  const net = income - expenses;
  const netWorth = summary?.net_worth_try ?? 0;
  const hasData = (summary != null && (summary.total_assets_try > 0 || summary.total_liabilities_try > 0)) || income > 0 || expenses > 0;

  const greeting = (() => {
    const h = new Date().getHours();
    const key = h < 6 ? "evening" : h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
    return t(`home.daily.${key}`);
  })();

  // The one sentence.
  const verdict: { text: string; tone: Tone } = (() => {
    if (income === 0 && expenses === 0) return { text: t("home.daily.calm"), tone: "good" };
    if (net >= 0) {
      return {
        tone: "good",
        text: `${t("home.daily.goodPre")} ${fmt(income)} ${t("home.daily.cameIn")}, ${fmt(expenses)} ${t("home.daily.wentOut")}.`,
      };
    }
    return {
      tone: "bad",
      text: `${t("home.daily.badPre")} ${fmt(Math.abs(net))} ${t("home.daily.badPost")}`,
    };
  })();

  // What needs you — ranked, max 2.
  const needs: NeedItem[] = (() => {
    const items: NeedItem[] = [];
    receivables.filter((r) => r.status === "overdue").forEach((r) => {
      const n = r.expected_date ? Math.abs(daysUntil(r.expected_date)) : 0;
      items.push({
        key: `recv-${r.id}`, severity: 4,
        title: `${r.from_person} · ${fmt(parseFloat(r.amount), r.currency)}`,
        detail: n ? `${n} ${t("home.daily.overdueDays")}` : t("home.overdue"),
        href: "/networth",
      });
    });
    upcoming.filter((f) => f.urgent || f.overdue).forEach((f, i) => {
      const du = daysUntil(f.date);
      const inflow = f.type === "income" || f.type === "recurring_income";
      const desc = f.description.startsWith("Receivable: ") ? `${t("home.receivable")}: ${f.description.slice(12)}` : f.description;
      const href = f.source === "subscription" ? "/recurring" : f.source === "liability" || f.source === "receivable" ? "/networth" : "/cashflow";
      items.push({
        key: `up-${i}-${f.date}`, severity: f.overdue ? 4 : du <= 0 ? 3 : 2,
        title: `${desc} · ${fmt(parseFloat(f.amount), f.currency)}`,
        detail: f.overdue ? t("home.overdue") : du <= 0 ? t("home.dueToday") : `${t("home.daily.dueIn")} ${du} ${du === 1 ? t("home.day") : t("home.days")}`,
        href: inflow ? "/cashflow" : href,
      });
    });
    recon.forEach((it) => items.push({
      key: `rc-${it.id}`, severity: it.severity === "high" ? 3 : 2,
      title: RECON_TITLE_KEY[it.issue_type] ? t(RECON_TITLE_KEY[it.issue_type]) : it.title,
      detail: it.description, href: "/networth",
    }));
    return items.sort((a, b) => b.severity - a.severity).slice(0, 2);
  })();

  const askCoach = () => window.dispatchEvent(new CustomEvent("mizan-open-assistant", { detail: { prefill: t("home.daily.askPrefill") } }));

  const TONE_DOT: Record<Tone, string> = { good: "bg-emerald-400", warn: "bg-amber-400", bad: "bg-red-400" };
  const reveal = (d: number) => `transition-all duration-700 ease-out ${mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"}`;

  if (loading) {
    return <PageLayout maxWidth="md"><div className="h-[40vh] flex items-center justify-center"><span className="w-6 h-6 border-2 border-[#2A2A2A] border-t-indigo-400 rounded-full animate-spin" /></div></PageLayout>;
  }

  // ── cold start — one warm prompt, nothing else ──
  if (!hasData) {
    return (
      <PageLayout maxWidth="md">
        <div className={`min-h-[60vh] flex flex-col items-center justify-center text-center ${reveal(0)}`}>
          <div className="w-14 h-14 rounded-2xl bg-indigo-950 border border-indigo-800/50 flex items-center justify-center mb-6">
            <Sparkles size={26} className="text-indigo-400" />
          </div>
          <h1 className="text-3xl font-bold mb-3 max-w-md">{t("home.daily.coldTitle")}</h1>
          <p className="text-gray-500 mb-8 max-w-sm">{t("home.daily.coldSub")}</p>
          <div className="flex flex-col sm:flex-row gap-3">
            <Link href="/upload" className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 font-semibold transition-colors">
              <Upload size={18} /> {t("home.daily.coldUpload")}
            </Link>
            <button onClick={() => setTxModalOpen(true)} className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-[#1A1A1A] border border-[#2A2A2A] hover:bg-[#2A2A2A] font-semibold text-gray-300 transition-colors">
              <Plus size={18} /> {t("home.daily.add")}
            </button>
          </div>
        </div>
        {txModalOpen && <AddTransactionModal onClose={() => setTxModalOpen(false)} onSuccess={() => { setTxModalOpen(false); loadAll(); }} />}
      </PageLayout>
    );
  }

  return (
    <PageLayout maxWidth="md">
      <div className="flex flex-col gap-8 pt-4 pb-8">

        {/* Greeting + the one sentence */}
        <div className={reveal(0)}>
          <div className="flex items-center gap-2 mb-4">
            <span className={`w-2 h-2 rounded-full ${TONE_DOT[verdict.tone]} animate-pulse`} />
            <p className="text-gray-500 text-sm">{greeting}{name ? `, ${name}` : ""}</p>
          </div>
          <h1 className="text-[26px] sm:text-[32px] font-bold leading-snug tracking-tight">
            {verdict.text}
          </h1>
          <button onClick={askCoach} className="mt-4 inline-flex items-center gap-1.5 text-indigo-400 hover:text-indigo-300 text-sm transition-colors">
            <Brain size={14} /> {t("home.daily.askAbout")}
          </button>
        </div>

        {/* What needs you — 0, 1 or 2 things */}
        <div className={`${reveal(100)}`} style={{ transitionDelay: "100ms" }}>
          <p className="text-[11px] font-bold tracking-widest text-gray-600 uppercase mb-3">{t("home.daily.needsYou")}</p>
          {needs.length === 0 ? (
            <div className="flex items-center gap-3 px-4 py-4 rounded-2xl bg-[#1A1A1A] border border-[#2A2A2A]">
              <CheckCircle size={20} className="text-emerald-400 shrink-0" />
              <p className="text-gray-300 text-sm">{t("home.daily.allClear")}</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {needs.map((n) => (
                <Link key={n.key} href={n.href}
                  className="flex items-center gap-3 px-4 py-4 rounded-2xl bg-[#1A1A1A] border border-[#2A2A2A] hover:border-indigo-700/60 transition-colors group">
                  <span className={`w-1.5 h-10 rounded-full shrink-0 ${n.severity >= 4 ? "bg-red-500" : n.severity >= 3 ? "bg-amber-500" : "bg-gray-600"}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium truncate group-hover:text-indigo-200 transition-colors">{n.title}</p>
                    <p className="text-gray-500 text-xs truncate">{n.detail}</p>
                  </div>
                  <ArrowRight size={15} className="text-gray-700 group-hover:text-indigo-400 transition-colors shrink-0" />
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Three quiet taps to the soul — one number each */}
        <div className={`grid grid-cols-3 gap-3 ${reveal(200)}`} style={{ transitionDelay: "200ms" }}>
          <Link href="/transactions" className="rounded-2xl bg-[#1A1A1A] border border-[#2A2A2A] hover:border-indigo-700/60 p-4 transition-colors group">
            <Wallet size={17} className="text-emerald-400 mb-3" />
            <p className="text-gray-500 text-[11px]">{t("home.daily.thisMonth")}</p>
            <p className={`font-bold tabular-nums text-sm sm:text-base mt-0.5 ${net >= 0 ? "text-white" : "text-orange-400"}`}>{net >= 0 ? "+" : "−"}{fmt(Math.abs(net))}</p>
          </Link>
          <Link href="/networth" className="rounded-2xl bg-[#1A1A1A] border border-[#2A2A2A] hover:border-indigo-700/60 p-4 transition-colors">
            <Scale size={17} className="text-indigo-400 mb-3" />
            <p className="text-gray-500 text-[11px]">{t("home.daily.netWorth")}</p>
            <p className={`font-bold tabular-nums text-sm sm:text-base mt-0.5 ${netWorth >= 0 ? "text-white" : "text-red-400"}`}>{fmt(netWorth)}</p>
          </Link>
          <Link href="/simulator" className="rounded-2xl bg-[#1A1A1A] border border-[#2A2A2A] hover:border-indigo-700/60 p-4 transition-colors">
            <Sparkles size={17} className="text-violet-400 mb-3" />
            <p className="text-gray-500 text-[11px]">{t("home.daily.simulate")}</p>
            <p className="text-gray-300 text-sm mt-0.5">{t("home.daily.simulateHint")}</p>
          </Link>
        </div>

        {/* Quiet capture actions */}
        <div className={`flex items-center gap-3 ${reveal(300)}`} style={{ transitionDelay: "300ms" }}>
          <Link href="/upload" className="inline-flex items-center gap-1.5 text-gray-500 hover:text-gray-300 text-sm transition-colors">
            <Upload size={14} /> {t("home.daily.upload")}
          </Link>
          <span className="text-gray-700">·</span>
          <button onClick={() => setTxModalOpen(true)} className="inline-flex items-center gap-1.5 text-gray-500 hover:text-gray-300 text-sm transition-colors">
            <Plus size={14} /> {t("home.daily.add")}
          </button>
        </div>
      </div>

      {txModalOpen && <AddTransactionModal onClose={() => setTxModalOpen(false)} onSuccess={() => { setTxModalOpen(false); loadAll(); }} />}
    </PageLayout>
  );
}
