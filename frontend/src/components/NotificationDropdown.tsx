"use client";

import { useEffect, useRef, useState } from "react";
import { Bell } from "@/components/ui/Icons";
import {
  AppNotification,
  getNotifications,
  getUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
} from "@/lib/api";
import { useLanguage } from "@/lib/i18n";

const TYPE_COLORS: Record<string, string> = {
  alert: "bg-red-950/40 border-red-800/40 text-red-200",
  warning: "bg-amber-950/40 border-amber-800/40 text-amber-200",
  info: "bg-[#1A1A1A] border-[#2A2A2A] text-gray-300",
};

const TYPE_DOT: Record<string, string> = {
  alert: "bg-red-500",
  warning: "bg-amber-500",
  info: "bg-indigo-500",
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
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
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
    if (loading) return;
    setLoading(true);
    try {
      const list = await getNotifications();
      setNotifications(list);
    } catch { /* silent */ }
    finally { setLoading(false); }
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
        className="relative p-1.5 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-[#2A2A2A] transition-colors"
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
        <div className="absolute right-0 top-full mt-2 w-80 bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl shadow-2xl z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[#2A2A2A]">
            <span className="text-white text-sm font-semibold">{t("notifications.title")}</span>
            {unreadCount > 0 && (
              <button onClick={handleMarkAllRead} className="text-indigo-400 text-xs hover:text-indigo-300 transition-colors">
                {t("notifications.markAllRead")}
              </button>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto">
            {loading && (
              <div className="p-4 space-y-2">
                {[1, 2, 3].map((i) => <div key={i} className="h-12 bg-[#2A2A2A] rounded-lg animate-pulse" />)}
              </div>
            )}

            {!loading && notifications.length === 0 && (
              <div className="p-6 text-center text-gray-600 text-sm">{t("notifications.empty")}</div>
            )}

            {!loading && notifications.map((n) => (
              <button
                key={n.id}
                onClick={() => handleMarkRead(n)}
                className={`w-full text-left px-4 py-3 border-b border-[#2A2A2A] last:border-0 hover:bg-[#2A2A2A]/50 transition-colors ${n.is_read ? "opacity-50" : ""}`}
              >
                <div className="flex items-start gap-2.5">
                  <span className={`w-2 h-2 rounded-full shrink-0 mt-1.5 ${TYPE_DOT[n.type] ?? "bg-gray-500"} ${n.is_read ? "opacity-0" : ""}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-white text-xs font-medium truncate">{n.title}</p>
                      <span className="text-gray-600 text-[10px] shrink-0">{timeAgo(n.created_at)}</span>
                    </div>
                    <p className="text-gray-400 text-xs mt-0.5 line-clamp-2">{n.message}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
