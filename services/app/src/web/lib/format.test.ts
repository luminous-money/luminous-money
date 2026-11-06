import { expect, it } from "vitest";

import { formatFullDay, formatMonth, statusMessage } from "./format.js";

it("a due date is its own month and day west of Greenwich", () => {
  // Shown as the month before in Chicago, once (Kael, 2026-11-06).
  const zone = process.env.TZ;
  process.env.TZ = "America/Chicago";
  try {
    expect(formatMonth("2024-09-01")).toBe("Sep 2024");
    expect(formatFullDay("2024-09-01")).toBe("Sep 1, 2024");
  } finally {
    process.env.TZ = zone;
  }
});

it("says what a failed response means when its body doesn't (a proxy's error page)", () => {
  // Emmer's nginx cut a long receipt read off this way (2026-11-02).
  expect(statusMessage(504, "Gateway Time-out")).toBe(
    "The server stopped waiting for an answer (504 Gateway Time-out). What you asked for may still finish: look before trying again."
  );
  expect(statusMessage(502)).toMatch(/^The server couldn't reach the app behind it \(502\)/);
  expect(statusMessage(503)).toMatch(/may be restarting/);
  expect(statusMessage(413, "Payload Too Large")).toBe(
    "That's more than the server takes in one request (413 Payload Too Large)."
  );
  expect(statusMessage(500, "Internal Server Error")).toBe(
    "Something went wrong on the server (500 Internal Server Error)."
  );
  expect(statusMessage(404, "Not Found")).toBe("The server refused that (404 Not Found).");
});
