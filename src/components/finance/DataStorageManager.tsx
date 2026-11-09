import { useState, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Database, Download, Trash2, ShieldCheck, Sparkles, HardDrive, CheckCircle2, AlertTriangle, RefreshCw, Plane, History } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { format, parseISO, subDays } from 'date-fns';
import type { FinanceTransaction } from '@/hooks/useFinanceData';

interface Props {
  user: any;
  transactions: FinanceTransaction[];
  accounts: any[];
  categories: any[];
  goals: any[];
  trips: any[];
  settings: any;
  assumptions: any;
  onRefresh: () => Promise<void>;
}

export default function DataStorageManager({
  user,
  transactions,
  accounts,
  categories,
  goals,
  trips,
  settings,
  assumptions,
  onRefresh,
}: Props) {
  const [isExporting, setIsExporting] = useState(false);
  const [isSlimming, setIsSlimming] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [isTestingWrite, setIsTestingWrite] = useState(false);
  const [writeTestStatus, setWriteTestStatus] = useState<'idle' | 'success' | 'readonly' | 'error'>('idle');
  const [writeTestMsg, setWriteTestMsg] = useState('');

  // 90 days threshold date
  const cutoffDate90 = useMemo(() => subDays(new Date(), 90), []);

  // Trip date ranges to protect Holiday Mode
  const tripIntervals = useMemo(() => {
    return (trips || []).map((t) => {
      try {
        const start = parseISO(String(t.start_date).split('T')[0]);
        const end = parseISO(String(t.end_date).split('T')[0]);
        return { id: t.id, name: t.name, start, end, goalId: t.goal_id };
      } catch {
        return null;
      }
    }).filter(Boolean) as Array<{ id: string; name: string; start: Date; end: Date; goalId?: string }>;
  }, [trips]);

  // Analyze transaction storage distribution
  const analysis = useMemo(() => {
    let olderThan90Count = 0;
    let tripTaggedCount = 0;
    let bloatedRawCount = 0;
    let oldestDate: Date | null = null;
    let newestDate: Date | null = null;

    for (const tx of transactions) {
      const d = new Date(tx.posted_at);
      if (!oldestDate || d < oldestDate) oldestDate = d;
      if (!newestDate || d > newestDate) newestDate = d;

      if (d < cutoffDate90) {
        olderThan90Count++;
      }

      // Check if linked to holiday mode / trip
      const isTrip = Boolean(
        tx.trip_id ||
        tripIntervals.some(ti => (ti.goalId && ti.goalId === tx.goal_id) || (d >= ti.start && d <= ti.end))
      );
      if (isTrip) tripTaggedCount++;

      // Check bloated raw JSON
      if (tx.raw && JSON.stringify(tx.raw).length > 60) {
        bloatedRawCount++;
      }
    }

    return {
      total: transactions.length,
      olderThan90Count,
      recent90Count: Math.max(0, transactions.length - olderThan90Count),
      tripTaggedCount,
      bloatedRawCount,
      oldestDate: oldestDate ? format(oldestDate, 'MMM d, yyyy') : 'N/A',
      newestDate: newestDate ? format(newestDate, 'MMM d, yyyy') : 'N/A',
    };
  }, [transactions, cutoffDate90, tripIntervals]);

  // Export complete JSON backup
  const handleExportBackup = () => {
    setIsExporting(true);
    try {
      const backupData = {
        exportedAt: new Date().toISOString(),
        version: '1.0',
        user: { id: user?.id, email: user?.email },
        summary: {
          transactionsCount: transactions.length,
          accountsCount: accounts.length,
          categoriesCount: categories.length,
          goalsCount: goals.length,
          tripsCount: trips.length,
        },
        accounts,
        categories,
        goals,
        trips,
        settings,
        assumptions,
        transactions,
      };

      const jsonStr = JSON.stringify(backupData, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `GVB_Finance_Full_Backup_${format(new Date(), 'yyyy-MM-dd')}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success('Full database backup downloaded successfully! 📁');
    } catch (e: any) {
      toast.error('Export failed: ' + (e?.message || 'Unknown error'));
    } finally {
      setIsExporting(false);
    }
  };

  // Test Supabase Write Access (Diagnose Read-Only mode)
  const handleTestWriteAccess = async () => {
    if (!user) return;
    setIsTestingWrite(true);
    setWriteTestStatus('idle');
    setWriteTestMsg('');

    try {
      // Test 1: Try updating a tiny field on finance_settings with current timestamp
      const nowIso = new Date().toISOString();
      const { error: setErr } = await supabase
        .from('finance_settings')
        .update({ updated_at: nowIso } as any)
        .eq('user_id', user.id);

      if (setErr) {
        const msg = setErr.message || '';
        if (msg.toLowerCase().includes('read-only') || msg.toLowerCase().includes('readonly')) {
          setWriteTestStatus('readonly');
          setWriteTestMsg('Database is in READ-ONLY mode due to storage limits. Run Quick Slim below to reclaim disk space!');
        } else {
          setWriteTestStatus('error');
          setWriteTestMsg(msg);
        }
      } else {
        setWriteTestStatus('success');
        setWriteTestMsg('Supabase writes are working! Database has active read & write access.');
        toast.success('Write test successful: Supabase is accepting updates.');
      }
    } catch (e: any) {
      setWriteTestStatus('error');
      setWriteTestMsg(e?.message || 'Write test threw an unexpected error.');
    } finally {
      setIsTestingWrite(false);
    }
  };

  // Quick Slim: Strip bloated raw JSON payloads and purge old import logs
  const handleQuickSlim = async () => {
    if (!user) return;
    setIsSlimming(true);
    const toastId = toast.loading('Slimming transaction metadata & purging debug logs...');

    try {
      // 1. Purge import logs older than 7 days
      const sevenDaysAgo = subDays(new Date(), 7).toISOString();
      const { error: logErr } = await supabase
        .from('finance_import_logs')
        .delete()
        .lt('created_at', sevenDaysAgo);

      if (logErr) {
        console.warn('Import logs cleanup notice:', logErr);
      }

      // 2. Identify transactions with bloated raw payload (>60 chars)
      const bloatedTxs = transactions.filter(t => t.raw && JSON.stringify(t.raw).length > 60);

      // Clean in chunks of 50
      const CHUNK_SIZE = 50;
      let cleanedCount = 0;

      for (let i = 0; i < bloatedTxs.length; i += CHUNK_SIZE) {
        const chunk = bloatedTxs.slice(i, i + CHUNK_SIZE);
        const updates = chunk.map(t => {
          // Preserve critical lightweight fields (e.g. paycheck flag or message) while stripping heavy API nested dumps
          const raw = t.raw as any;
          const slimRaw = (raw?.paycheck_allocated || raw?.message)
            ? { paycheck_allocated: raw.paycheck_allocated || undefined, message: raw.message || undefined }
            : null;

          return supabase
            .from('finance_transactions')
            .update({ raw: slimRaw } as any)
            .eq('id', t.id);
        });

        await Promise.all(updates);
        cleanedCount += chunk.length;
      }

      toast.success(
        `🎉 Storage Slim Complete! Cleaned ${cleanedCount} bloated transactions and purged old sync logs.`,
        { id: toastId }
      );
      await onRefresh();
    } catch (e: any) {
      toast.error('Slimming failed: ' + (e?.message || 'Unknown error'), { id: toastId });
    } finally {
      setIsSlimming(false);
    }
  };

  // Archive & Roll Old Transactions (>90 Days) while protecting Holiday Mode
  const handleArchiveOldTransactions = async () => {
    if (!user) return;
    if (!window.confirm(
      `This will aggregate ${analysis.olderThan90Count} transactions older than 90 days into monthly totals and remove the old individual line items to free up database space.\n\nAll Holiday Mode trips and active goals are 100% protected and will NOT be deleted.\n\nHave you exported a backup first?`
    )) {
      return;
    }

    setIsArchiving(true);
    const toastId = toast.loading('Aggregating historical transactions and pruning database...');

    try {
      // Find candidate transactions older than 90 days that are NOT tied to Holiday Mode
      const candidates = transactions.filter(tx => {
        const d = new Date(tx.posted_at);
        if (d >= cutoffDate90) return false; // Keep recent 90 days

        // Protect Holiday Mode trips & tagged transactions
        const isTrip = Boolean(
          tx.trip_id ||
          tripIntervals.some(ti => (ti.goalId && ti.goalId === tx.goal_id) || (d >= ti.start && d <= ti.end))
        );
        if (isTrip) return false;

        // Protect transactions with explicitly assigned goals
        if (tx.goal_id) return false;

        return true;
      });

      if (candidates.length === 0) {
        toast.info('No unlinked historical transactions found to prune.', { id: toastId });
        setIsArchiving(false);
        return;
      }

      // Group candidates by month & category to store local archive summaries
      const monthlyArchive: Record<string, Record<string, { total: number; count: number }>> = {};
      const storedSummaries = JSON.parse(localStorage.getItem('gvb_archived_monthly_summaries') || '{}');

      for (const tx of candidates) {
        const mKey = tx.posted_at.slice(0, 7); // e.g. '2026-03'
        const catKey = tx.category_id || 'uncategorised';
        monthlyArchive[mKey] ||= {};
        monthlyArchive[mKey][catKey] ||= { total: 0, count: 0 };
        monthlyArchive[mKey][catKey].total += Number(tx.amount) || 0;
        monthlyArchive[mKey][catKey].count += 1;
      }

      // Merge into local archive storage so historical monthly views never lose the data
      for (const [m, cats] of Object.entries(monthlyArchive)) {
        storedSummaries[m] ||= {};
        for (const [c, data] of Object.entries(cats)) {
          storedSummaries[m][c] ||= { total: 0, count: 0 };
          storedSummaries[m][c].total += data.total;
          storedSummaries[m][c].count += data.count;
        }
      }
      localStorage.setItem('gvb_archived_monthly_summaries', JSON.stringify(storedSummaries));

      // Delete candidate IDs in chunks of 50
      const idsToDelete = candidates.map(c => c.id);
      const CHUNK_SIZE = 50;
      let deletedCount = 0;

      for (let i = 0; i < idsToDelete.length; i += CHUNK_SIZE) {
        const chunk = idsToDelete.slice(i, i + CHUNK_SIZE);
        const { error } = await supabase
          .from('finance_transactions')
          .delete()
          .in('id', chunk);

        if (error) throw error;
        deletedCount += chunk.length;
      }

      toast.success(
        `🎉 Successfully archived ${deletedCount} old transactions! Holiday Mode and recent 90-day records were preserved.`,
        { id: toastId }
      );
      await onRefresh();
    } catch (e: any) {
      toast.error('Archival failed: ' + (e?.message || 'Unknown error'), { id: toastId });
    } finally {
      setIsArchiving(false);
    }
  };

  return (
    <Card className="border-2 border-slate-200 shadow-sm overflow-hidden font-body">
      <CardHeader className="bg-gradient-to-r from-slate-50 via-teal-50/40 to-slate-50 border-b border-slate-200/80 pb-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-teal-100 flex items-center justify-center text-teal-800">
              <HardDrive className="w-5 h-5" />
            </div>
            <div>
              <CardTitle className="text-base font-bold font-display text-slate-900 flex items-center gap-2">
                Database & Storage Health
                <Badge variant="outline" className="bg-white/80 text-[10px] text-teal-800 border-teal-300">
                  Free Tier Optimizer
                </Badge>
              </CardTitle>
              <CardDescription className="text-xs text-slate-600">
                Keep the GVB Playbook permanently under Supabase's free limits without losing financials or Holiday Mode
              </CardDescription>
            </div>
          </div>

          <Button
            size="sm"
            variant="outline"
            onClick={handleTestWriteAccess}
            disabled={isTestingWrite}
            className="h-8 text-xs font-semibold gap-1.5 bg-white hover:bg-slate-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isTestingWrite ? 'animate-spin' : ''}`} />
            Test Supabase Writes
          </Button>
        </div>
      </CardHeader>

      <CardContent className="p-5 space-y-5">
        {/* Write Test Alert if triggered */}
        {writeTestStatus !== 'idle' && (
          <div className={`p-3 rounded-xl border text-xs flex items-center gap-2.5 ${
            writeTestStatus === 'success'
              ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
              : writeTestStatus === 'readonly'
              ? 'bg-rose-50 border-rose-300 text-rose-900'
              : 'bg-amber-50 border-amber-300 text-amber-900'
          }`}>
            {writeTestStatus === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />}
            {writeTestStatus === 'readonly' && <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />}
            {writeTestStatus === 'error' && <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />}
            <span className="font-medium leading-relaxed">{writeTestMsg}</span>
          </div>
        )}

        {/* Live Metrics Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80">
            <span className="text-[11px] text-slate-500 font-medium block">Total Transactions</span>
            <span className="text-xl font-bold font-display text-slate-900 mt-0.5 block">
              {analysis.total.toLocaleString()}
            </span>
            <span className="text-[10px] text-slate-400">Stored in Supabase</span>
          </div>

          <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80">
            <span className="text-[11px] text-slate-500 font-medium block">Active Window (&le;90d)</span>
            <span className="text-xl font-bold font-display text-emerald-700 mt-0.5 block">
              {analysis.recent90Count.toLocaleString()}
            </span>
            <span className="text-[10px] text-slate-400">Daily living & pots</span>
          </div>

          <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80">
            <span className="text-[11px] text-slate-500 font-medium block">Holiday Mode Records</span>
            <span className="text-xl font-bold font-display text-teal-700 mt-0.5 block flex items-center gap-1">
              <Plane className="w-4 h-4" /> {analysis.tripTaggedCount.toLocaleString()}
            </span>
            <span className="text-[10px] text-emerald-600 font-semibold">100% Protected</span>
          </div>

          <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80">
            <span className="text-[11px] text-slate-500 font-medium block">Older History (&gt;90d)</span>
            <span className="text-xl font-bold font-display text-amber-700 mt-0.5 block">
              {analysis.olderThan90Count.toLocaleString()}
            </span>
            <span className="text-[10px] text-slate-400">Eligible for roll-up</span>
          </div>
        </div>

        {/* Protection Notice */}
        <div className="p-3 rounded-xl bg-teal-50/70 border border-teal-200 text-xs text-teal-950 flex items-start gap-2.5">
          <ShieldCheck className="w-4 h-4 text-teal-700 shrink-0 mt-0.5" />
          <p className="leading-relaxed">
            <strong>Core Financials & Holiday Mode Protection:</strong> Accounts, goals, categories, living reserves, and <strong>all Holiday Mode trips</strong> are permanent and never deleted. Cleanups only target bloated JSON metadata and ancient grocery/coffee receipts.
          </p>
        </div>

        {/* Action Panel */}
        <div className="space-y-3 pt-1">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-slate-500" />
            Storage Actions
          </h4>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* Step 1: Backup */}
            <div className="p-4 rounded-xl border border-slate-200 bg-white space-y-3 flex flex-col justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-1.5">
                  <Download className="w-4 h-4 text-slate-700" />
                  <h5 className="font-bold text-xs text-slate-900">1. Download Full Backup</h5>
                </div>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Export all transactions, accounts, goals, and trips to a local JSON file on your computer.
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={handleExportBackup}
                disabled={isExporting}
                className="w-full text-xs font-semibold gap-1.5"
              >
                <Download className="w-3.5 h-3.5" /> Export .JSON Backup
              </Button>
            </div>

            {/* Step 2: Quick Slim */}
            <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50/40 space-y-3 flex flex-col justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-emerald-700" />
                  <h5 className="font-bold text-xs text-emerald-950">2. Strip Heavy Metadata</h5>
                </div>
                <p className="text-[11px] text-emerald-800 leading-relaxed">
                  Removes giant raw API JSON blobs and purges old sync logs. <strong>No transactions deleted</strong>. Saves up to 70% space!
                </p>
              </div>
              <Button
                size="sm"
                onClick={handleQuickSlim}
                disabled={isSlimming}
                className="w-full text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSlimming ? 'animate-spin' : ''}`} /> Strip Bloated Metadata
              </Button>
            </div>

            {/* Step 3: Archive >90d */}
            <div className="p-4 rounded-xl border border-amber-200 bg-amber-50/40 space-y-3 flex flex-col justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-1.5">
                  <History className="w-4 h-4 text-amber-800" />
                  <h5 className="font-bold text-xs text-amber-950">3. Archive Old (&gt;90d)</h5>
                </div>
                <p className="text-[11px] text-amber-900 leading-relaxed">
                  Condenses older transactions into monthly totals while protecting all Holiday Mode records.
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={handleArchiveOldTransactions}
                disabled={isArchiving || analysis.olderThan90Count === 0}
                className="w-full text-xs font-bold border-amber-300 text-amber-900 hover:bg-amber-100"
              >
                <Trash2 className="w-3.5 h-3.5 text-amber-700" /> Archive {analysis.olderThan90Count} Old Records
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
