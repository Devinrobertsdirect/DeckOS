import { useEffect, useRef, useState, useCallback } from "react";
import {
  Bell, X, CheckCheck, Trash2, AlertTriangle, Info, Zap,
} from "lucide-react";

export interface AppNotification {
  id: number;
  type: string;
  severity: "info" | "warning" | "critical";
  title: string;
  message: string;
  read: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
}

const BASE = import.meta.env.BASE_URL;

function severityStyle(s: string): { icon: React.ReactNode; color: string; bg: string } {
  if (s === "critical") return {
    icon: <AlertTriangle className="w-3.5 h-3.5 shrink-0" />,
    color: "text-[#f03248]",
    bg:    "border-[#f03248]/20 bg-[#f03248]/5",
  };
  if (s === "warning") return {
    icon: <AlertTriangle className="w-3.5 h-3.5 shrink-0" />,
    color: "text-[#ffc820]",
    bg:    "border-[#ffc820]/20 bg-[#ffc820]/5",
  };
  return {
    icon: <Info className="w-3.5 h-3.5 shrink-0" />,
    color: "text-[#3f84f3]",
    bg:    "border-[#3f84f3]/20 bg-[#3f84f3]/5",
  };
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1)   return "just now";
  if (diffMin < 60)  return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24)    return `${diffH}h ago`;
  return d.toLocaleDateString();
}

interface NotificationApiResponse {
  notifications: AppNotification[];
  unread: AppNotification[];
  recent: AppNotification[];
  unreadCount: number;
}

// Shared fetch — returns notifications + unreadCount from the server
export async function fetchNotifications(): Promise<NotificationApiResponse> {
  const r = await fetch(`${BASE}api/notifications`);
  if (!r.ok) throw new Error("Failed to fetch notifications");
  return r.json() as Promise<NotificationApiResponse>;
}

interface NotificationDrawerProps {
  open: boolean;
  onClose: () => void;
  wsEvents: unknown[];
  onUnreadChange: (count: number) => void;
}

