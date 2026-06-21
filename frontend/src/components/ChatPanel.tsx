"use client";

import { useEffect, useRef, useState } from "react";
import {
  getChatHistory, sendChatMessage, createTransaction,
  type PendingTransaction,
} from "@/lib/api";
import { CATEGORY_LABELS } from "@/lib/categories";
import AddTransactionModal from "@/components/AddTransactionModal";

// Minimal Web Speech API types — not in TS stdlib by default
interface SpeechRecognitionEvent extends Event {
  results: { [index: number]: { [index: number]: { transcript: string } }; length: number };
}
interface SpeechRecognitionInstance extends EventTarget {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onerror: ((e: Event) => void) | null;
  onend: (() => void) | null;
}
declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
  }
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  sentAt?: string; // ISO string
}

interface Props {
  initialInsight: string | null;
}

function formatAmount(amount: string): string {
  const n = parseFloat(amount);
  return new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

export default function ChatPanel({ initialInsight }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Transaction confirmation card
  const [pendingTx, setPendingTx] = useState<PendingTransaction | null>(null);
  const [txConfirming, setTxConfirming] = useState(false);
  const [txError, setTxError] = useState<string | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);

  // Voice input
  const [voiceSupported] = useState(() =>
    typeof window !== "undefined" && !!(window.SpeechRecognition ?? window.webkitSpeechRecognition)
  );
  const [recording, setRecording] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const voiceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isInitialLoad = useRef(true);

  useEffect(() => {
    getChatHistory()
      .then((history) => {
        if (history.length === 0 && initialInsight) {
          setMessages([{ id: "__initial__", role: "assistant", content: initialInsight, sentAt: new Date().toISOString() }]);
        } else {
          setMessages(history.map((m) => ({ id: m.id, role: m.role, content: m.content, sentAt: m.created_at })));
        }
      })
      .catch(() => {
        if (initialInsight) {
          setMessages([{ id: "__initial__", role: "assistant", content: initialInsight, sentAt: new Date().toISOString() }]);
        }
      })
      .finally(() => {
        setHistoryLoaded(true);
        isInitialLoad.current = false;
        // Pre-fill from AlertsPanel "Sohbete sor" button (sets sessionStorage then navigates here)
        if (typeof window !== "undefined") {
          const prefill = sessionStorage.getItem("chat_prefill");
          if (prefill) {
            sessionStorage.removeItem("chat_prefill");
            setInput(prefill);
            setTimeout(() => textareaRef.current?.focus(), 50);
          }
        }
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isInitialLoad.current) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending, pendingTx]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  // Core send function — accepts either the state input or a forced text (for voice)
  const doSend = async (text: string) => {
    if (!text || sending) return;
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    setPendingTx(null);
    setTxError(null);

    const now = new Date().toISOString();
    setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: "user", content: text, sentAt: now }]);
    setSending(true);

    try {
      const result = await sendChatMessage(text);
      setMessages((prev) => [
        ...prev,
        { id: `a-${Date.now()}`, role: "assistant", content: result.response, sentAt: new Date().toISOString() },
      ]);
      if (result.profile_updated) showToast("Profilin güncellendi");
      if (result.pending_transaction) setPendingTx(result.pending_transaction);
    } catch {
      setMessages((prev) => [
        ...prev,
        { id: `e-${Date.now()}`, role: "assistant", content: "Bir hata oluştu. Tekrar deneyin.", sentAt: new Date().toISOString() },
      ]);
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  };

  const handleSend = () => void doSend(input.trim());

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 96) + "px";
  };

  // ── Voice input ─────────────────────────────────────────────────────────────

  const startRecording = () => {
    if (!voiceSupported || recording) return;
    if (voiceTimerRef.current) clearTimeout(voiceTimerRef.current);

    const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition!;
    const recognition = new SR();
    recognition.lang = "tr-TR";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (e: SpeechRecognitionEvent) => {
      const transcript = e.results[0][0].transcript;
      setInput(transcript);
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
        textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 96) + "px";
      }
      // Auto-send after 1.5s so the user can see what was transcribed
      voiceTimerRef.current = setTimeout(() => void doSend(transcript), 1500);
    };

    recognition.onerror = () => setRecording(false);
    recognition.onend = () => setRecording(false);

    recognitionRef.current = recognition;
    recognition.start();
    setRecording(true);
  };

  const stopRecording = () => {
    if (voiceTimerRef.current) clearTimeout(voiceTimerRef.current);
    recognitionRef.current?.stop();
    setRecording(false);
  };

  // ── Transaction confirmation ─────────────────────────────────────────────────

  const confirmTransaction = async () => {
    if (!pendingTx) return;
    setTxConfirming(true);
    setTxError(null);
    try {
      await createTransaction({
        amount: pendingTx.amount,
        transaction_type: pendingTx.type,
        description: pendingTx.description,
        transaction_date: pendingTx.date,
        category: pendingTx.category,
      });
      const label = CATEGORY_LABELS[pendingTx.category] ?? pendingTx.category;
      setMessages((prev) => [
        ...prev,
        {
          id: `tx-${Date.now()}`,
          role: "assistant",
          content: `✓ İşlem eklendi: ₺${formatAmount(pendingTx.amount)} — ${label}`,
          sentAt: new Date().toISOString(),
        },
      ]);
      setPendingTx(null);
    } catch (err) {
      setTxError(err instanceof Error ? err.message : "İşlem eklenemedi");
    } finally {
      setTxConfirming(false);
    }
  };

  const dismissTransaction = () => {
    setPendingTx(null);
    setTxError(null);
  };

  const editTransaction = () => {
    setShowEditModal(true);
  };

  const typeLabel = pendingTx?.type === "credit" ? "Gelir" : "Gider";
  const catLabel = pendingTx ? (CATEGORY_LABELS[pendingTx.category] ?? pendingTx.category) : "";

  return (
    <>
      <div className="rounded-xl bg-[#1A1A1A] border border-[#2A2A2A] flex flex-col mb-8" style={{ height: 420 }}>
        {/* Header */}
        <div className="px-4 py-3 border-b border-[#2A2A2A] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            {/* Brain/sparkle icon */}
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="text-indigo-400">
              <path d="M12 2a4 4 0 0 1 4 4c0 1.1-.45 2.1-1.17 2.83A4 4 0 0 1 16 12a4 4 0 0 1-1.17 3.17A4 4 0 0 1 12 18a4 4 0 0 1-2.83-1.17A4 4 0 0 1 8 13.5V12a4 4 0 0 1 1.17-2.83A4 4 0 0 1 8 6a4 4 0 0 1 4-4z" />
              <path d="M12 2v20M8 6H4m4 6H4m4 6H4m8-12h4m-4 6h4m-4 6h4" />
            </svg>
            <p className="text-xs text-gray-300 font-semibold tracking-wide">Finansal Koç</p>
          </div>
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

          {messages.map((msg) => {
            const timeStr = msg.sentAt
              ? new Date(msg.sentAt).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })
              : null;
            return (
              <div key={msg.id} className={`flex flex-col gap-0.5 ${msg.role === "user" ? "items-end" : "items-start"}`}>
                <div
                  className={`max-w-[82%] px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
                    msg.role === "user"
                      ? "bg-indigo-600 text-white rounded-br-sm"
                      : "bg-[#2A2A2A] text-gray-200 rounded-bl-sm"
                  }`}
                >
                  {msg.content}
                </div>
                {timeStr && (
                  <span className="text-[10px] text-gray-700 px-1">{timeStr}</span>
                )}
              </div>
            );
          })}

          {/* Typing indicator */}
          {sending && (
            <div className="flex justify-start">
              <div className="bg-[#2A2A2A] px-4 py-3 rounded-2xl rounded-bl-sm">
                <span className="flex gap-1 items-center h-4">
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-500 animate-bounce" style={{ animationDelay: "0ms" }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-500 animate-bounce" style={{ animationDelay: "150ms" }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-500 animate-bounce" style={{ animationDelay: "300ms" }} />
                </span>
              </div>
            </div>
          )}

          {/* Transaction confirmation card */}
          {pendingTx && !sending && (
            <div className="flex justify-start">
              <div className="max-w-[90%] bg-[#1A1A1A] border border-indigo-800/60 rounded-2xl rounded-bl-sm px-4 py-3 space-y-2">
                <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold">İşlem Tespit Edildi</p>
                <p className="text-sm text-white font-medium">
                  ₺{formatAmount(pendingTx.amount)}{" "}
                  <span className="text-gray-400 font-normal">
                    {typeLabel} · {catLabel}
                  </span>
                </p>
                <p className="text-xs text-gray-400">{pendingTx.description}</p>
                <p className="text-xs text-gray-600">{pendingTx.date}</p>
                {txError && <p className="text-xs text-red-400">{txError}</p>}
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={() => void confirmTransaction()}
                    disabled={txConfirming}
                    className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-xs font-medium text-white transition-colors"
                  >
                    {txConfirming ? "Ekleniyor..." : "Evet, ekle"}
                  </button>
                  <button
                    onClick={editTransaction}
                    disabled={txConfirming}
                    className="px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-xs text-gray-300 transition-colors"
                  >
                    Düzenle
                  </button>
                  <button
                    onClick={dismissTransaction}
                    disabled={txConfirming}
                    className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-xs text-gray-500 transition-colors"
                  >
                    Hayır
                  </button>
                </div>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input row */}
        <div className="px-4 py-3 border-t border-[#2A2A2A] flex gap-2 items-end shrink-0">
          {/* Voice button */}
          {voiceSupported && (
            <button
              onClick={recording ? stopRecording : startRecording}
              disabled={sending}
              title={recording ? "Durdurmak için tıkla" : "Sesli giriş (Türkçe)"}
              className={`shrink-0 w-9 h-9 rounded-xl flex items-center justify-center transition-colors disabled:opacity-40 ${
                recording
                  ? "bg-red-600 hover:bg-red-500"
                  : "bg-[#2A2A2A] hover:bg-[#333] text-gray-400"
              }`}
            >
              {recording ? (
                // Red pulsing dot while recording
                <span className="relative flex items-center justify-center">
                  <span className="absolute w-3 h-3 rounded-full bg-red-300 animate-ping opacity-75" />
                  <span className="w-2 h-2 rounded-full bg-white" />
                </span>
              ) : (
                // Microphone icon
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </svg>
              )}
            </button>
          )}

          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder="Bir şey sorun veya paylaşın... (Enter gönderir)"
            rows={1}
            className="flex-1 bg-[#0F0F0F] border border-[#2A2A2A] rounded-xl px-3 py-2.5 text-white text-sm placeholder-gray-700 focus:outline-none focus:border-indigo-600 resize-none leading-relaxed"
            style={{ minHeight: 40, maxHeight: 96 }}
          />

          <button
            onClick={handleSend}
            disabled={sending || !input.trim()}
            className="px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-sm font-medium text-white transition-colors shrink-0"
          >
            ↑
          </button>
        </div>
      </div>

      {/* Edit modal — opens pre-populated when user clicks Düzenle */}
      {showEditModal && pendingTx && (
        <AddTransactionModal
          onClose={() => { setShowEditModal(false); setPendingTx(null); }}
          onSuccess={() => {
            setShowEditModal(false);
            setPendingTx(null);
            const label = CATEGORY_LABELS[pendingTx.category] ?? pendingTx.category;
            setMessages((prev) => [
              ...prev,
              {
                id: `tx-${Date.now()}`,
                role: "assistant",
                content: `✓ İşlem eklendi: ₺${formatAmount(pendingTx.amount)} — ${label}`,
              },
            ]);
          }}
          initialValues={{
            amount: pendingTx.amount,
            transaction_type: pendingTx.type,
            description: pendingTx.description,
            transaction_date: pendingTx.date,
            category: pendingTx.category,
          }}
        />
      )}
    </>
  );
}
