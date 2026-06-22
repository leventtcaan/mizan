"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Brain, MessageCircle, Send, X as XIcon, CheckCircle } from "@/components/ui/Icons";
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setAuthed(!!getToken() && !!getStoredUser());
  }, [pathname]);

  useEffect(() => {
    const openHandler = () => setOpen(true);
    window.addEventListener("mizan-open-assistant", openHandler);
    return () => window.removeEventListener("mizan-open-assistant", openHandler);
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
      {/* Floating button */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-50 w-14 h-14 rounded-full bg-indigo-600 hover:bg-indigo-500 shadow-lg shadow-indigo-900/40 flex items-center justify-center text-white transition-colors"
          title={t("assistant.askMizan")}
        >
          <MessageCircle size={22} />
        </button>
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
                <Brain size={16} className="text-indigo-400" />
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
