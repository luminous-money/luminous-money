import { expect, it } from "vitest";

import { formatFullDay, formatMonth, formatWhen, statusMessage } from "./format.js";

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

it("a timestamp reads in any of the forms the services write, and one that doesn't is shown as is", () => {
  // A backup's `+00:00` was cut to `+00:0Z`, and System threw (Kael, 2026-11-06).
  const when = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
  const expected = when.format(new Date(Date.UTC(2026, 10, 6, 21, 49, 51)));
  for (const stamp of [
    "2026-11-06T21:49:51+00:00",
    "2026-11-06T16:49:51-05:00",
    "2026-11-06T21:49:51Z",
    "2026-11-06T21:49:51.123Z",
    "2026-11-06T21:49:51.123456Z",
    "2026-11-06T21:49:51.123456+00:00",
    "2026-11-06T21:49:51.123456",
  ])
    expect(formatWhen(stamp), stamp).toBe(expected);
  expect(formatWhen("soon")).toBe("soon");
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
