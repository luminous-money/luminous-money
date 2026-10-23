import { serve } from "@hono/node-server";
import { Hono } from "hono";

import { health } from "@luminous-money/db";

import { createApp } from "./app.js";
import { booksOverHttp } from "./books.js";
import { config } from "./config.js";
import { smtpMailer } from "./mail.js";
import { fromConfig } from "./services.js";

const services = fromConfig(config);
await services.keys.ensure();

if (process.env.AUTH_JWT_SECRET)
  console.warn("AUTH_JWT_SECRET is no longer used: auth signs with its own keys. Remove it.");

let mail;
if (config.mail.smtpUrl) {
  if (!config.publicUrl || !config.mail.from)
    throw new Error(
      "SMTP_URL needs MAIL_FROM and LUMINOUS_MONEY_PUBLIC_URL (for the links in emails)"
    );
  mail = { mailer: smtpMailer(config.mail.smtpUrl, config.mail.from), publicUrl: config.publicUrl };
} else {
  console.warn("SMTP_URL isn't set: no email, so password resets go through the CLI (reset-link).");
}

if (config.testUsers)
  console.warn("AUTH_TEST_USERS is on: anyone can log in as any email. Test stacks only.");
if (!services.breached)
  console.warn("AUTH_BREACHED_PASSWORDS is off: breached passwords are allowed.");

const app = createApp({
  ...services,
  mail,
  testUsers: config.testUsers,
  deleteBooks: booksOverHttp(config.ledgerUrl, config.appUrl),
  limits: { account: 5, ip: 20, signups: config.signupsPerHour, resets: 5 },
});

// Its health, beside the API (not routed outside): for the stack's healthchecks and app's summary.
const root = new Hono();
root.get("/health", (c) => c.json(health("auth", services.db)));
root.route("/", app);

serve({ fetch: root.fetch, port: config.port }, (info) =>
  console.log(`auth listening on :${info.port} (${config.env})`)
);
