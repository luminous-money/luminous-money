/** The fake SimpleFIN server as a service, for the e2e stack. */
import { serve } from "@hono/node-server";

import { createFakeSimplefin } from "./fake.js";

const port = Number(process.env.PORT ?? 8080);
const { app } = createFakeSimplefin({ origin: process.env.FAKE_ORIGIN ?? "http://simplefin-fake:8080" });
serve({ fetch: app.fetch, port }, (info) => console.log(`fake SimpleFIN on :${info.port}`));
