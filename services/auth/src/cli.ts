/**
 * The operator's commands, run inside the auth container:
 *
 *   docker compose exec auth node dist/cli.js <command> ...
 *
 *   reset-link <email>           print a password-reset link (works once, for a day)
 *   disable <email>              stop an account logging in, and end its sessions
 *   enable <email>               undo `disable`
 *   claim-stub <email> <name>    give a pre-M8 stack's stub user (and its books) to a new
 *                                account; reads its password from standard input
 *   rotate-keys                  start signing with a new key (the old one keeps verifying
 *                                tokens it signed until they expire)
 */
import { text } from "node:stream/consumers";

import { DAY } from "./secrets.js";
import { hashPassword, passwordProblem } from "./passwords.js";
import { config } from "./config.js";
import { fromConfig } from "./services.js";

const [command, ...args] = process.argv.slice(2);
const services = fromConfig(config);
const { users, sessions, links, keys } = services;

function userFor(email: string | undefined) {
  const user = email ? users.byEmail(email) : undefined;
  if (!user) throw new Error(`no account for ${email ?? "(no email given)"}`);
  return user;
}

switch (command) {
  case "reset-link": {
    const user = userFor(args[0]);
    const secret = links.create(user.id, "reset", user.email, DAY);
    const base = (services.publicUrl ?? "http://localhost:8080").replace(/\/$/, "");
    console.log(`${base}/ui/reset/${secret}`);
    break;
  }
  case "disable":
  case "enable": {
    const user = userFor(args[0]);
    users.setDisabled(user.id, command === "disable");
    if (command === "disable") sessions.endAll(user.id, "account disabled");
    console.log(`${command}d ${user.email}`);
    break;
  }
  case "claim-stub": {
    const [email, ...name] = args;
    if (!email || !name.length) throw new Error("usage: claim-stub <email> <name> < password");
    const password = (await text(process.stdin)).replace(/\r?\n$/, "");
    const weak = await passwordProblem(password, email, services.breached);
    if (weak) throw new Error(weak);
    const user = users.claimStub(name.join(" "), email, await hashPassword(password));
    console.log(`${user.email} now owns the stub's books`);
    break;
  }
  case "rotate-keys":
    await keys.ensure();
    console.log(`signing with ${await keys.rotate()}`);
    break;
  default:
    console.error("commands: reset-link, disable, enable, claim-stub, rotate-keys (see cli.ts)");
    process.exitCode = 2;
}
