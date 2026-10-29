import { useState, useEffect, useCallback, useRef, useContext } from 'react';
import { supabase, SUPABASE_URL } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { computeTxFingerprint } from '@/lib/txFingerprint';
import { FinanceContext } from '@/contexts/FinanceContext';
import { recalibrateBankTimestamp } from '@/lib/timezoneEngine';
import { formatUkDate } from '@/lib/financeUtils';
import { deduplicateTransactions } from '@/lib/deduplication';

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
  is_archived?: boolean;
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
  raw?: any;
}

export interface FinanceGoal {
  id: string;
  user_id: string;
  name: string;
  description?: string | null;
  target_amount: number;
  currency: string;
  start_date?: string | null;
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
  user_timezone?: string;
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
  { name: 'Gamma Salary', type: 'income', is_cuttable: false, is_essential: false, color: '#db2777' },
  { name: 'Venture Advisory', type: 'income', is_cuttable: false, is_essential: false, color: '#2563eb' },
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
  const visaMigrationRef = useRef(false);

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
        supabase.from('finance_transactions').select('*').order('posted_at', { ascending: false }).limit(5000),
        supabase.from('finance_goals').select('*').order('priority'),
        supabase.from('finance_goal_plans').select('*').order('created_at', { ascending: false }),
        supabase.from('finance_settings').select('id, user_id, base_currency, fx_rates, user_timezone, bank_tokens, created_at, updated_at').eq('user_id', user.id).maybeSingle(),
        supabase.from('finance_import_logs').select('*').order('created_at', { ascending: false }),
        supabase.from('income_source_tags' as any).select('*').order('created_at'),
      ]);

      const accountsData = ((accRes.data || []) as any as FinanceAccount[]).map(acc => {
        if (acc.provider === 'monzo') {
          const rawName = (acc.account_name || '').trim();
          if (rawName.startsWith('user_0000')) {
            supabase.from('finance_accounts').update({ account_name: 'Monzo Personal' }).eq('id', acc.id).then(() => {}).catch(console.error);
            return { ...acc, account_name: 'Monzo Personal' };
          }
          if (rawName.toLowerCase().startsWith('joint account between user_')) {
            supabase.from('finance_accounts').update({ account_name: 'Monzo Joint Account' }).eq('id', acc.id).then(() => {}).catch(console.error);
            return { ...acc, account_name: 'Monzo Joint Account' };
          }
        }
        return acc;
      });
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

        // Self-healing: Ensure Gamma Salary income category exists
        const hasGammaCat = catRes.data.some((c: any) => c.type === 'income' && c.name.toLowerCase().includes('gamma'));
        if (!hasGammaCat && catRes.data.length > 0) {
          supabase.from('finance_categories').insert({
            user_id: user.id,
            name: 'Gamma Salary',
            type: 'income',
            is_cuttable: false,
            is_essential: false,
            color: '#db2777'
          }).then(() => {
            fetchAll();
          }).catch(err => {
            console.error('[self-healing] Failed to create Gamma Salary category', err);
          });
        }

        // Self-healing: Ensure Venture Advisory income category exists
        const hasVentureCat = catRes.data.some((c: any) => c.type === 'income' && (c.name.toLowerCase().includes('venture') || c.name.toLowerCase().includes('batchbase')));
        if (!hasVentureCat && catRes.data.length > 0) {
          supabase.from('finance_categories').insert({
            user_id: user.id,
            name: 'Venture Advisory',
            type: 'income',
            is_cuttable: false,
            is_essential: false,
            color: '#2563eb'
          }).then(() => {
            fetchAll();
          }).catch(err => {
            console.error('[self-healing] Failed to create Venture Advisory category', err);
          });
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
        const ventureCat = (catRes.data || []).find((c: any) =>
          c.type === 'income' && (c.name.toLowerCase().includes('venture') || c.name.toLowerCase().includes('batchbase'))
        );
        const gammaCat = (catRes.data || []).find((c: any) =>
          c.type === 'income' && c.name.toLowerCase().includes('gamma')
        );

        // Self-healing for Gabriella Blyth / Batchbase / Gamma Salary transactions & purging fake Travel Savings mirror transactions
        const TRAVEL_SAVINGS_ACCOUNT_ID = '070104ff-80bf-4b70-a19a-23afce14be9b';
        const healingByCat: Record<string, string[]> = {};
        const transferFlagFixIds: string[] = [];
        const mirrorDeleteIds: string[] = [];

        const enriched = (txRes.data as any[])
          .filter(t => {
            if (excludedAccountIds.has(t.account_id)) return false;
            // Detect fake mirror deductions created for Gabriella Blyth / Batchbase in Travel Savings
            const desc = (t.description || '').toLowerCase();
            const merch = (t.merchant || '').toLowerCase();
            const isMirror = t.account_id === TRAVEL_SAVINGS_ACCOUNT_ID && desc.includes('transfer to up') && (
              desc.includes('gabriella') || desc.includes('batchbase') || desc.includes('batch base') || merch.includes('batchbase') || merch.includes('gabriella')
            );
            if (isMirror) {
              mirrorDeleteIds.push(t.id);
              return false;
            }
            return true;
          })
          .map(t => {
            const desc = (t.description || '').toLowerCase();
            const merch = (t.merchant || '').toLowerCase();
            const tags = Array.isArray(t.raw?.tags) ? t.raw.tags.map((x: any) => String(x).toLowerCase()) : [];
            const msg = (t.raw?.message || '').toLowerCase();
            const fullDesc = `${desc} ${merch} ${msg} ${tags.join(' ')}`;
            const numAmt = Number(t.amount) || 0;

            // Self-heal Gamma Salary payments (e.g. Monzo "10012726" with merchant "Gamma", >= £500)
            const isGammaSalary = numAmt >= 500 && (fullDesc.includes('gamma') || desc === '10012726');
            if (isGammaSalary) {
              const cleanGammaDesc = /^\d+$/.test((t.description || '').trim())
                ? `Gamma (${(t.description || '').trim()})`
                : t.description;
              const targetCatId = !t.category_id && gammaCat ? gammaCat.id : t.category_id;
              const needsDbHeal =
                t.is_transfer ||
                t.transfer_status ||
                t.transfer_side ||
                (!t.category_id && gammaCat) ||
                cleanGammaDesc !== t.description;
              if (needsDbHeal) {
                supabase.from('finance_transactions').update({
                  description: cleanGammaDesc,
                  merchant: t.merchant || 'Gamma',
                  is_transfer: false,
                  transfer_side: null,
                  transfer_status: null,
                  category_id: targetCatId,
                }).eq('id', t.id).then(() => {}).catch(console.error);
              }
              return {
                ...t,
                description: cleanGammaDesc,
                merchant: t.merchant || 'Gamma',
                is_transfer: false,
                transfer_side: null,
                transfer_status: null,
                category_id: targetCatId,
                base_amount: toBase(numAmt, t.currency),
              };
            }

            const isBatchbase = fullDesc.includes('batchbase') || fullDesc.includes('batch base') || tags.includes('batchbase') || tags.includes('batch');
            const isGabriella = fullDesc.includes('gabriella') || fullDesc.includes('gabriella blyth');
            const isVentureText = fullDesc.includes('venture') || fullDesc.includes('advisory');

            // Incoming money from Gabriella Blyth without a matched outgoing transfer leg is personal income, never an internal transfer
            // Only explicit Batchbase/Venture text is VA. Ambiguous "Gabriella" deposits go to the generic Income bucket until sorted.
            const isVentureIncome = numAmt > 0 && (isBatchbase || isVentureText);
            const isGabriellaSingleDeposit = isGabriella && numAmt > 0 && !t.transfer_group_id;

            if (isVentureIncome || isGabriellaSingleDeposit) {
              // Only auto-assign when uncategorised — never override a category you've set
              const genericIncome = (catRes.data || []).find((c: any) => c.type === 'income' && c.name.trim().toLowerCase() === 'income');
              const autoCat = isVentureIncome ? ventureCat : genericIncome;
              const targetCatId = !t.category_id && autoCat ? autoCat.id : t.category_id;
              const hasTransferFlag = t.is_transfer || t.transfer_status || t.transfer_side;

              if (!t.category_id && autoCat) {
                (healingByCat[autoCat.id] ||= []).push(t.id);
              } else if (hasTransferFlag) {
                transferFlagFixIds.push(t.id);
              }
              return {
                ...t,
                is_transfer: false,
                transfer_side: null,
                transfer_status: null,
                category_id: targetCatId,
                base_amount: toBase(numAmt, t.currency),
              };
            }

            return {
              ...t,
              base_amount: toBase(Number(t.amount) || 0, t.currency),
            };
          });

        // Clean up duplicates using canonical deduplication engine:
        // Handles Amazon orders, weekend-to-Monday settlements (Habibi, Tesco, TfGM, Lidl, Greggs, Primark, etc.),
        // same-day double records, and CSV-to-API sync duplicates, while preserving user categories.
        const {
          cleaned: cleanedEnriched,
          duplicatesToDelete,
          categoryTransfers,
          externalIdTransfers,
        } = deduplicateTransactions(enriched);

        setTransactions(cleanedEnriched as any);

        // Run async cleanup in background without blocking render (chunked to avoid URL length limits)
        if (duplicatesToDelete.length > 0) {
          const CHUNK_SIZE = 100;
          const deleteChunks: Promise<any>[] = [];
          for (let i = 0; i < duplicatesToDelete.length; i += CHUNK_SIZE) {
            const chunk = duplicatesToDelete.slice(i, i + CHUNK_SIZE);
            deleteChunks.push(supabase.from('finance_transactions').delete().in('id', chunk));
          }
          Promise.all(deleteChunks).then(() => {
            console.log(`[self-healing] Purged ${duplicatesToDelete.length} duplicate transactions`);
          }).catch(console.error);
        }
        for (const [id, catId] of Object.entries(categoryTransfers)) {
          supabase.from('finance_transactions').update({ category_id: catId }).eq('id', id).catch(console.error);
        }
        for (const [id, extId] of Object.entries(externalIdTransfers)) {
          supabase.from('finance_transactions').update({ external_transaction_id: extId }).eq('id', id).catch(console.error);
        }
        if (mirrorDeleteIds.length > 0) {
          supabase.from('finance_transactions').delete().in('id', mirrorDeleteIds).then(() => {
            console.log(`[self-healing] Purged ${mirrorDeleteIds.length} fake Travel Savings mirror transactions for Gabriella/batchbase`);
          }).catch(console.error);
        }
        for (const [catId, ids] of Object.entries(healingByCat)) {
          supabase.from('finance_transactions').update({
            is_transfer: false,
            transfer_side: null,
            transfer_status: null,
            category_id: catId,
          }).in('id', ids).then(() => {
            console.log(`[self-healing] Auto-categorised ${ids.length} incoming payments`);
          }).catch(console.error);
        }
        if (transferFlagFixIds.length > 0) {
          supabase.from('finance_transactions').update({
            is_transfer: false,
            transfer_side: null,
            transfer_status: null,
          }).in('id', transferFlagFixIds).then(() => {}).catch(console.error);
        }
      }
      if (goalRes.data) {
        setGoals(goalRes.data as any);

        // Self-healing: Transfer Visa pool funds to Emergency Reserve and set Visa start_date to Jan 1st 2027
        if (goalRes.data.length > 0 && !visaMigrationRef.current) {
          const visaGoal = goalRes.data.find((g: any) => g.name.toLowerCase().includes('visa'));
          const emergencyGoal = goalRes.data.find((g: any) => (g as any).is_emergency === true || g.name.toLowerCase().includes('emergency'));
          
          if (visaGoal) {
            const visaAssigned = visaGoal.assigned_amount || 0;
            const currentStartDate = (visaGoal as any).start_date ? String((visaGoal as any).start_date).split('T')[0] : '';
            const needsStartDateUpdate = currentStartDate !== '2027-01-01';

            if (visaAssigned > 0 || needsStartDateUpdate) {
              visaMigrationRef.current = true;
              const updates: Promise<any>[] = [];
              if (visaAssigned > 0 && emergencyGoal) {
                updates.push(
                  supabase.from('finance_goals').update({
                    assigned_amount: (emergencyGoal.assigned_amount || 0) + visaAssigned
                  }).eq('id', emergencyGoal.id)
                );
              }
              updates.push(
                supabase.from('finance_goals').update({
                  assigned_amount: 0,
                  start_date: '2027-01-01'
                }).eq('id', visaGoal.id)
              );
              Promise.all(updates).then(() => {
                toast.success(`Transferred ${visaAssigned > 0 ? `Visa funds into Emergency Reserve & set ` : ''}Visa start date to 1 Jan 2027`);
                fetchAll();
              }).catch(err => {
                console.error('[self-healing] Failed to update Visa pool', err);
              });
            }
          }
        }
      }
      if (planRes.data) setGoalPlans(planRes.data as any);
      if (logRes.data) setImportLogs(logRes.data as any);
      if (tagRes.data) setIncomeSourceTags(tagRes.data as any);
      
      if (setRes.data) {
        setSettings(setRes.data as any);
      } else {
        const fallbackSettings = {
          user_id: user.id,
          fx_rates: { AUD_GBP: 0.52, GBP_AUD: 1.92 },
          base_currency: 'GBP',
          user_timezone: localStorage.getItem('gvb_user_timezone') || 'Europe/London'
        };
        setSettings(fallbackSettings as any);
        supabase.from('finance_settings').upsert(fallbackSettings as any, { onConflict: 'user_id' }).then(({ error }) => {
          if (error && error.message?.includes('user_timezone')) {
            const copy = { ...fallbackSettings };
            delete (copy as any).user_timezone;
            supabase.from('finance_settings').upsert(copy as any, { onConflict: 'user_id' });
          }
        });
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

  const prepareUpTransactionsForSync = useCallback(async () => {
    if (!user) return;
    try {
      const { data: upAccs } = await supabase
        .from('finance_accounts')
        .select('id')
        .eq('user_id', user.id)
        .eq('provider', 'up');
      const upAccIds = (upAccs || []).map(a => a.id);
      if (upAccIds.length > 0) {
        await supabase
          .from('finance_transactions')
          .update({ external_transaction_id: null } as any)
          .eq('user_id', user.id)
          .in('account_id', upAccIds)
          .not('transaction_fingerprint', 'is', null)
          .not('external_transaction_id', 'is', null);
      }
    } catch (err) {
      console.warn('[up-sync-prep] Failed to prepare Up transactions:', err);
    }
  }, [user]);

  const autoSyncRef = useRef(false);
  useEffect(() => {
    if (!user || autoSyncRef.current) return;
    autoSyncRef.current = true;
    (async () => {
      try {
        const session = await supabase.auth.getSession();
        const token = session.data.session?.access_token;
        if (!token) return;
        const headers = {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        };
        await prepareUpTransactionsForSync();
        const wiseToken = localStorage.getItem('gvb_wise_api_token') || undefined;
        await Promise.allSettled([
          syncMonzoDirect(undefined, { silent: true }),
          fetch(`${SUPABASE_URL}/functions/v1/up-sync`, { method: 'POST', headers, body: JSON.stringify({}) }),
          fetch(`${SUPABASE_URL}/functions/v1/wise-sync`, { method: 'POST', headers, body: JSON.stringify({ token: wiseToken }) }),
        ]);
        await prepareUpTransactionsForSync();
        await fetch(`${SUPABASE_URL}/functions/v1/finance-categorize`, { method: 'POST', headers, body: JSON.stringify({}) });
        await fetchAll();
      } catch (err) {
        console.warn('[auto-sync] Background bank sync skipped:', err);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, fetchAll, prepareUpTransactionsForSync]);

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
    const finalUpdates: any = { ...updates };
    if (updates.category_id) {
      const cat = categories.find(c => c.id === updates.category_id);
      if (cat?.type === 'income') {
        finalUpdates.is_transfer = false;
        finalUpdates.transfer_status = null;
      }
    }
    const { error } = await supabase.from('finance_transactions').update(finalUpdates).eq('id', id);
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

  const addGoal = async (goal: { name: string; description?: string | null; target_amount: number; currency: string; start_date?: string | null; deadline?: string; priority?: number; safety_mode?: string; assigned_amount?: number; color?: string }) => {
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
    if (error) {
      console.error('[updateGoal] Error:', error);
      toast.error(`Update failed: ${error.message}`);
      return;
    }
    await fetchAll();
  };

  const saveGoalPlan = async (plan: Omit<FinanceGoalPlan, 'id' | 'created_at'>) => {
    if (!user) return;
    const { error } = await supabase.from('finance_goal_plans').insert({ ...plan, user_id: user.id });
    if (error) { toast.error('Failed to save plan'); return; }
    fetchAll();
  };

  const updateSettings = async (updates: Partial<Pick<FinanceSettings, 'fx_rates' | 'base_currency' | 'user_timezone'>>) => {
    if (!user) return;
    if (updates.user_timezone) {
      localStorage.setItem('gvb_user_timezone', updates.user_timezone);
    }
    const existing = settings || {};
    const updated = {
      ...existing,
      ...updates,
      user_id: user.id,
      fx_rates: updates.fx_rates || existing.fx_rates || { AUD_GBP: 0.52, GBP_AUD: 1.92 },
      base_currency: updates.base_currency || existing.base_currency || 'GBP',
      user_timezone: updates.user_timezone || existing.user_timezone || localStorage.getItem('gvb_user_timezone') || 'Europe/London',
    };
    setSettings(updated as any);
    const { error } = await supabase.from('finance_settings').upsert(updated as any, { onConflict: 'user_id' });
    if (error) {
      if (error.message?.includes('user_timezone')) {
        const fallback = { ...updated };
        delete (fallback as any).user_timezone;
        await supabase.from('finance_settings').upsert(fallback as any, { onConflict: 'user_id' });
      } else {
        toast.error('Settings update failed: ' + error.message);
        return;
      }
    }
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

  const updateCategory = async (id: string, updates: Partial<Pick<FinanceCategory, 'name' | 'type' | 'is_cuttable' | 'is_essential' | 'exclude_from_reports' | 'color' | 'is_archived'>>) => {
    const { error } = await supabase.from('finance_categories').update(updates as any).eq('id', id);
    if (error) {
      if (error.message?.includes('is_archived')) {
        const fallback = { ...updates };
        delete (fallback as any).is_archived;
        if (Object.keys(fallback).length > 0) {
          await supabase.from('finance_categories').update(fallback as any).eq('id', id);
        }
      } else {
        toast.error(`Update failed: ${error.message}`);
        return;
      }
    }
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

  const syncUpTransactions = async (opts?: { skipAutoCategorize?: boolean }) => {
    if (!user) return;
    try {
      const session = await supabase.auth.getSession();
      if (!session.data.session) {
        toast.error('Not authenticated');
        return;
      }

      await prepareUpTransactionsForSync();

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

      await prepareUpTransactionsForSync();

      toast.success(`Synced ${data.accountsSynced} accounts, ${data.transactionsImported} transactions`);
      
      if (!opts?.skipAutoCategorize) {
        await categorizeTransactions();
      }
      
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

  const syncWiseTransactions = async (token?: string, opts?: { skipAutoCategorize?: boolean }) => {
    if (!user) return;
    try {
      const session = await supabase.auth.getSession();
      if (!session.data.session) {
        toast.error('Not authenticated');
        return;
      }

      const activeToken = token || localStorage.getItem('gvb_wise_api_token') || undefined;

      const response = await fetch(`${SUPABASE_URL}/functions/v1/wise-sync`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.data.session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ token: activeToken }),
      });

      const data = await response.json();
      if (!response.ok) {
        toast.error(data.error || 'Sync failed');
        if (data.error && (data.error.includes('Missing') || data.error.includes('invalid') || data.error.includes('token'))) {
          window.dispatchEvent(new CustomEvent('open-wise-token-modal'));
        }
        return;
      }

      if (activeToken) {
        localStorage.setItem('gvb_wise_api_token', activeToken);
      }

      toast.success(data.message || `Synced Wise accounts: imported ${data.transactionsImported} transactions`);
      
      if (!opts?.skipAutoCategorize) {
        await categorizeTransactions();
      }
      
      await fetchAll();
    } catch (err) {
      console.error('Wise sync error:', err);
      toast.error('Network error during sync');
    }
  };

  const syncMonzoDirect = async (
    overrideToken?: string,
    opts?: { silent?: boolean; skipAutoCategorize?: boolean }
  ): Promise<{ connected: boolean; success: boolean; accountsCount: number; transactionsImported: number; inserted: number; error?: string }> => {
    if (!user) {
      return { connected: false, success: false, accountsCount: 0, transactionsImported: 0, inserted: 0, error: 'Not authenticated' };
    }

    // Read stored bank_tokens from settings
    let storedBankTokens: any = {};
    try {
      const { data: settingsRow } = await supabase
        .from('finance_settings')
        .select('bank_tokens')
        .eq('user_id', user.id)
        .maybeSingle();
      if ((settingsRow as any)?.bank_tokens) {
        storedBankTokens = (settingsRow as any).bank_tokens;
      }
    } catch (e) {
      console.warn('[monzo-direct] Failed to read bank_tokens:', e);
    }

    const candidates = Array.from(
      new Set(
        [
          overrideToken?.replace(/\s+/g, ''),
          localStorage.getItem('gvb_monzo_access_token')?.replace(/\s+/g, ''),
          storedBankTokens?.monzo?.replace(/\s+/g, ''),
        ].filter((t): t is string => Boolean(t && t.length > 20))
      )
    );

    let activeToken: string | null = null;
    let monzoAccounts: any[] = [];
    let lastStatus = 0;

    for (const candidate of candidates) {
      try {
        const res = await fetch('https://api.monzo.com/accounts', {
          headers: {
            Authorization: `Bearer ${candidate}`,
            Accept: 'application/json',
          },
        });
        lastStatus = res.status;
        if (res.ok) {
          const data = await res.json();
          const openAccs = (data.accounts || []).filter((a: any) => !a.closed);
          if (openAccs.length > 0) {
            activeToken = candidate;
            monzoAccounts = openAccs;
            break;
          }
        }
      } catch (err) {
        console.warn('[monzo-direct] candidate token check failed:', err);
      }
    }

    // If access token expired and a permanent OAuth refresh_token is stored, rotate directly via Monzo OAuth2
    if ((!activeToken || monzoAccounts.length === 0) && storedBankTokens?.monzo_refresh) {
      try {
        const defaultCid = atob('b2F1dGgyY2xpZW50XzAwMDBCQUlVTWhyQThqRGdVNllkbXI=');
        const defaultCsec = atob(
          'bW56Y29uZi5KQTlhdHFqd1VEQ2dPYm5TUzJnVlJIVUZyUFNOUms2Q2RGQXliTTAxZE9mbnhsZXJ1S1hMUXNPN2pwTWIyMkN6YnJmWUJwVCs1dEQrN0NqV0pxdWdNQT09'
        );
        const clientId = storedBankTokens.monzo_client_id || defaultCid;
        const clientSecret = storedBankTokens.monzo_client_secret || defaultCsec;

        const refreshRes = await fetch('https://api.monzo.com/oauth2/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: storedBankTokens.monzo_refresh,
          }).toString(),
        });

        if (refreshRes.ok) {
          const freshData = await refreshRes.json();
          const newAccessToken = (freshData.access_token || '').replace(/\s+/g, '');
          const newRefreshToken = freshData.refresh_token || storedBankTokens.monzo_refresh;
          const newExpiresAt = Date.now() + (freshData.expires_in || 21600) * 1000;

          if (newAccessToken) {
            storedBankTokens = {
              ...storedBankTokens,
              monzo: newAccessToken,
              monzo_refresh: newRefreshToken,
              monzo_expires_at: newExpiresAt,
              monzo_client_id: clientId,
              monzo_client_secret: clientSecret,
            };
            const accRes = await fetch('https://api.monzo.com/accounts', {
              headers: {
                Authorization: `Bearer ${newAccessToken}`,
                Accept: 'application/json',
              },
            });
            lastStatus = accRes.status;
            if (accRes.ok) {
              const accData = await accRes.json();
              const openAccs = (accData.accounts || []).filter((a: any) => !a.closed);
              if (openAccs.length > 0) {
                activeToken = newAccessToken;
                monzoAccounts = openAccs;
              }
            }
          }
        }
      } catch (refreshErr) {
        console.warn('[monzo-direct] OAuth refresh rotation failed:', refreshErr);
      }
    }

    if (!activeToken || monzoAccounts.length === 0) {
      return {
        connected: false,
        success: false,
        accountsCount: 0,
        transactionsImported: 0,
        inserted: 0,
        error: lastStatus === 401 ? 'Monzo token is invalid or expired' : 'Could not connect to Monzo API',
      };
    }

    // Persist verified working token locally & in finance_settings
    localStorage.setItem('gvb_monzo_access_token', activeToken);
    try {
      const bankTokens = { ...storedBankTokens, monzo: activeToken };
      await supabase
        .from('finance_settings')
        .upsert(
          {
            user_id: user.id,
            bank_tokens: bankTokens,
            updated_at: new Date().toISOString(),
          } as any,
          { onConflict: 'user_id' }
        );
    } catch (e) {
      console.warn('[monzo-direct] Failed to persist token to finance_settings:', e);
    }

    // Fetch existing Monzo accounts & categories in DB
    const [{ data: existingDbAccounts }, { data: dbCategories }] = await Promise.all([
      supabase.from('finance_accounts').select('*').eq('user_id', user.id).eq('provider', 'monzo'),
      supabase.from('finance_categories').select('*').eq('user_id', user.id),
    ]);

    const catList = (dbCategories || categories || []) as FinanceCategory[];
    const gammaCat = catList.find(c => c.type === 'income' && c.name.toLowerCase().includes('gamma'));

    const extToDbId: Record<string, string> = {};
    const nowIso = new Date().toISOString();

    for (const acc of monzoAccounts) {
      let balanceVal = 0;
      try {
        const balRes = await fetch(`https://api.monzo.com/balance?account_id=${acc.id}`, {
          headers: {
            Authorization: `Bearer ${activeToken}`,
            Accept: 'application/json',
          },
        });
        if (balRes.ok) {
          const balData = await balRes.json();
          balanceVal = (balData.balance || 0) / 100;
        }
      } catch (e) {
        console.warn('[monzo-direct] Balance fetch failed for', acc.id, e);
      }

      const isJoint = acc.type === 'uk_retail_joint' || acc.owner_type === 'joint';
      const defaultCleanName = isJoint ? 'Monzo Joint Account' : 'Monzo Personal';

      const existingMatch =
        (existingDbAccounts || []).find((a: any) => a.external_account_id === String(acc.id)) ||
        (!isJoint ? (existingDbAccounts || []).find((a: any) => !a.external_account_id) : undefined);

      if (existingMatch) {
        const existingName = (existingMatch.account_name || '').trim();
        const isRawMonzoIdName =
          existingName.startsWith('user_0000') ||
          existingName.toLowerCase().startsWith('joint account between user_');
        const finalName = isRawMonzoIdName || !existingName ? defaultCleanName : existingName;

        await supabase
          .from('finance_accounts')
          .update({
            account_name: finalName,
            balance: balanceVal,
            currency: acc.currency || 'GBP',
            external_account_id: String(acc.id),
            last_synced_at: nowIso,
            source_type: 'bank',
          })
          .eq('id', existingMatch.id);
        extToDbId[String(acc.id)] = existingMatch.id;
      } else {
        const { data: insertedAcc } = await supabase
          .from('finance_accounts')
          .upsert(
            {
              user_id: user.id,
              provider: 'monzo',
              account_name: defaultCleanName,
              currency: acc.currency || 'GBP',
              balance: balanceVal,
              external_account_id: String(acc.id),
              last_synced_at: nowIso,
              source_type: 'bank',
            },
            { onConflict: 'user_id,external_account_id' }
          )
          .select('id')
          .maybeSingle();

        if (insertedAcc?.id) {
          extToDbId[String(acc.id)] = insertedAcc.id;
        }
      }
    }

    // Fetch transactions for each Monzo account
    let transactionsImported = 0;
    const dbAccountIds = Object.values(extToDbId);
    const { data: existingTxs } = dbAccountIds.length > 0
      ? await supabase
          .from('finance_transactions')
          .select('id, account_id, external_transaction_id, transaction_fingerprint, category_id, is_transfer, goal_id, is_fixed, is_reimbursable, reimbursement_status, amount, description, merchant, posted_at')
          .eq('user_id', user.id)
          .in('account_id', dbAccountIds)
          .order('posted_at', { ascending: false })
          .limit(5000)
      : { data: [] as any[] };

    const existingByExtKey = new Map<string, any>();
    for (const row of existingTxs || []) {
      if (row.external_transaction_id) {
        existingByExtKey.set(`${row.account_id}:${row.external_transaction_id}`, row);
      }
    }

    for (const acc of monzoAccounts) {
      const dbAccountId = extToDbId[String(acc.id)];
      if (!dbAccountId) continue;

      let txs: any[] = [];
      try {
        const txRes = await fetch(
          `https://api.monzo.com/transactions?account_id=${acc.id}&limit=100&expand[]=merchant`,
          {
            headers: {
              Authorization: `Bearer ${activeToken}`,
              Accept: 'application/json',
            },
          }
        );
        if (txRes.ok) {
          const txData = await txRes.json();
          txs = txData.transactions || [];
        } else {
          const since = new Date();
          since.setDate(since.getDate() - 89);
          const sinceStr = since.toISOString().split('.')[0] + 'Z';
          const retryRes = await fetch(
            `https://api.monzo.com/transactions?account_id=${acc.id}&since=${sinceStr}&limit=100&expand[]=merchant`,
            {
              headers: {
                Authorization: `Bearer ${activeToken}`,
                Accept: 'application/json',
              },
            }
          );
          if (retryRes.ok) {
            const retryData = await retryRes.json();
            txs = retryData.transactions || [];
          }
        }
      } catch (e) {
        console.warn('[monzo-direct] Transactions fetch failed for', acc.id, e);
      }

      const rowsToUpsert: any[] = [];
      for (const tx of txs) {
        if (tx.decline_reason) continue; // Skip declined card attempts
        const rawAmount = (tx.amount || 0) / 100;
        if (rawAmount === 0) continue;

        const postedAt = tx.created || tx.settled || nowIso;
        const merchantName =
          typeof tx.merchant === 'object' && tx.merchant?.name
            ? tx.merchant.name
            : tx.counterparty?.name || null;
        const rawDesc = (tx.description || 'Monzo transaction').trim();
        const description =
          /^\d+$/.test(rawDesc) && merchantName ? `${merchantName} (${rawDesc})` : rawDesc;
        const merchant = merchantName || rawDesc || null;

        const fingerprint = await computeTxFingerprint({
          user_id: user.id,
          account_id: dbAccountId,
          posted_at: postedAt,
          amount: rawAmount,
          description,
        });
        const externalTxId = tx.id ? String(tx.id) : fingerprint;
        const extKey = `${dbAccountId}:${externalTxId}`;
        const existing = existingByExtKey.get(extKey);

        const fullText = `${description} ${merchant || ''} ${tx.counterparty?.name || ''}`.toLowerCase();
        const isGammaSalary = rawAmount >= 500 && fullText.includes('gamma');
        const isGammaReimb = rawAmount > 0 && rawAmount < 500 && fullText.includes('gamma network');
        const isOutgoingTransfer =
          rawAmount < 0 && (tx.category === 'transfers' || fullText.includes('gabriella'));

        const defaultCatId =
          isGammaSalary && gammaCat
            ? gammaCat.id
            : autoCategorizeTx(`${description} ${merchant || ''}`, catList);

        rowsToUpsert.push({
          user_id: user.id,
          account_id: dbAccountId,
          external_transaction_id: externalTxId,
          posted_at: postedAt,
          description,
          merchant,
          amount: rawAmount,
          currency: tx.currency || 'GBP',
          category_id: existing?.category_id ?? defaultCatId ?? null,
          is_transfer: isGammaSalary
            ? false
            : existing?.is_transfer !== undefined && existing?.is_transfer !== null
              ? existing.is_transfer
              : isOutgoingTransfer,
          transfer_side: isGammaSalary
            ? null
            : isOutgoingTransfer
              ? 'out'
              : existing?.transfer_side ?? null,
          transfer_status: isGammaSalary
            ? null
            : isOutgoingTransfer
              ? 'auto_confirmed'
              : existing?.transfer_status ?? null,
          goal_id: existing?.goal_id ?? null,
          is_fixed: existing?.is_fixed ?? false,
          is_reimbursable: existing?.is_reimbursable ?? isGammaReimb,
          reimbursement_status: existing?.reimbursement_status ?? (isGammaReimb ? 'reimbursed' : null),
          transaction_fingerprint: fingerprint,
          raw: {
            category: tx.category || null,
            merchantId: tx.merchant?.id || null,
            scheme: tx.scheme || null,
          },
        });
      }

      if (rowsToUpsert.length > 0) {
        const { data: upserted, error: upsertErr } = await supabase
          .from('finance_transactions')
          .upsert(rowsToUpsert, {
            onConflict: 'account_id,external_transaction_id',
            ignoreDuplicates: false,
          })
          .select('id');
        if (!upsertErr && upserted) {
          transactionsImported += upserted.length;
        }
      }
    }

    return {
      connected: true,
      success: true,
      accountsCount: monzoAccounts.length,
      transactionsImported,
      inserted: transactionsImported,
    };
  };

  const checkMonzoStatus = async (): Promise<{ connected: boolean; error?: string; accountsCount?: number }> => {
    if (!user) return { connected: false, error: 'not_authenticated' };
    try {
      const directRes = await syncMonzoDirect(undefined, { silent: true });
      if (directRes.connected) {
        toast.success(`Verified — ${directRes.accountsCount} Monzo account(s) connected & synced!`);
        await fetchAll();
        return { connected: true, accountsCount: directRes.accountsCount };
      }

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
      } else {
        toast.error(data.message || directRes.error || 'Connection check failed');
      }
      return data;
    } catch (err) {
      console.error('Monzo status error:', err);
      toast.error('Network error checking Monzo status');
      return { connected: false, error: 'network' };
    }
  };

  const connectMonzo = async (token?: string): Promise<any> => {
    if (!user) return false;
    try {
      const directRes = await syncMonzoDirect(token);
      if (directRes.success) {
        toast.success(
          `Monzo connected! Synced ${directRes.accountsCount} account(s) & ${directRes.transactionsImported} transaction(s).`
        );
        await fetchAll();
        return directRes;
      }

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
        return { success: true, connected: true, accountsCount: data.accountsSynced || 1 };
      } else {
        toast.error(data.error || directRes.error || 'Failed to connect Monzo');
        return false;
      }
    } catch (err) {
      console.error('Monzo connect error:', err);
      toast.error('Network error connecting Monzo');
      return false;
    }
  };

  const syncMonzoTransactions = async (token?: string, opts?: { skipAutoCategorize?: boolean }): Promise<any> => {
    if (!user) return { error: 'Not authenticated' };
    try {
      const directRes = await syncMonzoDirect(token, opts);
      if (directRes.success) {
        toast.success(`Synced Monzo accounts: imported ${directRes.transactionsImported} transactions`);
        if (!opts?.skipAutoCategorize) {
          await categorizeTransactions();
        }
        await fetchAll();
        return directRes;
      }

      const session = await supabase.auth.getSession();
      if (!session.data.session) {
        toast.error('Not authenticated');
        return { error: 'Not authenticated' };
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
        toast.error(data.error || directRes.error || 'Sync failed');
        return { error: data.error || directRes.error || 'Sync failed' };
      }

      toast.success(`Synced Monzo accounts: imported ${data.transactionsImported} transactions`);
      
      if (!opts?.skipAutoCategorize) {
        await categorizeTransactions();
      }
      
      await fetchAll();
      return { ...data, inserted: data.transactionsImported || 0 };
    } catch (err) {
      console.error('Monzo sync error:', err);
      toast.error('Network error during sync');
      return { error: 'Network error during sync' };
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
        toast.info(data.message || 'All transactions categorised');
      }

      // Auto-categorisation & repair pass:
      // STRICT RULE: Only consider transactions that currently have NO category assigned (category_id is null).
      // Any previously assigned transaction is 100% UNTOUCHED!
      const { data: uncatDbTxs } = await supabase
        .from('finance_transactions')
        .select('*')
        .eq('user_id', user.id)
        .is('category_id', null);

      const genericIncomeCat = categories.find(c => c.name.toLowerCase() === 'income');
      const gammaCat = categories.find(c => c.type === 'income' && c.name.toLowerCase().includes('gamma'));
      const ventureCat = categories.find(c => c.type === 'income' && (c.name.toLowerCase().includes('venture') || c.name.toLowerCase().includes('advisory')));
      const rentCat = categories.find(c => c.name.toLowerCase() === 'rent');

      for (const t of (uncatDbTxs || [])) {
        // Defensive check: if it already has a category, never touch it!
        if (t.category_id) continue;

        const cleanDesc = (t.description || '').replace(/<[^>]*>/g, '').trim();
        const cleanMerch = (t.merchant || '').replace(/<[^>]*>/g, '').trim() || null;
        let targetAmount = t.amount;

        // Fix £3k Gabriella Blyth deposit if negative
        if (Math.abs(t.amount) === 3000 && (cleanDesc.toUpperCase().includes('GABRIELLA') || cleanDesc.toUpperCase().includes('NOREF'))) {
          targetAmount = 3000.00;
        }

        const descUpper = cleanDesc.toUpperCase();
        const merchUpper = (cleanMerch || '').toUpperCase();
        const fullText = `${descUpper} ${merchUpper}`;

        const isBatchbase = fullText.includes('BATCHBASE') || fullText.includes('BATCH BASE');
        const isGabriella = fullText.includes('GABRIELLA');
        const absAmt = Math.abs(targetAmount);
        const isVentureIncome = isBatchbase || fullText.includes('VENTURE') || fullText.includes('ADVISORY');
        const isGabriellaOrUp = !isVentureIncome && (isGabriella || fullText.includes('UP ACCOUNT') || fullText.includes('UP BANK'));

        // Flag internal transfers from savings (strictly savings transfer keywords)
        const isSavingsTransfer = !isVentureIncome && !isBatchbase && !isGabriella && (
          fullText.includes('TRANSFER FROM SAVINGS') ||
          fullText.includes('SAVINGS TRANSFER') ||
          fullText.includes('TRANSFER TO SAVINGS')
        );

        if (targetAmount > 0 && !isSavingsTransfer) {
          let assignedCatId: string | null = null;
          if (isVentureIncome && ventureCat) {
            assignedCatId = ventureCat.id;
          } else if (fullText.includes('GAMMA') && gammaCat) {
            assignedCatId = gammaCat.id;
          } else if (isGabriellaOrUp && genericIncomeCat) {
            assignedCatId = genericIncomeCat.id;
          }

          if (assignedCatId) {
            await supabase.from('finance_transactions').update({
              amount: targetAmount,
              description: cleanDesc,
              merchant: cleanMerch,
              is_transfer: false,
              transfer_side: null,
              transfer_status: null,
              category_id: assignedCatId,
            }).eq('id', t.id);
          } else if (cleanDesc !== t.description || cleanMerch !== t.merchant || targetAmount !== t.amount) {
            await supabase.from('finance_transactions').update({
              amount: targetAmount,
              description: cleanDesc,
              merchant: cleanMerch,
            }).eq('id', t.id);
          }
        } else if (targetAmount < 0 && (fullText.includes('EVANS') || fullText.includes('RENTAL') || fullText.includes('LANDLORD') || fullText.includes('RENT'))) {
          if (rentCat) {
            await supabase.from('finance_transactions').update({
              amount: targetAmount,
              description: cleanDesc,
              merchant: cleanMerch,
              is_fixed: true,
              category_id: rentCat.id,
              is_transfer: false,
            }).eq('id', t.id);
          }
        } else if (cleanDesc !== t.description || cleanMerch !== t.merchant || targetAmount !== t.amount) {
          await supabase.from('finance_transactions').update({
            amount: targetAmount,
            description: cleanDesc,
            merchant: cleanMerch,
          }).eq('id', t.id);
        }
      }

      await fetchAll();
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
    rescanAndFixTimezones: async () => {
      if (!user) return;
      const livingTz = (settings as any)?.user_timezone || 'Europe/London';
      try {
        const { data: allTxs, error } = await supabase
          .from('finance_transactions')
          .select('*')
          .eq('user_id', user.id);

        if (error || !allTxs) {
          toast.error('Failed to fetch transactions for rescan');
          return;
        }

        let fixedCount = 0;
        for (const t of allTxs) {
          const rawTimestamp = (t as any).raw?.settledAt || (t as any).raw?.createdAt;
          let targetIso: string | null = null;

          if (rawTimestamp) {
            const d = new Date(rawTimestamp);
            if (!isNaN(d.getTime())) {
              targetIso = formatInTimezone(d, livingTz, 'ISO') + '+01:00';
            }
          } else if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}$/.test(String(t.posted_at))) {
            const recal = recalibrateBankTimestamp(t.posted_at, 'Australia/Melbourne', livingTz);
            targetIso = formatInTimezone(recal, livingTz, 'ISO') + '+01:00';
          }

          if (targetIso && targetIso !== t.posted_at) {
            await supabase.from('finance_transactions').update({ posted_at: targetIso }).eq('id', t.id);
            fixedCount++;
          }
        }

        toast.success(`Rescanned & corrected ${fixedCount} transaction dates to UK local time! 🚀`);
        await fetchAll();
      } catch (err) {
        console.error('Failed to rescan timezones:', err);
        toast.error('Error during timezone rescan');
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
