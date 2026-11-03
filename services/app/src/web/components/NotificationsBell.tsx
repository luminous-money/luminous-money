/**
 * The masthead's bell (Funds B): beside the camera, always there for anyone who can change the
 * book, with a count when something needs attention. It opens Notifications.
 */
import { Link, useLocation } from "wouter";

import { withBack } from "../lib/navigation.js";
import { useCanWrite, useNotifications } from "../lib/queries.js";

export function NotificationsBell({ book }: { book: string }) {
  const canWrite = useCanWrite(book);
  const queue = useNotifications(book);
  const [location] = useLocation();
  if (!canWrite) return null;
  const count = queue.data?.length ?? 0;
  const label = count
    ? `Notifications: ${count} need${count === 1 ? "s" : ""} attention`
    : "Notifications";
  const page = `/books/${book}/notifications`;
  return (
    <Link
      href={location === page ? page : withBack(page, location)}
      className="icon bell-button"
      aria-label={label}
      title={label}
    >
      <BellIcon />
      {count > 0 && (
        <span className="bell-count" aria-hidden="true">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}

export function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path
        d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15L6 16z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M10 20.5a2 2 0 0 0 4 0" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
