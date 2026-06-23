"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import PageLayout from "@/components/ui/PageLayout";
import { FileText, ArrowRight, TrendingUp, TrendingDown } from "@/components/ui/Icons";
import { useLanguage } from "@/lib/i18n";
import {
  getToken, getStoredUser, getDefaultCurrency, CURRENCY_CHANGE_EVENT,
  getFinancialReport, downloadTransactionsCsv, type FinancialReport,
} from "@/lib/api";

const PERIODS = ["this_month", "last_month", "quarter", "ytd", "last_30", "all"];
const PALETTE = ["#4f46e5", "#10b981", "#f59e0b", "#0ea5e9", "#a855f7", "#ef4444", "#14b8a6", "#f97316", "#6366f1", "#84cc16"];

export default function ReportsPage() {
  const router = useRouter();
  const { t, lang } = useLanguage();
  const [ccy, setCcy] = useState("TRY");
  const [email, setEmail] = useState<string>("");
  const [period, setPeriod] = useState("this_month");
  const [report, setReport] = useState<FinancialReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [csvBusy, setCsvBusy] = useState(false);

  useEffect(() => {
    if (!getToken()) { router.replace("/login"); return; }
    setEmail(getStoredUser()?.email ?? "");
    setCcy(getDefaultCurrency());
    const h = (e: Event) => setCcy((e as CustomEvent<string>).detail);
    window.addEventListener(CURRENCY_CHANGE_EVENT, h);
    return () => window.removeEventListener(CURRENCY_CHANGE_EVENT, h);
  }, [router]);

  useEffect(() => {
    setLoading(true);
    getFinancialReport(period, ccy, lang).then(setReport).catch(() => setReport(null)).finally(() => setLoading(false));
  }, [period, ccy, lang]);

  const money = useCallback((n: number) => {
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency: ccy, maximumFractionDigits: 0 }).format(n);
    } catch {
      return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(n)} ${ccy}`;
    }
  }, [ccy]);

  const exportPdf = () => window.print();
  const exportCsv = async () => { setCsvBusy(true); try { await downloadTransactionsCsv(period, ccy); } catch { /* ignore */ } finally { setCsvBusy(false); } };

  const nw = report?.net_worth;
  const cf = report?.cash_flow;
  const up = (nw?.change ?? 0) >= 0;

  return (
    <PageLayout maxWidth="lg">
      <style>{`@media print {
        body { background:#fff !important; }
        body * { visibility:hidden !important; }
        #report, #report * { visibility:visible !important; }
        #report { position:absolute; left:0; top:0; width:100%; box-shadow:none !important; border-radius:0 !important; }
        .no-print { display:none !important; }
        * { -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; }
      }`}</style>

      {/* Controls (not printed) */}
      <div className="no-print flex flex-wrap items-center gap-3 mb-5">
        <div className="flex items-center gap-2">
          <FileText size={18} className="text-indigo-400" />
          <h1 className="text-xl font-bold text-white">{t("report.title")}</h1>
        </div>
        <div className="flex-1" />
        <select value={period} onChange={(e) => setPeriod(e.target.value)}
          className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-600">
          {PERIODS.map((p) => <option key={p} value={p}>{t(`report.period.${p}`)}</option>)}
        </select>
        <button onClick={exportCsv} disabled={csvBusy}
          className="px-3 py-2 rounded-lg border border-[#2A2A2A] text-gray-300 hover:text-white text-sm font-medium disabled:opacity-50">
          {t("report.csv")}
        </button>
        <button onClick={exportPdf} disabled={!report}
          className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold disabled:opacity-50 flex items-center gap-1.5">
          {t("report.pdf")} <ArrowRight size={15} />
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 text-gray-500 py-24">
          <span className="w-5 h-5 border-2 border-gray-600 border-t-indigo-400 rounded-full animate-spin" /> {t("report.building")}
        </div>
      ) : !report ? (
        <p className="text-gray-500 text-center py-24">{t("report.empty")}</p>
      ) : (
        <div id="report" className="bg-white text-gray-900 rounded-2xl shadow-2xl shadow-black/40 overflow-hidden">
          {/* Accent bar */}
          <div className="h-1.5 bg-gradient-to-r from-indigo-600 via-violet-500 to-indigo-600" />

          <div className="px-8 sm:px-12 py-9">
            {/* Header */}
            <div className="flex items-start justify-between mb-8">
              <div>
                <p className="text-2xl font-extrabold tracking-tight">Mizan</p>
                <p className="text-gray-500 text-sm">{t("report.docTitle")}</p>
              </div>
              <div className="text-right text-sm">
                <p className="font-semibold text-gray-900">{report.meta.period_label}</p>
                <p className="text-gray-500">{report.meta.currency}{email ? ` · ${email}` : ""}</p>
                <p className="text-gray-400 text-xs mt-0.5">{new Date(report.meta.generated_at).toLocaleDateString()}</p>
              </div>
            </div>

            {/* Hero — net worth + verdict */}
            <div className="rounded-xl bg-gradient-to-br from-indigo-50 to-white border border-indigo-100 p-6 mb-8">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p className="text-indigo-600/70 text-xs font-semibold uppercase tracking-wider">{t("report.netWorthValue")}</p>
                  <p className="text-4xl font-extrabold tabular-nums mt-1">{money(nw!.net_worth)}</p>
                </div>
                {nw!.change !== null && (
                  <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold ${up ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
                    {up ? <TrendingUp size={15} /> : <TrendingDown size={15} />}
                    {up ? "+" : "−"}{money(Math.abs(nw!.change))}{nw!.estimated ? ` · ${t("report.estimated")}` : ""}
                  </span>
                )}
              </div>
              <p className="text-gray-700 text-[15px] leading-relaxed mt-4">{report.summary}</p>
            </div>

            {/* KPI cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-10">
              <Kpi label={t("report.assets")} value={money(nw!.total_assets)} accent="#10b981" />
              <Kpi label={t("report.liabilities")} value={money(nw!.total_liabilities)} accent="#ef4444" />
              <Kpi label={t("report.receivables")} value={money(nw!.pending_receivables)} accent="#f59e0b" />
              <Kpi label={t("report.net")} value={`${cf!.net >= 0 ? "+" : "−"}${money(Math.abs(cf!.net))}`} accent="#4f46e5" />
            </div>

            {/* Charts: trajectory + allocation */}
            <div className="grid lg:grid-cols-5 gap-8 mb-10">
              <div className="lg:col-span-3">
                <SectionTitle>{t("report.trajectory")}</SectionTitle>
                {report.trajectory.length >= 2 ? (
                  <AreaChart points={report.trajectory.map((p) => p.net_worth)}
                    startLabel={report.trajectory[0].date} endLabel={report.trajectory[report.trajectory.length - 1].date}
                    money={money} />
                ) : <p className="text-gray-400 text-sm">{t("report.estimated")}</p>}
              </div>
              <div className="lg:col-span-2">
                <SectionTitle>{t("report.allocation")}</SectionTitle>
                {report.allocation.length > 0
                  ? <Donut data={report.allocation.map((a) => ({ label: a.name, value: a.value, share: a.share }))} money={money} centerLabel={t("report.assets")} />
                  : <p className="text-gray-400 text-sm">—</p>}
              </div>
            </div>

            {/* Net worth statement */}
            {nw!.opening !== null && nw!.closing !== null && (
              <div className="mb-10">
                <SectionTitle>{t("report.netWorth")}</SectionTitle>
                <div className="grid grid-cols-3 gap-3">
                  <Pill label={t("report.opening")} value={money(nw!.opening)} />
                  <Pill label={t("report.closing")} value={money(nw!.closing)} />
                  <Pill label={t("report.change")} value={`${up ? "+" : "−"}${money(Math.abs(nw!.change ?? 0))}`} tone={up ? "up" : "down"} />
                </div>
              </div>
            )}

            {/* Cash flow */}
            <div className="mb-10">
              <SectionTitle>{t("report.cashFlow")}</SectionTitle>
              <div className="space-y-2.5 mb-5">
                <FlowBar label={t("report.income")} value={cf!.income} max={Math.max(cf!.income, cf!.expenses, 1)} color="#10b981" money={money} />
                <FlowBar label={t("report.expenses")} value={cf!.expenses} max={Math.max(cf!.income, cf!.expenses, 1)} color="#ef4444" money={money} />
              </div>
              {cf!.top_categories.length > 0 && (
                <div className="space-y-2">
                  {cf!.top_categories.map((c, i) => (
                    <div key={c.name}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-gray-700">{c.name}</span>
                        <span className="tabular-nums text-gray-500">{money(c.amount)} · {c.share.toFixed(0)}%</span>
                      </div>
                      <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${Math.min(c.share, 100)}%`, backgroundColor: PALETTE[i % PALETTE.length] }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Holdings + debts */}
            <div className="grid md:grid-cols-2 gap-8 mb-10">
              {report.assets.length > 0 && (
                <div>
                  <SectionTitle>{t("report.holdings")}</SectionTitle>
                  <Table head={[t("report.name"), t("report.value")]}
                    rows={report.assets.map((a) => [a.name, money(a.value)])} subtitles={report.assets.map((a) => a.type)} />
                </div>
              )}
              {report.liabilities.length > 0 && (
                <div>
                  <SectionTitle>{t("report.debts")}</SectionTitle>
                  <Table head={[t("report.name"), t("report.remaining")]}
                    rows={report.liabilities.map((l) => [l.name, money(l.remaining)])}
                    subtitles={report.liabilities.map((l) => l.monthly_payment ? `${money(l.monthly_payment)} / ${t("report.monthly").toLowerCase()}` : "")} />
                </div>
              )}
            </div>

            {/* Recommendations */}
            {report.recommendations.length > 0 && (
              <div className="mb-10">
                <SectionTitle>{t("report.recommendations")}</SectionTitle>
                <div className="space-y-3">
                  {report.recommendations.map((r, i) => (
                    <div key={i} className="flex gap-3 rounded-xl border border-gray-200 bg-gray-50 p-4">
                      <span className="shrink-0 w-7 h-7 rounded-lg bg-indigo-600 text-white text-sm font-bold flex items-center justify-center">{i + 1}</span>
                      <div>
                        <p className="font-semibold text-gray-900 text-sm">{r.title}</p>
                        <p className="text-gray-600 text-sm mt-0.5">{r.detail}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Footer */}
            <div className="border-t border-gray-200 pt-5">
              <p className="text-gray-400 text-[10px] uppercase tracking-wider mb-2">{t("report.assumptions")}</p>
              <ul className="text-gray-500 text-xs space-y-1">
                {report.assumptions.map((a, i) => <li key={i}>• {a}</li>)}
              </ul>
              <p className="text-gray-400 text-xs mt-4">{t("report.footer")}</p>
            </div>
          </div>
        </div>
      )}
    </PageLayout>
  );
}

