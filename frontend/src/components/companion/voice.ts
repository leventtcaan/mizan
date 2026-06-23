/**
 * Mim's voice — what the companion notices on each page.
 *
 * Mim reads the same data the page shows and surfaces exactly ONE specific thing:
 * the nearest payment, the biggest holding, a spending swing, a score that moved.
 * Everything is computed from real numbers — nothing scripted, nothing generic.
 * If there's nothing worth saying, Mim stays quiet (returns null).
 */

import {
  getDefaultCurrency,
  getAssets, getNetWorthSummary,
  getCashFlowUpcoming, getCashFlowSummary,
  getSimulatorLevers,
  getTransactions,
  getScorecard,
  getRecurring,
  getReceivables,
  getCurrencyRates,
} from "@/lib/api";
import { MimMood } from "./mood";

export type VoiceContext = "networth" | "cashflow" | "simulator" | "transactions" | "progress" | "recurring";

export interface Observation {
  line: string;
  mood: MimMood;
  /** Tapping the bubble opens the assistant with this question already typed. */
  prefill: string;
  /** Stable identity for memory — Mim won't repeat the same observation in a session. */
  key: string;
}

export function contextFromPath(pathname: string): VoiceContext | null {
  if (pathname.startsWith("/networth")) return "networth";
  if (pathname.startsWith("/cashflow")) return "cashflow";
  if (pathname.startsWith("/simulator")) return "simulator";
  if (pathname.startsWith("/transactions")) return "transactions";
  if (pathname.startsWith("/progress")) return "progress";
  if (pathname.startsWith("/recurring")) return "recurring";
  return null;
}

// Translator type — passed in so voice stays a pure data layer over the i18n hook.
type T = (key: string) => string;

