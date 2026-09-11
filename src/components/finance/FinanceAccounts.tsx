import { useState, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Plus, Trash2, Wallet, RefreshCw, Loader2, Building2, Landmark, CreditCard, Upload, FileText, X, ArrowRight, Camera, Check, Eye, EyeOff } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { formatCurrency } from '@/lib/financeUtils';
import { parseBankCSV, parseNetBankMarkdown } from '@/lib/csvParser';
import { format, startOfWeek, startOfMonth, isAfter } from 'date-fns';
import { toast } from 'sonner';
import { supabase, SUPABASE_URL } from '@/integrations/supabase/client';
import type { useFinanceData } from '@/hooks/useFinanceData';

type Props = { finance: ReturnType<typeof useFinanceData> };

const BANK_OPTIONS = [
  { value: 'commbank', label: 'CommBank' },
  { value: 'up', label: 'Up Bank' },
  { value: 'wise', label: 'Wise' },
  { value: 'monzo', label: 'Monzo' },
  { value: 'other', label: 'Other' },
];

const PROVIDER_META: Record<string, { label: string; icon: typeof Building2; tint: string }> = {
  up: { label: 'Up Bank', icon: Landmark, tint: 'bg-[hsl(var(--warning)/0.1)] text-[hsl(var(--warning))]' },
  commbank: { label: 'CommBank', icon: Building2, tint: 'bg-[hsl(var(--warning)/0.1)] text-[hsl(var(--warning))]' },
  wise: { label: 'Wise', icon: CreditCard, tint: 'bg-[hsl(var(--success)/0.1)] text-[hsl(var(--success))]' },
  monzo: { label: 'Monzo', icon: CreditCard, tint: 'bg-[hsl(var(--primary)/0.1)] text-[hsl(var(--primary-foreground))]' },
  other: { label: 'Other', icon: Wallet, tint: 'bg-muted text-muted-foreground' },
  manual: { label: 'Manual', icon: Wallet, tint: 'bg-muted text-muted-foreground' },
};

function isConnectedAccount(acc: { source_type?: string }) {
  return acc.source_type === 'bank';
}