/* ── presentational pieces ───────────────────────────────────────────────── */

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <span className="w-1 h-4 rounded-full bg-indigo-600" />
      <h2 className="text-[13px] font-bold uppercase tracking-wider text-gray-500">{children}</h2>
    </div>
  );
}

function Kpi({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 relative overflow-hidden">
      <span className="absolute left-0 top-0 bottom-0 w-1" style={{ backgroundColor: accent }} />
      <p className="text-gray-500 text-xs pl-1">{label}</p>
      <p className="text-lg font-bold tabular-nums mt-1 pl-1">{value}</p>
    </div>
  );
}

function Pill({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  const color = tone === "up" ? "text-emerald-600" : tone === "down" ? "text-red-600" : "text-gray-900";
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-center">
      <p className="text-gray-500 text-xs">{label}</p>
      <p className={`text-base font-bold tabular-nums mt-1 ${color}`}>{value}</p>
    </div>
  );
}

function FlowBar({ label, value, max, color, money }: { label: string; value: number; max: number; color: string; money: (n: number) => string }) {
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="text-gray-700">{label}</span>
        <span className="tabular-nums font-semibold" style={{ color }}>{money(value)}</span>
      </div>
      <div className="h-3 rounded-full bg-gray-100 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${Math.min((value / max) * 100, 100)}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

function Donut({ data, money, centerLabel }: { data: { label: string; value: number; share: number }[]; money: (n: number) => string; centerLabel: string }) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const r = 54, sw = 22, C = 2 * Math.PI * r;
  let acc = 0;
  return (
    <div className="flex items-center gap-5">
      <svg width="140" height="140" viewBox="0 0 140 140" className="shrink-0">
        <g transform="translate(70,70) rotate(-90)">
          <circle r={r} fill="none" stroke="#f1f5f9" strokeWidth={sw} />
          {data.map((d, i) => {
            const seg = (d.value / total) * C;
            const node = (
              <circle key={i} r={r} fill="none" stroke={PALETTE[i % PALETTE.length]} strokeWidth={sw}
                strokeDasharray={`${seg} ${C - seg}`} strokeDashoffset={-acc} strokeLinecap="butt" />
            );
            acc += seg;
            return node;
          })}
        </g>
        <text x="70" y="66" textAnchor="middle" fontSize="9" fill="#9ca3af">{centerLabel}</text>
        <text x="70" y="82" textAnchor="middle" fontSize="13" fontWeight="700" fill="#111827">{money(total)}</text>
      </svg>
      <div className="flex-1 space-y-1.5 min-w-0">
        {data.slice(0, 6).map((d, i) => (
          <div key={i} className="flex items-center justify-between text-xs gap-2">
            <span className="flex items-center gap-1.5 text-gray-700 min-w-0">
              <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: PALETTE[i % PALETTE.length] }} />
              <span className="truncate">{d.label}</span>
            </span>
            <span className="text-gray-500 tabular-nums shrink-0">{d.share.toFixed(0)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AreaChart({ points, startLabel, endLabel, money }: { points: number[]; startLabel: string; endLabel: string; money: (n: number) => string }) {
  const W = 600, H = 170, PT = 16, PB = 26, PL = 4, PR = 4;
  const min = Math.min(...points), max = Math.max(...points), range = max - min || 1;
  const x = (i: number) => PL + (i / (points.length - 1)) * (W - PL - PR);
  const y = (v: number) => PT + (1 - (v - min) / range) * (H - PT - PB);
  const line = points.map((v, i) => `${i ? "L" : "M"} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const area = `${line} L ${x(points.length - 1).toFixed(1)} ${H - PB} L ${x(0).toFixed(1)} ${H - PB} Z`;
  const grids = [0.25, 0.5, 0.75].map((g) => PT + g * (H - PT - PB));
  const last = points[points.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 200 }}>
      <defs>
        <linearGradient id="rep-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#4f46e5" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#4f46e5" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {grids.map((gy, i) => <line key={i} x1={PL} y1={gy} x2={W - PR} y2={gy} stroke="#eef2f7" strokeWidth="1" />)}
      <path d={area} fill="url(#rep-area)" />
      <path d={line} fill="none" stroke="#4f46e5" strokeWidth="2.5" strokeLinejoin="round" />
      <circle cx={x(points.length - 1)} cy={y(last)} r="3.5" fill="#4f46e5" />
      {/* y range labels */}
      <text x={PL} y={y(max) - 4} fontSize="10" fill="#9ca3af">{money(max)}</text>
      <text x={PL} y={y(min) + 12} fontSize="10" fill="#9ca3af">{money(min)}</text>
      {/* x labels */}
      <text x={PL} y={H - 8} fontSize="10" fill="#9ca3af">{startLabel}</text>
      <text x={W - PR} y={H - 8} fontSize="10" fill="#9ca3af" textAnchor="end">{endLabel}</text>
    </svg>
  );
}

function Table({ head, rows, subtitles }: { head: string[]; rows: string[][]; subtitles?: string[] }) {
  return (
    <table className="w-full text-sm">
      <thead><tr className="text-gray-400 text-[11px] uppercase tracking-wider border-b border-gray-200">
        <th className="text-left py-2 font-medium">{head[0]}</th>
        <th className="text-right py-2 font-medium">{head[1]}</th>
      </tr></thead>
      <tbody>
        {rows.map((r, ri) => (
          <tr key={ri} className="border-b border-gray-100">
            <td className="py-2.5">
              <p className="text-gray-800">{r[0]}</p>
              {subtitles?.[ri] ? <p className="text-gray-400 text-xs">{subtitles[ri]}</p> : null}
            </td>
            <td className="py-2.5 text-right tabular-nums text-gray-900 align-top">{r[1]}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
