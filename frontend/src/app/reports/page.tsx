"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import PageLayout from "@/components/ui/PageLayout";
import { FileText, ArrowRight } from "@/components/ui/Icons";
import { useLanguage } from "@/lib/i18n";
import {
  getToken, getDefaultCurrency, CURRENCY_CHANGE_EVENT,
  getFinancialReport, downloadTransactionsCsv, type FinancialReport,
} from "@/lib/api";

const PERIODS = ["this_month", "last_month", "quarter", "ytd", "last_30", "all"];

export default function ReportsPage() {
  const router = useRouter();
  const { t, lang } = useLanguage();
  const [ccy, setCcy] = useState("TRY");
  const [period, setPeriod] = useState("this_month");
  const [report, setReport] = useState<FinancialReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [csvBusy, setCsvBusy] = useState(false);

  useEffect(() => {
    if (!getToken()) { router.replace("/login"); return; }
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

  const trajPath = useMemo(() => {
    if (!report || report.trajectory.length < 2) return null;
    const pts = report.trajectory.map((p) => p.net_worth);
    const min = Math.min(...pts), max = Math.max(...pts);
    const range = max - min || 1;
    const W = 600, H = 120;
    const step = W / (pts.length - 1);
    return pts.map((v, i) => `${i === 0 ? "M" : "L"} ${(i * step).toFixed(1)} ${(H - ((v - min) / range) * H).toFixed(1)}`).join(" ");
  }, [report]);

  const exportPdf = () => window.print();
  const exportCsv = async () => { setCsvBusy(true); try { await downloadTransactionsCsv(period, ccy); } catch { /* ignore */ } finally { setCsvBusy(false); } };

  const nw = report?.net_worth;
  const cf = report?.cash_flow;

  return (
    <PageLayout maxWidth="lg">
      {/* print rules: hide app chrome + controls, show only the report */}
      <style>{`@media print {
        body { background: #fff !important; }
        body * { visibility: hidden !important; }
        #report, #report * { visibility: visible !important; }
        #report { position: absolute; left: 0; top: 0; width: 100%; box-shadow: none !important; border: none !important; }
        .no-print { display: none !important; }
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
        /* The document — light theme so it prints/shares as a professional artifact */
        <div id="report" className="bg-white text-gray-900 rounded-xl shadow-2xl shadow-black/40 px-8 sm:px-12 py-10 leading-relaxed">
          {/* Cover */}
          <div className="flex items-start justify-between border-b border-gray-200 pb-6 mb-6">
            <div>
              <p className="text-2xl font-extrabold tracking-tight text-gray-900">Mizan</p>
              <p className="text-gray-500 text-sm mt-0.5">{t("report.docTitle")}</p>
            </div>
            <div className="text-right text-sm">
              <p className="text-gray-900 font-semibold">{report.meta.period_label}</p>
              <p className="text-gray-500">{t("report.currency")}: {report.meta.currency}</p>
              <p className="text-gray-400 text-xs mt-1">{new Date(report.meta.generated_at).toLocaleString()}</p>
            </div>
          </div>

          {/* Executive summary */}
          <Section title={t("report.summary")}>
            <p className="text-gray-800 text-[15px]">{report.summary}</p>
          </Section>

          {/* Net worth statement */}
          <Section title={t("report.netWorth")}>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
              <Stat label={t("report.assets")} value={money(nw!.total_assets)} />
              <Stat label={t("report.liabilities")} value={money(nw!.total_liabilities)} negative />
              <Stat label={t("report.netWorthValue")} value={money(nw!.net_worth)} strong />
              <Stat label={t("report.receivables")} value={money(nw!.pending_receivables)} />
            </div>
            {nw!.opening !== null && nw!.closing !== null && (
              <table className="w-full text-sm border-t border-gray-200">
                <tbody>
                  <tr className="border-b border-gray-100">
                    <td className="py-2 text-gray-600">{t("report.opening")}</td>
                    <td className="py-2 text-right tabular-nums">{money(nw!.opening)}</td>
                  </tr>
                  <tr className="border-b border-gray-100">
                    <td className="py-2 text-gray-600">{t("report.closing")}</td>
                    <td className="py-2 text-right tabular-nums">{money(nw!.closing)}</td>
                  </tr>
                  <tr>
                    <td className="py-2 text-gray-900 font-semibold">{t("report.change")}{nw!.estimated ? ` (${t("report.estimated")})` : ""}</td>
                    <td className={`py-2 text-right tabular-nums font-semibold ${(nw!.change ?? 0) >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                      {(nw!.change ?? 0) >= 0 ? "+" : "−"}{money(Math.abs(nw!.change ?? 0))}
                    </td>
                  </tr>
                </tbody>
              </table>
            )}
          </Section>

          {/* Cash flow */}
          <Section title={t("report.cashFlow")}>
            <div className="grid grid-cols-3 gap-4 mb-4">
              <Stat label={t("report.income")} value={money(cf!.income)} />
              <Stat label={t("report.expenses")} value={money(cf!.expenses)} negative />
              <Stat label={t("report.net")} value={`${cf!.net >= 0 ? "+" : "−"}${money(Math.abs(cf!.net))}`} strong />
            </div>
            {cf!.top_categories.length > 0 && (
              <table className="w-full text-sm">
                <thead><tr className="text-gray-500 text-xs border-b border-gray-200">
                  <th className="text-left py-1.5 font-medium">{t("report.category")}</th>
                  <th className="text-right py-1.5 font-medium">{t("report.amount")}</th>
                  <th className="text-right py-1.5 font-medium">%</th>
                </tr></thead>
                <tbody>
                  {cf!.top_categories.map((c) => (
                    <tr key={c.name} className="border-b border-gray-100">
                      <td className="py-2 text-gray-700">{c.name}</td>
                      <td className="py-2 text-right tabular-nums">{money(c.amount)}</td>
                      <td className="py-2 text-right text-gray-500 tabular-nums">{c.share.toFixed(0)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          {/* Trajectory */}
          {trajPath && (
            <Section title={t("report.trajectory")}>
              <svg viewBox="0 0 600 120" className="w-full h-28" preserveAspectRatio="none">
                <path d={trajPath} fill="none" stroke="#4f46e5" strokeWidth="2.5" />
              </svg>
            </Section>
          )}

          {/* Allocation */}
          {report.allocation.length > 0 && (
            <Section title={t("report.allocation")}>
              <div className="space-y-2">
                {report.allocation.map((a) => (
                  <div key={a.name}>
                    <div className="flex justify-between text-sm mb-0.5">
                      <span className="text-gray-700">{a.name}</span>
                      <span className="tabular-nums text-gray-600">{money(a.value)} · {a.share.toFixed(0)}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                      <div className="h-full rounded-full bg-indigo-500" style={{ width: `${Math.min(a.share, 100)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Holdings tables */}
          {report.assets.length > 0 && (
            <Section title={t("report.holdings")}>
              <Table head={[t("report.name"), t("report.type"), t("report.value")]}
                rows={report.assets.map((a) => [a.name, a.type, money(a.value)])} alignLast />
            </Section>
          )}
          {report.liabilities.length > 0 && (
            <Section title={t("report.debts")}>
              <Table head={[t("report.name"), t("report.monthly"), t("report.remaining")]}
                rows={report.liabilities.map((l) => [l.name, l.monthly_payment ? money(l.monthly_payment) : "—", money(l.remaining)])} alignLast />
            </Section>
          )}

          {/* Recommendations */}
          {report.recommendations.length > 0 && (
            <Section title={t("report.recommendations")}>
              <ol className="space-y-3">
                {report.recommendations.map((r, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="shrink-0 w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold flex items-center justify-center">{i + 1}</span>
                    <div>
                      <p className="font-semibold text-gray-900 text-sm">{r.title}</p>
                      <p className="text-gray-600 text-sm">{r.detail}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </Section>
          )}

          {/* Footer / assumptions */}
          <div className="border-t border-gray-200 pt-5 mt-8">
            <p className="text-gray-400 text-[11px] uppercase tracking-wider mb-2">{t("report.assumptions")}</p>
            <ul className="text-gray-500 text-xs space-y-1">
              {report.assumptions.map((a, i) => <li key={i}>• {a}</li>)}
            </ul>
            <p className="text-gray-400 text-xs mt-4">{t("report.footer")}</p>
          </div>
        </div>
      )}
    </PageLayout>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-7">
      <h2 className="text-[13px] font-bold uppercase tracking-wider text-gray-400 mb-3">{title}</h2>
      {children}
    </section>
  );
}

function Stat({ label, value, strong, negative }: { label: string; value: string; strong?: boolean; negative?: boolean }) {
  return (
    <div>
      <p className="text-gray-500 text-xs">{label}</p>
      <p className={`tabular-nums mt-0.5 ${strong ? "text-lg font-bold text-gray-900" : negative ? "text-base font-semibold text-red-600" : "text-base font-semibold text-gray-900"}`}>{value}</p>
    </div>
  );
}

function Table({ head, rows, alignLast }: { head: string[]; rows: string[][]; alignLast?: boolean }) {
  return (
    <table className="w-full text-sm">
      <thead><tr className="text-gray-500 text-xs border-b border-gray-200">
        {head.map((h, i) => <th key={i} className={`py-1.5 font-medium ${alignLast && i === head.length - 1 ? "text-right" : "text-left"}`}>{h}</th>)}
      </tr></thead>
      <tbody>
        {rows.map((r, ri) => (
          <tr key={ri} className="border-b border-gray-100">
            {r.map((c, ci) => <td key={ci} className={`py-2 ${alignLast && ci === r.length - 1 ? "text-right tabular-nums text-gray-900" : "text-gray-700"}`}>{c}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
