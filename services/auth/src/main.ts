import { serve } from "@hono/node-server";
import { open } from "@fava-beans/db";
import { join } from "node:path";

import { createApp } from "./app.js";
import { Tokens } from "./tokens.js";
import { Users } from "./users.js";

const port = Number(process.env.PORT ?? 3000);
const dataDir = process.env.AUTH_DATA_DIR ?? "/data";
const secret = process.env.AUTH_JWT_SECRET ?? "";
if (/insecure|change-me/i.test(secret)) {
  console.warn(
    "AUTH_JWT_SECRET is the development default: set your own before exposing this stack"
  );
}

const users = new Users(open(join(dataDir, "auth.sqlite")));
users.ensureStub();

const testUsers = process.env.AUTH_TEST_USERS === "true";
if (testUsers)
  console.warn("AUTH_TEST_USERS is on: anyone can log in as any email. Test stacks only.");

serve(
  { fetch: createApp({ users, tokens: new Tokens(secret), testUsers }).fetch, port },
  (info) => {
    console.log(`auth listening on :${info.port}`);
  }
);
