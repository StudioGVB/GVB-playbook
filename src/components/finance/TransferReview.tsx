import { useState, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowRight, Check, X, Loader2, ArrowLeftRight, Sparkles } from 'lucide-react';
import { formatCurrency } from '@/lib/financeUtils';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { supabase, SUPABASE_URL } from '@/integrations/supabase/client';
import type { useFinanceData } from '@/hooks/useFinanceData';

type Props = { finance: ReturnType<typeof useFinanceData> };

export default function TransferReview({ finance }: Props) {
  const { transactions, accounts, matchTransfers, refetch } = finance;
  const [processing, setProcessing] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  // Group suggested pairs only (paired OUT+IN)
  const suggestedPairs = useMemo(() => {
    const outTxs = transactions.filter(
      tx => tx.transfer_status === 'suggested' && tx.transfer_side === 'out' && tx.matched_transaction_id
    );
    return outTxs.map(outTx => {
      const inTx = transactions.find(t => t.id === outTx.matched_transaction_id);
      return { outTx, inTx };
    }).filter(p => p.inTx);
  }, [transactions]);

  const confirmedCount = transactions.filter(
    tx => tx.transfer_status === 'confirmed' || tx.transfer_status === 'auto_confirmed'
  ).length;
  const autoCount = transactions.filter(tx => tx.transfer_status === 'auto_confirmed').length;

  const getAccountName = (id: string) => accounts.find(a => a.id === id)?.account_name || 'Unknown';

  const handleConfirm = async (outId: string, inId: string) => {
    setProcessing(outId);
    try {
      const session = await supabase.auth.getSession();
      if (!session.data.session) { toast.error('Not authenticated'); return; }
      const response = await fetch(`${SUPABASE_URL}/functions/v1/match-transfers`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.data.session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'confirm', outId, inId }),
      });
      const data = await response.json();
      if (!response.ok) { toast.error(data.error || 'Confirm failed'); return; }
      toast.success('Transfer confirmed — excluded from dashboards');
      refetch();
    } catch (err) {
      toast.error('Network error');
    } finally {
      setProcessing(null);
    }
  };

  const handleReject = async (outId: string, inId: string) => {
    setProcessing(outId);
    try {
      const session = await supabase.auth.getSession();
      if (!session.data.session) { toast.error('Not authenticated'); return; }
      const response = await fetch(`${SUPABASE_URL}/functions/v1/match-transfers`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.data.session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'reject', outId, inId }),
      });
      const data = await response.json();
      if (!response.ok) { toast.error(data.error || 'Reject failed'); return; }
      toast.success('Marked as not a transfer');
      refetch();
    } catch (err) {
      toast.error('Network error');
    } finally {
      setProcessing(null);
    }
  };

  const handleScan = async () => {
    setScanning(true);
    await matchTransfers();
    setScanning(false);
  };

  return (
    <div className="space-y-6">
      {/* Stats row */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-bold text-foreground">Transfer Review</h2>
          <Badge variant="secondary" className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
            {suggestedPairs.length} to review
          </Badge>
          {confirmedCount > 0 && (
            <Badge variant="secondary" className="bg-[hsl(var(--success)/0.1)] text-[hsl(var(--success))]">
              {confirmedCount} confirmed
            </Badge>
          )}
          {autoCount > 0 && (
            <Badge variant="secondary" className="bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
              {autoCount} auto-matched
            </Badge>
          )}
        </div>
        <Button size="sm" onClick={handleScan} disabled={scanning} className="gap-1.5">
          {scanning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
          {scanning ? 'Scanning...' : 'Scan for Transfers'}
        </Button>
      </div>

      {/* Suggested pairs */}
      {suggestedPairs.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground">Suggested Pairs</h3>
          {suggestedPairs.map(({ outTx, inTx }) => (
            <Card key={outTx.id} className="border-amber-200/50 dark:border-amber-800/30">
              <CardContent className="p-4">
                <div className="flex items-center gap-4">
                  {/* Out side */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-red-300 text-red-600">OUT</Badge>
                      <span className="text-xs text-muted-foreground">{getAccountName(outTx.account_id)}</span>
                    </div>
                    <p className="text-sm font-medium truncate">{outTx.description}</p>
                    <p className="text-xs text-muted-foreground">{format(new Date(outTx.posted_at), 'dd MMM yyyy')}</p>
                    <p className="text-sm font-semibold mt-1">{formatCurrency(outTx.amount, outTx.currency)}</p>
                  </div>

                  {/* Arrow + confidence */}
                  <div className="flex flex-col items-center gap-1 shrink-0">
                    <ArrowRight className="w-5 h-5 text-muted-foreground" />
                    <Badge
                      variant="secondary"
                      className={`text-[9px] px-1.5 py-0 ${
                        (outTx.transfer_match_confidence || 0) >= 80
                          ? 'bg-[hsl(var(--success)/0.1)] text-[hsl(var(--success))]'
                          : (outTx.transfer_match_confidence || 0) >= 60
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-red-100 text-red-700'
                      }`}
                    >
                      {outTx.transfer_match_confidence || 0}%
                    </Badge>
                  </div>

                  {/* In side */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-green-300 text-green-600">IN</Badge>
                      <span className="text-xs text-muted-foreground">{getAccountName(inTx!.account_id)}</span>
                    </div>
                    <p className="text-sm font-medium truncate">{inTx!.description}</p>
                    <p className="text-xs text-muted-foreground">{format(new Date(inTx!.posted_at), 'dd MMM yyyy')}</p>
                    <p className="text-sm font-semibold text-[hsl(var(--success))] mt-1">{formatCurrency(inTx!.amount, inTx!.currency)}</p>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-col gap-1.5 shrink-0">
                    <Button size="sm" onClick={() => handleConfirm(outTx.id, inTx!.id)} disabled={processing === outTx.id} className="gap-1 text-xs">
                      {processing === outTx.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                      Confirm
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => handleReject(outTx.id, inTx!.id)} disabled={processing === outTx.id} className="gap-1 text-xs">
                      <X className="w-3 h-3" /> Not a Transfer
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Empty state */}
      {suggestedPairs.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center">
            <ArrowLeftRight className="w-10 h-10 mx-auto text-muted-foreground/30 mb-3" />
            <p className="text-muted-foreground text-sm">
              No transfer suggestions to review. Click "Scan for Transfers" after importing transactions.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
