/** Brokerage activity: a brokerage's rows read as what they are, on Bank connections, against the
 * e2e stack's fake SimpleFIN server (prices from the ledger's fixed source: 100 a share). */
import { expect, test } from "@playwright/test";

import { setUpUser } from "./support.js";

const FAKE = process.env.SIMPLEFIN_FAKE_URL ?? "http://simplefin-fake:8080";
const NOW = Math.floor(Date.now() / 1000);
const DAY = 86400;
const CORE = "FIDELITY GOVERNMENT MONEY MARKET (SPAXX)";

async function fake(path: string, method = "GET", body?: unknown) {
  const response = await fetch(`${FAKE}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return (await response.json()) as Record<string, string>;
}

const holding = (symbol: string, shares: string, price: number) => ({
  id: `h-${symbol}`,
  symbol,
  description: `${symbol} fund`,
  shares,
  cost_basis: "0.00",
  purchase_price: String(price * 0.8),
  market_value: (Number(shares) * price).toFixed(2),
  currency: "USD",
});

/** A Fidelity brokerage and another brokerage at the fake; returns a setup token. */
async function brokerages() {
  const { user, setup_token } = await fake("/control/users", "POST");
  await fake(`/control/users/${user}/accounts/brk`, "PUT", {
    name: "Joint WROS",
    institution: "Fidelity Investments",
    balance: "1205.00",
    holdings: [holding("SPAXX", "5.00", 1), holding("ACME", "12", 100)],
  });
  await fake(`/control/users/${user}/accounts/brk/transactions`, "POST", [
    {
      id: "d",
      posted: NOW - 10 * DAY,
      amount: "5.00",
      description: `DIVIDEND RECEIVED ${CORE} (Cash)`,
      memo: "",
      payee: "Fidelity",
    },
    {
      id: "s",
      posted: NOW - 10 * DAY,
      amount: "-5.00",
      description: `REINVESTMENT ${CORE} (Cash)`,
      memo: "",
      payee: "Fidelity",
    },
  ]);
  await fake(`/control/users/${user}/accounts/other`, "PUT", {
    name: "Brokerage Account",
    institution: "Elsewhere Securities",
    balance: "500.00",
    holdings: [holding("VTI", "5", 100)],
  });
  return setup_token!;
}

test("a brokerage says whether its activity is read; a linked one says what it did, where dividends go, and reads again", async ({
  page,
}) => {
  const { book } = await setUpUser(page);
  await page.goto(`/ui/books/${book.id}/connections`);
  await page.getByRole("textbox", { name: "Setup token" }).fill(await brokerages());
  await page.getByRole("button", { name: "Connect" }).click();
  const connection = page.getByRole("region", { name: /Connection to/ });
  await expect(connection).toContainText("Fidelity's activity is read");
  // Another brokerage: its rows come in as cash, and how to get it read.
  await expect(connection.getByRole("note")).toContainText(
    "can't read Elsewhere Securities's activity yet"
  );
  await expect(connection.getByRole("link", { name: "Open an issue" })).toHaveAttribute(
    "href",
    /github\.com\/luminous-money\/luminous-money\/issues\/new\?title=Read%20Elsewhere/
  );

  await connection
    .getByRole("listitem")
    .filter({ hasText: "Joint WROS" })
    .getByRole("button", { name: "Link…" })
    .click();
  const form = page.getByRole("form", { name: "Link Joint WROS" });
  await form.getByRole("button", { name: "Preview" }).click();
  const linking = page.getByRole("group", { name: /Linking to/ });
  await expect(linking.getByRole("region", { name: "What linking will do" })).toContainText(
    "Fidelity's activity is read: sweeps left out"
  );
  await linking.getByRole("button", { name: "Link", exact: true }).click();

  await expect(connection).toContainText(
    "From the bank's rows: 1 sweep left out, 1 dividend confirmed."
  );
  await connection.getByText("Dividends go to Income:Dividends").click();
  await expect(
    connection.getByRole("button", { name: "Dividends account: Income:Dividends" })
  ).toBeVisible();

  await connection.getByRole("button", { name: "Read again…" }).click();
  const preview = connection.getByRole("region", { name: "What reading it again will do" });
  await expect(preview).toContainText(
    "2 rows: 1 sweep left out, 1 dividend confirmed to Income:Dividends"
  );
  await preview.getByRole("button", { name: "Read again", exact: true }).click();
  await expect(connection.getByRole("status").filter({ hasText: "Read again:" })).toBeVisible();
});
