import { useState } from 'react';

export type TimeRange = '1d' | '7d' | '30d' | '3m' | '6m' | '12m';

export const TIME_RANGE_OPTIONS: { key: TimeRange; label: string }[] = [
  { key: '7d', label: '7D' },
  { key: '30d', label: '30D' },
  { key: '3m', label: '3M' },
  { key: '6m', label: '6M' },
  { key: '12m', label: '12M' },
];

export function getTimeRangeDays(range: TimeRange): number {
  switch (range) {
    case '1d': return 1;
    case '7d': return 7;
    case '30d': return 30;
    case '3m': return 90;
    case '6m': return 180;
    case '12m': return 365;
  }
}

export function getTimeRangeMonths(range: TimeRange): number {
  switch (range) {
    case '1d': return 1;
    case '7d': return 1;
    case '30d': return 1;
    case '3m': return 3;
    case '6m': return 6;
    case '12m': return 12;
  }
}

interface TimeRangeFilterProps {
  value: TimeRange;
  onChange: (range: TimeRange) => void;
}

export function TimeRangeFilter({ value, onChange }: TimeRangeFilterProps) {
  return (
    <div className="flex gap-1 bg-card rounded-2xl p-1 w-fit border border-border/60 shadow-sm">
      {TIME_RANGE_OPTIONS.map(({ key, label }) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all duration-200 ${
            value === key
              ? 'bg-primary text-primary-foreground shadow-md'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function useTimeRange(defaultRange: TimeRange = '3m') {
  const [range, setRange] = useState<TimeRange>(defaultRange);
  return { range, setRange };
}
