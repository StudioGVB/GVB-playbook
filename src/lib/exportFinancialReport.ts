import { FinanceTransaction, FinanceCategory, FinanceAccount, FinanceGoal } from '@/hooks/useFinanceData';
import { FinanceAssumptions } from '@/hooks/useFinanceAssumptions';
import { FixedExpense } from '@/hooks/useFixedExpenses';
import { PolicySnapshot } from '@/lib/policyEngine';
import { formatCurrency, baseAmt, parseUkDate } from '@/lib/financeUtils';
import { subDays, subMonths, format, startOfMonth, endOfMonth } from 'date-fns';

export interface ReportExportData {
  finance: {
    transactions: FinanceTransaction[];
    categories: FinanceCategory[];
    accounts: FinanceAccount[];
    goals: FinanceGoal[];
    settings?: { base_currency?: string };
  };
  assumptions: FinanceAssumptions | null;
  fixedExpenses: FixedExpense[];
  snapshot: PolicySnapshot | null;
}

export function generate3MonthReportData({ finance, assumptions, fixedExpenses, snapshot }: ReportExportData) {
  const baseCurrency = finance.settings?.base_currency || 'GBP';
  const fmt = (n: number) => formatCurrency(n, baseCurrency);

  const now = new Date();
  const threeMonthsAgo = subMonths(now, 3);
  const startDateStr = format(threeMonthsAgo, 'yyyy-MM-dd');
  const endDateStr = format(now, 'yyyy-MM-dd');

  // Filter 3-month transactions
  const recentTxns = finance.transactions.filter(tx => {
    const d = parseUkDate(tx.posted_at);
    return d >= threeMonthsAgo && d <= now;
  });

  const catMap = new Map(finance.categories.map(c => [c.id, c]));

  // Separate Income vs Expenses
  const incomeTxns = recentTxns.filter(tx => tx.amount > 0 && !tx.is_transfer);
  const expenseTxns = recentTxns.filter(tx => tx.amount < 0 && !tx.is_transfer && !tx.is_reimbursable);

  const totalIncome3Mo = incomeTxns.reduce((sum, tx) => sum + Math.abs(baseAmt(tx)), 0);
  const totalSpent3Mo = expenseTxns.reduce((sum, tx) => sum + Math.abs(baseAmt(tx)), 0);
  const netSurplus3Mo = totalIncome3Mo - totalSpent3Mo;

  // Breakdown by Essential vs Fun money
  let essentialSpent3Mo = 0;
  let funSpent3Mo = 0;
  const categoryTotals = new Map<string, { name: string; isEssential: boolean; total: number }>();

  for (const tx of expenseTxns) {
    const cat = catMap.get(tx.category_id || '');
    if (cat?.exclude_from_reports || cat?.type === 'fixed' || cat?.type === 'transfer') continue;
    const isEssential = cat?.is_essential ?? false;
    const amt = Math.abs(baseAmt(tx));

    if (isEssential) essentialSpent3Mo += amt;
    else funSpent3Mo += amt;

    const catName = cat?.name || 'Uncategorised';
    const existing = categoryTotals.get(catName);
    if (existing) {
      existing.total += amt;
    } else {
      categoryTotals.set(catName, { name: catName, isEssential, total: amt });
    }
  }

  // Monthly Averages
  const avgMonthlyIncome = totalIncome3Mo / 3;
  const avgMonthlySpend = totalSpent3Mo / 3;

  // Income Sources Context (e.g. Gamma paid on last day of month)
  const gammaTxns = incomeTxns.filter(tx =>
    (tx.merchant || tx.description || '').toLowerCase().includes('gamma') ||
    (tx.merchant || tx.description || '').toLowerCase().includes('salary')
  );

  const gammaRuleNote = "Gamma salary is deposited on the LAST day of each calendar month.";
  const rentRuleNote = "Rent is due on the 1ST day of each calendar month.";

  // Active Goals & Pools
  const activePools = finance.goals.map(g => ({
    name: g.name,
    assignedAmount: g.assigned_amount || 0,
    targetAmount: g.target_amount || 0,
    targetDate: g.target_date ? format(new Date(g.target_date), 'MMM d, yyyy') : 'No fixed date',
    currency: g.currency || baseCurrency,
    shortfall: Math.max(0, (g.target_amount || 0) - (g.assigned_amount || 0)),
  }));

  // Fixed Bills
  const formattedFixedBills = fixedExpenses.map(e => ({
    name: e.name,
    amount: e.amount,
    frequency: e.frequency,
    dueDay: e.due_day ? `Day ${e.due_day} of month` : 'Monthly',
    notes: e.notes || '',
    autoPay: e.auto_pay ? 'Yes' : 'No',
    paidExternally: e.paid_externally ? 'Yes (External)' : 'Direct',
  }));

  return {
    baseCurrency,
    fmt,
    startDateStr,
    endDateStr,
    totalIncome3Mo,
    totalSpent3Mo,
    netSurplus3Mo,
    avgMonthlyIncome,
    avgMonthlySpend,
    essentialSpent3Mo,
    funSpent3Mo,
    gammaRuleNote,
    rentRuleNote,
    incomeTxns,
    expenseTxns,
    recentTxns,
    categoryTotals: Array.from(categoryTotals.values()).sort((a, b) => b.total - a.total),
    activePools,
    formattedFixedBills,
    snapshot,
    assumptions,
  };
}

