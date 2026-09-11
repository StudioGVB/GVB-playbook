import TransferReview from '@/components/finance/TransferReview';
import { useFinanceData } from '@/hooks/useFinanceData';

export default function FinanceTransfersPage() {
  const finance = useFinanceData();

  if (finance.loading) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-foreground">Transfers</h1>
        <div className="text-muted-foreground animate-pulse">Loading...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Transfers</h1>
        <p className="text-muted-foreground text-sm">Match and review inter-account transfers</p>
      </div>
      <TransferReview finance={finance} />
    </div>
  );
}
