"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import {
  getScorecard, getStoredUser, getDefaultCurrency, CURRENCY_CHANGE_EVENT,
  type Scorecard, type ScorecardPillar, type ScorecardStreak, type ScorecardMilestone,
} from "@/lib/api";
import PageLayout from "@/components/ui/PageLayout";
import GoalsPanel from "@/components/GoalsPanel";
import AlertsPanel from "@/components/AlertsPanel";
import PersonalityCard from "@/components/PersonalityCard";
import { ChevronDown, ChevronUp, Upload, Plus, TrendingUp, TrendingDown, Flame } from "@/components/ui/Icons";
import { useLanguage } from "@/lib/i18n";

type LoadState = "loading" | "ready" | "error";
type Range = "3m" | "6m" | "1y" | "all";

// ── formatting helpers ──────────────────────────────────────────────────────
function fmt(value: number, currency: string, max = 0): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency", currency, maximumFractionDigits: max, minimumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: max }).format(value)} ${currency}`;
  }
}

function fmtDate(iso: string | null, withDay = false): string {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(undefined, withDay
    ? { day: "2-digit", month: "short", year: "numeric" }
    : { month: "short", year: "numeric" });
}

// ── band visuals ────────────────────────────────────────────────────────────
const BAND_STYLE: Record<string, { ring: string; text: string; bar: string; glow: string }> = {
  strong:  { ring: "border-emerald-600/40", text: "text-emerald-400", bar: "bg-emerald-500", glow: "shadow-[0_0_60px_-20px_rgba(16,185,129,0.6)]" },
  steady:  { ring: "border-sky-600/40",     text: "text-sky-400",     bar: "bg-sky-500",     glow: "shadow-[0_0_60px_-20px_rgba(14,165,233,0.5)]" },
  fragile: { ring: "border-amber-600/40",   text: "text-amber-400",   bar: "bg-amber-500",   glow: "shadow-[0_0_60px_-20px_rgba(245,158,11,0.5)]" },
  at_risk: { ring: "border-red-700/40",     text: "text-red-400",     bar: "bg-red-500",     glow: "shadow-[0_0_60px_-20px_rgba(239,68,68,0.5)]" },
};

function trendMark(trend: string): { icon: string; cls: string } {
  if (trend === "up") return { icon: "↑", cls: "text-emerald-400" };
  if (trend === "down") return { icon: "↓", cls: "text-red-400" };
  if (trend === "flat") return { icon: "→", cls: "text-gray-500" };
  return { icon: "", cls: "" };
}

