"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { Send, X as XIcon, CheckCircle, FileText, Sparkles, ArrowRight } from "@/components/ui/Icons";
import Mim from "@/components/companion/Mim";
import { observe, checkEscalation, contextFromPath, type Observation } from "@/components/companion/voice";
import { useLanguage } from "@/lib/i18n";
import {
  getToken, getStoredUser, getNetWorthSummary, getDefaultCurrency,
  assistantChat, confirmAssistantAction, rejectAssistantAction, AssistantCapError,
  type AssistantPageContext, type ActionProposal,
} from "@/lib/api";

const HIDDEN_PATHS = ["/login", "/onboarding"];

type ActionState = "idle" | "working" | "done" | "failed" | "rejected";

interface Msg {
  role: "user" | "assistant";
  text: string;
  proposal?: ActionProposal | null;
  actionState?: ActionState;
  resultMsg?: string;
  // Free-tier daily message cap reached → render the friendly upgrade card, not a bubble.
  cap?: boolean;
}

function detectContext(pathname: string): AssistantPageContext {
  if (pathname.startsWith("/networth")) return "networth";
  if (pathname.startsWith("/transactions")) return "transactions";
  if (pathname.startsWith("/cashflow")) return "cashflow";
  return "home";
}

export default function GlobalAssistant() {
  const pathname = usePathname();
  const { t } = useLanguage();
  const [authed, setAuthed] = useState(false);
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [hasData, setHasData] = useState<boolean | null>(null);
  const [bubble, setBubble] = useState<Observation | null>(null);
  // When opened from a specific brief, the conversation is bound to that upload batch
  // so answers use THAT statement's numbers, not the user's aggregate data.
  const [scope, setScope] = useState<{ jobId: string; label: string | null } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const spokenPathRef = useRef<string | null>(null);
  const bubbleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Session memory: keys Mim has already voiced (so it never repeats itself), and
  // a once-per-session flag for the cross-page urgent check (reset when data changes).
  const spokenKeysRef = useRef<Set<string>>(new Set());
  const escalationCheckedRef = useRef(false);

  useEffect(() => {
    setAuthed(!!getToken() && !!getStoredUser());
  }, [pathname]);

  useEffect(() => {
    const openHandler = (e: Event) => {
      const detail = (e as CustomEvent<{ prefill?: string; jobId?: string; scopeLabel?: string }>).detail;
      setOpen(true);
      // Bind to a statement when a jobId is supplied (asked from a brief). Start a fresh
      // thread for the scoped question so an earlier unscoped chat doesn't bleed in.
      if (detail?.jobId) {
        setScope({ jobId: detail.jobId, label: detail.scopeLabel ?? null });
        setMessages([]);
      } else {
        setScope(null);
      }
      if (detail?.prefill) {
        setInput(detail.prefill);
        setTimeout(() => inputRef.current?.focus(), 80);
      }
    };
    window.addEventListener("mizan-open-assistant", openHandler);
    return () => window.removeEventListener("mizan-open-assistant", openHandler);
  }, []);

  // Mim speaks one thing after you land on a page, then waits. It leads with anything
  // genuinely urgent (checked once per session, cross-page), otherwise says what THIS
  // page notices — and never repeats an observation it has already voiced this session.
  // Skipped on Home, which has its own inline Mim + "Needs you" list.
  useEffect(() => {
    if (!authed || open || pathname === "/home") { setBubble(null); return; }
    const ctx = contextFromPath(pathname);
    let cancelled = false;
    const intro = setTimeout(async () => {
      let obs: Observation | null = null;

      // 1) Urgent, regardless of page — only once per session until data changes.
      if (!escalationCheckedRef.current) {
        escalationCheckedRef.current = true;
        const esc = await checkEscalation(t);
        if (esc && !spokenKeysRef.current.has(esc.key)) obs = esc;
      }
      // 2) Otherwise what this page notices — deduped against memory.
      if (!obs && ctx && spokenPathRef.current !== pathname) {
        const o = await observe(ctx, t);
        if (o && !spokenKeysRef.current.has(o.key)) obs = o;
      }
      spokenPathRef.current = pathname;
      if (cancelled || !obs) return;
      spokenKeysRef.current.add(obs.key);
      setBubble(obs);
      if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current);
      bubbleTimerRef.current = setTimeout(() => setBubble(null), 9000);
    }, 700);
    return () => { cancelled = true; clearTimeout(intro); };
  }, [pathname, authed, open, t]);

  useEffect(() => () => { if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current); }, []);

  // When the user's data changes, let Mim re-check for newly-urgent things.
  useEffect(() => {
    const h = () => { escalationCheckedRef.current = false; };
    window.addEventListener("mizan-data-changed", h);
    return () => window.removeEventListener("mizan-data-changed", h);
  }, []);

  // On first open, detect whether the user has any data yet (for the greeting).
  useEffect(() => {
    if (open && hasData === null) {
      getNetWorthSummary(getDefaultCurrency())
        .then((s) => setHasData(s.total_assets_try > 0 || s.total_liabilities_try > 0 || s.pending_receivables_try > 0))
        .catch(() => setHasData(true)); // assume not-empty on error → neutral greeting
    }
  }, [open, hasData]);

  useEffect(() => {
    if (open) {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
      setTimeout(() => inputRef.current?.focus(), 60);
    }
  }, [open, messages, pending]);

  if (HIDDEN_PATHS.includes(pathname) || !authed) return null;

  const send = async () => {
    const text = input.trim();
    if (!text || pending) return;
    const history = messages.map((m) => ({ role: m.role, content: m.text }));
    setMessages((prev) => [...prev, { role: "user", text }]);
    setInput("");
    setPending(true);
    try {
      const res = await assistantChat(text, detectContext(pathname), history, scope?.jobId);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: res.reply, proposal: res.proposal, actionState: "idle" },
      ]);
    } catch (err) {
      if (err instanceof AssistantCapError) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", text: t("assistant.capMessage"), cap: true },
        ]);
      } else {
        setMessages((prev) => [...prev, { role: "assistant", text: t("assistant.error") }]);
      }
    } finally {
      setPending(false);
    }
  };

  const setMsgState = (idx: number, patch: Partial<Msg>) =>
    setMessages((prev) => prev.map((m, i) => (i === idx ? { ...m, ...patch } : m)));

  const confirm = async (idx: number, proposal: ActionProposal) => {
    setMsgState(idx, { actionState: "working" });
    try {
      const res = await confirmAssistantAction(proposal.action_id);
      setMsgState(idx, { actionState: "done", resultMsg: res.message || t("assistant.done") });
      window.dispatchEvent(new CustomEvent("mizan-data-changed"));
    } catch {
      setMsgState(idx, { actionState: "failed" });
    }
  };

  const reject = async (idx: number, proposal: ActionProposal) => {
    setMsgState(idx, { actionState: "rejected" });
    rejectAssistantAction(proposal.action_id).catch(() => null);
  };

  return (
    <>
      {/* Mim — the companion, present on every page. Notices things, then waits. Tap to talk.
          Hidden on Home, which already renders Mim inline as the greeting (avoids two Mims at once). */}
      {!open && pathname !== "/home" && (
        <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-2.5">
          {bubble && (
            // Hidden on small screens so the speech bubble never covers financial
            // content; the compact Mim FAB below stays (tap it to open the panel).
            <div className="mim-bubble hidden sm:flex items-start gap-2 max-w-[270px] rounded-2xl rounded-br-md bg-[#1D1A15] border border-[#302C25] shadow-xl shadow-black/40 pl-3.5 pr-2 py-2.5">
              <button
                onClick={() => { setScope(null); setInput(bubble.prefill); setBubble(null); setOpen(true); }}
                className="text-left text-[13px] leading-snug text-ink-soft hover:text-ink transition-colors"
              >
                {bubble.line}
              </button>
              <button
                onClick={() => setBubble(null)}
                aria-label={t("assistant.close")}
                className="shrink-0 text-ink-mute hover:text-ink-mute transition-colors -mt-0.5"
              >
                <XIcon size={14} />
              </button>
            </div>
          )}
          <button
            onClick={() => { setScope(null); setOpen(true); }}
            className="flex items-center justify-center transition-transform hover:scale-110"
            title={t("assistant.askMizan")}
            aria-label={t("assistant.askMizan")}
          >
            <Mim mood={bubble?.mood ?? "calm"} size={56} speaking />
          </button>
        </div>
      )}

      {/* Slide-up panel */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-end sm:justify-end bg-black/40 sm:bg-transparent" onClick={() => { setOpen(false); setScope(null); }}>
          <div
            className="w-full sm:w-[400px] sm:m-5 bg-surface border border-line rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[80vh] sm:max-h-[600px]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-line">
              <div className="flex items-center gap-2">
                <Mim mood={pending ? "thinking" : "calm"} size={26} speaking={pending} />
                <span className="text-ink text-sm font-semibold">{t("assistant.title")}</span>
              </div>
              <button onClick={() => { setOpen(false); setScope(null); }} title={t("assistant.close")} className="text-ink-mute hover:text-ink-soft transition-colors">
                <XIcon size={18} />
              </button>
            </div>

            {/* Scope banner — makes it explicit the conversation is bound to one statement */}
            {scope && (
              <div className="flex items-center gap-2 px-4 py-2 bg-brand/30 border-b border-brand/40 text-xs text-brand">
                <FileText size={13} className="shrink-0 text-brand" />
                <span className="truncate">
                  {t("assistant.scopedTo")}{scope.label ? ` ${scope.label}` : ""} {t("assistant.scopedStatement")}
                </span>
              </div>
            )}

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
              {messages.length === 0 && (
                <div className="flex flex-col items-center text-center py-6 gap-3">
                  <Mim mood="calm" size={48} speaking />
                  <p className="text-ink-mute text-sm max-w-[260px] leading-relaxed">
                    {/* Opened about a specific statement → address THAT, not the generic
                        "tell me your bank balance" cold-start opener. */}
                    {scope ? t("assistant.scopedGreeting")
                      : hasData === false ? t("assistant.emptyGreeting")
                      : t("assistant.greeting")}
                  </p>
                </div>
              )}
              {messages.map((m, i) => (
                <div key={i} className="space-y-2">
                  {m.cap ? (
                    /* Free-tier daily message cap → friendly upgrade card */
                    <div className="flex items-start gap-2 justify-start">
                      <Mim mood="calm" size={22} quiet className="shrink-0 mb-0.5" />
                      <div className="max-w-[85%] rounded-xl rounded-bl-sm border border-brand/40 bg-brand/10 p-3">
                        <p className="text-ink-soft text-sm leading-relaxed mb-3">{m.text}</p>
                        <Link
                          href="/settings"
                          onClick={() => setOpen(false)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand hover:bg-brand-hover text-white text-xs font-semibold transition-colors"
                        >
                          <Sparkles size={13} /> {t("assistant.capUpgrade")} <ArrowRight size={13} />
                        </Link>
                      </div>
                    </div>
                  ) : (
                  <div className={`flex items-end gap-2 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                    {m.role === "assistant" && <Mim mood="calm" size={22} quiet className="shrink-0 mb-0.5" />}
                    <div className={`max-w-[80%] px-3 py-2 rounded-xl text-sm leading-relaxed ${m.role === "user" ? "bg-brand text-white" : "bg-[#242019] text-ink-soft rounded-bl-sm"}`}>
                      {m.text}
                    </div>
                  </div>
                  )}

                  {/* Proposal card */}
                  {m.proposal && m.actionState !== "rejected" && (
                    <div className="bg-canvas border border-brand/40 rounded-xl p-3">
                      <p className="text-ink-mute text-xs mb-1">{t("assistant.proposalIntro")}</p>
                      <p className="text-ink text-sm mb-3">{m.proposal.description}</p>
                      {m.actionState === "done" ? (
                        <div className="flex items-center gap-2 text-emerald-400 text-sm">
                          <CheckCircle size={15} /> {m.resultMsg}
                        </div>
                      ) : m.actionState === "failed" ? (
                        <p className="text-neg text-sm">{t("assistant.failed")}</p>
                      ) : (
                        <div className="flex gap-2">
                          <button
                            onClick={() => confirm(i, m.proposal!)}
                            disabled={m.actionState === "working"}
                            className="flex-1 px-3 py-1.5 rounded-lg bg-brand hover:bg-brand-hover disabled:opacity-50 text-white text-xs font-medium transition-colors"
                          >
                            {m.actionState === "working" ? t("assistant.working") : t("assistant.confirm")}
                          </button>
                          <button
                            onClick={() => reject(i, m.proposal!)}
                            disabled={m.actionState === "working"}
                            className="flex-1 px-3 py-1.5 rounded-lg border border-line text-ink-mute hover:text-ink-soft disabled:opacity-50 text-xs font-medium transition-colors"
                          >
                            {t("assistant.reject")}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
              {pending && (
                <div className="flex items-end gap-2 justify-start">
                  <Mim mood="thinking" size={22} quiet className="shrink-0 mb-0.5" />
                  <div className="bg-[#242019] px-3 py-2 rounded-xl rounded-bl-sm">
                    <div className="flex gap-1 items-center h-4">
                      {[0, 1, 2].map((i) => (
                        <span key={i} className="w-1.5 h-1.5 rounded-full bg-gray-500 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Input */}
            <div className="flex gap-2 px-4 py-3 border-t border-line">
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
                placeholder={t("assistant.placeholder")}
                disabled={pending}
                className="flex-1 bg-canvas border border-line rounded-lg px-3 py-2 text-sm text-ink placeholder-gray-600 focus:outline-none focus:border-brand"
              />
              <button
                onClick={() => void send()}
                disabled={pending || !input.trim()}
                className="px-3 py-2 rounded-lg bg-brand hover:bg-brand-hover disabled:opacity-40 text-white transition-colors"
                title={t("assistant.send")}
              >
                <Send size={16} />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
