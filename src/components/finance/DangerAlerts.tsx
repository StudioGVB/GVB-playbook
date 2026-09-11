import { useMemo } from 'react';
import { TrendingDown, Shield, Target, Clock, AlertTriangle, CheckCircle2, Gauge } from 'lucide-react';
import { startOfWeek, endOfWeek, differenceInDays } from 'date-fns';
import { PolicySnapshot } from '@/lib/policyEngine';
import type { FinanceGoal } from '@/hooks/useFinanceData';
import { formatCurrency } from '@/lib/financeUtils';

interface Props {
  snapshot: PolicySnapshot;
  goals: FinanceGoal[];
  baseCurrency: string;
  monthlyIncome: number;
}

type KPIStatus = 'healthy' | 'warning' | 'danger';

interface KPI {
  id: string;
  label: string;
  value: string;
  subtext: string;
  status: KPIStatus;
  icon: typeof TrendingDown;
}

export default function DangerAlerts({ snapshot, goals, baseCurrency, monthlyIncome }: Props) {
  const fmt = (n: number) => formatCurrency(n, baseCurrency);

  const kpis = useMemo(() => {
    const result: KPI[] = [];
    const now = new Date();
    const weekStart = startOfWeek(now, { weekStartsOn: 1 });
    const weekEnd = endOfWeek(now, { weekStartsOn: 1 });
    const daysLeft = Math.max(1, differenceInDays(weekEnd, now));
    const daysPassed = differenceInDays(now, weekStart) + 1;

    // 1. Weekly Pace KPI
    const dailyRate = daysPassed > 0 && snapshot.spentThisWeek > 0 ? snapshot.spentThisWeek / daysPassed : 0;
    const projectedTotal = dailyRate * 7;
    const paceRatio = snapshot.weeklyFunBudget > 0 ? projectedTotal / snapshot.weeklyFunBudget : 0;
    const paceStatus: KPIStatus = paceRatio > 1.3 ? 'danger' : paceRatio > 1.0 ? 'warning' : 'healthy';

    result.push({
      id: 'pace',
      label: 'Weekly Pace',
      value: paceRatio > 0 ? `${Math.round(paceRatio * 100)}%` : '—',
      subtext: paceStatus === 'healthy'
        ? `On track — ${fmt(snapshot.remainingWeeklyFun / daysLeft)}/day safe`
        : `Projected ${fmt(projectedTotal)} of ${fmt(snapshot.weeklyFunBudget)}`,
      status: paceStatus,
      icon: paceStatus === 'healthy' ? CheckCircle2 : TrendingDown,
    });

    // 2. Emergency Buffer KPI
    const bufferRatio = snapshot.bufferMonths > 0 ? snapshot.currentBufferMonths / snapshot.bufferMonths : 1;
    const bufferStatus: KPIStatus = bufferRatio < 0.5 ? 'danger' : bufferRatio < 1.0 ? 'warning' : 'healthy';

    result.push({
      id: 'buffer',
      label: 'Emergency Buffer',
      value: `${snapshot.currentBufferMonths.toFixed(1)}mo`,
      subtext: bufferStatus === 'healthy'
        ? `Target ${snapshot.bufferMonths}mo met ✓`
        : `${(snapshot.bufferMonths - snapshot.currentBufferMonths).toFixed(1)}mo below ${snapshot.bufferMonths}mo target`,
      status: bufferStatus,
      icon: Shield,
    });

    // 3. Runway KPI (drawdown only)
    if (snapshot.isDrawdownMode) {
      const actualRunway = dailyRate > 0 ? snapshot.livingPool / (dailyRate * 7) : snapshot.weeksUntilIncome;
      const runwayRatio = snapshot.weeksUntilIncome > 0 ? actualRunway / snapshot.weeksUntilIncome : 1;
      const runwayStatus: KPIStatus = runwayRatio < 0.7 ? 'danger' : runwayRatio < 0.95 ? 'warning' : 'healthy';

      result.push({
        id: 'runway',
        label: 'Spending Runway',
        value: `${Math.round(actualRunway)}w`,
        subtext: runwayStatus === 'healthy'
          ? `Covers all ${Math.round(snapshot.weeksUntilIncome)} weeks ✓`
          : `Need ${Math.round(snapshot.weeksUntilIncome)}w — short by ${Math.round(snapshot.weeksUntilIncome - actualRunway)}w`,
        status: runwayStatus,
        icon: Clock,
      });
    }

    // 4. Goals at risk
    const atRiskGoals = goals.filter(goal => {
      if (!goal.deadline) return false;
      const deadlineDate = new Date(goal.deadline);
      if (deadlineDate <= now) return false;
      const remaining = goal.target_amount - goal.assigned_amount;
      if (remaining <= 0) return false;
      const weeksUntilDeadline = differenceInDays(deadlineDate, now) / 7;
      const weeklyAlloc = monthlyIncome > 0 ? (goal.percent_allocation / 100) * monthlyIncome / 4.33 : 0;
      if (weeklyAlloc <= 0) return false;
      return remaining / weeklyAlloc > weeksUntilDeadline;
    });

    if (atRiskGoals.length > 0) {
      result.push({
        id: 'goals',
        label: 'Goals Health',
        value: `${atRiskGoals.length} at risk`,
        subtext: atRiskGoals.map(g => g.name).join(', '),
        status: 'warning',
        icon: Target,
      });
    } else if (goals.length > 0) {
      result.push({
        id: 'goals',
        label: 'Goals Health',
        value: 'On track',
        subtext: `${goals.length} goal${goals.length > 1 ? 's' : ''} progressing`,
        status: 'healthy',
        icon: Target,
      });
    }

    return result;
  }, [snapshot, goals, baseCurrency, monthlyIncome]);

  if (kpis.length === 0) return null;

  const statusStyles = {
    healthy: { bg: 'bg-emerald-500/5', border: 'border-emerald-500/15', dot: 'bg-emerald-500', text: 'text-emerald-600' },
    warning: { bg: 'bg-amber-500/5', border: 'border-amber-500/15', dot: 'bg-amber-500', text: 'text-amber-600' },
    danger: { bg: 'bg-destructive/5', border: 'border-destructive/15', dot: 'bg-destructive', text: 'text-destructive' },
  };

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {kpis.map(kpi => {
        const Icon = kpi.icon;
        const styles = statusStyles[kpi.status];
        return (
          <div
            key={kpi.id}
            className={`rounded-xl border p-4 ${styles.bg} ${styles.border}`}
          >
            <div className="flex items-center gap-2 mb-2">
              <div className={`w-2 h-2 rounded-full ${styles.dot}`} />
              <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">{kpi.label}</span>
            </div>
            <div className="flex items-center gap-2">
              <Icon className={`w-4 h-4 ${styles.text}`} />
              <span className={`text-xl font-black tabular-nums ${styles.text}`}>{kpi.value}</span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1.5 leading-relaxed">{kpi.subtext}</p>
          </div>
        );
      })}
    </div>
  );
}