function money(n: number, ccy: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency", currency: ccy, maximumFractionDigits: ccy === "TRY" ? 0 : 2,
    }).format(n);
  } catch {
    return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(n)} ${ccy}`;
  }
}

function fill(s: string, vars: Record<string, string | number>): string {
  return Object.entries(vars).reduce((acc, [k, v]) => acc.replaceAll(`{${k}}`, String(v)), s);
}

function daysUntil(iso: string): number {
  const d = new Date(iso + "T12:00:00").getTime();
  const now = new Date(); now.setHours(12, 0, 0, 0);
  return Math.round((d - now.getTime()) / 86400000);
}

/** "is due in 3 days" / "bugün ödenecek" — self-contained per language. */
function whenPhrase(t: T, group: "when" | "recv", n: number): string {
  if (n <= 0) return group === "when" ? t("companion.when.today") : t("companion.recv.today");
  if (n === 1) return group === "when" ? t("companion.when.tomorrow") : t("companion.recv.tomorrow");
  const key = group === "when" ? "companion.when.inDays" : "companion.recv.inDays";
  return fill(t(key), { n });
}

// ── per-context observers ──

async function observeNetworth(t: T, ccy: string): Promise<Observation | null> {
  const summary = await getNetWorthSummary(ccy);
  const totalAssets = summary.total_assets_try;
  if (totalAssets <= 0) {
    return { key: "nw:empty", line: t("companion.nw.empty"), mood: "calm", prefill: t("companion.nw.emptyAsk") };
  }
  const [assets, rates] = await Promise.all([getAssets(), getCurrencyRates("USD").catch(() => ({}))]);
  // Convert each asset into display currency via USD pivot to find the true heavyweight.
  let top: { name: string; value: number } | null = null;
  for (const a of assets) {
    const raw = parseFloat(a.current_value) || 0;
    if (raw <= 0) continue;
    let val = raw;
    if (a.currency !== ccy) {
      const rf = (rates as Record<string, number>)[a.currency];
      const rt = (rates as Record<string, number>)[ccy];
      if (!rf || !rt) continue;
      val = (raw / rf) * rt;
    }
    if (!top || val > top.value) top = { name: a.name, value: val };
  }
  if (!top) return null;
  const pct = Math.round((top.value / totalAssets) * 100);
  if (pct >= 40) {
    return {
      key: `nw:top:${top.name}`,
      line: fill(t("companion.nw.concentrated"), { name: top.name, pct }),
      mood: "concerned",
      prefill: fill(t("companion.nw.concentratedAsk"), { name: top.name }),
    };
  }
  return {
    key: `nw:top:${top.name}`,
    line: fill(t("companion.nw.largest"), { name: top.name, pct }),
    mood: "calm",
    prefill: fill(t("companion.nw.largestAsk"), { name: top.name }),
  };
}

async function observeCashflow(t: T, ccy: string): Promise<Observation | null> {
  const items = await getCashFlowUpcoming(30, ccy); // already converted + sorted by date
  const payment = items.find((i) => i.type === "liability_payment" || i.type === "subscription");
  if (payment) {
    const n = daysUntil(payment.date);
    return {
      key: `cf:pay:${payment.description}`,
      line: fill(t("companion.cashflow.nextPayment"), {
        name: payment.description, when: whenPhrase(t, "when", n),
      }),
      mood: n <= 3 ? "concerned" : "calm",
      prefill: t("companion.cashflow.paymentAsk"),
    };
  }
  const incoming = items.find((i) => i.source === "receivable");
  if (incoming) {
    const n = daysUntil(incoming.date);
    const name = incoming.description.replace(/^Receivable:\s*/i, "");
    const when = incoming.overdue ? t("companion.recv.overdue") : whenPhrase(t, "recv", n);
    return {
      key: `cf:recv:${name}`,
      line: fill(t("companion.cashflow.receivable"), {
        name, amt: money(parseFloat(incoming.amount) || 0, ccy), when,
      }),
      mood: incoming.overdue ? "concerned" : "calm",
      prefill: t("companion.cashflow.receivableAsk"),
    };
  }
  return { key: "cf:clear", line: t("companion.cashflow.clear"), mood: "happy", prefill: t("companion.cashflow.clearAsk") };
}

async function observeSimulator(t: T, ccy: string): Promise<Observation | null> {
  const levers = await getSimulatorLevers(ccy);
  if (levers.debts.length > 0) {
    const d = [...levers.debts].sort((a, b) => b.remaining - a.remaining)[0];
    return {
      key: `sim:debt:${d.label}`,
      line: fill(t("companion.sim.debt"), { name: d.label }),
      mood: "thinking",
      prefill: fill(t("companion.sim.debtAsk"), { name: d.label }),
    };
  }
  if (levers.subscriptions.length > 0) {
    const monthly = levers.subscriptions.reduce((s, x) => s + (x.monthly_amount || 0), 0);
    return {
      key: "sim:subs",
      line: fill(t("companion.sim.subs"), { amt: money(monthly, ccy) }),
      mood: "thinking",
      prefill: t("companion.sim.subsAsk"),
    };
  }
  return { key: "sim:invite", line: t("companion.sim.invite"), mood: "thinking", prefill: t("companion.sim.inviteAsk") };
}

async function observeTransactions(t: T, ccy: string): Promise<Observation | null> {
  const txns = await getTransactions(true);
  const day = 86400000;
  const now = Date.now();
  const thisW: Record<string, number> = {};
  const lastW: Record<string, number> = {};
  const last30: Record<string, number> = {};
  for (const tx of txns) {
    if (tx.transaction_type !== "debit") continue;
    const ts = new Date(tx.transaction_date + "T12:00:00").getTime();
    const cat = tx.category ?? "diger";
    const amt = parseFloat(tx.amount) || 0;
    const age = now - ts;
    if (age <= 7 * day) thisW[cat] = (thisW[cat] || 0) + amt;
    else if (age <= 14 * day) lastW[cat] = (lastW[cat] || 0) + amt;
    if (age <= 30 * day) last30[cat] = (last30[cat] || 0) + amt;
  }
  const catLabel = (slug: string) => {
    const l = t(`category.${slug}`);
    return l === `category.${slug}` ? slug : l;
  };
  // Biggest week-over-week jump (absolute), provided it's a clear increase.
  let swing: { cat: string; pct: number } | null = null;
  for (const cat of Object.keys(thisW)) {
    const tw = thisW[cat]; const lw = lastW[cat] || 0;
    if (lw <= 0 || tw <= lw) continue;
    const pct = Math.round(((tw - lw) / lw) * 100);
    if (pct < 20) continue;
    if (!swing || (tw - lw) > 0) {
      if (!swing || pct > swing.pct) swing = { cat, pct };
    }
  }
  if (swing) {
    return {
      key: `tx:swing:${swing.cat}`,
      line: fill(t("companion.tx.swing"), { pct: swing.pct, cat: catLabel(swing.cat) }),
      mood: swing.pct >= 40 ? "concerned" : "calm",
      prefill: fill(t("companion.tx.swingAsk"), { cat: catLabel(swing.cat) }),
    };
  }
  // Fallback — biggest category over the last 30 days.
  const entries = Object.entries(last30).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0 || entries[0][1] <= 0) return null;
  const [topCat, topAmt] = entries[0];
  return {
    key: `tx:top:${topCat}`,
    line: fill(t("companion.tx.top"), { cat: catLabel(topCat), amt: money(topAmt, ccy) }),
    mood: "calm",
    prefill: fill(t("companion.tx.topAsk"), { cat: catLabel(topCat) }),
  };
}

async function observeProgress(t: T, ccy: string): Promise<Observation | null> {
  const sc = await getScorecard(ccy);
  if (!sc.has_data) return null;
  const score = Math.round(sc.score);
  const delta = sc.score_delta;
  if (delta != null && Math.round(delta) > 0) {
    return {
      key: "pr:score:up",
      line: fill(t("companion.progress.up"), { score, delta: Math.round(delta) }),
      mood: "happy", prefill: t("companion.progress.upAsk"),
    };
  }
  if (delta != null && Math.round(delta) < 0) {
    return {
      key: "pr:score:down",
      line: fill(t("companion.progress.down"), { score, delta: Math.abs(Math.round(delta)) }),
      mood: "concerned", prefill: t("companion.progress.downAsk"),
    };
  }
  return { key: "pr:score:flat", line: fill(t("companion.progress.flat"), { score }), mood: "calm", prefill: t("companion.progress.flatAsk") };
}

async function observeRecurring(t: T, ccy: string): Promise<Observation | null> {
  const { summary } = await getRecurring(ccy);
  const count = summary.subscription_count + summary.installment_count;
  if (count <= 0) return null;
  return {
    key: "rc:summary",
    line: fill(t("companion.recurring.summary"), { count, amt: money(parseFloat(summary.monthly_total) || 0, ccy) }),
    mood: "calm",
    prefill: t("companion.recurring.summaryAsk"),
  };
}

const OBSERVERS: Record<VoiceContext, (t: T, ccy: string) => Promise<Observation | null>> = {
  networth: observeNetworth,
  cashflow: observeCashflow,
  simulator: observeSimulator,
  transactions: observeTransactions,
  progress: observeProgress,
  recurring: observeRecurring,
};

/** Mim looks around the current page and notices one thing — or stays quiet. */
export async function observe(context: VoiceContext, t: T): Promise<Observation | null> {
  try {
    return await OBSERVERS[context](t, getDefaultCurrency());
  } catch {
    return null;
  }
}

/**
 * What Mim should raise on its own, regardless of which page you're on — the things
 * that can't wait for you to wander over to them. Returns the single most urgent item,
 * or null. The caller dedupes by `key` so a flagged-then-dismissed item won't nag.
 */
export async function checkEscalation(t: T): Promise<Observation | null> {
  const ccy = getDefaultCurrency();
  try {
    // 1) Overdue receivable — money you're owed that's late.
    const recvs = await getReceivables().catch(() => []);
    const overdue = recvs.find((r) => r.status === "overdue");
    if (overdue) {
      return {
        key: `esc:recv:${overdue.id}`,
        mood: "alert",
        line: fill(t("companion.escalation.overdueReceivable"), {
          name: overdue.from_person, amt: money(parseFloat(overdue.amount) || 0, overdue.currency),
        }),
        prefill: t("companion.escalation.overdueReceivableAsk"),
      };
    }

    // 2) A payment due within three days.
    const items = await getCashFlowUpcoming(7, ccy).catch(() => []);
    const soon = items
      .filter((i) => i.type === "liability_payment" || i.type === "subscription")
      .map((i) => ({ i, d: daysUntil(i.date) }))
      .filter((x) => x.d >= 0 && x.d <= 3)
      .sort((a, b) => a.d - b.d)[0];
    if (soon) {
      return {
        key: `esc:pay:${soon.i.description}:${soon.i.date}`,
        mood: "concerned",
        line: fill(t("companion.escalation.paymentDue"), {
          name: soon.i.description, when: whenPhrase(t, "when", soon.d),
        }),
        prefill: t("companion.escalation.paymentDueAsk"),
      };
    }

    // 3) Liquidity can't cover what's coming up.
    const sum = await getCashFlowSummary(30, ccy).catch(() => null);
    if (sum && sum.warning) {
      return {
        key: "esc:liquidity",
        mood: "alert",
        line: t("companion.escalation.liquidity"),
        prefill: t("companion.escalation.liquidityAsk"),
      };
    }
  } catch {
    /* stay quiet on any failure */
  }
  return null;
}
