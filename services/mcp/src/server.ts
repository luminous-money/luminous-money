/**
 * One MCP session's server: every tool listed from the start (the list never changes, so a
 * client's prompt cache never has to start over), each refusing until its domain's skill is
 * loaded in the session (docs/milestones/mcp-server/PLAN.md, "Skills and gating").
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool as McpTool,
} from "@modelcontextprotocol/sdk/types.js";

import { INSTRUCTIONS, SKILLS } from "./skills.js";
import { DOMAINS, type Context, type Domain, type Tool } from "./tool.js";
import { ApiError } from "./upstream.js";

const VERSION = process.env.LUMINOUS_MONEY_VERSION ?? "dev";

const LOAD_SKILL: McpTool = {
  name: "load_skill",
  title: "Load a Luminous Money skill",
  description:
    "Load a skill: how a part of Luminous Money works, and what its tools need. Load `base` " +
    "first, before any other tool; then the domain a tool names (`[loans] …`) before using it.",
  inputSchema: {
    type: "object",
    properties: { domain: { type: "string", enum: [...DOMAINS], description: "Which skill." } },
    required: ["domain"],
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
};

/** How a tool is listed: its domain first, and annotations that say what its name does. */
export function listed(tool: Tool): McpTool {
  const kind = tool.name.split("_")[0];
  return {
    name: tool.name,
    description: `[${tool.domain}] ${tool.description}`,
    inputSchema: {
      type: "object",
      properties: tool.input,
      ...(tool.required?.length ? { required: tool.required } : {}),
    },
    annotations: {
      readOnlyHint: kind === "read",
      ...(kind === "read" ? {} : { destructiveHint: kind === "delete" || !tool.additive }),
      openWorldHint: false,
    },
  };
}

const text = (t: string, isError = false): CallToolResult => ({
  content: [{ type: "text", text: t }],
  ...(isError ? { isError: true } : {}),
});

/** What a refusal from the ledger or `app` says to the model. */
function explain(error: unknown): string {
  if (!(error instanceof ApiError)) throw error;
  if (error.status === 409)
    return (
      `Refused (409): ${error.message}. It changed since you read it, or it conflicts: read it ` +
      "again, check the change still makes sense, and retry with the new `updated_at`."
    );
  if (error.status === 404) return `Not found (404): ${error.message}.`;
  if (error.status === 403) return `Not allowed (403): ${error.message}.`;
  return `Refused (${error.status}): ${error.message}.`;
}

export function sessionServer(tools: Tool[], context: () => Context): Server {
  const byName = new Map(tools.map((t) => [t.name, t]));
  const loaded = new Set<Domain>();
  const server = new Server(
    { name: "luminous-money", title: "Luminous Money", version: VERSION },
    { capabilities: { tools: {} }, instructions: INSTRUCTIONS }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [LOAD_SKILL, ...tools.map(listed)],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    const { name, arguments: args = {} } = request.params;
    if (name === "load_skill") {
      const domain = args.domain as Domain;
      if (!DOMAINS.includes(domain))
        return text(`There's no ${String(domain)} skill: one of ${DOMAINS.join(", ")}.`, true);
      const first = !loaded.has("base") && domain !== "base";
      loaded.add("base").add(domain);
      return text(first ? `${SKILLS.base}\n\n---\n\n${SKILLS[domain]}` : SKILLS[domain]);
    }
    const tool = byName.get(name);
    if (!tool) return text(`There's no tool called ${name}.`, true);
    for (const domain of new Set<Domain>(["base", tool.domain]))
      if (!loaded.has(domain))
        return text(
          `Load the ${domain} skill first: load_skill("${domain}"). It says how this works.`,
          true
        );
    try {
      const result = await tool.run(context(), args);
      return text(result === undefined || result === null ? "Done." : JSON.stringify(result));
    } catch (error) {
      return text(explain(error), true);
    }
  });

  return server;
}
