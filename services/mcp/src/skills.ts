/** The skills, one per domain (skills/<domain>.md), read once at start. */
import { readFileSync } from "node:fs";

import { DOMAINS, type Domain } from "./tool.js";

export const SKILLS: Record<Domain, string> = Object.fromEntries(
  DOMAINS.map((d) => [d, readFileSync(new URL(`../skills/${d}.md`, import.meta.url), "utf8")])
) as Record<Domain, string>;

/** Said to the client when it connects (MCP's `instructions`). */
export const INSTRUCTIONS =
  "Luminous Money is the user's household accounting. Before using any of its tools, call " +
  'load_skill("base"): it explains how the books work. Each tool says its domain first ' +
  '("[loans] …"); load that domain\'s skill before using it. Tools refuse until their skill is ' +
  "loaded.";