/** Generate Structured Markdown Prompt for LLMs (ChatGPT, Claude, Gemini) */
export function generateAIMasterPrompt(data: ReturnType<typeof generate3MonthReportData>): string {
  const {
    baseCurrency,
    fmt,
    startDateStr,
    endDateStr,
    totalIncome3Mo,
    totalSpent3Mo,
    netSurplus3Mo,
    avgMonthlyIncome,
    avgMonthlySpend,
    essentialSpent3Mo,
    funSpent3Mo,
    gammaRuleNote,
    rentRuleNote,
    incomeTxns,
    expenseTxns,
    categoryTotals,
    activePools,
    formattedFixedBills,
    snapshot,
    assumptions,
  } = data;

  return `SYSTEM INSTRUCTION / USER FINANCIAL CONTEXT DATASET
================================================================================
You are my personal AI Financial Advisor and Cashflow Strategist.
Below is my comprehensive 3-month financial dataset exported from my GVB Playbook application (${startDateStr} to ${endDateStr}).

Use this dataset to analyze my cashflow velocity, spot spending leaks, project runway, and answer any financial planning questions I ask.
================================================================================

1. EXECUTIVE FINANCIAL OVERVIEW (${startDateStr} to ${endDateStr})
--------------------------------------------------------------------------------
- Base Currency: ${baseCurrency}
- Total 3-Month Income: ${fmt(totalIncome3Mo)} (Avg: ${fmt(avgMonthlyIncome)}/month)
- Total 3-Month Spending: ${fmt(totalSpent3Mo)} (Avg: ${fmt(avgMonthlySpend)}/month)
- 3-Month Net Surplus / Deficit: ${fmt(netSurplus3Mo)}
- Essential Spending (Bills + Groceries + Transport): ${fmt(essentialSpent3Mo)} (${Math.round((essentialSpent3Mo / (totalSpent3Mo || 1)) * 100)}%)
- Fun / Discretionary Spending: ${fmt(funSpent3Mo)} (${Math.round((funSpent3Mo / (totalSpent3Mo || 1)) * 100)}%)
- Liquid Cash Available: ${fmt(snapshot?.availableSavings || 0)}
- Protected Emergency Floor: ${fmt(snapshot?.emergencyFloor || 0)}
- Weekly Fun Budget Allowance: ${fmt(snapshot?.weeklyFunBudget || 150)}/week

2. SPECIAL PAY CADENCE & RECURRING RULES
--------------------------------------------------------------------------------
- INCOME PATTERN: ${gammaRuleNote}
- RENT COMMITMENT: ${rentRuleNote}
- EMERGENCY BUFFER TARGET: ${assumptions?.buffer_months || 3} months of living survival costs.

3. FIXED EXPENSES & RECURRING COMMITMENTS
--------------------------------------------------------------------------------
${formattedFixedBills.length === 0 ? "No fixed bills recorded." : formattedFixedBills.map(b => 
  `- ${b.name}: ${fmt(b.amount)} (${b.frequency}, Due: ${b.dueDay}, AutoPay: ${b.autoPay}, Paid: ${b.paidExternally})`
).join('\n')}

4. UPCOMING SAVINGS POOLS & GOALS
--------------------------------------------------------------------------------
${activePools.length === 0 ? "No active goals or pools." : activePools.map(p => 
  `- Pool "${p.name}": Assigned ${fmt(p.assignedAmount)} of ${fmt(p.targetAmount)} target (Shortfall: ${fmt(p.shortfall)}, Target Date: ${p.targetDate})`
).join('\n')}

5. TOP SPENDING CATEGORIES (LAST 3 MONTHS)
--------------------------------------------------------------------------------
${categoryTotals.slice(0, 15).map(c => 
  `- ${c.name} [${c.isEssential ? 'Essential' : 'Fun'}]: ${fmt(c.total)} (Avg ${fmt(c.total / 3)}/mo)`
).join('\n')}

6. ITEMIZED RECENT TRANSACTIONS (LAST 90 DAYS)
--------------------------------------------------------------------------------
Date       | Type    | Amount      | Merchant / Note               | Category
-----------|---------|-------------|-------------------------------|------------------
${data.recentTxns.slice(0, 100).map(tx => {
  const typeStr = tx.amount > 0 ? 'INCOME ' : 'EXPENSE';
  const dateStr = format(parseUkDate(tx.posted_at), 'yyyy-MM-dd');
  const merchant = (tx.merchant || tx.description || 'Unknown').padEnd(30).slice(0, 30);
  return `${dateStr} | ${typeStr} | ${fmt(Math.abs(tx.amount)).padEnd(11)} | ${merchant} | ${tx.category_id || 'Uncategorised'}`;
}).join('\n')}

================================================================================
INSTRUCTIONS FOR THE AI ADVISOR:
1. Review my 3-month income vs spending habits.
2. Confirm if my spending aligns with my weekly fun budget (${fmt(snapshot?.weeklyFunBudget || 150)}/wk).
3. Evaluate if I am safely on track for my upcoming pools and fixed bill due dates.
4. Answer my follow-up financial questions with realistic, actionable advice.
================================================================================`;
}

