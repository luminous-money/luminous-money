/** A transfer paired in review (see server/transfers.ts): the transfer, and the two imported
 * transactions it was made of, as they were. */
export type PairedTransfer = {
  transaction_id: string;
  originals: {
    account: string;
    date: string;
    amount: { number: string; currency: string } | null;
    description: string;
    payee: string | null;
  }[];
};
