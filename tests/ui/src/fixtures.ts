/**
 * The suite's `test`: Playwright's, whose page fails its test if the browser refuses anything
 * under the gateway's Content Security Policy (deploy/gateway/routes.yml, `ui-policy`). The
 * policy blocks quietly (a console error, and something missing from the page), so every test
 * checks it, rather than one page that can't cover them all.
 */
import { expect, test as base } from "@playwright/test";

export const test = base.extend({
  page: async ({ page }, use) => {
    const refused: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error" && /Content Security Policy/.test(message.text()))
        refused.push(message.text());
    });
    await use(page);
    expect(refused, "what the Content Security Policy refused").toEqual([]);
  },
});
