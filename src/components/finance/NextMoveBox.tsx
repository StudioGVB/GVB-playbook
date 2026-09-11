import { Card, CardContent } from '@/components/ui/card';
import { Sparkles, ChevronRight } from 'lucide-react';

interface NextMoveBoxProps {
  items: string[];
}

export function NextMoveBox({ items }: NextMoveBoxProps) {
  if (!items.length) return null;

  return (
    <Card className="bg-primary/5 border-primary/15">
      <CardContent className="p-4">
        <p className="text-xs font-bold uppercase tracking-widest text-primary mb-2.5 flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5" /> Next move
        </p>
        <ul className="space-y-2">
          {items.map((item, idx) => (
            <li key={idx} className="flex gap-2 text-sm text-foreground leading-relaxed">
              <ChevronRight className="w-4 h-4 text-primary/60 flex-shrink-0 mt-0.5" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
