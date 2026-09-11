import { Card, CardContent } from '@/components/ui/card';

interface SectionCardProps {
  title: string;
  titleRight?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function SectionCard({ title, titleRight, children, className = '' }: SectionCardProps) {
  return (
    <Card className={`metric-card ${className}`}>
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{title}</p>
          {titleRight}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}
