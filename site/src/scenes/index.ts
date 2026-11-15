import type { Scene } from './types'
import ReviewScene from './review'
import SimplefinScene from './simplefin'
import ReceiptsScene from './receipts'
import AmazonScene from './amazon'
import AiScene from './ai'
import ReportsScene from './reports'
import FundsScene from './funds'
import LoansScene from './loans'
import InstallScene from './install'

/** The features, in the order the reel and the landing page tell them. */
export const SCENES: Scene[] = [
  {
    id: 'review',
    title: 'Made for your phone',
    line: 'Review what came in with a swipe: right to confirm, left to skip. Every page is built for a phone first.',
    points: [
      "Swipe right to confirm, left to skip",
      "Select mode for bulk actions on any list",
      "Search and filters everywhere",
    ],
    Component: ReviewScene,
  },
  {
    id: 'simplefin',
    title: 'Your bank, synced',
    line: 'Bring your own SimpleFIN connection and banks, cards and brokerages sync every morning. Or import CSVs and skip it.',
    points: [
      "Banks, cards and brokerages through SimpleFIN Bridge",
      "Matched to what's in the books, so nothing comes in twice",
      "CSV imports that learn each bank's format",
    ],
    Component: SimplefinScene,
  },
  {
    id: 'receipts',
    title: 'Receipts, itemized',
    line: "Snap a receipt and each item becomes its own split, matched to the bank's charge for it.",
    points: [
      "Photograph or upload; the AI reads it",
      "Each item a split, with its own account",
      "Matched to the bank's or card's charge",
    ],
    Component: ReceiptsScene,
  },
  {
    id: 'amazon',
    title: 'Amazon, item by item',
    line: 'Amazon orders are read for you, and each charge is itemized: no more one-line mystery purchases.',
    points: [
      "The server signs in for you, its credentials sealed",
      "Each charge itemized into the card's own transaction",
      "Items categorized from what they were before",
    ],
    Component: AmazonScene,
  },
  {
    id: 'ai',
    title: 'Bring your own AI',
    line: 'Add your Anthropic API key and Claude reads receipts and suggests accounts. Or leave it out: everything else works without it.',
    points: [
      "Claude, with your own Anthropic API key",
      "Your rules and history first; the AI for what's left",
      "What each request cost, shown as it goes",
    ],
    Component: AiScene,
  },
  {
    id: 'reports',
    title: 'Follow the money down',
    line: "Cash flow, spending against budget, net worth. Open any line to see what it's made of, all the way to the transactions.",
    points: [
      "This month's spending against the budget, with a projection",
      "Cash flow, net worth and the largest transactions",
      "Breakdowns by account, down to each transaction",
    ],
    Component: ReportsScene,
  },
  {
    id: 'funds',
    title: 'Budgets, and money with a job',
    line: 'Budget any account for any period. Funds say what your money is for, and how close each goal is.',
    points: [
      "Budgets on any account, for any period",
      "Funds hold dollars or shares",
      "Goals, and how close each one is",
    ],
    Component: FundsScene,
  },
  {
    id: 'loans',
    title: 'Loans, worked out',
    line: "A mortgage or a car loan, from its amortization table: what's owed, the next payment's parts, and what paying extra saves.",
    points: [
      "Declared from the lender's amortization table",
      "Principal, interest and escrow kept apart",
      "Payments counted as spending if you like",
    ],
    Component: LoansScene,
  },
  {
    id: 'install',
    title: 'Run it anywhere',
    line: "On your laptop, a home server or a public one with HTTPS, with one command. Or join someone else's instance.",
    points: [
      "Install, upgrade (backing up first), back up and restore, one command each",
      "Built-in HTTPS on a public server",
      "A private instance for a list of emails",
    ],
    Component: InstallScene,
  },
]
