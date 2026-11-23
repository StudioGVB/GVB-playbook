import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

interface FixedExpenseLite {
  id: string;
  name: string;
  amount: number;
  currency: string;
  due_day: number | null;
  frequency: string;
  notes?: string | null;
  effective_from?: string | null;
  effective_to?: string | null;
}

interface TxLite {
  id: string;
  posted_at: string;
  description: string | null;
  merchant?: string | null;
  amount: number;
  base_amount?: number;
  currency: string;
  fixed_expense_id?: string | null;
  is_transfer?: boolean;
  transfer_status?: string | null;
}

const normalize = (s: string) =>
  (s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

const STOP_WORDS = new Set(['bill', 'bills', 'plan', 'monthly', 'subscription', 'sub', 'the', 'and', 'for', 'fee', 'fees', 'flat', 'uk']);

const tokens = (s: string) => normalize(s).split(' ').filter(t => t.length >= 3 && !STOP_WORDS.has(t));

function parseFreqWeeks(freq: string): number | null {
  const m = String(freq || '').match(/(?:every[_\s]+)?(\d+)[_\s]*weeks?/i);
  return m ? (parseInt(m[1], 10) || null) : null;
}

function isMultiWeekOrMeds(fe: FixedExpenseLite): boolean {
  const freq = String(fe.frequency || 'monthly').toLowerCase();
  const w = parseFreqWeeks(freq);
  if ((w !== null && w >= 3) || freq === 'quarterly' || freq === 'yearly') return true;
  const nameNotes = `${fe.name || ''} ${fe.notes || ''}`.toLowerCase();
  return /\b(meds|medication|prescription|pharmacy|chemist|elvanse|amfexa|adhd|titration|clinic)\b/i.test(nameNotes);
}

function titleMatches(expenseName: string, txDesc: string): boolean {
  const nExp = normalize(expenseName);
  const nTx = normalize(txDesc);
  if (!nExp || !nTx) return false;
  if (nExp.length >= 4 && (nTx.includes(nExp) || nExp.includes(nTx))) return true;
  if (/\b(lyca|lycamobile|mobile|phone|sim|vodafone|optus|telstra|ee|o2|giffgaff|three|lebara|smarty|vox)\b/i.test(txDesc)
    && /\b(phone|mobile|sim|plan|bill|data|lyca|lycamobile|vodafone|optus|telstra|ee|o2|giffgaff|three|lebara|smarty|vox)\b/i.test(expenseName)) return true;
  if (/\b(meds|medication|prescription|pharmacy|chemist|boots|superdrug|lloyds|well pharmacy|broadway|signature|elvanse|amfexa|adhd|titration|clinic)\b/i.test(txDesc)
    && /\b(meds|medication|prescription|pharmacy|chemist|elvanse|amfexa|adhd|titration|clinic)\b/i.test(expenseName)) return true;
  if (/\b(rent|flat|landlord|accommodation|tenancy|standing order)\b/i.test(txDesc)
    && /\b(rent|flat|housing|accommodation)\b/i.test(expenseName)) return true;
  const expTokens = tokens(expenseName);
  if (expTokens.length === 0) return false;
  const txTokens = new Set(tokens(txDesc));
  return expTokens.every(t => txTokens.has(t) || (t.length >= 4 && nTx.includes(t)));
}

function amountMatches(expenseAmt: number, txAbsAmt: number, allowOverageOrMultiWeek = false): boolean {
  const diff = Math.abs(expenseAmt - txAbsAmt);
  if (diff <= Math.max(0.5, expenseAmt * 0.02)) return true;
  if (allowOverageOrMultiWeek && expenseAmt > 0) {
    return txAbsAmt >= Math.min(2, expenseAmt * 0.2) && txAbsAmt <= Math.max(expenseAmt * 3.0, expenseAmt + 120);
  }
  return false;
}

function dayDiff(dueDay: number, txDateIso: string, tolerance = 5): boolean {
  const d = new Date(txDateIso);
  const txDay = d.getDate();
  const monthLen = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  // wrap around month end
  const raw = Math.abs(txDay - dueDay);
  const wrapped = Math.min(raw, monthLen - raw);
  return wrapped <= tolerance;
}

function activeOnDate(expense: FixedExpenseLite, txDateIso: string): boolean {
  const iso = txDateIso.slice(0, 10);
  if (expense.effective_from && iso < expense.effective_from.slice(0, 10)) return false;
  if (expense.effective_to && iso > expense.effective_to.slice(0, 10)) return false;
  return true;
}

/**
 * Scans untagged expense transactions and links them to a fixed expense
 * when amount + title match, and (if due_day set) the tx date is near it.
 */
export function useAutoLinkFixedBills(params: {
  transactions: TxLite[];
  fixedExpenses: FixedExpenseLite[];
  refetch: () => void;
  baseCurrency?: string;
  enabled?: boolean;
}) {
  const { transactions, fixedExpenses, refetch, baseCurrency, enabled = true } = params;
  const { user } = useAuth();
  const ranKey = useRef<string>('');

  useEffect(() => {
    if (!enabled || !user) return;
    if (!transactions.length || !fixedExpenses.length) return;

    // Dedup runs per data snapshot
    const key = `${transactions.length}|${fixedExpenses.map(f => f.id + f.amount + (f.due_day || '')).join(',')}`;
    if (ranKey.current === key) return;
    ranKey.current = key;

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 120);

    const candidates = transactions.filter(t =>
      !t.fixed_expense_id &&
      !t.is_transfer &&
      t.transfer_status !== 'confirmed' &&
      t.transfer_status !== 'auto_confirmed' &&
      t.amount < 0 &&
      new Date(t.posted_at) >= cutoff
    );

    const updates: { id: string; fixed_expense_id: string }[] = [];

    for (const tx of candidates) {
      const absAmt = Math.abs(Number(tx.amount) || 0);
      const baseAbsAmt = typeof tx.base_amount === 'number' ? Math.abs(tx.base_amount) : null;
      const match = fixedExpenses.find(fe => {
        if (!activeOnDate(fe, tx.posted_at)) return false;
        const descText = `${tx.merchant || ''} ${tx.description || ''}`;
        const isRentExp = fe.name.toLowerCase().includes('rent') || fe.name.toLowerCase().includes('flat');
        if (isRentExp && (baseAbsAmt ?? absAmt) < 100) return false;
        const descLower = descText.toLowerCase();
        const hasRentKeyword = /\b(rent|landlord|accommodation|tenancy|standing order)\b/i.test(descLower);
        const titleOk = titleMatches(`${fe.name} ${fe.notes || ''}`, descText) || (isRentExp && hasRentKeyword);
        if (!titleOk) return false;

        const multiWeek = isMultiWeekOrMeds(fe);
        const allowFlexibleAmt = !isRentExp;
        const expenseCurrency = fe.currency || baseCurrency || 'GBP';
        const nativeMatches = expenseCurrency === (tx.currency || baseCurrency || 'GBP') && amountMatches(Number(fe.amount), absAmt, allowFlexibleAmt);
        const baseMatches = !!baseCurrency && expenseCurrency === baseCurrency && baseAbsAmt != null && amountMatches(Number(fe.amount), baseAbsAmt, allowFlexibleAmt);
        if (!nativeMatches && !baseMatches) return false;
        if (!multiWeek && isRentExp && fe.due_day && !dayDiff(fe.due_day, tx.posted_at, 6)) return false;
        return true;
      });
      if (match) updates.push({ id: tx.id, fixed_expense_id: match.id });
    }

    if (!updates.length) return;

    (async () => {
      let linked = 0;
      for (const u of updates) {
        const { error } = await supabase
          .from('finance_transactions')
          .update({ fixed_expense_id: u.fixed_expense_id, is_fixed: true } as any)
          .eq('id', u.id);
        if (!error) linked++;
      }
      if (linked > 0) {
        toast.success(`Auto-tagged ${linked} bill${linked === 1 ? '' : 's'}`);
        refetch();
      }
    })();
  }, [transactions, fixedExpenses, user, enabled, refetch, baseCurrency]);
}
