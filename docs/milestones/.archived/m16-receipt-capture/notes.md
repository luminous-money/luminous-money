## Notes

*Use these notes as guidance when creating the spec and the plan.*

* Foundations for this feature:
  * **Transaction attachments:** Any transaction can accept attachments. An attachment can be any file (limit 5mb). The transaction detail/edit view and "new" view have a camera button that opens a dialog that offers "Open Camera" (if a camera is detected - otherwise grayed out/disabled) or "Upload".
  * **Per-book AI Provider:** You can turn AI on or off, choose which service provides AI functionality (for now we only accept claude) and set up a credential for it. If claude allows OAuth that would be the best; otherwise capture an API key. Store the credential safely - this is a sensitive secret.
* If AI is enabled and set up, the global top bar has a small camera button that's the entrypoint for creating a new transaction from a receipt.
* Tapping that button brings up a "Capture receipt" page with a 50/50 view of the live camera feed and a transaction data entry form. The form should be a bottom drawer that you can close and open by tapping a handle.
* There should be an "Upload instead" link at the top of the drawer. If the user clicks this, it should open the file picker.
* When the user snaps a photo or selects a file, that should be displayed on the top half of the screen instead of the camera. It should have a counter-clockwise facing circular arrow for resetting for another capture/upload.
* If the user is currently on an asset or liability account page, that account should be selected by default as the base account. Otherwise the base account should be blank, to be set by the AI or the user.
* The transaction data form should also provide the option to "Itemize receipt?" (yes/no). The default should be determined by book settings (see below).
* When the user submits, it should send the photo and metadata (base account, etc) to the AI module (let's build AI as a separate service if that makes sense and seems advantageous), where the system tries hard to extract the following:
  a. The base account (for exmaple, the receipt might say "Visa 9499" and the module might notice that I have a credit card account called "Amazon Visa 9499". Note that the base account the user submitted is a hint, but ultimately the AI decides the account based on the hint and the receipt, and that can always be changed by the user in review.)
  b. The total amount of the transaction (incuding whether it's positive (a refund) or negative (an expense)
  c. A global category (for example, a receipt from Jewel would be "Expenses:Groceries" - this will be used as a fallback if the AI can't figure out a good account for a given split)
  d. A set of categorized splits summing to the total amount.
* This transaction should be delivered to the main system as "unconfirmed" with the receipt attached, and the UI should be redirected to the transaction's URL in the review queue
  a. If the AI was unable to determine a base account, we should use the standard default for the movement direction (`Expenses:Uncategorized` for outflows or `Income:Uncategorized` for inflows)
* Processing the transaction (confirm or skip) should land you back on the screen where you initiated the upload
* The AI module should have a few book-level configurations of its own, starting with:
  * `Enable account creation?` - if checked, AI can create new accounts that it thinks are appropriate to capture a given transaction
  * If "enable account creation" is enabled, the following additional configurations become available:
    * `Eagerness: "aggressive" | "average" | "reluctant"` - defines how eager the AI should be to create new accounts
    * `Guidance: string` - a textbox input that allows the user to enter a system prompt to help the AI account creator figure out what kinds of accounts you prefer. For example, I might say, "I like highly-detailed, deep hierarchies
  * Receipt Capture - Itemize default: yes | no (whether or not to default the "itemize" option to yes or no for receipt captures)

The end result should be that a user can snap a picture of a receipt and the AI should create an unconfirmed transaction matching the receipt, itemized or not according to the user's preferences, and with the receipt image attached. Later when the bank sync runs, it should match the manually-entered transaction and reconcile it.

Note about deploying the AI service. One nice thing about having it be a totally separate API within the deployment (e.g., `/ai/v1/*`) is that consumers can check its healthcheck endpoint before presenting options or available features and if it's down, they can simply disable those features for the time being. I'd like to go with this architecture if you think it's feasible and appropriate.

