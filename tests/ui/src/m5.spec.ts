/** M5: holdings and value, trades, revalued assets, commodities. */
import { expect, test } from "@playwright/test";

import { app, importText, setUpUser } from "./support.js";

const day = (offset: number) => new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10);

const BROKERAGE = `2020-01-01 open Assets:Broker
2020-01-01 open Assets:Broker:Cash USD
2020-01-01 open Assets:Broker:VTI VTI "FIFO"
2020-01-01 commodity VTI
  name: "Total Stock Market"
  price: "USD:ledger.price_sources.fixed/VTI"
${day(-500)} * "Fund"
  Assets:Bank:PNC-Checking  -3000.00 USD
  Assets:Broker:Cash
${day(-500)} * "Buy VTI"
  Assets:Broker:VTI   10 VTI {200.00 USD}
  Assets:Broker:Cash
${day(-1)} price VTI 230.00 USD
`;

async function withBrokerage(page: import("@playwright/test").Page) {
  const { book } = await setUpUser(page);
  await importText(book.id, BROKERAGE);
  await app(`/books/${book.id}/stars/Assets:Broker`, { method: "PUT" });
  return { book };
}

test("a starred brokerage shows its value and unrealized gain, and its holdings", async ({
  page,
}) => {
  const { book } = await withBrokerage(page);
  await page.goto("/ui/");

  const card = page.getByRole("link", { name: /^Broker/ });
  await expect(card).toContainText("$3,300.00");
  await expect(card).toContainText("+$300.00 unrealized");
  await card.click();

  const holdings = page.getByRole("region", { name: "Holdings" });
  await expect(holdings).toContainText("VTI");
  await expect(holdings).toContainText("10 × $230.00");
  await holdings.getByRole("button", { name: /VTI/ }).click();
  await expect(page.getByRole("list", { name: "VTI lots" })).toContainText("10 at $200.00");
  await expect(page).toHaveURL(new RegExp(`/books/${book.id}/accounts/Assets%3ABroker$`));
});

test("buying and selling through the Trade form", async ({ page }) => {
  await withBrokerage(page);
  await page.goto("/ui/");
  await page.getByRole("link", { name: /^Broker/ }).click();
  await page.getByRole("link", { name: "Trade" }).click();

  await page.getByRole("textbox", { name: "Commodity (ticker)" }).fill("VTI");
  await page.getByRole("textbox", { name: "Units" }).fill("2");
  await page.getByRole("textbox", { name: /Price per unit/ }).fill("230");
  await page.getByRole("button", { name: "Save" }).click();
  const holdings = page.getByRole("region", { name: "Holdings" });
  await expect(holdings).toContainText("12 × $230.00");

  await page.getByRole("link", { name: "Trade" }).click();
  await page.getByRole("radio", { name: "Sell" }).click();
  await page.getByRole("textbox", { name: "Units" }).fill("11");
  await page.getByRole("textbox", { name: /Price per unit/ }).fill("240");
  await page.getByRole("button", { name: "Preview" }).click();
  const preview = page.getByRole("region", { name: "Preview" });
  await expect(preview).toContainText("10 at $200.00");
  await expect(preview).toContainText("long-term gain $400.00");
  await expect(preview).toContainText("short-term gain $10.00");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(holdings).toContainText("1 × $230.00");
});

test("a house is revalued with Update value", async ({ page }) => {
  await setUpUser(page);
  await page.goto("/ui/accounts/new");
  await page.getByRole("combobox", { name: "Account" }).fill("Assets:Property:House");
  await page.getByRole("textbox", { name: "Balance" }).fill("400000");
  await page.getByLabel("Balance as of").fill(day(-400));
  await page.getByRole("checkbox", { name: /Revalued periodically/ }).check();
  await page.getByRole("button", { name: "Add account" }).click();

  const card = page.getByRole("link", { name: /^House/ });
  await expect(card).toContainText("Needs a new value");
  await card.click();
  const value = page.getByRole("region", { name: "Value" });
  await value.getByRole("textbox", { name: /Value \(/ }).fill("425000");
  await value.getByRole("button", { name: "Update value" }).click();

  await expect(page.getByRole("heading", { name: /House/ }).locator("..")).toContainText(
    "$425,000.00"
  );
  await page.goto("/ui/");
  await expect(card).not.toContainText("Needs a new value");
  await expect(card).toContainText(`valued ${day(0)}`);
});

test("Commodities lists prices and their sources, and fetches now", async ({ page }) => {
  const { book } = await withBrokerage(page);
  await page.goto(`/ui/books/${book.id}/commodities`);

  const vti = page.getByRole("article", { name: "VTI" });
  await expect(vti).toContainText("$230.00");
  await expect(vti).toContainText("fetched from USD:ledger.price_sources.fixed/VTI");
  await page.getByRole("button", { name: "Fetch prices now" }).click();
  await expect(vti).toContainText("$100"); // the fixed source
  await expect(page.getByText(`Prices last fetched ${day(0)}`)).toBeVisible();
});
