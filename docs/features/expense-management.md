# Feature: Expense management

Status: **in backlog** as F38 · Release 1 (US046, US065–US068), Release 2 (US069–US071).
Schema changes below are **approved** and recorded in `docs/architecture.md`.

| Spec | Story | Release | Build step |
| --- | --- | --- | --- |
| EXP-1 Record an expense | US046 | R1 | 31 |
| EXP-2 Expense categories | US065 | R1 | 30a |
| EXP-3 Reverse a wrong expense | US066 | R1 | 31a |
| EXP-4 Expenses in daily closing | US067 | R1 | 33a |
| EXP-5 Expense list and monthly report | US068 | R1 | 39a |
| EXP-6 Bill photo | US069 | R2 | 44a |
| EXP-7 Recurring expenses | US070 | R2 | 44b |
| EXP-8 Staff advances and salary | US071 | R2 | 44c |

## Goal

Shops record every rupee that leaves the business (rent, bijli, mandi transport, bags, staff advances, wastage) in a few taps, offline. Cash expenses reduce expected cash at daily closing, and all expenses feed the monthly profit & loss.

## Rules (follow `docs/architecture.md`)

- Money in paisa, `business_date` in `Asia/Karachi`, UUIDv7 ids made on the device, every row has `shop_id` and `staff_id`.
- `expenses` stays **append-only**. A wrong entry is fixed by a **reversal row** (negative amount, linked to the original), never by editing or deleting.
- No expense can be created for a business date that is already closed (`day_closes`).
- Only **cash** expenses reduce expected cash. Wallet and bank expenses (the shop's other `payment_methods`) do not.
- Money the owner takes home is **not an expense**. It is recorded at daily closing as an owner withdrawal (`day_closes.owner_withdrawal_paisa`).

## Permissions

| Action | Owner | Cashier | Rider |
| --- | --- | --- | --- |
| Add expense | Yes | Yes, up to the shop's limit (default Rs 2,000); above it needs owner PIN | No (Release 2: petrol against own deliveries) |
| See expenses | All | Own entries for today only | No |
| Reverse an expense | Yes | No | No |
| Manage categories and recurring expenses | Yes | No | No |
| Expense reports | Yes | No | No |

## Stories

### US046 (EXP-1) Record an expense (offline)
As a cashier or owner, I record an expense so the money is accounted for.
- Given the add-expense screen, when I pick a category, enter an amount and payment method and tap Save, then one `expenses` row and one outbox entry are written in a single Dexie transaction, with today's `business_date` and my `staff_id`.
- Note and payee are optional. Amount must be greater than 0.
- Works with the network off. The confirmation shows "Saved offline — will sync when online" when offline.
- A cashier entering an amount above the shop limit is asked for the owner PIN, and the approving owner's staff id is stored.
- If today is already closed, saving is blocked with a clear message.

### US065 (EXP-2) Expense categories
As an owner, I keep a short list of categories that match my shop.
- New shops get default categories by shop type. Fruit & veg: Mandi transport, Rent, Bijli/gas, Staff salary, Staff advance, Petrol, Shopping bags, Other. Other shop types: the same without Mandi transport. **Wastage is not an expense category** (decided 22 Nov 2026): wastage is recorded as stock movements (US025) and valued from `product_cost_history` in reports, so an expense would count it twice. Defaults are seeded on the server (`seed_expense_categories()`, for existing shops and in `create_shop`) with `i18n_key` names, like payment methods; renaming a default clears its key so the owner's names show.
- Owner can add, rename, reorder and archive categories. Archived categories are hidden for new entries but stay on old ones.
- Categories show in Urdu and English (i18n keys for defaults; owner-typed names shown as typed).

### US066 (EXP-3) Reverse a wrong expense
As an owner, I correct a mistake without losing history.
- Tapping Reverse on an expense asks for a reason and creates a new row with the negative amount and `reverses_expense_id` set.
- The original shows as "Reversed" and both rows appear in history. An expense can be reversed once.
- If the original's day is closed, the reversal is dated today, not the original date.

### US067 (EXP-4) Expenses in daily closing
As an owner, I see how expenses affected today's cash.
- Expected cash subtracts today's **cash** expenses only (formula in architecture §3, pure function in `packages/core`, same result in SQL).
- The closing screen lists today's expenses by category with the cash total.
- The WhatsApp closing summary includes the day's total expenses.
- Built in Step 18: the closing screen lists cash expenses by category with the total; the summary shows all expenses by category (reversals netted). A reversal made after its day is closed is dated the next open day.

### US068 (EXP-5) Expense list and monthly report
As an owner, I see where money goes.
- List view filtered by date range, category, method and staff, newest first, with the total for the filter.
- Monthly view: total by category, the change against last month, and the expense lines in the monthly profit & loss.
- Export the filtered list as CSV (owner only).

### US069 (EXP-6) Bill photo (Release 2)
As an owner, I attach a photo of the bill or receipt.
- Photo is taken or picked on the device, compressed (max ~300 KB) and stored locally, then uploaded to object storage (S3 API, key `bill-photos/<shop_id>/…`) when online. An `expense_attachments` row is written after upload (the expense row itself is never updated).
- Expense save never waits for the upload.

### US070 (EXP-7) Recurring expenses (Release 2)
As an owner, I'm reminded of rent, salaries and other regular payments.
- Owner sets a recurring expense: category, amount, method, monthly or weekly, due day.
- On the due date the owner sees a reminder ("Rent Rs 25,000 due today") with one tap to record it, or Skip. Nothing is recorded automatically.
- Recorded expenses link to the recurring template (`recurring_expense_id`).

### US071 (EXP-8) Staff advances and salary (Release 2)
As an owner, I track advances (peshgi) against each staff member's salary.
- "Staff advance" and "Staff salary" expenses require choosing a staff member (`payee_staff_id`).
- Each staff member's page shows advances given this month. Paying the salary shows salary minus advances as the suggested amount (`staff_salaries.monthly_salary_paisa`).

## Schema (approved — in `docs/architecture.md` §3)

- **New `expense_categories`** (mutable, owner-only writes): `id, shop_id, name, name_ur null` (owner-typed Urdu name, approved 22 Nov 2026)`, i18n_key null, icon, sort, archived_at null`.
- Built in Step 17: `expense_categories` and `expenses` (with the `expenses_check()` trigger: reversals owner-only, `reverses_expense_id` unique, amount = −original, never a reversal of a reversal, approver an owner). `expense_attachments` (bill photos, US069) is not created yet; `recurring_expense_id` and `payee_staff_id` stay nullable for Release 2.
- **`expenses`**: `category_id` (replaces the text `category`), plus `payee`, `payee_staff_id`, `reverses_expense_id` (unique), `reversal_reason`, `recurring_expense_id`, `approved_by_staff_id` — all nullable.
- **New `expense_attachments`** (append-only): `id, shop_id, expense_id, storage_path, uploaded_at`. Replaces the proposed `expenses.photo_path`, because an append-only expense row can't be updated after the upload finishes.
- **New `recurring_expenses`** (mutable, Release 2): `id, shop_id, category_id, amount_paisa, method_code, frequency ('monthly' | 'weekly'), due_day, next_due_date, active`.
- **`shops.cashier_expense_limit_paisa`** (default 200000).
- **`day_closes.owner_withdrawal_paisa`**, **`staff_salaries.monthly_salary_paisa`** (owner-only table, not a column on `staff`).
- RLS: cashier devices pull only the cashier's own expenses for open days; reports via owner-only RPC.

## Core functions (`packages/core`, unit-tested)

- `expenseTotals(expenses, {from, to})` → totals by category and by method, with reversals netted out.
- `canReverse(expense, allExpenses)` → false if already reversed or itself a reversal.
- `needsOwnerApproval(amountPaisa, role, limitPaisa)`.
- Expected-cash function uses cash expenses net of reversals, minus owner withdrawal.

## Out of scope

Budgets, tax on expenses, splitting one expense across categories, and approval workflows beyond the owner PIN.
