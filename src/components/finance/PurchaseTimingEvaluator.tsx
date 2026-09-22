import { useState, useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { 
  Sparkles, 
  ShoppingBag, 
  CheckCircle2, 
  Clock, 
  ShieldAlert, 
  TrendingUp, 
  PiggyBank, 
  Calendar, 
  Flame,
  Zap
} from 'lucide-react';
import { computePolicySnapshot } from '@/lib/policyEngine';
import { formatCurrency } from '@/lib/financeUtils';
import { addWeeks, format } from 'date-fns';
import type { useFinanceData } from '@/hooks/useFinanceData';
import type { FinanceAssumptions } from '@/hooks/useFinanceAssumptions';

interface Props {
  finance: ReturnType<typeof useFinanceData>;
  assumptions: FinanceAssumptions;
  fixedExpensesMonthly: number;
  totalBoost?: number;
  onReservePurchase?: (title: string, amount: number, targetDate?: string) => void;
}

const CATEGORIES = [
  { id: 'beauty', label: 'Beauty & Self Care', icon: Sparkles },
  { id: 'fashion', label: 'Fashion & Clothing', icon: ShoppingBag },
  { id: 'tech', label: 'Tech & Electronics', icon: Zap },
  { id: 'dining', label: 'Dining & Social', icon: Flame },
  { id: 'travel', label: 'Travel & Experiences', icon: Calendar },
  { id: 'other', label: 'General / Other', icon: PiggyBank },
];

const PRESETS = [
  { title: 'Lip Filler', amount: 80, category: 'beauty' },
  { title: 'New Outfit', amount: 60, category: 'fashion' },
  { title: 'Dinner Party', amount: 45, category: 'dining' },
  { title: 'AirPods / Tech', amount: 180, category: 'tech' },
  { title: 'Weekend Trip', amount: 350, category: 'travel' },
];

export default function PurchaseTimingEvaluator({
  finance,
  assumptions,
  fixedExpensesMonthly,
  totalBoost = 0,
  onReservePurchase
}: Props) {
  const { transactions, categories, accounts, goals, convertToBase, settings } = finance;
  const baseCurrency = settings?.base_currency || 'GBP';
  const fmt = (n: number) => formatCurrency(n, baseCurrency);

  const snapshot = useMemo(
    () => computePolicySnapshot(assumptions, accounts, transactions, categories, goals, convertToBase, fixedExpensesMonthly, totalBoost),
    [assumptions, accounts, transactions, categories, goals, convertToBase, fixedExpensesMonthly, totalBoost]
  );

  const {
    weeklyFunBudget,
    remainingWeeklyFun,
    emergencyFloor,
    availableSavings
  } = snapshot;

  const [itemTitle, setItemTitle] = useState('Lip Filler');
  const [itemAmount, setItemAmount] = useState<number | ''>(80);
  const [category, setCategory] = useState('beauty');
  const [isEarmarked, setIsEarmarked] = useState(false);

  const parsedAmount = typeof itemAmount === 'number' && !isNaN(itemAmount) ? itemAmount : 0;

  const evaluation = useMemo(() => {
    if (parsedAmount <= 0) {
      return {
        status: 'neutral' as const,
        verdict: 'Enter an amount',
        headline: 'Financial Readiness Checker',
        advice: 'Type in how much you plan to spend to get an instant AI evaluation based on your live budget.',
        weeksToWait: 0,
        targetDate: new Date(),
        percentOfFunBudget: 0,
        weeklyFunRemainingAfter: remainingWeeklyFun,
        impactOnSafety: 'safe' as const,
      };
    }

    const funRemaining = Math.max(0, remainingWeeklyFun);
    const weeklyFun = Math.max(1, weeklyFunBudget);
    const percentOfFun = Math.round((parsedAmount / weeklyFun) * 100);

    // Scenario 1: Ready now out of remaining fun money for this week
    if (parsedAmount <= remainingWeeklyFun) {
      const remainingAfter = remainingWeeklyFun - parsedAmount;
      return {
        status: 'ready' as const,
        verdict: 'Buy Now 🟢',
        headline: 'You are financially ready to buy this now!',
        advice: `${itemTitle ? `Buying "${itemTitle}"` : 'This purchase'} (${fmt(parsedAmount)}) fits fully within your remaining fun budget for this week. You will still have ${fmt(remainingAfter)} left for the rest of the week.`,
        weeksToWait: 0,
        targetDate: new Date(),
        percentOfFunBudget: percentOfFun,
        weeklyFunRemainingAfter: remainingAfter,
        impactOnSafety: 'safe' as const,
      };
    }

    // Scenario 2: Need to wait X weeks (or spread over future fun allowances)
    const excess = parsedAmount - funRemaining;
    const weeksToWait = Math.ceil(excess / weeklyFun);
    const targetDate = addWeeks(new Date(), weeksToWait);

    const liquidFreeCash = availableSavings;

    if (parsedAmount <= liquidFreeCash) {
      return {
        status: 'wait' as const,
        verdict: `Safe to buy in ${weeksToWait} week${weeksToWait > 1 ? 's' : ''} 🟡`,
        headline: `AI Recommendation: Wait ${weeksToWait} week${weeksToWait > 1 ? 's' : ''} (Ready around ${format(targetDate, 'MMM d')})`,
        advice: `If you buy ${itemTitle ? `"${itemTitle}"` : 'this'} (${fmt(parsedAmount)}) today, you will exceed this week's fun budget by ${fmt(excess)}. However, your emergency cushion of ${fmt(emergencyFloor)} remains protected. Delaying until ${format(targetDate, 'EEEE, MMM d')} ensures your weekly cashflow stays balanced.`,
        weeksToWait,
        targetDate,
        percentOfFunBudget: percentOfFun,
        weeklyFunRemainingAfter: 0,
        impactOnSafety: 'moderate' as const,
      };
    }

    // Scenario 3: High Risk / Threatens Emergency Floor
    return {
      status: 'danger' as const,
      verdict: 'Not Recommended Right Now 🔴',
      headline: 'Financial Caution: Exceeds Safe Buffer',
      advice: `${itemTitle ? `"${itemTitle}"` : 'This purchase'} of ${fmt(parsedAmount)} exceeds your liquid cash cushion above your emergency floor (${fmt(emergencyFloor)}). Making this purchase today will compromise your core financial safety net. AI strongly advises pausing until your liquid reserves recover.`,
      weeksToWait: weeksToWait + 2,
      targetDate: addWeeks(new Date(), weeksToWait + 2),
      percentOfFunBudget: percentOfFun,
      weeklyFunRemainingAfter: 0,
      impactOnSafety: 'danger' as const,
    };
  }, [parsedAmount, remainingWeeklyFun, weeklyFunBudget, availableSavings, emergencyFloor, itemTitle, fmt]);

  const handleApplyPreset = (p: typeof PRESETS[0]) => {
    setItemTitle(p.title);
    setItemAmount(p.amount);
    setCategory(p.category);
  };

  return (
    <Card className="border border-border/60 shadow-lg bg-card/70 backdrop-blur-md overflow-hidden transition-all duration-200">
      <div className="p-5 sm:p-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border/50 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-bold shadow-inner">
              <Sparkles className="w-5 h-5 text-amber-500 animate-pulse" />
            </div>
            <div>
              <h3 className="font-semibold text-lg text-foreground flex items-center gap-2">
                Can I Buy This?
                <Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30">
                  AI Evaluator
                </Badge>
              </h3>
              <p className="text-xs text-muted-foreground">
                Realistically checks your live fun budget, emergency cushion & bill commitments before you spend.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto">
            <Badge variant="secondary" className="text-xs font-mono py-1 px-2.5">
              Fun Budget Left: <span className="font-bold text-foreground ml-1">{fmt(remainingWeeklyFun)}</span>
            </Badge>
          </div>
        </div>

        {/* Input Controls */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
          <div className="md:col-span-6 space-y-2">
            <Label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <ShoppingBag className="w-3.5 h-3.5" /> Item / Purchase Name
            </Label>
            <Input
              type="text"
              placeholder="e.g. Lip Filler, Zara Coat, Concert Ticket..."
              value={itemTitle}
              onChange={(e) => setItemTitle(e.target.value)}
              className="bg-background/50 border-border/80 focus:ring-primary/20"
            />
          </div>

          <div className="md:col-span-3 space-y-2">
            <Label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              Amount ({baseCurrency === 'GBP' ? '£' : '$'})
            </Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-semibold">
                {baseCurrency === 'GBP' ? '£' : '$'}
              </span>
              <Input
                type="number"
                min={0}
                placeholder="80"
                value={itemAmount}
                onChange={(e) => setItemAmount(e.target.value === '' ? '' : Number(e.target.value))}
                className="pl-7 bg-background/50 border-border/80 font-bold text-foreground"
              />
            </div>
          </div>

          <div className="md:col-span-3 space-y-2">
            <Label className="text-xs font-medium text-muted-foreground">Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="bg-background/50 border-border/80">
                <SelectValue placeholder="Select Category" />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Quick Presets */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground font-medium mr-1">Quick ideas:</span>
          {PRESETS.map((p) => (
            <button
              key={p.title}
              type="button"
              onClick={() => handleApplyPreset(p)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-all ${
                itemTitle === p.title && itemAmount === p.amount
                  ? 'bg-primary text-primary-foreground border-primary font-medium shadow-sm'
                  : 'bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground border-border/60'
              }`}
            >
              {p.title} ({fmt(p.amount)})
            </button>
          ))}
        </div>

        {/* Evaluation Verdict Result Card */}
        {parsedAmount > 0 && (
          <div
            className={`rounded-2xl p-5 border transition-all duration-300 space-y-4 ${
              evaluation.status === 'ready'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-950 dark:text-emerald-100'
                : evaluation.status === 'wait'
                ? 'bg-amber-500/10 border-amber-500/30 text-amber-950 dark:text-amber-100'
                : 'bg-rose-500/10 border-rose-500/30 text-rose-950 dark:text-rose-100'
            }`}
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-black/10 dark:border-white/10 pb-3">
              <div className="flex items-center gap-3">
                {evaluation.status === 'ready' && <CheckCircle2 className="w-7 h-7 text-emerald-500 shrink-0" />}
                {evaluation.status === 'wait' && <Clock className="w-7 h-7 text-amber-500 shrink-0" />}
                {evaluation.status === 'danger' && <ShieldAlert className="w-7 h-7 text-rose-500 shrink-0" />}

                <div>
                  <div className="text-xs uppercase font-bold tracking-wider opacity-80">AI Verdict</div>
                  <h4 className="text-xl font-bold">{evaluation.verdict}</h4>
                </div>
              </div>

              {evaluation.weeksToWait > 0 && (
                <div className="bg-background/80 backdrop-blur-sm px-3.5 py-1.5 rounded-xl border border-border/60 text-xs font-semibold text-foreground flex items-center gap-2 self-start sm:self-auto">
                  <Calendar className="w-3.5 h-3.5 text-primary" />
                  Target Date: <span className="text-primary font-bold">{format(evaluation.targetDate, 'MMM d, yyyy')}</span>
                </div>
              )}
            </div>

            {/* AI Advice Text */}
            <p className="text-sm leading-relaxed text-foreground/90 font-medium">
              {evaluation.advice}
            </p>

            {/* Financial Metrics Breakdown Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
              <div className="bg-background/60 backdrop-blur-sm rounded-xl p-3 border border-border/50">
                <span className="text-[11px] text-muted-foreground block">Cost vs Weekly Fun</span>
                <span className="text-base font-bold text-foreground">{evaluation.percentOfFunBudget}%</span>
                <span className="text-[10px] text-muted-foreground block">of weekly fun budget</span>
              </div>

              <div className="bg-background/60 backdrop-blur-sm rounded-xl p-3 border border-border/50">
                <span className="text-[11px] text-muted-foreground block">Left in Fun Budget</span>
                <span className="text-base font-bold text-foreground">
                  {fmt(evaluation.weeklyFunRemainingAfter)}
                </span>
                <span className="text-[10px] text-muted-foreground block">after this purchase</span>
              </div>

              <div className="bg-background/60 backdrop-blur-sm rounded-xl p-3 border border-border/50">
                <span className="text-[11px] text-muted-foreground block">Waiting Period</span>
                <span className="text-base font-bold text-foreground">
                  {evaluation.weeksToWait === 0 ? '0 Weeks' : `${evaluation.weeksToWait} Wk${evaluation.weeksToWait > 1 ? 's' : ''}`}
                </span>
                <span className="text-[10px] text-muted-foreground block">for 100% safe cashflow</span>
              </div>

              <div className="bg-background/60 backdrop-blur-sm rounded-xl p-3 border border-border/50">
                <span className="text-[11px] text-muted-foreground block">Emergency Floor</span>
                <span className="text-base font-bold text-emerald-600 dark:text-emerald-400">
                  {fmt(emergencyFloor)}
                </span>
                <span className="text-[10px] text-muted-foreground block">always protected</span>
              </div>
            </div>

            {/* Timeline / Savings Schedule */}
            {evaluation.weeksToWait > 0 && (
              <div className="bg-background/70 backdrop-blur-sm rounded-xl p-4 border border-border/60 space-y-3">
                <div className="flex items-center justify-between text-xs font-semibold text-foreground">
                  <span className="flex items-center gap-1.5">
                    <TrendingUp className="w-3.5 h-3.5 text-primary" />
                    Recommended Savings Schedule
                  </span>
                  <span className="text-muted-foreground">
                    Save {fmt(Math.ceil(parsedAmount / evaluation.weeksToWait))}/week
                  </span>
                </div>
                <div className="w-full bg-muted rounded-full h-2 overflow-hidden flex">
                  <div
                    className="bg-emerald-500 h-full transition-all duration-500"
                    style={{ width: `${Math.min(100, Math.max(10, (remainingWeeklyFun / parsedAmount) * 100))}%` }}
                  />
                  <div
                    className="bg-amber-400/70 h-full transition-all duration-500"
                    style={{ width: `${Math.max(0, 100 - Math.min(100, (remainingWeeklyFun / parsedAmount) * 100))}%` }}
                  />
                </div>
                <div className="flex justify-between text-[11px] text-muted-foreground">
                  <span>Today: {fmt(Math.max(0, remainingWeeklyFun))} available</span>
                  <span>Target: {format(evaluation.targetDate, 'MMM d')} ({fmt(parsedAmount)})</span>
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row items-center justify-end gap-2 pt-2">
              {evaluation.status === 'ready' && (
                <Button
                  size="sm"
                  className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-700 text-white font-semibold gap-1.5 shadow-sm"
                  onClick={() => {
                    if (onReservePurchase) {
                      onReservePurchase(itemTitle || 'Purchase', parsedAmount);
                    }
                    setIsEarmarked(true);
                  }}
                >
                  <CheckCircle2 className="w-4 h-4" />
                  {isEarmarked ? 'Earmarked in Budget!' : 'Deduct / Buy Now'}
                </Button>
              )}

              {evaluation.status === 'wait' && (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full sm:w-auto border-amber-500/40 hover:bg-amber-500/10 font-semibold gap-1.5"
                  onClick={() => {
                    if (onReservePurchase) {
                      onReservePurchase(itemTitle || 'Planned Purchase', parsedAmount, format(evaluation.targetDate, 'yyyy-MM-dd'));
                    }
                    setIsEarmarked(true);
                  }}
                >
                  <Calendar className="w-4 h-4 text-amber-500" />
                  {isEarmarked ? 'Added to Savings Target!' : `Plan Purchase for ${format(evaluation.targetDate, 'MMM d')}`}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
