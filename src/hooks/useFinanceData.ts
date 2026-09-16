import { useState, useEffect, useCallback, useRef, useContext } from 'react';
import { supabase, SUPABASE_URL } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { computeTxFingerprint } from '@/lib/txFingerprint';
import { FinanceContext } from '@/contexts/FinanceContext';

export interface FinanceAccount {
  id: string;
  user_id: string;
  provider: string;
  account_name: string;
  currency: string;
  balance: number;
  external_account_id: string | null;
  last_synced_at: string | null;
  created_at: string;
  source_type?: string;
  exclude_from_totals?: boolean;
}

export interface FinanceCategory {
  id: string;
  user_id: string;
  name: string;
  type: string;
  is_cuttable: boolean;
  is_essential: boolean;
  monthly_target: number | null;
  weekly_target: number | null;
  exclude_from_reports: boolean;
  color: string | null;
}

export interface FinanceTransaction {
  id: string;
  user_id: string;
  account_id: string;
  posted_at: string;
  description: string;
  merchant: string | null;
  amount: number;
  currency: string;
  category_id: string | null;
  is_transfer: boolean;
  is_fixed: boolean;
  is_reviewed: boolean;
  transfer_group_id: string | null;
  transfer_side: string | null;
  transfer_match_confidence: number | null;
  matched_transaction_id: string | null;
  transfer_status: string | null;
  transfer_pattern_key: string | null;
  goal_id: string | null;
  is_refund?: boolean;
  is_reimbursable?: boolean;
  reimbursement_status?: 'pending' | 'reimbursed' | null;
  reimbursed_at?: string | null;
  reimbursement_payout_id?: string | null;
}

export interface FinanceGoal {
  id: string;
  user_id: string;
  name: string;
  target_amount: number;
  currency: string;
  deadline: string | null;
  priority: number;
  safety_mode: string;
  assigned_amount: number;
  percent_allocation: number;
  color: string | null;
  created_at: string;
  updated_at: string;
}

export interface FinanceGoalPlan {
  id: string;
  goal_id: string;
  user_id: string;
  baseline_weekly_surplus: number | null;
  suggested_weekly_savings: number | null;
  est_weeks_to_goal: number | null;
  plan: any;
  created_at: string;
}

export interface FinanceSettings {
  id: string;
  user_id: string;
  fx_rates: Record<string, number>;
  base_currency: string;
}

export interface IncomeSourceTag {
  id: string;
  user_id: string;
  source_key: string;
  group_name: string;
  created_at: string;
}

const CATEGORY_COLOR_MAP: Record<string, string> = {
  'groceries': '#a855f7',      // vibrant purple
  'eating out': '#f97316',     // warm orange
  'shopping': '#ec4899',       // magenta pink
  'transport': '#3b82f6',      // bright blue
  'bills': '#ef4444',          // crimson red
  'rent': '#06b6d4',           // fresh cyan
  'subscriptions': '#6366f1',  // royal indigo
  'income': '#22c55e',         // emerald green
  'transfers': '#64748b',      // neutral slate
  'transfer': '#64748b',
};

export function getCategoryColor(name: string, type?: string): string {
  const normName = name.toLowerCase().trim();
  if (CATEGORY_COLOR_MAP[normName]) {
    return CATEGORY_COLOR_MAP[normName];
  }
  if (type === 'income') return '#22c55e';
  if (type === 'transfer') return '#64748b';
  if (type === 'fixed') return '#ef4444';
  
  // Deterministic color generation based on name hash
  let hash = 0;
  for (let i = 0; i < normName.length; i++) {
    hash = normName.charCodeAt(i) + ((hash << 5) - hash);
  }
  const colors = [
    '#ef4444', '#f97316', '#f59e0b', '#10b981', 
    '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', 
    '#d946ef', '#ec4899', '#f43f5e'
  ];
  const index = Math.abs(hash) % colors.length;
  return colors[index];
}

