import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App.js";
import { queryClient } from "./lib/queries.js";
import { watchForUpdates } from "./lib/updates.js";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist/wght-italic.css"; // unconfirmed rows are italic
import "./styles.css";

void watchForUpdates();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>
);
