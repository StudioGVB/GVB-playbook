import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Plus, Target, Trash2, Info, TrendingDown, Zap } from 'lucide-react';
import { formatCurrency, computeWeeklyCategoryStats, computeMonthlyStats, generateGoalPlan } from '@/lib/financeUtils';
import type { useFinanceData } from '@/hooks/useFinanceData';

type Props = { finance: ReturnType<typeof useFinanceData> };

export default function FinanceGoals({ finance }: Props) {
  const { goals, goalPlans, transactions, categories, settings, addGoal, deleteGoal, saveGoalPlan } = finance;
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState(settings?.base_currency || 'AUD');
  const [deadline, setDeadline] = useState('');
  const [priority, setPriority] = useState('2');
  const [safetyMode, setSafetyMode] = useState('balanced');
  const [activePlan, setActivePlan] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!name.trim() || !amount) return;
    await addGoal({
      name: name.trim(),
      target_amount: parseFloat(amount),
      currency,
      deadline: deadline || undefined,
      priority: parseInt(priority),
      safety_mode: safetyMode,
    });
    setName('');
    setAmount('');
    setDeadline('');
    setOpen(false);
  };

  const handleGeneratePlan = async (goalId: string) => {
    const goal = goals.find(g => g.id === goalId);
    if (!goal) return;

    const weeklyStats = computeWeeklyCategoryStats(transactions, categories, 8);
    const m0 = computeMonthlyStats(transactions, categories, 0);
    const m1 = computeMonthlyStats(transactions, categories, 1);
    const weeklyIncome = ((m0.income + m1.income) / 2) / 4.33;
    const weeklyFixed = ((m0.fixedSpend + m1.fixedSpend) / 2) / 4.33;

    const plan = generateGoalPlan(weeklyStats, weeklyIncome, weeklyFixed, goal.target_amount, goal.safety_mode);

    await saveGoalPlan({
      goal_id: goalId,
      user_id: goal.user_id,
      baseline_weekly_surplus: plan.baselineWeeklySurplus,
      suggested_weekly_savings: plan.suggestedWeeklySavings,
      est_weeks_to_goal: plan.estWeeksToGoal,
      plan: plan,
    });
    setActivePlan(goalId);
  };

  const getLatestPlan = (goalId: string) => goalPlans.find(p => p.goal_id === goalId);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Goals & Sacrifice Planner</h2>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="w-4 h-4 mr-1" /> New Goal</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Savings Goal</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label>Goal Name</Label>
                <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Emergency Fund" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Target Amount</Label>
                  <Input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="5000" />
                </div>
                <div className="space-y-2">
                  <Label>Currency</Label>
                  <Select value={currency} onValueChange={setCurrency}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="AUD">AUD</SelectItem>
                      <SelectItem value="GBP">GBP</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Deadline (optional)</Label>
                  <Input type="date" value={deadline} onChange={e => setDeadline(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Safety Mode</Label>
                  <Select value={safetyMode} onValueChange={setSafetyMode}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="conservative">Conservative (easy cuts)</SelectItem>
                      <SelectItem value="balanced">Balanced (medium cuts)</SelectItem>
                      <SelectItem value="yolo">Aggressive (max savings)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button onClick={handleCreate} className="w-full">Create Goal</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {goals.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <Target className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">
              No goals yet. Create a savings goal and the Sacrifice Planner will analyse your spending
              to recommend cuts.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {goals.map(goal => {
            const plan = getLatestPlan(goal.id);
            const planData = plan?.plan as ReturnType<typeof generateGoalPlan> | undefined;
            const showPlan = activePlan === goal.id || !!plan;

            return (
              <Card key={goal.id}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-base">{goal.name}</CardTitle>
                      <p className="text-sm text-muted-foreground mt-0.5">
                        {formatCurrency(goal.target_amount, goal.currency)}
                        {goal.deadline && ` · by ${goal.deadline}`}
                        {' · '}
                        <span className="capitalize">{goal.safety_mode}</span> mode
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <Button variant="outline" size="sm" onClick={() => handleGeneratePlan(goal.id)}>
                        <Zap className="w-3.5 h-3.5 mr-1" />
                        {plan ? 'Refresh Plan' : 'Generate Plan'}
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => deleteGoal(goal.id)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>

                {showPlan && planData && (
                  <CardContent className="pt-2">
                    <div className="grid grid-cols-3 gap-3 mb-4 p-3 rounded-lg bg-muted/50">
                      <div>
                        <p className="text-xs text-muted-foreground">Baseline Weekly Surplus</p>
                        <p className="font-semibold text-sm">{formatCurrency(planData.baselineWeeklySurplus, goal.currency)}/wk</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">With Cuts</p>
                        <p className="font-semibold text-sm text-[hsl(var(--success))]">{formatCurrency(planData.suggestedWeeklySavings, goal.currency)}/wk</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Est. Time</p>
                        <p className="font-semibold text-sm">
                          {(() => {
                            const remaining = Math.max(goal.target_amount - ((goal as any).assigned_amount || 0), 0);
                            const weeks = remaining > 0 ? Math.ceil(remaining / Math.max(planData.suggestedWeeklySavings, 0.01)) : 0;
                            const months = weeks / 4.33;
                            if (weeks === 0) return 'Funded';
                            if (months >= 1) return `${Math.floor(months)}mo ${Math.round((months % 1) * 4.33)}w`;
                            return `${weeks} wks`;
                          })()}
                        </p>
                      </div>
                    </div>

                    {planData.recommendations && planData.recommendations.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                          <TrendingDown className="w-3 h-3" /> Recommended Cuts
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Info className="w-3 h-3 text-muted-foreground/60 cursor-help" />
                            </TooltipTrigger>
                            <TooltipContent className="text-xs max-w-[220px]">Based on your last 8 weeks of spending</TooltipContent>
                          </Tooltip>
                        </p>
                        {planData.recommendations.map((rec: any, i: number) => (
                          <div key={i} className="p-3 rounded-lg border bg-card">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-sm font-medium">{rec.categoryName}</span>
                              <span className="text-xs text-muted-foreground">Currently {formatCurrency(rec.currentWeeklyAvg, goal.currency)}/wk</span>
                            </div>
                            <div className="grid grid-cols-3 gap-2 mt-2">
                              {(['easy', 'medium', 'aggressive'] as const).map(level => (
                                <div
                                  key={level}
                                  className={`p-2 rounded text-center text-xs border ${
                                    planData.modeKey === level ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.08)]' : 'border-border'
                                  }`}
                                >
                                  <p className="font-medium capitalize">{level}</p>
                                  <p className="text-muted-foreground">Cap: {formatCurrency(rec.caps[level].cap, goal.currency)}</p>
                                  <p className="text-[hsl(var(--success))] font-medium">Save {formatCurrency(rec.caps[level].saving, goal.currency)}/wk</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {planData.recommendations && planData.recommendations.length === 0 && (
                      <p className="text-sm text-muted-foreground">Not enough spending data to generate recommendations. Import more transactions.</p>
                    )}
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
