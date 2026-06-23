"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Send, X as XIcon, CheckCircle } from "@/components/ui/Icons";
import Mim from "@/components/companion/Mim";
import { observe, contextFromPath, type Observation } from "@/components/companion/voice";
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

  // Mim notices one specific thing about the page you just landed on — then waits.
  // Speaks once per page visit, after a gentle beat, and fades on its own.
  useEffect(() => {
    if (!authed || open) { setBubble(null); return; }
    const ctx = contextFromPath(pathname);
    if (!ctx) { spokenPathRef.current = pathname; setBubble(null); return; }
    if (spokenPathRef.current === pathname) return; // already spoke here
    spokenPathRef.current = pathname;
    let cancelled = false;
    const intro = setTimeout(async () => {
      const obs = await observe(ctx, t);
      if (cancelled || !obs) return;
      setBubble(obs);
      if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current);
      bubbleTimerRef.current = setTimeout(() => setBubble(null), 9000);
    }, 700);
    return () => { cancelled = true; clearTimeout(intro); };
  }, [pathname, authed, open, t]);

  useEffect(() => () => { if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current); }, []);

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
      {/* Mim — the companion, present on every page. Notices things, then waits. Tap to talk. */}
      {!open && (
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
                <p className="text-gray-500 text-sm text-center py-6">{hasData === false ? t("assistant.emptyGreeting") : t("assistant.greeting")}</p>
              )}
              {messages.map((m, i) => (
                <div key={i} className="space-y-2">
                  <div className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[85%] px-3 py-2 rounded-xl text-sm leading-relaxed ${m.role === "user" ? "bg-indigo-600 text-white" : "bg-[#2A2A2A] text-gray-200"}`}>
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
                <div className="flex justify-start">
                  <div className="bg-[#2A2A2A] px-3 py-2 rounded-xl">
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
