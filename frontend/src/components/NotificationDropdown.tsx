"use client";

import { useEffect, useRef, useState } from "react";
import { Bell } from "@/components/ui/Icons";
import {
  AppNotification,
  getNotifications,
  getUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
  getToken,
} from "@/lib/api";
import { useLanguage } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";

// Backend now returns action_* fields on notifications (the api.ts type predates them),
// so we extend it locally without touching the shared client.
type ActionNotif = AppNotification & {
  action_type?: string | null;
  action_state?: string;
  action_data?: Record<string, unknown> | null;
};

// Mirror api.ts's base URL so the action POST stays inside this component.
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const TYPE_COLORS: Record<string, string> = {
  alert: "bg-red-950/40 border-red-800/40 text-red-200",
  warning: "bg-amber-950/40 border-amber-800/40 text-amber-200",
  info: "bg-surface border-line text-ink-soft",
};

const TYPE_DOT: Record<string, string> = {
  alert: "bg-red-500",
  warning: "bg-amber-500",
  info: "bg-brand",
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

interface Props {
  onCountChange?: (count: number) => void;
}

export default function NotificationDropdown({ onCountChange }: Props) {
  const { t, lang } = useLanguage();
  // Explicit theme-resolved background — solid `bg-<token>` utilities don't paint opaquely
  // for floating overlays in this build, so the panel goes see-through in light mode.
  // Same fix as the other dropdowns (CurrencyMenu / CurrencySelect / account menu).
  const { resolved } = useTheme();
  const surfaceBg = resolved === "dark" ? "#1C1915" : "#FFFFFF";
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<ActionNotif[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  // While a Yes/No is in flight, and the confirmation line to show afterwards.
  const [actingId, setActingId] = useState<string | null>(null);
  const [actionResults, setActionResults] = useState<Record<string, string>>({});
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Skip the authenticated call when there's no token yet (e.g. during the
    // logout→login transition) — avoids 401 noise in the console.
    if (!getToken()) return;
    getUnreadCount().then((c) => {
      setUnreadCount(c);
      onCountChange?.(c);
    }).catch(() => null);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const loadNotifications = async () => {
    if (loading || !getToken()) return;
    setLoading(true);
    try {
      const list = await getNotifications();
      setNotifications(list as ActionNotif[]);
    } catch { /* silent */ }
    finally { setLoading(false); }
  };

  // Confirmation line shown after answering a proactive notification.
  const confirmationFor = (actionType: string | null | undefined, answer: "yes" | "no"): string => {
    const tr = lang === "tr";
    if (answer === "no") return tr ? "Hatırlatıcı yenilendi" : "Reminder rescheduled";
    if (actionType === "liability_payment_followup") return tr ? "✓ Ödeme kaydedildi" : "✓ Payment recorded";
    return tr ? "✓ Tamam" : "✓ Done";
  };

  const handleAction = async (n: ActionNotif, answer: "yes" | "no") => {
    if (actingId) return;
    setActingId(n.id);
    try {
      const token = getToken();
      const res = await fetch(`${API_BASE}/notifications/${n.id}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ answer }),
      });
      if (!res.ok) throw new Error(`action failed: ${res.status}`);
      const updated = (await res.json()) as ActionNotif;
      setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, ...updated } : x)));
      setActionResults((prev) => ({ ...prev, [n.id]: confirmationFor(n.action_type, answer) }));
      // Answering also reads the notification — keep the badge count honest.
      if (!n.is_read) {
        const newCount = Math.max(0, unreadCount - 1);
        setUnreadCount(newCount);
        onCountChange?.(newCount);
      }
    } catch { /* leave the buttons so the user can retry */ }
    finally { setActingId(null); }
  };

  const handleOpen = () => {
    setOpen((v) => {
      if (!v) loadNotifications();
      return !v;
    });
  };

  const handleMarkRead = async (n: AppNotification) => {
    if (n.is_read) return;
    try {
      const updated = await markNotificationRead(n.id);
      setNotifications((prev) => prev.map((x) => x.id === n.id ? updated : x));
      const newCount = Math.max(0, unreadCount - 1);
      setUnreadCount(newCount);
      onCountChange?.(newCount);
    } catch { /* silent */ }
  };

  const handleMarkAllRead = async () => {
    try {
      await markAllNotificationsRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
      setUnreadCount(0);
      onCountChange?.(0);
    } catch { /* silent */ }
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={handleOpen}
        className="relative p-1.5 rounded-lg text-ink-mute hover:text-ink-soft hover:bg-surface-2 transition-colors"
        title={t("notifications.title")}
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold leading-none">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 border border-line rounded-xl shadow-2xl z-50 overflow-hidden" style={{ backgroundColor: surfaceBg }}>
          <div className="flex items-center justify-between px-4 py-3 border-b border-line">
            <span className="text-ink text-sm font-semibold">{t("notifications.title")}</span>
            {unreadCount > 0 && (
              <button onClick={handleMarkAllRead} className="text-brand text-xs hover:text-brand transition-colors">
                {t("notifications.markAllRead")}
              </button>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto">
            {loading && (
              <div className="p-4 space-y-2">
                {[1, 2, 3].map((i) => <div key={i} className="h-12 bg-surface-2 rounded-lg animate-pulse" />)}
              </div>
            )}

            {!loading && notifications.length === 0 && (
              <div className="p-6 text-center text-ink-mute text-sm">{t("notifications.empty")}</div>
            )}

            {!loading && notifications.map((n) => {
              const actionable = !!n.action_type && n.action_state === "pending";
              const result = actionResults[n.id];
              return (
                <div
                  key={n.id}
                  className={`px-4 py-3 border-b border-line last:border-0 ${n.is_read && !actionable ? "opacity-50" : ""}`}
                >
                  <div className="flex items-start gap-2.5">
                    <span className={`w-2 h-2 rounded-full shrink-0 mt-1.5 ${TYPE_DOT[n.type] ?? "bg-gray-500"} ${n.is_read ? "opacity-0" : ""}`} />
                    <div
                      className={`flex-1 min-w-0 ${actionable ? "" : "cursor-pointer"}`}
                      onClick={() => { if (!actionable) handleMarkRead(n); }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-ink text-xs font-medium truncate">{n.title}</p>
                        <span className="text-ink-mute text-[10px] shrink-0">{timeAgo(n.created_at)}</span>
                      </div>
                      <p className="text-ink-mute text-xs mt-0.5 line-clamp-2">{n.message}</p>
                    </div>
                  </div>

                  {/* Proactive Mim action — Yes / No */}
                  {actionable && !result && (
                    <div className="flex gap-2 mt-2 pl-[18px]">
                      <button
                        onClick={() => handleAction(n, "yes")}
                        disabled={actingId === n.id}
                        className="px-3 py-1 rounded-lg bg-[#176B5B] hover:bg-[#125848] text-white text-xs font-medium transition-colors disabled:opacity-50"
                      >
                        {lang === "tr" ? "Evet" : "Yes"}
                      </button>
                      <button
                        onClick={() => handleAction(n, "no")}
                        disabled={actingId === n.id}
                        className="px-3 py-1 rounded-lg border border-line text-ink-soft hover:bg-surface-2 text-xs font-medium transition-colors disabled:opacity-50"
                      >
                        {lang === "tr" ? "Hayır" : "No"}
                      </button>
                    </div>
                  )}

                  {result && <p className="text-pos text-xs mt-2 pl-[18px] font-medium">{result}</p>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