export default function ProgressPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const [data, setData] = useState<Scorecard | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [ccy, setCcy] = useState("TRY");
  const [range, setRange] = useState<Range>("6m");
  const [manageGoals, setManageGoals] = useState(false);
  const [showBehavior, setShowBehavior] = useState(false);

  useEffect(() => {
    setCcy(getDefaultCurrency());
    const h = (e: Event) => setCcy((e as CustomEvent<string>).detail);
    window.addEventListener(CURRENCY_CHANGE_EVENT, h);
    return () => window.removeEventListener(CURRENCY_CHANGE_EVENT, h);
  }, []);

  useEffect(() => {
    if (!getStoredUser()) { router.replace("/login"); return; }
    const load = () => {
      setState("loading");
      getScorecard(ccy)
        .then((d) => { setData(d); setState("ready"); })
        .catch(() => setState("error"));
    };
    load();
    window.addEventListener("mizan-data-changed", load);
    return () => window.removeEventListener("mizan-data-changed", load);
  }, [router, ccy]);

  const catLabel = (c: string) => {
    const k = `category.${c}`;
    return t(k) !== k ? t(k) : c;
  };

  // ── trajectory filtered by range ──
  const trajectory = useMemo(() => {
    if (!data) return [];
    const pts = data.trajectory;
    if (range === "all" || pts.length === 0) return pts;
    const days = range === "3m" ? 90 : range === "6m" ? 180 : 365;
    const cutoff = Date.now() - days * 86400_000;
    const filtered = pts.filter((p) => new Date(p.date + "T00:00:00").getTime() >= cutoff);
    return filtered.length >= 2 ? filtered : pts;
  }, [data, range]);

  const chartData = trajectory.map((p) => ({
    label: fmtDate(p.date),
    value: Math.round(p.net_worth),
  }));

  return (
    <PageLayout title={t("scorecard.title")} subtitle={t("scorecard.subtitle")}>
      {state === "loading" && (
        <div className="space-y-6">
          <div className="h-48 rounded-2xl bg-[#1A1A1A] animate-pulse" />
          <div className="h-32 rounded-2xl bg-[#1A1A1A] animate-pulse" />
        </div>
      )}

      {state === "error" && (
        <div className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-2xl p-10 text-center text-red-400 text-sm">
          {t("common.error")}
        </div>
      )}

      {state === "ready" && data && !data.has_data && (
        <div className="bg-[#1A1A1A] border border-[#2A2A2A] border-dashed rounded-2xl p-12 text-center">
          <h3 className="text-white text-lg font-semibold mb-2">{t("scorecard.empty.title")}</h3>
          <p className="text-gray-500 text-sm max-w-md mx-auto mb-6">{t("scorecard.empty.desc")}</p>
          <div className="flex items-center justify-center gap-3">
            <Link href="/upload" className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 transition-colors">
              <Upload size={15} /> {t("scorecard.empty.cta")}
            </Link>
            <Link href="/transactions" className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-[#2A2A2A] text-gray-300 text-sm hover:border-indigo-700 transition-colors">
              <Plus size={15} /> {t("scorecard.empty.addManual")}
            </Link>
          </div>
        </div>
      )}

      {state === "ready" && data && data.has_data && (
        <div className="space-y-6">
          <HeroScore data={data} t={t} />
          <Pillars pillars={data.pillars} t={t} />
          <Trajectory
            chartData={chartData}
            annotations={data.annotations}
            ccy={ccy}
            range={range}
            setRange={setRange}
            t={t}
            catLabel={catLabel}
          />
          <Drivers data={data} ccy={ccy} t={t} catLabel={catLabel} />
          <Milestones milestones={data.milestones} ccy={ccy} t={t} />
          <Streaks
            streaks={data.streaks}
            ccy={ccy}
            t={t}
            catLabel={catLabel}
            manageGoals={manageGoals}
            setManageGoals={setManageGoals}
          />

          <AlertsPanel />

          {/* Demoted: financial personality as an opt-in footnote */}
          <div className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl">
            <button
              onClick={() => setShowBehavior((v) => !v)}
              className="w-full flex items-center justify-between px-5 py-4 text-sm text-gray-400 hover:text-gray-200 transition-colors"
            >
              <span>{t("progress.personality")}</span>
              {showBehavior ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
            {showBehavior && <div className="px-1 pb-1"><PersonalityCard /></div>}
          </div>
        </div>
      )}
    </PageLayout>
  );
}

// ── Hero: the verdict ───────────────────────────────────────────────────────
function HeroScore({ data, t }: { data: Scorecard; t: (k: string) => string }) {
  const style = BAND_STYLE[data.band] ?? BAND_STYLE.steady;
  const mover = data.top_mover;
  const moverPhrase = mover
    ? t(`scorecard.${mover.direction === "up" ? "moverUp" : "moverDown"}.${mover.key}`)
    : null;
  const delta = data.score_delta;

  return (
    <div className={`bg-[#1A1A1A] border ${style.ring} rounded-2xl p-6 ${style.glow}`}>
      <div className="flex items-start justify-between gap-6 flex-wrap">
        <div className="min-w-0 flex-1">
          <p className="text-xs uppercase tracking-wider text-gray-500 mb-1">{t("scorecard.healthLabel")}</p>
          <div className="flex items-end gap-3">
            <span className={`text-6xl font-bold tabular-nums ${style.text}`}>{data.score}</span>
            <span className="text-gray-600 text-sm mb-2">{t("scorecard.outOf")}</span>
            {delta !== null && delta !== 0 && (
              <span className={`mb-2 text-sm font-semibold ${delta > 0 ? "text-emerald-400" : "text-red-400"}`}>
                {delta > 0 ? "▲ +" : "▼ "}{delta} <span className="text-gray-600 font-normal">{t("scorecard.vsLastMonth")}</span>
              </span>
            )}
          </div>
          <p className={`mt-3 text-lg font-semibold ${style.text}`}>{t(`scorecard.verdict.${data.band}`)}</p>
          {moverPhrase && <p className="text-gray-400 text-sm mt-0.5">{moverPhrase}.</p>}
        </div>
        <div className={`shrink-0 px-3 py-1.5 rounded-full border ${style.ring} ${style.text} text-xs font-semibold uppercase tracking-wide`}>
          {t(`scorecard.band.${data.band}`)}
        </div>
      </div>

      {/* score meter */}
      <div className="mt-5 h-2 rounded-full bg-[#0F0F0F] overflow-hidden">
        <div className={`h-full rounded-full ${style.bar} transition-all`} style={{ width: `${data.score}%` }} />
      </div>
    </div>
  );
}

// ── Pillars: the transparent decomposition ──────────────────────────────────
function Pillars({ pillars, t }: { pillars: ScorecardPillar[]; t: (k: string) => string }) {
  const valueLine = (p: ScorecardPillar): string => {
    if (p.status !== "ok") return t(`scorecard.status.${p.status}`);
    switch (p.key) {
      case "savings": return `${p.value}% · ${t("scorecard.unit.saved")}`;
      case "debt": return `${p.value}% · ${t("scorecard.unit.ofAssets")}`;
      case "discipline": return `${p.value}/${p.value2} · ${t("scorecard.unit.goalsMet")}`;
      case "growth": return `${p.value > 0 ? "+" : ""}${p.value}% · ${t("scorecard.unit.nwGrowth")}`;
      default: return "";
    }
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {pillars.map((p) => {
        const mark = trendMark(p.trend);
        const pct = Math.round((p.score / p.max) * 100);
        return (
          <div key={p.key} className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-4">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-sm text-gray-300 font-medium">{t(`scorecard.pillar.${p.key}`)}</span>
              <span className="text-sm tabular-nums">
                <span className="text-white font-semibold">{p.score}</span>
                <span className="text-gray-600">/{p.max}</span>
                {mark.icon && <span className={`ml-1.5 ${mark.cls}`}>{mark.icon}</span>}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-[#0F0F0F] overflow-hidden mb-2">
              <div
                className={`h-full rounded-full ${pct >= 80 ? "bg-emerald-500" : pct >= 50 ? "bg-sky-500" : pct >= 30 ? "bg-amber-500" : "bg-red-500"}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className={`text-xs ${p.status === "ok" ? "text-gray-500" : "text-gray-600 italic"}`}>{valueLine(p)}</p>
          </div>
        );
      })}
    </div>
  );
}

// ── Trajectory: net worth over time, with the story annotated ───────────────
function Trajectory({
  chartData, annotations, ccy, range, setRange, t, catLabel,
}: {
  chartData: { label: string; value: number }[];
  annotations: Scorecard["annotations"];
  ccy: string;
  range: Range;
  setRange: (r: Range) => void;
  t: (k: string) => string;
  catLabel: (c: string) => string;
}) {
  const ranges: Range[] = ["3m", "6m", "1y", "all"];
  const hasChart = chartData.length >= 2;

  return (
    <div className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-5">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{t("scorecard.trajectory.title")}</p>
        <div className="flex items-center gap-1 bg-[#0F0F0F] border border-[#2A2A2A] rounded-full p-0.5">
          {ranges.map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-2.5 py-0.5 rounded-full text-[11px] font-medium transition-colors ${
                range === r ? "bg-indigo-600 text-white" : "text-gray-500 hover:text-gray-300"
              }`}
            >
              {t(`scorecard.trajectory.range${r === "all" ? "All" : r.toUpperCase()}`)}
            </button>
          ))}
        </div>
      </div>

      {!hasChart ? (
        <div className="h-44 flex items-center justify-center">
          <p className="text-gray-600 text-sm text-center max-w-xs">{t("scorecard.trajectory.empty")}</p>
        </div>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={chartData} margin={{ top: 4, right: 12, left: 4, bottom: 0 }}>
              <defs>
                <linearGradient id="nwFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6366f1" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#2A2A2A" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: "#6b7280", fontSize: 10 }} axisLine={false} tickLine={false} minTickGap={28} />
              <YAxis
                tick={{ fill: "#4b5563", fontSize: 10 }} axisLine={false} tickLine={false} width={44}
                tickFormatter={(v: number) => Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)}
              />
              <Tooltip
                contentStyle={{ backgroundColor: "#1A1A1A", border: "1px solid #2A2A2A", borderRadius: 8 }}
                labelStyle={{ color: "#e5e7eb", fontSize: 12 }}
                itemStyle={{ fontSize: 12, color: "#a5b4fc" }}
                formatter={(v: number) => [fmt(v, ccy), undefined]}
              />
              <Area type="monotone" dataKey="value" stroke="#818cf8" strokeWidth={2} fill="url(#nwFill)" />
            </AreaChart>
          </ResponsiveContainer>

          {annotations.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3">
              {annotations.map((a, i) => (
                <span
                  key={i}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] border ${
                    a.direction === "up"
                      ? "bg-emerald-950/30 border-emerald-900/40 text-emerald-300"
                      : "bg-red-950/30 border-red-900/40 text-red-300"
                  }`}
                >
                  <span className="text-gray-500">{fmtDate(a.date, true)}</span>
                  {a.direction === "up" ? "▲" : "▼"} {fmt(a.amount, ccy)}
                  {a.mover && <span className="text-gray-400">· {catLabel(a.mover)}</span>}
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Drivers: biggest win / biggest setback ──────────────────────────────────
function Drivers({
  data, ccy, t, catLabel,
}: { data: Scorecard; ccy: string; t: (k: string) => string; catLabel: (c: string) => string }) {
  const { best, worst } = data.drivers;

  const label = (d: NonNullable<Scorecard["drivers"]["best"]>): string => {
    if (d.kind === "debt") return t("scorecard.drivers.debtPaydown");
    return d.name ? catLabel(d.name) : "—";
  };

  return (
    <div>
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">{t("scorecard.drivers.title")}</p>
      {!best && !worst ? (
        <div className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-5 text-center text-gray-600 text-sm">
          {t("scorecard.drivers.none")}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {best && (
            <div className="bg-[#1A1A1A] border border-emerald-900/30 rounded-xl p-4">
              <div className="flex items-center gap-2 text-emerald-400 text-xs font-semibold mb-2">
                <TrendingUp size={14} /> {t("scorecard.drivers.best")}
              </div>
              <p className="text-white font-semibold">{label(best)}</p>
              <p className="text-emerald-400/80 text-sm mt-0.5">
                {fmt(best.amount, ccy)} {best.kind === "debt" ? "" : t("scorecard.drivers.spentLess")}
              </p>
            </div>
          )}
          {worst && (
            <div className="bg-[#1A1A1A] border border-red-900/30 rounded-xl p-4">
              <div className="flex items-center gap-2 text-red-400 text-xs font-semibold mb-2">
                <TrendingDown size={14} /> {t("scorecard.drivers.worst")}
              </div>
              <p className="text-white font-semibold">{label(worst)}</p>
              <p className="text-red-400/80 text-sm mt-0.5">
                {fmt(worst.amount, ccy)} {t("scorecard.drivers.spentMore")}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Milestones: the forward promise ─────────────────────────────────────────
function Milestones({
  milestones, ccy, t,
}: { milestones: ScorecardMilestone[]; ccy: string; t: (k: string) => string }) {
  if (milestones.length === 0) {
    return (
      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">{t("scorecard.milestones.title")}</p>
        <div className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-5 text-center text-gray-600 text-sm">
          {t("scorecard.milestones.empty")}
        </div>
      </div>
    );
  }

  const headline = (m: ScorecardMilestone): string => {
    if (m.key === "debt_free") return t("scorecard.milestones.debtFree");
    return `${t("scorecard.milestones.nwTarget")} ${m.target != null ? fmt(m.target, ccy) : ""}`.trim();
  };

  const detail = (m: ScorecardMilestone): { text: string; cls: string } => {
    if (m.status === "on_track" && m.date) {
      const approx = m.months != null ? ` · ${t("scorecard.milestones.approx")}${m.months} ${t("scorecard.milestones.mo")}` : "";
      return { text: `${fmtDate(m.date)}${approx}`, cls: "text-indigo-300" };
    }
    if (m.status === "no_plan") return { text: t("scorecard.milestones.noPlan"), cls: "text-gray-500" };
    if (m.status === "stalled") return { text: t("scorecard.milestones.stalled"), cls: "text-amber-400" };
    return { text: "—", cls: "text-gray-600" };
  };

  return (
    <div>
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">{t("scorecard.milestones.title")}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {milestones.map((m) => {
          const d = detail(m);
          return (
            <div key={m.key} className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-4">
              <p className="text-xs text-gray-500 mb-1">{headline(m)}</p>
              <p className={`text-lg font-semibold tabular-nums ${d.cls}`}>{d.text}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Streaks: goals reframed as momentum ─────────────────────────────────────
function Streaks({
  streaks, ccy, t, catLabel, manageGoals, setManageGoals,
}: {
  streaks: ScorecardStreak[];
  ccy: string;
  t: (k: string) => string;
  catLabel: (c: string) => string;
  manageGoals: boolean;
  setManageGoals: (v: boolean) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{t("scorecard.streaks.title")}</p>
        <button
          onClick={() => setManageGoals(!manageGoals)}
          className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
        >
          {t("scorecard.streaks.manage")} {manageGoals ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>
      </div>

      {streaks.length === 0 ? (
        <div className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-5 text-center text-gray-600 text-sm">
          {t("scorecard.streaks.empty")}
        </div>
      ) : (
        <div className="space-y-2.5">
          {streaks.map((s) => {
            const over = s.current_pct > 100;
            const pct = Math.min(100, s.current_pct);
            return (
              <div key={s.category} className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-4">
                <div className="flex items-center justify-between mb-2 gap-2">
                  <span className="text-sm text-gray-200 font-medium truncate">{catLabel(s.category)}</span>
                  {s.months > 0 ? (
                    <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-orange-950/40 border border-orange-900/40 text-orange-300 shrink-0">
                      <Flame size={11} /> {s.months} {t("scorecard.streaks.monthsUnder")}
                    </span>
                  ) : (
                    <span className="text-xs text-gray-600 shrink-0">{t("scorecard.streaks.newGoal")}</span>
                  )}
                </div>
                <div className="h-1.5 rounded-full bg-[#0F0F0F] overflow-hidden mb-1.5">
                  <div className={`h-full rounded-full ${over ? "bg-red-500" : pct > 85 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${pct}%` }} />
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-gray-500">{fmt(s.spent, ccy)} / {fmt(s.limit, ccy)}</span>
                  <span className={over ? "text-red-400 font-medium" : "text-gray-500"}>
                    {s.current_pct}% {over ? t("scorecard.streaks.over") : t("scorecard.streaks.thisMonth")}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {manageGoals && <div className="mt-3"><GoalsPanel /></div>}
    </div>
  );
}
