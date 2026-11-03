Funds: the example book
==================================================================================================

> A made-up household to test the design against (2026-10-31). Every name, balance and price is
> invented. [scenarios.md](scenarios.md) runs events against it. It's new: the book in the
> 2026-10-28 worked example lives only in the private discussion (it used real figures). This one
> keeps that book's shape (checking, a brokerage, a 401(k), a card, a house with a mortgage) and
> adds what the scenarios need: a gift card, a Roth IRA, an HSA, a car and a student loan, three
> accounts a paycheck lands in, and budget funds.

## The household

Alex and Sam, and their kid, Robin. Alex has a salary from Acme, with a 401(k), an HSA and health
insurance through work. Sam freelances. They own a house with a mortgage and a car with a loan,
and Sam has a student loan. The book's operating currency is USD.

**The baseline is the morning of 2026-11-10.** Every scenario starts from here unless it says
otherwise.

## Prices on 2026-11-10

| Commodity | What it is | Price |
|---|---|---|
| VTI | US stock ETF | $300 |
| VXUS | international stock ETF | $65 |
| FXAIX | S&P 500 index mutual fund | $200 |
| FTIHX | international index mutual fund | $16 |
| FXNAX | bond index mutual fund | $10 |
| VFFVX | target-date mutual fund (2055) | $25 |

## Accounts

