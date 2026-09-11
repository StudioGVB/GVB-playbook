import { useMemo, useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Plane, Calendar as CalendarIcon, Wallet, TrendingDown, Check, Trash2, Plus, Pencil, Receipt, History as HistoryIcon } from 'lucide-react';
import { format, differenceInDays, differenceInCalendarDays } from 'date-fns';
import { useFinanceData } from '@/hooks/useFinanceData';
import { useFinanceAssumptions } from '@/hooks/useFinanceAssumptions';
import { useFixedExpenses } from '@/hooks/useFixedExpenses';
import { useWeeklyBoosts } from '@/hooks/useWeeklyBoosts';
import { useWeekTypes } from '@/hooks/useWeekTypes';
import { useFinanceTrips, type FinanceTrip, type TripChecklistItem } from '@/hooks/useFinanceTrips';
import { computePolicySnapshot, computeTripSpent } from '@/lib/policyEngine';
import { formatCurrency } from '@/lib/financeUtils';
import { cn } from '@/lib/utils';
import { TripDailyBreakdown } from '@/components/finance/TripDailyBreakdown';
import { TripCategoryBreakdown } from '@/components/finance/TripCategoryBreakdown';
import { LogTripExpenseDialog } from '@/components/finance/LogTripExpenseDialog';
import { BulkReconcileDialog } from '@/components/finance/BulkReconcileDialog';
import { toast } from 'sonner';
import type { DateRange } from 'react-day-picker';

const DEFAULT_CHECKLIST: TripChecklistItem[] = [
  { label: 'Travel pool funded', done: false },
  { label: 'Pause non-essential subscriptions', done: false },
  { label: 'Notify bank of travel', done: false },
  { label: 'Set up roaming / travel SIM', done: false },
  { label: 'Schedule fixed bill payments', done: false },
];

