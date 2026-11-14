import { ChevronRight } from "lucide-react";
import { Fragment } from "react";
import { Link, useLocation } from "wouter";

import { displayName } from "../lib/accounts.js";
import { trail, type Known } from "../lib/crumbs.js";
import { useParam } from "../lib/navigation.js";
import { useAccounts } from "../lib/queries.js";

/**
 * Where this page is, as links up: the page it was opened from (and that page's own trail), or
 * the pages above it (an account's parents, a rule's Rules). Each page's header has these where
 * it had a lone "‹ Back" (lib/crumbs.ts says how a trail is made).
 */
export function Crumbs() {
  const [location] = useLocation();
  const back = useParam("back");
  const book = /^\/books\/([^/]+)/.exec(location)?.[1];
  const accounts = useAccounts(book ? decodeURIComponent(book) : "", !!book);
  const byName = new Map((accounts.data ?? []).map((a) => [a.name, a]));
  const known: Known = {
    label: (name) => displayName(byName.get(name) ?? { name }),
    isNode: (name) => {
      const found = byName.get(name);
      return !!found && found.kind === "node" && !found.divided;
    },
  };
  const crumbs = trail(location, back, known);
  if (!crumbs.length) return null;
  return (
    <nav className="crumbs" aria-label="Breadcrumbs">
      {crumbs.map((c, i) => (
        <Fragment key={`${i}:${c.href}`}>
          {i > 0 && <ChevronRight aria-hidden="true" className="crumb-sep" />}
          <Link href={c.href} className="crumb">
            {c.label}
          </Link>
        </Fragment>
      ))}
    </nav>
  );
}
