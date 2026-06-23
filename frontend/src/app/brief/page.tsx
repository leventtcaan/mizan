"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getToken, getBrief, type Brief } from "@/lib/api";
import { useLanguage } from "@/lib/i18n";
import { CATEGORY_LABELS, CATEGORY_COLORS, DEFAULT_CATEGORY_COLOR } from "@/lib/categories";
import { ArrowRight, Brain } from "@/components/ui/Icons";

function askMizan(prefill: string) {
  window.dispatchEvent(new CustomEvent("mizan-open-assistant", { detail: { prefill } }));
}

// "18 May–18 Haz" / "May 18–Jun 18" — noon avoids tz day-shift on ISO dates.
function fmtDateRange(startISO: string, endISO: string, lang: string): string {
  const loc = lang === "tr" ? "tr-TR" : "en-US";
  try {
    const f = new Intl.DateTimeFormat(loc, { day: "numeric", month: "short" });
    return `${f.format(new Date(startISO + "T12:00:00"))}–${f.format(new Date(endISO + "T12:00:00"))}`;
  } catch {
    return `${startISO}–${endISO}`;
  }
}

function BriefContent() {
  const router = useRouter();
  const params = useSearchParams();
  const { t, lang } = useLanguage();

  const jobId = params.get("job_id");
  const [brief, setBrief] = useState<Brief | null>(null);
  const [revealed, setRevealed] = useState(false);

  // Silent fallback: any failure (missing/expired job, network) → the dashboard.
  const fallback = useCallback(() => router.replace("/transactions"), [router]);

  useEffect(() => {
    if (!getToken()) { router.replace("/login"); return; }
    if (!jobId) { fallback(); return; }
    let active = true;
    getBrief(jobId, lang)
      .then((b) => {
        if (!active) return;
        setBrief(b);
        // Persist {job_id, period, ts} so Home can link back to this brief for ~7 days
        // and reconcile its calendar-month numbers with this statement period.
        try {
          localStorage.setItem("mizan_last_brief_job_id", JSON.stringify({
            job_id: b.job_id, start: b.period.start, end: b.period.end, ts: Date.now(),
          }));
        } catch { /* storage unavailable — non-blocking */ }
        setTimeout(() => setRevealed(true), 60);
      })
      .catch(() => { if (active) fallback(); });
    return () => { active = false; };
  }, [jobId, lang, router, fallback]);

  const money = useCallback((n: number, ccy: string) => {
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency: ccy, maximumFractionDigits: 0 }).format(n);
    } catch {
      return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(n)} ${ccy}`;
    }
  }, []);

  if (!brief) {
    return (
      <div className="min-h-screen bg-[#0F0F0F] text-white flex flex-col items-center justify-center px-4">
        <div className="flex items-center gap-3 text-gray-400">
          <span className="w-5 h-5 border-2 border-gray-600 border-t-indigo-400 rounded-full animate-spin" />
          <span className="text-sm">{t("brief.loading")}</span>
        </div>
      </div>
    );
  }

  const { period, flow, top_categories, largest_transaction, recurring_signal, suggested_action, narrative } = brief;
  const ccy = flow.currency;
  const positive = flow.net >= 0;
  const periodRange = fmtDateRange(period.start, period.end, lang);

  // Each beat fades/slides in 100ms after the previous one.
  const beatCls = `transition-all duration-500 ease-out ${revealed ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3"}`;
  const beatStyle = (i: number) => ({ transitionDelay: `${i * 100}ms` });

  const AskLink = ({ prefill }: { prefill: string }) => (
    <button
      onClick={() => askMizan(prefill)}
      className="mt-3 inline-flex items-center gap-1 text-indigo-400/80 hover:text-indigo-300 text-xs transition-colors"
    >
      <Brain size={12} /> {t("brief.askMizan")}
    </button>
  );

  return (
    <div className="min-h-screen bg-[#0F0F0F] text-white px-4 py-12">
      <div className="w-full max-w-lg mx-auto">
        {/* Eyebrow + period */}
        <div className={beatCls} style={beatStyle(0)}>
          <p className="text-center text-gray-600 text-xs font-medium tracking-widest uppercase mb-2">{t("brief.eyebrow")}</p>
          <p className="text-center text-gray-500 text-sm mb-8">
            {period.transaction_count} {t("brief.transactions")} · {period.start} – {period.end}
          </p>
        </div>

        {/* Narrative hero */}
        {narrative && (
          <div className={`mb-8 ${beatCls}`} style={beatStyle(1)}>
            <p className="text-lg leading-relaxed text-gray-100">{narrative}</p>
          </div>
        )}

        <div className="space-y-4">
          {/* BEAT — flow */}
          <div className={`bg-[#1A1A1A] border border-[#2A2A2A] rounded-2xl p-6 ${beatCls}`} style={beatStyle(2)}>
            <p className="text-gray-500 text-xs font-medium uppercase tracking-wide mb-3">{t("brief.b2Title")}</p>
            <p className={`text-4xl font-bold tabular-nums ${positive ? "text-emerald-400" : "text-red-400"}`}>
              {positive ? "+" : "−"}{money(Math.abs(flow.net), ccy)}
            </p>
            <p className="text-gray-300 text-sm mt-2">
              {positive ? t("brief.aheadPre") : t("brief.behindPre")}{" "}
              <span className="font-semibold text-white">{money(Math.abs(flow.net), ccy)}</span>{" "}
              {positive ? t("brief.aheadPost") : t("brief.behindPost")}
            </p>
            <div className="flex gap-6 mt-4 pt-4 border-t border-[#2A2A2A] text-sm">
              <div>
                <p className="text-gray-500 text-xs">{t("brief.income")}</p>
                <p className="text-emerald-400 font-semibold tabular-nums">{money(flow.income, ccy)}</p>
              </div>
              <div>
                <p className="text-gray-500 text-xs">{t("brief.expenses")}</p>
                <p className="text-red-400 font-semibold tabular-nums">{money(flow.expenses, ccy)}</p>
              </div>
            </div>
            <AskLink prefill={t("brief.askFlow")} />
          </div>

          {/* BEAT — where it went */}
          {top_categories.length > 0 && (
            <div className={`bg-[#1A1A1A] border border-[#2A2A2A] rounded-2xl p-6 ${beatCls}`} style={beatStyle(3)}>
              <p className="text-gray-500 text-xs font-medium uppercase tracking-wide mb-4">{t("brief.b3Title")}</p>
              <div className="space-y-3">
                {top_categories.map((c) => {
                  const color = CATEGORY_COLORS[c.name] || DEFAULT_CATEGORY_COLOR;
                  const label = CATEGORY_LABELS[c.name] || c.name;
                  return (
                    <div key={c.name}>
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className="flex items-center gap-2 text-gray-200">
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                          {label}
                        </span>
                        <span className="tabular-nums text-gray-300">
                          {money(c.amount, ccy)} <span className="text-gray-600 text-xs">· {c.share.toFixed(0)}%</span>
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-[#2A2A2A] overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${Math.min(c.share, 100)}%`, backgroundColor: color }} />
                      </div>
                    </div>
                  );
                })}
              </div>
              {largest_transaction && (
                <p className="text-gray-500 text-xs mt-4 pt-4 border-t border-[#2A2A2A]">
                  {t("brief.largest")}: <span className="text-gray-300">{largest_transaction.description}</span>{" "}
                  <span className="text-red-400 font-medium tabular-nums">{money(largest_transaction.amount, ccy)}</span>
                </p>
              )}
              <AskLink prefill={t("brief.askCategories")} />
            </div>
          )}

          {/* BEAT — recurring commitments */}
          <div className={`bg-[#1A1A1A] border border-[#2A2A2A] rounded-2xl p-6 ${beatCls}`} style={beatStyle(4)}>
            <p className="text-gray-500 text-xs font-medium uppercase tracking-wide mb-3">{t("brief.b4Title")}</p>
            {recurring_signal.monthly_total > 0 ? (
              <>
                <p className="text-2xl font-bold tabular-nums text-white">
                  {money(recurring_signal.monthly_total, ccy)}
                  <span className="text-gray-500 text-sm font-normal"> {t("brief.perMonthCommit")}</span>
                </p>
                {recurring_signal.highlight && (
                  <p className="text-gray-400 text-sm mt-2">{recurring_signal.highlight}</p>
                )}
              </>
            ) : (
              <p className="text-gray-400 text-sm">{t("brief.noRecurring")}</p>
            )}
            <AskLink prefill={t("brief.askRecurring")} />
          </div>

          {/* BEAT — the one move */}
          <div className={`bg-indigo-950/30 border border-indigo-800/40 rounded-2xl p-6 ${beatCls}`} style={beatStyle(5)}>
            <p className="text-indigo-300/70 text-xs font-medium uppercase tracking-wide mb-3">{t("brief.b5Title")}</p>
            <button
              onClick={() => router.push(suggested_action.href)}
              className="w-full py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 font-semibold transition-colors flex items-center justify-center gap-2"
            >
              {suggested_action.label} <ArrowRight size={18} />
            </button>
            <button
              onClick={() => router.push("/transactions")}
              className="w-full mt-3 text-center text-gray-500 hover:text-gray-300 text-sm transition-colors"
            >
              {periodRange} {t("brief.viewAllPeriod")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function BriefPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#0F0F0F]" />}>
      <BriefContent />
    </Suspense>
  );
}
