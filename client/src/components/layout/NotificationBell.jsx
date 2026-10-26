import { Bell, CalendarCheck, LifeBuoy, MessageCircle, ShieldCheck, Stethoscope } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext.jsx";
import { useRealtime, useRealtimeEvent } from "../../context/RealtimeContext.jsx";
import { useToast } from "../../context/ToastContext.jsx";
import { useDismiss } from "../../hooks/useDismiss.js";
import { useResource } from "../../hooks/useResource.js";
import { notificationService } from "../../services/index.js";
import { timeAgo } from "../../utils/dates.js";
import { IconButton } from "../ui/index.js";

// Live events make the bell update at once; polling stays as a slow safety net (and the fallback when offline).
const NOTIFICATION_REFRESH_MS = 10_000;
const NOTIFICATION_LIVE_REFRESH_MS = 60_000;

const KIND_ICONS = {
  appointment: CalendarCheck,
  message: MessageCircle,
  doctor: Stethoscope,
  account: ShieldCheck,
  support: LifeBuoy,
};

/**
 * The bell: an unread badge and a menu of what happened (appointment updates, messages, reviews…).
 * It refreshes by itself every few seconds while the tab is visible and pops a toast when something
 * new arrives. Guests see a disabled bell.
 */
export default function NotificationBell() {
  const { user } = useAuth();
  const { notify } = useToast();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const seen = useRef(null); // ids already shown; null until the first load
  const { connected } = useRealtime();
  const feed = useResource(() => notificationService.list({ limit: 20 }), [user?.id], {
    enabled: Boolean(user),
    refreshMs: connected ? NOTIFICATION_LIVE_REFRESH_MS : NOTIFICATION_REFRESH_MS,
  });
  useRealtimeEvent(["notification"], () => {
    if (user) feed.refresh();
  });
  const items = feed.data?.items ?? [];
  const unread = feed.data?.unreadCount ?? 0;
  useDismiss(wrapRef, open, () => setOpen(false));

  // Toast for anything that arrived since the last refresh (never for the first load).
  useEffect(() => {
    if (!user) {
      seen.current = null;
      return;
    }
    if (!feed.data) return;
    const fresh = feed.data.items.filter((item) => !seen.current?.has(item.id));
    if (seen.current)
      fresh
        .filter((item) => !item.read)
        .slice(0, 2)
        .forEach((item) => notify(item.title));
    seen.current = new Set(feed.data.items.map((item) => item.id));
  }, [feed.data, user, notify]);

  if (!user)
    return (
      <IconButton label="Notifications (available after you sign in)" disabled aria-disabled="true">
        <Bell size={16} />
      </IconButton>
    );

  const markLocally = (ids) =>
    feed.setData(
      (current) =>
        current && {
          items: current.items.map((item) => (ids.includes(item.id) ? { ...item, read: true } : item)),
          unreadCount: Math.max(
            0,
            current.unreadCount - current.items.filter((item) => ids.includes(item.id) && !item.read).length,
          ),
        },
    );

  const openItem = async (item) => {
    setOpen(false);
    if (!item.read) {
      markLocally([item.id]);
      notificationService.markRead(item.id).catch(() => feed.reload());
    }
    if (item.link) navigate(item.link);
  };

  const readAll = async () => {
    markLocally(items.map((item) => item.id));
    try {
      await notificationService.markAllRead();
      feed.reload();
    } catch {
      feed.reload();
    }
  };

  return (
    <div className="account-menu-wrap" ref={wrapRef}>
      <IconButton
        label={unread ? `Notifications (${unread} unread)` : "Notifications"}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Bell size={16} />
        {unread > 0 && <span className="notification-count">{unread > 99 ? "99+" : unread}</span>}
      </IconButton>
      {open && (
        <div className="account-menu notification-panel surface" role="dialog" aria-label="Notifications">
          <div className="notification-head">
            <strong>Notifications</strong>
            <button type="button" className="link-button" onClick={readAll} disabled={!unread}>
              Mark all as read
            </button>
          </div>
          {!items.length ? (
            <p className="notification-empty">{feed.loading ? "Loading…" : "You’re all caught up."}</p>
          ) : (
            <ul className="notification-list">
              {items.map((item) => {
                const Icon = KIND_ICONS[item.kind] ?? Bell;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={`notification-item ${item.read ? "" : "unread"}`}
                      onClick={() => openItem(item)}
                    >
                      <span className="notification-icon" aria-hidden="true">
                        <Icon size={15} />
                      </span>
                      <span className="notification-text">
                        <strong>{item.title}</strong>
                        {item.body && (
                          <small
                            translate={item.kind === "message" || item.kind === "support" ? "no" : undefined}
                          >
                            {item.body}
                          </small>
                        )}
                        <time dateTime={item.createdAt}>{timeAgo(item.createdAt)}</time>
                      </span>
                      {!item.read && <span className="notification-unread-dot" aria-label="Unread" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
