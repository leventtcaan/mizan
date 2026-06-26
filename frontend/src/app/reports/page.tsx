"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import PageLayout from "@/components/ui/PageLayout";
import { FileText, ArrowRight, TrendingUp, TrendingDown } from "@/components/ui/Icons";
import { useLanguage, getCurrentLang } from "@/lib/i18n";
import {
  getToken, getStoredUser, getDefaultCurrency, CURRENCY_CHANGE_EVENT,
  getFinancialReport, downloadReportCsv, downloadReportXlsx, type FinancialReport,
} from "@/lib/api";

const PERIODS = ["this_month", "last_month", "quarter", "ytd", "last_30", "all"];

/* The report "paper" is a self-contained light document: it must look identical
   and correct in light mode, dark mode AND in print. So it uses ONLY fixed colors
   (never the app's theme tokens, which would resolve to dark values on white paper).
   Refined, teal-led, accountant-grade palette. */
const INK = "#0F172A";      // near-black headings
const INK2 = "#334155";     // body
const MUTE = "#64748B";     // secondary
const FAINT = "#94A3B8";    // captions
const LINE = "#E5E7EB";     // hairline
const HAIR = "#F1F5F9";     // faint rule / grid
const PANEL = "#F8FAFC";    // inset panels
const TEAL = "#0F5C5E";     // brand
const TEAL_ACC = "#176B5B"; // action teal
const POS = "#1F7A5C";
const NEG = "#B54747";
const WARN = "#B0741E";
const CHART = ["#0F5C5E", "#2F9E8F", "#C99A2E", "#3B7DA8", "#8A6FB0", "#B54747", "#5BA88F", "#94A3B8"];