/** Generate CSV Content string for Excel / Google Sheets */
export function generateCSVReport(data: ReturnType<typeof generate3MonthReportData>): string {
  const { fmt, baseCurrency, recentTxns, activePools, formattedFixedBills } = data;

  const rows: string[] = [];
  rows.push(`"GVB Playbook 3-Month Financial Export (${data.startDateStr} to ${data.endDateStr})"`);
  rows.push(`"Base Currency", "${baseCurrency}"`);
  rows.push(`"Total 3-Month Income", "${data.totalIncome3Mo}"`);
  rows.push(`"Total 3-Month Spending", "${data.totalSpent3Mo}"`);
  rows.push(`"Net Surplus", "${data.netSurplus3Mo}"`);
  rows.push(`"Special Income Rule", "${data.gammaRuleNote}"`);
  rows.push(`"Special Rent Rule", "${data.rentRuleNote}"`);
  rows.push('');

  rows.push('"FIXED EXPENSES & BILLS"');
  rows.push('"Name","Amount","Frequency","Due Day","Auto Pay","Paid Externally"');
  for (const b of formattedFixedBills) {
    rows.push(`"${b.name}","${b.amount}","${b.frequency}","${b.dueDay}","${b.autoPay}","${b.paidExternally}"`);
  }
  rows.push('');

  rows.push('"UPCOMING POOLS & GOALS"');
  rows.push('"Goal Name","Assigned Amount","Target Amount","Shortfall","Target Date"');
  for (const p of activePools) {
    rows.push(`"${p.name}","${p.assignedAmount}","${p.targetAmount}","${p.shortfall}","${p.targetDate}"`);
  }
  rows.push('');

  rows.push('"ITEMIZED TRANSACTIONS (LAST 90 DAYS)"');
  rows.push('"Date","Type","Amount","Merchant / Description","Category"');
  for (const tx of recentTxns) {
    const typeStr = tx.amount > 0 ? 'INCOME' : 'EXPENSE';
    const dateStr = format(parseUkDate(tx.posted_at), 'yyyy-MM-dd');
    const merchant = (tx.merchant || tx.description || 'Unknown').replace(/"/g, '""');
    rows.push(`"${dateStr}","${typeStr}","${Math.abs(tx.amount)}","${merchant}","${tx.category_id || 'Uncategorised'}"`);
  }

  return rows.join('\n');
}

/** Download Blob Helper */
export function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Print-to-PDF / Open Formatted Printable Window */
export function printPDFReport(data: ReturnType<typeof generate3MonthReportData>) {
  const markdownPrompt = generateAIMasterPrompt(data);
  const printWindow = window.open('', '_blank');
  if (!printWindow) return;

  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>GVB Playbook 3-Month Financial AI Report</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 30px; color: #1e293b; background: #fff; line-height: 1.5; }
          h1 { font-size: 22px; color: #db2777; border-bottom: 2px solid #fbcfe8; padding-bottom: 8px; margin-bottom: 20px; }
          h2 { font-size: 16px; color: #0f172a; margin-top: 24px; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; }
          .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 20px; }
          .card { background: #f8fafc; border: 1px solid #e2e8f0; padding: 12px; rounded-radius: 8px; border-radius: 8px; }
          .card-title { font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: bold; }
          .card-value { font-size: 18px; font-weight: 800; color: #0f172a; margin-top: 4px; }
          table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 12px; }
          th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #e2e8f0; }
          th { background: #f1f5f9; color: #475569; font-weight: 700; }
          .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 10px; font-weight: bold; }
          .badge-income { background: #dcfce7; color: #166534; }
          .badge-expense { background: #fee2e2; color: #991b1b; }
          pre { background: #1e293b; color: #f8fafc; padding: 16px; border-radius: 8px; overflow-x: auto; font-size: 11px; white-space: pre-wrap; }
          @media print {
            body { padding: 0; }
            .no-print { display: none; }
          }
        </style>
      </head>
      <body>
        <div class="no-print" style="margin-bottom: 20px; text-align: right;">
          <button onclick="window.print()" style="background: #db2777; color: white; border: none; padding: 8px 16px; border-radius: 6px; font-weight: bold; cursor: pointer;">
            🖨️ Print / Save as PDF
          </button>
        </div>

        <h1>📊 GVB Playbook — 3-Month Financial AI Report</h1>
        <p style="font-size: 12px; color: #64748b;">Period: <strong>${data.startDateStr}</strong> to <strong>${data.endDateStr}</strong> | Base Currency: <strong>${data.baseCurrency}</strong></p>

        <div class="grid">
          <div class="card">
            <div class="card-title">3-Mo Income</div>
            <div class="card-value" style="color: #16a34a;">${data.fmt(data.totalIncome3Mo)}</div>
          </div>
          <div class="card">
            <div class="card-title">3-Mo Spending</div>
            <div class="card-value" style="color: #dc2626;">${data.fmt(data.totalSpent3Mo)}</div>
          </div>
          <div class="card">
            <div class="card-title">Net Surplus</div>
            <div class="card-value">${data.fmt(data.netSurplus3Mo)}</div>
          </div>
          <div class="card">
            <div class="card-title">Weekly Fun Budget</div>
            <div class="card-value" style="color: #db2777;">${data.fmt(data.snapshot?.weeklyFunBudget || 150)}</div>
          </div>
        </div>

        <h2>📌 Special Income & Fixed Bill Cadence</h2>
        <ul>
          <li><strong>Income Pattern:</strong> ${data.gammaRuleNote}</li>
          <li><strong>Rent Pattern:</strong> ${data.rentRuleNote}</li>
        </ul>

        <h2>🎯 Upcoming Savings Pools & Goals</h2>
        <table>
          <thead>
            <tr>
              <th>Goal Name</th>
              <th>Assigned Amount</th>
              <th>Target Amount</th>
              <th>Shortfall</th>
              <th>Target Date</th>
            </tr>
          </thead>
          <tbody>
            ${data.activePools.map(p => `
              <tr>
                <td><strong>${p.name}</strong></td>
                <td>${data.fmt(p.assignedAmount)}</td>
                <td>${data.fmt(p.targetAmount)}</td>
                <td>${data.fmt(p.shortfall)}</td>
                <td>${p.targetDate}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>

        <h2>🤖 Structured LLM Master Prompt (Formatted for ChatGPT / Claude / Gemini)</h2>
        <pre>${markdownPrompt}</pre>

        <script>
          setTimeout(() => {
            window.print();
          }, 600);
        </script>
      </body>
    </html>
  `);
  printWindow.document.close();
}