export default function FinanceTravel() {
  const finance = useFinanceData();
  const { assumptions, loading: assumptionsLoading } = useFinanceAssumptions();
  const { monthlyTotalInternal: fixedExpensesMonthly, monthlyTotal: fixedExpensesMonthlyAll } = useFixedExpenses();
  const { totalBoostThisWeek } = useWeeklyBoosts();
  const { weekTypeMap } = useWeekTypes();
  const { trips, loading: tripsLoading, createTrip, updateTrip, deleteTrip } = useFinanceTrips();

  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  const baseCurrency = finance.settings?.base_currency || 'AUD';
  const fxRates = (finance.settings?.fx_rates || {}) as Record<string, number>;
  const audToGbp = fxRates['AUD_GBP'] || 0.52;
  const fmt = (n: number) => formatCurrency(n, baseCurrency);
  const fmtGbp = (n: number) => formatCurrency(n * audToGbp, 'GBP');

  const wtMap = useMemo(() => weekTypeMap(), [weekTypeMap]);
  const snapshot = useMemo(() => {
    if (!assumptions) return null;
    return computePolicySnapshot(
      assumptions, finance.accounts, finance.transactions,
      finance.categories, finance.goals, finance.convertToBase,
      fixedExpensesMonthly, totalBoostThisWeek, wtMap, trips, fixedExpensesMonthlyAll,
    );
  }, [assumptions, finance.accounts, finance.transactions, finance.categories, finance.goals, finance.convertToBase, fixedExpensesMonthly, fixedExpensesMonthlyAll, totalBoostThisWeek, wtMap, trips]);

  // Partition trips: past (end_date before today) vs current (active/upcoming/undated)
  const nowRef = new Date();
  const startOfToday = new Date(nowRef.getFullYear(), nowRef.getMonth(), nowRef.getDate());
  const pastTrips = useMemo(
    () => trips.filter(t => t.end_date && new Date(t.end_date) < startOfToday),
    [trips, startOfToday.getTime()],
  );
  const currentTrips = useMemo(
    () => trips.filter(t => !t.end_date || new Date(t.end_date) >= startOfToday),
    [trips, startOfToday.getTime()],
  );

  const [showPast, setShowPast] = useState(false);

  // Pick a default tab once trips load
  useEffect(() => {
    if (!activeTabId && currentTrips.length > 0) {
      // Prefer active trip, then earliest upcoming, then first
      const now = new Date();
      const active = currentTrips.find(t => t.start_date && t.end_date && new Date(t.start_date) <= now && new Date(t.end_date) >= now);
      const upcoming = currentTrips.filter(t => t.start_date && new Date(t.start_date) > now).sort((a, b) => (a.start_date || '').localeCompare(b.start_date || ''))[0];
      setActiveTabId(active?.id || upcoming?.id || currentTrips[0].id);
    }
  }, [currentTrips, activeTabId]);

  const handleNewTrip = async () => {
    const created = await createTrip(`Trip ${trips.length + 1}`);
    if (created) setActiveTabId(created.id);
  };


  if (finance.loading || assumptionsLoading || tripsLoading || !snapshot || !assumptions) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Travel</h1>
        <div className="text-muted-foreground animate-pulse">Loading...</div>
      </div>
    );
  }

  const now = new Date();

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-sky-500/10 flex items-center justify-center">
            <Plane className="w-5 h-5 text-sky-500" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-foreground">Travel</h1>
            <p className="text-muted-foreground text-sm">
              {currentTrips.length === 0 ? 'Plan your first trip' : `${currentTrips.length} trip${currentTrips.length > 1 ? 's' : ''} planned`}{pastTrips.length > 0 && ` · ${pastTrips.length} archived`}
              {snapshot.activeTrip && ` · 🏖 ${snapshot.activeTrip.name} in progress`}
            </p>
          </div>
        </div>
        <Button onClick={handleNewTrip} size="sm" className="gap-1.5">
          <Plus className="w-3.5 h-3.5" /> New trip
        </Button>
      </div>

      {currentTrips.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center space-y-3">
            <div className="w-14 h-14 rounded-2xl bg-sky-500/10 flex items-center justify-center mx-auto">
              <Plane className="w-7 h-7 text-sky-500" />
            </div>
            <h3 className="text-lg font-bold">{pastTrips.length === 0 ? 'No trips yet' : 'No upcoming trips'}</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Create a trip to set dates, link a money pool as your travel budget, and switch the budget page into Travel Mode automatically.
            </p>
            <Button onClick={handleNewTrip} className="gap-1.5">
              <Plus className="w-4 h-4" /> {pastTrips.length === 0 ? 'Create your first trip' : 'New trip'}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Tabs value={activeTabId || currentTrips[0].id} onValueChange={setActiveTabId}>
          <TabsList className="flex flex-wrap gap-1 h-auto p-1 justify-start">
            {currentTrips.map(t => {
              const isActive = t.start_date && t.end_date && new Date(t.start_date) <= now && new Date(t.end_date) >= now;
              const isUpcoming = t.start_date && new Date(t.start_date) > now;
              return (
                <TabsTrigger key={t.id} value={t.id} className="gap-1.5">
                  <Plane className="w-3 h-3" />
                  {t.name}
                  {isActive && <span className="w-1.5 h-1.5 rounded-full bg-sky-500 animate-pulse" />}
                  {isUpcoming && <span className="text-[10px] text-muted-foreground">soon</span>}
                </TabsTrigger>
              );
            })}
          </TabsList>

          {currentTrips.map(trip => (
            <TabsContent key={trip.id} value={trip.id} className="space-y-5 mt-4">
              <TripPanel
                trip={trip}
                onUpdate={(updates, silent) => updateTrip(trip.id, updates, silent)}
                onDelete={() => { deleteTrip(trip.id); setActiveTabId(null); }}
                goals={finance.goals}
                fixedExpensesMonthly={fixedExpensesMonthly}
                snapshot={snapshot}
                transactions={finance.transactions}
                categories={finance.categories}
                fmt={fmt}
                fmtGbp={fmtGbp}
                audToGbp={audToGbp}
              />
            </TabsContent>
          ))}
        </Tabs>
      )}

      {pastTrips.length > 0 && (
        <Card>
          <button
            onClick={() => setShowPast(v => !v)}
            className="w-full flex items-center justify-between p-4 text-left hover:bg-muted/40 transition-colors rounded-lg"
          >
            <div className="flex items-center gap-2">
              <HistoryIcon className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-semibold">Past trips ({pastTrips.length})</span>
            </div>
            <span className="text-xs text-muted-foreground">{showPast ? 'Hide' : 'Show'}</span>
          </button>
          {showPast && (
            <CardContent className="pt-0 space-y-2">
              {pastTrips
                .slice()
                .sort((a, b) => (b.end_date || '').localeCompare(a.end_date || ''))
                .map(t => (
                  <div key={t.id} className="flex items-center justify-between gap-3 py-2 border-t border-border/50 first:border-t-0">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{t.name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {t.start_date && format(new Date(t.start_date), 'd MMM yyyy')}
                        {t.end_date && ` – ${format(new Date(t.end_date), 'd MMM yyyy')}`}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs text-destructive hover:text-destructive"
                      onClick={() => {
                        if (confirm(`Delete trip "${t.name}"? This cannot be undone.`)) deleteTrip(t.id);
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                ))}
            </CardContent>
          )}
        </Card>
      )}

    </div>
  );
}

// ---- Per-trip panel ----

interface TripPanelProps {
  trip: FinanceTrip;
  onUpdate: (updates: Partial<FinanceTrip>, silent?: boolean) => Promise<void>;
  onDelete: () => void;
  goals: ReturnType<typeof useFinanceData>['goals'];
  fixedExpensesMonthly: number;
  snapshot: NonNullable<ReturnType<typeof computePolicySnapshot>>;
  transactions: ReturnType<typeof useFinanceData>['transactions'];
  categories: ReturnType<typeof useFinanceData>['categories'];
  fmt: (n: number) => string;
  fmtGbp: (n: number) => string;
  audToGbp: number;
}

function TripPanel({ trip, onUpdate, onDelete, goals, fixedExpensesMonthly, snapshot, transactions, categories, fmt, fmtGbp, audToGbp }: TripPanelProps) {
  const [nameDraft, setNameDraft] = useState(trip.name);
  const [editingName, setEditingName] = useState(false);
  const [newChecklistItem, setNewChecklistItem] = useState('');

  useEffect(() => { setNameDraft(trip.name); }, [trip.name]);

  const tripRange: DateRange | undefined = useMemo(() => {
    if (!trip.start_date || !trip.end_date) return undefined;
    return { from: new Date(trip.start_date), to: new Date(trip.end_date) };
  }, [trip]);

  const handleRangeChange = async (range: DateRange | undefined) => {
    if (!range?.from) return;
    await onUpdate({
      start_date: format(range.from, 'yyyy-MM-dd'),
      end_date: range.to ? format(range.to, 'yyyy-MM-dd') : format(range.from, 'yyyy-MM-dd'),
    }, true);
    toast.success('Trip dates saved');
  };

  const handleSaveName = async () => {
    if (!nameDraft.trim() || nameDraft === trip.name) { setEditingName(false); return; }
    await onUpdate({ name: nameDraft.trim() }, true);
    setEditingName(false);
  };

  const handlePoolChange = async (goalId: string) => {
    await onUpdate({ goal_id: goalId === '__none__' ? null : goalId }, true);
    toast.success('Pool linked to trip');
  };

  const checklist = (trip.checklist?.length ? trip.checklist : DEFAULT_CHECKLIST) as TripChecklistItem[];

  const toggleChecklistItem = async (idx: number) => {
    const next = checklist.map((it, i) => i === idx ? { ...it, done: !it.done } : it);
    await onUpdate({ checklist: next }, true);
  };
  const addChecklistItem = async () => {
    if (!newChecklistItem.trim()) return;
    const next = [...checklist, { label: newChecklistItem.trim(), done: false }];
    await onUpdate({ checklist: next }, true);
    setNewChecklistItem('');
  };
  const removeChecklistItem = async (idx: number) => {
    const next = checklist.filter((_, i) => i !== idx);
    await onUpdate({ checklist: next }, true);
  };

  const now = new Date();
  const tripStart = trip.start_date ? new Date(trip.start_date) : null;
  const tripEnd = trip.end_date ? new Date(trip.end_date) : null;
  const tripDays = tripStart && tripEnd ? differenceInCalendarDays(tripEnd, tripStart) + 1 : 0;
  const tripWeeks = tripDays / 7;
  const isActive = tripStart && tripEnd && now >= new Date(tripStart.getFullYear(), tripStart.getMonth(), tripStart.getDate()) && now <= new Date(tripEnd.getFullYear(), tripEnd.getMonth(), tripEnd.getDate(), 23, 59, 59);
  const isUpcoming = tripStart && tripStart > now;
  const isPast = tripEnd && tripEnd < now;
  const daysUntilTrip = tripStart ? differenceInDays(tripStart, now) : 0;
  const daysIntoTrip = tripStart ? Math.max(0, differenceInDays(now, tripStart) + 1) : 0;
  const daysLeftInTrip = tripEnd && isActive ? Math.max(0, differenceInDays(tripEnd, now)) : 0;

  // Linked pool
  const linkedGoal = trip.goal_id ? goals.find(g => g.id === trip.goal_id) : null;
  const poolAmount = linkedGoal?.assigned_amount || 0;
  const poolSpent = computeTripSpent(transactions, trip.id, trip.start_date, trip.end_date);
  const poolRemaining = Math.max(0, poolAmount - poolSpent);
  const poolPctUsed = poolAmount > 0 ? (poolSpent / poolAmount) * 100 : 0;

  // Trip costs
  const fixedBillsDuringTrip = (fixedExpensesMonthly / 4.33) * tripWeeks;
  const totalTripBudget = poolAmount + fixedBillsDuringTrip;
  const dailyPoolBurn = daysIntoTrip > 0 && isActive ? poolSpent / daysIntoTrip : 0;
  const projectedPoolEnd = isActive ? poolSpent + (dailyPoolBurn * daysLeftInTrip) : 0;
  // Adaptive per-day budget: remaining money split across days still ahead.
  // Active trips use days left (incl. today); upcoming trips use full trip length.
  const daysForBudget = isActive ? Math.max(1, daysLeftInTrip + 1) : (isUpcoming ? tripDays : Math.max(1, tripDays));
  const perDayRemaining = poolAmount > 0 ? poolRemaining / daysForBudget : 0;
  const baselinePerDay = poolAmount > 0 && tripDays > 0 ? poolAmount / tripDays : 0;
  const perDayDelta = perDayRemaining - baselinePerDay;
  const normalWeeklyBurn = snapshot.weeklyFixedCosts + (snapshot.weeklyEssentialBudget || 0);
  const fixedOnlyBurn = snapshot.weeklyFixedCosts;
  const savedByNotEssentialFun = (normalWeeklyBurn - fixedOnlyBurn) * tripWeeks;
  const checklistDone = checklist.filter(i => i.done).length;

  return (
    <>
      {/* Trip header */}
      <Card className="overflow-hidden">
        {/* Title strip */}
        <div className="px-5 sm:px-6 py-4 border-b border-border bg-muted/30 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-1 min-w-[200px]">
            {editingName ? (
              <>
                <Input
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSaveName(); if (e.key === 'Escape') { setNameDraft(trip.name); setEditingName(false); } }}
                  autoFocus
                  className="h-9 text-base font-bold max-w-[280px]"
                />
                <Button size="sm" onClick={handleSaveName}>Save</Button>
              </>
            ) : (
              <>
                <h2 className="text-xl font-black tracking-tight">{trip.name}</h2>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditingName(true)}>
                  <Pencil className="w-3.5 h-3.5" />
                </Button>
                {isActive && (
                  <Badge className="bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30 gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-sky-500 animate-pulse" />
                    In progress
                  </Badge>
                )}
                {isUpcoming && (
                  <Badge variant="outline" className="bg-background">
                    In {daysUntilTrip}d
                  </Badge>
                )}
                {isPast && <Badge variant="secondary">Complete</Badge>}
              </>
            )}
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground hover:text-destructive">
                <Trash2 className="w-3.5 h-3.5" /> Delete trip
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete "{trip.name}"?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will remove the trip and untag any transactions assigned to it. The linked money pool will not be affected.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={onDelete}>Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        {/* Two-column meta grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-border">
          {/* Trip dates */}
          <div className="p-5 sm:p-6 space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-sky-500/10 flex items-center justify-center">
                <CalendarIcon className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
              </div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Trip dates</p>
            </div>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className={cn('justify-start text-left font-semibold w-full h-11', !tripRange && 'text-muted-foreground font-normal')}>
                  <CalendarIcon className="mr-2 h-4 w-4 text-muted-foreground" />
                  {tripRange?.from ? (
                    tripRange.to ? (
                      <span className="tabular-nums">{format(tripRange.from, 'LLL d, y')} → {format(tripRange.to, 'LLL d, y')}</span>
                    ) : (
                      format(tripRange.from, 'LLL d, y')
                    )
                  ) : (
                    <span>Pick start and end dates</span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="range"
                  selected={tripRange}
                  onSelect={handleRangeChange}
                  numberOfMonths={2}
                  initialFocus
                  className={cn('p-3 pointer-events-auto')}
                />
              </PopoverContent>
            </Popover>
            {tripStart && tripEnd && (
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span><span className="font-black text-foreground tabular-nums text-sm">{tripDays}</span> days</span>
                <span className="text-border">·</span>
                <span><span className="font-black text-foreground tabular-nums text-sm">{tripWeeks.toFixed(1)}</span> weeks</span>
              </div>
            )}
          </div>

          {/* Pool linkage */}
          <div className="p-5 sm:p-6 space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                <Wallet className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Travel pool</p>
            </div>
            <Select value={trip.goal_id || '__none__'} onValueChange={handlePoolChange}>
              <SelectTrigger className="w-full h-11 font-semibold">
                <SelectValue placeholder="Link a money pool…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No pool linked</SelectItem>
                {goals.map(g => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.name} — {fmt(g.assigned_amount || 0)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Pick a money pool from your Pools page — its balance becomes this trip's spendable budget.
            </p>
          </div>
        </div>
      </Card>

      {tripStart && tripEnd && (
        <>
          {/* ============ PAST TRIP — "What did I actually spend?" ============ */}
          {isPast && (
            <>
              {/* Total spent hero — combines pool spend + external logs + fixed bills during trip */}
              <Card className="overflow-hidden border-emerald-500/20 bg-gradient-to-br from-emerald-500/[0.08] via-emerald-500/[0.03] to-transparent">
                <CardContent className="p-6 space-y-4">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="space-y-1">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-700 dark:text-emerald-400">
                        Total spent on this trip
                      </p>
                      <p className="text-5xl sm:text-6xl font-black tabular-nums text-emerald-500 leading-none">
                        {fmt(poolSpent + fixedBillsDuringTrip)}
                      </p>
                      <p className="text-sm text-muted-foreground tabular-nums">
                        {fmtGbp(poolSpent + fixedBillsDuringTrip)} · over {tripDays} days
                      </p>
                    </div>
                    <div className="flex flex-col gap-2 items-end">
                      <BulkReconcileDialog
                        tripId={trip.id}
                        tripName={trip.name}
                        tripStart={trip.start_date}
                        tripEnd={trip.end_date}
                      />
                      <LogTripExpenseDialog tripId={trip.id} tripName={trip.name} categories={categories} />
                    </div>
                  </div>

                  {/* Breakdown chips */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3 border-t border-emerald-500/15">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70 mb-1">Trip spend (tagged)</p>
                      <p className="text-xl font-black tabular-nums text-sky-500">{fmt(poolSpent)}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">From transactions & manual logs</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70 mb-1">Fixed bills during trip</p>
                      <p className="text-xl font-black tabular-nums text-red-500">{fmt(fixedBillsDuringTrip)}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{tripWeeks.toFixed(1)} wks × {fmt(snapshot.weeklyFixedCosts)}/wk</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70 mb-1">Daily average</p>
                      <p className="text-xl font-black tabular-nums text-foreground">{fmt((poolSpent + fixedBillsDuringTrip) / Math.max(1, tripDays))}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">All in, per day</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Pool vs spent variance */}
              {linkedGoal && poolAmount > 0 && (
                <Card>
                  <CardContent className="p-5 space-y-3">
                    <div className="flex items-center gap-2">
                      <Wallet className="w-4 h-4 text-muted-foreground" />
                      <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Pool vs actual</p>
                    </div>
                    <div className="grid grid-cols-3 gap-3 text-sm">
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Budgeted</p>
                        <p className="text-lg font-bold tabular-nums">{fmt(poolAmount)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Spent</p>
                        <p className="text-lg font-bold tabular-nums">{fmt(poolSpent)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                          {poolSpent > poolAmount ? 'Over by' : 'Left over'}
                        </p>
                        <p className={cn('text-lg font-bold tabular-nums', poolSpent > poolAmount ? 'text-destructive' : 'text-emerald-500')}>
                          {fmt(Math.abs(poolAmount - poolSpent))}
                        </p>
                      </div>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className={cn('h-full', poolSpent > poolAmount ? 'bg-destructive' : 'bg-emerald-500')}
                        style={{ width: `${Math.min(poolPctUsed, 100)}%` }}
                      />
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Daily breakdown + categories — useful for "where did it go?" */}
              <TripDailyBreakdown
                tripId={trip.id}
                startDate={tripStart}
                endDate={tripEnd}
                poolTotal={poolAmount}
                transactions={transactions}
              />
              <TripCategoryBreakdown
                tripId={trip.id}
                transactions={transactions}
                categories={categories}
              />
            </>
          )}

          {/* ============ ACTIVE TRIP — "How am I tracking right now?" ============ */}
          {isActive && (
            <>
              {/* Pool hero (live) */}
              <Card className="overflow-hidden border-sky-500/20 bg-gradient-to-br from-sky-500/[0.08] via-sky-500/[0.03] to-transparent">
                <CardContent className="p-6">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="space-y-1">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-sky-700 dark:text-sky-400">Travel Pool</p>
                      <p className="text-4xl sm:text-5xl font-black tabular-nums text-sky-500 leading-none">{fmt(poolAmount)}</p>
                      <p className="text-sm text-muted-foreground tabular-nums">{fmtGbp(poolAmount)}</p>
                      <p className="text-xs text-muted-foreground pt-1">
                        {linkedGoal ? `From: ${linkedGoal.name}` : 'Link a pool to set a budget'}
                      </p>
                      <div className="pt-2 flex gap-2 flex-wrap">
                        <LogTripExpenseDialog tripId={trip.id} tripName={trip.name} categories={categories} />
                        <BulkReconcileDialog
                          tripId={trip.id}
                          tripName={trip.name}
                          tripStart={trip.start_date}
                          tripEnd={trip.end_date}
                          trigger={<Button size="sm" variant="ghost" className="gap-1.5"><Receipt className="w-3.5 h-3.5" /> Bulk paste</Button>}
                        />
                      </div>
                    </div>
                    {linkedGoal && poolAmount > 0 && (
                      <div className="flex items-start gap-6">
                        <div className="text-right space-y-1">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">Remaining</p>
                          <p className="text-2xl font-black tabular-nums text-foreground">{fmt(poolRemaining)}</p>
                          <p className="text-xs text-muted-foreground tabular-nums">{poolPctUsed.toFixed(0)}% used</p>
                        </div>
                        <div className="text-right space-y-1 pl-6 border-l border-border/60">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">Per day left</p>
                          <p className="text-2xl font-black tabular-nums text-emerald-500">{fmt(perDayRemaining)}</p>
                          <p className="text-xs text-muted-foreground tabular-nums">
                            {daysLeftInTrip + 1} days left
                            {Math.abs(perDayDelta) > 0.5 && (
                              <span className={cn('ml-1', perDayDelta > 0 ? 'text-emerald-600' : 'text-destructive')}>
                                ({perDayDelta > 0 ? '+' : ''}{fmt(perDayDelta)} vs plan)
                              </span>
                            )}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* In-trip tracker */}
              <Card className="border-sky-500/30 bg-sky-500/[0.03]">
                <CardContent className="p-5 space-y-3">
                  <div className="flex items-center gap-2">
                    <TrendingDown className="w-4 h-4 text-sky-500" />
                    <p className="text-[11px] font-bold uppercase tracking-widest text-sky-700 dark:text-sky-400">Trip in progress</p>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Day</p>
                      <p className="text-xl font-black tabular-nums">{daysIntoTrip} / {tripDays}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Days left</p>
                      <p className="text-xl font-black tabular-nums">{daysLeftInTrip}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Daily burn</p>
                      <p className="text-xl font-black tabular-nums text-sky-500">{fmt(dailyPoolBurn)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Projected end</p>
                      <p className={cn('text-xl font-black tabular-nums', projectedPoolEnd > poolAmount ? 'text-destructive' : 'text-emerald-500')}>
                        {fmt(projectedPoolEnd)}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <TripDailyBreakdown
                tripId={trip.id}
                startDate={tripStart}
                endDate={tripEnd}
                poolTotal={poolAmount}
                transactions={transactions}
              />
              <TripCategoryBreakdown
                tripId={trip.id}
                transactions={transactions}
                categories={categories}
              />
            </>
          )}

          {/* ============ UPCOMING TRIP — "Am I ready?" ============ */}
          {isUpcoming && (
            <>
              {/* Countdown + funding hero */}
              <Card className="overflow-hidden border-sky-500/20 bg-gradient-to-br from-sky-500/[0.08] via-sky-500/[0.03] to-transparent">
                <CardContent className="p-6">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="space-y-1">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-sky-700 dark:text-sky-400">Departing in</p>
                      <p className="text-5xl sm:text-6xl font-black tabular-nums text-sky-500 leading-none">{daysUntilTrip}<span className="text-2xl text-muted-foreground ml-1">days</span></p>
                      <p className="text-sm text-muted-foreground pt-1">
                        {tripDays} day trip · {tripWeeks.toFixed(1)} weeks away from normal spend
                      </p>
                    </div>
                    <div className="text-right space-y-1">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">Travel pool left</p>
                      <p className={cn('text-3xl font-black tabular-nums', poolSpent > poolAmount ? 'text-destructive' : 'text-emerald-500')}>{fmt(poolRemaining)}</p>
                      {poolAmount > 0 && (
                        <p className="text-xs text-muted-foreground tabular-nums">
                          Spent {fmt(poolSpent)} of {fmt(poolAmount)}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground tabular-nums">{fmtGbp(poolRemaining)} left</p>
                      {poolAmount > 0 && tripDays > 0 && (
                        <p className="text-xs text-muted-foreground pt-1">{fmt(baselinePerDay)}/day budget</p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* KPI strip — quick-glance trip metrics */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Card className="border-emerald-500/20">
                  <CardContent className="p-4 space-y-1">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Spend / day</p>
                    <p className="text-2xl font-black tabular-nums text-emerald-500">{poolAmount > 0 ? fmt(baselinePerDay) : '—'}</p>
                    <p className="text-[10px] text-muted-foreground">Pool ÷ {tripDays} days</p>
                  </CardContent>
                </Card>
                <Card className="border-sky-500/20">
                  <CardContent className="p-4 space-y-1">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Spend / day (£)</p>
                    <p className="text-2xl font-black tabular-nums text-sky-500">{poolAmount > 0 ? fmtGbp(baselinePerDay) : '—'}</p>
                    <p className="text-[10px] text-muted-foreground">At {audToGbp.toFixed(3)} AUD→GBP</p>
                  </CardContent>
                </Card>
                <Card className={cn(linkedGoal && linkedGoal.target_amount > 0 && poolAmount < linkedGoal.target_amount ? 'border-amber-500/30' : 'border-emerald-500/20')}>
                  <CardContent className="p-4 space-y-1">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Pool funded</p>
                    {linkedGoal && linkedGoal.target_amount > 0 ? (
                      <>
                        <p className={cn('text-2xl font-black tabular-nums', poolAmount >= linkedGoal.target_amount ? 'text-emerald-500' : 'text-amber-500')}>
                          {Math.min(100, Math.round((poolAmount / linkedGoal.target_amount) * 100))}%
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {poolAmount >= linkedGoal.target_amount ? 'Fully funded 🎉' : `${fmt(linkedGoal.target_amount - poolAmount)} to go`}
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-2xl font-black tabular-nums text-muted-foreground">—</p>
                        <p className="text-[10px] text-muted-foreground">Set a goal target</p>
                      </>
                    )}
                  </CardContent>
                </Card>
                <Card className={cn(checklistDone === checklist.length ? 'border-emerald-500/20' : 'border-muted')}>
                  <CardContent className="p-4 space-y-1">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Readiness</p>
                    <p className={cn('text-2xl font-black tabular-nums', checklistDone === checklist.length ? 'text-emerald-500' : 'text-foreground')}>
                      {Math.round((checklistDone / Math.max(1, checklist.length)) * 100)}%
                    </p>
                    <p className="text-[10px] text-muted-foreground">{checklistDone} of {checklist.length} done</p>
                  </CardContent>
                </Card>
              </div>

              {/* Total cost preview */}
              <Card>
                <CardContent className="p-5 space-y-4">
                  <div className="flex items-center gap-2">
                    <TrendingDown className="w-4 h-4 text-muted-foreground" />
                    <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Estimated trip cost</p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-border">
                    <div className="pb-3 sm:pb-0 sm:pr-5">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70 mb-1.5">Travel pool</p>
                      <p className="text-2xl font-black tabular-nums text-sky-500">{fmt(poolAmount)}</p>
                    </div>
                    <div className="py-3 sm:py-0 sm:px-5">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70 mb-1.5">Fixed bills during trip</p>
                      <p className="text-2xl font-black tabular-nums text-red-500">{fmt(fixedBillsDuringTrip)}</p>
                      <p className="text-[10px] text-muted-foreground/70 mt-0.5">{tripWeeks.toFixed(1)} wks × {fmt(snapshot.weeklyFixedCosts)}/wk</p>
                    </div>
                    <div className="pt-3 sm:pt-0 sm:pl-5">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70 mb-1.5">Total trip cost</p>
                      <p className="text-2xl font-black tabular-nums text-foreground">{fmt(totalTripBudget)}</p>
                      <p className="text-[10px] text-emerald-600 mt-0.5">Saving ~{fmt(savedByNotEssentialFun)} vs normal</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Pre-trip checklist */}
              <Card>
                <CardContent className="p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Check className="w-4 h-4 text-muted-foreground" />
                      <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Pre-trip checklist</p>
                    </div>
                    <Badge variant="secondary" className="text-[10px]">{checklistDone} / {checklist.length}</Badge>
                  </div>
                  <div className="space-y-1.5">
                    {checklist.map((item, idx) => (
                      <div key={idx} className="flex items-center gap-3 group">
                        <Checkbox checked={item.done} onCheckedChange={() => toggleChecklistItem(idx)} />
                        <span className={cn('flex-1 text-sm', item.done && 'line-through text-muted-foreground')}>
                          {item.label}
                        </span>
                        <Button
                          variant="ghost" size="icon"
                          className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={() => removeChecklistItem(idx)}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2 pt-2 border-t border-border">
                    <Input
                      placeholder="Add checklist item…"
                      value={newChecklistItem}
                      onChange={(e) => setNewChecklistItem(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') addChecklistItem(); }}
                      className="flex-1 h-8 text-sm"
                    />
                    <Button size="sm" variant="outline" onClick={addChecklistItem} disabled={!newChecklistItem.trim()}>
                      <Plus className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </>
      )}
    </>
  );
}
