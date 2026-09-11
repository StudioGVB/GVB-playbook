import { Card, CardContent } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Info } from 'lucide-react';

export interface HeroCardProps {
  primaryMetric: string | React.ReactNode;
  subtitle: string;
  secondaryLine?: string;
  chips?: { label: string; value: string }[];
  tooltip?: string;
  className?: string;
  accentColor?: 'primary' | 'success' | 'accent' | 'purple';
}

const ACCENT_STYLES = {
  primary: {
    border: 'border-primary/20',
    glow: 'from-primary/8 to-transparent',
    metricColor: 'text-primary',
  },
  success: {
    border: 'border-success/20',
    glow: 'from-success/8 to-transparent',
    metricColor: 'text-success',
  },
  accent: {
    border: 'border-[hsl(var(--accent-purple)/0.2)]',
    glow: 'from-[hsl(var(--accent-purple)/0.08)] to-transparent',
    metricColor: 'text-[hsl(var(--accent-purple))]',
  },
  purple: {
    border: 'border-[hsl(var(--accent-purple)/0.2)]',
    glow: 'from-[hsl(var(--accent-purple)/0.08)] to-transparent',
    metricColor: 'text-[hsl(var(--accent-purple))]',
  },
};

export function HeroCard({
  primaryMetric,
  subtitle,
  secondaryLine,
  chips = [],
  tooltip,
  className = '',
  accentColor = 'primary',
}: HeroCardProps) {
  const style = ACCENT_STYLES[accentColor] || ACCENT_STYLES.primary;

  return (
    <Card className={`${style.border} overflow-hidden ${className}`}>
      {/* Subtle gradient glow at top */}
      <div className={`h-1 bg-gradient-to-r ${style.glow}`} />
      <CardContent className="p-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-6">
          <div className="flex-1">
            <p className="text-xs text-muted-foreground uppercase tracking-widest flex items-center gap-1.5 mb-2">
              {subtitle}
              {tooltip && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="w-3 h-3 text-muted-foreground/50 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent side="right" className="max-w-[220px] text-xs">
                    {tooltip}
                  </TooltipContent>
                </Tooltip>
              )}
            </p>
            <p className="text-4xl sm:text-5xl font-extrabold tracking-tight">
              {typeof primaryMetric === 'string' ? (
                <span className={style.metricColor}>{primaryMetric}</span>
              ) : primaryMetric}
            </p>
            {secondaryLine && (
              <p className="text-xs text-muted-foreground mt-1.5">{secondaryLine}</p>
            )}
          </div>

          {chips.length > 0 && (
            <div className="flex flex-wrap gap-2 sm:flex-col sm:items-end justify-start sm:justify-end">
              {chips.map((chip, idx) => (
                <div key={idx} className="bg-muted/50 rounded-xl px-3.5 py-2.5 text-right border border-border/50">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{chip.label}</p>
                  <p className="text-sm font-bold text-foreground">{chip.value}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
