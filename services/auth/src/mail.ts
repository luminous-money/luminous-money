/**
 * Sending email, when the server is set up for it (`SMTP_URL`, `MAIL_FROM`, and
 * `LUMINOUS_MONEY_PUBLIC_URL` for the links, never taken from a request's Host). Without it, nothing
 * is sent: password resets go through the operator's CLI.
 */
import { createTransport } from "nodemailer";

export type Message = { to: string; subject: string; text: string };

export interface Mailer {
  send(message: Message): Promise<void>;
}

export function smtpMailer(url: string, from: string): Mailer {
  const transport = createTransport(url);
  return {
    async send(message) {
      await transport.sendMail({ from, ...message });
    },
  };
}

/** The emails `auth` sends. */
export const emails = {
  verify: (link: string): Omit<Message, "to"> => ({
    subject: "Confirm your email for Luminous Money",
    text: `Confirm this is your email address by opening this link:\n\n${link}\n\nIt works for a week. If you didn't sign up for Luminous Money, ignore this email.\n`,
  }),
  reset: (link: string): Omit<Message, "to"> => ({
    subject: "Reset your Luminous Money password",
    text: `Someone asked to reset the password for your Luminous Money account. To choose a new one, open this link:\n\n${link}\n\nIt works for an hour, once. If it wasn't you, ignore this email: your password hasn't changed.\n`,
  }),
};