export function NotificationDrawer({
  open, onClose, wsEvents, onUnreadChange,
}: NotificationDrawerProps) {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(false);
  // Track seen event IDs to detect new notifications even when the WS array rotates
  const seenEventIds = useRef(new Set<string>());

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchNotifications();
      // Drawer shows only UNREAD notifications — dismissed/read items do not reappear
      setNotifications(data.unread ?? []);
      onUnreadChange(data.unreadCount ?? 0);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [onUnreadChange]);

  // Initial load
  useEffect(() => { void load(); }, [load]);

  // Poll when drawer is open (10s), and as a background resilience fallback (30s) when closed
  useEffect(() => {
    const interval = open ? 10_000 : 30_000;
    const iv = setInterval(() => void load(), interval);
    return () => clearInterval(iv);
  }, [open, load]);

  // React to notification.created WS events — scan tail by event ID to survive WS array rotation
  useEffect(() => {
    let hasNew = false;
    for (const ev of wsEvents) {
      const e = ev as { type?: string; id?: string };
      if (e.type !== "notification.created") continue;
      const id = e.id ?? JSON.stringify(ev);
      if (!seenEventIds.current.has(id)) {
        seenEventIds.current.add(id);
        hasNew = true;
      }
    }
    if (hasNew) void load();
  }, [wsEvents, load]);

  // Dismiss: mark read on server and immediately REMOVE from list
  // All items in the drawer are unread, so count goes down by 1
  async function dismiss(id: number) {
    try {
      await fetch(`${BASE}api/notifications/${id}/read`, { method: "PATCH" });
    } catch {}
    setNotifications((prev) => {
      const next = prev.filter((x) => x.id !== id);
      onUnreadChange(next.length);
      return next;
    });
  }

  async function markAllRead() {
    try {
      await fetch(`${BASE}api/notifications/read-all`, { method: "POST" });
    } catch {}
    // Remove all unread from list — they're dismissed
    setNotifications((prev) => prev.filter((x) => x.read));
    onUnreadChange(0);
  }

  async function clearAll() {
    try {
      await fetch(`${BASE}api/notifications`, { method: "DELETE" });
    } catch {}
    setNotifications([]);
    onUnreadChange(0);
  }

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/20"
          onClick={onClose}
        />
      )}

      {/* Drawer */}
      <div
        className={`fixed top-0 right-0 h-full w-80 z-50 bg-card border-l border-primary/20 flex flex-col
          transition-transform duration-300 ease-in-out
          ${open ? "translate-x-0" : "translate-x-full"}`}
      >
        {/* Header */}
        <div className="h-14 flex items-center justify-between px-4 border-b border-primary/20 shrink-0">
          <div className="flex items-center gap-2 font-mono text-xs text-primary">
            <Bell className="w-4 h-4" />
            <span className="uppercase tracking-widest">Notifications</span>
            {unreadCount > 0 && (
              <span className="bg-[#f03248] text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none">
                {unreadCount}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-primary/40 hover:text-primary transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Action bar */}
        <div className="flex gap-1 px-3 py-2 border-b border-primary/10 shrink-0">
          <button
            onClick={markAllRead}
            disabled={unreadCount === 0}
            className="flex items-center gap-1.5 px-2 py-1 font-mono text-[10px] text-primary/50 hover:text-primary border border-primary/10 hover:border-primary/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <CheckCheck className="w-3 h-3" />
            Dismiss all
          </button>
          <button
            onClick={clearAll}
            disabled={notifications.length === 0}
            className="flex items-center gap-1.5 px-2 py-1 font-mono text-[10px] text-primary/50 hover:text-[#f03248] border border-primary/10 hover:border-[#f03248]/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Trash2 className="w-3 h-3" />
            Clear all
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {loading && notifications.length === 0 && (
            <div className="flex items-center justify-center h-24 text-primary/30 font-mono text-xs">
              LOADING...
            </div>
          )}
          {!loading && notifications.length === 0 && (
            <div className="flex flex-col items-center justify-center h-40 text-primary/25 font-mono text-xs gap-2">
              <Zap className="w-6 h-6 opacity-30" />
              <span className="uppercase tracking-wider">No alerts</span>
            </div>
          )}
          {notifications.map((n) => {
            const { icon, color, bg } = severityStyle(n.severity);
            return (
              <div
                key={n.id}
                className={`mx-2 my-1.5 p-2.5 border font-mono text-xs ${bg}`}
              >
                <div className="flex items-start gap-2">
                  <span className={`${color} mt-0.5`}>{icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-1">
                      <span className={`font-bold text-[11px] ${color}`}>
                        {n.title}
                      </span>
                      <button
                        onClick={() => void dismiss(n.id)}
                        className="text-primary/30 hover:text-primary transition-colors shrink-0"
                        title="Dismiss"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                    <p className="text-primary/50 text-[10px] mt-0.5 leading-relaxed">{n.message}</p>
                    <span className="text-primary/25 text-[10px] mt-1 block">
                      {fmtTime(n.createdAt)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

// Bell button — accepts count as prop (state managed by parent Layout)
interface NotificationBellProps {
  onClick: () => void;
  unreadCount: number;
}

export function NotificationBell({ onClick, unreadCount }: NotificationBellProps) {
  return (
    <button
      onClick={onClick}
      title="Notifications"
      className="relative flex items-center gap-1.5 px-2 py-1 border border-primary/20 text-primary/40 hover:text-primary hover:border-primary/40 transition-all font-mono text-xs"
    >
      <Bell className="w-3.5 h-3.5" />
      {unreadCount > 0 && (
        <span
          className="absolute -top-1.5 -right-1.5 bg-[#f03248] text-white text-[9px] font-bold
            min-w-[14px] h-[14px] rounded-full flex items-center justify-center leading-none px-0.5"
        >
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      )}
    </button>
  );
}
