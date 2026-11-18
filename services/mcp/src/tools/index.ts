/** Every tool, by domain. */
import type { Tool } from "../tool.js";
import { accountTools } from "./accounts.js";
import { baseTools } from "./base.js";
import { budgetTools } from "./budgets.js";
import { fundTools } from "./funds.js";
import { importTools } from "./imports.js";
import { investmentTools } from "./investments.js";
import { loanTools } from "./loans.js";
import { receiptTools } from "./receipts.js";
import { reconcileTools } from "./reconciling.js";
import { reportTools } from "./reports.js";
import { reviewTools } from "./review.js";
import { scheduleTools } from "./schedules.js";

export const TOOLS: Tool[] = [
  ...baseTools,
  ...reviewTools,
  ...accountTools,
  ...budgetTools,
  ...reportTools,
  ...fundTools,
  ...investmentTools,
  ...loanTools,
  ...scheduleTools,
  ...reconcileTools,
  ...receiptTools,
  ...importTools,
];
