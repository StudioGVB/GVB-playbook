import { useMemo, useState, useEffect } from 'react';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { RotateCcw, TrendingUp, TrendingDown, ShoppingBag, PiggyBank, Home, Calendar as CalendarIcon, Zap, Target, CheckCircle2, AlertTriangle } from 'lucide-react';
import { calcTakeHome, StudentLoanPlan } from '@/lib/ukTakeHome';
import { formatCurrency } from '@/lib/financeUtils';
import { format, differenceInDays, addMonths } from 'date-fns';
import { cn } from '@/lib/utils';

const gbp = (n: number) => formatCurrency(n, 'GBP');

interface Baseline {
  grossAnnual: number;
  pensionPercent: number;
  studentLoanPlan: StudentLoanPlan;
  rentMonthly: number;
  otherBillsMonthly: number;
  weeklyFun: number;
  weeklyEssentials: number;
  savingsTarget: number;
  bigPurchase: number;
  sideIncomeMonthly: number;
  liquidCash: number;
  emergencyFloor: number;
}

interface Props {
  baseline: Baseline;
  currentSavingsPerMonth: number; // reality baseline for comparison
  currentRunwayWeeks: number;
}

function SliderRow({
  label, icon: Icon, value, setValue, min, max, step, format = gbp, suffix, baseline,
}: {
  label: string; icon?: any; value: number; setValue: (n: number) => void;
  min: number; max: number; step: number; format?: (n: number) => string; suffix?: string;
  baseline?: number;
}) {
  const baselinePct = baseline != null && max > min
    ? Math.max(0, Math.min(100, ((baseline - min) / (max - min)) * 100))
    : null;
  const delta = baseline != null ? value - baseline : 0;
  const changed = baseline != null && Math.abs(delta) > step / 2;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-sm flex items-center gap-1.5">
          {Icon && <Icon className="w-3.5 h-3.5 text-muted-foreground" />}
          {label}
        </Label>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            value={value}
            onChange={(e) => setValue(Number(e.target.value) || 0)}
            className="w-24 h-8 text-right text-sm"
          />
          {suffix && <span className="text-xs text-muted-foreground w-6">{suffix}</span>}
        </div>
      </div>
      <div className="relative pt-1">
        <Slider
          value={[value]}
          onValueChange={([v]) => setValue(v)}
          min={min}
          max={max}
          step={step}
        />
        {baselinePct != null && (
          <div
            className="pointer-events-none absolute top-1/2 -translate-y-1/2 -translate-x-1/2 z-10"
            style={{ left: `${baselinePct}%` }}
            title={`Real: ${format(baseline!)}`}
          >
            <div className="w-[3px] h-5 bg-foreground rounded-full ring-2 ring-background" />
          </div>
        )}
      </div>
      <div className="flex justify-between items-center text-[10px] text-muted-foreground">
        <span>{format(min)}</span>
        {baseline != null ? (
          <button
            type="button"
            onClick={() => setValue(baseline)}
            className="tabular-nums hover:text-foreground underline-offset-2 hover:underline"
          >
            Real: {format(baseline)}
            {changed && (
              <span className={delta > 0 ? 'text-rose-600 ml-1' : 'text-emerald-600 ml-1'}>
                ({delta > 0 ? '+' : ''}{format(delta)})
              </span>
            )}
          </button>
        ) : <span />}
        <span>{format(max)}</span>
      </div>
    </div>
  );
}

function Stat({
  label, value, sub, delta, tone = 'neutral',
}: {
  label: string; value: string; sub?: string;
  delta?: { value: number; better: 'higher' | 'lower' };
  tone?: 'neutral' | 'good' | 'bad';
}) {
  const toneClass = { neutral: 'text-foreground', good: 'text-emerald-600', bad: 'text-rose-600' }[tone];
  let deltaEl = null;
  if (delta && Math.abs(delta.value) > 0.01) {
    const isGood = (delta.better === 'higher' && delta.value > 0) || (delta.better === 'lower' && delta.value < 0);
    const Arrow = delta.value > 0 ? TrendingUp : TrendingDown;
    deltaEl = (
      <span className={`text-xs inline-flex items-center gap-0.5 ${isGood ? 'text-emerald-600' : 'text-rose-600'}`}>
        <Arrow className="w-3 h-3" />
        {delta.value > 0 ? '+' : ''}{gbp(delta.value)}
      </span>
    );
  }
  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">{label}</div>
      <div className={`text-xl font-black leading-tight mt-1 ${toneClass}`}>{value}</div>
      <div className="flex items-center justify-between mt-1">
        {sub && <span className="text-[11px] text-muted-foreground">{sub}</span>}
        {deltaEl}
      </div>
    </div>
  );
}

