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
// Solid bar fills use literal hexes (channel-token bg utilities don't always paint);
// text/border use semantic tokens so they adapt to light/dark. Teal replaces the
// off-brand sky-blue "steady" band.
const BAND_STYLE: Record<string, { ring: string; text: string; bar: string; glow: string }> = {
  strong:  { ring: "border-pos/40",    text: "text-pos",    bar: "bg-[#1F7A5C]", glow: "shadow-[0_0_60px_-24px_rgba(31,122,92,0.5)]" },
  steady:  { ring: "border-brand/40",  text: "text-brand",  bar: "bg-[#176B5B]", glow: "shadow-[0_0_60px_-24px_rgba(23,107,91,0.45)]" },
  fragile: { ring: "border-warn/40",   text: "text-warn",   bar: "bg-[#B0741E]", glow: "shadow-[0_0_60px_-24px_rgba(176,116,30,0.4)]" },
  at_risk: { ring: "border-neg/40",    text: "text-neg",    bar: "bg-[#B54747]", glow: "shadow-[0_0_60px_-24px_rgba(181,71,71,0.4)]" },
};

function trendMark(trend: string): { icon: string; cls: string } {
  if (trend === "up") return { icon: "↑", cls: "text-pos" };
  if (trend === "down") return { icon: "↓", cls: "text-neg" };
  if (trend === "flat") return { icon: "→", cls: "text-ink-mute" };
  return { icon: "", cls: "" };
}

