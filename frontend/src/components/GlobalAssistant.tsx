"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Send, X as XIcon, CheckCircle } from "@/components/ui/Icons";
import Mim from "@/components/companion/Mim";
import { observe, checkEscalation, contextFromPath, type Observation } from "@/components/companion/voice";
import { useLanguage } from "@/lib/i18n";
import {
  getToken, getStoredUser, getNetWorthSummary,
  assistantChat, confirmAssistantAction, rejectAssistantAction,
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
      setOpen(true);
      const prefill = (e as CustomEvent<{ prefill?: string }>).detail?.prefill;
      if (prefill) {
        setInput(prefill);
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
      getNetWorthSummary("TRY")
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
      const res = await assistantChat(text, detectContext(pathname), history);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: res.reply, proposal: res.proposal, actionState: "idle" },
      ]);
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", text: t("assistant.error") }]);
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
            <div className="mim-bubble flex items-start gap-2 max-w-[270px] rounded-2xl rounded-br-md bg-[#1B1B1B] border border-[#2E2E2E] shadow-xl shadow-black/40 pl-3.5 pr-2 py-2.5">
              <button
                onClick={() => { setInput(bubble.prefill); setBubble(null); setOpen(true); }}
                className="text-left text-[13px] leading-snug text-gray-200 hover:text-white transition-colors"
              >
                {bubble.line}
              </button>
              <button
                onClick={() => setBubble(null)}
                aria-label={t("assistant.close")}
                className="shrink-0 text-gray-600 hover:text-gray-400 transition-colors -mt-0.5"
              >
                <XIcon size={14} />
              </button>
            </div>
          )}
          <button
            onClick={() => setOpen(true)}
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
        <div className="fixed inset-0 z-50 flex items-end sm:items-end sm:justify-end bg-black/40 sm:bg-transparent" onClick={() => setOpen(false)}>
          <div
            className="w-full sm:w-[400px] sm:m-5 bg-[#161616] border border-[#2A2A2A] rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[80vh] sm:max-h-[600px]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#2A2A2A]">
              <div className="flex items-center gap-2">
                <Mim mood={pending ? "thinking" : "calm"} size={26} speaking={pending} />
                <span className="text-white text-sm font-semibold">{t("assistant.title")}</span>
              </div>
              <button onClick={() => setOpen(false)} title={t("assistant.close")} className="text-gray-500 hover:text-gray-300 transition-colors">
                <XIcon size={18} />
              </button>
            </div>

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
              {messages.length === 0 && (
                <div className="flex flex-col items-center text-center py-6 gap-3">
                  <Mim mood="calm" size={48} speaking />
                  <p className="text-gray-400 text-sm max-w-[260px] leading-relaxed">{hasData === false ? t("assistant.emptyGreeting") : t("assistant.greeting")}</p>
                </div>
              )}
              {messages.map((m, i) => (
                <div key={i} className="space-y-2">
                  <div className={`flex items-end gap-2 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                    {m.role === "assistant" && <Mim mood="calm" size={22} quiet className="shrink-0 mb-0.5" />}
                    <div className={`max-w-[80%] px-3 py-2 rounded-xl text-sm leading-relaxed ${m.role === "user" ? "bg-indigo-600 text-white" : "bg-[#222] text-gray-200 rounded-bl-sm"}`}>
                      {m.text}
                    </div>
                  </div>

                  {/* Proposal card */}
                  {m.proposal && m.actionState !== "rejected" && (
                    <div className="bg-[#0F0F0F] border border-indigo-800/40 rounded-xl p-3">
                      <p className="text-gray-400 text-xs mb-1">{t("assistant.proposalIntro")}</p>
                      <p className="text-white text-sm mb-3">{m.proposal.description}</p>
                      {m.actionState === "done" ? (
                        <div className="flex items-center gap-2 text-emerald-400 text-sm">
                          <CheckCircle size={15} /> {m.resultMsg}
                        </div>
                      ) : m.actionState === "failed" ? (
                        <p className="text-red-400 text-sm">{t("assistant.failed")}</p>
                      ) : (
                        <div className="flex gap-2">
                          <button
                            onClick={() => confirm(i, m.proposal!)}
                            disabled={m.actionState === "working"}
                            className="flex-1 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-medium transition-colors"
                          >
                            {m.actionState === "working" ? t("assistant.working") : t("assistant.confirm")}
                          </button>
                          <button
                            onClick={() => reject(i, m.proposal!)}
                            disabled={m.actionState === "working"}
                            className="flex-1 px-3 py-1.5 rounded-lg border border-[#2A2A2A] text-gray-400 hover:text-gray-200 disabled:opacity-50 text-xs font-medium transition-colors"
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
                  <div className="bg-[#222] px-3 py-2 rounded-xl rounded-bl-sm">
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
            <div className="flex gap-2 px-4 py-3 border-t border-[#2A2A2A]">
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
                placeholder={t("assistant.placeholder")}
                disabled={pending}
                className="flex-1 bg-[#0F0F0F] border border-[#2A2A2A] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-600"
              />
              <button
                onClick={() => void send()}
                disabled={pending || !input.trim()}
                className="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white transition-colors"
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
