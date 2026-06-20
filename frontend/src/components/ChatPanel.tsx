"use client";

import { useEffect, useRef, useState } from "react";
import { getChatHistory, sendChatMessage } from "@/lib/api";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}

interface Props {
  initialInsight: string | null;
}

export default function ChatPanel({ initialInsight }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    getChatHistory()
      .then((history) => {
        if (history.length === 0 && initialInsight) {
          // No prior conversation — seed the panel with the coaching insight
          // so users have something to react to immediately.
          setMessages([{
            id: "__initial__",
            role: "assistant",
            content: initialInsight,
          }]);
        } else {
          setMessages(
            history.map((m) => ({ id: m.id, role: m.role, content: m.content }))
          );
        }
      })
      .catch(() => {
        if (initialInsight) {
          setMessages([{ id: "__initial__", role: "assistant", content: initialInsight }]);
        }
      })
      .finally(() => setHistoryLoaded(true));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once on mount — initialInsight is stable by the time parent renders ChatPanel

  // Scroll to bottom whenever messages or the typing indicator changes
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;

    setInput("");
    // Optimistic: append user message immediately
    const userMsg: Message = { id: `u-${Date.now()}`, role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setSending(true);

    try {
      const result = await sendChatMessage(text);
      setMessages((prev) => [
        ...prev,
        { id: `a-${Date.now()}`, role: "assistant", content: result.response },
      ]);
      if (result.profile_updated) {
        setToast("Profilin güncellendi");
        setTimeout(() => setToast(null), 3500);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { id: `e-${Date.now()}`, role: "assistant", content: "Bir hata oluştu. Tekrar deneyin." },
      ]);
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  // Auto-resize textarea as user types
  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 96) + "px";
  };

  return (
    <div className="rounded-xl bg-gray-900 border border-gray-800 flex flex-col mb-8" style={{ height: 420 }}>
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between shrink-0">
        <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold">Koç</p>
        {toast && (
          <span className="text-xs text-emerald-400 font-medium animate-pulse">{toast}</span>
        )}
      </div>

      {/* Message thread */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
        {!historyLoaded && (
          <p className="text-gray-600 text-sm text-center py-6 animate-pulse">Yükleniyor...</p>
        )}
        {historyLoaded && messages.length === 0 && (
          <p className="text-gray-600 text-sm text-center py-6">Koçunuza bir şey sorun.</p>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[82%] px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
                msg.role === "user"
                  ? "bg-indigo-600 text-white rounded-br-sm"
                  : "bg-gray-800 text-gray-200 rounded-bl-sm"
              }`}
            >
              {msg.content}
            </div>
          </div>
        ))}

        {/* Typing indicator */}
        {sending && (
          <div className="flex justify-start">
            <div className="bg-gray-800 px-4 py-3 rounded-2xl rounded-bl-sm">
              <span className="flex gap-1 items-center h-4">
                <span className="w-1.5 h-1.5 rounded-full bg-gray-500 animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-1.5 h-1.5 rounded-full bg-gray-500 animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="w-1.5 h-1.5 rounded-full bg-gray-500 animate-bounce" style={{ animationDelay: "300ms" }} />
              </span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-4 py-3 border-t border-gray-800 flex gap-2 items-end shrink-0">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder="Bir şey sorun veya paylaşın... (Enter gönderir)"
          rows={1}
          className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-indigo-500 resize-none leading-relaxed"
          style={{ minHeight: 40, maxHeight: 96 }}
        />
        <button
          onClick={() => void handleSend()}
          disabled={sending || !input.trim()}
          className="px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-sm font-medium text-white transition-colors shrink-0"
        >
          ↑
        </button>
      </div>
    </div>
  );
}
