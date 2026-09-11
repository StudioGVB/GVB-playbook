import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Wallet, ArrowRight } from 'lucide-react';

interface EmptyFinanceStateProps {
  onSyncClick?: () => void;
}

export function EmptyFinanceState({ onSyncClick }: EmptyFinanceStateProps) {
  return (
    <Card className="metric-card">
      <CardContent className="p-10 text-center">
        <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
          <Wallet className="w-8 h-8 text-primary" />
        </div>
        <h3 className="text-lg font-bold text-foreground mb-2">No data yet</h3>
        <p className="text-sm text-muted-foreground mb-6 max-w-sm mx-auto">
          Import a CSV or connect your bank to start tracking your finances. Your dashboards will light up once data flows in ✨
        </p>
        {onSyncClick && (
          <Button onClick={onSyncClick} className="gap-2 rounded-xl">
            Get started <ArrowRight className="w-4 h-4" />
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
