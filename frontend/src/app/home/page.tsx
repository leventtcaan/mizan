"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import PageLayout from "@/components/ui/PageLayout";
import AddTransactionModal from "@/components/AddTransactionModal";
import {
  ArrowRight, Upload, Plus, Scale, Sparkles, Wallet, CheckCircle,
  Calendar, ChevronDown, ChevronUp, Send,
} from "@/components/ui/Icons";
import Mim from "@/components/companion/Mim";
import { openMim } from "@/components/companion/AskMim";
import { moodFromTone, type MimMood } from "@/components/companion/mood";
import { useLanguage } from "@/lib/i18n";
import { currentMonthLabel } from "@/lib/period";
import {
  getToken, getStoredUser,
  getNetWorthSummary, getCashFlowSummary, getCashFlowUpcoming,
  getReceivables, getReconciliationItems,
  getDefaultCurrency, CURRENCY_CHANGE_EVENT,
  type NetWorthSummary, type CashFlowSummary, type CashFlowItem,
  type ReceivableItem, type ReconciliationItem,
} from "@/lib/api";

const TEAL = "#176B5B";

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
function fmtDate(dateStr: string, lang: string): string {
  try {
    return new Intl.DateTimeFormat(lang === "tr" ? "tr-TR" : "en-US", { day: "numeric", month: "short" }).format(new Date(dateStr));
  } catch { return dateStr; }
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
  const [ccy, setCcy] = useState(() => getDefaultCurrency());
  const [name, setName] = useState("");
  const [mounted, setMounted] = useState(false);

  const [summary, setSummary] = useState<NetWorthSummary | null>(null);
  const [cashflow, setCashflow] = useState<CashFlowSummary | null>(null);
  const [upcoming, setUpcoming] = useState<CashFlowItem[]>([]);
  const [receivables, setReceivables] = useState<ReceivableItem[]>([]);
  const [recon, setRecon] = useState<ReconciliationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [txModalOpen, setTxModalOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);

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
    const u = getStoredUser();
    if (!getToken() || !u) { router.replace("/login"); return; }
    // Verification gate (defense in depth): an unverified user must never reach the
    // app shell, even by typing /home or via the landing "Continue" button.
    if (u.email_verified === false) { router.replace("/verify"); return; }
    setName(u.display_name?.trim() || (u.email ?? "").split("@")[0]);
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
  // Dashboard emphasis: business leads with cash flow + receivables, personal with
  // spending + net worth + the simulator.
  const isBusiness = getStoredUser()?.account_type === "business";
  const receivablesVal = summary?.pending_receivables_try ?? 0;
  const hasData = (summary != null && (summary.total_assets_try > 0 || summary.total_liabilities_try > 0)) || income > 0 || expenses > 0;
  const displayName = name ? name.charAt(0).toUpperCase() + name.slice(1) : "";

  const greeting = (() => {
    const h = new Date().getHours();
    const key = h < 6 ? "evening" : h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
    return t(`home.daily.${key}`);
  })();

  // The one sentence Mim says — clean prose, no template stitching artifacts.
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

  // Full upcoming schedule for the collapsible calendar (next 30 days, soonest first).
  const calendar = [...upcoming].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 6);

  const hasFigures = income > 0 || expenses > 0;
  const mimMood: MimMood = hasFigures ? moodFromTone(verdict.tone) : "calm";
  const monthLabel = currentMonthLabel(lang);

  // What Mim actually offers to talk about — a specific question pulled from the real
  // numbers, not a generic "ask me anything". Priority: the thing that needs you →
  // overspending → a surplus to deploy → growing net worth → a first-step nudge.
  const suggestion: { label: string; prefill: string } = (() => {
    const tr = lang === "tr";
    if (needs.length > 0) {
      const n = needs[0];
      return tr
        ? { label: `“${n.title}” — ne yapmalıyım?`, prefill: `${n.title} (${n.detail}). Bununla ilgili ne yapmalıyım?` }
        : { label: `“${n.title}” — what should I do?`, prefill: `${n.title} (${n.detail}). What should I do about this?` };
    }
    if (hasFigures && net < 0) {
      const over = fmt(Math.abs(net));
      return tr
        ? { label: `Bu ay neden ${over} fazla harcadım?`, prefill: `Bu ay gelirimden ${over} fazla harcadım. En büyük kalemler neydi ve nasıl toparlarım?` }
        : { label: `Why did I overspend by ${over} this month?`, prefill: `I spent ${over} more than I earned this month. Where did it go, and how do I recover?` };
    }
    if (hasFigures && net > 0) {
      const surplus = fmt(net);
      return tr
        ? { label: `${surplus} fazlamla ne yapayım?`, prefill: `Bu ay ${surplus} fazlam var. Bunu en akıllıca nasıl değerlendiririm?` }
        : { label: `What should I do with my ${surplus} surplus?`, prefill: `I have a ${surplus} surplus this month. What's the smartest thing to do with it?` };
    }
    if (netWorth !== 0) {
      return tr
        ? { label: "Net değerimi nasıl büyütürüm?", prefill: `Net değerim ${fmt(netWorth)}. Bunu büyütmek için ilk hangi adımı atmalıyım?` }
        : { label: "How do I grow my net worth?", prefill: `My net worth is ${fmt(netWorth)}. What's the first move to grow it?` };
    }
    return tr
      ? { label: "Nereden başlamalıyım?", prefill: "Finansal durumumu iyileştirmek için nereden başlamalıyım?" }
      : { label: "Where should I start?", prefill: "Where should I start to improve my finances?" };
  })();

  const reveal = () => `transition-all duration-700 ease-out ${mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"}`;

  if (loading) {
    return <PageLayout maxWidth="md"><div className="h-[40vh] flex items-center justify-center"><span className="w-6 h-6 border-2 border-line rounded-full animate-spin" style={{ borderTopColor: TEAL }} /></div></PageLayout>;
  }

  // ── cold start — one warm welcome, two clear actions ──
  if (!hasData) {
    return (
      <PageLayout maxWidth="md">
        <div className={`min-h-[62vh] flex flex-col items-center justify-center text-center ${reveal()}`}>
          <Mim mood="calm" size={96} speaking className="mb-7" />
          <h1 className="text-3xl font-bold mb-3 max-w-md tracking-tight">{t("home.daily.coldTitle")}</h1>
          <p className="text-ink-mute mb-9 max-w-sm leading-relaxed">{t("home.daily.coldSub")}</p>
          <div className="flex flex-col sm:flex-row gap-3 w-full max-w-sm">
            <Link href="/upload" className="flex-1 inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl text-white font-semibold shadow-sm transition-colors" style={{ backgroundColor: TEAL }}>
              <Upload size={18} /> {t("home.daily.coldUpload")}
            </Link>
            <button onClick={() => setTxModalOpen(true)} className="flex-1 inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-surface border border-ink/30 hover:border-[#176B5B] hover:text-[#176B5B] font-semibold text-ink transition-colors">
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
      <div className="flex flex-col gap-10 pt-2 pb-10">

        {/* 1 — Mim greets you, front and center, and says the one thing that matters */}
        <div className={`flex flex-col items-center text-center ${reveal()}`}>
          <Mim mood={mimMood} size={92} speaking className="mb-5" />
          <p className="text-ink-mute text-base mb-2">
            {greeting}{displayName ? `, ${displayName}` : ""}
          </p>
          <h1 className="text-[26px] sm:text-[34px] font-bold leading-[1.15] tracking-tight max-w-xl text-balance">
            {verdict.text}
          </h1>
          {hasFigures && (
            <p className="text-[11px] font-semibold tracking-widest text-ink-mute uppercase mt-3">
              {monthLabel} · {t("home.daily.calendarMonth")}
            </p>
          )}
          {/* Mim hands you a specific question — a speech bubble that begs to be tapped */}
          <button
            onClick={() => openMim(suggestion.prefill)}
            aria-label={suggestion.label}
            className="group relative mt-6 w-full max-w-md mx-auto block text-left"
          >
            {/* tail pointing up toward Mim */}
            <span className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-3 h-3 rotate-45 bg-surface border-l border-t border-[#176B5B]/30 group-hover:border-[#176B5B]/70 transition-colors" />
            <div className="relative flex items-center gap-3 rounded-2xl border border-[#176B5B]/30 bg-surface px-4 py-3.5 shadow-sm transition-all group-hover:-translate-y-0.5 group-hover:shadow-md group-hover:border-[#176B5B]/70">
              <p className="flex-1 text-ink text-[15px] font-medium leading-snug">{suggestion.label}</p>
              <span className="relative shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-full text-white shadow-sm transition-transform group-hover:scale-105" style={{ backgroundColor: TEAL }}>
                {/* idle attention ring so it reads as clickable, not static */}
                <span className="absolute inset-0 rounded-full opacity-50 animate-ping" style={{ backgroundColor: TEAL, animationDuration: "2.6s" }} />
                <Send size={15} className="relative" />
              </span>
            </div>
            <span className="block text-center text-ink-mute text-[11px] mt-2 group-hover:text-[#176B5B] transition-colors">
              {lang === "tr" ? "Sormak için dokun" : "Tap to ask Clar"}
            </span>
          </button>
        </div>

        {/* 2 — What needs you, plus the upcoming calendar (collapsible) */}
        <div className={reveal()} style={{ transitionDelay: "80ms" }}>
          <p className="text-[11px] font-bold tracking-widest text-ink-mute uppercase mb-3">{t("home.daily.needsYou")}</p>
          {needs.length === 0 ? (
            <div className="flex items-center gap-3 px-4 py-4 rounded-2xl bg-surface border border-line">
              <CheckCircle size={20} className="text-pos shrink-0" />
              <p className="text-ink-soft text-sm">{t("home.daily.allClear")}</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {needs.map((n) => (
                <Link key={n.key} href={n.href}
                  className="flex items-center gap-3.5 px-4 py-4 rounded-2xl bg-surface border border-line hover:border-[#176B5B]/60 hover:shadow-sm transition-all group">
                  <span className={`w-1.5 self-stretch rounded-full shrink-0 ${n.severity >= 4 ? "bg-neg" : n.severity >= 3 ? "bg-warn" : "bg-line-strong"}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-ink text-sm font-medium truncate group-hover:text-[#176B5B] transition-colors">{n.title}</p>
                    <p className="text-ink-mute text-xs truncate mt-0.5">{n.detail}</p>
                  </div>
                  <ArrowRight size={16} className="text-ink-mute group-hover:text-[#176B5B] group-hover:translate-x-0.5 transition-all shrink-0" />
                </Link>
              ))}
            </div>
          )}

          {/* Upcoming calendar — open/close as needed */}
          {calendar.length > 0 && (
            <div className="mt-2.5">
              <button
                onClick={() => setCalendarOpen((v) => !v)}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl bg-surface border border-line hover:border-[#176B5B]/40 transition-colors text-left"
              >
                <Calendar size={17} className="text-[#176B5B] shrink-0" />
                <span className="flex-1 text-ink-soft text-sm font-medium">
                  {t("home.daily.upcoming")}
                  <span className="text-ink-mute font-normal"> · {calendar.length}</span>
                </span>
                {calendarOpen ? <ChevronUp size={16} className="text-ink-mute" /> : <ChevronDown size={16} className="text-ink-mute" />}
              </button>
              {calendarOpen && (
                <div className="mt-2 rounded-2xl bg-surface border border-line divide-y divide-line overflow-hidden">
                  {calendar.map((f, i) => {
                    const inflow = f.type === "income" || f.type === "recurring_income";
                    const du = daysUntil(f.date);
                    const desc = f.description.startsWith("Receivable: ") ? `${t("home.receivable")}: ${f.description.slice(12)}` : f.description;
                    return (
                      <div key={`cal-${i}-${f.date}`} className="flex items-center gap-3 px-4 py-3">
                        <div className="w-12 shrink-0 text-center">
                          <p className="text-ink text-xs font-semibold tabular-nums">{fmtDate(f.date, lang)}</p>
                          <p className="text-ink-mute text-[10px]">
                            {f.overdue ? t("home.overdue") : du <= 0 ? t("home.dueToday") : `${du}${lang === "tr" ? "g" : "d"}`}
                          </p>
                        </div>
                        <p className="flex-1 min-w-0 text-ink-soft text-sm truncate">{desc}</p>
                        <p className={`text-sm font-semibold tabular-nums shrink-0 ${inflow ? "text-pos" : "text-ink"}`}>
                          {inflow ? "+" : "−"}{fmt(parseFloat(f.amount), f.currency)}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 3 — Financial snapshot: three taps into the product, one number each */}
        <div className={`grid grid-cols-3 gap-3 ${reveal()}`} style={{ transitionDelay: "160ms" }}>
          <Link href="/transactions" className="rounded-2xl bg-surface border border-line hover:border-[#176B5B]/60 hover:-translate-y-0.5 hover:shadow-md p-4 sm:p-5 transition-all group">
            <span className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-pos/10 mb-3"><Wallet size={17} className="text-pos" /></span>
            <p className="text-ink-mute text-[11px] truncate">{monthLabel}</p>
            <p className={`font-bold tabular-nums text-base sm:text-xl mt-0.5 ${net >= 0 ? "text-ink" : "text-neg"}`}>{net >= 0 ? "+" : "−"}{fmt(Math.abs(net))}</p>
            <p className="text-[10px] text-ink-mute mt-1.5 truncate">{t("home.daily.fromTransactions")}</p>
          </Link>
          {/* Business: receivables (who owes you) is the second-most important number,
              so it takes the middle slot ahead of the simulator. */}
          {isBusiness && (
            <Link href="/networth" className="rounded-2xl bg-surface border border-line hover:border-[#176B5B]/60 hover:-translate-y-0.5 hover:shadow-md p-4 sm:p-5 transition-all">
              <span className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-warn/10 mb-3"><Wallet size={17} className="text-warn" /></span>
              <p className="text-ink-mute text-[11px]">{t("nw.receivables")}</p>
              <p className="font-bold tabular-nums text-base sm:text-xl mt-0.5 text-ink">{fmt(receivablesVal)}</p>
              <p className="text-[10px] text-ink-mute mt-1.5 truncate">{t("home.daily.asOfToday")}</p>
            </Link>
          )}
          <Link href="/networth" className="rounded-2xl bg-surface border border-line hover:border-[#176B5B]/60 hover:-translate-y-0.5 hover:shadow-md p-4 sm:p-5 transition-all">
            <span className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-[#176B5B]/10 mb-3"><Scale size={17} className="text-[#176B5B]" /></span>
            <p className="text-ink-mute text-[11px]">{t("home.daily.netWorth")}</p>
            <p className={`font-bold tabular-nums text-base sm:text-xl mt-0.5 ${netWorth >= 0 ? "text-ink" : "text-neg"}`}>{fmt(netWorth)}</p>
            <p className="text-[10px] text-ink-mute mt-1.5 truncate">{t("home.daily.asOfToday")}</p>
          </Link>
          {/* Personal: the simulator gets the third slot. */}
          {!isBusiness && (
            <Link href="/simulator" className="rounded-2xl bg-surface border border-line hover:border-[#176B5B]/60 hover:-translate-y-0.5 hover:shadow-md p-4 sm:p-5 transition-all group">
              <span className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-[#176B5B]/10 mb-3"><Sparkles size={17} className="text-[#176B5B]" /></span>
              <p className="text-ink-mute text-[11px]">{t("home.daily.simulate")}</p>
              <p className="text-ink-soft text-sm font-medium mt-0.5">{t("home.daily.simulateHint")}</p>
              <p className="text-[10px] text-[#176B5B] mt-1.5 inline-flex items-center gap-0.5 group-hover:gap-1.5 transition-all">{t("home.daily.simulate")} <ArrowRight size={11} /></p>
            </Link>
          )}
        </div>

        {/* 4 — Quick actions: real buttons, not afterthoughts */}
        <div className={reveal()} style={{ transitionDelay: "240ms" }}>
          <p className="text-[11px] font-bold tracking-widest text-ink-mute uppercase mb-3">{t("home.daily.quick")}</p>
          <div className="flex flex-col sm:flex-row gap-3">
            <Link href="/upload" className="flex-1 inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-white font-semibold shadow-sm transition-colors" style={{ backgroundColor: TEAL }}>
              <Upload size={17} /> {t("home.daily.upload")}
            </Link>
            <button onClick={() => setTxModalOpen(true)} className="flex-1 inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-surface border border-ink/30 hover:border-[#176B5B] hover:text-[#176B5B] font-semibold text-ink transition-colors">
              <Plus size={17} /> {t("home.daily.add")}
            </button>
          </div>
        </div>
      </div>

      {txModalOpen && <AddTransactionModal onClose={() => setTxModalOpen(false)} onSuccess={() => { setTxModalOpen(false); loadAll(); }} />}
    </PageLayout>
  );
}
