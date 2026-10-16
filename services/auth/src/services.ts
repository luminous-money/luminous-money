/** Everything `auth` runs on, from its database and configuration: shared by the server and
 * the operator's CLI. */
import { open } from "@fava-beans/db";
import { join } from "node:path";

import type { Config } from "./config.js";
import { SigningKeys } from "./keys.js";
import { EmailLinks } from "./links.js";
import { pwnedPasswords } from "./passwords.js";
import { ApiTokens, Sessions } from "./sessions.js";
import { Users } from "./users.js";

export function fromConfig(config: Config) {
  const db = open(join(config.dataDir, "auth.sqlite"));
  const users = new Users(db); // runs the migrations
  return {
    db,
    users,
    sessions: new Sessions(db),
    apiTokens: new ApiTokens(db),
    keys: new SigningKeys(db),
    links: new EmailLinks(db),
    breached: config.breachedPasswords ? pwnedPasswords() : null,
    publicUrl: config.publicUrl,
  };
}
