/**
 * Categorizers: built-in and external alike implement one interface, over the external API's
 * request and response (src/shared/categorizer-api.ts), so the chain treats them the same.
 */
import type { CategorizeRequest, FeedbackRequest, Proposal } from "../../shared/categorizer-api.js";

/** A proposal, plus what only built-in categorizers may say. */
export type InternalProposal = Proposal & {
  /** Stage the transaction confirmed: only a user's own rule, with the box ticked. */
  auto_confirm?: boolean;
  /** The rule that made it, for counting how often rules apply. */
  rule_id?: string;
  /** Where the transaction's own side lands, a part of the divided account it came into (M15):
   * a user's own rule. */
  part?: string;
};

export interface Categorizer {
  /** Shown in review as where a proposal came from, and used for acceptance rates. */
  name: string;
  categorize(request: CategorizeRequest): Promise<{ proposals: InternalProposal[] }>;
  /** Told what became of its proposals, if it wants to know. */
  feedback?(request: FeedbackRequest): Promise<void>;
}

/** A proposal that won, with the categorizer that made it. */
export type Chosen = InternalProposal & { categorizer: string };

/** What the chain decided for one transaction: the category (postings) and the payee may come
 * from different categorizers. */
export type Decision = { category?: Chosen; payee?: Chosen };
