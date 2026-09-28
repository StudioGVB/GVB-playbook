import { FinanceTransaction, FinanceCategory, FinanceAccount, FinanceGoal } from '@/hooks/useFinanceData';
import { FinanceAssumptions } from '@/hooks/useFinanceAssumptions';
import { FixedExpense } from '@/hooks/useFixedExpenses';
import { PolicySnapshot } from '@/lib/policyEngine';
import { formatCurrency, baseAmt, parseUkDate } from '@/lib/financeUtils';
import { calcTakeHome } from '@/lib/ukTakeHome';
import { subMonths, format, endOfMonth, differenceInDays } from 'date-fns';

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

  // Upcoming Income / Payday Predictions (Gamma Salary + Tax Deduction + Venture + Side Income)
  const gammaTxns = incomeTxns.filter(tx =>
    (tx.merchant || tx.description || '').toLowerCase().includes('gamma') ||
    (tx.merchant || tx.description || '').toLowerCase().includes('salary')
  );

  const lastGammaAmt = gammaTxns.length > 0 ? Math.abs(baseAmt(gammaTxns[0])) : (assumptions?.expected_monthly_income || 3083.33);
  const grossAnnualGamma = assumptions?.gross_annual_salary || (lastGammaAmt * 12);
  const grossMonthlyGamma = grossAnnualGamma / 12;
  const nextPaydayDate = endOfMonth(now);
  const daysUntilPayday = Math.max(0, differenceInDays(nextPaydayDate, now));

  // UK PAYE Tax & NI Calculations (No student loans)
  const takeHome = calcTakeHome({
    grossAnnual: grossAnnualGamma,
    pensionPercent: assumptions?.pension_percent || 0,
    studentLoanPlan: null, // User explicitly has no student loans
  });

  const monthlyIncomeTax = takeHome.incomeTax / 12;
  const monthlyNI = takeHome.nationalInsurance / 12;
  const monthlyPension = takeHome.pension / 12;
  const totalMonthlyDeductions = monthlyIncomeTax + monthlyNI + monthlyPension;
  const netMonthlyGamma = takeHome.netMonthly;

  // Venture Advisory Income (£70/week)
  const ventureWeeklyAmt = 70.00;
  const ventureMonthlyAmt = (ventureWeeklyAmt * 52) / 12; // ~£303.33/month

  const streams = [
    {
      source: 'Gamma Salary (Gross)',
      amount: grossMonthlyGamma,
      frequency: 'Monthly (Last day of month)',
      scheduleNote: `Gross Pay: ${fmt(grossMonthlyGamma)}/mo | Tax & NI: -${fmt(totalMonthlyDeductions)}/mo | Net Pay: ${fmt(netMonthlyGamma)}/mo (Deposit ${format(nextPaydayDate, 'MMM d, yyyy')} — ${daysUntilPayday === 0 ? 'Today!' : `in ${daysUntilPayday} day${daysUntilPayday > 1 ? 's' : ''}`})`,
      monthlyEquivalent: netMonthlyGamma,
    },
    {
      source: 'Venture Advisory (Weekly Income)',
      amount: ventureWeeklyAmt,
      frequency: 'Weekly (£70.00/week)',
      scheduleNote: `Weekly recurring income (~${fmt(ventureMonthlyAmt)}/month)`,
      monthlyEquivalent: ventureMonthlyAmt,
    }
  ];

  // Also check for any other income categories or transactions
  const otherIncomeCategories = new Map<string, number>();
  for (const tx of incomeTxns) {
    const desc = (tx.merchant || tx.description || '').toLowerCase();
    if (desc.includes('gamma') || desc.includes('salary') || desc.includes('venture')) continue;
    const cat = catMap.get(tx.category_id || '')?.name || (tx.merchant || tx.description || 'Other Income');
    const amt = Math.abs(baseAmt(tx));
    otherIncomeCategories.set(cat, (otherIncomeCategories.get(cat) || 0) + amt);
  }

  for (const [catName, total3Mo] of otherIncomeCategories.entries()) {
    const avgMo = total3Mo / 3;
    streams.push({
      source: `${catName} (Side / Project Income)`,
      amount: avgMo,
      frequency: 'Variable',
      scheduleNote: `Total over last 3 months: ${fmt(total3Mo)} (${fmt(avgMo)}/mo avg)`,
      monthlyEquivalent: avgMo,
    });
  }

  const totalNetExpectedMonthlyCashflow = streams.reduce((acc, s) => acc + s.monthlyEquivalent, 0);

  const predictedIncome = {
    streams,
    grossAnnualGamma,
    grossMonthlyGamma,
    monthlyIncomeTax,
    monthlyNI,
    totalMonthlyDeductions,
    netMonthlyGamma,
    ventureWeeklyAmt,
    ventureMonthlyAmt,
    totalNetExpectedMonthlyCashflow,
    nextPaydayDate: format(nextPaydayDate, 'EEEE, MMM d, yyyy'),
    daysUntilPayday,
    formattedText: `Gross Gamma: ${fmt(grossMonthlyGamma)}/mo → Tax & NI (-${fmt(totalMonthlyDeductions)}/mo) = Net Gamma: ${fmt(netMonthlyGamma)}/mo + Venture: ${fmt(ventureWeeklyAmt)}/wk (~${fmt(ventureMonthlyAmt)}/mo) → Total Net Monthly Cashflow: ~${fmt(totalNetExpectedMonthlyCashflow)}/month`,
  };

  const gammaRuleNote = "Gamma salary is deposited on the LAST day of each calendar month.";
  const ventureRuleNote = "Venture income is deposited WEEKLY at £70.00/week (~£303.33/month).";
  const rentRuleNote = "Rent is due on the 1ST day of each calendar month.";
  const taxRuleNote = `Tax & NI Deduction: UK PAYE 2025/26 (Income Tax: -${fmt(monthlyIncomeTax)}/mo, NI: -${fmt(monthlyNI)}/mo, Student Loan: None). Net Gamma = ${fmt(netMonthlyGamma)}/month.`;

  // Actual Emergency Fund Saved vs Policy Cushion Floor
  const emergencyGoal = finance.goals.find(g => (g as any).is_emergency === true || g.name.toLowerCase().includes('emergency'));
  const actualEmergencySaved = emergencyGoal ? (emergencyGoal.assigned_amount || 0) : 0;
  const emergencyTargetFloor = snapshot?.emergencyFloor || 0;
  const emergencyShortfall = Math.max(0, emergencyTargetFloor - actualEmergencySaved);

  // Active Goals & Pools with "Current Saved Balance" terminology
  const activePools = finance.goals.map(g => ({
    name: g.name,
    description: g.description || '',
    currentSavedBalance: g.assigned_amount || 0,
    targetAmount: g.target_amount || 0,
    targetDate: g.deadline ? format(new Date(g.deadline), 'MMM d, yyyy') : (g.target_date ? format(new Date(g.target_date), 'MMM d, yyyy') : 'No fixed date'),
    startDate: g.start_date ? format(new Date(g.start_date), 'MMM d, yyyy') : null,
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

  // Map transactions with category names and Pool/Bill tags
  const goalMap = new Map(finance.goals.map(g => [g.id, g]));

  const formattedTxns = recentTxns.map(tx => {
    const catObj = catMap.get(tx.category_id || '');
    const categoryName = catObj?.name || (tx.category_id ? 'Uncategorised' : 'Uncategorised');
    const tags: string[] = [];

    if (tx.is_fixed || (tx as any).fixed_expense_id || catObj?.type === 'fixed') {
      tags.push('Bill');
    }

    if (tx.goal_id) {
      const pool = goalMap.get(tx.goal_id);
      tags.push(pool ? `Pool: ${pool.name}` : 'Pool');
    }

    const categoryWithTags = tags.length > 0 ? `${categoryName} [${tags.join(', ')}]` : categoryName;

    return {
      ...tx,
      categoryName,
      categoryWithTags,
      isBill: tags.includes('Bill'),
      poolName: tx.goal_id ? (goalMap.get(tx.goal_id)?.name || 'Pool') : null,
    };
  });

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
    predictedIncome,
    actualEmergencySaved,
    emergencyTargetFloor,
    emergencyShortfall,
    gammaRuleNote,
    ventureRuleNote,
    rentRuleNote,
    incomeTxns,
    expenseTxns,
    recentTxns: formattedTxns,
    categoryTotals: Array.from(categoryTotals.values()).sort((a, b) => b.total - a.total),
    activePools,
    formattedFixedBills,
    snapshot,
    assumptions,
  };
}

/** Generate Clean, Factual Financial Markdown Summary (No AI Instructions/Prompts) */
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
    predictedIncome,
    actualEmergencySaved,
    emergencyTargetFloor,
    emergencyShortfall,
    gammaRuleNote,
    ventureRuleNote,
    rentRuleNote,
    taxRuleNote,
    categoryTotals,
    activePools,
    formattedFixedBills,
    snapshot,
    assumptions,
  } = data;

  return `# GVB PLAYBOOK — 3-MONTH FINANCIAL SNAPSHOT REPORT
Period: ${startDateStr} to ${endDateStr} | Base Currency: ${baseCurrency}

## 1. PREDICTED UPCOMING INCOME, TAX & PAYDAY CASHFLOW
- Cashflow Summary: ${predictedIncome.formattedText}
- Income & Deductions Breakdown:
  - Gross Gamma Salary: ${fmt(predictedIncome.grossMonthlyGamma)}/month (${fmt(predictedIncome.grossAnnualGamma)}/year)
  - Estimated UK Tax & NI Deductions: -${fmt(predictedIncome.totalMonthlyDeductions)}/month (Income Tax: -${fmt(predictedIncome.monthlyIncomeTax)}/mo, NI: -${fmt(predictedIncome.monthlyNI)}/mo, Student Loan: £0)
  - Net Gamma Take-Home Paycheck: ${fmt(predictedIncome.netMonthlyGamma)}/month (Deposited last day of month)
  - Venture Advisory Side Income: ${fmt(predictedIncome.ventureWeeklyAmt)}/week (~${fmt(predictedIncome.ventureMonthlyAmt)}/month)
  - Total Net Expected Monthly Cashflow: ~${fmt(predictedIncome.totalNetExpectedMonthlyCashflow)}/month
- Income Patterns & Tax Rules:
  - ${gammaRuleNote}
  - ${ventureRuleNote}
  - ${taxRuleNote}

## 2. EXECUTIVE FINANCIAL OVERVIEW
- Total 3-Month Historical Income: ${fmt(totalIncome3Mo)} (Avg: ${fmt(avgMonthlyIncome)}/month)
- Total 3-Month Historical Spending: ${fmt(totalSpent3Mo)} (Avg: ${fmt(avgMonthlySpend)}/month)
- Net Surplus / Deficit (3-Mo): ${fmt(netSurplus3Mo)}
- Expected Net Monthly Incoming Cashflow: ${fmt(predictedIncome.totalNetExpectedMonthlyCashflow)}/month
- Essential Spending (Bills, Groceries, Transport): ${fmt(essentialSpent3Mo)} (${Math.round((essentialSpent3Mo / (totalSpent3Mo || 1)) * 100)}%)
- Fun / Discretionary Spending: ${fmt(funSpent3Mo)} (${Math.round((funSpent3Mo / (totalSpent3Mo || 1)) * 100)}%)
- Weekly Fun Budget Allowance: ${fmt(snapshot?.weeklyFunBudget || 150)}/week

## 3. EMERGENCY FUND STATUS
- Actual Emergency Fund Saved: ${fmt(actualEmergencySaved)}
- Target Emergency Cushion Floor (${assumptions?.buffer_months || 3} months): ${fmt(emergencyTargetFloor)}
- Emergency Buffer Shortfall: ${fmt(emergencyShortfall)} (${actualEmergencySaved >= emergencyTargetFloor ? '100% Fully Funded ✅' : 'In Progress ⏳'})

## 4. UPCOMING SAVINGS POOLS & GOALS
${activePools.length === 0 ? "No active goals or pools." : activePools.map(p => 
  `- Pool "${p.name}"${p.description ? ` (Purpose: ${p.description})` : ''}: Current Saved Balance ${fmt(p.currentSavedBalance)} of ${fmt(p.targetAmount)} target (Shortfall: ${fmt(p.shortfall)}, Target Date: ${p.targetDate}${p.startDate ? `, Savings Start Date: ${p.startDate}` : ''})`
).join('\n')}

## 5. FIXED EXPENSES & RECURRING BILLS
- Rent Rule: ${rentRuleNote}
${formattedFixedBills.length === 0 ? "No fixed bills recorded." : formattedFixedBills.map(b => 
  `- ${b.name}: ${fmt(b.amount)} (${b.frequency}, Due: ${b.dueDay}, AutoPay: ${b.autoPay}, Paid: ${b.paidExternally})`
).join('\n')}

## 6. TOP SPENDING CATEGORIES (LAST 3 MONTHS)
${categoryTotals.slice(0, 15).map(c => 
  `- ${c.name} [${c.isEssential ? 'Essential' : 'Fun'}]: ${fmt(c.total)} (Avg ${fmt(c.total / 3)}/mo)`
).join('\n')}

## 7. ITEMIZED TRANSACTIONS LOG (LAST 90 DAYS)
Date       | Type    | Amount      | Merchant / Description        | Category & Tags
-----------|---------|-------------|-------------------------------|------------------
${data.recentTxns.slice(0, 100).map(tx => {
  const typeStr = tx.amount > 0 ? 'INCOME ' : 'EXPENSE';
  const dateStr = format(parseUkDate(tx.posted_at), 'yyyy-MM-dd');
  const merchant = (tx.merchant || tx.description || 'Unknown').padEnd(30).slice(0, 30);
  return `${dateStr} | ${typeStr} | ${fmt(Math.abs(tx.amount)).padEnd(11)} | ${merchant} | ${tx.categoryWithTags}`;
}).join('\n')}`;
}

