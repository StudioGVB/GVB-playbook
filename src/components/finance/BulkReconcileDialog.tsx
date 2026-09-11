import { useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Receipt, Trash2, ArrowRight, Wand2 } from 'lucide-react';
import { format, parse, isValid } from 'date-fns';
import { useFinanceData } from '@/hooks/useFinanceData';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { formatCurrency } from '@/lib/financeUtils';

interface BulkReconcileDialogProps {
  tripId: string;
  tripName: string;
  tripStart?: string | null;
  tripEnd?: string | null;
  trigger?: React.ReactNode;
  onDone?: () => void;
}

interface ParsedRow {
  date: string; // yyyy-MM-dd
  amount: string;
  description: string;
  error?: string;
}

// Try a handful of common date formats from bank statements
const DATE_FORMATS = [
  'yyyy-MM-dd', 'dd/MM/yyyy', 'd/M/yyyy', 'MM/dd/yyyy', 'M/d/yyyy',
  'dd-MM-yyyy', 'd-M-yyyy', 'dd MMM yyyy', 'd MMM yyyy', 'MMM d yyyy',
  'MMM d, yyyy', 'dd/MM/yy', 'd/M/yy', 'dd MMM', 'd MMM',
];

function tryParseDate(raw: string, fallbackYear: number): string | null {
  const s = raw.trim().replace(/,$/, '');
  if (!s) return null;
  for (const fmt of DATE_FORMATS) {
    const d = parse(s, fmt, new Date(fallbackYear, 0, 1));
    if (isValid(d)) {
      // If parsed year is way off (e.g. format had no year), force fallback year
      const year = d.getFullYear();
      if (year < 2000 || year > 2100) {
        d.setFullYear(fallbackYear);
      }
      return format(d, 'yyyy-MM-dd');
    }
  }
  // ISO fallback
  const d = new Date(s);
  if (isValid(d)) return format(d, 'yyyy-MM-dd');
  return null;
}

function tryParseAmount(raw: string): number | null {
  if (!raw) return null;
  // Strip currency symbols, commas, parens (treat as negative)
  let s = raw.trim().replace(/[$£€,]/g, '');
  const isNeg = /^\(.*\)$/.test(s) || s.startsWith('-');
  s = s.replace(/^\(|\)$/g, '').replace(/^-/, '');
  const n = parseFloat(s);
  if (!isFinite(n) || n <= 0) return null;
  return isNeg ? -n : n; // we want expense magnitude; sign handled at save
}

function parseBulkText(text: string, fallbackYear: number): ParsedRow[] {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  return lines.map(line => {
    // Split by tab, or 2+ spaces, or commas (but not commas inside numbers)
    // Try tab first, then commas, then multi-space
    let parts: string[];
    if (line.includes('\t')) parts = line.split('\t').map(p => p.trim());
    else if (line.includes(',')) parts = line.split(',').map(p => p.trim());
    else parts = line.split(/\s{2,}/).map(p => p.trim());

    parts = parts.filter(Boolean);
    if (parts.length < 2) return { date: '', amount: '', description: line, error: 'Need date + amount' };

    // Find date (first part that parses as a date)
    let dateIdx = -1;
    let dateStr = '';
    for (let i = 0; i < parts.length; i++) {
      const d = tryParseDate(parts[i], fallbackYear);
      if (d) { dateIdx = i; dateStr = d; break; }
    }

    // Find amount (last part that parses as a number)
    let amtIdx = -1;
    let amtVal: number | null = null;
    for (let i = parts.length - 1; i >= 0; i--) {
      if (i === dateIdx) continue;
      const a = tryParseAmount(parts[i]);
      if (a !== null) { amtIdx = i; amtVal = a; break; }
    }

    if (dateIdx === -1) return { date: '', amount: amtVal ? String(Math.abs(amtVal)) : '', description: parts.filter((_, i) => i !== amtIdx).join(' '), error: 'Date not recognised' };
    if (amtIdx === -1 || amtVal === null) return { date: dateStr, amount: '', description: parts.filter((_, i) => i !== dateIdx).join(' '), error: 'Amount not recognised' };

    const description = parts.filter((_, i) => i !== dateIdx && i !== amtIdx).join(' ').trim() || 'Trip expense';
    return { date: dateStr, amount: String(Math.abs(amtVal)), description };
  });
}

