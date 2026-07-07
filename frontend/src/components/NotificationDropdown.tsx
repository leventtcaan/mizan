"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, ArrowRight, CheckCircle } from "@/components/ui/Icons";
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

// Backend returns action_* fields on notifications (the api.ts type predates them),
// so we extend it locally without touching the shared client.
type ActionNotif = AppNotification & {
  action_type?: string | null;
  action_state?: string;
  action_data?: Record<string, unknown> | null;
  result_message?: string | null;
};

// Mirror api.ts's base URL so the action POST stays inside this component.
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// Per-type accent: left border + dot. Tokens only — no raw dark-theme palette classes.
const TYPE_ACCENT: Record<string, { bar: string; dot: string }> = {
  alert: { bar: "#DC2626", dot: "bg-danger" },
  warning: { bar: "#B45309", dot: "bg-warn" },
  info: { bar: "#176B5B", dot: "bg-[#176B5B]" },
};

// Where a notification leads when the user taps "Open". Proactive notifications carry an
// explicit action_type; the daily ones don't, so fall back to matching the (localized
// TR/EN) title. Sensible default is /home.
function routeFor(n: ActionNotif): string {
  switch (n.action_type) {
    case "liability_payment_followup": return "/networth";
    case "remind_receivable": return "/networth";
    case "set_savings": return "/networth";
    case "upload_statement": return "/upload";
  }
  const title = (n.title || "").toLowerCase();
  if (/insight|analiz/.test(title)) return "/home";        // Daily Insight / Günlük Analiz
  if (/receivable|alacak/.test(title)) return "/networth"; // Overdue Receivable / Vadesi Geçmiş Alacak
  if (/payment|ödeme/.test(title)) return "/networth";     // Upcoming Payment / Yaklaşan Ödeme
  if (/wealth|varlık/.test(title)) return "/networth";     // Wealth Alert / Varlık Alarmı
  if (/budget|bütçe/.test(title)) return "/transactions";  // Budget Alert / Bütçe Uyarısı
  if (/upload|ekstre/.test(title)) return "/upload";       // statement reminder
  return "/home";
}

interface Props {
  onCountChange?: (count: number) => void;
}