export default function ProgressPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const [data, setData] = useState<Scorecard | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [ccy, setCcy] = useState(() => getDefaultCurrency());
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

  // The 0-100 score is only honest once at least two pillars carry REAL data.
  // With one statement and nothing else, all four pillars fall back to neutral
  // defaults (12+18+15+12 = a fake-authoritative "57"). Until then, show an honest
  // "still learning" hero instead of a number that looks earned but isn't.
  const realPillars = data ? data.pillars.filter((p) => p.status === "ok").length : 0;
  const provisional = !!data && data.has_data && realPillars < 2;

  return (
    <PageLayout title={t("scorecard.title")} subtitle={t("scorecard.subtitle")}>
      {state === "loading" && (
        <div className="space-y-6">
          <div className="h-48 rounded-2xl bg-surface animate-pulse" />
          <div className="h-32 rounded-2xl bg-surface animate-pulse" />
        </div>
      )}

      {state === "error" && (
        <div className="bg-surface border border-line rounded-2xl p-10 text-center text-neg text-sm">
          {t("common.error")}
        </div>
      )}

      {state === "ready" && data && !data.has_data && (
        <div className="bg-surface border border-line border-dashed rounded-2xl p-12 text-center">
          <h3 className="text-ink text-lg font-semibold mb-2">{t("scorecard.empty.title")}</h3>
          <p className="text-ink-mute text-sm max-w-md mx-auto mb-6">{t("scorecard.empty.desc")}</p>
          <div className="flex items-center justify-center gap-3">
            <Link href="/upload" className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#176B5B] text-white text-sm font-medium hover:bg-[#125848] transition-colors">
              <Upload size={15} /> {t("scorecard.empty.cta")}
            </Link>
            <Link href="/transactions" className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-line text-ink-soft text-sm hover:border-brand transition-colors">
              <Plus size={15} /> {t("scorecard.empty.addManual")}
            </Link>
          </div>
        </div>
      )}

      {/* Provisional: real score not earned yet — honest "still learning" view. */}
      {state === "ready" && data && data.has_data && provisional && (
        <div className="space-y-6">
          <ProvisionalHero pillars={data.pillars} realPillars={realPillars} t={t} />
          <Pillars pillars={data.pillars} t={t} />
          <Trajectory
            chartData={chartData}
            annotations={data.annotations}
            estimated={data.trajectory_estimated}
            ccy={ccy}
            range={range}
            setRange={setRange}
            t={t}
            catLabel={catLabel}
          />
        </div>
      )}

      {state === "ready" && data && data.has_data && !provisional && (
        <div className="space-y-6">
          <HeroScore data={data} t={t} />
          <Pillars pillars={data.pillars} t={t} />
          <Trajectory
            chartData={chartData}
            annotations={data.annotations}
            estimated={data.trajectory_estimated}
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
          <div className="bg-surface border border-line rounded-xl">
            <button
              onClick={() => setShowBehavior((v) => !v)}
              className="w-full flex items-center justify-between px-5 py-4 text-sm text-ink-mute hover:text-ink-soft transition-colors"
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

// ── Provisional hero: shown until the score is actually earned ───────────────
function ProvisionalHero({
  pillars, realPillars, t,
}: { pillars: ScorecardPillar[]; realPillars: number; t: (k: string) => string }) {
  return (
    <div className="bg-surface border border-line rounded-2xl p-6">
      <p className="text-xs uppercase tracking-wider text-ink-mute mb-2">{t("scorecard.healthLabel")}</p>
      <h2 className="text-2xl sm:text-3xl font-bold text-ink-soft mb-4">{t("scorecard.building.title")}</h2>
      {/* Four-signal indicator — filled for each pillar that has real data */}
      <div className="flex items-center gap-2 mb-2.5">
        {pillars.map((p) => (
          <div key={p.key} className={`h-1.5 flex-1 rounded-full ${p.status === "ok" ? "bg-[#176B5B]" : "bg-surface-2"}`} />
        ))}
      </div>
      <p className="text-sm text-brand font-medium mb-3">
        {t("scorecard.building.signals").replace("{n}", String(realPillars))}
      </p>
      <p className="text-sm text-ink-mute leading-relaxed mb-2">{t("scorecard.building.desc")}</p>
      <p className="text-xs text-ink-mute">{t("scorecard.building.hint")}</p>
    </div>
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
    <div className={`bg-surface border ${style.ring} rounded-2xl p-6 ${style.glow}`}>
      <div className="flex items-start justify-between gap-6 flex-wrap">
        <div className="min-w-0 flex-1">
          <p className="text-xs uppercase tracking-wider text-ink-mute mb-1">{t("scorecard.healthLabel")}</p>
          <div className="flex items-end gap-3">
            <span className={`text-6xl font-bold tabular-nums ${style.text}`}>{data.score}</span>
            <span className="text-ink-mute text-sm mb-2">{t("scorecard.outOf")}</span>
            {delta !== null && delta !== 0 && (
              <span className={`mb-2 text-sm font-semibold ${delta > 0 ? "text-pos" : "text-neg"}`}>
                {delta > 0 ? "▲ +" : "▼ "}{delta} <span className="text-ink-mute font-normal">{t("scorecard.vsLastMonth")}</span>
              </span>
            )}
          </div>
          <p className={`mt-3 text-lg font-semibold ${style.text}`}>{t(`scorecard.verdict.${data.band}`)}</p>
          {moverPhrase && <p className="text-ink-mute text-sm mt-0.5">{moverPhrase}.</p>}
        </div>
        <div className={`shrink-0 px-3 py-1.5 rounded-full border ${style.ring} ${style.text} text-xs font-semibold uppercase tracking-wide`}>
          {t(`scorecard.band.${data.band}`)}
        </div>
      </div>

      {/* score meter */}
      <div className="mt-5 h-2 rounded-full bg-surface-2 overflow-hidden">
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
          <div key={p.key} className="bg-surface border border-line rounded-xl p-4">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-sm text-ink-soft font-medium">{t(`scorecard.pillar.${p.key}`)}</span>
              <span className="text-sm tabular-nums">
                <span className="text-ink font-semibold">{p.score}</span>
                <span className="text-ink-mute">/{p.max}</span>
                {mark.icon && <span className={`ml-1.5 ${mark.cls}`}>{mark.icon}</span>}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden mb-2">
              <div
                className={`h-full rounded-full ${pct >= 80 ? "bg-[#1F7A5C]" : pct >= 50 ? "bg-[#176B5B]" : pct >= 30 ? "bg-[#B0741E]" : "bg-[#B54747]"}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className={`text-xs ${p.status === "ok" ? "text-ink-mute" : "text-ink-mute italic"}`}>{valueLine(p)}</p>
          </div>
        );
      })}
    </div>
  );
}

// ── Trajectory: net worth over time, with the story annotated ───────────────
function Trajectory({
  chartData, annotations, estimated, ccy, range, setRange, t, catLabel,
}: {
  chartData: { label: string; value: number }[];
  annotations: Scorecard["annotations"];
  estimated: boolean;
  ccy: string;
  range: Range;
  setRange: (r: Range) => void;
  t: (k: string) => string;
  catLabel: (c: string) => string;
}) {
  const ranges: Range[] = ["3m", "6m", "1y", "all"];
  const hasChart = chartData.length >= 2;

  return (
    <div className="bg-surface border border-line rounded-xl p-5">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <p className="text-xs font-semibold text-ink-mute uppercase tracking-wider">{t("scorecard.trajectory.title")}</p>
          {estimated && hasChart && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-warn/10 border border-warn/30 text-warn">
              {t("scorecard.trajectory.estimated")}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 bg-canvas border border-line rounded-full p-0.5">
          {ranges.map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-2.5 py-0.5 rounded-full text-[11px] font-medium transition-colors ${
                range === r ? "bg-[#176B5B] text-white" : "text-ink-mute hover:text-ink-soft"
              }`}
            >
              {t(`scorecard.trajectory.range${r === "all" ? "All" : r}`)}
            </button>
          ))}
        </div>
      </div>

      {!hasChart ? (
        <div className="h-44 flex items-center justify-center">
          <p className="text-ink-mute text-sm text-center max-w-xs">{t("scorecard.trajectory.empty")}</p>
        </div>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={chartData} margin={{ top: 4, right: 12, left: 4, bottom: 0 }}>
              <defs>
                <linearGradient id="nwFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="rgb(var(--c-brand))" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="rgb(var(--c-brand))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--c-line))" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: "rgb(var(--c-text-muted))", fontSize: 10 }} axisLine={false} tickLine={false} minTickGap={28} />
              <YAxis
                tick={{ fill: "rgb(var(--c-text-muted))", fontSize: 10 }} axisLine={false} tickLine={false} width={44}
                tickFormatter={(v: number) => Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)}
              />
              <Tooltip
                contentStyle={{ backgroundColor: "rgb(var(--c-surface))", border: "1px solid rgb(var(--c-line))", borderRadius: 8 }}
                labelStyle={{ color: "rgb(var(--c-text))", fontSize: 12 }}
                itemStyle={{ fontSize: 12, color: "rgb(var(--c-brand))", fontWeight: 600 }}
                formatter={(v: number) => [fmt(v, ccy), undefined]}
              />
              <Area type="monotone" dataKey="value" stroke="rgb(var(--c-brand))" strokeWidth={2} fill="url(#nwFill)" />
            </AreaChart>
          </ResponsiveContainer>

          {annotations.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3">
              {annotations.map((a, i) => (
                <span
                  key={i}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] border ${
                    a.direction === "up"
                      ? "bg-pos/10 border-pos/30 text-pos"
                      : "bg-neg/10 border-neg/30 text-neg"
                  }`}
                >
                  <span className="text-ink-mute">{fmtDate(a.date, true)}</span>
                  {a.direction === "up" ? "▲" : "▼"} {fmt(a.amount, ccy)}
                  {a.mover && <span className="text-ink-mute">· {catLabel(a.mover)}</span>}
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
      <p className="text-xs font-semibold text-ink-mute uppercase tracking-wider mb-3">{t("scorecard.drivers.title")}</p>
      {!best && !worst ? (
        <div className="bg-surface border border-line rounded-xl p-5 text-center text-ink-mute text-sm">
          {t("scorecard.drivers.none")}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {best && (
            <div className="bg-surface border border-pos/30 rounded-xl p-4">
              <div className="flex items-center gap-2 text-pos text-xs font-semibold mb-2">
                <TrendingUp size={14} /> {t("scorecard.drivers.best")}
              </div>
              <p className="text-ink font-semibold">{label(best)}</p>
              <p className="text-pos/80 text-sm mt-0.5">
                {fmt(best.amount, ccy)} {best.kind === "debt" ? "" : t("scorecard.drivers.spentLess")}
              </p>
            </div>
          )}
          {worst && (
            <div className="bg-surface border border-neg/30 rounded-xl p-4">
              <div className="flex items-center gap-2 text-neg text-xs font-semibold mb-2">
                <TrendingDown size={14} /> {t("scorecard.drivers.worst")}
              </div>
              <p className="text-ink font-semibold">{label(worst)}</p>
              <p className="text-neg/80 text-sm mt-0.5">
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
        <p className="text-xs font-semibold text-ink-mute uppercase tracking-wider mb-3">{t("scorecard.milestones.title")}</p>
        <div className="bg-surface border border-line rounded-xl p-5 text-center text-ink-mute text-sm">
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
      return { text: `${fmtDate(m.date)}${approx}`, cls: "text-brand" };
    }
    if (m.status === "no_plan") return { text: t("scorecard.milestones.noPlan"), cls: "text-ink-mute" };
    if (m.status === "stalled") return { text: t("scorecard.milestones.stalled"), cls: "text-warn" };
    return { text: "—", cls: "text-ink-mute" };
  };

  return (
    <div>
      <p className="text-xs font-semibold text-ink-mute uppercase tracking-wider mb-3">{t("scorecard.milestones.title")}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {milestones.map((m) => {
          const d = detail(m);
          return (
            <div key={m.key} className="bg-surface border border-line rounded-xl p-4">
              <p className="text-xs text-ink-mute mb-1">{headline(m)}</p>
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
        <p className="text-xs font-semibold text-ink-mute uppercase tracking-wider">{t("scorecard.streaks.title")}</p>
        <button
          onClick={() => setManageGoals(!manageGoals)}
          className="flex items-center gap-1 text-xs text-brand hover:text-brand transition-colors"
        >
          {t("scorecard.streaks.manage")} {manageGoals ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>
      </div>

      {streaks.length === 0 ? (
        <div className="bg-surface border border-line rounded-xl p-5 text-center text-ink-mute text-sm">
          {t("scorecard.streaks.empty")}
        </div>
      ) : (
        <div className="space-y-2.5">
          {streaks.map((s) => {
            const over = s.current_pct > 100;
            const pct = Math.min(100, s.current_pct);
            return (
              <div key={s.category} className="bg-surface border border-line rounded-xl p-4">
                <div className="flex items-center justify-between mb-2 gap-2">
                  <span className="text-sm text-ink-soft font-medium truncate">{catLabel(s.category)}</span>
                  {s.months > 0 ? (
                    <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-warn/10 border border-warn/30 text-warn shrink-0">
                      <Flame size={11} /> {s.months} {t("scorecard.streaks.monthsUnder")}
                    </span>
                  ) : (
                    <span className="text-xs text-ink-mute shrink-0">{t("scorecard.streaks.newGoal")}</span>
                  )}
                </div>
                <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden mb-1.5">
                  <div className={`h-full rounded-full ${over ? "bg-[#B54747]" : pct > 85 ? "bg-[#B0741E]" : "bg-[#1F7A5C]"}`} style={{ width: `${pct}%` }} />
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-ink-mute">{fmt(s.spent, ccy)} / {fmt(s.limit, ccy)}</span>
                  <span className={over ? "text-neg font-medium" : "text-ink-mute"}>
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
