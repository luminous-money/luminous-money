M19: AI categorization
==================================================================================================

> **Status: built within M16** (see [M16's plan](../m16-receipt-capture/PLAN.md), its second
> pass especially): the `ai` service with each book's provider, sealed key, guidance and account
> creation; the AI categorizer (`services/app/src/server/categorize/ai.ts`) at the end of the
> chain; and Select mode's Suggest categories, the bulk action, asking it. The reference
> ([the migration](../migrate-from-another-system/PLAN.md), 2026-10-26) gives it the book's
> history by payee. What's left is a question in [the plan](../../PLAN.md#open-questions):
> whether imports and bank feeds should ask the AI by themselves.
