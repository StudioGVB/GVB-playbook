import { ReactNode, MouseEvent } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { LucideIcon, Plus } from 'lucide-react';

interface MetricCardProps {
  label: string;
  value: string;
  icon?: LucideIcon;
  delta?: string;
  deltaType?: 'positive' | 'negative' | 'neutral';
  subtitle?: ReactNode;
  className?: string;
  valueClassName?: string;
  onClick?: () => void;
  onAction?: () => void;
  actionIcon?: LucideIcon;
  actionDisabled?: boolean;
}

export function MetricCard({ label, value, icon: Icon, delta, deltaType = 'neutral', subtitle, className = '', valueClassName = '', onClick, onAction, actionIcon: ActionIcon = Plus, actionDisabled }: MetricCardProps) {
  const handleAction = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    onAction?.();
  };

  return (
    <Card
      className={`metric-card group hover:shadow-md transition-shadow relative ${onClick ? 'cursor-pointer' : ''} ${className}`}
      onClick={onClick}
    >
      {onAction && (
        <button
          onClick={handleAction}
          disabled={actionDisabled}
          className="absolute top-2 right-2 w-6 h-6 rounded-full bg-muted/60 hover:bg-muted flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-30 disabled:cursor-not-allowed z-10"
        >
          <ActionIcon className="w-3.5 h-3.5 text-muted-foreground" />
        </button>
      )}
      <CardContent className="p-3 sm:p-5">
        {/* Label + icon row */}
        <div className="flex items-center gap-1.5 mb-1.5">
          {Icon && <Icon className="w-3.5 h-3.5 text-muted-foreground/60" />}
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground/70">
            {label}
          </p>
        </div>

        {/* Main value */}
        <p className={`text-xl sm:text-2xl font-black tracking-tight leading-none ${valueClassName || 'text-primary'}`}>
          {value}
        </p>

        {/* Budget total */}
        {delta && (
          <p className="text-sm text-foreground/50 font-semibold mt-1 tabular-nums">
            {delta}
          </p>
        )}

        {/* Spent subtitle */}
        {subtitle && (
          <p className="text-xs text-muted-foreground/70 font-semibold mt-2 tabular-nums">
            {subtitle}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

