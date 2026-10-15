import { serve } from "@hono/node-server";

import { createApp } from "./app.js";
import { booksOverHttp } from "./books.js";
import { smtpMailer } from "./mail.js";
import { fromEnvironment } from "./services.js";

const env = process.env;
const port = Number(env.PORT ?? 3000);
const services = fromEnvironment(env);
await services.keys.ensure();

if (env.AUTH_JWT_SECRET)
  console.warn("AUTH_JWT_SECRET is no longer used: auth signs with its own keys. Remove it.");

let mail;
if (env.SMTP_URL) {
  if (!env.FAVA_BEANS_PUBLIC_URL || !env.MAIL_FROM)
    throw new Error("SMTP_URL needs MAIL_FROM and FAVA_BEANS_PUBLIC_URL (for the links in emails)");
  mail = { mailer: smtpMailer(env.SMTP_URL, env.MAIL_FROM), publicUrl: env.FAVA_BEANS_PUBLIC_URL };
} else {
  console.warn("SMTP_URL isn't set: no email, so password resets go through the CLI (reset-link).");
}

const testUsers = env.AUTH_TEST_USERS === "true";
if (testUsers)
  console.warn("AUTH_TEST_USERS is on: anyone can log in as any email. Test stacks only.");
if (!services.breached)
  console.warn("AUTH_BREACHED_PASSWORDS is off: breached passwords are allowed.");

const app = createApp({
  ...services,
  mail,
  testUsers,
  deleteBooks: booksOverHttp(
    env.LEDGER_URL ?? "http://ledger:8000",
    env.APP_URL ?? "http://app:3000"
  ),
  limits: env.AUTH_SIGNUPS_PER_HOUR
    ? { account: 5, ip: 20, signups: Number(env.AUTH_SIGNUPS_PER_HOUR), resets: 5 }
    : undefined,
});

serve({ fetch: app.fetch, port }, (info) => console.log(`auth listening on :${info.port}`));