/** Generate CSV Content string for Excel / Google Sheets */
export function generateCSVReport(data: ReturnType<typeof generate3MonthReportData>): string {
  const { fmt, baseCurrency, recentTxns, activePools, formattedFixedBills, predictedIncome } = data;

  const rows: string[] = [];
  rows.push(`"GVB Playbook 3-Month Financial Export (${data.startDateStr} to ${data.endDateStr})"`);
  rows.push(`"Base Currency", "${baseCurrency}"`);
  rows.push(`"Predicted Income", "${predictedIncome.formattedText}"`);
  rows.push(`"Total 3-Month Income", "${data.totalIncome3Mo}"`);
  rows.push(`"Total 3-Month Spending", "${data.totalSpent3Mo}"`);
  rows.push(`"Net Surplus", "${data.netSurplus3Mo}"`);
  rows.push(`"Actual Emergency Fund Saved", "${data.actualEmergencySaved}"`);
  rows.push(`"Target Emergency Floor", "${data.emergencyTargetFloor}"`);
  rows.push('');

  rows.push('"UPCOMING SAVINGS POOLS & GOALS"');
  rows.push('"Goal Name","Current Saved Balance","Target Amount","Shortfall","Target Date"');
  for (const p of activePools) {
    rows.push(`"${p.name}","${p.currentSavedBalance}","${p.targetAmount}","${p.shortfall}","${p.targetDate}"`);
  }
  rows.push('');

  rows.push('"FIXED EXPENSES & BILLS"');
  rows.push('"Name","Amount","Frequency","Due Day","Auto Pay","Paid Externally"');
  for (const b of formattedFixedBills) {
    rows.push(`"${b.name}","${b.amount}","${b.frequency}","${b.dueDay}","${b.autoPay}","${b.paidExternally}"`);
  }
  rows.push('');

  rows.push('"ITEMIZED TRANSACTIONS (LAST 90 DAYS)"');
  rows.push('"Date","Type","Amount","Merchant / Description","Category & Tags"');
  for (const tx of recentTxns) {
    const typeStr = tx.amount > 0 ? 'INCOME' : 'EXPENSE';
    const dateStr = format(parseUkDate(tx.posted_at), 'yyyy-MM-dd');
    const merchant = (tx.merchant || tx.description || 'Unknown').replace(/"/g, '""');
    const catStr = tx.categoryWithTags.replace(/"/g, '""');
    rows.push(`"${dateStr}","${typeStr}","${Math.abs(tx.amount)}","${merchant}","${catStr}"`);
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
  const reportText = generateAIMasterPrompt(data);
  const printWindow = window.open('', '_blank');
  if (!printWindow) return;

  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>GVB Playbook 3-Month Financial Report</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 30px; color: #1e293b; background: #fff; line-height: 1.5; }
          h1 { font-size: 22px; color: #db2777; border-bottom: 2px solid #fbcfe8; padding-bottom: 8px; margin-bottom: 20px; }
          h2 { font-size: 15px; color: #0f172a; margin-top: 20px; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; }
          .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 20px; }
          .card { background: #f8fafc; border: 1px solid #e2e8f0; padding: 12px; border-radius: 8px; }
          .card-title { font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: bold; }
          .card-value { font-size: 17px; font-weight: 800; color: #0f172a; margin-top: 4px; }
          table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 12px; }
          th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #e2e8f0; }
          th { background: #f1f5f9; color: #475569; font-weight: 700; }
          pre { background: #f8fafc; color: #0f172a; border: 1px solid #cbd5e1; padding: 16px; border-radius: 8px; overflow-x: auto; font-size: 11px; white-space: pre-wrap; font-family: monospace; }
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

        <h1>📊 GVB Playbook — 3-Month Financial Report</h1>
        <p style="font-size: 12px; color: #64748b;">Period: <strong>${data.startDateStr}</strong> to <strong>${data.endDateStr}</strong> | Base Currency: <strong>${data.baseCurrency}</strong></p>

        <div class="card" style="margin-bottom: 16px; background: #fff5fa; border-color: #fbcfe8;">
          <div class="card-title" style="color: #db2777;">💵 Predicted Upcoming Income</div>
          <div style="font-size: 14px; font-weight: bold; color: #0f172a; margin-top: 4px;">${data.predictedIncome.formattedText}</div>
        </div>

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
            <div class="card-title">Actual Emergency Saved</div>
            <div class="card-value">${data.fmt(data.actualEmergencySaved)}</div>
          </div>
          <div class="card">
            <div class="card-title">Target Cushion Floor</div>
            <div class="card-value" style="color: #db2777;">${data.fmt(data.emergencyTargetFloor)}</div>
          </div>
        </div>

        <h2>🎯 Upcoming Savings Pools & Goals</h2>
        <table>
          <thead>
            <tr>
              <th>Goal Name</th>
              <th>Current Saved Balance</th>
              <th>Target Amount</th>
              <th>Shortfall</th>
              <th>Target Date</th>
            </tr>
          </thead>
          <tbody>
            ${data.activePools.map(p => `
              <tr>
                <td><strong>${p.name}</strong></td>
                <td>${data.fmt(p.currentSavedBalance)}</td>
                <td>${data.fmt(p.targetAmount)}</td>
                <td>${data.fmt(p.shortfall)}</td>
                <td>${p.targetDate}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>

        <h2>📋 Complete Financial Text Snapshot</h2>
        <pre>${reportText}</pre>

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
