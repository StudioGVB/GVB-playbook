import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Shield, Target, Sparkles, Lock, ArrowUpRight, Check, AlertCircle, Calendar } from 'lucide-react';
import { formatCurrency } from '@/lib/financeUtils';
import type { EmergencyLadderState } from '@/lib/emergencyLadderEngine';
import { format, parseISO } from 'date-fns';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ladderState: EmergencyLadderState;
  currency: string;
  onLevelUp: () => Promise<void>;
  onUpdateTargetMonths?: (months: number) => Promise<void>;
}

export default function EmergencyLadderModal({
  open,
  onOpenChange,
  ladderState,
  currency,
  onLevelUp,
  onUpdateTargetMonths,
}: Props) {
  const fmt = (n: number) => formatCurrency(n, currency);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl p-6 font-body">
        <DialogHeader className="pb-3 border-b border-border/60">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-2xl bg-emerald-100 flex items-center justify-center text-emerald-700">
                <Shield className="w-5 h-5" />
              </div>
              <div>
                <DialogTitle className="text-xl font-bold font-display text-slate-900">
                  Emergency Fund Growth Ladder
                </DialogTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Building up to {ladderState.targetMonths}+ months in stages without breaking active pots
                </p>
              </div>
            </div>
            <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 font-bold px-3 py-1 text-xs">
              Stage {ladderState.activeMonths} of {ladderState.targetMonths} Mo
            </Badge>
          </div>
        </DialogHeader>

        <div className="space-y-6 pt-3">
          {/* Progress Overview Card */}
          <div className="bg-gradient-to-br from-emerald-50/70 via-teal-50/40 to-slate-50 p-4 rounded-2xl border border-emerald-200/70 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2 text-xs">
              <div>
                <span className="text-slate-500 font-medium block">Active Safety Floor</span>
                <span className="text-lg font-black text-slate-900 font-display">
                  {ladderState.activeMonths} Months ({fmt(ladderState.currentFloor)})
                </span>
              </div>
              <div className="text-right">
                <span className="text-slate-500 font-medium block">North Star Target</span>
                <span className="text-lg font-black text-emerald-800 font-display">
                  {ladderState.targetMonths} Months ({fmt(ladderState.ultimateFloor)})
                </span>
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex justify-between text-[11px] text-slate-500 font-semibold">
                <span>Milestone Progress</span>
                <span>{ladderState.progressPercent.toFixed(0)}% towards final goal</span>
              </div>
              <Progress value={ladderState.progressPercent} className="h-2.5 bg-emerald-200/50" />
            </div>

            <p className="text-[11px] text-slate-600 leading-relaxed pt-1">
              💡 <strong>Why stage it?</strong> If you raised your setting to {ladderState.targetMonths} months today, the system would immediately reserve an extra {fmt(ladderState.ultimateFloor - ladderState.currentFloor)}, which would starve your active holiday/travel pots. Staging allows you to fund your trips now and unlock more months as cashflow frees up!
            </p>
          </div>

          {/* Stepper Milestone Map */}
          <div className="space-y-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
              <Target className="w-3.5 h-3.5 text-slate-500" />
              Expansion Roadmap
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
              {ladderState.milestones.map((m) => {
                const isAchieved = m.status === 'achieved';
                const isActive = m.status === 'active_floor';
                const isNext = m.status === 'next_milestone';
                const isTarget = m.status === 'ultimate_target';

                let border = 'border-slate-200 bg-slate-50/50 text-slate-400';
                if (isAchieved) border = 'border-emerald-200 bg-emerald-50/90 text-emerald-800';
                if (isActive) border = 'border-blue-400 bg-blue-50 text-blue-900 shadow-xs ring-2 ring-blue-300';
                if (isNext) border = 'border-amber-300 bg-amber-50 text-amber-900 ring-2 ring-amber-200';
                if (isTarget && !isNext && !isActive) border = 'border-purple-200 bg-purple-50 text-purple-900';

                return (
                  <div key={m.month} className={`rounded-xl border p-2.5 flex flex-col justify-between text-left ${border}`}>
                    <div className="flex items-center justify-between text-[11px] font-bold">
                      <span>{m.month} Mo</span>
                      {isAchieved && <Check className="w-3.5 h-3.5 text-emerald-600" />}
                      {isActive && <Shield className="w-3.5 h-3.5 text-blue-600" />}
                      {isNext && <Sparkles className="w-3.5 h-3.5 text-amber-600" />}
                    </div>
                    <div className="mt-2 text-xs font-black font-display">{fmt(m.amount)}</div>
                    <div className="text-[9px] uppercase font-bold tracking-tight mt-1 opacity-80">
                      {isAchieved && 'Achieved'}
                      {isActive && 'Active Floor'}
                      {isNext && 'Next Step'}
                      {isTarget && !isActive && !isNext && 'Goal'}
                      {!isAchieved && !isActive && !isNext && !isTarget && 'Upcoming'}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Active Pots Section: The Reason We Stage */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-amber-600" />
                Active Pots Protecting Your Cashflow ({ladderState.activeCompetingPots.length})
              </h4>
              <span className="text-[11px] text-slate-500 font-semibold">
                Total Pace: ~{fmt(ladderState.totalWeeklyCommittedToPots)}/wk
              </span>
            </div>

            {ladderState.activeCompetingPots.length === 0 ? (
              <div className="p-3 bg-emerald-50/70 border border-emerald-200 rounded-xl text-xs text-emerald-800 font-medium">
                🎉 No active goal pots are competing for your weekly savings! You have full freedom to add more months to your emergency reserve.
              </div>
            ) : (
              <div className="divide-y divide-border border border-border/80 rounded-2xl overflow-hidden bg-white text-xs">
                {ladderState.activeCompetingPots.map((pot) => (
                  <div key={pot.id} className="p-3 flex items-center justify-between gap-3 flex-wrap hover:bg-slate-50/60 transition-colors">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900">{pot.name}</span>
                        {pot.isHolidayOrTrip && (
                          <Badge variant="outline" className="text-[10px] bg-rose-50 text-rose-700 border-rose-200 py-0">
                            Holiday/Trip
                          </Badge>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500 flex items-center gap-3">
                        {pot.deadline && (
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3 text-slate-400" />
                            Due: {format(parseISO(String(pot.deadline).split('T')[0]), 'MMM d, yyyy')}
                          </span>
                        )}
                        <span>Remaining: {fmt(pot.remainingAmount)}</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="font-display font-extrabold text-slate-800 block">
                        {fmt(pot.weeklyPace)}/wk
                      </span>
                      <span className="text-[10px] text-slate-400">Weekly Pace</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Next Step Advisor & Action */}
          {ladderState.nextMonth && (
            <div className={`p-4 rounded-2xl border transition-all ${
              ladderState.canAffordNextMonthNow
                ? 'bg-emerald-50 border-emerald-300'
                : 'bg-amber-50 border-amber-300'
            }`}>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="space-y-1.5 max-w-md">
                  <div className="flex items-center gap-2">
                    {ladderState.canAffordNextMonthNow ? (
                      <Sparkles className="w-4 h-4 text-emerald-700" />
                    ) : (
                      <Lock className="w-4 h-4 text-amber-700" />
                    )}
                    <h5 className="font-bold text-sm text-slate-900">
                      Step to Month {ladderState.nextMonth} (+{fmt(ladderState.additionalCostForNextMonth)})
                    </h5>
                  </div>
                  {ladderState.canAffordNextMonthNow ? (
                    <p className="text-xs text-emerald-800 leading-relaxed">
                      You have sufficient unallocated liquid cash ({fmt(ladderState.unallocatedCash)}) to advance your emergency floor to <strong>{ladderState.nextMonth} months</strong> right now without creating a deficit for any active goal!
                    </p>
                  ) : (
                    <p className="text-xs text-amber-900 leading-relaxed">
                      Currently, your weekly savings are committed to your active holiday & priority pots.
                      {ladderState.projectedUnlockPotName ? ` Once ${ladderState.projectedUnlockPotName} finishes, ` : ' Once these pots finish, '}
                      ~<strong>{fmt(ladderState.totalWeeklyCommittedToPots)}/wk</strong> will be freed up to comfortably fund Month {ladderState.nextMonth}.
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    onClick={async () => {
                      await onLevelUp();
                      onOpenChange(false);
                    }}
                    className={`font-bold text-xs gap-1.5 shadow-xs ${
                      ladderState.canAffordNextMonthNow
                        ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                        : 'bg-amber-700 hover:bg-amber-800 text-white'
                    }`}
                  >
                    <ArrowUpRight className="w-4 h-4" />
                    Level Up to {ladderState.nextMonth} Months
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Target Months Selector */}
          <div className="pt-2 flex items-center justify-between border-t border-border/60 text-xs text-slate-500">
            <span>Basis: {fmt(ladderState.monthlySurvival)}/mo survival × 1.2 buffer</span>
            <div className="flex items-center gap-2">
              <span>Goal Target:</span>
              <select
                value={ladderState.targetMonths}
                onChange={async (e) => {
                  const val = parseInt(e.target.value) || 6;
                  if (onUpdateTargetMonths) await onUpdateTargetMonths(val);
                }}
                className="bg-white border border-slate-300 rounded-lg px-2 py-1 text-xs font-bold text-slate-800"
              >
                <option value={3}>3 Months</option>
                <option value={4}>4 Months</option>
                <option value={6}>6 Months (Recommended)</option>
                <option value={9}>9 Months</option>
                <option value={12}>12 Months</option>
              </select>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
