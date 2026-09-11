---
name: Refund flag boosts Fun Money
description: is_refund flag on positive transactions credits the amount back to that week's Fun Money budget
type: feature
---
Positive (incoming) transactions can be manually flagged via an `is_refund` boolean column on `finance_transactions`. The Refund toggle (Undo2 icon, emerald when active) appears in the transactions list only for non-transfer positive amounts. When `is_refund=true`, the policy engine's `computeWeeklyFunSpend` subtracts the absolute amount from that week's fun spend (using the transaction's `posted_at` to determine which week), effectively increasing remaining Fun Money for the week the refund posted. Refunds are never auto-detected — user must opt in to avoid misclassifying real income.
