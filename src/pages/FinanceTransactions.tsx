import { useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import FinanceTransactionsComponent from '@/components/finance/FinanceTransactions';
import { useFinanceData } from '@/hooks/useFinanceData';
import { useFixedExpenses } from '@/hooks/useFixedExpenses';
import { useAutoLinkFixedBills } from '@/hooks/useAutoLinkFixedBills';
import { Button } from '@/components/ui/button';
import { RefreshCw, ArrowLeftRight } from 'lucide-react';

export default function FinanceTransactionsPage() {
  const [searchParams] = useSearchParams();
  const initialAccount = searchParams.get('account') || undefined;
  const finance = useFinanceData();
  const { expenses: fixedExpenses } = useFixedExpenses();
  const [refreshing, setRefreshing] = useState(false);

  useAutoLinkFixedBills({
    transactions: finance.transactions as any,
    fixedExpenses: fixedExpenses as any,
    refetch: finance.refetch,
  });

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      // Check if Up is connected, then sync
      const hasUpAccounts = finance.accounts.some(a => a.provider === 'up' || a.source_type === 'up');
      if (hasUpAccounts) {
        await finance.syncUpTransactions();
      } else {
        await finance.refetch();
      }
    } catch {
      await finance.refetch();
    } finally {
      setRefreshing(false);
    }
  };

  if (finance.loading) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-foreground">Transactions</h1>
        <div className="text-muted-foreground animate-pulse">Loading...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Transactions</h1>
          <p className="text-muted-foreground text-sm">Full transaction history</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link to="/finance/transfers">
              <ArrowLeftRight className="w-4 h-4 mr-1.5" /> Transfers
            </Link>
          </Button>
          <Button variant="ghost" size="icon" onClick={handleRefresh} disabled={refreshing}>
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>
      <FinanceTransactionsComponent finance={finance} initialAccountFilter={initialAccount} fixedExpenses={fixedExpenses} />
    </div>
  );
}
