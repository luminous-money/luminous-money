import { serve } from "@hono/node-server";
import { fileURLToPath } from "node:url";

import { createApp } from "./app.js";

const port = Number(process.env.PORT ?? 3000);
const webRoot = process.env.WEB_ROOT ?? fileURLToPath(new URL("../web", import.meta.url));

serve({ fetch: createApp(webRoot).fetch, port }, (info) => {
  console.log(`app listening on :${info.port}, serving the PWA from ${webRoot}`);
});
