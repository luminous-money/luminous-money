import {
  ArrowLeftRight,
  BarChart3,
  Bot,
  BookOpen,
  CalendarClock,
  ChevronDown,
  Coins,
  Home,
  Inbox,
  Landmark,
  Library,
  LogOut,
  PiggyBank,
  Search,
  Server,
  ShoppingCart,
  Target,
  UserRound,
  Users,
  Wallet,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { Link, useLocation, useSearch } from "wouter";

import { bookHome, useSelectedBook } from "../lib/books.js";
import { offerFind, openFind } from "./FindBar.js";
import { useBooks, useLogOut, useMe, useSystemAccess } from "../lib/queries.js";

type Item = { href: string; label: string; icon: LucideIcon };
type Section = { title?: string; end?: boolean; items: Item[] };

/** The app's places, grouped: the everyday ones first and always shown, then the rest in
 * sections that fold away, then the book's people, the books and you. One list for the phone's
 * menu and the wide screen's sidebar. */
function sections(home: string | undefined, admin: boolean): Section[] {
  const inBook = (items: [string, string, LucideIcon][]): Item[] =>
    home ? items.map(([path, label, icon]) => ({ href: `${home}${path}`, label, icon })) : [];
  return [
    {
      items: inBook([
        ["", "Home", Home],
        ["/review", "Review", Inbox],
        ["/transactions", "Transactions", ArrowLeftRight],
        ["/reports", "Reports", BarChart3],
      ]),
    },
    {
      title: "Plan",
      items: inBook([
        ["/budgets", "Budgets", Target],
        ["/funds", "Funds", PiggyBank],
        ["/schedules", "Schedules", CalendarClock],
      ]),
    },
    {
      title: "Accounts",
      items: inBook([
        ["/accounts", "Accounts", Wallet],
        ["/loans", "Loans", Landmark],
        ["/commodities", "Commodities", Coins],
      ]),
    },
    {
      title: "Automation",
      items: inBook([
        ["/connections", "Bank connections", Library],
        ["/rules", "Rules", Wand2],
        ["/amazon", "Amazon", ShoppingCart],
        ["/ai", "AI", Bot],
      ]),
    },
    // The book's people, the books, you and the server: at the end, never folded away.
    {
      end: true,
      items: [
        ...inBook([["/sharing", "Sharing", Users]]),
        { href: "/books", label: "Manage books", icon: BookOpen },
        { href: "/account", label: "Your account", icon: UserRound },
        ...(admin ? [{ href: "/system", label: "System", icon: Server }] : []),
      ],
    },
  ].filter((s) => s.items.length > 0);
}

/** The place `location` is: the page itself, or the one it's within (a transaction is within
 * Transactions), the most specific that fits (a book's pages are all under `/books`, Manage
 * books' address, and its home's). */
function currentOf(all: Item[], location: string): string | undefined {
  return all
    .map((i) => i.href)
    .filter((href) => location === href || location.startsWith(`${href}/`))
    .sort((a, b) => b.length - a.length)[0];
}

/** Where a page was reached from: following `?back=` to the page it all started from (a
 * transaction opened from review is still in Review), else the page itself. */
function origin(location: string, search: string): string {
  let path = location;
  let back = new URLSearchParams(search).get("back");
  for (let i = 0; back && back.startsWith("/") && i < 5; i++) {
    const [backPath = "", query = ""] = back.split("?");
    path = backPath;
    back = new URLSearchParams(query).get("back");
  }
  return path;
}

const OPEN_KEY = "luminous-money:nav-open";

/** The sections opened by hand, kept on this device. */
function readOpen(): string[] {
  try {
    return JSON.parse(localStorage.getItem(OPEN_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}

/**
 * The main navigation. A section folds away (an accordion), and stays as left; the one holding
 * the page you're on is always open. `onNavigate`: the phone's menu closes on a choice.
 */
export function Nav({ onNavigate }: { onNavigate?: () => void }) {
  const me = useMe();
  const books = useBooks();
  const book = useSelectedBook(me.data?.id ?? "", books.data ?? []);
  const system = useSystemAccess(!!me.data);
  const logOut = useLogOut();
  const [location] = useLocation();
  const search = useSearch();
  const home = book && bookHome(book.id);
  const [open, setOpen] = useState(readOpen);
  const toggle = (title: string) =>
    setOpen((was) => {
      const next = was.includes(title) ? was.filter((t) => t !== title) : [...was, title];
      localStorage.setItem(OPEN_KEY, JSON.stringify(next));
      return next;
    });

  const all = sections(home, !!system.data?.admin);
  const here = currentOf(
    all.flatMap((s) => s.items),
    origin(location, search)
  );
  const link = ({ href, label, icon: Icon }: Item) => {
    return (
      <Link
        key={href}
        href={href}
        className="nav-item"
        aria-current={href === here ? "page" : undefined}
        onClick={onNavigate}
      >
        <Icon aria-hidden="true" className="nav-icon" />
        {label}
      </Link>
    );
  };

  return (
    <nav className="nav" aria-label="Main">
      {all.map((section) => {
        if (!section.title)
          return (
            <div
              key={section.end ? "end" : "main"}
              className={`nav-section${section.end ? " nav-end" : ""}`}
            >
              {section.items.map(link)}
              {section.end && offerFind() && (
                <button
                  type="button"
                  className="nav-item"
                  onClick={() => (onNavigate?.(), openFind())}
                >
                  <Search aria-hidden="true" className="nav-icon" />
                  Find on page
                </button>
              )}
              {section.end && (
                <button type="button" className="nav-item" onClick={() => logOut.mutate()}>
                  <LogOut aria-hidden="true" className="nav-icon" />
                  Log out
                </button>
              )}
            </div>
          );
        const holdsCurrent = section.items.some((i) => i.href === here);
        const expanded = holdsCurrent || open.includes(section.title);
        return (
          <div key={section.title} className="nav-section">
            {holdsCurrent ? (
              // Holding the page you're on, it stays open: a heading, not a toggle.
              <p className="nav-heading">{section.title}</p>
            ) : (
              <button
                type="button"
                className="nav-heading"
                aria-expanded={expanded}
                onClick={() => toggle(section.title!)}
              >
                {section.title}
                <ChevronDown aria-hidden="true" className="nav-chevron" />
              </button>
            )}
            {expanded && <div className="nav-items">{section.items.map(link)}</div>}
          </div>
        );
      })}
    </nav>
  );
}
