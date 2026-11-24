/**
 * The shops service (Amazon orders), as the user: its connection's state, to say in Notifications
 * when Amazon wants a person, and its sync, for the morning's (orders/sync.ts); and an order's
 * invoice, to attach (HSA tracking). `shops` hands the charges it reads back through
 * `POST /books/:book/orders` (orders/routes.ts).
 */
import type { Notification } from "../shared/notifications.js";
import type { FileIn } from "./images.js";

/** A book's Amazon connection, as much of it as `app` uses. */
export type ShopConnection = {
  has_password: boolean;
  status: "new" | "ok" | "login" | "failed";
  status_detail: string | null;
  last_sync_at: string | null;
  updated_at: string | null;
};

export interface ShopsPort {
  /** The book's Amazon connection; null if it has none, or shops can't be reached. */
  amazon(book: string): Promise<ShopConnection | null>;
  /** Start a sync (it runs in the background, and hands its charges back). */
  sync(book: string): Promise<void>;
  /** An order's invoice as its shop's reader keeps it (a PDF); null if it has none. */
  invoice(book: string, shop: string, order: string): Promise<FileIn | null>;
  /** Forget the user's shop sign-ins (their account is being deleted). */
  forgetUser(): Promise<void>;
}

export function httpShops(baseUrl: string, userId: string): ShopsPort {
  const call = (path: string, init: RequestInit = {}) =>
    fetch(`${baseUrl}/api/shops/v1${path}`, {
      ...init,
      headers: { "X-User-Id": userId, ...init.headers },
      signal: AbortSignal.timeout(10_000),
    });
  return {
    async amazon(book) {
      try {
        const response = await call(`/books/${encodeURIComponent(book)}/amazon`);
        if (!response.ok) return null;
        const c = (await response.json()) as ShopConnection;
        return c.updated_at ? c : null;
      } catch {
        return null;
      }
    },
    async sync(book) {
      const response = await call(`/books/${encodeURIComponent(book)}/amazon/sync`, {
        method: "POST",
      });
      // 409: one's running already, which is as good.
      if (!response.ok && response.status !== 409)
        throw new Error(`shops said ${response.status} starting the sync`);
    },
    async forgetUser() {
      const response = await call("/me", { method: "DELETE" });
      if (!response.ok) throw new Error(`shops said ${response.status}`);
    },
    async invoice(book, shop, order) {
      if (shop !== "amazon") return null;
      const response = await call(
        `/books/${encodeURIComponent(book)}/amazon/orders/${encodeURIComponent(order)}/invoice`
      );
      if (response.status === 404) return null;
      if (!response.ok)
        throw new Error(`shops said ${response.status} for order ${order}'s invoice`);
      return {
        name: `Amazon order ${order}.pdf`,
        type: "application/pdf",
        bytes: new Uint8Array(await response.arrayBuffer()),
      };
    },
  };
}

/** Amazon wanting a person to log in again (a new code, a captcha, a changed password), as the
 * bell says it: it goes once a sync gets in. */
export async function shopNotifications(shops: ShopsPort, book: string): Promise<Notification[]> {
  const c = await shops.amazon(book);
  if (c?.status !== "login") return [];
  return [
    {
      id: "shop-login:amazon",
      kind: "shop-login",
      added: c.last_sync_at ?? c.updated_at ?? new Date().toISOString(),
      dismissable: false,
      title: "Amazon wants you to log in again",
      detail: `Its charges aren't being read until then. Amazon said: ${c.status_detail ?? "nothing more"}`,
      href: `/books/${book}/amazon`,
    },
  ];
}
