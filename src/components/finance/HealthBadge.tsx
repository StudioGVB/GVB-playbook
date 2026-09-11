interface HealthBadgeProps {
  status: 'safe' | 'caution' | 'danger';
  label?: string;
  className?: string;
}

const STATUS_STYLES = {
  safe: { bg: 'bg-success/12', text: 'text-success', dot: 'bg-success', defaultLabel: 'Safe' },
  caution: { bg: 'bg-warning/12', text: 'text-[hsl(var(--warning))]', dot: 'bg-[hsl(var(--warning))]', defaultLabel: 'Caution' },
  danger: { bg: 'bg-destructive/12', text: 'text-destructive', dot: 'bg-destructive', defaultLabel: 'Danger' },
};

export function HealthBadge({ status, label, className = '' }: HealthBadgeProps) {
  const s = STATUS_STYLES[status];
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${s.bg} ${s.text} ${className}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {label || s.defaultLabel}
    </span>
  );
}