const DEFAULT_CATEGORIES = [
  { name: 'Rent', type: 'fixed', is_cuttable: false, is_essential: false, color: '#06b6d4' },
  { name: 'Bills', type: 'fixed', is_cuttable: false, is_essential: false, color: '#ef4444' },
  { name: 'Groceries', type: 'variable', is_cuttable: true, is_essential: true, color: '#a855f7' },
  { name: 'Transport', type: 'variable', is_cuttable: true, is_essential: true, color: '#3b82f6' },
  { name: 'Eating Out', type: 'variable', is_cuttable: true, is_essential: false, color: '#f97316' },
  { name: 'Shopping', type: 'variable', is_cuttable: true, is_essential: false, color: '#ec4899' },
  { name: 'Subscriptions', type: 'fixed', is_cuttable: true, is_essential: false, color: '#6366f1' },
  { name: 'Income', type: 'income', is_cuttable: false, is_essential: false, color: '#22c55e' },
  { name: 'Transfers', type: 'transfer', is_cuttable: false, is_essential: false, color: '#64748b' },
];

// Simple keyword-based auto-categorisation
const CATEGORY_RULES: Record<string, string[]> = {
  'Groceries': ['WOOLWORTHS', 'COLES', 'ALDI', 'IGA', 'HARRIS FARM', 'TESCO', 'SAINSBURY', 'LIDL'],
  'Transport': ['UBER', 'PTV', 'OPAL', 'MYKI', 'BOLT', 'TFL', 'DIDI'],
  'Subscriptions': ['NETFLIX', 'SPOTIFY', 'APPLE.COM', 'GOOGLE STORAGE', 'YOUTUBE', 'DISNEY'],
  'Eating Out': ['MCDONALD', 'KFC', 'UBER EATS', 'DOORDASH', 'MENULOG', 'DELIVEROO'],
  'Bills': ['ENERGY', 'WATER', 'TELSTRA', 'OPTUS', 'VODAFONE', 'INTERNET', 'INSURANCE'],
  'Rent': ['RENT', 'LEASE', 'LANDLORD'],
};

export function autoCategorizeTx(description: string, categories: FinanceCategory[]): string | null {
  const upper = description.toUpperCase();
  for (const [catName, keywords] of Object.entries(CATEGORY_RULES)) {
    if (keywords.some(kw => upper.includes(kw))) {
      const cat = categories.find(c => c.name === catName);
      if (cat) return cat.id;
    }
  }
  return null;
}

export interface ImportLog {
  id: string;
  user_id: string;
  account_id: string;
  file_name: string;
  file_type: string;
  transactions_imported: number;
  transactions_skipped: number;
  balance_extracted: number | null;
  created_at: string;
}

