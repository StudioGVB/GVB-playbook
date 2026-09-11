interface Segment {
  color: string;
  value: number;
  label: string;
}

interface MultiSegmentDonutProps {
  segments: Segment[];
  total: number;
  centerTop: string;
  centerBottom: string;
  size?: number;
}

export function MultiSegmentDonut({ segments, total, centerTop, centerBottom, size = 120 }: MultiSegmentDonutProps) {
  const strokeWidth = 10;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const totalSpent = segments.reduce((s, seg) => s + seg.value, 0);
  const isOver = totalSpent > total;

  let accumulated = 0;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        {/* Background track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="hsl(var(--muted))"
          strokeWidth={strokeWidth}
        />
        {/* Segments */}
        {segments
          .filter(seg => seg.value > 0)
          .map((seg, i) => {
            const segLen = total > 0 ? (seg.value / total) * circumference : 0;
            const offset = circumference - accumulated;
            accumulated += segLen;
            return (
              <circle
                key={i}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={seg.color}
                strokeWidth={strokeWidth}
                strokeDasharray={`${segLen} ${circumference - segLen}`}
                strokeDashoffset={offset}
                strokeLinecap="round"
                className="transition-all duration-500"
              />
            );
          })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-sm font-bold tabular-nums ${isOver ? 'text-destructive' : ''}`}>
          {centerTop}
        </span>
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {centerBottom}
        </span>
      </div>
    </div>
  );
}
