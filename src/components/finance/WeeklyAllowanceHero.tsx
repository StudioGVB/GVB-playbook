import { useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { startOfWeek, differenceInDays, endOfWeek } from 'date-fns';
import { computePolicySnapshot } from '@/lib/policyEngine';
import { formatCurrency } from '@/lib/financeUtils';
import type { useFinanceData } from '@/hooks/useFinanceData';
import type { FinanceAssumptions } from '@/hooks/useFinanceAssumptions';
import type { WeeklyBoost } from '@/hooks/useWeeklyBoosts';
import { Wallet, Calendar, TrendingDown, Target, Shield, PiggyBank, Plane, Clock, Zap, X, Gauge, ChevronDown } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

interface Props {
  finance: ReturnType<typeof useFinanceData>;
  assumptions: FinanceAssumptions;
  fixedExpensesMonthly: number;
  boosts?: WeeklyBoost[];
  totalBoost?: number;
  onAddBoost?: (goalId: string, amount: number, note?: string) => Promise<void>;
  onRemoveBoost?: (id: string) => Promise<void>;
}

export default function WeeklyAllowanceHero({ finance, assumptions, fixedExpensesMonthly, boosts = [], totalBoost = 0, onAddBoost, onRemoveBoost }: Props) {
  const { transactions, categories, accounts, goals, convertToBase, settings } = finance;
  const baseCurrency = settings?.base_currency || 'AUD';
  const fmt = (n: number) => formatCurrency(n, baseCurrency);

  const snapshot = useMemo(() =>
    computePolicySnapshot(assumptions, accounts, transactions, categories, goals, convertToBase, fixedExpensesMonthly, totalBoost),
    [assumptions, accounts, transactions, categories, goals, convertToBase, fixedExpensesMonthly, totalBoost]
  );

  const now = new Date();
  const weekStart = startOfWeek(now, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(now, { weekStartsOn: 1 });
  const daysLeft = Math.max(0, differenceInDays(weekEnd, now));
  const dayOfWeek = differenceInDays(now, weekStart) + 1;

  const { weeklyFunBudget, spentThisWeek, remainingWeeklyFun, isDrawdownMode, livingPool, weeksUntilIncome, totalGoalAllocations } = snapshot;
  const percentSpent = weeklyFunBudget > 0 ? Math.min((spentThisWeek / weeklyFunBudget) * 100, 100) : 0;
  const dailyPace = daysLeft > 0 ? remainingWeeklyFun / daysLeft : remainingWeeklyFun;

  // Health status
  const status = percentSpent >= 90 ? 'danger' : percentSpent >= 70 ? 'warning' : 'healthy';
  const statusColors = {
    healthy: { text: 'text-emerald-500', bar: 'bg-emerald-500', ring: 'ring-emerald-500/20', bg: 'bg-emerald-500/5' },
    warning: { text: 'text-amber-500', bar: 'bg-amber-500', ring: 'ring-amber-500/20', bg: 'bg-amber-500/5' },
    danger: { text: 'text-amber-600', bar: 'bg-amber-500', ring: 'ring-amber-500/20', bg: 'bg-amber-500/5' },
  }[status];

  // Drawdown KPIs
  const dailyRate = dayOfWeek > 0 ? spentThisWeek / dayOfWeek : 0;
  const projectedWeekly = dailyRate * 7;
  const runwayWeeks = isDrawdownMode && dailyRate > 0 ? livingPool / (dailyRate * 7) : weeksUntilIncome;

  // Category weekly targets
  const categoryTargets = useMemo(() => {
    const catsWithTargets = categories.filter(c => c.weekly_target && c.weekly_target > 0);
    if (catsWithTargets.length === 0) return [];
    return catsWithTargets.map(cat => {
      const spent = transactions
        .filter(tx => {
          if (tx.amount >= 0 || tx.is_transfer || tx.is_reimbursable) return false;
          if (tx.category_id !== cat.id) return false;
          return new Date(tx.posted_at) >= weekStart;
        })
        .reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
      return { name: cat.name, color: cat.color, spent, target: cat.weekly_target!, id: cat.id };
    });
  }, [categories, transactions, weekStart]);

  return (
    <div className="space-y-4">
      {/* Hero Card */}
      <Card className={`border-2 ${statusColors.ring} ${statusColors.bg} overflow-hidden`}>
        <CardContent className="p-0">
          {/* Drawdown badge */}
          {isDrawdownMode && (
            <div className="bg-amber-500/10 px-4 py-2 flex items-center justify-center gap-2 text-xs font-semibold text-amber-600 border-b border-amber-500/10">
              <Clock className="w-3.5 h-3.5" />
              Drawdown Mode · {Math.round(snapshot.runwayWeeks)} weeks runway
            </div>
          )}

          <div className="p-6 pb-5">
            {/* Main number */}
            <div className="text-center mb-5">
              <p className="text-[11px] uppercase tracking-[0.15em] text-muted-foreground font-semibold mb-2">
                Weekly Discretionary Budget
              </p>
              <p className={`text-5xl font-black tabular-nums tracking-tight ${statusColors.text}`}>
                {fmt(remainingWeeklyFun)}
              </p>
              <p className="text-xs text-muted-foreground mt-1.5">
                {fmt(spentThisWeek)} spent of {fmt(weeklyFunBudget)} budget
              </p>
            </div>

            {/* Progress bar */}
            <div className="space-y-1">
              <div className="h-2.5 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${statusColors.bar}`}
                  style={{ width: `${percentSpent}%` }}
                />
              </div>
              <div className="flex justify-between text-[10px] text-muted-foreground tabular-nums">
                <span>Day {dayOfWeek}/7</span>
                <span>{daysLeft} day{daysLeft !== 1 ? 's' : ''} left</span>
              </div>
            </div>

            {/* Budget breakdown */}
            <Collapsible className="mt-4">
              <CollapsibleTrigger className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors group w-full">
                <ChevronDown className="w-3 h-3 transition-transform group-data-[state=open]:rotate-180" />
                <span className="font-medium">How this is calculated</span>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-3">
                <div className="rounded-lg border border-border/50 bg-muted/30 p-3 space-y-1.5 text-xs tabular-nums">
                  {isDrawdownMode ? (
                    <>
                      <BreakdownRow label="Total Cash" value={fmt(snapshot.totalLiquidCash)} />
                      <BreakdownRow label="Emergency Reserve" value={fmt(snapshot.emergencyFloor)} prefix="−" muted />
                      {snapshot.totalGoalAllocations > 0 && (
                        <BreakdownRow label="Goal Savings" value={fmt(snapshot.totalGoalAllocations)} prefix="−" muted />
                      )}
                      <div className="border-t border-border/50 my-1.5" />
                      <BreakdownRow label="Living Pool" value={fmt(snapshot.livingPool)} bold />
                      <div className="border-t border-border/50 my-1.5" />
                      <BreakdownRow label="Weekly Burn" value={fmt(snapshot.weeklyGross)} bold />
                      <BreakdownRow label="Fixed Costs / wk" value={fmt(fixedExpensesMonthly / 4.33)} muted />
                      <BreakdownRow label="Essentials / wk" value={fmt(snapshot.weeklyEssentialBudget)} muted />
                      <BreakdownRow label="Fun Money / wk" value={fmt(weeklyFunBudget - totalBoost)} muted />
                      <div className="border-t border-border/50 my-1.5" />
                      <BreakdownRow label="Runway" value={`${Math.round(snapshot.runwayWeeks)} weeks`} bold />
                      {totalBoost > 0 && (
                        <BreakdownRow label="Boosts" value={fmt(totalBoost)} prefix="+" accent />
                      )}
                    </>
                  ) : (
                    <>
                      <BreakdownRow label="Monthly Income" value={fmt(snapshot.split.monthlyIncome)} />
                      <BreakdownRow label={`Fixed Bills (${snapshot.split.mandatoryPercent.toFixed(0)}%)`} value={fmt(snapshot.split.mandatoryAmount)} prefix="−" muted />
                      <BreakdownRow label={`Base Savings (${snapshot.split.baseSavingsPercent.toFixed(0)}%)`} value={fmt(snapshot.split.baseSavingsAmount)} prefix="−" muted />
                      {snapshot.split.goalSavingsAmount > 0 && (
                        <BreakdownRow label={`Goal Savings (${snapshot.split.goalSavingsPercent.toFixed(0)}%)`} value={fmt(snapshot.split.goalSavingsAmount)} prefix="−" muted />
                      )}
                      <div className="border-t border-border/50 my-1.5" />
                      <BreakdownRow label={`Fun Money / mo (${snapshot.split.funPercent.toFixed(0)}%)`} value={fmt(snapshot.split.funAmount)} bold />
                      <BreakdownRow label="÷ 4.33 weeks" value="" muted />
                      <div className="border-t border-border/50 my-1.5" />
                      <BreakdownRow label="Weekly Budget" value={fmt(weeklyFunBudget - totalBoost)} bold accent />
                      {totalBoost > 0 && (
                        <BreakdownRow label="Boosts" value={fmt(totalBoost)} prefix="+" accent />
                      )}
                    </>
                  )}
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>

          {/* KPI Strip */}
          <div className="grid grid-cols-3 border-t border-border/50 divide-x divide-border/50">
            <KPICell
              label="Daily Pace"
              value={fmt(dailyPace)}
              icon={<TrendingDown className="w-3.5 h-3.5" />}
              status={dailyPace < 0 ? 'danger' : undefined}
            />
            <KPICell
              label="Spent Today"
              value={fmt(dailyRate)}
              icon={<Wallet className="w-3.5 h-3.5" />}
              subtext="avg/day"
            />
            {isDrawdownMode ? (
              <KPICell
                label="Runway"
                value={`${Math.round(runwayWeeks)}w`}
                icon={<Shield className="w-3.5 h-3.5" />}
                status={runwayWeeks < weeksUntilIncome * 0.8 ? 'danger' : runwayWeeks < weeksUntilIncome ? 'warning' : 'healthy'}
              />
            ) : (
              <KPICell
                label="On Track"
                value={percentSpent <= (dayOfWeek / 7) * 100 + 5 ? '✓' : '✗'}
                icon={<Gauge className="w-3.5 h-3.5" />}
                status={percentSpent <= (dayOfWeek / 7) * 100 + 5 ? 'healthy' : 'danger'}
              />
            )}
          </div>
        </CardContent>
      </Card>

      {/* Active boosts */}
      {boosts.length > 0 && (
        <Card>
          <CardContent className="p-4 space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Active Boosts</p>
            {boosts.map(b => {
              const goalName = goals.find(g => g.id === b.goal_id)?.name || 'Unknown';
              return (
                <div key={b.id} className="flex items-center justify-between text-sm bg-[#FF2EB8]/5 border border-[#FF2EB8]/15 rounded-lg px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Zap className="w-3.5 h-3.5 text-[#FF2EB8]" />
                    <span className="font-semibold text-[#FF2EB8]">+{fmt(b.amount)}</span>
                    <span className="text-muted-foreground text-xs">from {goalName}</span>
                  </div>
                  {onRemoveBoost && (
                    <button onClick={() => onRemoveBoost(b.id)} className="p-1 rounded-md hover:bg-muted">
                      <X className="w-3 h-3 text-muted-foreground" />
                    </button>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Boost button */}
      {onAddBoost && goals.length > 0 && (
        <BoostDialog goals={goals} fmt={fmt} onAddBoost={onAddBoost} />
      )}

      {/* Category targets */}
      {categoryTargets.length > 0 && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Category Targets</p>
            {categoryTargets.map(cat => {
              const catPercent = Math.min((cat.spent / cat.target) * 100, 100);
              const over = cat.spent > cat.target;
              return (
                <div key={cat.id} className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="font-medium flex items-center gap-1.5">
                      {cat.color && <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: cat.color }} />}
                      {cat.name}
                    </span>
                    <span className={over ? 'text-destructive font-semibold' : 'text-muted-foreground'}>
                      {fmt(cat.spent)} / {fmt(cat.target)}
                    </span>
                  </div>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${over ? 'bg-destructive' : 'bg-[#FF2EB8]/60'}`}
                      style={{ width: `${catPercent}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function KPICell({ label, value, icon, subtext, status }: {
  label: string;
  value: string;
  icon: React.ReactNode;
  subtext?: string;
  status?: 'healthy' | 'warning' | 'danger';
}) {
  const textColor = status === 'danger' ? 'text-destructive' : status === 'warning' ? 'text-amber-500' : status === 'healthy' ? 'text-emerald-500' : 'text-foreground';
  return (
    <div className="px-4 py-3 text-center">
      <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
        {icon}
        <span className="text-[10px] uppercase tracking-wider font-medium">{label}</span>
      </div>
      <p className={`text-base font-bold tabular-nums ${textColor}`}>{value}</p>
      {subtext && <p className="text-[10px] text-muted-foreground">{subtext}</p>}
    </div>
  );
}

function BreakdownRow({ label, value, prefix, muted, bold, accent }: {
  label: string;
  value: string;
  prefix?: string;
  muted?: boolean;
  bold?: boolean;
  accent?: boolean;
}) {
  return (
    <div className={`flex justify-between items-center ${bold ? 'font-semibold' : ''} ${muted ? 'text-muted-foreground' : ''}`}>
      <span>{prefix ? `${prefix} ` : ''}{label}</span>
      {value && (
        <span className={accent ? 'text-primary font-bold' : ''}>
          {prefix && value ? `${prefix}${value}` : value}
        </span>
      )}
    </div>
  );
}

function BoostDialog({ goals, fmt, onAddBoost }: {
  goals: ReturnType<typeof import('@/hooks/useFinanceData').useFinanceData>['goals'];
  fmt: (n: number) => string;
  onAddBoost: (goalId: string, amount: number, note?: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [selectedGoal, setSelectedGoal] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');

  const goalsWithFunds = goals.filter(g => (g as any).assigned_amount > 0);

  const handleSubmit = async () => {
    const amt = parseFloat(amount);
    if (!selectedGoal || isNaN(amt) || amt <= 0) return;
    const goal = goals.find(g => g.id === selectedGoal);
    if (goal && amt > (goal as any).assigned_amount) return;
    await onAddBoost(selectedGoal, amt, note || undefined);
    setOpen(false);
    setAmount('');
    setNote('');
    setSelectedGoal('');
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="w-full border-dashed gap-1.5">
          <Zap className="w-3.5 h-3.5" /> Boost This Week from a Goal
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Boost This Week's Budget</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <p className="text-sm text-muted-foreground">
            Pull extra money from a savings goal into this week's spending budget.
          </p>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">From Goal</label>
            <Select value={selectedGoal} onValueChange={setSelectedGoal}>
              <SelectTrigger><SelectValue placeholder="Select a goal" /></SelectTrigger>
              <SelectContent>
                {goalsWithFunds.length > 0 ? goalsWithFunds.map(g => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.name} ({fmt((g as any).assigned_amount)} available)
                  </SelectItem>
                )) : goals.map(g => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Amount</label>
            <Input
              type="number"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="e.g. 800"
            />
            {selectedGoal && (() => {
              const g = goals.find(gl => gl.id === selectedGoal);
              return g ? (
                <p className="text-xs text-muted-foreground">
                  Available: {fmt((g as any).assigned_amount)} · Remaining after: {fmt(Math.max(0, (g as any).assigned_amount - (parseFloat(amount) || 0)))}
                </p>
              ) : null;
            })()}
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Note (optional)</label>
            <Input
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="e.g. Room setup essentials"
            />
          </div>
          <Button onClick={handleSubmit} className="w-full" disabled={!selectedGoal || !amount}>
            Boost by {amount ? fmt(parseFloat(amount) || 0) : '...'} this week
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