export default function FinanceAccounts({ finance }: Props) {
  const navigate = useNavigate();
  const { accounts, transactions, importTransactions, addAccount, updateAccount, deleteAccount, syncUpTransactions, syncWiseTransactions, syncMonzoTransactions, connectMonzo, categorizeTransactions, matchTransfers, importLogs, addImportLog, deleteImportLog, refetch } = finance;
  const hasUpAccounts = accounts.some(a => a.provider === 'up');
  const hasWiseAccounts = accounts.some(a => a.provider === 'wise');
  const hasMonzoAccounts = accounts.some(a => a.provider === 'monzo');
  const [syncing, setSyncing] = useState(false);
  const [wiseSyncing, setWiseSyncing] = useState(false);
  const [monzoSyncing, setMonzoSyncing] = useState(false);
  const [connectingMonzo, setConnectingMonzo] = useState(false);
  const [monzoTokenInput, setMonzoTokenInput] = useState('');
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('AUD');
  const [balance, setBalance] = useState('');
  const [bank, setBank] = useState('commbank');
  const [uploadingAccountId, setUploadingAccountId] = useState<string | null>(null);
  const [deletingLogId, setDeletingLogId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const snapshotRef = useRef<HTMLInputElement>(null);
  const [snapshotParsing, setSnapshotParsing] = useState(false);
  const [snapshotResults, setSnapshotResults] = useState<Array<{
    account_id: string | null;
    extracted_name: string;
    balance: number;
    currency: string;
    confidence: string;
    match_reason?: string;
    selected: boolean;
  }> | null>(null);

  // Import logs grouped by account
  const logsByAccount = useMemo(() => {
    const map: Record<string, typeof importLogs> = {};
    for (const log of importLogs) {
      if (!map[log.account_id]) map[log.account_id] = [];
      map[log.account_id].push(log);
    }
    return map;
  }, [importLogs]);

  // Spending stats per account (this week + this month, expenses only)
  const spendByAccount = useMemo(() => {
    const now = new Date();
    const weekStart = startOfWeek(now, { weekStartsOn: 1 });
    const monthStart = startOfMonth(now);
    const map: Record<string, { week: number; month: number }> = {};
    for (const tx of transactions) {
      if (tx.amount >= 0 || tx.is_transfer || tx.transfer_group_id) continue;
      const d = new Date(tx.posted_at);
      if (!map[tx.account_id]) map[tx.account_id] = { week: 0, month: 0 };
      if (isAfter(d, weekStart)) map[tx.account_id].week += Math.abs(tx.amount);
      if (isAfter(d, monthStart)) map[tx.account_id].month += Math.abs(tx.amount);
    }
    return map;
  }, [transactions]);

  const handleSync = async () => {
    setSyncing(true);
    await syncUpTransactions();
    setSyncing(false);
  };

  const handleWiseSync = async () => {
    setWiseSyncing(true);
    await syncWiseTransactions();
    setWiseSyncing(false);
  };

  const handleMonzoSync = async () => {
    setMonzoSyncing(true);
    await syncMonzoTransactions();
    setMonzoSyncing(false);
  };

  const handleLiveMonzoConnect = async () => {
    if (!monzoTokenInput.trim()) {
      toast.error('Please enter a Monzo Access Token');
      return;
    }
    setConnectingMonzo(true);
    const success = await connectMonzo(monzoTokenInput.trim());
    if (success) {
      setMonzoTokenInput('');
      setOpen(false);
    }
    setConnectingMonzo(false);
  };

  const handleAdd = async () => {
    if (!name.trim()) return;
    await addAccount({
      account_name: name.trim(),
      currency,
      provider: bank,
      balance: parseFloat(balance) || 0,
    });
    setName('');
    setBalance('');
    setBank('commbank');
    setOpen(false);
  };

  const handleSnapshotUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (!validTypes.includes(file.type)) {
      toast.error('Please upload a JPEG, PNG, WebP or PDF file');
      return;
    }

    setSnapshotParsing(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const base64 = btoa(
        new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
      );

      const session = await supabase.auth.getSession();
      if (!session.data.session) {
        toast.error('Not authenticated');
        return;
      }

      const response = await fetch(`${SUPABASE_URL}/functions/v1/parse-balance-snapshot`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.data.session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          image_base64: base64,
          mime_type: file.type,
          existing_accounts: accounts.map(a => ({
            id: a.id,
            account_name: a.account_name,
            currency: a.currency,
            provider: a.provider,
          })),
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({ error: 'Parse failed' }));
        toast.error(errData.error || 'Failed to extract balances');
        return;
      }

      const data = await response.json();
      if (!data.accounts || data.accounts.length === 0) {
        toast.warning('No accounts found in the image');
        return;
      }

      setSnapshotResults(data.accounts.map((a: any) => ({ ...a, selected: !!a.account_id && a.confidence !== 'low' })));
      toast.success(`Found ${data.accounts.length} account(s) — review below`);
    } catch (err) {
      console.error('Snapshot upload error:', err);
      toast.error('Failed to process snapshot');
    } finally {
      setSnapshotParsing(false);
      if (snapshotRef.current) snapshotRef.current.value = '';
    }
  };

  const handleApplySnapshot = async () => {
    if (!snapshotResults) return;
    const toApply = snapshotResults.filter(r => r.selected && r.account_id);
    let updated = 0;
    for (const result of toApply) {
      await updateAccount(result.account_id!, { balance: result.balance } as any);
      updated++;
    }
    toast.success(`Updated ${updated} account balance${updated !== 1 ? 's' : ''}`);
    setSnapshotResults(null);
    refetch();
  };

  const handleUploadClick = (accountId: string) => {
    setUploadingAccountId(accountId);
    fileRef.current?.click();
  };

  const handleDeleteImportLog = async (logId: string, fileName: string) => {
    if (window.confirm(`Delete the import log for "${fileName}"? This will remove all ${importLogs.find(l => l.id === logId)?.transactions_imported || 0} transactions imported from this file.`)) {
      try {
        setDeletingLogId(logId);
        await deleteImportLog(logId);
      } catch (err) {
        console.error('Delete error:', err);
        toast.error('Failed to delete import log');
      } finally {
        setDeletingLogId(null);
      }
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !uploadingAccountId) return;

    const account = accounts.find(a => a.id === uploadingAccountId);
    if (!account) return;

    const fileName = file.name.toLowerCase();
    const isCSV = fileName.endsWith('.csv');
    const isTextStatement = fileName.endsWith('.txt') || fileName.endsWith('.md');
    const isPDF = fileName.endsWith('.pdf');

    try {
      if (isPDF) {
        // AI-powered PDF parsing
        toast.info('Parsing PDF with AI… this may take 15-30 seconds.');

        const arrayBuffer = await file.arrayBuffer();
        const base64 = btoa(
          new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
        );

        const session = await supabase.auth.getSession();
        if (!session.data.session) {
          toast.error('Not authenticated');
          return;
        }

        const response = await fetch(`${SUPABASE_URL}/functions/v1/parse-statement`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.data.session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            pdf_base64: base64,
            account_context: {
              provider: account.provider,
              account_name: account.account_name,
              currency: account.currency,
            },
          }),
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({ error: 'Parse failed' }));
          toast.error(errData.error || 'AI parsing failed');
          return;
        }

        const parsed = await response.json();

        if (!parsed.transactions || parsed.transactions.length === 0) {
          toast.warning('No transactions found in PDF', {
            description: parsed.warnings?.join(', ') || undefined,
          });
          return;
        }

        // Convert AI output to import format
        const rows = parsed.transactions.map((tx: any) => ({
          posted_at: tx.posted_date || tx.value_date || new Date().toISOString().slice(0, 10),
          description: tx.description,
          amount: tx.amount,
          currency: account.currency,
          external_transaction_id: `${tx.posted_date}_${tx.amount}_${(tx.description || '').slice(0, 50)}`,
        }));

        const count = await importTransactions(uploadingAccountId, rows);
        const imported = typeof count === 'number' ? count : rows.length;
        const skippedTotal = rows.length - imported;

        // Update balance from AI extraction
        const extractedBalance = parsed.balances?.closing_balance ?? parsed.balances?.available_balance ?? null;
        if (extractedBalance !== null) {
          await updateAccount(uploadingAccountId, { balance: extractedBalance } as any);
        }

        await addImportLog({
          account_id: uploadingAccountId,
          file_name: file.name,
          file_type: 'pdf',
          transactions_imported: imported,
          transactions_skipped: skippedTotal,
          balance_extracted: extractedBalance,
        });

        toast.success(`Imported ${imported} transaction${imported !== 1 ? 's' : ''} into ${account.account_name}`, {
          description: [
            skippedTotal > 0 ? `${skippedTotal} skipped (duplicates)` : null,
            extractedBalance !== null ? `Balance updated to ${formatCurrency(extractedBalance, account.currency)}` : null,
            `AI confidence: ${parsed.confidence?.overall || '?'}%`,
          ].filter(Boolean).join(' · ') || undefined,
        });

        if (parsed.warnings?.length > 0) {
          console.warn('AI parse warnings:', parsed.warnings);
        }

        await categorizeTransactions();
        await matchTransfers();
      } else {
        // CSV or text-based statement parsing (existing logic)
        const text = await file.text();
        let result;

        if (isCSV) {
          result = parseBankCSV(text, uploadingAccountId, account.currency, 500);
        } else if (isTextStatement) {
          result = parseNetBankMarkdown(text, uploadingAccountId, account.currency, 500);
        } else {
          toast.error('Unsupported file type. Please upload a CSV, TXT, MD, or PDF file.');
          return;
        }

        if (result.errors.length > 0) {
          toast.error(`Parse error: ${result.errors.join(', ')}`);
          return;
        }

        if (result.rows.length === 0) {
          toast.warning('No valid transactions found in file');
          return;
        }

        const count = await importTransactions(uploadingAccountId, result.rows);
        const imported = typeof count === 'number' ? count : result.rows.length;
        const skippedTotal = result.rows.length - imported + result.skipped;

        if (result.extractedBalance !== null) {
          await updateAccount(uploadingAccountId, { balance: result.extractedBalance } as any);
        }

        await addImportLog({
          account_id: uploadingAccountId,
          file_name: file.name,
          file_type: isCSV ? 'csv' : 'pdf',
          transactions_imported: imported,
          transactions_skipped: skippedTotal,
          balance_extracted: result.extractedBalance,
        });

        toast.success(`Imported ${imported} transaction${imported !== 1 ? 's' : ''} into ${account.account_name}`, {
          description: [
            skippedTotal > 0 ? `${skippedTotal} skipped (duplicates)` : null,
            result.extractedBalance !== null ? `Balance updated to ${formatCurrency(result.extractedBalance, account.currency)}` : null,
          ].filter(Boolean).join(' · ') || undefined,
        });

        await categorizeTransactions();
        await matchTransfers();
      }
    } catch (err) {
      console.error('Upload error:', err);
      toast.error('Failed to process file');
    } finally {
      setUploadingAccountId(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  // Group accounts by provider — hide internal "external" pseudo-account
  const grouped = accounts.filter(a => a.provider !== 'external').reduce<Record<string, typeof accounts>>((acc, item) => {
    const key = item.provider || 'manual';
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});

  const providerKeys = Object.keys(grouped);
  const defaultOpen = providerKeys.length > 0 ? providerKeys[0] : undefined;

  return (
    <div className="space-y-4">
      <input ref={fileRef} type="file" accept=".csv,.txt,.md,.pdf" className="hidden" onChange={handleFileUpload} />
      <input ref={snapshotRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" onChange={handleSnapshotUpload} />

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Accounts</h2>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => snapshotRef.current?.click()}
            disabled={snapshotParsing}
            className="gap-1"
          >
            {snapshotParsing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
            {snapshotParsing ? 'Reading...' : 'Update Balances'}
          </Button>
          {hasUpAccounts && (
            <Button size="sm" variant="outline" onClick={handleSync} disabled={syncing}>
              {syncing ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Syncing...</> : <><RefreshCw className="w-4 h-4 mr-1" /> Sync Up</>}
            </Button>
          )}
          {hasWiseAccounts && (
            <Button size="sm" variant="outline" onClick={handleWiseSync} disabled={wiseSyncing}>
              {wiseSyncing ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Syncing...</> : <><RefreshCw className="w-4 h-4 mr-1" /> Sync Wise</>}
            </Button>
          )}
          {hasMonzoAccounts && (
            <Button size="sm" variant="outline" onClick={handleMonzoSync} disabled={monzoSyncing}>
              {monzoSyncing ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Syncing...</> : <><RefreshCw className="w-4 h-4 mr-1" /> Sync Monzo</>}
            </Button>
          )}
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" data-add-account-trigger><Plus className="w-4 h-4 mr-1" /> Add Account</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Account</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                <div className="space-y-2">
                  <Label>Bank</Label>
                  <Select value={bank} onValueChange={setBank}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {BANK_OPTIONS.map(b => (
                        <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {bank === 'monzo' && (
                  <div className="rounded-lg bg-primary/5 p-3 space-y-2 border border-primary/20">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-primary flex items-center gap-1">
                        <RefreshCw className="h-3 w-3" /> Connect Live Monzo API
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Connect your Monzo account directly using your Monzo Access Token.
                    </p>
                    <div className="space-y-2 pt-1">
                      <Input
                        type="password"
                        placeholder="Paste Monzo Access Token (ey...)"
                        value={monzoTokenInput}
                        onChange={e => setMonzoTokenInput(e.target.value)}
                        className="h-8 text-xs font-mono"
                      />
                      <Button
                        type="button"
                        size="sm"
                        className="w-full h-8 text-xs"
                        onClick={handleLiveMonzoConnect}
                        disabled={connectingMonzo || !monzoTokenInput.trim()}
                      >
                        {connectingMonzo ? <><Loader2 className="h-3 w-3 animate-spin mr-1" /> Connecting...</> : 'Connect Live Account'}
                      </Button>
                    </div>
                    <div className="relative my-2">
                      <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
                      <div className="relative flex justify-center text-[10px] uppercase"><span className="bg-background px-2 text-muted-foreground">or add manual account below</span></div>
                    </div>
                  </div>
                )}
                <div className="space-y-2">
                  <Label>Account Name</Label>
                  <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Everyday xx4282" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Currency</Label>
                    <Select value={currency} onValueChange={setCurrency}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="AUD">AUD</SelectItem>
                        <SelectItem value="GBP">GBP</SelectItem>
                        <SelectItem value="EUR">EUR</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Current Balance</Label>
                    <Input type="number" step="0.01" value={balance} onChange={e => setBalance(e.target.value)} placeholder="0.00" />
                  </div>
                </div>
                <Button onClick={handleAdd} className="w-full">Add Account</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Snapshot review card */}
      {snapshotResults && (
        <Card className="border-[hsl(var(--primary)/0.3)]">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Review Extracted Balances</h3>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => setSnapshotResults(null)}>Cancel</Button>
                <Button size="sm" onClick={handleApplySnapshot} disabled={!snapshotResults.some(r => r.selected)}>
                  <Check className="w-3.5 h-3.5 mr-1" /> Apply Selected
                </Button>
              </div>
            </div>
            <div className="space-y-1.5">
              {snapshotResults.map((result, idx) => {
                const matchedAccount = accounts.find(a => a.id === result.account_id);
                const currentBalance = matchedAccount?.balance;
                const changed = currentBalance !== undefined && currentBalance !== result.balance;

                return (
                  <div
                    key={idx}
                    className={`flex items-center gap-3 p-2.5 rounded-lg text-sm ${
                      result.account_id ? 'bg-muted/30' : 'bg-destructive/5'
                    }`}
                  >
                    <Checkbox
                      checked={result.selected}
                      disabled={!result.account_id}
                      onCheckedChange={(checked) => {
                        setSnapshotResults(prev =>
                          prev!.map((r, i) => i === idx ? { ...r, selected: !!checked } : r)
                        );
                      }}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{result.extracted_name}</p>
                      {result.account_id ? (
                        <p className="text-xs text-muted-foreground">
                          → {matchedAccount?.account_name}
                          {changed && currentBalance !== undefined && (
                            <span className="ml-1">
                              (was {formatCurrency(currentBalance, result.currency)})
                            </span>
                          )}
                        </p>
                      ) : (
                        <p className="text-xs text-destructive">No matching account found</p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-bold">{formatCurrency(result.balance, result.currency)}</p>
                      <Badge variant="secondary" className={`text-[10px] ${
                        result.confidence === 'high' ? 'text-[hsl(var(--success))]' :
                        result.confidence === 'medium' ? 'text-[hsl(var(--warning))]' :
                        'text-destructive'
                      }`}>
                        {result.confidence}
                      </Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {accounts.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <Wallet className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No accounts yet. Add your bank accounts to start tracking.</p>
          </CardContent>
        </Card>
      ) : (
        <Accordion type="single" collapsible defaultValue={defaultOpen} className="space-y-2">
          {providerKeys.map(provKey => {
            const provAccounts = grouped[provKey];
            const meta = PROVIDER_META[provKey] || PROVIDER_META.manual;
            const Icon = meta.icon;
            const totalBalance = provAccounts.reduce((s, a) => s + ((a as any).exclude_from_totals ? 0 : a.balance), 0);
            const mainCurrency = provKey === 'monzo' ? 'GBP' : (provAccounts[0]?.currency || 'AUD');
            const lastSynced = provAccounts
              .map(a => a.last_synced_at)
              .filter(Boolean)
              .sort()
              .pop();

            return (
              <AccordionItem key={provKey} value={provKey} className="border rounded-lg overflow-hidden">
                <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-muted/30">
                  <div className="flex items-center gap-3 flex-1">
                    <Badge variant="secondary" className={`${meta.tint} px-2 py-1 gap-1.5`}>
                      <Icon className="w-3.5 h-3.5" />
                      {meta.label}
                    </Badge>
                    <div className="flex items-center gap-4 ml-auto mr-4">
                      <span className="text-sm font-bold">{formatCurrency(totalBalance, mainCurrency)}</span>
                      {lastSynced && (
                        <span className="text-[10px] text-muted-foreground hidden sm:inline">
                          Synced {format(new Date(lastSynced), 'dd MMM HH:mm')}
                        </span>
                      )}
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-3">
                  <div className="space-y-3">
                    {provAccounts.map(acc => {
                      const connected = isConnectedAccount(acc);
                      const accLogs = logsByAccount[acc.id] || [];

                      return (
                        <div key={acc.id} className="space-y-1.5">
                          <div
                            className="flex items-center justify-between p-3 rounded-lg bg-muted/20 cursor-pointer hover:bg-muted/40 transition-colors group/row"
                            onClick={() => navigate(`/finance/transactions?account=${acc.id}`)}
                          >
                            <div>
                              <p className="font-medium text-sm flex items-center gap-1.5">
                                {acc.account_name}
                                {(acc as any).exclude_from_totals && (
                                  <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-muted text-muted-foreground">Excluded</span>
                                )}
                              </p>
                              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                <span>{acc.currency}</span>
                                {(() => {
                                  const stats = spendByAccount[acc.id];
                                  if (!stats || (stats.week === 0 && stats.month === 0)) return null;
                                  return (
                                    <>
                                      {stats.week > 0 && (
                                        <span>This week: <span className="text-foreground font-medium">{formatCurrency(stats.week, acc.currency)}</span></span>
                                      )}
                                      {stats.month > 0 && (
                                        <span>This month: <span className="text-foreground font-medium">{formatCurrency(stats.month, acc.currency)}</span></span>
                                      )}
                                    </>
                                  );
                                })()}
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              <p className="font-bold text-sm">{formatCurrency(acc.balance, acc.currency)}</p>
                              {!connected && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="gap-1 text-xs h-7"
                                  onClick={(e) => { e.stopPropagation(); handleUploadClick(acc.id); }}
                                  disabled={uploadingAccountId === acc.id}
                                >
                                  {uploadingAccountId === acc.id ? (
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                  ) : (
                                    <Upload className="w-3 h-3" />
                                  )}
                                  Upload
                                </Button>
                              )}
                              {!connected && (
                                <Input
                                  type="number"
                                  step="0.01"
                                  className="w-24 h-7 text-xs"
                                  placeholder="Update bal."
                                  onClick={(e) => e.stopPropagation()}
                                  onBlur={(e) => {
                                    const val = parseFloat(e.target.value);
                                    if (!isNaN(val)) {
                                      updateAccount(acc.id, { balance: val } as any);
                                      e.target.value = '';
                                    }
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                                  }}
                                />
                              )}
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                title={(acc as any).exclude_from_totals ? 'Include in totals & spend' : 'Exclude from totals & spend'}
                                onClick={(e) => { e.stopPropagation(); updateAccount(acc.id, { exclude_from_totals: !(acc as any).exclude_from_totals } as any); }}
                              >
                                {(acc as any).exclude_from_totals ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                              </Button>
                              {!connected && (
                                <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={(e) => { e.stopPropagation(); deleteAccount(acc.id); }}>
                                  <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                              )}
                              <ArrowRight className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover/row:opacity-100 transition-opacity" />
                            </div>
                          </div>
                           {/* Import logs */}
                           {accLogs.length > 0 && (
                             <div className="ml-3 pl-3 border-l border-muted space-y-0.5">
                               {accLogs.map(log => (
                                 <div key={log.id} className="flex items-center justify-between py-1 px-2 text-xs hover:bg-muted/30 rounded group transition-colors">
                                   <div className="flex items-center gap-2 min-w-0">
                                     <FileText className="w-3 h-3 text-muted-foreground shrink-0" />
                                     <span className="truncate">{log.file_name}</span>
                                   </div>
                                   <div className="flex items-center gap-3 shrink-0 text-muted-foreground">
                                     <span>{log.transactions_imported} imported</span>
                                     <span>{format(new Date(log.created_at), 'dd MMM yyyy')}</span>
                                     <Button
                                       variant="ghost"
                                       size="sm"
                                       className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive hover:bg-destructive/10"
                                       onClick={() => handleDeleteImportLog(log.id, log.file_name)}
                                       disabled={deletingLogId === log.id}
                                     >
                                       {deletingLogId === log.id ? (
                                         <Loader2 className="w-3 h-3 animate-spin" />
                                       ) : (
                                         <X className="w-3 h-3" />
                                       )}
                                     </Button>
                                   </div>
                                 </div>
                               ))}
                             </div>
                           )}
                        </div>
                      );
                    })}
                  </div>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      )}
    </div>
  );
}