export default function ReportsPage() {
  const router = useRouter();
  const { t, lang } = useLanguage();
  // Must start from an SSR-safe constant: getDefaultCurrency() reads localStorage, which
  // doesn't exist on the server, so a lazy init would render "USD"/"TRY" differently on
  // server vs client and throw a hydration error. Set the real currency in useEffect.
  const [ccy, setCcy] = useState("TRY");
  const [email, setEmail] = useState<string>("");
  const [period, setPeriod] = useState("this_month");
  const [report, setReport] = useState<FinancialReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [csvBusy, setCsvBusy] = useState(false);
  const [xlsxBusy, setXlsxBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

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
    // getCurrentLang() resolves the language synchronously, so even the first fetch
    // uses the real stored language (the hook's `lang` starts at the SSR-safe "tr");
    // `lang` stays in deps so a language toggle re-fetches.
    getFinancialReport(period, ccy, getCurrentLang()).then(setReport).catch(() => setReport(null)).finally(() => setLoading(false));
  }, [period, ccy, lang]);

  const money = useCallback((n: number) => {
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency: ccy, maximumFractionDigits: 0 }).format(n);
    } catch {
      return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(n)} ${ccy}`;
    }
  }, [ccy]);

  // window.print() is the PDF path (browser "Save as PDF"). Run it after the next
  // paint so the freshly-rendered report is what gets captured, and guard against
  // environments where print is unavailable.
  const exportPdf = () => {
    if (typeof window === "undefined" || typeof window.print !== "function") return;
    setExportError(null);
    requestAnimationFrame(() => { try { window.print(); } catch { setExportError(t("report.exportError")); } });
  };
  const exportCsv = async () => {
    setExportError(null); setCsvBusy(true);
    try { await downloadReportCsv(period, ccy, getCurrentLang()); }
    catch { setExportError(t("report.exportError")); }
    finally { setCsvBusy(false); }
  };
  const exportExcel = async () => {
    setExportError(null); setXlsxBusy(true);
    try { await downloadReportXlsx(period, ccy, getCurrentLang()); }
    catch { setExportError(t("report.exportError")); }
    finally { setXlsxBusy(false); }
  };

  const nw = report?.net_worth;
  const cf = report?.cash_flow;
  const up = (nw?.change ?? 0) >= 0;
  const cfPositive = (cf?.net ?? 0) >= 0;
  const generatedDate = report ? new Date(report.meta.generated_at).toLocaleDateString(lang === "tr" ? "tr-TR" : "en-US", { day: "2-digit", month: "long", year: "numeric" }) : "";

  return (
    <PageLayout maxWidth="lg">
      <style>{`@media print {
        @page { margin: 12mm; }
        body { background:#fff !important; }
        body * { visibility:hidden !important; }
        #report, #report * { visibility:visible !important; }
        #report { position:absolute; left:0; top:0; width:100%; box-shadow:none !important; border:none !important; border-radius:0 !important; }
        .no-print { display:none !important; }
        .break-avoid { break-inside: avoid; }
        * { -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; }
      }`}</style>

      {/* ── Controls (app-themed, not printed) ───────────────────────────── */}
      <div className="no-print mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <span className="w-10 h-10 rounded-xl bg-brand/10 flex items-center justify-center shrink-0">
            <FileText size={20} className="text-brand" />
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-ink leading-tight">{t("report.title")}</h1>
            <p className="text-xs text-ink-mute">{t("report.docTitle")} · {ccy}</p>
          </div>
          <div className="flex-1" />
          <select value={period} onChange={(e) => setPeriod(e.target.value)}
            className="bg-surface border border-line rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-[#176B5B] focus:ring-2 focus:ring-[#176B5B]/20 transition-shadow">
            {PERIODS.map((p) => <option key={p} value={p}>{t(`report.period.${p}`)}</option>)}
          </select>
          <button onClick={exportCsv} disabled={csvBusy || !report}
            className="px-3.5 py-2 rounded-lg border border-line bg-surface text-ink-soft hover:text-ink hover:border-line-strong text-sm font-medium disabled:opacity-50 transition-colors">
            {csvBusy ? "…" : t("report.csv")}
          </button>
          <button onClick={exportExcel} disabled={xlsxBusy || !report}
            className="px-3.5 py-2 rounded-lg border border-line bg-surface text-ink-soft hover:text-ink hover:border-line-strong text-sm font-medium disabled:opacity-50 transition-colors">
            {xlsxBusy ? "…" : t("report.excel")}
          </button>
          <button onClick={exportPdf} disabled={!report}
            className="px-4 py-2 rounded-lg bg-[#176B5B] hover:bg-[#125848] text-white text-sm font-semibold shadow-sm disabled:opacity-50 flex items-center gap-1.5 transition-colors">
            {t("report.pdf")} <ArrowRight size={15} />
          </button>
        </div>
        {exportError && <p className="text-danger text-xs mt-2 text-right">{exportError}</p>}
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 text-ink-mute py-24">
          <span className="w-5 h-5 border-2 border-line border-t-[#176B5B] rounded-full animate-spin" /> {t("report.building")}
        </div>
      ) : !report ? (
        <div className="text-center py-24">
          <p className="text-ink-mute">{t("report.empty")}</p>
        </div>
      ) : (
        /* ── The document ─────────────────────────────────────────────── */
        <div
          id="report"
          className="rounded-2xl overflow-hidden shadow-2xl shadow-black/30 ring-1 ring-black/5"
          style={{ backgroundColor: "#FFFFFF", color: INK2 }}
        >
          {/* Brand band */}
          <div style={{ height: 4, background: `linear-gradient(90deg, ${TEAL} 0%, ${TEAL_ACC} 55%, #2F9E8F 100%)` }} />

          <div className="px-7 sm:px-12 py-9">
            {/* ── Letterhead ────────────────────────────────────────────── */}
            <header className="flex items-start justify-between gap-4 pb-6 break-avoid" style={{ borderBottom: `1px solid ${LINE}` }}>
              <div className="flex items-center gap-3">
                <span className="w-11 h-11 rounded-xl flex items-center justify-center text-white text-xl font-bold shrink-0" style={{ backgroundColor: TEAL, fontFamily: "Georgia, 'Times New Roman', serif" }}>M</span>
                <div>
                  <p className="text-xl font-bold tracking-tight" style={{ color: INK, fontFamily: "Georgia, 'Times New Roman', serif" }}>Mizan</p>
                  <p className="text-[13px]" style={{ color: MUTE }}>{t("report.docTitle")}</p>
                </div>
              </div>
              <div className="text-right text-[12px] leading-relaxed">
                <p className="text-sm font-semibold" style={{ color: INK }}>{report.meta.period_label}</p>
                {email && <p style={{ color: MUTE }}>{t("report.preparedFor")}: {email}</p>}
                <p style={{ color: FAINT }}>{t("report.generated")}: {generatedDate}</p>
              </div>
            </header>

            {/* ── Executive summary + net worth headline ────────────────── */}
            <section className="mt-7 grid lg:grid-cols-5 gap-6 break-avoid">
              <div className="lg:col-span-2 rounded-2xl p-6 flex flex-col justify-center" style={{ backgroundColor: TEAL, color: "#FFFFFF" }}>
                <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.7)" }}>{t("report.netWorthValue")}</p>
                <p className="text-4xl font-extrabold tabular-nums mt-1.5 leading-none">{money(nw!.net_worth)}</p>
                {nw!.change !== null && (
                  <span className="inline-flex items-center gap-1.5 mt-4 self-start px-2.5 py-1 rounded-full text-xs font-semibold" style={{ backgroundColor: "rgba(255,255,255,0.16)", color: "#FFFFFF" }}>
                    {up ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                    {up ? "+" : "−"}{money(Math.abs(nw!.change))}{nw!.estimated ? ` · ${t("report.estimated")}` : ""}
                  </span>
                )}
              </div>
              <div className="lg:col-span-3 flex flex-col">
                <SectionLabel>{t("report.summary")}</SectionLabel>
                <p className="text-[15px] leading-relaxed mt-1" style={{ color: INK2 }}>{report.summary}</p>
              </div>
            </section>

            {/* ── KPI strip ─────────────────────────────────────────────── */}
            <section className="mt-8 grid grid-cols-2 lg:grid-cols-4 gap-3 break-avoid">
              <Kpi label={t("report.assets")} value={money(nw!.total_assets)} accent={POS} />
              <Kpi label={t("report.liabilities")} value={money(nw!.total_liabilities)} accent={NEG} />
              <Kpi label={t("report.receivables")} value={money(nw!.pending_receivables)} accent={WARN} />
              <Kpi label={t("report.netCashFlow")} value={`${cfPositive ? "+" : "−"}${money(Math.abs(cf!.net))}`} accent={TEAL_ACC} valueColor={cfPositive ? POS : NEG} />
            </section>

            {/* ── Trajectory + Allocation ───────────────────────────────── */}
            <section className="mt-10 grid lg:grid-cols-5 gap-10 break-avoid">
              <div className="lg:col-span-3">
                <SectionLabel>{t("report.trajectory")}</SectionLabel>
                <div className="mt-3">
                  {report.trajectory.length >= 2 ? (
                    <AreaChart points={report.trajectory.map((p) => p.net_worth)}
                      startLabel={report.trajectory[0].date} endLabel={report.trajectory[report.trajectory.length - 1].date}
                      money={money} />
                  ) : <EmptyChart label={t("report.noChartData")} />}
                </div>
              </div>
              <div className="lg:col-span-2">
                <SectionLabel>{t("report.allocation")}</SectionLabel>
                <div className="mt-3">
                  {report.allocation.length > 0
                    ? <Donut data={report.allocation.map((a) => ({ label: a.name, value: a.value, share: a.share }))} money={money} centerLabel={t("report.assets")} />
                    : <EmptyChart label={t("report.noChartData")} />}
                </div>
              </div>
            </section>

            {/* ── Net worth statement + Cash flow (statement form) ──────── */}
            <section className="mt-10 grid md:grid-cols-2 gap-10 break-avoid">
              {/* Net worth statement */}
              <div>
                <SectionLabel>{t("report.netWorth")}</SectionLabel>
                <div className="mt-3 rounded-xl px-4 py-1" style={{ border: `1px solid ${LINE}` }}>
                  {nw!.opening !== null && nw!.closing !== null ? (
                    <>
                      <StmtRow label={t("report.opening")} value={money(nw!.opening)} />
                      <StmtRow label={t("report.netChange")} value={`${up ? "+" : "−"}${money(Math.abs(nw!.change ?? 0))}`} tone={up ? "up" : "down"} />
                      <StmtRow label={t("report.closing")} value={money(nw!.closing)} bold ruled />
                    </>
                  ) : (
                    <>
                      <StmtRow label={t("report.assets")} value={money(nw!.total_assets)} />
                      <StmtRow label={t("report.liabilities")} value={`−${money(nw!.total_liabilities)}`} tone="down" />
                      <StmtRow label={t("report.netWorthValue")} value={money(nw!.net_worth)} bold ruled />
                    </>
                  )}
                  {nw!.estimated && <p className="text-[11px] py-2" style={{ color: FAINT }}>* {t("report.estimated")}</p>}
                </div>
              </div>

              {/* Cash flow statement */}
              <div>
                <SectionLabel>{t("report.cashFlow")}</SectionLabel>
                <div className="mt-3 rounded-xl px-4 py-1" style={{ border: `1px solid ${LINE}` }}>
                  <StmtRow label={t("report.income")} value={money(cf!.income)} tone="up" />
                  <StmtRow label={t("report.expenses")} value={`−${money(cf!.expenses)}`} tone="down" />
                  <StmtRow label={`${t("report.net")} · ${cfPositive ? t("report.positive") : t("report.negative")}`} value={`${cfPositive ? "+" : "−"}${money(Math.abs(cf!.net))}`} bold ruled tone={cfPositive ? "up" : "down"} />
                </div>
                {/* Income vs expense visual */}
                <div className="mt-4 space-y-2.5">
                  <FlowBar label={t("report.income")} value={cf!.income} max={Math.max(cf!.income, cf!.expenses, 1)} color={POS} money={money} />
                  <FlowBar label={t("report.expenses")} value={cf!.expenses} max={Math.max(cf!.income, cf!.expenses, 1)} color={NEG} money={money} />
                </div>
              </div>
            </section>

            {/* ── Top spending categories ───────────────────────────────── */}
            {cf!.top_categories.length > 0 && (
              <section className="mt-10 break-avoid">
                <SectionLabel>{t("report.expenses")} · {t("report.category")}</SectionLabel>
                <div className="mt-3 grid sm:grid-cols-2 gap-x-10 gap-y-3">
                  {cf!.top_categories.map((c, i) => (
                    <div key={c.name}>
                      <div className="flex justify-between text-[13px] mb-1">
                        <span style={{ color: INK2 }}>{c.name}</span>
                        <span className="tabular-nums" style={{ color: MUTE }}>{money(c.amount)} · {c.share.toFixed(0)}%</span>
                      </div>
                      <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: HAIR }}>
                        <div className="h-full rounded-full" style={{ width: `${Math.min(c.share, 100)}%`, backgroundColor: CHART[i % CHART.length] }} />
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* ── Holdings + Debts ──────────────────────────────────────── */}
            {(report.assets.length > 0 || report.liabilities.length > 0) && (
              <section className="mt-10 grid md:grid-cols-2 gap-10 break-avoid">
                {report.assets.length > 0 && (
                  <div>
                    <SectionLabel>{t("report.holdings")}</SectionLabel>
                    <Table
                      head={[t("report.name"), t("report.value")]}
                      rows={report.assets.map((a) => [a.name, money(a.value)])}
                      subtitles={report.assets.map((a) => a.type)}
                      total={{ label: t("report.total"), value: money(report.assets.reduce((s, a) => s + a.value, 0)) }}
                    />
                  </div>
                )}
                {report.liabilities.length > 0 && (
                  <div>
                    <SectionLabel>{t("report.debts")}</SectionLabel>
                    <Table
                      head={[t("report.name"), t("report.remaining")]}
                      rows={report.liabilities.map((l) => [l.name, money(l.remaining)])}
                      subtitles={report.liabilities.map((l) => l.monthly_payment ? `${money(l.monthly_payment)} / ${t("report.monthly").toLowerCase()}` : "")}
                      total={{ label: t("report.total"), value: money(report.liabilities.reduce((s, l) => s + l.remaining, 0)) }}
                    />
                  </div>
                )}
              </section>
            )}

            {/* ── Receivables (accounts receivable) ─────────────────────── */}
            {report.receivables.length > 0 && (
              <section className="mt-10 break-avoid">
                <SectionLabel>{t("report.receivables")}</SectionLabel>
                <Table
                  head={[t("report.from"), t("report.amount")]}
                  rows={report.receivables.map((r) => [r.from_person, money(r.amount)])}
                  subtitles={report.receivables.map((r) => r.expected_date ? `${t("report.due")}: ${r.expected_date}` : t("report.noDate"))}
                  total={{ label: t("report.total"), value: money(report.receivables.reduce((s, r) => s + r.amount, 0)) }}
                />
              </section>
            )}

            {/* ── Currency exposure ─────────────────────────────────────── */}
            {report.currency_mix.length > 1 && (
              <section className="mt-10 break-avoid">
                <SectionLabel>{t("report.currencyExposure")}</SectionLabel>
                <div className="mt-3 flex h-3 rounded-full overflow-hidden" style={{ border: `1px solid ${LINE}` }}>
                  {report.currency_mix.map((c, i) => (
                    <div key={c.code} style={{ width: `${Math.max(c.share, 0)}%`, backgroundColor: CHART[i % CHART.length] }} title={`${c.code} ${c.share.toFixed(0)}%`} />
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
                  {report.currency_mix.map((c, i) => (
                    <div key={c.code} className="flex items-center gap-2 text-[13px]">
                      <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: CHART[i % CHART.length] }} />
                      <span className="font-medium" style={{ color: INK }}>{c.code}</span>
                      <span className="tabular-nums" style={{ color: MUTE }}>{money(c.value)} · {c.share.toFixed(0)}%</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* ── Recommendations ───────────────────────────────────────── */}
            {report.recommendations.length > 0 && (
              <section className="mt-10 break-avoid">
                <SectionLabel>{t("report.recommendations")}</SectionLabel>
                <div className="mt-3 space-y-2.5">
                  {report.recommendations.map((r, i) => (
                    <div key={i} className="flex gap-3 rounded-xl p-4" style={{ backgroundColor: PANEL, border: `1px solid ${LINE}` }}>
                      <span className="shrink-0 w-6 h-6 rounded-lg text-white text-xs font-bold flex items-center justify-center" style={{ backgroundColor: TEAL }}>{i + 1}</span>
                      <div>
                        <p className="font-semibold text-sm" style={{ color: INK }}>{r.title}</p>
                        <p className="text-sm mt-0.5 leading-relaxed" style={{ color: MUTE }}>{r.detail}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* ── Footer ────────────────────────────────────────────────── */}
            <footer className="mt-10 pt-5 break-avoid" style={{ borderTop: `1px solid ${LINE}` }}>
              {report.assumptions.length > 0 && (
                <>
                  <p className="text-[10px] uppercase tracking-wider mb-2" style={{ color: FAINT }}>{t("report.assumptions")}</p>
                  <ul className="text-[11px] space-y-1 mb-4 grid sm:grid-cols-2 gap-x-8" style={{ color: MUTE }}>
                    {report.assumptions.map((a, i) => <li key={i}>• {a}</li>)}
                  </ul>
                </>
              )}
              <div className="flex items-center justify-between flex-wrap gap-2 text-[11px]" style={{ color: FAINT }}>
                <span>{t("report.confidential")}</span>
                <span>{report.meta.period_label} · {ccy} · {generatedDate}</span>
              </div>
              <p className="text-[11px] mt-2" style={{ color: FAINT }}>{t("report.footer")}</p>
            </footer>
          </div>
        </div>
      )}
    </PageLayout>
  );
}

/* ── presentational pieces (fixed-color, document-internal) ───────────────── */

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-1 h-3.5 rounded-full" style={{ backgroundColor: TEAL }} />
      <h2 className="text-[12px] font-bold uppercase tracking-wider" style={{ color: MUTE }}>{children}</h2>
    </div>
  );
}

function Kpi({ label, value, accent, valueColor }: { label: string; value: string; accent: string; valueColor?: string }) {
  return (
    <div className="rounded-xl p-4 relative overflow-hidden" style={{ border: `1px solid ${LINE}`, backgroundColor: "#FFFFFF" }}>
      <span className="absolute left-0 top-0 right-0 h-1" style={{ backgroundColor: accent }} />
      <p className="text-[11px] mt-1" style={{ color: MUTE }}>{label}</p>
      <p className="text-[19px] font-bold tabular-nums mt-1" style={{ color: valueColor ?? INK }}>{value}</p>
    </div>
  );
}

function StmtRow({ label, value, bold, tone, ruled }: { label: string; value: string; bold?: boolean; tone?: "up" | "down"; ruled?: boolean }) {
  const valColor = bold ? INK : tone === "up" ? POS : tone === "down" ? NEG : INK2;
  return (
    <div className="flex items-center justify-between py-2.5" style={ruled ? { borderTop: `1.5px solid ${LINE}` } : undefined}>
      <span className={`text-[13px] ${bold ? "font-semibold" : ""}`} style={{ color: bold ? INK : INK2 }}>{label}</span>
      <span className={`tabular-nums ${bold ? "text-[15px] font-bold" : "text-[13px] font-medium"}`} style={{ color: valColor }}>{value}</span>
    </div>
  );
}

function FlowBar({ label, value, max, color, money }: { label: string; value: number; max: number; color: string; money: (n: number) => string }) {
  return (
    <div>
      <div className="flex justify-between text-[13px] mb-1">
        <span style={{ color: INK2 }}>{label}</span>
        <span className="tabular-nums font-semibold" style={{ color }}>{money(value)}</span>
      </div>
      <div className="h-2.5 rounded-full overflow-hidden" style={{ backgroundColor: HAIR }}>
        <div className="h-full rounded-full" style={{ width: `${Math.min((value / max) * 100, 100)}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="rounded-xl flex items-center justify-center text-[13px]" style={{ height: 150, backgroundColor: PANEL, border: `1px dashed ${LINE}`, color: FAINT }}>
      {label}
    </div>
  );
}

function Donut({ data, money, centerLabel }: { data: { label: string; value: number; share: number }[]; money: (n: number) => string; centerLabel: string }) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const r = 54, sw = 20, C = 2 * Math.PI * r;
  let acc = 0;
  return (
    <div className="flex items-center gap-5">
      <svg width="140" height="140" viewBox="0 0 140 140" className="shrink-0">
        <g transform="translate(70,70) rotate(-90)">
          <circle r={r} fill="none" stroke={HAIR} strokeWidth={sw} />
          {data.map((d, i) => {
            const seg = (d.value / total) * C;
            const node = (
              <circle key={i} r={r} fill="none" stroke={CHART[i % CHART.length]} strokeWidth={sw}
                strokeDasharray={`${seg} ${C - seg}`} strokeDashoffset={-acc} strokeLinecap="butt" />
            );
            acc += seg;
            return node;
          })}
        </g>
        <text x="70" y="65" textAnchor="middle" fontSize="9" fill={FAINT}>{centerLabel}</text>
        <text x="70" y="82" textAnchor="middle" fontSize="13" fontWeight="700" fill={INK}>{money(total)}</text>
      </svg>
      <div className="flex-1 space-y-2 min-w-0">
        {data.slice(0, 6).map((d, i) => (
          <div key={i} className="flex items-center justify-between text-[12px] gap-2">
            <span className="flex items-center gap-2 min-w-0" style={{ color: INK2 }}>
              <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: CHART[i % CHART.length] }} />
              <span className="truncate">{d.label}</span>
            </span>
            <span className="tabular-nums shrink-0 font-medium" style={{ color: MUTE }}>{d.share.toFixed(0)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AreaChart({ points, startLabel, endLabel, money }: { points: number[]; startLabel: string; endLabel: string; money: (n: number) => string }) {
  const W = 600, H = 180, PT = 18, PB = 26, PL = 4, PR = 4;
  const min = Math.min(...points), max = Math.max(...points), range = max - min || 1;
  const x = (i: number) => PL + (i / (points.length - 1)) * (W - PL - PR);
  const y = (v: number) => PT + (1 - (v - min) / range) * (H - PT - PB);
  const line = points.map((v, i) => `${i ? "L" : "M"} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const area = `${line} L ${x(points.length - 1).toFixed(1)} ${H - PB} L ${x(0).toFixed(1)} ${H - PB} Z`;
  const grids = [0.25, 0.5, 0.75].map((g) => PT + g * (H - PT - PB));
  const last = points[points.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 210 }}>
      <defs>
        <linearGradient id="rep-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={TEAL} stopOpacity="0.20" />
          <stop offset="100%" stopColor={TEAL} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {grids.map((gy, i) => <line key={i} x1={PL} y1={gy} x2={W - PR} y2={gy} stroke={HAIR} strokeWidth="1" />)}
      <path d={area} fill="url(#rep-area)" />
      <path d={line} fill="none" stroke={TEAL} strokeWidth="2.5" strokeLinejoin="round" />
      <circle cx={x(points.length - 1)} cy={y(last)} r="3.5" fill={TEAL} />
      <text x={PL} y={y(max) - 5} fontSize="10" fill={FAINT}>{money(max)}</text>
      <text x={PL} y={y(min) + 13} fontSize="10" fill={FAINT}>{money(min)}</text>
      <text x={PL} y={H - 8} fontSize="10" fill={FAINT}>{startLabel}</text>
      <text x={W - PR} y={H - 8} fontSize="10" fill={FAINT} textAnchor="end">{endLabel}</text>
    </svg>
  );
}

function Table({ head, rows, subtitles, total }: { head: string[]; rows: string[][]; subtitles?: string[]; total?: { label: string; value: string } }) {
  return (
    <table className="w-full text-sm mt-2">
      <thead>
        <tr className="text-[11px] uppercase tracking-wider" style={{ color: FAINT, borderBottom: `1px solid ${LINE}` }}>
          <th className="text-left py-2 font-medium">{head[0]}</th>
          <th className="text-right py-2 font-medium">{head[1]}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, ri) => (
          <tr key={ri} style={{ borderBottom: `1px solid ${HAIR}` }}>
            <td className="py-2.5 align-top">
              <p style={{ color: INK }}>{r[0]}</p>
              {subtitles?.[ri] ? <p className="text-[11px]" style={{ color: MUTE }}>{subtitles[ri]}</p> : null}
            </td>
            <td className="py-2.5 text-right tabular-nums align-top font-medium" style={{ color: INK }}>{r[1]}</td>
          </tr>
        ))}
      </tbody>
      {total && (
        <tfoot>
          <tr style={{ borderTop: `1.5px solid ${LINE}` }}>
            <td className="py-2.5 font-semibold text-[13px]" style={{ color: INK }}>{total.label}</td>
            <td className="py-2.5 text-right tabular-nums font-bold text-[14px]" style={{ color: INK }}>{total.value}</td>
          </tr>
        </tfoot>
      )}
    </table>
  );
}
