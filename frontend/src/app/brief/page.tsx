"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  getToken, getBrief, getNetWorthSuggestions, acceptSuggestion, dismissSuggestion,
  type Brief, type SuggestionItem,
} from "@/lib/api";
import { useLanguage } from "@/lib/i18n";
import { CATEGORY_LABELS, CATEGORY_COLORS, DEFAULT_CATEGORY_COLOR } from "@/lib/categories";
import { ArrowRight, Scale, TrendingDown, TrendingUp, CheckCircle, PieChart, RefreshCw, Sparkles } from "@/components/ui/Icons";
import AskMim from "@/components/companion/AskMim";
import Mim from "@/components/companion/Mim";

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
  // Cash-flow ↔ net-worth bridge: a pending suggestion to add/update net worth from
  // this statement's detected balance. Resolved inline (accept / skip).
  const [bridge, setBridge] = useState<SuggestionItem | null>(null);
  const [bridgeDone, setBridgeDone] = useState<"" | "added" | "skipped">("");
  const [bridgeBusy, setBridgeBusy] = useState(false);

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
    // Pull the bridge suggestion for THIS batch (created deterministically at upload).
    getNetWorthSuggestions()
      .then((all) => {
        if (!active) return;
        const m = all.find((s) => s.source_batch_id === jobId && s.status === "pending");
        if (m) setBridge(m);
      })
      .catch(() => { /* non-blocking — the brief still shows */ });
    return () => { active = false; };
  }, [jobId, lang, router, fallback]);

  const acceptBridge = useCallback(async () => {
    if (!bridge || bridgeBusy) return;
    setBridgeBusy(true);
    try {
      await acceptSuggestion(bridge.id);
      setBridgeDone("added");
      // Net worth changed — let any open net-worth/home view refresh.
      window.dispatchEvent(new CustomEvent("mizan-data-changed"));
    } catch { /* leave the card so the user can retry */ }
    finally { setBridgeBusy(false); }
  }, [bridge, bridgeBusy]);

  const skipBridge = useCallback(async () => {
    if (!bridge || bridgeBusy) return;
    setBridgeBusy(true);
    try { await dismissSuggestion(bridge.id); setBridgeDone("skipped"); }
    catch { /* ignore */ }
    finally { setBridgeBusy(false); }
  }, [bridge, bridgeBusy]);

  const money = useCallback((n: number, ccy: string) => {
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency: ccy, maximumFractionDigits: 0 }).format(n);
    } catch {
      return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(n)} ${ccy}`;
    }
  }, []);

  if (!brief) {
    return (
      <div className="min-h-screen bg-canvas text-ink flex flex-col items-center justify-center px-4">
        <div className="flex items-center gap-3 text-ink-mute">
          <span className="w-5 h-5 border-2 border-line border-t-[#176B5B] rounded-full animate-spin" />
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

  // Scope every "ask Mizan" on the brief to THIS statement's batch, so Mim answers with
  // this period's numbers — not a mix of every uploaded statement.
  const AskLink = ({ prefill }: { prefill: string }) => (
    <AskMim
      prefill={prefill} label={t("brief.askMizan")} className="mt-3"
      jobId={brief.job_id} scopeLabel={periodRange}
    />
  );

  // Every number says where it comes from. Flow/categories are this one statement;
  // recurring is computed across all the user's activity, so it's labelled differently.
  const Source = ({ text }: { text: string }) => (
    <p className="text-[11px] text-ink-mute mt-3 pt-3 border-t border-line/60">{text}</p>
  );
  const statementSource = `${t("brief.fromStatement")} · ${periodRange}`;
  const incExp = flow.income + flow.expenses;
  const incomeShare = incExp > 0 ? (flow.income / incExp) * 100 : 50;

  // Consistent tinted icon-chip header for each "beat" card.
  const BeatHead = ({ icon, tint, title }: { icon: React.ReactNode; tint: string; title: string }) => (
    <div className="flex items-center gap-2.5 mb-4">
      <span className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${tint}`}>{icon}</span>
      <p className="text-ink-soft text-sm font-semibold">{title}</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-canvas text-ink px-4 py-12 sm:py-16">
      <div className="w-full max-w-lg mx-auto">
        {/* HERO — Mim reads you your statement, with a soft glow + the narrative as the centerpiece */}
        <div className={`text-center mb-9 ${beatCls}`} style={beatStyle(0)}>
          <div className="relative inline-flex mb-6">
            <div
              className="absolute inset-0 -z-10 blur-2xl rounded-full"
              style={{ background: "radial-gradient(circle, rgba(23,107,91,0.20), transparent 70%)", transform: "scale(1.7)" }}
            />
            <Mim size={76} mood={positive ? "happy" : "calm"} speaking />
          </div>
          <div>
            <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-surface border border-line text-ink-mute text-[11px] font-medium tracking-wide">
              <span className="w-1.5 h-1.5 rounded-full bg-[#176B5B]" />
              {t("brief.eyebrow")} · {periodRange}
            </span>
          </div>
          {narrative && (
            <p className="text-xl sm:text-2xl leading-snug text-ink font-semibold mt-5 max-w-md mx-auto">{narrative}</p>
          )}
          <p className="text-ink-mute text-xs mt-4">{period.transaction_count} {t("brief.transactions")}</p>
        </div>

        <div className="space-y-4">
          {/* BEAT — flow (the headline number) */}
          <div className={`relative overflow-hidden bg-surface border border-line rounded-2xl p-6 shadow-sm ${beatCls}`} style={beatStyle(2)}>
            <div
              className="pointer-events-none absolute inset-x-0 top-0 h-28"
              style={{ background: `radial-gradient(120% 100% at 50% 0%, ${positive ? "rgba(31,122,92,0.09)" : "rgba(181,71,71,0.09)"}, transparent 72%)` }}
            />
            <div className="relative">
              <BeatHead
                title={t("brief.b2Title")}
                tint={positive ? "bg-pos/10" : "bg-neg/10"}
                icon={positive ? <TrendingUp size={16} className="text-pos" /> : <TrendingDown size={16} className="text-neg" />}
              />
              <p className={`text-5xl font-bold tabular-nums leading-none ${positive ? "text-pos" : "text-neg"}`}>
                {positive ? "+" : "−"}{money(Math.abs(flow.net), ccy)}
              </p>
              <p className="text-ink-soft text-sm mt-3 leading-relaxed">
                {positive ? t("brief.aheadPre") : t("brief.behindPre")}{" "}
                <span className="font-semibold text-ink">{money(Math.abs(flow.net), ccy)}</span>{" "}
                {positive ? t("brief.aheadPost") : t("brief.behindPost")}
              </p>
              <div className="grid grid-cols-2 gap-3 mt-5">
                <div className="rounded-xl bg-pos/10 px-4 py-3">
                  <p className="text-ink-mute text-[11px] mb-0.5">{t("brief.income")}</p>
                  <p className="text-pos text-lg font-bold tabular-nums">{money(flow.income, ccy)}</p>
                </div>
                <div className="rounded-xl bg-neg/10 px-4 py-3">
                  <p className="text-ink-mute text-[11px] mb-0.5">{t("brief.expenses")}</p>
                  <p className="text-neg text-lg font-bold tabular-nums">{money(flow.expenses, ccy)}</p>
                </div>
              </div>
              {incExp > 0 && (
                <div className="mt-3 flex h-1.5 rounded-full overflow-hidden bg-surface-2">
                  <div style={{ width: `${incomeShare}%`, backgroundColor: "#1F7A5C" }} />
                  <div style={{ width: `${100 - incomeShare}%`, backgroundColor: "#B54747" }} />
                </div>
              )}
              <Source text={statementSource} />
              <AskLink prefill={t("brief.askFlow")} />
            </div>
          </div>

          {/* BEAT — where it went */}
          {top_categories.length > 0 && (
            <div className={`bg-surface border border-line rounded-2xl p-6 shadow-sm ${beatCls}`} style={beatStyle(3)}>
              <BeatHead title={t("brief.b3Title")} tint="bg-[#176B5B]/10" icon={<PieChart size={16} className="text-[#176B5B]" />} />
              <div className="space-y-3.5">
                {top_categories.map((c, i) => {
                  const color = CATEGORY_COLORS[c.name] || DEFAULT_CATEGORY_COLOR;
                  const label = CATEGORY_LABELS[c.name] || c.name;
                  return (
                    <div key={c.name} className="flex items-center gap-3">
                      <span className="w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-bold tabular-nums shrink-0" style={{ backgroundColor: `${color}22`, color }}>{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between text-sm mb-1 gap-2">
                          <span className="text-ink-soft truncate">{label}</span>
                          <span className="tabular-nums text-ink-soft shrink-0">
                            {money(c.amount, ccy)} <span className="text-ink-mute text-xs">· {c.share.toFixed(0)}%</span>
                          </span>
                        </div>
                        <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${Math.min(c.share, 100)}%`, backgroundColor: color }} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              {largest_transaction && (
                <p className="text-ink-mute text-xs mt-4 pt-4 border-t border-line">
                  {t("brief.largest")}: <span className="text-ink-soft">{largest_transaction.description}</span>{" "}
                  <span className="text-neg font-medium tabular-nums">{money(largest_transaction.amount, ccy)}</span>
                </p>
              )}
              <Source text={statementSource} />
              <AskLink prefill={t("brief.askCategories")} />
            </div>
          )}

          {/* BEAT — recurring commitments */}
          <div className={`bg-surface border border-line rounded-2xl p-6 shadow-sm ${beatCls}`} style={beatStyle(4)}>
            <BeatHead title={t("brief.b4Title")} tint="bg-warn/10" icon={<RefreshCw size={16} className="text-warn" />} />
            {recurring_signal.monthly_total > 0 ? (
              <>
                <p className="text-2xl font-bold tabular-nums text-ink">
                  {money(recurring_signal.monthly_total, ccy)}
                  <span className="text-ink-mute text-sm font-normal"> {t("brief.perMonthCommit")}</span>
                </p>
                {recurring_signal.highlight && (
                  <p className="text-ink-mute text-sm mt-2">{recurring_signal.highlight}</p>
                )}
              </>
            ) : (
              <p className="text-ink-mute text-sm">{t("brief.noRecurring")}</p>
            )}
            <Source text={t("brief.fromAllActivity")} />
            <AskLink prefill={t("brief.askRecurring")} />
          </div>

          {/* BEAT — cash-flow ↔ net-worth bridge (only when a balance was detected) */}
          {bridge && bridgeDone !== "skipped" && (() => {
            const bt = bridge.suggestion_type;
            const isLiab = bt === "statement_liability";
            const isUpdate = bt === "asset_balance_update";
            const desc = isUpdate ? t("bridge.descUpdate") : isLiab ? t("bridge.descLiability") : t("bridge.descAsset");
            const acceptLabel = isUpdate ? t("bridge.updateBalance") : isLiab ? t("bridge.addLiability") : t("bridge.addAsset");
            const successLabel = isUpdate ? t("bridge.updated") : isLiab ? t("bridge.addedLiability") : t("bridge.addedAsset");
            const amt = parseFloat(bridge.suggested_change) || 0;
            return (
              <div className={`bg-surface border border-line rounded-2xl p-6 shadow-sm ${beatCls}`} style={beatStyle(5)}>
                <BeatHead
                  title={t("bridge.title")}
                  tint={isLiab ? "bg-neg/10" : "bg-[#176B5B]/10"}
                  icon={isLiab ? <TrendingDown size={16} className="text-neg" /> : <Scale size={16} className="text-[#176B5B]" />}
                />
                {bridgeDone === "added" ? (
                  <p className="text-pos text-sm font-medium flex items-center gap-1.5"><CheckCircle size={16} /> {successLabel}</p>
                ) : (
                  <>
                    <p className="text-ink-soft text-sm mb-3">{desc}</p>
                    <p className="text-3xl font-bold tabular-nums text-ink">{money(amt, bridge.currency)}</p>
                    <p className="text-ink-mute text-xs mt-1 mb-4">{bridge.reason}</p>
                    <div className="flex gap-3">
                      <button onClick={acceptBridge} disabled={bridgeBusy}
                        className="flex-1 py-3 rounded-xl bg-[#176B5B] hover:bg-[#125848] text-white text-sm font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                        {bridgeBusy ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : acceptLabel}
                      </button>
                      <button onClick={skipBridge} disabled={bridgeBusy}
                        className="px-5 py-3 rounded-xl border border-line text-ink-soft text-sm font-medium hover:bg-surface-2 transition-colors disabled:opacity-50">
                        {t("bridge.skip")}
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })()}

          {/* BEAT — the one move */}
          <div className={`relative overflow-hidden bg-[#176B5B]/[0.06] border border-[#176B5B]/30 rounded-2xl p-6 shadow-sm ${beatCls}`} style={beatStyle(6)}>
            <BeatHead title={t("brief.b5Title")} tint="bg-[#176B5B]/15" icon={<Sparkles size={16} className="text-[#176B5B]" />} />
            <button
              onClick={() => router.push(suggested_action.href)}
              className="w-full py-3.5 rounded-xl bg-[#176B5B] hover:bg-[#125848] text-white font-semibold transition-colors flex items-center justify-center gap-2"
            >
              {suggested_action.label} <ArrowRight size={18} />
            </button>
            <button
              onClick={() => router.push("/transactions")}
              className="w-full mt-3 text-center text-ink-mute hover:text-ink-soft text-sm transition-colors"
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
    <Suspense fallback={<div className="min-h-screen bg-canvas" />}>
      <BriefContent />
    </Suspense>
  );
}
