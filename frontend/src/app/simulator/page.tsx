"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";
import PageLayout from "@/components/ui/PageLayout";
import { card } from "@/lib/design";
import {
  Sparkles, ArrowRight, TrendingUp, TrendingDown, X as XIcon, Send, Brain,
} from "@/components/ui/Icons";
import { useLanguage } from "@/lib/i18n";
import {
  getToken, getDefaultCurrency, CURRENCY_CHANGE_EVENT,
  getSimulatorLevers, runSimulator, askSimulator,
  type SimLevers, type SimResult, type SimAction,
} from "@/lib/api";

const HORIZONS = [12, 24, 36, 60];

export default function SimulatorPage() {
  const router = useRouter();
  const { t, lang } = useLanguage();

  // Lazy-init from the stored display currency so the levers fetch isn't fired under
  // "TRY" and rendered, only to be redone (and visibly flash) under the real currency.
  const [ccy, setCcy] = useState(() => getDefaultCurrency());
  const [levers, setLevers] = useState<SimLevers | null>(null);
  const [actions, setActions] = useState<SimAction[]>([]);
  const [horizon, setHorizon] = useState(24);
  const [result, setResult] = useState<SimResult | null>(null);
  const [running, setRunning] = useState(false);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [askMiss, setAskMiss] = useState(false);
  const [showAssumptions, setShowAssumptions] = useState(false);
  const [incomeDir, setIncomeDir] = useState<"raise" | "cut">("raise");
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!getToken()) { router.replace("/login"); return; }
    const apply = (code: string) => setCcy(code);
    apply(getDefaultCurrency());
    const h = (e: Event) => apply((e as CustomEvent<string>).detail);
    window.addEventListener(CURRENCY_CHANGE_EVENT, h);
    return () => window.removeEventListener(CURRENCY_CHANGE_EVENT, h);
  }, [router]);

  useEffect(() => {
    getSimulatorLevers(ccy).then(setLevers).catch(() => setLevers(null));
  }, [ccy]);

  // Auto-run (debounced) whenever the scenario or horizon changes.
  useEffect(() => {
    if (actions.length === 0) { setResult(null); return; }
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      setRunning(true);
      runSimulator(actions, horizon, ccy, lang)
        .then(setResult)
        .catch(() => setResult(null))
        .finally(() => setRunning(false));
    }, 350);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [actions, horizon, ccy, lang]);

  const money = useCallback((n: number) => {
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency: ccy, maximumFractionDigits: 0 }).format(n);
    } catch {
      return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(n)} ${ccy}`;
    }
  }, [ccy]);

  const signed = (n: number) => `${n >= 0 ? "+" : "−"}${money(Math.abs(n))}`;

  // ── scenario mutators ──
  const isCancelled = (label: string) => actions.some((a) => a.type === "cancel_recurring" && a.label === label);
  const toggleCancel = (label: string, amount: number) =>
    setActions((p) => isCancelled(label)
      ? p.filter((a) => !(a.type === "cancel_recurring" && a.label === label))
      : [...p, { type: "cancel_recurring", amount, label }]);

  const amountOf = (type: string) => {
    const a = actions.find((x) => x.type === type);
    return a ? String(a.amount) : "";
  };
  const setSingle = (type: string, raw: string) => {
    const amt = parseFloat(raw.replace(",", "."));
    setActions((p) => {
      const rest = p.filter((a) => a.type !== type);
      return isNaN(amt) || amt === 0 ? rest : [...rest, { type, amount: amt }];
    });
  };

  const prepayOf = (id: string) => {
    const a = actions.find((x) => x.type === "prepay_debt" && x.debt_id === id);
    return a ? String(a.amount) : "";
  };
  const setPrepay = (id: string, label: string, raw: string) => {
    const amt = parseFloat(raw.replace(",", "."));
    setActions((p) => {
      const rest = p.filter((a) => !(a.type === "prepay_debt" && a.debt_id === id));
      return isNaN(amt) || amt <= 0 ? rest : [...rest, { type: "prepay_debt", amount: amt, label, debt_id: id }];
    });
  };

  // income change: direction toggle + positive magnitude (so the user never types a bare "-")
  const incomeAction = actions.find((a) => a.type === "income_change");
  const incomeMag = incomeAction ? String(Math.abs(incomeAction.amount)) : "";
  const effIncomeDir = incomeAction ? (incomeAction.amount < 0 ? "cut" : "raise") : incomeDir;
  const applyIncome = (dir: "raise" | "cut", raw: string) => {
    setIncomeDir(dir);
    const mag = parseFloat(raw.replace(",", "."));
    setActions((p) => {
      const rest = p.filter((a) => a.type !== "income_change");
      return isNaN(mag) || mag === 0 ? rest : [...rest, { type: "income_change", amount: dir === "cut" ? -mag : mag }];
    });
  };

  const removeAction = (idx: number) => setActions((p) => p.filter((_, i) => i !== idx));

  const renderAction = (a: SimAction): string => {
    switch (a.type) {
      case "cancel_recurring": return `${t("sim.actCancel")} ${a.label ?? ""}`.trim();
      case "save_monthly": return `${t("sim.actSave")}: ${money(a.amount)}`;
      case "income_change": return `${t("sim.actIncome")}: ${a.amount >= 0 ? "+" : "−"}${money(Math.abs(a.amount))}`;
      case "one_time_expense": return `${t("sim.actSpend")}: ${money(a.amount)}`;
      case "prepay_debt": return `${t("sim.actPrepay")} ${a.label ?? ""}: ${money(a.amount)}`.trim();
      default: return a.type;
    }
  };

  const clearAll = () => { setActions([]); setResult(null); setQuestion(""); setAskMiss(false); };

  const ask = async () => {
    const q = question.trim();
    if (!q || asking) return;
    setAsking(true); setAskMiss(false);
    try {
      const res = await askSimulator(q, horizon, ccy, lang);
      if (res.parsed && res.result) {
        setActions(res.actions);       // reflect parsed levers in the builder
        setResult(res.result);
      } else {
        setAskMiss(true);
      }
    } catch {
      setAskMiss(true);
    } finally {
      setAsking(false);
    }
  };

  const chartData = useMemo(() => {
    if (!result) return [];
    return result.baseline.points.map((b, i) => {
      const sc = result.scenario.points[i];
      const v = sc?.net_worth ?? b.net_worth;
      return {
        month: b.month,
        baseline: b.net_worth,
        scenario: v,
        range: [sc?.low ?? v, sc?.high ?? v] as [number, number],
      };
    });
  }, [result]);

  const noData = levers && levers.net_worth === 0 && levers.subscriptions.length === 0
    && levers.debts.length === 0 && levers.monthly_surplus === 0;

  const inputCls = "bg-[#0F0F0F] border border-[#2A2A2A] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-600 w-full";

  return (
    <PageLayout
      title={t("sim.title")}
      titleBadge={<Sparkles size={18} className="text-indigo-400" />}
      subtitle={t("sim.subtitle")}
      maxWidth="lg"
    >
      {noData ? (
        <div className={`${card} text-center py-10`}>
          <Sparkles size={28} className="text-indigo-400 mx-auto mb-3" />
          <p className="text-white font-medium mb-1">{t("sim.emptyTitle")}</p>
          <p className="text-gray-500 text-sm mb-4">{t("sim.emptyBody")}</p>
          <div className="flex justify-center gap-3">
            <Link href="/upload" className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium">{t("sim.emptyUpload")}</Link>
            <Link href="/networth" className="px-4 py-2 rounded-lg border border-[#2A2A2A] text-gray-300 hover:text-white text-sm font-medium">{t("sim.emptyNetworth")}</Link>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {/* Ask in your own words */}
          <section className={card}>
            <div className="flex items-center gap-2 mb-2">
              <Brain size={15} className="text-indigo-400" />
              <p className="text-sm font-semibold text-white">{t("sim.askTitle")}</p>
            </div>
            <div className="flex gap-2">
              <input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void ask(); } }}
                placeholder={t("sim.askPlaceholder")}
                className={inputCls}
              />
              <button onClick={() => void ask()} disabled={asking || !question.trim()}
                className="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white shrink-0">
                {asking ? <span className="block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Send size={16} />}
              </button>
            </div>
            {askMiss && <p className="text-amber-400 text-xs mt-2">{t("sim.askMiss")}</p>}
          </section>

          {/* Lever builder */}
          <section className={card}>
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-white">{t("sim.buildTitle")}</p>
              {actions.length > 0 && (
                <button onClick={clearAll} className="text-gray-500 hover:text-gray-300 text-xs flex items-center gap-1">
                  <XIcon size={12} /> {t("sim.clear")}
                </button>
              )}
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              {/* Save more */}
              <div>
                <label className="text-gray-400 text-xs block mb-1">{t("sim.saveMonthly")}</label>
                <input inputMode="decimal" value={amountOf("save_monthly")} onChange={(e) => setSingle("save_monthly", e.target.value)} placeholder="0" className={inputCls} />
              </div>
              {/* Income change — direction toggle + magnitude (no bare-minus typing) */}
              <div>
                <label className="text-gray-400 text-xs block mb-1">{t("sim.incomeChange")}</label>
                <div className="flex gap-2">
                  <div className="flex rounded-lg overflow-hidden border border-[#2A2A2A] shrink-0">
                    {(["raise", "cut"] as const).map((d) => (
                      <button key={d} onClick={() => applyIncome(d, incomeMag)}
                        className={`px-2.5 text-xs font-medium transition-colors ${effIncomeDir === d
                          ? (d === "raise" ? "bg-emerald-800/40 text-emerald-200" : "bg-red-800/40 text-red-200")
                          : "text-gray-400 hover:text-gray-200"}`}>
                        {d === "raise" ? t("sim.incomeRaise") : t("sim.incomeCut")}
                      </button>
                    ))}
                  </div>
                  <input inputMode="decimal" value={incomeMag} onChange={(e) => applyIncome(effIncomeDir, e.target.value)} placeholder="0" className={inputCls} />
                </div>
              </div>
              {/* One-time purchase */}
              <div>
                <label className="text-gray-400 text-xs block mb-1">{t("sim.oneTime")}</label>
                <input inputMode="decimal" value={amountOf("one_time_expense")} onChange={(e) => setSingle("one_time_expense", e.target.value)} placeholder="0" className={inputCls} />
              </div>
              {/* Horizon */}
              <div>
                <label className="text-gray-400 text-xs block mb-1">{t("sim.horizon")}</label>
                <div className="flex rounded-lg overflow-hidden border border-[#2A2A2A]">
                  {HORIZONS.map((h) => (
                    <button key={h} onClick={() => setHorizon(h)}
                      className={`flex-1 py-2 text-xs font-medium transition-colors ${horizon === h ? "bg-indigo-600 text-white" : "text-gray-400 hover:text-gray-200"}`}>
                      {h}{lang === "tr" ? "a" : "mo"}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Cancel subscriptions — always visible so the feature explains itself */}
            {levers && (
              <div className="mt-4">
                <label className="text-gray-400 text-xs block mb-2">{t("sim.cancelSubs")}</label>
                {levers.subscriptions.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {levers.subscriptions.slice(0, 12).map((s) => (
                      <button key={s.key} onClick={() => toggleCancel(s.label, s.monthly_amount)}
                        className={`px-2.5 py-1.5 rounded-lg text-xs border transition-colors ${isCancelled(s.label)
                          ? "bg-emerald-950/40 border-emerald-700/50 text-emerald-300"
                          : "bg-[#0F0F0F] border-[#2A2A2A] text-gray-300 hover:border-[#3A3A3A]"}`}>
                        {isCancelled(s.label) ? "✓ " : ""}{s.label} · {money(s.monthly_amount)}/{lang === "tr" ? "ay" : "mo"}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-600 text-xs">{t("sim.subsEmpty")}</p>
                )}
              </div>
            )}

            {/* Prepay debts */}
            {levers && levers.debts.length > 0 && (
              <div className="mt-4">
                <label className="text-gray-400 text-xs block mb-2">{t("sim.prepay")}</label>
                <div className="space-y-2">
                  {levers.debts.map((d) => (
                    <div key={d.id} className="flex items-center gap-3">
                      <span className="text-gray-300 text-sm flex-1 min-w-0 truncate">{d.label} <span className="text-gray-600 text-xs">· {money(d.remaining)}</span></span>
                      <input inputMode="decimal" value={prepayOf(d.id)} onChange={(e) => setPrepay(d.id, d.label, e.target.value)} placeholder={t("sim.lumpSum")} className={`${inputCls} w-32`} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* What I understood — parsed/active levers in plain language, so a misparse
              (e.g. NL mode) is visible and correctable instead of silently wrong. */}
          {actions.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-gray-500 text-xs">{t("sim.appliedTitle")}:</span>
              {actions.map((a, i) => (
                <span key={i} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-950/40 border border-indigo-800/40 text-indigo-200 text-xs">
                  {renderAction(a)}
                  <button onClick={() => removeAction(i)} className="text-indigo-400/70 hover:text-indigo-200"><XIcon size={11} /></button>
                </span>
              ))}
            </div>
          )}

          {/* Results */}
          {actions.length === 0 ? (
            <p className="text-gray-600 text-sm text-center py-6">{t("sim.hint")}</p>
          ) : result ? (
            <>
              {/* Delta cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <DeltaCard label={t("sim.dNetWorth")} value={signed(result.deltas.net_worth_end)} positive={result.deltas.net_worth_end >= 0} />
                <DeltaCard label={t("sim.dMonthly")} value={signed(result.deltas.monthly_cashflow)} positive={result.deltas.monthly_cashflow >= 0} />
                <DeltaCard
                  label={t("sim.dDebtFree")}
                  value={result.deltas.debt_free_months === 0 ? "—" : `${Math.abs(result.deltas.debt_free_months)} ${lang === "tr" ? "ay" : "mo"} ${result.deltas.debt_free_months > 0 ? (lang === "tr" ? "erken" : "sooner") : (lang === "tr" ? "geç" : "later")}`}
                  positive={result.deltas.debt_free_months >= 0}
                />
                <DeltaCard label={t("sim.dInterest")} value={signed(result.deltas.interest_saved)} positive={result.deltas.interest_saved >= 0} />
              </div>

              {/* Warnings */}
              {result.warnings.map((w, i) => (
                <div key={i} className="bg-red-950/30 border border-red-800/40 rounded-xl p-3 text-red-300 text-sm">⚠ {w}</div>
              ))}

              {/* Chart */}
              <section className={card}>
                <p className="text-gray-500 text-xs mb-3">{t("sim.chartTitle")} · {result.horizon_months} {lang === "tr" ? "ay" : "mo"}</p>
                <ResponsiveContainer width="100%" height={240}>
                  <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 4, bottom: 0 }}>
                    <defs>
                      <linearGradient id="bandFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#6366f1" stopOpacity={0.18} />
                        <stop offset="100%" stopColor="#6366f1" stopOpacity={0.04} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="#2A2A2A" vertical={false} />
                    <XAxis dataKey="month" stroke="#6b7280" fontSize={11} tickLine={false} axisLine={false}
                      tickFormatter={(m) => `${m}${lang === "tr" ? "a" : "mo"}`} />
                    <YAxis stroke="#6b7280" fontSize={11} tickLine={false} axisLine={false} width={48}
                      tickFormatter={(v) => Intl.NumberFormat(undefined, { notation: "compact" }).format(v)} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "#1A1A1A", border: "1px solid #2A2A2A", borderRadius: 8 }}
                      labelStyle={{ color: "#9ca3af" }}
                      formatter={(v: number | number[], name: string) => {
                        if (name === "range") {
                          const [lo, hi] = v as number[];
                          return [`${money(lo)} – ${money(hi)}`, t("sim.range")];
                        }
                        return [money(v as number), name === "baseline" ? t("sim.baseline") : t("sim.scenario")];
                      }}
                      labelFormatter={(m) => `${lang === "tr" ? "Ay" : "Month"} ${m}`}
                    />
                    <Legend formatter={(v) => v === "baseline" ? t("sim.baseline") : v === "range" ? t("sim.range") : t("sim.scenario")} wrapperStyle={{ fontSize: 12 }} />
                    {/* uncertainty cone behind the lines */}
                    <Area type="monotone" dataKey="range" stroke="none" fill="url(#bandFill)" legendType="none" tooltipType="none" />
                    <Area type="monotone" dataKey="baseline" stroke="#6b7280" strokeDasharray="4 4" strokeWidth={2} fill="none" />
                    <Area type="monotone" dataKey="scenario" stroke="#818cf8" strokeWidth={2.5} fill="none" />
                  </AreaChart>
                </ResponsiveContainer>
                <p className="text-gray-600 text-[11px] mt-2">{t("sim.rangeNote")}</p>
              </section>

              {/* Narrative */}
              {result.narrative && (
                <section className="bg-indigo-950/30 border border-indigo-800/40 rounded-xl p-4">
                  <p className="text-gray-100 text-sm leading-relaxed">{result.narrative}</p>
                </section>
              )}

              {/* Assumptions */}
              <button onClick={() => setShowAssumptions((s) => !s)} className="text-gray-500 hover:text-gray-300 text-xs text-left">
                {showAssumptions ? "▾" : "▸"} {t("sim.assumptions")}
              </button>
              {showAssumptions && (
                <ul className="text-gray-600 text-xs space-y-1 pl-4">
                  {result.assumptions.map((a, i) => <li key={i}>• {a}</li>)}
                </ul>
              )}
            </>
          ) : running ? (
            <div className="flex items-center justify-center gap-2 text-gray-500 text-sm py-6">
              <span className="w-4 h-4 border-2 border-gray-600 border-t-indigo-400 rounded-full animate-spin" /> {t("sim.running")}
            </div>
          ) : null}
        </div>
      )}
    </PageLayout>
  );
}

function DeltaCard({ label, value, positive }: { label: string; value: string; positive: boolean }) {
  return (
    <div className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-3">
      <p className="text-gray-500 text-[11px] mb-1">{label}</p>
      <p className={`text-base font-semibold tabular-nums flex items-center gap-1 ${positive ? "text-emerald-400" : "text-red-400"}`}>
        {positive ? <TrendingUp size={13} /> : <TrendingDown size={13} />}{value}
      </p>
    </div>
  );
}
