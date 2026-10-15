/** Everything `auth` runs on, from its database and environment: shared by the server and the
 * operator's CLI. */
import { open } from "@fava-beans/db";
import { join } from "node:path";

import { SigningKeys } from "./keys.js";
import { EmailLinks } from "./links.js";
import { pwnedPasswords } from "./passwords.js";
import { ApiTokens, Sessions } from "./sessions.js";
import { Users } from "./users.js";

export function fromEnvironment(env = process.env) {
  const db = open(join(env.AUTH_DATA_DIR ?? "/data", "auth.sqlite"));
  const users = new Users(db); // runs the migrations
  return {
    db,
    users,
    sessions: new Sessions(db),
    apiTokens: new ApiTokens(db),
    keys: new SigningKeys(db),
    links: new EmailLinks(db),
    breached: env.AUTH_BREACHED_PASSWORDS === "false" ? null : pwnedPasswords(),
    publicUrl: env.FAVA_BEANS_PUBLIC_URL,
  };
}