| Account | Holds | Value | For funds |
|---|---|---|---|
| `Assets:Cash:Wallet` | $120 | $120 | |
| `Assets:Bank:Joint-Checking` | $6,500 | $6,500 | the everyday account; no rules |
| `Assets:Bank:Savings` | $18,000 | $18,000 | default: Emergency |
| `Assets:Bank:Alex-Checking` | $900 | $900 | default: Alex's Money |
| `Assets:Gift-Cards:Walmart` | $50 | $50 | |
| `Assets:Brokerage:Fidelity` (`:Cash`, `:VTI`, `:VXUS`) | $2,000; 40 VTI; 100 VXUS | $20,500 | default: Unallocated (keeps its dividends out of autofill) |
| `Assets:Retirement:Roth-IRA` (`:Cash`, `:FXAIX`, `:FTIHX`, `:FXNAX`) | $300; 60 FXAIX; 500 FTIHX; 800 FXNAX | $28,300 | default: Retirement; not grouped |
| `Assets:Retirement:401k` (`:Cash`, `:VFFVX`) | 2,400 VFFVX | $60,000 | grouped (the advanced setting) as "401(k)", held by Retirement |
| `Assets:HSA` | $3,200 | $3,200 | default: Health |
| `Assets:Home` | $420,000, revalued | $420,000 | grouped with the mortgage as "Home", held by Home |
| `Assets:Vehicles:Car` | $18,000, revalued | $18,000 | grouped with the auto loan as "Car", held by Unallocated |
| `Assets:Receivables` | nothing yet | $0 | |
| `Liabilities:Credit-Cards:Fidelity-Visa` | $1,200 owed | −$1,200 | |
| `Liabilities:Credit-Cards:Amex` | $300 owed | −$300 | |
| `Liabilities:Loans:Mortgage` | $310,000 owed | −$310,000 | in the Home group |
| `Liabilities:Loans:Auto` | $9,500 owed | −$9,500 | in the Car group |
| `Liabilities:Loans:Student` | $22,000 owed (Sam's) | −$22,000 | a group of its own, "Student loan", held by Unallocated |
| **Net worth** | | **$232,570** | |

Income accounts the scenarios use: `Income:Salary:Acme`, `Income:Employer-Match`,
`Income:Freelance`, `Income:Interest`, `Income:Dividends`, `Income:Capital-Gains`,
`Income:Unrealized-Gains`, `Income:Gifts`, `Income:Rewards`. Expenses are named as needed
(`Expenses:Food:Restaurants`, `Expenses:Taxes:Federal`…), and shortened in the scenarios.

## Funds

| Fund | For | Fill | Target | Spend order | Account rules |
|---|---|---|---|---|---|
| **Unallocated** | whatever isn't earmarked (the system's fund) | what autofill leaves | | 1st | default of the brokerage; holds the Car and Student loan groups |
| **Emergency** | emergencies | 10% of income, continuous | $20,000 of value | 2nd | default of Savings |
| **Home Repairs** | repairs and upkeep | 5% of income, continuous | $10,000 of value | 3rd | |
| **Italy Trip** | a trip next summer | 15% of income, single | $8,000 deposited ($6,200 so far) | 4th | |
| **Retirement** | retirement | manual | | opted out | default of the Roth IRA; holds the 401(k) group |
| **Health** | medical costs | manual (fed by the HSA's default) | | opted out | default of the HSA |
| **Home** | the house | manual | | opted out | holds the Home group |
| **Alex's Money** | Alex's personal spending | manual (fed by Alex-Checking's default) | | opted out | default of Alex-Checking |
| **Social** | going out with friends | $150 a month | | opted out | |
| **Chores** | the costs of getting chores and errands done | $200 a month | | opted out | |
| **Family** | family outings | $300 a month | | opted out | |

- **Social, Chores and Family are budget funds** (Kael's 2026-10-30 idea: accounts say *what*,
  funds say *why*). How they fill isn't decided (PLAN.md, open question 1). The scenarios assume
  Claude's lean: each is **topped up to its monthly amount from Unallocated on the 1st**.
- **Opted out** of the spend order means unmarked spending never draws on the fund; only a mark,
  its account's default, or a move does.
- **Fill priority** (PLAN.md, open question 2) never matters here: the percentages total 30%.

## Where each fund stands

| Fund | Cash | Other holdings | Value |
|---|---|---|---|
| Unallocated | $8,240 | 50 VXUS ($3,250); Car group ($8,500); Student loan group (−$22,000) | −$2,010 |
| Emergency | $12,000 | 20 VTI ($6,000) | $18,000 |
| Home Repairs | $3,000 | 50 VXUS ($3,250) | $6,250 |
| Italy Trip | $1,500 | 20 VTI ($6,000) | $7,500 |
| Retirement | $300 | 60 FXAIX ($12,000); 500 FTIHX ($8,000); 800 FXNAX ($8,000); 401(k) group ($60,000) | $88,300 |
| Health | $3,200 | | $3,200 |
| Home | | Home group ($110,000) | $110,000 |
| Alex's Money | $900 | | $900 |
| Social | $110 | | $110 ($40 of November's $150 spent) |
| Chores | $140 | | $140 ($60 of $200 spent) |
| Family | $180 | | $180 ($120 of $300 spent) |
| **Total** | **$29,570** | | **$232,570** |

Per asset, the funds add up to the accounts:

- **Cash:** $29,570 in both. The accounts' plain USD is the wallet, the three bank accounts, the
  gift card, the brokerage's and the Roth's cash and the HSA, less the two cards. The 401(k)'s
  cash is inside its group.
- **VTI** 40 (Emergency 20, Italy Trip 20); **VXUS** 100 (Home Repairs 50, Unallocated 50); the
  Roth's three mutual funds, all Retirement's.
- **Groups:** 401(k) $60,000; Home $420,000 − $310,000 = $110,000; Car $18,000 − $9,500 = $8,500;
  Student loan −$22,000.

## What the setup already shows

- **Defaults route money; they don't make balances match.** Savings holds $18,000 and Emergency's
  cash is $12,000. Funds aren't located in accounts: Savings' default only decides which fund
  money entering or leaving Savings belongs to.
- **Unallocated is worth −$2,010 while holding $8,240 of cash,** because it holds the car's equity
  and the student loan. Its cash is what unmarked spending draws on.
- **Italy Trip is worth $7,500 but has had $6,200 deposited:** single fill counts deposits, and its
  VTI has gained since.
- **The two retirement accounts differ on purpose:** the 401(k) is grouped (Retirement sees one
  $60,000 holding), the Roth IRA isn't (Retirement holds its cash and three mutual funds).