export default function NotificationDropdown({ onCountChange }: Props) {
  const router = useRouter();
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
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // While a Yes/No is in flight, and the real outcome line the backend reports afterwards.
  const [actingId, setActingId] = useState<string | null>(null);
  const [actionResults, setActionResults] = useState<Record<string, string>>({});
  const ref = useRef<HTMLDivElement>(null);

  function timeAgo(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const min = Math.floor(diff / 60000);
    if (min < 1) return t("notifications.justNow");
    if (min < 60) return t("notifications.minAgo").replace("{n}", String(min));
    const hr = Math.floor(min / 60);
    if (hr < 24) return t("notifications.hourAgo").replace("{n}", String(hr));
    return t("notifications.dayAgo").replace("{n}", String(Math.floor(hr / 24)));
  }

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
      // Show what actually happened — the backend reports the real outcome
      // ("Logged a 5,000 TRY payment and updated the balance"), not a canned line.
      const fallback = answer === "no"
        ? (lang === "tr" ? "Tekrar hatırlatırız." : "We'll remind you again.")
        : (lang === "tr" ? "✓ Tamam" : "✓ Done");
      setActionResults((prev) => ({ ...prev, [n.id]: updated.result_message || fallback }));
      if (answer === "yes") {
        // Balances/transactions may have changed — let open data pages refresh.
        window.dispatchEvent(new Event("mizan-data-changed"));
      }
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
      if (!v) { setExpandedId(null); loadNotifications(); }
      return !v;
    });
  };

  // Tapping a notification EXPANDS it in place (full message, action row) and marks it
  // read. Navigation is the explicit "Open →" chip — a tap never teleports the user.
  const handleTap = (n: ActionNotif) => {
    setExpandedId((cur) => (cur === n.id ? null : n.id));
    if (!n.is_read) handleMarkRead(n);
  };

  const handleNavigate = (n: ActionNotif) => {
    setOpen(false);
    router.push(routeFor(n));
  };

  const handleMarkRead = async (n: AppNotification) => {
    if (n.is_read) return;
    // Optimistic — the row shouldn't flicker while the PATCH runs.
    setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, is_read: true } : x)));
    const newCount = Math.max(0, unreadCount - 1);
    setUnreadCount(newCount);
    onCountChange?.(newCount);
    try { await markNotificationRead(n.id); } catch { /* silent */ }
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
          <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 flex items-center justify-center rounded-full bg-danger text-white text-[10px] font-bold leading-none">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-2 w-[380px] max-w-[calc(100vw-1.5rem)] border border-line rounded-2xl shadow-2xl z-50 overflow-hidden"
          style={{ backgroundColor: surfaceBg }}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-line">
            <span className="text-ink text-sm font-semibold flex items-center gap-2">
              {t("notifications.title")}
              {unreadCount > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-[#176B5B]/10 text-[#176B5B] text-[10px] font-bold leading-none">
                  {unreadCount}
                </span>
              )}
            </span>
            {unreadCount > 0 && (
              <button onClick={handleMarkAllRead} className="text-[#176B5B] text-xs font-medium hover:underline transition-colors">
                {t("notifications.markAllRead")}
              </button>
            )}
          </div>

          <div className="max-h-[26rem] overflow-y-auto">
            {loading && (
              <div className="p-4 space-y-2">
                {[1, 2, 3].map((i) => <div key={i} className="h-14 bg-surface-2 rounded-xl animate-pulse" />)}
              </div>
            )}

            {!loading && notifications.length === 0 && (
              <div className="px-6 py-10 text-center">
                <span className="mx-auto mb-3 w-11 h-11 rounded-2xl bg-[#176B5B]/10 flex items-center justify-center">
                  <CheckCircle size={20} className="text-[#176B5B]" />
                </span>
                <p className="text-ink text-sm font-medium">{t("notifications.empty")}</p>
                <p className="text-ink-mute text-xs mt-1">{t("notifications.emptySub")}</p>
              </div>
            )}

            {!loading && notifications.map((n) => {
              const actionable = !!n.action_type && n.action_state === "pending";
              const result = actionResults[n.id];
              const expanded = expandedId === n.id || actionable; // pending questions always show fully
              const accent = TYPE_ACCENT[n.type] ?? TYPE_ACCENT.info;
              return (
                <div
                  key={n.id}
                  onClick={() => handleTap(n)}
                  className={`relative px-4 py-3 border-b border-line last:border-0 cursor-pointer transition-colors hover:bg-surface-2/60 ${
                    n.is_read && !actionable ? "opacity-70" : ""
                  }`}
                >
                  {/* unread accent bar */}
                  {!n.is_read && (
                    <span className="absolute left-0 top-2.5 bottom-2.5 w-[3px] rounded-r" style={{ backgroundColor: accent.bar }} />
                  )}

                  <div className="flex items-start justify-between gap-2">
                    <p className="text-ink text-[13px] font-semibold leading-snug flex items-center gap-1.5 min-w-0">
                      {!n.is_read && <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${accent.dot}`} />}
                      <span className={expanded ? "" : "truncate"}>{n.title}</span>
                    </p>
                    <span className="text-ink-mute text-[10px] shrink-0 mt-0.5">{timeAgo(n.created_at)}</span>
                  </div>

                  {/* Full message when expanded; 2 lines collapsed. Tap toggles. */}
                  <p className={`text-ink-soft text-xs mt-1 leading-relaxed ${expanded ? "" : "line-clamp-2"}`}>
                    {n.message}
                  </p>

                  {/* Proactive question — Yes / No, with the REAL outcome after answering */}
                  {actionable && !result && (
                    <div className="flex gap-2 mt-2.5" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => handleAction(n, "yes")}
                        disabled={actingId === n.id}
                        className="px-3.5 py-1.5 rounded-lg bg-[#176B5B] hover:bg-[#125848] text-white text-xs font-semibold transition-colors disabled:opacity-50"
                      >
                        {actingId === n.id ? "…" : t("notifications.yes")}
                      </button>
                      <button
                        onClick={() => handleAction(n, "no")}
                        disabled={actingId === n.id}
                        className="px-3.5 py-1.5 rounded-lg border border-line text-ink-soft hover:bg-surface-2 text-xs font-medium transition-colors disabled:opacity-50"
                      >
                        {t("notifications.no")}
                      </button>
                    </div>
                  )}

                  {result && (
                    <p className="text-pos text-xs mt-2 font-medium flex items-center gap-1">
                      <CheckCircle size={13} /> {result}
                    </p>
                  )}

                  {/* Explicit navigation — only shown when the item is expanded */}
                  {expanded && !actionable && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleNavigate(n); }}
                      className="mt-2.5 inline-flex items-center gap-1 text-[#176B5B] text-xs font-semibold hover:underline"
                    >
                      {t("notifications.open")} <ArrowRight size={13} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
