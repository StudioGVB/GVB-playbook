import { useState, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
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
  Zap,
  ArrowRight,
  ShieldCheck,
  Plus,
  Trash2,
  BookmarkCheck,
  RotateCcw
} from 'lucide-react';
import { computePolicySnapshot } from '@/lib/policyEngine';
import { formatCurrency } from '@/lib/financeUtils';
import { addWeeks, format } from 'date-fns';
import { toast } from 'sonner';
import type { useFinanceData } from '@/hooks/useFinanceData';
import type { FinanceAssumptions } from '@/hooks/useFinanceAssumptions';

interface Props {
  finance: ReturnType<typeof useFinanceData>;
  assumptions: FinanceAssumptions;
  fixedExpensesMonthly: number;
  totalBoost?: number;
  onReservePurchase?: (title: string, amount: number, targetDate?: string) => void;
}

export interface WishlistItem {
  id: string;
  title: string;
  amount: number;
  category: string;
  targetDate: string;
  weeksToWait: number;
  status: 'ready' | 'wait' | 'danger';
  createdAt: string;
}

const CATEGORIES = [
  { id: 'beauty', label: 'Beauty & Self Care', icon: Sparkles, color: 'bg-pink-100 text-pink-700 dark:bg-pink-950/40 dark:text-pink-300' },
  { id: 'fashion', label: 'Fashion & Clothing', icon: ShoppingBag, color: 'bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300' },
  { id: 'tech', label: 'Tech & Electronics', icon: Zap, color: 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300' },
  { id: 'dining', label: 'Dining & Social', icon: Flame, color: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300' },
  { id: 'travel', label: 'Travel & Experiences', icon: Calendar, color: 'bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300' },
  { id: 'other', label: 'General / Other', icon: PiggyBank, color: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' },
];

const PRESETS = [
  { title: 'Lip Filler', amount: 80, category: 'beauty' },
  { title: 'Zara Outfit', amount: 65, category: 'fashion' },
  { title: 'Cocktail Night', amount: 45, category: 'dining' },
  { title: 'AirPods Pro', amount: 190, category: 'tech' },
  { title: 'Weekend Getaway', amount: 350, category: 'travel' },
];

const WISHLIST_STORAGE_KEY = 'gvb_can_i_buy_wishlist_v1';

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

  // Load local wishlist
  const [wishlist, setWishlist] = useState<WishlistItem[]>(() => {
    try {
      const saved = localStorage.getItem(WISHLIST_STORAGE_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const saveWishlist = (newList: WishlistItem[]) => {
    setWishlist(newList);
    try {
      localStorage.setItem(WISHLIST_STORAGE_KEY, JSON.stringify(newList));
    } catch (e) {
      console.error('Failed to save wishlist', e);
    }
  };

  const parsedAmount = typeof itemAmount === 'number' && !isNaN(itemAmount) ? itemAmount : 0;

  const evaluation = useMemo(() => {
    if (parsedAmount <= 0) {
      return {
        status: 'neutral' as const,
        verdict: 'Enter an amount',
        headline: 'Financial Readiness Evaluator',
        advice: 'Enter an item title and cost to run an instant AI evaluation against your live fun budget, emergency floor, and upcoming bills.',
        weeksToWait: 0,
        targetDate: new Date(),
        percentOfFunBudget: 0,
        weeklyFunRemainingAfter: remainingWeeklyFun,
        impactOnSafety: 'safe' as const,
        weeklySavingsPace: 0,
      };
    }

    const funRemaining = Math.max(0, remainingWeeklyFun);
    const weeklyFun = Math.max(1, weeklyFunBudget);
    const percentOfFun = Math.round((parsedAmount / weeklyFun) * 100);

    // Case 1: Ready to buy now out of remaining fun budget
    if (parsedAmount <= remainingWeeklyFun) {
      const remainingAfter = remainingWeeklyFun - parsedAmount;
      return {
        status: 'ready' as const,
        verdict: 'Financially Ready 🟢',
        headline: `You can buy ${itemTitle ? `"${itemTitle}"` : 'this'} today!`,
        advice: `${itemTitle ? `"${itemTitle}"` : 'This purchase'} (${fmt(parsedAmount)}) fits fully inside your remaining fun money for this week. You will still have ${fmt(remainingAfter)} left for the rest of the week without dipping into savings.`,
        weeksToWait: 0,
        targetDate: new Date(),
        percentOfFunBudget: percentOfFun,
        weeklyFunRemainingAfter: remainingAfter,
        impactOnSafety: 'safe' as const,
        weeklySavingsPace: parsedAmount,
      };
    }

    // Case 2: Safe in X weeks
    const excess = parsedAmount - funRemaining;
    const weeksToWait = Math.max(1, Math.ceil(excess / weeklyFun));
    const targetDate = addWeeks(new Date(), weeksToWait);
    const weeklyPace = Math.ceil(parsedAmount / weeksToWait);

    const liquidFreeCash = availableSavings;

    if (parsedAmount <= liquidFreeCash) {
      return {
        status: 'wait' as const,
        verdict: `Safe to Buy in ${weeksToWait} Week${weeksToWait > 1 ? 's' : ''} 🟡`,
        headline: `AI Recommendation: Wait ${weeksToWait} week${weeksToWait > 1 ? 's' : ''} (Ready around ${format(targetDate, 'EEEE, MMM d')})`,
        advice: `Buying ${itemTitle ? `"${itemTitle}"` : 'this'} (${fmt(parsedAmount)}) today will exceed your fun budget this week by ${fmt(excess)}. However, your core emergency floor of ${fmt(emergencyFloor)} remains safe. Setting aside ${fmt(weeklyPace)}/week over the next ${weeksToWait} week${weeksToWait > 1 ? 's' : ''} allows you to buy it guilt-free on ${format(targetDate, 'MMM d')}.`,
        weeksToWait,
        targetDate,
        percentOfFunBudget: percentOfFun,
        weeklyFunRemainingAfter: 0,
        impactOnSafety: 'moderate' as const,
        weeklySavingsPace: weeklyPace,
      };
    }

    // Case 3: High Risk / Threatens Emergency Floor
    return {
      status: 'danger' as const,
      verdict: 'Not Recommended Right Now 🔴',
      headline: 'Financial Caution: Exceeds Unallocated Buffer',
      advice: `${itemTitle ? `"${itemTitle}"` : 'This purchase'} of ${fmt(parsedAmount)} exceeds your liquid cash cushion above your emergency floor (${fmt(emergencyFloor)}). Making this purchase today would compromise your emergency safety net. AI strongly advises delaying until your liquid reserves build back up.`,
      weeksToWait: weeksToWait + 2,
      targetDate: addWeeks(new Date(), weeksToWait + 2),
      percentOfFunBudget: percentOfFun,
      weeklyFunRemainingAfter: 0,
      impactOnSafety: 'danger' as const,
      weeklySavingsPace: Math.ceil(parsedAmount / (weeksToWait + 2)),
    };
  }, [parsedAmount, remainingWeeklyFun, weeklyFunBudget, availableSavings, emergencyFloor, itemTitle, fmt]);

  const handleApplyPreset = (p: typeof PRESETS[0]) => {
    setItemTitle(p.title);
    setItemAmount(p.amount);
    setCategory(p.category);
  };

  const handleSaveToWishlist = () => {
    if (!itemTitle || parsedAmount <= 0) return;
    const newItem: WishlistItem = {
      id: Date.now().toString(),
      title: itemTitle,
      amount: parsedAmount,
      category,
      targetDate: format(evaluation.targetDate, 'yyyy-MM-dd'),
      weeksToWait: evaluation.weeksToWait,
      status: evaluation.status,
      createdAt: new Date().toISOString(),
    };
    saveWishlist([newItem, ...wishlist.filter(w => w.title !== itemTitle)]);
    toast.success(`Saved "${itemTitle}" (${fmt(parsedAmount)}) to your Planned Wishlist!`);
    if (onReservePurchase) {
      onReservePurchase(itemTitle, parsedAmount, format(evaluation.targetDate, 'yyyy-MM-dd'));
    }
  };

  const handleRemoveWishlistItem = (id: string) => {
    saveWishlist(wishlist.filter(item => item.id !== id));
    toast.info('Item removed from wishlist');
  };

  return (
    <div className="space-y-6">
      {/* Main Evaluator Card */}
      <Card className="border border-pink-200/50 shadow-[0_10px_30px_rgba(255,46,184,0.05)] bg-white dark:bg-slate-900 rounded-3xl overflow-hidden transition-all">
        <div className="p-6 sm:p-8 space-y-6">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-5">
            <div className="flex items-center gap-3.5">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-pink-500 to-rose-400 text-white flex items-center justify-center shadow-lg shadow-pink-500/20 font-bold shrink-0">
                <Sparkles className="w-6 h-6 animate-pulse" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">
                    Can I Buy This?
                  </h2>
                  <Badge className="bg-[#FF2EB8]/10 text-[#FF2EB8] border-[#FF2EB8]/20 hover:bg-[#FF2EB8]/15 text-xs font-semibold px-2.5 py-0.5 rounded-full">
                    AI Evaluator
                  </Badge>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Realistically evaluates your budget, emergency cushion & fixed bill obligations before you spend.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2.5 self-start sm:self-auto bg-slate-50 dark:bg-slate-800/80 px-3.5 py-2 rounded-2xl border border-slate-200/60 dark:border-slate-700">
              <ShieldCheck className="w-4 h-4 text-emerald-500" />
              <div className="text-right">
                <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 block">Weekly Fun Left</span>
                <span className="text-sm font-black text-slate-900 dark:text-white">{fmt(remainingWeeklyFun)}</span>
              </div>
            </div>
          </div>

          {/* Form Controls */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
            <div className="md:col-span-6 space-y-2">
              <Label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                <ShoppingBag className="w-3.5 h-3.5 text-[#FF2EB8]" /> Purchase Item Name
              </Label>
              <Input
                type="text"
                placeholder="e.g. Lip Filler, Zara Coat, Concert Ticket..."
                value={itemTitle}
                onChange={(e) => setItemTitle(e.target.value)}
                className="h-11 rounded-2xl bg-slate-50/70 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700 text-sm font-semibold text-slate-900 dark:text-white focus:ring-[#FF2EB8]/30 focus:border-[#FF2EB8]"
              />
            </div>

            <div className="md:col-span-3 space-y-2">
              <Label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                Amount ({baseCurrency === 'GBP' ? '£' : '$'})
              </Label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-sm">
                  {baseCurrency === 'GBP' ? '£' : '$'}
                </span>
                <Input
                  type="number"
                  min={0}
                  placeholder="80"
                  value={itemAmount}
                  onChange={(e) => setItemAmount(e.target.value === '' ? '' : Number(e.target.value))}
                  className="h-11 pl-8 rounded-2xl bg-slate-50/70 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700 text-base font-black text-slate-900 dark:text-white focus:ring-[#FF2EB8]/30 focus:border-[#FF2EB8]"
                />
              </div>
            </div>

            <div className="md:col-span-3 space-y-2">
              <Label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="h-11 rounded-2xl bg-slate-50/70 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700 text-sm font-semibold text-slate-900 dark:text-white">
                  <SelectValue placeholder="Select Category" />
                </SelectTrigger>
                <SelectContent className="rounded-2xl">
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c.id} value={c.id} className="rounded-xl my-0.5">
                      <div className="flex items-center gap-2">
                        <c.icon className="w-4 h-4 text-slate-500" />
                        <span>{c.label}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Quick Idea Presets */}
          <div className="space-y-2 pt-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">Quick Examples:</span>
            <div className="flex items-center gap-2 flex-wrap">
              {PRESETS.map((p) => {
                const isActive = itemTitle === p.title && itemAmount === p.amount;
                return (
                  <button
                    key={p.title}
                    type="button"
                    onClick={() => handleApplyPreset(p)}
                    className={`text-xs px-3.5 py-1.5 rounded-full border font-semibold transition-all duration-150 flex items-center gap-1.5 ${
                      isActive
                        ? 'bg-[#FF2EB8] text-white border-[#FF2EB8] shadow-md shadow-pink-500/20 scale-[1.02]'
                        : 'bg-slate-50 dark:bg-slate-800 hover:bg-pink-50 hover:text-[#FF2EB8] text-slate-600 dark:text-slate-300 border-slate-200/80 dark:border-slate-700'
                    }`}
                  >
                    <span>{p.title}</span>
                    <span className={`text-[11px] font-bold ${isActive ? 'text-white/90' : 'text-slate-400'}`}>({fmt(p.amount)})</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Verdict Banner & Results */}
          {parsedAmount > 0 && (
            <div
              className={`rounded-3xl p-6 border transition-all duration-300 space-y-5 shadow-sm ${
                evaluation.status === 'ready'
                  ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-950 dark:text-emerald-100'
                  : evaluation.status === 'wait'
                  ? 'bg-amber-500/5 border-amber-500/20 text-amber-950 dark:text-amber-100'
                  : 'bg-rose-500/5 border-rose-500/20 text-rose-950 dark:text-rose-100'
              }`}
            >
              {/* Verdict Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200/40 dark:border-slate-800 pb-4">
                <div className="flex items-center gap-3.5">
                  <div
                    className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 shadow-md ${
                      evaluation.status === 'ready'
                        ? 'bg-emerald-500 text-white shadow-emerald-500/20'
                        : evaluation.status === 'wait'
                        ? 'bg-amber-500 text-white shadow-amber-500/20'
                        : 'bg-rose-500 text-white shadow-rose-500/20'
                    }`}
                  >
                    {evaluation.status === 'ready' && <CheckCircle2 className="w-6 h-6" />}
                    {evaluation.status === 'wait' && <Clock className="w-6 h-6" />}
                    {evaluation.status === 'danger' && <ShieldAlert className="w-6 h-6" />}
                  </div>

                  <div>
                    <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400 block">AI Financial Verdict</span>
                    <h3 className="text-2xl font-black tracking-tight">{evaluation.verdict}</h3>
                  </div>
                </div>

                {evaluation.weeksToWait > 0 && (
                  <div className="bg-white dark:bg-slate-900 px-4 py-2 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm text-xs font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2.5 self-start sm:self-auto">
                    <Calendar className="w-4 h-4 text-[#FF2EB8]" />
                    <span>Safe Target Date: <strong className="text-[#FF2EB8] font-bold">{format(evaluation.targetDate, 'MMM d, yyyy')}</strong></span>
                  </div>
                )}
              </div>

              {/* AI Narrative Advice */}
              <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm p-4 rounded-2xl border border-slate-200/60 dark:border-slate-800 text-sm font-medium leading-relaxed text-slate-800 dark:text-slate-200">
                "{evaluation.advice}"
              </div>

              {/* Metrics Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
                <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/60 dark:border-slate-800 shadow-sm">
                  <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">Fun Budget Impact</span>
                  <span className="text-xl font-black text-slate-900 dark:text-white mt-1 block">{evaluation.percentOfFunBudget}%</span>
                  <span className="text-[11px] text-slate-500 block">of weekly fun budget</span>
                </div>

                <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/60 dark:border-slate-800 shadow-sm">
                  <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">Remaining Fun</span>
                  <span className="text-xl font-black text-slate-900 dark:text-white mt-1 block">
                    {fmt(evaluation.weeklyFunRemainingAfter)}
                  </span>
                  <span className="text-[11px] text-slate-500 block">left for this week</span>
                </div>

                <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/60 dark:border-slate-800 shadow-sm">
                  <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">Waiting Period</span>
                  <span className="text-xl font-black text-slate-900 dark:text-white mt-1 block">
                    {evaluation.weeksToWait === 0 ? 'Ready Now' : `${evaluation.weeksToWait} Wk${evaluation.weeksToWait > 1 ? 's' : ''}`}
                  </span>
                  <span className="text-[11px] text-slate-500 block">for 100% safe cashflow</span>
                </div>

                <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/60 dark:border-slate-800 shadow-sm">
                  <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">Protected Safety Cushion</span>
                  <span className="text-xl font-black text-emerald-600 dark:text-emerald-400 mt-1 block">
                    {fmt(emergencyFloor)}
                  </span>
                  <span className="text-[11px] text-slate-500 block">emergency floor untouchable</span>
                </div>
              </div>

              {/* Savings Schedule Card */}
              {evaluation.weeksToWait > 0 && (
                <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200/60 dark:border-slate-800 shadow-sm space-y-3">
                  <div className="flex items-center justify-between text-xs font-bold text-slate-900 dark:text-white">
                    <span className="flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-[#FF2EB8]" />
                      Recommended Weekly Savings Pace
                    </span>
                    <span className="text-[#FF2EB8] font-black">
                      Save {fmt(evaluation.weeklySavingsPace)}/week
                    </span>
                  </div>
                  <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-2.5 overflow-hidden flex">
                    <div
                      className="bg-emerald-500 h-full transition-all duration-500"
                      style={{ width: `${Math.min(100, Math.max(10, (remainingWeeklyFun / parsedAmount) * 100))}%` }}
                    />
                    <div
                      className="bg-amber-400/80 h-full transition-all duration-500"
                      style={{ width: `${Math.max(0, 100 - Math.min(100, (remainingWeeklyFun / parsedAmount) * 100))}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[11px] text-slate-500 font-medium">
                    <span>Today: {fmt(Math.max(0, remainingWeeklyFun))} available</span>
                    <span>Target: {format(evaluation.targetDate, 'MMM d')} ({fmt(parsedAmount)})</span>
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex flex-col sm:flex-row items-center justify-end gap-3 pt-2">
                <Button
                  size="default"
                  className="w-full sm:w-auto bg-[#FF2EB8] hover:bg-[#FF2EB8]/90 text-white font-bold rounded-xl px-5 shadow-lg shadow-pink-500/20 gap-2"
                  onClick={handleSaveToWishlist}
                >
                  <BookmarkCheck className="w-4 h-4" />
                  Save to Wishlist & Track Target
                </Button>
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* Planned Wishlist Section */}
      {wishlist.length > 0 && (
        <Card className="border border-slate-200/80 dark:border-slate-800 shadow-md bg-white dark:bg-slate-900 rounded-3xl p-6 sm:p-8 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
            <div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <BookmarkCheck className="w-5 h-5 text-[#FF2EB8]" />
                Saved Wishlist & Planned Purchases
              </h3>
              <p className="text-xs text-slate-500">Track your target purchases and their AI readiness dates.</p>
            </div>
            <Badge variant="outline" className="text-xs font-bold rounded-full">
              {wishlist.length} Item{wishlist.length > 1 ? 's' : ''}
            </Badge>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 pt-2">
            {wishlist.map((item) => (
              <div
                key={item.id}
                className="p-4 rounded-2xl border border-slate-200/70 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 flex items-center justify-between gap-3 hover:border-pink-200 transition-all"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-900 dark:text-white text-sm">{item.title}</span>
                    <Badge
                      className={`text-[10px] font-extrabold uppercase px-2 py-0.2 rounded-full ${
                        item.status === 'ready'
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                          : item.status === 'wait'
                          ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                          : 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                      }`}
                    >
                      {item.status === 'ready' ? 'Ready Now' : `Wait ${item.weeksToWait}w`}
                    </Badge>
                  </div>
                  <div className="text-xs text-slate-500 font-medium">
                    Target: <span className="font-semibold text-slate-800 dark:text-slate-200">{format(new Date(item.targetDate), 'MMM d, yyyy')}</span>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <span className="font-black text-slate-900 dark:text-white text-base">{fmt(item.amount)}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveWishlistItem(item.id)}
                    className="text-slate-400 hover:text-rose-500 p-1.5 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950 transition-all"
                    title="Remove item"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