export default function WhatIfSimulator({ baseline, currentSavingsPerMonth, currentRunwayWeeks }: Props) {
  const [gross, setGross] = useState(baseline.grossAnnual);
  const [pension, setPension] = useState(baseline.pensionPercent);
  const [rent, setRent] = useState(baseline.rentMonthly);
  const [otherBills, setOtherBills] = useState(baseline.otherBillsMonthly);
  const [weeklyFun, setWeeklyFun] = useState(baseline.weeklyFun);
  const [weeklyEssentials, setWeeklyEssentials] = useState(baseline.weeklyEssentials);
  const [savingsTarget, setSavingsTarget] = useState(baseline.savingsTarget);
  const [bigPurchase, setBigPurchase] = useState(baseline.bigPurchase);
  const [sideIncome, setSideIncome] = useState(baseline.sideIncomeMonthly);
  const [includeEmergency, setIncludeEmergency] = useState(true);
  const [goalAmount, setGoalAmount] = useState<number>(baseline.savingsTarget || 2000);
  const [goalDate, setGoalDate] = useState<Date>(addMonths(new Date(), 6));

  useEffect(() => {
    // Only reset if baseline changes materially (e.g. real data loaded late)
    setGross(baseline.grossAnnual);
    setRent(baseline.rentMonthly);
    setOtherBills(baseline.otherBillsMonthly);
    setWeeklyFun(baseline.weeklyFun);
    setWeeklyEssentials(baseline.weeklyEssentials);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseline.grossAnnual, baseline.rentMonthly]);

  const reset = () => {
    setGross(baseline.grossAnnual);
    setPension(baseline.pensionPercent);
    setRent(baseline.rentMonthly);
    setOtherBills(baseline.otherBillsMonthly);
    setWeeklyFun(baseline.weeklyFun);
    setWeeklyEssentials(baseline.weeklyEssentials);
    setSavingsTarget(baseline.savingsTarget);
    setBigPurchase(baseline.bigPurchase);
    setSideIncome(baseline.sideIncomeMonthly);
  };

  const derived = useMemo(() => {
    const th = calcTakeHome({
      grossAnnual: gross,
      pensionPercent: pension,
      studentLoanPlan: baseline.studentLoanPlan,
    });
    const netMo = th.netMonthly + sideIncome;
    const billsMo = rent + otherBills;
    const funMo = weeklyFun * 4.33;
    const essMo = weeklyEssentials * 4.33;
    const totalOutMo = billsMo + funMo + essMo;
    const disposableMo = netMo - billsMo;
    const surplusMo = netMo - totalOutMo;
    const savingsRate = netMo > 0 ? surplusMo / netMo : 0;

    // Months to hit savings target with current surplus
    const monthsToTarget = surplusMo > 0 ? savingsTarget / surplusMo : Infinity;

    // Weeks to afford big purchase from surplus only (leave emergency alone)
    const weeklySurplus = surplusMo / 4.33;
    const weeksToBigPurchase = weeklySurplus > 0 ? bigPurchase / weeklySurplus : Infinity;

    // Runway under this scenario: liquid cash / burn per week
    // burn = bills + essentials + fun (weekly)
    const weeklyBurn = totalOutMo / 4.33;
    const runwayCash = includeEmergency
      ? baseline.liquidCash
      : Math.max(0, baseline.liquidCash - baseline.emergencyFloor);
    const runwayWeeks = weeklyBurn > 0 ? runwayCash / weeklyBurn : Infinity;

    // Break-even gross: what salary makes surplus = 0 (holding pension % fixed)?
    // Solve iteratively — small brute force is fine
    let breakEven = 0;
    if (totalOutMo > 0 && sideIncome < totalOutMo) {
      let lo = 0, hi = 300000;
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        const midNet = calcTakeHome({
          grossAnnual: mid,
          pensionPercent: pension,
          studentLoanPlan: baseline.studentLoanPlan,
        }).netMonthly + sideIncome;
        if (midNet >= totalOutMo) hi = mid; else lo = mid;
      }
      breakEven = hi;
    }

    return {
      th, netMo, billsMo, funMo, essMo, disposableMo, surplusMo, savingsRate,
      monthsToTarget, weeksToBigPurchase, runwayWeeks, breakEven, weeklyBurn,
    };
  }, [gross, pension, rent, otherBills, weeklyFun, weeklyEssentials, savingsTarget,
      bigPurchase, sideIncome, includeEmergency, baseline]);

  const segs = [
    { label: 'Bills', value: derived.billsMo, color: 'bg-rose-500' },
    { label: 'Essentials', value: derived.essMo, color: 'bg-violet-500' },
    { label: 'Fun', value: derived.funMo, color: 'bg-emerald-500' },
    { label: 'Surplus', value: Math.max(0, derived.surplusMo), color: 'bg-sky-500' },
  ];
  const segTotal = segs.reduce((s, x) => s + x.value, 0) || 1;

  const surplusDelta = derived.surplusMo - currentSavingsPerMonth;
  const runwayDelta = derived.runwayWeeks - currentRunwayWeeks;

  const canAffordBigPurchase = bigPurchase > 0 && bigPurchase <= (baseline.liquidCash - baseline.emergencyFloor);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2"><Zap className="w-5 h-5 text-amber-500" /> What-if playground</h2>
          <p className="text-xs text-muted-foreground">Drag anything. All numbers recalc live. Nothing saved.</p>
        </div>
        <Button variant="outline" size="sm" onClick={reset}>
          <RotateCcw className="w-3.5 h-3.5 mr-1.5" /> Reset to real
        </Button>
      </div>

      {/* LIVE OUTPUTS */}
      <div>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium mb-2">Scenario result</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Take-home /mo" value={gbp(derived.netMo)} sub={`${gbp(derived.th.netAnnual)}/yr`} />
          <Stat label="Monthly surplus" value={gbp(derived.surplusMo)}
            tone={derived.surplusMo >= 0 ? 'good' : 'bad'}
            sub={`${(derived.savingsRate * 100).toFixed(0)}% savings rate`}
            delta={{ value: surplusDelta, better: 'higher' }} />
          <Stat label="Runway" value={`${(derived.runwayWeeks / 4.33).toFixed(1)}mo`}
            sub={`${derived.runwayWeeks.toFixed(1)} weeks`}
            delta={{ value: runwayDelta, better: 'higher' }} />
          <Stat label="Break-even salary" value={gbp(derived.breakEven)}
            sub="min gross to sustain" />
        </div>
      </div>

      {/* WATERFALL */}
      <div className="rounded-xl border bg-card p-4">
        <div className="flex h-3 rounded-full overflow-hidden bg-muted mb-3">
          {segs.map(s => (
            <div key={s.label} className={s.color} style={{ width: `${(s.value / segTotal) * 100}%` }} />
          ))}
        </div>
        <div className="grid grid-cols-4 gap-2 text-xs">
          {segs.map(s => (
            <div key={s.label}>
              <div className="flex items-center gap-1.5">
                <div className={`w-2 h-2 rounded-full ${s.color}`} />
                <span className="text-muted-foreground">{s.label}</span>
              </div>
              <div className="font-semibold mt-0.5">{gbp(s.value)}</div>
              <div className="text-[10px] text-muted-foreground">{((s.value / segTotal) * 100).toFixed(0)}%</div>
            </div>
          ))}
        </div>
      </div>

      {/* GOAL BY DATE */}
      {(() => {
        const daysUntil = Math.max(1, differenceInDays(goalDate, new Date()));
        const monthsUntil = daysUntil / 30.44;
        const requiredPerMonth = goalAmount / monthsUntil;
        const requiredPerWeek = goalAmount / (daysUntil / 7);
        const shortfallPerMonth = requiredPerMonth - derived.surplusMo;
        const canAfford = derived.surplusMo >= requiredPerMonth;
        const projectedByDate = derived.surplusMo * monthsUntil;
        const pct = Math.min(100, Math.max(0, (projectedByDate / goalAmount) * 100));
        return (
          <div className="rounded-xl border bg-card p-4 space-y-4">
            <div className="flex items-center gap-2">
              <Target className="w-4 h-4 text-amber-500" />
              <h3 className="text-sm font-bold">Can I afford it by then?</h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground">Amount needed</Label>
                <Input type="number" value={goalAmount}
                  onChange={(e) => setGoalAmount(parseFloat(e.target.value) || 0)}
                  className="mt-1 font-semibold" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">By when</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full mt-1 justify-start font-normal">
                      <CalendarIcon className="w-4 h-4 mr-2" />
                      {format(goalDate, 'PPP')}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={goalDate}
                      onSelect={(d) => d && setGoalDate(d)}
                      disabled={(d) => d < new Date()}
                      initialFocus className={cn('p-3 pointer-events-auto')} />
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            <div className={`rounded-lg p-3 ${canAfford ? 'bg-emerald-50 dark:bg-emerald-950/30' : 'bg-rose-50 dark:bg-rose-950/30'}`}>
              <div className="flex items-start gap-2">
                {canAfford
                  ? <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                  : <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />}
                <div className="flex-1">
                  <div className={`text-lg font-black ${canAfford ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'}`}>
                    {canAfford
                      ? `Yes — you'll have ${gbp(projectedByDate)} by ${format(goalDate, 'MMM d')}`
                      : `Short by ${gbp(Math.max(0, goalAmount - projectedByDate))}`}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {daysUntil} days · needs {gbp(requiredPerMonth)}/mo ({gbp(requiredPerWeek)}/wk).
                    {' '}You're saving {gbp(derived.surplusMo)}/mo.
                  </div>
                </div>
              </div>

              {/* Progress bar */}
              <div className="mt-3">
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div className={`h-full ${canAfford ? 'bg-emerald-500' : 'bg-rose-500'}`}
                    style={{ width: `${pct}%` }} />
                </div>
                <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                  <span>Projected {gbp(projectedByDate)}</span>
                  <span>Goal {gbp(goalAmount)}</span>
                </div>
              </div>

              {!canAfford && (
                <div className="mt-3 text-xs text-rose-700 dark:text-rose-400 border-t border-rose-200 dark:border-rose-900 pt-2">
                  To hit it, free up <span className="font-bold">{gbp(shortfallPerMonth)}/mo</span> ({gbp(shortfallPerMonth / 4.33)}/wk) — try dragging the sliders below.
                </div>
              )}
            </div>

            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="rounded-lg border p-2">
                <div className="text-muted-foreground text-[10px] uppercase">Need /mo</div>
                <div className="font-bold">{gbp(requiredPerMonth)}</div>
              </div>
              <div className="rounded-lg border p-2">
                <div className="text-muted-foreground text-[10px] uppercase">Saving /mo</div>
                <div className="font-bold">{gbp(derived.surplusMo)}</div>
              </div>
              <div className="rounded-lg border p-2">
                <div className="text-muted-foreground text-[10px] uppercase">Gap /mo</div>
                <div className={`font-bold ${shortfallPerMonth <= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {shortfallPerMonth <= 0 ? '—' : gbp(shortfallPerMonth)}
                </div>
              </div>
            </div>
          </div>
        );
      })()}


      {/* SLIDER PANEL */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-5">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">Income</div>
          <SliderRow label="Gross salary /yr" value={gross} setValue={setGross} min={0} max={120000} step={500} baseline={baseline.grossAnnual} />
          <SliderRow label="Pension %" value={pension} setValue={setPension} min={0} max={20} step={0.5} format={n => `${n}%`} suffix="%" baseline={baseline.pensionPercent} />
          <SliderRow label="Side income /mo" value={sideIncome} setValue={setSideIncome} min={0} max={5000} step={50} baseline={baseline.sideIncomeMonthly} />
        </div>

        <div className="space-y-5">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">Outflows</div>
          <SliderRow label="Rent /mo" icon={Home} value={rent} setValue={setRent} min={0} max={3000} step={25} baseline={baseline.rentMonthly} />
          <SliderRow label="Other bills /mo" value={otherBills} setValue={setOtherBills} min={0} max={2000} step={10} baseline={baseline.otherBillsMonthly} />
          <SliderRow label="Weekly essentials" value={weeklyEssentials} setValue={setWeeklyEssentials} min={0} max={400} step={5} baseline={baseline.weeklyEssentials} />
          <SliderRow label="Weekly fun" value={weeklyFun} setValue={setWeeklyFun} min={0} max={400} step={5} baseline={baseline.weeklyFun} />
        </div>

        <div className="space-y-5">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">Goals</div>
          <SliderRow label="Savings target" icon={PiggyBank} value={savingsTarget} setValue={setSavingsTarget} min={0} max={20000} step={100} baseline={baseline.savingsTarget} />
          <SliderRow label="Big purchase" icon={ShoppingBag} value={bigPurchase} setValue={setBigPurchase} min={0} max={10000} step={50} baseline={baseline.bigPurchase} />
        </div>

        <div className="space-y-4">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">Assumptions</div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <div className="text-sm font-medium">Include emergency in runway</div>
              <div className="text-xs text-muted-foreground">
                Off = runway only from cash above the {gbp(baseline.emergencyFloor)} floor
              </div>
            </div>
            <Switch checked={includeEmergency} onCheckedChange={setIncludeEmergency} />
          </div>
          <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
            <div className="flex justify-between"><span>Weekly burn</span><span className="font-mono">{gbp(derived.weeklyBurn)}</span></div>
            <div className="flex justify-between"><span>Liquid cash</span><span className="font-mono">{gbp(baseline.liquidCash)}</span></div>
            <div className="flex justify-between"><span>Emergency floor</span><span className="font-mono">{gbp(baseline.emergencyFloor)}</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}
