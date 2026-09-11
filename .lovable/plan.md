## Salary Snapshot Dashboard — Full Build

Replace the current `/finance/dashboards` view with a single unified **Salary Snapshot** page built around your £37k salary starting Aug 20. We'll build it maximally (as originally proposed) and trim back once you see it live.

### Page structure (top → bottom)

**1. Hero: Paycheck breakdown**
- Gross annual (£37,000) → estimated take-home
- UK tax + NI deducted (2025/26 bands: £12,570 personal allowance, 20% basic rate, 8% NI over £12,570)
- Monthly net + weekly net headline
- Editable inputs: gross salary, pension %, student loan plan (stored in `finance_assumptions` or `user_settings`)

**2. Month-at-a-glance strip (4 tiles)**
- Take-home this month
- Fixed commitments (from `finance_fixed_expenses`)
- Leftover after bills (net − fixed)
- Projected month-end position (pace-based)

**3. Where it goes — waterfall**
- Net pay → −Bills → −Essentials avg → −Fun avg → =Surplus
- Horizontal stacked bar with £ + % on each segment

**4. Weekly Safe to Spend (primary daily driver)**
- Reuses existing weekly allowance logic from `policyEngine.ts`
- Big number + days-left-in-week

**5. Monthly pace widget**
- Reuse existing pace logic from `FinanceMonthly.tsx`
- "On track / over by £X / under by £X"

**6. Savings capacity**
- Auto-calc: net − fixed − essentials avg − fun cap = potential monthly savings
- Show as £/mo and % of net
- Link to Pools page

**7. Runway & emergency**
- Reuse `policyEngine` runway calc (already accounts for Aug 20 job start)
- Emergency fund status (£3k Commbank)

**8. Quick links row**
- Cards linking to: Monthly, Income, Balance Sheet, Cost of Living, Pools

### Technical notes

- New file: `src/pages/FinanceSalarySnapshot.tsx`
- Route `/finance/dashboards` re-points to this new page; old dashboard files stay in repo but unlinked (safe to delete later)
- Add fields to `finance_assumptions`: `gross_annual_salary`, `pension_percent`, `student_loan_plan` (nullable text)
- New helper: `src/lib/ukTakeHome.ts` — pure function computing UK PAYE take-home from gross + pension + student loan plan
- Reuse existing hooks: `useFinanceData`, `useFixedExpenses`, `policyEngine`
- No changes to transactions, categories, or import logic
- Sidebar label: rename "Dashboards" → "Snapshot"

### Working backwards
Once live, we'll cut any section that feels redundant with Monthly / Balance Sheet / Income pages.