export function useFinanceDataState() {
  const { user } = useAuth();
  const [accounts, setAccounts] = useState<FinanceAccount[]>([]);
  const [categories, setCategories] = useState<FinanceCategory[]>([]);
  const [transactions, setTransactions] = useState<FinanceTransaction[]>([]);
  const [goals, setGoals] = useState<FinanceGoal[]>([]);
  const [goalPlans, setGoalPlans] = useState<FinanceGoalPlan[]>([]);
  const [settings, setSettings] = useState<FinanceSettings | null>(null);
  const [importLogs, setImportLogs] = useState<ImportLog[]>([]);
  const [incomeSourceTags, setIncomeSourceTags] = useState<IncomeSourceTag[]>([]);
  const [loading, setLoading] = useState(true);

  const hasLoadedOnce = useRef(false);
  const cleaningDuplicatesRef = useRef(false);

  const cleanDuplicateCategories = useCallback(async (catData: any[]) => {
    if (catData.length === 0 || cleaningDuplicatesRef.current) return;
    const seen = new Map<string, string>();
    const duplicates: { idToDelete: string; targetId: string }[] = [];

    for (const cat of catData) {
      const nameLower = cat.name.toLowerCase().trim();
      if (seen.has(nameLower)) {
        duplicates.push({ idToDelete: cat.id, targetId: seen.get(nameLower)! });
      } else {
        seen.set(nameLower, cat.id);
      }
    }

    if (duplicates.length > 0) {
      cleaningDuplicatesRef.current = true;
      try {
        await Promise.all(duplicates.map(async ({ idToDelete, targetId }) => {
          await supabase.from('finance_transactions').update({ category_id: targetId }).eq('category_id', idToDelete);
          await supabase.from('finance_categories').delete().eq('id', idToDelete);
        }));
        await fetchAll();
      } catch (err) {
        console.error('[cleanup] Failed to clean duplicate categories', err);
      } finally {
        cleaningDuplicatesRef.current = false;
      }
    }
  }, [user]);

  const fetchAll = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    if (!hasLoadedOnce.current) setLoading(true);
    try {
      const [accRes, catRes, txRes, goalRes, planRes, setRes, logRes, tagRes] = await Promise.all([
        supabase.from('finance_accounts').select('*').order('created_at'),
        supabase.from('finance_categories').select('*').order('name'),
        supabase.from('finance_transactions').select('*').order('posted_at', { ascending: false }),
        supabase.from('finance_goals').select('*').order('priority'),
        supabase.from('finance_goal_plans').select('*').order('created_at', { ascending: false }),
        supabase.from('finance_settings').select('*').eq('user_id', user.id).maybeSingle(),
        supabase.from('finance_import_logs').select('*').order('created_at', { ascending: false }),
        supabase.from('income_source_tags' as any).select('*').order('created_at'),
      ]);

      const accountsData = (accRes.data || []) as any as FinanceAccount[];
      const excludedAccountIds = new Set(accountsData.filter(a => a.exclude_from_totals).map(a => a.id));
      if (accRes.data) setAccounts(accountsData);
      if (catRes.data) {
        const enriched = (catRes.data as any[]).map(c => ({
          ...c,
          color: c.color || getCategoryColor(c.name, c.type)
        }));
        setCategories(enriched);

        // Self-healing: if no category is marked as essential, automatically make Groceries and Transport essential
        const hasEssential = catRes.data.some((c: any) => c.is_essential);
        if (catRes.data.length > 0 && !hasEssential) {
          const toUpdate = catRes.data.filter((c: any) =>
            c.name.trim().toLowerCase() === 'groceries' || c.name.trim().toLowerCase() === 'transport'
          );
          if (toUpdate.length > 0) {
            Promise.all(toUpdate.map((c: any) =>
              supabase.from('finance_categories').update({ is_essential: true }).eq('id', c.id)
            )).then(() => {
              fetchAll();
            }).catch(err => {
              console.error('[self-healing] Failed to set default essential categories', err);
            });
          }
        }

        // Detect and merge duplicate categories (case-insensitive name match)
        if (catRes.data.length > 0 && !cleaningDuplicatesRef.current) {
          cleanDuplicateCategories(catRes.data);
        }
      }

      // Determine base currency & fx from settings (or default) so we can enrich tx with base_amount
      const settingsData = setRes.data as any;
      const baseCurrency = settingsData?.base_currency || 'GBP';
      const fxRates = (settingsData?.fx_rates || {}) as Record<string, number>;
      const toBase = (amt: number, cur?: string | null) => {
        if (!cur || cur === baseCurrency) return amt;
        const direct = fxRates[`${cur}_${baseCurrency}`];
        if (direct) return amt * direct;
        const inverse = fxRates[`${baseCurrency}_${cur}`];
        if (inverse && inverse !== 0) return amt / inverse;
        console.warn(`[fx] no rate for ${cur}->${baseCurrency}, using 1:1`);
        return amt;
      };

      if (txRes.data) {
        const enriched = (txRes.data as any[])
          .filter(t => !excludedAccountIds.has(t.account_id))
          .map(t => ({ ...t, base_amount: toBase(Number(t.amount) || 0, t.currency) }));
        setTransactions(enriched as any);
      }
      if (goalRes.data) setGoals(goalRes.data as any);
      if (planRes.data) setGoalPlans(planRes.data as any);
      if (logRes.data) setImportLogs(logRes.data as any);
      if (tagRes.data) setIncomeSourceTags(tagRes.data as any);
      
      if (setRes.data) {
        setSettings(setRes.data as any);
      } else {
        // Create default settings using upsert
        const { data } = await supabase.from('finance_settings').upsert({
          user_id: user.id,
          fx_rates: { AUD_GBP: 0.52, GBP_AUD: 1.92 },
          base_currency: 'GBP',
        }, { onConflict: 'user_id' }).select().maybeSingle();
        if (data) setSettings(data as any);
      }

      // Seed default categories if none exist
      if (catRes.data && catRes.data.length === 0) {
        const rows = DEFAULT_CATEGORIES.map(c => ({ ...c, user_id: user.id }));
        const { data } = await supabase.from('finance_categories').insert(rows).select();
        if (data) {
          const enriched = (data as any[]).map(c => ({
            ...c,
            color: c.color || getCategoryColor(c.name, c.type)
          }));
          setCategories(enriched);
        }
      }
    } catch (err) {
      console.error('Finance fetch error', err);
    } finally {
      setLoading(false);
      hasLoadedOnce.current = true;
    }
  }, [user]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // -- Mutations --
  const addAccount = async (acc: { account_name: string; currency: string; provider?: string; balance?: number }) => {
    if (!user) return;
    const { error } = await supabase.from('finance_accounts').insert({
      user_id: user.id,
      account_name: acc.account_name,
      currency: acc.currency,
      provider: acc.provider || 'manual',
      balance: acc.balance || 0,
    });
    if (error) { toast.error('Failed to add account'); return; }
    toast.success('Account added');
    fetchAll();
  };

  const updateAccount = async (id: string, updates: Partial<FinanceAccount>) => {
    const { error } = await supabase.from('finance_accounts').update(updates).eq('id', id);
    if (error) { toast.error('Update failed'); return; }
    fetchAll();
  };

  const deleteAccount = async (id: string) => {
    const { error } = await supabase.from('finance_accounts').delete().eq('id', id);
    if (error) { toast.error('Delete failed'); return; }
    toast.success('Account deleted');
    fetchAll();
  };

  const deleteImportLog = async (logId: string) => {
    // Cascade delete transactions with this import_log_id
    const { error: txError } = await supabase
      .from('finance_transactions')
      .delete()
      .eq('import_log_id', logId);
    if (txError) throw txError;

    // Delete the import log
    const { error: logError } = await supabase
      .from('finance_import_logs')
      .delete()
      .eq('id', logId);
    if (logError) throw logError;

    toast.success('Import removed and transactions deleted');
    await fetchAll();
  };

  const importTransactions = async (accountId: string, txs: Array<{
    posted_at: string; description: string; amount: number; currency: string;
    external_transaction_id?: string;
  }>, importLogId?: string) => {
    if (!user) return 0;
    
    // Compute fingerprints for dedup
    const rows = await Promise.all(txs.map(async (tx) => {
      const catId = autoCategorizeTx(tx.description, categories);
      const fingerprint = await computeTxFingerprint({
        user_id: user.id,
        account_id: accountId,
        posted_at: tx.posted_at,
        amount: tx.amount,
        description: tx.description,
      });
      return {
        user_id: user.id,
        account_id: accountId,
        posted_at: tx.posted_at,
        description: tx.description,
        amount: tx.amount,
        currency: tx.currency,
        category_id: catId,
        external_transaction_id: tx.external_transaction_id || null,
        transaction_fingerprint: fingerprint,
        import_log_id: importLogId || null,
      };
    }));

    // Deduplicate within the batch itself (same fingerprint = same tx)
    const seen = new Set<string>();
    const dedupedRows = rows.filter(r => {
      if (!r.transaction_fingerprint || seen.has(r.transaction_fingerprint)) return false;
      seen.add(r.transaction_fingerprint);
      return true;
    });

    // Check which fingerprints already exist in DB
    const fingerprints = dedupedRows.map(r => r.transaction_fingerprint);
    const { data: existing } = await supabase
      .from('finance_transactions')
      .select('transaction_fingerprint')
      .eq('user_id', user.id)
      .in('transaction_fingerprint', fingerprints);

    const existingSet = new Set((existing || []).map(e => e.transaction_fingerprint));
    const newRows = dedupedRows.filter(r => !existingSet.has(r.transaction_fingerprint));

    if (newRows.length === 0) {
      fetchAll();
      return 0;
    }

    const { error, data } = await supabase.from('finance_transactions').insert(newRows).select();
    if (error) { toast.error('Import failed: ' + error.message); return 0; }
    const imported = data?.length || 0;
    fetchAll();
    return imported;
  };

  const updateTransaction = async (id: string, updates: Partial<FinanceTransaction>) => {
    const { error } = await supabase.from('finance_transactions').update(updates).eq('id', id);
    if (error) { toast.error('Update failed'); return; }
    fetchAll();
  };

  /**
   * Returns the id of the user's hidden "External / Off-book" pseudo account, creating it on first use.
   * Used for logging trip expenses paid outside tracked accounts (e.g. cash, paid by partner).
   * Balance is always 0 so it never affects total cash, but its transactions count toward trip spend & weekly burn.
   */
  const getOrCreateExternalAccount = async (): Promise<string | null> => {
    if (!user) return null;
    const existing = accounts.find(a => a.provider === 'external');
    if (existing) return existing.id;
    const { data, error } = await supabase.from('finance_accounts').insert({
      user_id: user.id,
      account_name: 'External / Off-book',
      currency: settings?.base_currency || 'AUD',
      provider: 'external',
      balance: 0,
    }).select().single();
    if (error || !data) { toast.error('Failed to set up external account'); return null; }
    await fetchAll();
    return (data as any).id;
  };

  const addManualTransaction = async (tx: {
    account_id: string;
    amount: number;
    description: string;
    posted_at: string;
    currency?: string;
    trip_id?: string | null;
    category_id?: string | null;
    is_fixed?: boolean;
    fixed_expense_id?: string | null;
    raw?: any;
  }) => {
    if (!user) return null;
    
    // Auto-detect fixed bill matching (e.g. Rent, Spotify, Gym) if not explicitly set
    let isFixed = tx.is_fixed || false;
    let fixedExpenseId = tx.fixed_expense_id || null;

    if (!isFixed && !fixedExpenseId && tx.description) {
      const descLower = tx.description.toLowerCase();
      const matched = fixedExpenses.find(fe => {
        const nameLower = fe.name.toLowerCase();
        return descLower.includes(nameLower) || nameLower.includes(descLower);
      }) || (descLower.includes('rent') ? fixedExpenses.find(fe => fe.name.toLowerCase().includes('rent')) : undefined);

      if (matched) {
        isFixed = true;
        fixedExpenseId = matched.id;
      }
    }

    const { data, error } = await supabase.from('finance_transactions').insert({
      user_id: user.id,
      account_id: tx.account_id,
      amount: tx.amount,
      description: tx.description,
      posted_at: tx.posted_at,
      currency: tx.currency || settings?.base_currency || 'AUD',
      trip_id: tx.trip_id || null,
      category_id: tx.category_id || null,
      is_fixed: isFixed,
      fixed_expense_id: fixedExpenseId,
      raw: tx.raw || null,
    } as any).select().single();
    if (error) { toast.error('Failed to log transaction: ' + error.message); return null; }
    await fetchAll();
    return data;
  };

  const deleteTransaction = async (id: string) => {
    const { error } = await supabase.from('finance_transactions').delete().eq('id', id);
    if (error) { toast.error('Delete failed'); return; }
    fetchAll();
  };

  const addGoal = async (goal: { name: string; target_amount: number; currency: string; deadline?: string; priority?: number; safety_mode?: string; assigned_amount?: number; color?: string }) => {
    if (!user) return null;
    const { data, error } = await supabase.from('finance_goals').insert({ user_id: user.id, ...goal }).select().single();
    if (error) { toast.error('Failed to create goal'); return null; }
    toast.success('Goal created');
    fetchAll();
    return data;
  };

  const deleteGoal = async (id: string) => {
    const { error } = await supabase.from('finance_goals').delete().eq('id', id);
    if (error) { toast.error('Delete failed'); return; }
    fetchAll();
  };

  const updateGoal = async (id: string, updates: Partial<FinanceGoal>) => {
    const { error } = await supabase.from('finance_goals').update(updates).eq('id', id);
    if (error) { toast.error('Update failed'); return; }
    fetchAll();
  };

  const saveGoalPlan = async (plan: Omit<FinanceGoalPlan, 'id' | 'created_at'>) => {
    if (!user) return;
    const { error } = await supabase.from('finance_goal_plans').insert({ ...plan, user_id: user.id });
    if (error) { toast.error('Failed to save plan'); return; }
    fetchAll();
  };

  const updateSettings = async (updates: Partial<Pick<FinanceSettings, 'fx_rates' | 'base_currency'>>) => {
    if (!user) return;
    const existing = settings || {};
    const updated = {
      ...existing,
      ...updates,
      user_id: user.id,
      fx_rates: updates.fx_rates || existing.fx_rates || { AUD_GBP: 0.52, GBP_AUD: 1.92 },
      base_currency: updates.base_currency || existing.base_currency || 'GBP',
    };
    setSettings(updated as any);
    const { error } = await supabase.from('finance_settings').upsert(updated as any, { onConflict: 'user_id' });
    if (error) { toast.error('Settings update failed: ' + error.message); return; }
    toast.success('Settings updated');
    await fetchAll();
  };

  const addCategory = async (cat: { name: string; type: string; is_cuttable?: boolean; color?: string }) => {
    if (!user) return null;
    const { data, error } = await supabase.from('finance_categories').insert({ user_id: user.id, ...cat }).select().single();
    if (error) { toast.error('Failed to add category'); return null; }
    await fetchAll();
    return data as FinanceCategory;
  };

  const updateCategory = async (id: string, updates: Partial<Pick<FinanceCategory, 'name' | 'type' | 'is_cuttable' | 'is_essential' | 'exclude_from_reports' | 'color'>>) => {
    const { error } = await supabase.from('finance_categories').update(updates).eq('id', id);
    if (error) { toast.error('Update failed'); return; }
    fetchAll();
  };

  const deleteCategory = async (id: string) => {
    // Unassign transactions first
    await supabase.from('finance_transactions').update({ category_id: null }).eq('category_id', id);
    const { error } = await supabase.from('finance_categories').delete().eq('id', id);
    if (error) { toast.error('Delete failed'); return; }
    toast.success('Category deleted');
    fetchAll();
  };

  const checkUpStatus = async (): Promise<{ connected: boolean; error?: string; accountsCount?: number }> => {
    if (!user) return { connected: false, error: 'not_authenticated' };
    try {
      const session = await supabase.auth.getSession();
      if (!session.data.session) return { connected: false, error: 'not_authenticated' };

      const response = await fetch(`${SUPABASE_URL}/functions/v1/up-status`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.data.session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });

      const data = await response.json();
      if (data.connected) {
        toast.success(`Verified — ${data.accountsCount} account(s) found. Hit Sync to import transactions.`);
        fetchAll();
      } else if (data.error === 'missing_secret') {
        toast.error('UP_ACCESS_TOKEN not set in Cloud Secrets');
      } else if (data.error === 'invalid_token') {
        toast.error('UP_ACCESS_TOKEN is invalid or expired');
      } else {
        toast.error(data.message || 'Connection check failed');
      }
      return data;
    } catch (err) {
      console.error('Up status error:', err);
      toast.error('Network error checking Up status');
      return { connected: false, error: 'network' };
    }
  };

  const syncUpTransactions = async () => {
    if (!user) return;
    try {
      const session = await supabase.auth.getSession();
      if (!session.data.session) {
        toast.error('Not authenticated');
        return;
      }

      const response = await fetch(`${SUPABASE_URL}/functions/v1/up-sync`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.data.session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });

      const data = await response.json();
      if (!response.ok) {
        toast.error(data.error || 'Sync failed');
        return;
      }

      toast.success(`Synced ${data.accountsSynced} accounts, ${data.transactionsImported} transactions`);
      
      // Auto-categorise after sync
      await categorizeTransactions();
      
      await fetchAll();
    } catch (err) {
      console.error('Up sync error:', err);
      toast.error('Network error during sync');
    }
  };

  const checkWiseStatus = async (): Promise<{ connected: boolean; error?: string; accountsCount?: number }> => {
    if (!user) return { connected: false, error: 'not_authenticated' };
    try {
      const session = await supabase.auth.getSession();
      if (!session.data.session) return { connected: false, error: 'not_authenticated' };

      const response = await fetch(`${SUPABASE_URL}/functions/v1/wise-status`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.data.session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });

      const data = await response.json();
      if (data.connected) {
        toast.success(`Verified — ${data.accountsCount} Wise account(s) found.`);
        fetchAll();
      } else if (data.error === 'missing_secret') {
        toast.error('WISE_API_KEY not set in Cloud Secrets');
      } else if (data.error === 'invalid_token') {
        toast.error('WISE_API_KEY is invalid or expired');
      } else {
        toast.error(data.message || 'Connection check failed');
      }
      return data;
    } catch (err) {
      console.error('Wise status error:', err);
      toast.error('Network error checking Wise status');
      return { connected: false, error: 'network' };
    }
  };

  const connectWise = async (token: string): Promise<boolean> => {
    if (!user) return false;
    try {
      const session = await supabase.auth.getSession();
      if (!session.data.session) return false;

      const response = await fetch(`${SUPABASE_URL}/functions/v1/wise-connect`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.data.session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ token }),
      });

      const data = await response.json();
      if (response.ok && data.success) {
        toast.success('Wise account connected successfully!');
        fetchAll();
        return true;
      } else {
        toast.error(data.error || 'Failed to connect Wise');
        return false;
      }
    } catch (err) {
      console.error('Wise connect error:', err);
      toast.error('Network error connecting Wise');
      return false;
    }
  };

  const syncWiseTransactions = async (token?: string) => {
    if (!user) return;
    try {
      const session = await supabase.auth.getSession();
      if (!session.data.session) {
        toast.error('Not authenticated');
        return;
      }

      const response = await fetch(`${SUPABASE_URL}/functions/v1/wise-sync`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.data.session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ token }),
      });

      const data = await response.json();
      if (!response.ok) {
        toast.error(data.error || 'Sync failed');
        return;
      }

      toast.success(`Synced Wise accounts: imported ${data.transactionsImported} transactions`);
      
      // Auto-categorise after sync
      await categorizeTransactions();
      
      await fetchAll();
    } catch (err) {
      console.error('Wise sync error:', err);
      toast.error('Network error during sync');
    }
  };

  const checkMonzoStatus = async (): Promise<{ connected: boolean; error?: string; accountsCount?: number }> => {
    if (!user) return { connected: false, error: 'not_authenticated' };
    try {
      const session = await supabase.auth.getSession();
      if (!session.data.session) return { connected: false, error: 'not_authenticated' };

      const response = await fetch(`${SUPABASE_URL}/functions/v1/monzo-status`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.data.session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });

      const data = await response.json();
      if (data.connected) {
        toast.success(`Verified — ${data.accountsCount} Monzo account(s) found.`);
        fetchAll();
      } else if (data.error === 'missing_secret') {
        toast.error('MONZO_ACCESS_TOKEN not set in Cloud Secrets');
      } else if (data.error === 'invalid_token') {
        toast.error('MONZO_ACCESS_TOKEN is invalid or expired');
      } else {
        toast.error(data.message || 'Connection check failed');
      }
      return data;
    } catch (err) {
      console.error('Monzo status error:', err);
      toast.error('Network error checking Monzo status');
      return { connected: false, error: 'network' };
    }
  };

  const connectMonzo = async (token: string): Promise<boolean> => {
    if (!user) return false;
    try {
      const session = await supabase.auth.getSession();
      if (!session.data.session) return false;

      const response = await fetch(`${SUPABASE_URL}/functions/v1/monzo-connect`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.data.session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ token }),
      });

      const data = await response.json();
      if (response.ok && data.success) {
        toast.success('Monzo account connected successfully!');
        fetchAll();
        return true;
      } else {
        toast.error(data.error || 'Failed to connect Monzo');
        return false;
      }
    } catch (err) {
      console.error('Monzo connect error:', err);
      toast.error('Network error connecting Monzo');
      return false;
    }
  };

  const syncMonzoTransactions = async (token?: string) => {
    if (!user) return;
    try {
      const session = await supabase.auth.getSession();
      if (!session.data.session) {
        toast.error('Not authenticated');
        return;
      }

      const response = await fetch(`${SUPABASE_URL}/functions/v1/monzo-sync`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.data.session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ token }),
      });

      const data = await response.json();
      if (!response.ok) {
        toast.error(data.error || 'Sync failed');
        return;
      }

      toast.success(`Synced Monzo accounts: imported ${data.transactionsImported} transactions`);
      
      // Auto-categorise after sync
      await categorizeTransactions();
      
      await fetchAll();
    } catch (err) {
      console.error('Monzo sync error:', err);
      toast.error('Network error during sync');
    }
  };

  const categorizeTransactions = async () => {
    if (!user) return;
    try {
      const session = await supabase.auth.getSession();
      if (!session.data.session) {
        toast.error('Not authenticated');
        return;
      }

      const response = await fetch(`${SUPABASE_URL}/functions/v1/finance-categorize`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.data.session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });

      const data = await response.json();
      if (!response.ok) {
        toast.error(data.error || 'Categorisation failed');
        return;
      }

      if (data.categorized > 0) {
        toast.success(`Categorised ${data.categorized} transactions (${data.rule} rules, ${data.ai} AI)`);
      } else {
        toast.info(data.message || 'All transactions already categorised');
      }
      fetchAll();
    } catch (err) {
      console.error('Categorize error:', err);
      toast.error('Network error during categorisation');
    }
  };

  // -- Computed values --
  const convertToBase = useCallback((amount: number, fromCurrency: string): number => {
    if (!settings) return amount;
    const base = settings.base_currency;
    if (!fromCurrency || fromCurrency === base) return amount;
    const rates = (settings.fx_rates || {}) as Record<string, number>;
    const direct = rates[`${fromCurrency}_${base}`];
    if (direct) return amount * direct;
    const inverse = rates[`${base}_${fromCurrency}`];
    if (inverse && inverse !== 0) return amount / inverse;
    console.warn(`[fx] no rate for ${fromCurrency}->${base}, using 1:1`);
    return amount;
  }, [settings]);

  const totalCashByCurrency = useCallback(() => {
    const totals: Record<string, number> = {};
    for (const acc of accounts) {
      if (acc.exclude_from_totals) continue;
      totals[acc.currency] = (totals[acc.currency] || 0) + acc.balance;
    }
    return totals;
  }, [accounts]);

  const totalCashBase = useCallback(() => {
    return accounts
      .filter(acc => !acc.exclude_from_totals)
      .reduce((sum, acc) => sum + convertToBase(acc.balance, acc.currency), 0);
  }, [accounts, convertToBase]);

  const addImportLog = async (log: {
    account_id: string; file_name: string; file_type: string;
    transactions_imported: number; transactions_skipped: number;
    balance_extracted: number | null;
  }) => {
    if (!user) return;
    await supabase.from('finance_import_logs').insert({
      user_id: user.id,
      ...log,
    });
    fetchAll();
  };

  const addIncomeSourceTag = async (sourceKey: string, groupName: string) => {
    if (!user) return;
    const { error } = await supabase.from('income_source_tags' as any).upsert(
      { user_id: user.id, source_key: sourceKey, group_name: groupName },
      { onConflict: 'user_id,source_key' } as any,
    );
    if (error) { toast.error('Failed to tag source'); return; }
    toast.success(`"${sourceKey}" → ${groupName}`);
    fetchAll();
  };

  const deleteIncomeSourceTag = async (id: string) => {
    const { error } = await supabase.from('income_source_tags' as any).delete().eq('id', id);
    if (error) { toast.error('Delete failed'); return; }
    fetchAll();
  };

  return {
    accounts, categories, transactions, goals, goalPlans, settings, loading,
    importLogs, addImportLog, deleteImportLog,
    incomeSourceTags, addIncomeSourceTag, deleteIncomeSourceTag,
    addAccount, updateAccount, deleteAccount,
    importTransactions, updateTransaction,
    addManualTransaction, deleteTransaction, getOrCreateExternalAccount,
    addGoal, deleteGoal, updateGoal, saveGoalPlan,
    updateSettings, addCategory, updateCategory, deleteCategory,
    convertToBase, totalCashByCurrency, totalCashBase,
    checkUpStatus, syncUpTransactions, categorizeTransactions,
    checkWiseStatus, connectWise, syncWiseTransactions,
    checkMonzoStatus, connectMonzo, syncMonzoTransactions,
    matchTransfers: async () => {
      if (!user) return;
      try {
        const session = await supabase.auth.getSession();
        if (!session.data.session) { toast.error('Not authenticated'); return; }
        const response = await fetch(`${SUPABASE_URL}/functions/v1/match-transfers`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.data.session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
        });
        const data = await response.json();
        if (!response.ok) { toast.error(data.error || 'Matching failed'); return; }
        toast.success(data.message || `${data.paired} transfers paired`);
        fetchAll();
      } catch (err) {
        console.error('Match transfers error:', err);
        toast.error('Network error during transfer matching');
      }
    },
    refetch: fetchAll,
  };
}

export function useFinanceData() {
  const context = useContext(FinanceContext);
  if (!context) {
    throw new Error('useFinanceData must be used within a FinanceProvider');
  }
  return context.finance;
}
