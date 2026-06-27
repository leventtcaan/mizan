"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";
import PageLayout from "@/components/ui/PageLayout";
import Mim from "@/components/companion/Mim";
import UpgradePrompt from "@/components/UpgradePrompt";
import {
  Sparkles, TrendingUp, TrendingDown, X as XIcon, Send, Brain,
} from "@/components/ui/Icons";
import { useLanguage } from "@/lib/i18n";
import {
  getToken, getDefaultCurrency, CURRENCY_CHANGE_EVENT,
  getSimulatorLevers, runSimulator, askSimulator, PaidFeatureError,
  type SimLevers, type SimResult, type SimAction,
} from "@/lib/api";

const HORIZONS = [12, 24, 36, 60];
const TEAL = "#176B5B";
const TEAL_HOVER = "#125848";

export default function SimulatorPage() {
  const router = useRouter();
  const { t, tList, lang } = useLanguage();

  // Must start from an SSR-safe constant: getDefaultCurrency() reads localStorage /
  // navigator, which don't exist during prerender, so a lazy initializer renders a
  // different value on the server than on the client → hydration mismatch (the
  // currency prefix flips, e.g. "USD"→"TRY"). The real currency is applied in the
  // client-only effect below, before the first levers fetch resolves.
  const [ccy, setCcy] = useState("TRY");
  const [levers, setLevers] = useState<SimLevers | null>(null);
  const [paywalled, setPaywalled] = useState(false);
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
    getSimulatorLevers(ccy)
      .then((l) => { setLevers(l); setPaywalled(false); })
      .catch((err) => { setLevers(null); setPaywalled(err instanceof PaidFeatureError); });
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

  const ask = async (qText?: string) => {
    const q = (qText ?? question).trim();
    if (!q || asking) return;
    if (qText) setQuestion(qText);
    setAsking(true); setAskMiss(false);
    try {
      const res = await askSimulator(q, horizon, ccy, lang);
      if (res.parsed && res.result) {
        setActions(res.actions);       // reflect parsed levers in the builder
        // A time expression in the question ("for a year") overrides the horizon; mirror
        // the understood value back into the toggle + the "What I understood" chips.
        setHorizon(res.result.horizon_months);
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

  const samples = tList("sim.samples");

  return (
    <PageLayout
      title={t("sim.title")}
      titleBadge={<Sparkles size={18} className="text-brand" />}
      subtitle={t("sim.subtitle")}
      maxWidth="lg"
    >
      {paywalled ? (
        <div className="py-10">
          <UpgradePrompt feature="simulator" icon={<Sparkles size={26} />} />
        </div>
      ) : noData ? (
        <div className="bg-surface border border-line rounded-2xl text-center py-12 px-6">
          <div className="w-14 h-14 rounded-2xl bg-brand/10 flex items-center justify-center mx-auto mb-4">
            <Sparkles size={26} className="text-brand" />
          </div>
          <p className="text-ink font-semibold mb-1">{t("sim.emptyTitle")}</p>
          <p className="text-ink-mute text-sm mb-5 max-w-sm mx-auto">{t("sim.emptyBody")}</p>
          <div className="flex justify-center gap-3 flex-wrap">
            <Link href="/upload" className="px-4 py-2 rounded-lg text-white text-sm font-semibold shadow-sm transition-colors" style={{ backgroundColor: TEAL }}>{t("sim.emptyUpload")}</Link>
            <Link href="/networth" className="px-4 py-2 rounded-lg border border-line text-ink-soft hover:text-ink text-sm font-medium transition-colors">{t("sim.emptyNetworth")}</Link>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {/* ── Ask hero — the differentiator, front and center ── */}
          <section data-tour="simulator" className="relative overflow-hidden bg-surface border border-line rounded-2xl p-5 sm:p-6 shadow-sm">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-24" style={{ background: "radial-gradient(120% 100% at 30% 0%, rgba(23,107,91,0.08), transparent 70%)" }} />
            <div className="relative">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-8 h-8 rounded-xl bg-brand/10 flex items-center justify-center">
                  <Brain size={16} className="text-brand" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-ink leading-tight">{t("sim.askTitle")}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <input
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void ask(); } }}
                  placeholder={t("sim.askPlaceholder")}
                  className="flex-1 bg-canvas border border-line rounded-xl px-4 py-3 text-sm text-ink placeholder:text-ink-mute focus:outline-none focus:border-[#176B5B] focus:ring-2 focus:ring-[#176B5B]/20 transition-shadow"
                />
                <button onClick={() => void ask()} disabled={asking || !question.trim()}
                  className="px-4 rounded-xl text-white shrink-0 disabled:opacity-40 transition-colors flex items-center justify-center"
                  style={{ backgroundColor: TEAL }}
                  onMouseEnter={(e) => { if (!asking && question.trim()) e.currentTarget.style.backgroundColor = TEAL_HOVER; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = TEAL; }}
                >
                  {asking ? <span className="block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Send size={16} />}
                </button>
              </div>
              {/* Sample questions — one tap to run, makes the feature self-explanatory */}
              <div className="flex flex-wrap items-center gap-2 mt-3">
                <span className="text-ink-mute text-xs">{t("sim.tryThese")}:</span>
                {samples.map((s, i) => (
                  <button key={i} onClick={() => void ask(s)} disabled={asking}
                    className="px-2.5 py-1 rounded-full bg-surface-2 hover:bg-surface-3 border border-line text-ink-soft text-xs transition-colors disabled:opacity-50">
                    {s}
                  </button>
                ))}
              </div>
              {askMiss && (
                <p className="text-warn text-xs mt-3 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-warn" /> {t("sim.askMiss")}
                </p>
              )}
            </div>
          </section>

          {/* ── Builder + Outcome ── */}
          <div className="grid lg:grid-cols-12 gap-4 items-start">
            {/* Scenario builder (left, sticky on desktop) */}
            <section className="lg:col-span-5 lg:sticky lg:top-20 bg-surface border border-line rounded-2xl p-5 space-y-5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-ink">{t("sim.buildTitle")}</p>
                  {levers && (
                    <p className="text-xs text-ink-mute mt-0.5">{t("sim.nowLabel")}: <span className="text-ink-soft font-medium tabular-nums">{money(levers.net_worth)}</span></p>
                  )}
                </div>
                {actions.length > 0 && (
                  <button onClick={clearAll} className="text-ink-mute hover:text-ink-soft text-xs flex items-center gap-1 shrink-0">
                    <XIcon size={12} /> {t("sim.clear")}
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 gap-4">
                <div className="grid sm:grid-cols-2 gap-4">
                  <MoneyInput label={t("sim.saveMonthly")} ccy={ccy} value={amountOf("save_monthly")} onChange={(v) => setSingle("save_monthly", v)} />
                  <MoneyInput label={t("sim.oneTime")} ccy={ccy} value={amountOf("one_time_expense")} onChange={(v) => setSingle("one_time_expense", v)} />
                </div>

                {/* Income — direction toggle + magnitude */}
                <div>
                  <label className="text-ink-mute text-xs block mb-1.5">{t("sim.incomeChange")}</label>
                  <div className="flex gap-2">
                    <div className="flex rounded-lg overflow-hidden border border-line shrink-0">
                      {(["raise", "cut"] as const).map((d) => {
                        const active = effIncomeDir === d;
                        const cls = active
                          ? (d === "raise" ? "bg-pos/15 text-pos" : "bg-neg/15 text-neg")
                          : "text-ink-mute hover:text-ink-soft";
                        return (
                          <button key={d} onClick={() => applyIncome(d, incomeMag)} className={`px-3 text-xs font-semibold transition-colors ${cls}`}>
                            {d === "raise" ? t("sim.incomeRaise") : t("sim.incomeCut")}
                          </button>
                        );
                      })}
                    </div>
                    <div className="relative flex-1">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-mute text-xs pointer-events-none">{ccy}</span>
                      <input inputMode="decimal" value={incomeMag} onChange={(e) => applyIncome(effIncomeDir, e.target.value)} placeholder="0"
                        className="w-full bg-canvas border border-line rounded-lg pl-11 pr-3 py-2 text-sm text-ink tabular-nums focus:outline-none focus:border-[#176B5B] focus:ring-2 focus:ring-[#176B5B]/20 transition-shadow" />
                    </div>
                  </div>
                </div>

                {/* Horizon */}
                <div>
                  <label className="text-ink-mute text-xs block mb-1.5">{t("sim.horizon")}</label>
                  <div className="flex rounded-lg overflow-hidden border border-line">
                    {HORIZONS.map((h) => {
                      const active = horizon === h;
                      return (
                        <button key={h} onClick={() => setHorizon(h)}
                          className={`flex-1 py-2 text-xs font-semibold transition-colors ${active ? "text-white" : "text-ink-mute hover:text-ink-soft"}`}
                          style={active ? { backgroundColor: TEAL } : undefined}>
                          {h}{lang === "tr" ? "a" : "mo"}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Cancel subscriptions */}
              {levers && (
                <div className="pt-1">
                  <label className="text-ink-mute text-xs block mb-2">{t("sim.cancelSubs")}</label>
                  {levers.subscriptions.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {levers.subscriptions.slice(0, 12).map((s) => {
                        const on = isCancelled(s.label);
                        return (
                          <button key={s.key} onClick={() => toggleCancel(s.label, s.monthly_amount)}
                            className={`px-2.5 py-1.5 rounded-lg text-xs border transition-colors ${on
                              ? "bg-pos/10 border-pos/40 text-pos font-medium"
                              : "bg-canvas border-line text-ink-soft hover:border-line-strong"}`}>
                            {on ? "✓ " : ""}{s.label} · {money(s.monthly_amount)}/{lang === "tr" ? "ay" : "mo"}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-ink-mute text-xs leading-relaxed bg-surface-2 rounded-lg px-3 py-2.5">{t("sim.subsEmpty")}</p>
                  )}
                </div>
              )}

              {/* Prepay debts */}
              {levers && levers.debts.length > 0 && (
                <div className="pt-1">
                  <label className="text-ink-mute text-xs block mb-2">{t("sim.prepay")}</label>
                  <div className="space-y-2">
                    {levers.debts.map((d) => (
                      <div key={d.id} className="flex items-center gap-3">
                        <span className="text-ink-soft text-sm flex-1 min-w-0 truncate">{d.label} <span className="text-ink-mute text-xs">· {money(d.remaining)}</span></span>
                        <input inputMode="decimal" value={prepayOf(d.id)} onChange={(e) => setPrepay(d.id, d.label, e.target.value)} placeholder={t("sim.lumpSum")}
                          className="w-32 bg-canvas border border-line rounded-lg px-3 py-2 text-sm text-ink tabular-nums focus:outline-none focus:border-[#176B5B] focus:ring-2 focus:ring-[#176B5B]/20 transition-shadow" />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>

            {/* Outcome (right) */}
            <section className="lg:col-span-7 space-y-4">
              <p className="text-xs font-semibold text-ink-mute uppercase tracking-wider">{t("sim.outcomeTitle")}</p>

              {result ? (
                <>
                  {/* What I understood */}
                  {actions.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-ink-mute text-xs">{t("sim.appliedTitle")}:</span>
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-surface-2 border border-line text-ink-soft text-xs">
                        {t("sim.horizonChip")}: {horizon} {lang === "tr" ? "ay" : "mo"}
                      </span>
                      {actions.map((a, i) => (
                        <span key={i} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium" style={{ backgroundColor: "rgba(23,107,91,0.1)", color: TEAL, border: "1px solid rgba(23,107,91,0.3)" }}>
                          {renderAction(a)}
                          <button onClick={() => removeAction(i)} className="opacity-70 hover:opacity-100"><XIcon size={11} /></button>
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Headline delta */}
                  <BigDelta
                    label={t("sim.dNetWorth")}
                    value={signed(result.deltas.net_worth_end)}
                    positive={result.deltas.net_worth_end >= 0}
                    sub={`${t("sim.scenario")} · ${result.horizon_months} ${lang === "tr" ? "ay" : "mo"}`}
                  />

                  {/* Secondary deltas */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <MiniDelta label={t("sim.dMonthly")} value={signed(result.deltas.monthly_cashflow)} positive={result.deltas.monthly_cashflow >= 0} />
                    <MiniDelta
                      label={t("sim.dDebtFree")}
                      value={result.deltas.debt_free_months === 0 ? "—" : `${Math.abs(result.deltas.debt_free_months)} ${lang === "tr" ? "ay" : "mo"} ${result.deltas.debt_free_months > 0 ? (lang === "tr" ? "erken" : "sooner") : (lang === "tr" ? "geç" : "later")}`}
                      positive={result.deltas.debt_free_months >= 0}
                      neutral={result.deltas.debt_free_months === 0}
                    />
                    <MiniDelta label={t("sim.dInterest")} value={signed(result.deltas.interest_saved)} positive={result.deltas.interest_saved >= 0} />
                  </div>

                  {/* Warnings */}
                  {result.warnings.map((w, i) => (
                    <div key={i} className="bg-warn/10 border border-warn/30 rounded-xl p-3 text-warn text-sm flex items-start gap-2">
                      <span className="shrink-0">⚠</span><span>{w}</span>
                    </div>
                  ))}

                  {/* Chart */}
                  <div className="bg-surface border border-line rounded-2xl p-5">
                    <p className="text-ink-mute text-xs mb-3">{t("sim.chartTitle")} · {result.horizon_months} {lang === "tr" ? "ay" : "mo"}</p>
                    <ResponsiveContainer width="100%" height={240}>
                      <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 4, bottom: 0 }}>
                        <defs>
                          <linearGradient id="bandFill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="rgb(var(--c-brand))" stopOpacity={0.18} />
                            <stop offset="100%" stopColor="rgb(var(--c-brand))" stopOpacity={0.03} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid stroke="rgb(var(--c-line))" vertical={false} />
                        <XAxis dataKey="month" stroke="rgb(var(--c-text-muted))" fontSize={11} tickLine={false} axisLine={false}
                          tickFormatter={(m) => `${m}${lang === "tr" ? "a" : "mo"}`} />
                        <YAxis stroke="rgb(var(--c-text-muted))" fontSize={11} tickLine={false} axisLine={false} width={48}
                          tickFormatter={(v) => Intl.NumberFormat(undefined, { notation: "compact" }).format(v)} />
                        <Tooltip
                          contentStyle={{ backgroundColor: "rgb(var(--c-surface))", border: "1px solid rgb(var(--c-line))", borderRadius: 10, boxShadow: "0 4px 16px rgba(0,0,0,0.12)" }}
                          labelStyle={{ color: "rgb(var(--c-text))", fontSize: 12, fontWeight: 600 }}
                          itemStyle={{ fontSize: 12 }}
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
                        <Area type="monotone" dataKey="baseline" stroke="rgb(var(--c-text-muted))" strokeDasharray="4 4" strokeWidth={2} fill="none" />
                        <Area type="monotone" dataKey="scenario" stroke="rgb(var(--c-brand))" strokeWidth={2.5} fill="none" />
                      </AreaChart>
                    </ResponsiveContainer>
                    <p className="text-ink-mute text-[11px] mt-2">{t("sim.rangeNote")}</p>
                  </div>

                  {/* Narrative — Mim's read */}
                  {result.narrative && (
                    <div className="flex items-start gap-3 rounded-2xl p-4 border border-line" style={{ backgroundColor: "rgba(23,107,91,0.06)" }}>
                      <div className="w-8 h-8 rounded-xl bg-brand/10 flex items-center justify-center shrink-0">
                        <Mim size={22} quiet mood="thinking" />
                      </div>
                      <p className="text-ink-soft text-sm leading-relaxed">{result.narrative}</p>
                    </div>
                  )}

                  {/* Assumptions */}
                  <div>
                    <button onClick={() => setShowAssumptions((s) => !s)} className="text-ink-mute hover:text-ink-soft text-xs">
                      {showAssumptions ? "▾" : "▸"} {t("sim.assumptions")}
                    </button>
                    {showAssumptions && (
                      <ul className="text-ink-mute text-xs space-y-1 pl-4 mt-2">
                        {result.assumptions.map((a, i) => <li key={i}>• {a}</li>)}
                      </ul>
                    )}
                  </div>
                </>
              ) : (running || asking) ? (
                <div className="bg-surface border border-line rounded-2xl flex items-center justify-center gap-2 text-ink-mute text-sm py-16">
                  <span className="w-4 h-4 border-2 border-line border-t-[#176B5B] rounded-full animate-spin" /> {t("sim.running")}
                </div>
              ) : (
                <div className="bg-surface border border-line border-dashed rounded-2xl text-center py-14 px-6">
                  <div className="w-12 h-12 rounded-2xl bg-brand/10 flex items-center justify-center mx-auto mb-3">
                    <Sparkles size={22} className="text-brand" />
                  </div>
                  <p className="text-ink-mute text-sm max-w-xs mx-auto leading-relaxed">{t("sim.outcomeEmpty")}</p>
                </div>
              )}
            </section>
          </div>
        </div>
      )}
    </PageLayout>
  );
}

// ── helpers ──────────────────────────────────────────────────────────────────

function MoneyInput({ label, value, onChange, ccy }: { label: string; value: string; onChange: (v: string) => void; ccy: string }) {
  return (
    <div>
      <label className="text-ink-mute text-xs block mb-1.5">{label}</label>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-mute text-xs pointer-events-none">{ccy}</span>
        <input inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} placeholder="0"
          className="w-full bg-canvas border border-line rounded-lg pl-11 pr-3 py-2 text-sm text-ink tabular-nums placeholder:text-ink-mute focus:outline-none focus:border-[#176B5B] focus:ring-2 focus:ring-[#176B5B]/20 transition-shadow" />
      </div>
    </div>
  );
}

function BigDelta({ label, value, positive, sub }: { label: string; value: string; positive: boolean; sub: string }) {
  const color = positive ? "#1F7A5C" : "#B54747";
  return (
    <div className="relative overflow-hidden bg-surface border border-line rounded-2xl p-5">
      <span className="absolute left-0 top-0 bottom-0 w-1" style={{ backgroundColor: color }} />
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-ink-mute text-xs mb-1">{label}</p>
          <p className="text-3xl font-bold tabular-nums leading-none" style={{ color }}>{value}</p>
          <p className="text-ink-mute text-[11px] mt-1.5">{sub}</p>
        </div>
        <span className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0" style={{ backgroundColor: positive ? "rgba(31,122,92,0.12)" : "rgba(181,71,71,0.12)", color }}>
          {positive ? <TrendingUp size={20} /> : <TrendingDown size={20} />}
        </span>
      </div>
    </div>
  );
}

function MiniDelta({ label, value, positive, neutral }: { label: string; value: string; positive: boolean; neutral?: boolean }) {
  const cls = neutral ? "text-ink-soft" : positive ? "text-pos" : "text-neg";
  const Icon: ReactNode = neutral ? null : positive ? <TrendingUp size={13} /> : <TrendingDown size={13} />;
  return (
    <div className="bg-surface border border-line rounded-xl p-3.5">
      <p className="text-ink-mute text-[11px] mb-1">{label}</p>
      <p className={`text-base font-semibold tabular-nums flex items-center gap-1 ${cls}`}>
        {Icon}{value}
      </p>
    </div>
  );
}
