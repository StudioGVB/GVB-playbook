// UK PAYE take-home calculator (2025/26 tax year, England/Wales/NI bands)
// Pure function — no side effects.

export type StudentLoanPlan = 'plan1' | 'plan2' | 'plan4' | 'plan5' | 'postgrad' | null;

export interface TakeHomeInputs {
  grossAnnual: number;
  pensionPercent?: number; // pre-tax pension contribution, % of gross
  studentLoanPlan?: StudentLoanPlan;
}

export interface TakeHomeBreakdown {
  gross: number;
  pension: number;
  taxableIncome: number;
  incomeTax: number;
  nationalInsurance: number;
  studentLoan: number;
  netAnnual: number;
  netMonthly: number;
  netWeekly: number;
  effectiveTaxRate: number;
}

// 2025/26 thresholds (annual)
const PERSONAL_ALLOWANCE = 12570;
const PERSONAL_ALLOWANCE_TAPER_START = 100000;
const BASIC_RATE_LIMIT = 50270; // gross where 40% band starts
const HIGHER_RATE_LIMIT = 125140; // gross where 45% band starts

// NI (Class 1, employee): 8% between primary threshold and upper earnings limit, 2% above
const NI_PRIMARY_THRESHOLD = 12570;
const NI_UPPER_EARNINGS_LIMIT = 50270;

// Student loan thresholds (annual) and rate
const SL_THRESHOLDS: Record<Exclude<StudentLoanPlan, null>, number> = {
  plan1: 26065,
  plan2: 28470,
  plan4: 32745,
  plan5: 25000,
  postgrad: 21000,
};
const SL_RATE_UNDERGRAD = 0.09;
const SL_RATE_POSTGRAD = 0.06;

function calcIncomeTax(taxable: number): number {
  if (taxable <= 0) return 0;
  // Personal allowance taper: reduces by £1 for every £2 over £100k
  let pa = PERSONAL_ALLOWANCE;
  if (taxable > PERSONAL_ALLOWANCE_TAPER_START) {
    const reduction = Math.min(PERSONAL_ALLOWANCE, (taxable - PERSONAL_ALLOWANCE_TAPER_START) / 2);
    pa = Math.max(0, PERSONAL_ALLOWANCE - reduction);
  }
  const afterPa = Math.max(0, taxable - pa);

  const basicBand = Math.max(0, BASIC_RATE_LIMIT - PERSONAL_ALLOWANCE); // 37,700
  const higherBand = Math.max(0, HIGHER_RATE_LIMIT - BASIC_RATE_LIMIT); // 74,870

  let tax = 0;
  const inBasic = Math.min(afterPa, basicBand);
  tax += inBasic * 0.2;
  const inHigher = Math.min(Math.max(0, afterPa - basicBand), higherBand);
  tax += inHigher * 0.4;
  const inAdditional = Math.max(0, afterPa - basicBand - higherBand);
  tax += inAdditional * 0.45;

  return tax;
}

function calcNI(gross: number): number {
  if (gross <= NI_PRIMARY_THRESHOLD) return 0;
  const inMain = Math.min(gross, NI_UPPER_EARNINGS_LIMIT) - NI_PRIMARY_THRESHOLD;
  const above = Math.max(0, gross - NI_UPPER_EARNINGS_LIMIT);
  return inMain * 0.08 + above * 0.02;
}

function calcStudentLoan(gross: number, plan: StudentLoanPlan): number {
  if (!plan) return 0;
  const threshold = SL_THRESHOLDS[plan];
  if (gross <= threshold) return 0;
  const rate = plan === 'postgrad' ? SL_RATE_POSTGRAD : SL_RATE_UNDERGRAD;
  return (gross - threshold) * rate;
}

export function calcTakeHome({
  grossAnnual,
  pensionPercent = 0,
  studentLoanPlan = null,
}: TakeHomeInputs): TakeHomeBreakdown {
  const gross = Math.max(0, grossAnnual || 0);
  const pension = gross * (Math.max(0, pensionPercent) / 100);
  const taxable = Math.max(0, gross - pension);

  const incomeTax = calcIncomeTax(taxable);
  const nationalInsurance = calcNI(taxable);
  const studentLoan = calcStudentLoan(taxable, studentLoanPlan);

  const netAnnual = taxable - incomeTax - nationalInsurance - studentLoan;
  const netMonthly = netAnnual / 12;
  const netWeekly = netAnnual / 52;
  const effectiveTaxRate = gross > 0 ? (gross - netAnnual) / gross : 0;

  return {
    gross,
    pension,
    taxableIncome: taxable,
    incomeTax,
    nationalInsurance,
    studentLoan,
    netAnnual,
    netMonthly,
    netWeekly,
    effectiveTaxRate,
  };
}

export const STUDENT_LOAN_LABELS: Record<Exclude<StudentLoanPlan, null>, string> = {
  plan1: 'Plan 1',
  plan2: 'Plan 2',
  plan4: 'Plan 4 (Scotland)',
  plan5: 'Plan 5',
  postgrad: 'Postgrad Loan',
};
