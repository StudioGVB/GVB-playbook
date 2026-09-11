import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCurrency } from '@/lib/financeUtils';
import { STUDENT_LOAN_LABELS, StudentLoanPlan } from '@/lib/ukTakeHome';
import { Scale, Receipt, Info, Shield, Percent } from 'lucide-react';

interface Props {
  takeHome: {
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
  };
  assumptions: any;
}

const gbp = (n: number) => formatCurrency(Math.round(n * 100) / 100, 'GBP');

// UK PAYE threshold constants (matching ukTakeHome.ts)
const PERSONAL_ALLOWANCE = 12570;
const PERSONAL_ALLOWANCE_TAPER_START = 100000;
const BASIC_RATE_LIMIT = 50270;
const HIGHER_RATE_LIMIT = 125140;

const NI_PRIMARY_THRESHOLD = 12570;
const NI_UPPER_EARNINGS_LIMIT = 50270;

const SL_THRESHOLDS: Record<string, number> = {
  plan1: 26065,
  plan2: 28470,
  plan4: 32745,
  plan5: 25000,
  postgrad: 21000,
};

export default function TaxModelTab({ takeHome, assumptions }: Props) {
  const {
    gross,
    pension,
    taxableIncome,
    incomeTax,
    nationalInsurance,
    studentLoan,
    netAnnual,
    effectiveTaxRate,
  } = takeHome;

  // Calculate personal allowance with taper
  const personalAllowance = useMemo(() => {
    let pa = PERSONAL_ALLOWANCE;
    if (taxableIncome > PERSONAL_ALLOWANCE_TAPER_START) {
      const reduction = Math.min(PERSONAL_ALLOWANCE, (taxableIncome - PERSONAL_ALLOWANCE_TAPER_START) / 2);
      pa = Math.max(0, PERSONAL_ALLOWANCE - reduction);
    }
    return pa;
  }, [taxableIncome]);

  // Calculate income in each PAYE band
  const payeBands = useMemo(() => {
    const bands = [
      { name: 'Personal Allowance', rate: '0%', taxRate: 0, min: 0, max: personalAllowance, income: 0, tax: 0 },
      { name: 'Basic Rate', rate: '20%', taxRate: 0.2, min: personalAllowance, max: BASIC_RATE_LIMIT, income: 0, tax: 0 },
      { name: 'Higher Rate', rate: '40%', taxRate: 0.4, min: BASIC_RATE_LIMIT, max: HIGHER_RATE_LIMIT, income: 0, tax: 0 },
      { name: 'Additional Rate', rate: '45%', taxRate: 0.45, min: HIGHER_RATE_LIMIT, max: Infinity, income: 0, tax: 0 },
    ];

    let remaining = taxableIncome;

    return bands.map((band) => {
      if (remaining <= 0) return band;
      
      const bandWidth = band.max - band.min;
      const incomeInBand = Math.max(0, Math.min(taxableIncome, band.max) - band.min);
      
      band.income = incomeInBand;
      band.tax = incomeInBand * band.taxRate;
      
      return band;
    });
  }, [taxableIncome, personalAllowance]);

  // Calculate National Insurance bands
  const niBands = useMemo(() => {
    const primaryLimit = NI_PRIMARY_THRESHOLD;
    const upperLimit = NI_UPPER_EARNINGS_LIMIT;

    const allowanceBand = { name: 'Primary Threshold (Allowance)', rate: '0%', income: Math.min(taxableIncome, primaryLimit), ni: 0 };
    const mainBand = {
      name: 'Main Rate',
      rate: '8%',
      income: Math.max(0, Math.min(taxableIncome, upperLimit) - primaryLimit),
      ni: Math.max(0, Math.min(taxableIncome, upperLimit) - primaryLimit) * 0.08,
    };
    const additionalBand = {
      name: 'Upper Earnings Rate',
      rate: '2%',
      income: Math.max(0, taxableIncome - upperLimit),
      ni: Math.max(0, taxableIncome - upperLimit) * 0.02,
    };

    return [allowanceBand, mainBand, additionalBand];
  }, [taxableIncome]);

  const activePlan = assumptions?.student_loan_plan as StudentLoanPlan;
  const studentLoanDetails = useMemo(() => {
    if (!activePlan) return null;
    const threshold = SL_THRESHOLDS[activePlan as string] || 0;
    const rate = activePlan === 'postgrad' ? 0.06 : 0.09;
    const aboveThreshold = Math.max(0, taxableIncome - threshold);
    return {
      planLabel: STUDENT_LOAN_LABELS[activePlan],
      threshold,
      ratePct: `${rate * 100}%`,
      aboveThreshold,
      repayment: aboveThreshold * rate,
    };
  }, [activePlan, taxableIncome]);

  return (
    <div className="space-y-6">
      {/* Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="border-border/60 bg-gradient-to-br from-purple-50/50 to-white">
          <CardContent className="p-5 flex flex-col justify-between h-full">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Annual Net Take-Home</span>
            <p className="text-3xl font-black tracking-tight text-purple-700 mt-2">{gbp(netAnnual)}</p>
            <span className="text-xs text-muted-foreground mt-1">{gbp(netAnnual / 12)} / month · {gbp(netAnnual / 52)} / week</span>
          </CardContent>
        </Card>
        
        <Card className="border-border/60">
          <CardContent className="p-5 flex flex-col justify-between h-full">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Annual Gross Salary</span>
            <p className="text-3xl font-bold tracking-tight text-slate-800 mt-2">{gbp(gross)}</p>
            <span className="text-xs text-muted-foreground mt-1">Pre-tax annual income</span>
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-gradient-to-br from-emerald-50/30 to-white">
          <CardContent className="p-5 flex flex-col justify-between h-full">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Effective Tax Rate</span>
            <p className="text-3xl font-black tracking-tight text-emerald-600 mt-2">
              {(effectiveTaxRate * 100).toFixed(1)}%
            </p>
            <span className="text-xs text-muted-foreground mt-1">Percentage of gross paid in tax</span>
          </CardContent>
        </Card>
      </div>

      {/* Summary Table */}
      <Card className="border-border/60 overflow-hidden">
        <CardHeader className="bg-slate-50/55 border-b py-4">
          <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
            <Scale className="w-4 h-4 text-purple-500" /> Deduction Summary Table
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/30 text-xs text-muted-foreground uppercase border-b">
                  <th className="py-3 px-4 font-semibold">Category</th>
                  <th className="py-3 px-4 font-semibold text-right">Annual</th>
                  <th className="py-3 px-4 font-semibold text-right">Monthly</th>
                  <th className="py-3 px-4 font-semibold text-right">Weekly</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                <tr className="hover:bg-slate-50/35 transition-colors">
                  <td className="py-3 px-4 font-medium text-slate-800">Gross Salary</td>
                  <td className="py-3 px-4 text-right font-semibold tabular-nums">{gbp(gross)}</td>
                  <td className="py-3 px-4 text-right tabular-nums">{gbp(gross / 12)}</td>
                  <td className="py-3 px-4 text-right tabular-nums">{gbp(gross / 52)}</td>
                </tr>
                {pension > 0 && (
                  <tr className="text-muted-foreground hover:bg-slate-50/35 transition-colors">
                    <td className="py-3 px-4">Pre-tax Pension Contribution</td>
                    <td className="py-3 px-4 text-right text-rose-500 tabular-nums">−{gbp(pension)}</td>
                    <td className="py-3 px-4 text-right text-rose-500/80 tabular-nums">−{gbp(pension / 12)}</td>
                    <td className="py-3 px-4 text-right text-rose-500/80 tabular-nums">−{gbp(pension / 52)}</td>
                  </tr>
                )}
                <tr className="bg-slate-50/20 font-semibold text-slate-700">
                  <td className="py-3 px-4">Taxable Income</td>
                  <td className="py-3 px-4 text-right tabular-nums">{gbp(taxableIncome)}</td>
                  <td className="py-3 px-4 text-right tabular-nums">{gbp(taxableIncome / 12)}</td>
                  <td className="py-3 px-4 text-right tabular-nums">{gbp(taxableIncome / 52)}</td>
                </tr>
                <tr className="text-muted-foreground hover:bg-slate-50/35 transition-colors">
                  <td className="py-3 px-4">Income Tax (PAYE)</td>
                  <td className="py-3 px-4 text-right text-rose-500 tabular-nums">−{gbp(incomeTax)}</td>
                  <td className="py-3 px-4 text-right text-rose-500/80 tabular-nums">−{gbp(incomeTax / 12)}</td>
                  <td className="py-3 px-4 text-right text-rose-500/80 tabular-nums">−{gbp(incomeTax / 52)}</td>
                </tr>
                <tr className="text-muted-foreground hover:bg-slate-50/35 transition-colors">
                  <td className="py-3 px-4">National Insurance (NI)</td>
                  <td className="py-3 px-4 text-right text-rose-500 tabular-nums">−{gbp(nationalInsurance)}</td>
                  <td className="py-3 px-4 text-right text-rose-500/80 tabular-nums">−{gbp(nationalInsurance / 12)}</td>
                  <td className="py-3 px-4 text-right text-rose-500/80 tabular-nums">−{gbp(nationalInsurance / 52)}</td>
                </tr>
                {studentLoan > 0 && (
                  <tr className="text-muted-foreground hover:bg-slate-50/35 transition-colors">
                    <td className="py-3 px-4">Student Loan repayment</td>
                    <td className="py-3 px-4 text-right text-rose-500 tabular-nums">−{gbp(studentLoan)}</td>
                    <td className="py-3 px-4 text-right text-rose-500/80 tabular-nums">−{gbp(studentLoan / 12)}</td>
                    <td className="py-3 px-4 text-right text-rose-500/80 tabular-nums">−{gbp(studentLoan / 52)}</td>
                  </tr>
                )}
                <tr className="bg-purple-50/30 text-base font-black text-purple-700">
                  <td className="py-4 px-4">Net Salary (Take-home)</td>
                  <td className="py-4 px-4 text-right tabular-nums">{gbp(netAnnual)}</td>
                  <td className="py-4 px-4 text-right tabular-nums">{gbp(netAnnual / 12)}</td>
                  <td className="py-4 px-4 text-right tabular-nums">{gbp(netAnnual / 52)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Grid of Calculations Detail */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Income Tax Bands Breakdown */}
        <Card className="border-border/60">
          <CardHeader className="border-b py-4">
            <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
              <Receipt className="w-4 h-4 text-rose-500" /> PAYE Tax Bands Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent className="p-5 space-y-4">
            {taxableIncome > PERSONAL_ALLOWANCE_TAPER_START && (
              <div className="flex gap-2.5 bg-amber-50 border border-amber-200/30 text-amber-800 p-3 rounded-xl text-xs">
                <Info className="w-4 h-4 shrink-0 text-amber-600 mt-0.5" />
                <p>
                  <strong>Personal Allowance Taper Active:</strong> Because your taxable income exceeds £100,000, your Personal Allowance is reduced by £1 for every £2 of income above this limit. Your Personal Allowance is capped at <strong>{gbp(personalAllowance)}</strong> instead of the standard £12,570.
                </p>
              </div>
            )}
            
            <div className="space-y-3">
              {payeBands.map((band) => (
                <div key={band.name} className="p-3.5 bg-slate-50 rounded-2xl border border-slate-100 flex flex-col justify-between gap-1">
                  <div className="flex justify-between items-center">
                    <span className="font-semibold text-slate-800 text-sm">{band.name} ({band.rate})</span>
                    <span className="text-sm font-black text-rose-600">
                      {band.tax > 0 ? `−${gbp(band.tax)}` : '£0.00'}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground mt-0.5">
                    <span>
                      Range: {gbp(band.min)} to {band.max === Infinity ? 'Limitless' : gbp(band.max)}
                    </span>
                    <span>
                      Income in band: <strong className="text-slate-700">{gbp(band.income)}</strong>
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          {/* National Insurance Bands Breakdown */}
          <Card className="border-border/60">
            <CardHeader className="border-b py-4">
              <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                <Percent className="w-4 h-4 text-rose-500" /> National Insurance Breakdown
              </CardTitle>
            </CardHeader>
            <CardContent className="p-5 space-y-3">
              {niBands.map((band) => (
                <div key={band.name} className="p-3.5 bg-slate-50 rounded-2xl border border-slate-100 flex flex-col justify-between gap-1">
                  <div className="flex justify-between items-center">
                    <span className="font-semibold text-slate-800 text-sm">{band.name} ({band.rate})</span>
                    <span className="text-sm font-black text-rose-600">
                      {band.ni > 0 ? `−${gbp(band.ni)}` : '£0.00'}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground mt-0.5">
                    <span>Income in band: <strong className="text-slate-700">{gbp(band.income)}</strong></span>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Student Loan Breakdown */}
          {studentLoanDetails ? (
            <Card className="border-border/60 bg-gradient-to-br from-indigo-50/10 to-white">
              <CardHeader className="border-b py-4">
                <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                  <Shield className="w-4 h-4 text-indigo-500" /> Student Loan ({studentLoanDetails.planLabel})
                </CardTitle>
              </CardHeader>
              <CardContent className="p-5 space-y-3">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-muted-foreground">Annual Threshold limit</span>
                  <span className="font-semibold text-slate-700">{gbp(studentLoanDetails.threshold)}</span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-muted-foreground">Taxable income above threshold</span>
                  <span className="font-semibold text-slate-700">{gbp(studentLoanDetails.aboveThreshold)}</span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-muted-foreground">Repayment rate</span>
                  <span className="font-semibold text-slate-700">{studentLoanDetails.ratePct}</span>
                </div>
                <div className="pt-2 border-t flex justify-between items-center font-bold text-sm">
                  <span className="text-slate-800">Total Deductions</span>
                  <span className="text-rose-600 font-black">−{gbp(studentLoanDetails.repayment)}</span>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card className="border-border/60 border-dashed bg-slate-50/15">
              <CardContent className="p-5 text-center text-xs text-muted-foreground">
                No Student Loan deductions configured. Select a plan in <strong>Salary settings</strong> to model calculations.
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
