interface DonutChartProps {
  spent: number;
  budget: number;
  color?: string;
  label: string;
  formattedSpent: string;
  subtitle?: string;
  size?: number;
}

export function DonutChart({ spent, budget, color = 'hsl(var(--primary))', label, formattedSpent, subtitle, size = 100 }: DonutChartProps) {
  const strokeWidth = 7;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const percent = budget > 0 ? Math.min(spent / budget, 1) : 0;
  const offset = circumference * (1 - percent);
  const isOver = spent > budget;

  return (
    <div className="flex flex-col items-center gap-1.5 min-w-[90px]">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="hsl(var(--muted))"
            strokeWidth={strokeWidth}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={isOver ? 'hsl(var(--destructive))' : color}
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            className="transition-all duration-500"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={`text-xs font-bold tabular-nums ${isOver ? 'text-destructive' : ''}`}>
            {formattedSpent}
          </span>
        </div>
      </div>
      <div className="flex flex-col items-center gap-0.5">
        <span className="text-[11px] text-muted-foreground font-medium text-center leading-tight max-w-[100px] truncate">
          {label}
        </span>
        {subtitle && (
          <span className="text-[9px] text-muted-foreground/70 tabular-nums">
            {subtitle}
          </span>
        )}
      </div>
    </div>
  );
}