export function BulkReconcileDialog({ tripId, tripName, tripStart, tripEnd, trigger, onDone }: BulkReconcileDialogProps) {
  const { getOrCreateExternalAccount, refetch, settings } = useFinanceData() as any;
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<'paste' | 'review'>('paste');
  const [rawText, setRawText] = useState('');
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [saving, setSaving] = useState(false);

  const baseCurrency = settings?.base_currency || 'AUD';
  const fallbackYear = useMemo(() => {
    if (tripStart) return new Date(tripStart).getFullYear();
    if (tripEnd) return new Date(tripEnd).getFullYear();
    return new Date().getFullYear();
  }, [tripStart, tripEnd]);

  const validRows = rows.filter(r => !r.error && r.date && r.amount);
  const totalAmount = validRows.reduce((s, r) => s + parseFloat(r.amount || '0'), 0);

  const handleParse = () => {
    const parsed = parseBulkText(rawText, fallbackYear);
    if (parsed.length === 0) { toast.error('Paste at least one row'); return; }
    setRows(parsed);
    setStep('review');
  };

  const updateRow = (idx: number, patch: Partial<ParsedRow>) => {
    setRows(rows.map((r, i) => {
      if (i !== idx) return r;
      const next = { ...r, ...patch };
      // Re-validate
      if (next.date && next.amount && parseFloat(next.amount) > 0) next.error = undefined;
      return next;
    }));
  };

  const removeRow = (idx: number) => setRows(rows.filter((_, i) => i !== idx));

  const handleSave = async () => {
    if (validRows.length === 0) { toast.error('No valid rows to save'); return; }
    if (!user) return;
    setSaving(true);
    try {
      const accountId = await getOrCreateExternalAccount();
      if (!accountId) return;
      const inserts = validRows.map(r => ({
        user_id: user.id,
        account_id: accountId,
        amount: -Math.abs(parseFloat(r.amount)),
        description: r.description || `Trip expense — ${tripName}`,
        posted_at: new Date(r.date + 'T12:00:00').toISOString(),
        currency: baseCurrency,
        trip_id: tripId,
        raw: { source: 'manual_external', logged_via: 'bulk_reconcile' },
      }));
      const { error } = await supabase.from('finance_transactions').insert(inserts as any);
      if (error) { toast.error('Save failed: ' + error.message); return; }
      toast.success(`Logged ${inserts.length} trip expense${inserts.length === 1 ? '' : 's'}`);
      await refetch?.();
      onDone?.();
      // Reset
      setRawText(''); setRows([]); setStep('paste'); setOpen(false);
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setStep('paste'); } }}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm" variant="default" className="gap-1.5">
            <Receipt className="w-3.5 h-3.5" /> Reconcile from statement
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Receipt className="w-5 h-5" /> Reconcile {tripName}
          </DialogTitle>
          <DialogDescription>
            {step === 'paste'
              ? 'Paste rows from your bank statement (date, amount, description on each line). I\'ll parse them into trip expenses — they won\'t change any account balance, just count toward trip spend.'
              : `Review ${rows.length} row${rows.length === 1 ? '' : 's'} before saving. Edit anything that looks wrong.`}
          </DialogDescription>
        </DialogHeader>

        {step === 'paste' && (
          <div className="space-y-3 flex-1 overflow-hidden flex flex-col">
            <div className="space-y-2">
              <Label htmlFor="bulk">Paste statement rows</Label>
              <Textarea
                id="bulk"
                value={rawText}
                onChange={e => setRawText(e.target.value)}
                placeholder={`12/11/2025  45.20  Dinner Tokyo\n13/11/2025  120.00  Train tickets\n14/11/2025  $30  Coffee`}
                rows={10}
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground leading-relaxed">
                Tip: copy directly from your bank's transaction list. Separators can be tabs, commas, or multiple spaces. Dates can be in most formats. Year defaults to {fallbackYear} if missing.
              </p>
            </div>
            <DialogFooter className="mt-auto">
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={handleParse} disabled={!rawText.trim()} className="gap-1.5">
                <Wand2 className="w-3.5 h-3.5" /> Parse rows <ArrowRight className="w-3.5 h-3.5" />
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === 'review' && (
          <div className="space-y-3 flex-1 overflow-hidden flex flex-col">
            <div className="flex items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{validRows.length} ready</Badge>
                {rows.length - validRows.length > 0 && (
                  <Badge variant="destructive">{rows.length - validRows.length} need fixing</Badge>
                )}
              </div>
              <span className="text-muted-foreground">
                Total: <span className="font-bold tabular-nums text-foreground">{formatCurrency(totalAmount, baseCurrency)}</span>
              </span>
            </div>
            <ScrollArea className="flex-1 -mx-2 px-2">
              <div className="space-y-1.5">
                {rows.map((r, i) => (
                  <div key={i} className={`grid grid-cols-[110px_100px_1fr_28px] gap-2 items-center p-2 rounded-md border ${r.error ? 'border-destructive/50 bg-destructive/5' : 'border-border'}`}>
                    <Input
                      type="date"
                      value={r.date}
                      onChange={e => updateRow(i, { date: e.target.value })}
                      className="h-8 text-xs"
                    />
                    <Input
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={r.amount}
                      onChange={e => updateRow(i, { amount: e.target.value })}
                      className="h-8 text-xs tabular-nums"
                    />
                    <Input
                      value={r.description}
                      onChange={e => updateRow(i, { description: e.target.value })}
                      placeholder="Description"
                      className="h-8 text-xs"
                    />
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeRow(i)}>
                      <Trash2 className="w-3 h-3" />
                    </Button>
                    {r.error && (
                      <p className="col-span-4 text-[10px] text-destructive pl-1">{r.error}</p>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
            <DialogFooter className="mt-2 gap-2">
              <Button variant="ghost" onClick={() => setStep('paste')}>← Back to paste</Button>
              <Button onClick={handleSave} disabled={saving || validRows.length === 0}>
                {saving ? 'Saving…' : `Log ${validRows.length} expense${validRows.length === 1 ? '' : 's'}`}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
