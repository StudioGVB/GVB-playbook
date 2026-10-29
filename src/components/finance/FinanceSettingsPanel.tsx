import { useState, useEffect, useRef, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Building2, Shield, Globe, Tag, Lock, Coins, TrendingUp, ArrowUpRight,
  Briefcase, Plus, Pencil, Trash2, Archive, ArchiveRestore, Check, X, Eye,
  EyeOff, CheckCircle2, XCircle, Loader2, RefreshCw, Target, Sparkles,
  Milestone, ArrowRight, UserCheck, KeyRound, Wallet
} from 'lucide-react';
import DeleteConfirmDialog from '@/components/DeleteConfirmDialog';
import type { useFinanceData } from '@/hooks/useFinanceData';
import { useFixedExpenses } from '@/hooks/useFixedExpenses';
import { formatCurrency } from '@/lib/financeUtils';
import { useFinanceAssumptions } from '@/hooks/useFinanceAssumptions';
import { TIMEZONE_PRESETS } from '@/lib/timezoneEngine';
import { supabase } from '@/integrations/supabase/client';
import { computeEmergencyLadder } from '@/lib/emergencyLadderEngine';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

type Props = { finance: ReturnType<typeof useFinanceData> };

const PRESET_COLORS = [
  '#EF4444', '#F97316', '#F59E0B', '#EAB308',
  '#84CC16', '#22C55E', '#10B981', '#14B8A6',
  '#06B6D4', '#0EA5E9', '#3B82F6', '#6366F1',
  '#8B5CF6', '#A855F7', '#D946EF', '#EC4899',
  '#F43F5E', '#78716C', '#64748B', '#6B7280',
  '#FBB5C5', '#FDBA9E', '#FDE68A', '#BBF7D0',
  '#A5F3FC', '#BAE6FD', '#C4B5FD', '#F0ABFC',
];

const INCOME_COLORS = ['#FF2EB8', '#4558ff', '#22C55E', '#F59E0B', '#8B5CF6', '#EC4899', '#06B6D4'];

function CategoryColorPicker({ color, onChange }: { color: string | null; onChange: (c: string) => void }) {
  const [customColor, setCustomColor] = useState(color || '#3B82F6');

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="w-5 h-5 rounded-full border border-border shrink-0 cursor-pointer hover:ring-2 hover:ring-ring hover:ring-offset-1 transition-all"
          style={{ backgroundColor: color || '#d1d5db' }}
        />
      </PopoverTrigger>
      <PopoverContent className="w-52 p-3" align="start">
        <div className="grid grid-cols-5 gap-1.5 mb-3">
          {PRESET_COLORS.map(c => (
            <button
              key={c}
              onClick={() => onChange(c)}
              className={`w-7 h-7 rounded-full border-2 transition-all ${color === c ? 'border-foreground scale-110' : 'border-transparent hover:scale-105'}`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={customColor}
            onChange={e => { setCustomColor(e.target.value); onChange(e.target.value); }}
            className="w-8 h-8 rounded cursor-pointer border-0 p-0"
          />
          <Input
            value={customColor}
            onChange={e => { setCustomColor(e.target.value); if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) onChange(e.target.value); }}
            className="h-7 text-xs font-mono flex-1"
            placeholder="#hex"
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default function FinanceSettingsPanel({ finance }: Props) {
  const { user } = useAuth();
  const {
    settings, categories, accounts, updateSettings, addCategory, updateCategory,
    deleteCategory, checkUpStatus, syncUpTransactions, checkWiseStatus, connectWise, syncWiseTransactions,
    checkMonzoStatus, connectMonzo, syncMonzoTransactions
  } = finance;
  const { assumptions, update: updateAssumptions } = useFinanceAssumptions();

  // Section navigation state
  const [activeSection, setActiveSection] = useState<'banks' | 'policy' | 'currency' | 'categories' | 'security'>(() => {
    const param = new URLSearchParams(window.location.search).get('section');
    if (param && ['banks', 'policy', 'currency', 'categories', 'security'].includes(param)) {
      return param as any;
    }
    return 'banks';
  });

  // FX & Currency
  const [audGbp, setAudGbp] = useState(String((settings?.fx_rates as any)?.AUD_GBP ?? '0.52'));
  const [gbpAud, setGbpAud] = useState(String((settings?.fx_rates as any)?.GBP_AUD ?? '1.92'));
  const [baseCurrency, setBaseCurrency] = useState(settings?.base_currency || 'GBP');

  // Emergency Ladder
  const [emergencyMonths, setEmergencyMonths] = useState('2');
  const [targetMonths, setTargetMonths] = useState(() => {
    return String((settings?.fx_rates as any)?.target_buffer_months || localStorage.getItem('gvb_target_buffer_months') || '6');
  });

  // Policy Settings
  const [savingsPercent, setSavingsPercent] = useState<number>(() => (assumptions as any)?.baseline_savings_percent ?? 10);
  const [expectedIncome, setExpectedIncome] = useState<string>(() => assumptions?.expected_monthly_income ? String(assumptions.expected_monthly_income) : '');
  const [jobStartDate, setJobStartDate] = useState<string>(() => assumptions?.income_start_date ?? '');
  const [savingPolicyLoading, setSavingPolicyLoading] = useState(false);

  // Income Sources
  const [newIncomeName, setNewIncomeName] = useState('');
  const [editingSourceId, setEditingSourceId] = useState<string | null>(null);
  const [editingSourceName, setEditingSourceName] = useState('');
  const [showArchivedSources, setShowArchivedSources] = useState(false);

  // Categories
  const [newCatName, setNewCatName] = useState('');
  const [newCatType, setNewCatType] = useState('variable');
  const [newCatColor, setNewCatColor] = useState('#3B82F6');
  const [editingCat, setEditingCat] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editType, setEditType] = useState('');
  const [deleteCatId, setDeleteCatId] = useState<string | null>(null);

  // Bank Integrations
  const [upChecking, setUpChecking] = useState(false);
  const [upSyncing, setUpSyncing] = useState(false);
  const [upStatus, setUpStatus] = useState<{ connected: boolean; error?: string } | null>(null);

  const [wiseChecking, setWiseChecking] = useState(false);
  const [wiseSyncing, setWiseSyncing] = useState(false);
  const [wiseStatus, setWiseStatus] = useState<{ connected: boolean; error?: string } | null>(null);
  const [wiseToken, setWiseToken] = useState('');

  const [monzoChecking, setMonzoChecking] = useState(false);
  const [monzoSyncing, setMonzoSyncing] = useState(false);
  const [monzoStatus, setMonzoStatus] = useState<{ connected: boolean; error?: string } | null>(null);
  const [monzoToken, setMonzoToken] = useState('');

  // Password Update
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [updatingPassword, setUpdatingPassword] = useState(false);

  // Timezone
  const [livingTimezone, setLivingTimezone] = useState(
    localStorage.getItem('gvb_user_timezone') || (settings as any)?.user_timezone || 'Europe/London'
  );
  const [rescanRunning, setRescanRunning] = useState(false);

  const { monthlyTotal: fixedMonthlyTotal } = useFixedExpenses();
  const fmtCurrency = (n: number) => formatCurrency(n, settings?.base_currency || 'AUD');

  const activeMonthsNum = parseInt(emergencyMonths) || (assumptions?.buffer_months ?? 2);
  const targetMonthsNum = parseInt(targetMonths) || 6;
  const essentialVariable = (assumptions as any)?.estimated_essential_variable ?? 0;
  const monthlySurvivalCost = fixedMonthlyTotal + essentialVariable;
  const totalLiquidCash = accounts
    .filter(a => !(a as any).exclude_from_totals)
    .reduce((sum, a) => sum + finance.convertToBase(a.balance, a.currency), 0);

  const ladderState = useMemo(() => {
    return computeEmergencyLadder({
      activeMonths: activeMonthsNum,
      targetMonths: targetMonthsNum,
      monthlySurvival: monthlySurvivalCost,
      totalLiquidCash,
      goals: finance.goals,
      convertToBase: finance.convertToBase,
    });
  }, [activeMonthsNum, targetMonthsNum, monthlySurvivalCost, totalLiquidCash, finance.goals, finance.convertToBase]);

  const upAccount = accounts.find(a => a.provider === 'up');
  const isUpConnected = !!upAccount || upStatus?.connected === true;

  const wiseAccount = accounts.find(a => a.provider === 'wise');
  const isWiseConnected = !!wiseAccount || wiseStatus?.connected === true;

  const monzoAccount = accounts.find(a => a.provider === 'monzo');
  const isMonzoConnected = !!monzoAccount || monzoStatus?.connected === true;

  const activeIncomeCats = useMemo(() => {
    return categories.filter(c => c.type === 'income' && !c.is_archived);
  }, [categories]);

  const archivedIncomeCats = useMemo(() => {
    return categories.filter(c => c.type === 'income' && c.is_archived);
  }, [categories]);

  useEffect(() => {
    if (settings) {
      const rates = (settings.fx_rates || {}) as Record<string, number>;
      setAudGbp(String(rates.AUD_GBP ?? 0.52));
      setGbpAud(String(rates.GBP_AUD ?? 1.92));
      setBaseCurrency(settings.base_currency || 'GBP');
      const tz = (settings as any).user_timezone || localStorage.getItem('gvb_user_timezone');
      if (tz) setLivingTimezone(tz);
      const savedTarget = (settings.fx_rates as any)?.target_buffer_months || localStorage.getItem('gvb_target_buffer_months');
      if (savedTarget) setTargetMonths(String(savedTarget));
    }
  }, [settings]);

  useEffect(() => {
    if (assumptions) {
      setEmergencyMonths(String(assumptions.buffer_months || 2));
      setSavingsPercent((assumptions as any).baseline_savings_percent ?? 10);
      setExpectedIncome(assumptions.expected_monthly_income ? String(assumptions.expected_monthly_income) : '');
      setJobStartDate(assumptions.income_start_date ?? '');
    }
  }, [assumptions]);

  const handleSaveFX = () => {
    const audVal = parseFloat(audGbp);
    const gbpVal = parseFloat(gbpAud);
    if (isNaN(audVal) || isNaN(gbpVal)) {
      toast.error('Please enter valid numerical exchange rates');
      return;
    }
    updateSettings({
      fx_rates: { AUD_GBP: audVal, GBP_AUD: gbpVal },
      base_currency: baseCurrency,
    });
    toast.success('Exchange rates saved!');
  };

  const handleSaveEmergencyMonths = async () => {
    if (!updateAssumptions) return;
    const active = parseInt(emergencyMonths) || 2;
    const target = parseInt(targetMonths) || 6;
    localStorage.setItem('gvb_target_buffer_months', String(target));
    if (updateSettings && settings) {
      updateSettings({
        fx_rates: {
          ...((settings.fx_rates as any) || {}),
          target_buffer_months: target,
        },
      });
    }
    await updateAssumptions({ buffer_months: active });
    toast.success('Emergency targets & ladder saved!');
  };

  const handleLevelUpOneMonth = async () => {
    if (!updateAssumptions) return;
    const nextVal = (parseInt(emergencyMonths) || (assumptions?.buffer_months ?? 2)) + 1;
    setEmergencyMonths(String(nextVal));
    await updateAssumptions({ buffer_months: nextVal });
    toast.success(`🎉 Emergency fund floor increased to ${nextVal} months!`);
  };

  const handleSavePolicySettings = async () => {
    if (!updateAssumptions) return;
    setSavingPolicyLoading(true);
    try {
      await updateAssumptions({
        baseline_savings_percent: savingsPercent,
        expected_monthly_income: parseFloat(expectedIncome) || null,
        income_start_date: jobStartDate || null,
      } as any);
      toast.success('Policy settings saved successfully!');
    } catch (e: any) {
      toast.error(e?.message || 'Failed to save policy settings');
    } finally {
      setSavingPolicyLoading(false);
    }
  };

  const handleAddIncomeSource = async () => {
    const name = newIncomeName.trim();
    if (!name) return;
    if (categories.some(c => c.type === 'income' && c.name.trim().toLowerCase() === name.toLowerCase())) {
      toast.error('That source already exists');
      return;
    }
    const color = INCOME_COLORS[categories.filter(c => c.type === 'income').length % INCOME_COLORS.length];
    try {
      await addCategory({ name, type: 'income', color });
      setNewIncomeName('');
      toast.success(`Added ${name}`);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to add source');
    }
  };

  const handleStartRenameSource = (c: { id: string; name: string }) => {
    setEditingSourceId(c.id);
    setEditingSourceName(c.name);
  };

  const handleSaveRenameSource = async (id: string) => {
    const name = editingSourceName.trim();
    if (!name) return;
    try {
      await updateCategory(id, { name });
      toast.success(`Renamed to "${name}"`);
      setEditingSourceId(null);
      setEditingSourceName('');
    } catch (e: any) {
      toast.error('Failed to rename source');
    }
  };

  const handleToggleArchiveSource = async (c: { id: string; name: string; is_archived?: boolean }) => {
    const willArchive = !c.is_archived;
    try {
      await updateCategory(c.id, { is_archived: willArchive } as any);
      toast.success(willArchive ? `"${c.name}" archived` : `"${c.name}" unarchived`);
    } catch (e: any) {
      toast.error('Failed to update source');
    }
  };

  const handleDeleteIncomeSource = async (id: string, name: string) => {
    if (!confirm(`Delete income source "${name}"? Existing transactions tagged to it will move to Other.`)) return;
    try {
      await deleteCategory(id);
      toast.success(`Removed ${name}`);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to delete source');
    }
  };

  const handleAddCategory = () => {
    if (!newCatName.trim()) return;
    addCategory({ name: newCatName.trim(), type: newCatType, color: newCatColor });
    setNewCatName('');
  };

  const handleStartEdit = (cat: typeof categories[0]) => {
    setEditingCat(cat.id);
    setEditName(cat.name);
    setEditType(cat.type);
  };

  const handleSaveEdit = (id: string) => {
    if (!editName.trim()) return;
    updateCategory(id, { name: editName.trim(), type: editType });
    setEditingCat(null);
  };

  const handleUpVerify = async () => {
    setUpChecking(true);
    try {
      const res = await checkUpStatus();
      setUpStatus(res);
      if (res.connected) toast.success('Up Bank connected successfully!');
      else toast.error(res.error || 'Up Bank connection check failed');
    } catch (err: any) {
      toast.error('Failed to check Up Bank status');
    } finally {
      setUpChecking(false);
    }
  };

  const handleUpSync = async () => {
    setUpSyncing(true);
    try {
      const res = await syncUpTransactions();
      if (res.error) toast.error(res.error);
      else toast.success(`Synced ${res.inserted || 0} Up Bank transactions!`);
    } catch (err: any) {
      toast.error('Up Bank sync failed');
    } finally {
      setUpSyncing(false);
    }
  };

  const handleWiseVerify = async () => {
    setWiseChecking(true);
    try {
      const res = await checkWiseStatus();
      setWiseStatus(res);
      if (res.connected) toast.success('Wise connected successfully!');
      else toast.error(res.error || 'Wise connection check failed');
    } catch (err: any) {
      toast.error('Failed to check Wise status');
    } finally {
      setWiseChecking(false);
    }
  };

  const handleWiseSync = async () => {
    setWiseSyncing(true);
    try {
      const res = await syncWiseTransactions();
      if (res.error) toast.error(res.error);
      else toast.success(`Synced ${res.inserted || 0} Wise transactions!`);
    } catch (err: any) {
      toast.error('Wise sync failed');
    } finally {
      setWiseSyncing(false);
    }
  };

  const handleWiseConnectManual = async () => {
    if (!wiseToken.trim()) { toast.error('Please enter a Wise API token'); return; }
    try {
      const res = await connectWise(wiseToken.trim());
      if (res.error) toast.error(res.error);
      else {
        toast.success('Wise connected via token!');
        setWiseToken('');
        handleWiseVerify();
      }
    } catch (err: any) {
      toast.error('Failed to save Wise token');
    }
  };

  const handleMonzoVerify = async () => {
    setMonzoChecking(true);
    try {
      const res = await checkMonzoStatus();
      setMonzoStatus(res);
      if (res.connected) toast.success('Monzo connected successfully!');
      else toast.error(res.error || 'Monzo connection check failed');
    } catch (err: any) {
      toast.error('Failed to check Monzo status');
    } finally {
      setMonzoChecking(false);
    }
  };

  const handleMonzoSync = async () => {
    setMonzoSyncing(true);
    try {
      const res = await syncMonzoTransactions();
      if (res.error) toast.error(res.error);
      else toast.success(`Synced ${res.inserted || 0} Monzo transactions!`);
    } catch (err: any) {
      toast.error('Monzo sync failed');
    } finally {
      setMonzoSyncing(false);
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    if (!code || !user) return;

    const cleanUrl = window.location.pathname;
    window.history.replaceState({}, document.title, cleanUrl);

    (async () => {
      const toastId = toast.loading('Completing permanent Monzo OAuth connection...');
      try {
        const defaultCid = atob('b2F1dGgyY2xpZW50XzAwMDBCQUlVTWhyQThqRGdVNllkbXI=');
        const defaultCsec = atob(
          'bW56Y29uZi5KQTlhdHFqd1VEQ2dPYm5TUzJnVlJIVUZyUFNOUms2Q2RGQXliTTAxZE9mbnhsZXJ1S1hMUXNPN2pwTWIyMkN6YnJmWUJwVCs1dEQrN0NqV0pxdWdNQT09'
        );
        const existingTokens = (settings as any)?.bank_tokens || {};
        const clientId = existingTokens.monzo_client_id || defaultCid;
        const clientSecret = existingTokens.monzo_client_secret || defaultCsec;
        const redirectUri = `${window.location.origin}/finance/settings`;

        const tokenRes = await fetch('https://api.monzo.com/oauth2/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            code: code.trim(),
          }).toString(),
        });

        if (!tokenRes.ok) {
          const errText = await tokenRes.text();
          toast.error(`Monzo OAuth exchange failed: ${errText}`, { id: toastId });
          return;
        }

        const tokenData = await tokenRes.json();
        const accessToken = tokenData.access_token;
        const refreshToken = tokenData.refresh_token;
        const expiresIn = tokenData.expires_in || 21600;

        const { data: settingsRow } = await supabase
          .from('finance_settings')
          .select('bank_tokens')
          .eq('user_id', user.id)
          .maybeSingle();

        const bankTokens = {
          ...((settingsRow as any)?.bank_tokens || {}),
          monzo: accessToken,
          monzo_refresh: refreshToken,
          monzo_expires_at: Date.now() + expiresIn * 1000,
          monzo_client_id: clientId,
          monzo_client_secret: clientSecret,
        };

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

        localStorage.setItem('gvb_monzo_access_token', accessToken);
        toast.success(
          'Permanent Monzo OAuth linked! Open the Monzo app on your phone and tap Approve, then click Verify Connection.',
          { id: toastId, duration: 10000 }
        );
        await connectMonzo(accessToken);
      } catch (err: any) {
        toast.error(`OAuth callback error: ${err.message}`, { id: toastId });
      }
    })();
  }, [user]);

  const handleMonzoConnectManual = async () => {
    const val = monzoToken.trim();
    if (!val) { toast.error('Please enter a Monzo access token'); return; }
    if (val.startsWith('mnzconf.') || val.startsWith('mnzpub.')) {
      if (user) {
        const { data: settingsRow } = await supabase
          .from('finance_settings')
          .select('bank_tokens')
          .eq('user_id', user.id)
          .maybeSingle();
        const defaultCid = atob('b2F1dGgyY2xpZW50XzAwMDBCQUlVTWhyQThqRGdVNllkbXI=');
        const bankTokens = {
          ...((settingsRow as any)?.bank_tokens || {}),
          monzo_client_id: defaultCid,
          monzo_client_secret: val,
        };
        await supabase.from('finance_settings').upsert(
          { user_id: user.id, bank_tokens: bankTokens, updated_at: new Date().toISOString() } as any,
          { onConflict: 'user_id' }
        );
        setMonzoToken('');
        toast.success('Saved Monzo Client Secret! Now click "Authorize Permanent Monzo OAuth" above.');
      }
      return;
    }
    try {
      const res = await connectMonzo(val);
      if (res?.error) toast.error(res.error);
      else {
        toast.success('Monzo connected via token!');
        setMonzoToken('');
        handleMonzoVerify();
      }
    } catch (err: any) {
      toast.error('Failed to save Monzo token');
    }
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 6) { toast.error('Password must be at least 6 characters'); return; }
    if (newPassword !== confirmPassword) { toast.error('Passwords do not match'); return; }
    setUpdatingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      toast.success('Password updated successfully! You can now sign in with this password.');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      toast.error(err.message || 'Failed to update password');
    } finally {
      setUpdatingPassword(false);
    }
  };

  const SECTIONS = [
    { id: 'banks', label: 'Bank Integrations', icon: Building2, badge: 'Live Sync' },
    { id: 'policy', label: 'Emergency & Policy', icon: Shield, badge: `${ladderState.activeMonths} Mo` },
    { id: 'currency', label: 'Currency & Timezone', icon: Globe, badge: baseCurrency },
    { id: 'categories', label: 'Categories & Sources', icon: Tag, badge: `${categories.length}` },
    { id: 'security', label: 'Account & Security', icon: Lock },
  ] as const;

  return (
    <div className="space-y-6 font-body">
      {/* Top Segmented Navigation Pills */}
      <div className="bg-white/90 backdrop-blur-md p-1.5 rounded-2xl border-2 border-[#FF7AD1]/30 shadow-xs">
        <div className="flex items-center gap-1.5 flex-wrap">
          {SECTIONS.map((sec) => {
            const Icon = sec.icon;
            const isActive = activeSection === sec.id;
            return (
              <button
                key={sec.id}
                type="button"
                onClick={() => setActiveSection(sec.id)}
                className={`px-3.5 sm:px-4 py-2 rounded-xl font-display font-bold text-xs flex items-center gap-2 transition-all cursor-pointer ${
                  isActive
                    ? 'bg-[#FF2EB8] text-white shadow-md shadow-[#FF2EB8]/25'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/70'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{sec.label}</span>
                {sec.badge && (
                  <Badge className={`text-[10px] px-1.5 py-0 rounded-full font-extrabold ${
                    isActive ? 'bg-white/20 text-white border-0' : 'bg-slate-100 text-slate-600 border border-slate-200'
                  }`}>
                    {sec.badge}
                  </Badge>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* SECTION 1: BANK INTEGRATIONS */}
      {activeSection === 'banks' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between pb-2 border-b border-slate-200/80">
            <div>
              <h2 className="text-xl font-display font-bold text-slate-900 flex items-center gap-2">
                <Building2 className="w-5 h-5 text-[#FF2EB8]" />
                <span>Bank Integrations & Sync</span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Connect and synchronize real-time accounts across Australia and the UK.
              </p>
            </div>
          </div>

          <div className="space-y-4">
            {/* Up Bank */}
            <Card className="border-2 border-slate-200/80 shadow-xs hover:border-[#FF7AD1]/50 transition-all">
              <CardContent className="p-5 sm:p-6 space-y-4">
                <div className="flex items-start justify-between flex-wrap gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-display font-bold text-base text-slate-900">Up Bank (Australia)</h3>
                      {isUpConnected ? (
                        <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 font-bold text-[10px]">
                          <CheckCircle2 className="w-3 h-3 mr-1" /> Connected
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-slate-500 text-[10px]">Not verified</Badge>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      {upAccount?.last_synced_at ? `Last synced: ${new Date(upAccount.last_synced_at).toLocaleString()}` : 'Connects using UP_PERSONAL_TOKEN cloud secret.'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" onClick={handleUpVerify} disabled={upChecking} className="text-xs font-semibold h-8">
                      {upChecking ? <><Loader2 className="h-3 w-3 animate-spin mr-1" /> Checking...</> : 'Verify Connection'}
                    </Button>
                    {isUpConnected && (
                      <Button size="sm" onClick={handleUpSync} disabled={upSyncing} className="bg-[#FF2EB8] hover:bg-[#e5299f] text-white font-semibold text-xs h-8">
                        {upSyncing ? <><Loader2 className="h-3 w-3 animate-spin mr-1" /> Syncing...</> : 'Sync Now'}
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Wise */}
            <Card className="border-2 border-slate-200/80 shadow-xs hover:border-[#FF7AD1]/50 transition-all">
              <CardContent className="p-5 sm:p-6 space-y-4">
                <div className="flex items-start justify-between flex-wrap gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-display font-bold text-base text-slate-900">Wise Multi-Currency</h3>
                      {isWiseConnected ? (
                        <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 font-bold text-[10px]">
                          <CheckCircle2 className="w-3 h-3 mr-1" /> Connected
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-slate-500 text-[10px]">Not verified</Badge>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      {wiseAccount?.last_synced_at ? `Last synced: ${new Date(wiseAccount.last_synced_at).toLocaleString()}` : 'Supports multi-currency pots and balance synchronization.'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" onClick={handleWiseVerify} disabled={wiseChecking} className="text-xs font-semibold h-8">
                      {wiseChecking ? <><Loader2 className="h-3 w-3 animate-spin mr-1" /> Checking...</> : 'Verify Connection'}
                    </Button>
                    {isWiseConnected && (
                      <Button size="sm" onClick={handleWiseSync} disabled={wiseSyncing} className="bg-[#FF2EB8] hover:bg-[#e5299f] text-white font-semibold text-xs h-8">
                        {wiseSyncing ? <><Loader2 className="h-3 w-3 animate-spin mr-1" /> Syncing...</> : 'Sync Now'}
                      </Button>
                    )}
                  </div>
                </div>

                <div className="bg-slate-50/80 rounded-xl p-3 text-xs text-slate-600 space-y-2 border border-slate-200/60">
                  <p><strong>Setup Option A:</strong> Add your Wise API token as a Cloud Secret named <code className="bg-white px-1.5 py-0.5 rounded border border-slate-200 text-[11px] font-mono">WISE_API_KEY</code>, then click Verify.</p>
                  <div className="pt-1 flex items-center gap-2">
                    <Input
                      type="password"
                      placeholder="Or paste Wise API Token directly here"
                      value={wiseToken}
                      onChange={e => setWiseToken(e.target.value)}
                      className="text-xs h-8 bg-white"
                    />
                    <Button size="sm" onClick={handleWiseConnectManual} className="h-8 text-xs font-semibold shrink-0">
                      Save Token
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Monzo */}
            <Card className="border-2 border-slate-200/80 shadow-xs hover:border-[#FF7AD1]/50 transition-all">
              <CardContent className="p-5 sm:p-6 space-y-4">
                <div className="flex items-start justify-between flex-wrap gap-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-display font-bold text-base text-slate-900">Monzo (UK Banking)</h3>
                      {isMonzoConnected ? (
                        <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 font-bold text-[10px]">
                          <CheckCircle2 className="w-3 h-3 mr-1" /> Connected
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-slate-500 text-[10px]">Not verified</Badge>
                      )}
                      {(settings as any)?.bank_tokens?.monzo_refresh ? (
                        <Badge className="bg-blue-100 text-blue-800 border-blue-300 font-bold text-[10px]">
                          Permanent OAuth Active
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-amber-50 text-amber-800 border-amber-300 text-[10px]">
                          24h Playground Token
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      {monzoAccount?.last_synced_at ? `Last synced: ${new Date(monzoAccount.last_synced_at).toLocaleString()}` : 'Connects via Permanent Monzo OAuth or direct token.'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" onClick={handleMonzoVerify} disabled={monzoChecking} className="text-xs font-semibold h-8">
                      {monzoChecking ? <><Loader2 className="h-3 w-3 animate-spin mr-1" /> Checking...</> : 'Verify Connection'}
                    </Button>
                    {isMonzoConnected && (
                      <Button size="sm" onClick={handleMonzoSync} disabled={monzoSyncing} className="bg-[#FF2EB8] hover:bg-[#e5299f] text-white font-semibold text-xs h-8">
                        {monzoSyncing ? <><Loader2 className="h-3 w-3 animate-spin mr-1" /> Syncing...</> : 'Sync Now'}
                      </Button>
                    )}
                  </div>
                </div>

                <div className="bg-slate-50/80 rounded-xl p-3 text-xs text-slate-600 space-y-2.5 border border-slate-200/60">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="space-y-1">
                      <p className="text-[11px] text-slate-600">
                        <strong>Permanent Sync (Recommended):</strong> Authorize your Confidential OAuth client (<code className="bg-white px-1 py-0.5 rounded border text-[10px] font-mono">oauth2client_0000BAIUMhrA8jDgU6Ydmr</code>) so tokens auto-renew forever.
                      </p>
                      <p className="text-[11px] text-slate-500">
                        In Monzo Developer Portal → <strong>Redirect URL</strong>, set:{' '}
                        <code
                          onClick={() => {
                            navigator.clipboard.writeText(`${window.location.origin}/finance/settings`);
                            toast.success('Copied Redirect URL to clipboard!');
                          }}
                          className="bg-white px-1.5 py-0.5 rounded border text-[10px] font-mono text-pink-600 cursor-pointer hover:bg-pink-50"
                          title="Click to copy"
                        >
                          https://gvb-playbook.vercel.app/finance/settings
                        </code>{' '}
                        (click to copy), save in Monzo, then click Authorize:
                      </p>
                    </div>
                    <Button
                      size="sm"
                      type="button"
                      className="h-8 text-xs font-bold bg-[#FF4D6D] hover:bg-[#FF4D6D]/90 text-white shrink-0"
                      onClick={async () => {
                        const { data } = await supabase.auth.getSession();
                        const userId = data.session?.user.id || 'monzo_oauth';
                        const clientId = atob('b2F1dGgyY2xpZW50XzAwMDBCQUlVTWhyQThqRGdVNllkbXI=');
                        const redirectUri = encodeURIComponent(`${window.location.origin}/finance/settings`);
                        window.location.href = `https://auth.monzo.com/?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&state=${userId}`;
                      }}
                    >
                      Authorize Permanent Monzo OAuth
                    </Button>
                  </div>
                  <div className="pt-1 flex items-center gap-2 border-t border-slate-200/60">
                    <Input
                      type="password"
                      placeholder="Optional: paste manual Access Token (eyJ...) or Client Secret (mnzconf...)"
                      value={monzoToken}
                      onChange={e => setMonzoToken(e.target.value)}
                      className="text-xs h-8 bg-white"
                    />
                    <Button size="sm" variant="outline" onClick={handleMonzoConnectManual} className="h-8 text-xs font-semibold shrink-0">
                      Save Token
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* SECTION 2: EMERGENCY & POLICY */}
      {activeSection === 'policy' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between pb-2 border-b border-slate-200/80">
            <div>
              <h2 className="text-xl font-display font-bold text-slate-900 flex items-center gap-2">
                <Shield className="w-5 h-5 text-emerald-600" />
                <span>Emergency Reserve & Policy Rules</span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Manage your multi-stage safety buffer, holiday pot protection ladder, and baseline income rules.
              </p>
            </div>
          </div>

          {/* Emergency Fund Target & Growth Ladder */}
          <Card className="border-2 border-emerald-100/80 shadow-xs">
            <CardHeader className="pb-3 bg-gradient-to-r from-emerald-50/60 via-teal-50/30 to-transparent border-b border-emerald-100/50">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-emerald-100 flex items-center justify-center text-emerald-700">
                    <Shield className="w-4 h-4" />
                  </div>
                  <div>
                    <CardTitle className="text-base font-bold text-slate-900">
                      Emergency Fund Target & Growth Ladder
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">
                      Build up to 6+ months in stages so short-term saving pots stay achievable today.
                    </p>
                  </div>
                </div>
                <Badge variant="outline" className="bg-emerald-50 text-emerald-800 border-emerald-200 font-bold px-2.5 py-1 text-xs">
                  Stage {ladderState.activeMonths} of {ladderState.targetMonths} Months
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-6 pt-5">
              {/* Dual Target Inputs */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-slate-50/80 border border-slate-200/80 rounded-2xl p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="font-bold text-slate-800 text-xs uppercase tracking-wider flex items-center gap-1.5">
                      <Shield className="w-3.5 h-3.5 text-blue-600" />
                      Active Safety Floor (Today)
                    </Label>
                    <Badge variant="secondary" className="bg-blue-100 text-blue-800 text-[10px] font-semibold">
                      Active Floor
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    <Input
                      type="number"
                      min="1"
                      max="12"
                      value={emergencyMonths}
                      onChange={e => setEmergencyMonths(e.target.value)}
                      className="w-24 font-bold text-base bg-white"
                    />
                    <span className="text-sm text-slate-600 font-semibold">months ({fmtCurrency(ladderState.currentFloor)})</span>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Actively reserves cash before goal pots receive funds. Keeping this at {emergencyMonths} months prevents holiday pots from going red.
                  </p>
                </div>

                <div className="bg-slate-50/80 border border-slate-200/80 rounded-2xl p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="font-bold text-slate-800 text-xs uppercase tracking-wider flex items-center gap-1.5">
                      <Target className="w-3.5 h-3.5 text-emerald-600" />
                      North Star Target Goal
                    </Label>
                    <Badge variant="secondary" className="bg-emerald-100 text-emerald-800 text-[10px] font-semibold">
                      Ultimate Goal
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    <Input
                      type="number"
                      min={Math.max(1, parseInt(emergencyMonths) || 1)}
                      max="24"
                      value={targetMonths}
                      onChange={e => setTargetMonths(e.target.value)}
                      className="w-24 font-bold text-base bg-white"
                    />
                    <span className="text-sm text-slate-600 font-semibold">months ({fmtCurrency(ladderState.ultimateFloor)})</span>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Your ultimate security cushion. Once short-term pots finish, freed cashflow will step you up to this milestone.
                  </p>
                </div>
              </div>

              {/* Visual Milestone Stepper */}
              <div className="space-y-2.5 bg-slate-50/60 rounded-2xl p-4 border border-slate-200/60">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                    <Milestone className="w-3.5 h-3.5 text-slate-500" />
                    Expansion Milestones
                  </span>
                  <span className="text-xs font-bold text-emerald-700">
                    {ladderState.progressPercent.toFixed(0)}% towards {ladderState.targetMonths}-month goal
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 pt-1">
                  {ladderState.milestones.map((m) => {
                    const isAchieved = m.status === 'achieved';
                    const isActive = m.status === 'active_floor';
                    const isNext = m.status === 'next_milestone';
                    const isTarget = m.status === 'ultimate_target';

                    let borderStyle = 'border-slate-200 bg-white text-slate-400';
                    if (isAchieved) borderStyle = 'border-emerald-200 bg-emerald-50 text-emerald-800';
                    if (isActive) borderStyle = 'border-blue-400 bg-blue-50 text-blue-900 shadow-xs ring-1 ring-blue-300';
                    if (isNext) borderStyle = 'border-amber-300 bg-amber-50 text-amber-900 ring-1 ring-amber-200';
                    if (isTarget && !isNext && !isActive) borderStyle = 'border-purple-200 bg-purple-50/60 text-purple-900';

                    return (
                      <div
                        key={m.month}
                        className={`rounded-xl border p-2 flex flex-col justify-between text-left transition-all ${borderStyle}`}
                      >
                        <div className="flex items-center justify-between text-[10px] font-bold">
                          <span>{m.month} Mo</span>
                          {isAchieved && <Check className="w-3 h-3 text-emerald-600" />}
                          {isActive && <Shield className="w-3 h-3 text-blue-600" />}
                          {isNext && <Sparkles className="w-3 h-3 text-amber-600" />}
                        </div>
                        <div className="mt-1 text-xs font-extrabold font-display">
                          {fmtCurrency(m.amount)}
                        </div>
                        <div className="text-[9px] uppercase font-semibold tracking-tight mt-0.5 opacity-80">
                          {isAchieved && 'Achieved'}
                          {isActive && 'Active Floor'}
                          {isNext && 'Next Step'}
                          {isTarget && !isActive && !isNext && 'Goal'}
                          {!isAchieved && !isActive && !isNext && !isTarget && 'Upcoming'}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Next Milestone Advisor Card */}
              {ladderState.nextMonth && (
                <div className={`rounded-2xl border p-4 transition-all ${
                  ladderState.canAffordNextMonthNow
                    ? 'bg-emerald-50/70 border-emerald-200'
                    : 'bg-amber-50/70 border-amber-200'
                }`}>
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="space-y-1 max-w-xl">
                      <div className="flex items-center gap-2">
                        {ladderState.canAffordNextMonthNow ? (
                          <Sparkles className="w-4 h-4 text-emerald-600" />
                        ) : (
                          <Lock className="w-4 h-4 text-amber-600" />
                        )}
                        <h4 className="text-sm font-bold text-slate-900">
                          Next Step: Month {ladderState.nextMonth} ({fmtCurrency(ladderState.additionalCostForNextMonth)} needed)
                        </h4>
                      </div>
                      {ladderState.isBlockedByActivePots ? (
                        <p className="text-xs text-slate-600 leading-relaxed">
                          You currently have <strong>{ladderState.activeCompetingPots.length} active savings pot{ladderState.activeCompetingPots.length > 1 ? 's' : ''}</strong>
                          {ladderState.activeCompetingPots.length > 0 && ` (${ladderState.activeCompetingPots.map(p => p.name).slice(0, 3).join(', ')})`} requiring ~<strong>{fmtCurrency(ladderState.totalWeeklyCommittedToPots)}/wk</strong>.
                          Stepping to {ladderState.nextMonth} months is safely scheduled for once these pots finish
                          {ladderState.projectedUnlockDate ? ` (projected ~${ladderState.projectedUnlockDate})` : ''} so you don't compromise your holiday budget today.
                        </p>
                      ) : ladderState.canAffordNextMonthNow ? (
                        <p className="text-xs text-emerald-800 leading-relaxed font-medium">
                          You have sufficient unallocated liquid cash ({fmtCurrency(ladderState.unallocatedCash)}) to advance your emergency floor to {ladderState.nextMonth} months right now without putting any of your goals in deficit!
                        </p>
                      ) : (
                        <p className="text-xs text-slate-600 leading-relaxed">
                          Funding Month {ladderState.nextMonth} requires {fmtCurrency(ladderState.shortfallForNextMonth)} more cushion. Once your ongoing pots complete, surplus cash will fund this step.
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        size="sm"
                        variant={ladderState.canAffordNextMonthNow ? "default" : "outline"}
                        onClick={handleLevelUpOneMonth}
                        className={`font-bold text-xs gap-1.5 ${
                          ladderState.canAffordNextMonthNow
                            ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                            : 'border-amber-300 bg-white hover:bg-amber-50 text-amber-900'
                        }`}
                      >
                        <ArrowUpRight className="w-3.5 h-3.5" />
                        Level Up to {ladderState.nextMonth} Mo
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between pt-1">
                <p className="text-[11px] text-muted-foreground">
                  Survival cost basis: {fmtCurrency(monthlySurvivalCost)}/mo × 1.2 safety multiplier
                </p>
                <Button onClick={handleSaveEmergencyMonths} size="sm" className="font-bold">
                  Save Targets & Ladder
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Core Policy Assumptions Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Baseline savings tile */}
            <div className="bg-white rounded-[2rem] p-6 border-2 border-[#FF7AD1]/30 shadow-sm">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-2xl bg-[#FFF5FA] flex items-center justify-center text-[#FF2EB8]">
                  <TrendingUp className="w-5 h-5" />
                </div>
                <h3 className="text-base font-display font-bold text-slate-900">Baseline Savings</h3>
              </div>
              <div className="flex items-center justify-between mb-2">
                <Label className="text-xs text-slate-500 uppercase tracking-wider font-semibold">% of Income</Label>
                <span className="text-2xl font-display font-black text-[#FF2EB8] tabular-nums">{savingsPercent}%</span>
              </div>
              <Slider
                value={[savingsPercent]}
                min={0}
                max={50}
                step={1}
                onValueChange={([v]) => setSavingsPercent(v)}
                className="[&_[role=slider]]:bg-[#FF2EB8] [&_[role=slider]]:border-[#FF2EB8]"
              />
              {expectedIncome && (
                <p className="text-xs text-slate-500 mt-3 tabular-nums">
                  ≈ {((savingsPercent / 100) * parseFloat(expectedIncome || '0')).toFixed(0)} {baseCurrency}/mo
                </p>
              )}
            </div>

            {/* Job start date tile */}
            <div className="bg-[#86EFAC] rounded-[2rem] p-6 border-2 border-[#22C55E] shadow-sm">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-2xl bg-white/60 flex items-center justify-center text-[#166534]">
                  <ArrowUpRight className="w-5 h-5" />
                </div>
                <h3 className="text-base font-display font-bold text-[#166534]">Job Start Date</h3>
              </div>
              <Label className="text-xs text-[#166534]/80 font-medium block mb-2">
                When does regular salary begin? Runway assumes no income until this date.
              </Label>
              <Input
                type="date"
                value={jobStartDate}
                onChange={(e) => setJobStartDate(e.target.value)}
                className="max-w-xs bg-white/70 border-white/60 text-[#166534] font-semibold h-9 text-xs"
              />
              {jobStartDate && (
                <p className="text-xs text-[#166534]/90 font-medium mt-2">
                  Income starts {new Date(jobStartDate).toLocaleDateString()}
                </p>
              )}
            </div>

            {/* Expected Monthly Income tile */}
            <div className="bg-white rounded-[2rem] p-6 border-2 border-[#FF7AD1]/30 shadow-sm md:col-span-2">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-2xl bg-[#FFF5FA] flex items-center justify-center text-[#FF2EB8]">
                  <Coins className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-display font-bold text-slate-900">Expected Monthly Income</h3>
                  <p className="text-xs text-slate-500">Your monthly take-home after tax. Leave blank to automatically use your true 3-month transaction average.</p>
                </div>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center gap-3 max-w-md pt-1">
                <div className="relative flex-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-sm">
                    {baseCurrency === 'GBP' ? '£' : '$'}
                  </span>
                  <Input
                    type="number"
                    step="50"
                    value={expectedIncome}
                    onChange={(e) => setExpectedIncome(e.target.value)}
                    placeholder="Auto (3-month avg)"
                    className="pl-8 font-display font-bold text-base rounded-xl border-slate-200 h-10"
                  />
                </div>
                <Button
                  onClick={handleSavePolicySettings}
                  disabled={savingPolicyLoading}
                  className="bg-[#FF2EB8] hover:bg-[#e5299f] text-white font-display font-bold rounded-xl h-10 px-5 shrink-0"
                >
                  {savingPolicyLoading ? 'Saving...' : 'Save Policy Settings'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SECTION 3: CURRENCY & TIMEZONE */}
      {activeSection === 'currency' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between pb-2 border-b border-slate-200/80">
            <div>
              <h2 className="text-xl font-display font-bold text-slate-900 flex items-center gap-2">
                <Globe className="w-5 h-5 text-indigo-600" />
                <span>Currency, Rates & Timezone</span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Configure your primary display currency, manual conversion rates, and living location timezone.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Primary Display Currency */}
            <Card className="border-2 border-slate-200/80 shadow-xs">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-display font-bold text-slate-900">Primary Display Currency</CardTitle>
                <CardDescription className="text-xs">Select your default currency for app balances and charts.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-3">
                  <Button
                    variant={baseCurrency === 'GBP' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => {
                      setBaseCurrency('GBP');
                      updateSettings({ base_currency: 'GBP' });
                      toast.success('Display currency set to GBP (£)');
                    }}
                    className="gap-2 font-bold h-10 px-4"
                  >
                    🇬🇧 British Pound (£ GBP)
                  </Button>
                  <Button
                    variant={baseCurrency === 'AUD' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => {
                      setBaseCurrency('AUD');
                      updateSettings({ base_currency: 'AUD' });
                      toast.success('Display currency set to AUD ($)');
                    }}
                    className="gap-2 font-bold h-10 px-4"
                  >
                    🇦🇺 Australian Dollar ($ AUD)
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Exchange Rates */}
            <Card className="border-2 border-slate-200/80 shadow-xs">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-display font-bold text-slate-900">Exchange Rates</CardTitle>
                <CardDescription className="text-xs">Manual FX rates for currency conversions between AUD and GBP.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-slate-700">1 AUD = ? GBP</Label>
                    <Input type="number" step="0.001" value={audGbp} onChange={e => setAudGbp(e.target.value)} className="h-9 text-xs" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-slate-700">1 GBP = ? AUD</Label>
                    <Input type="number" step="0.001" value={gbpAud} onChange={e => setGbpAud(e.target.value)} className="h-9 text-xs" />
                  </div>
                </div>
                <Button onClick={handleSaveFX} size="sm" className="font-bold h-9">
                  Save Exchange Rates
                </Button>
              </CardContent>
            </Card>

            {/* Living Location & Timezone Recalibration */}
            <Card className="md:col-span-2 border-2 border-indigo-200 bg-gradient-to-r from-indigo-50/50 via-white to-sky-50/50 shadow-xs">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <CardTitle className="text-base flex items-center gap-2 font-display text-slate-900">
                    <Globe className="w-4 h-4 text-indigo-600" />
                    Living Location & Timezone Recalibration
                  </CardTitle>
                  <Badge variant="outline" className="bg-indigo-100 text-indigo-800 border-indigo-300 font-bold text-xs">
                    Active: {livingTimezone}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-xs text-slate-600 leading-relaxed">
                  Specify where you physically live (e.g. Manchester, UK). Transactions from overseas banks (like <strong>Up Bank Australia</strong>) will automatically recalibrate timestamps to your local living time, so purchases stay on the actual calendar day you made them.
                </p>

                <div className="space-y-2 max-w-md">
                  <Label className="text-xs font-semibold text-slate-700">Your Living Timezone</Label>
                  <Select
                    value={livingTimezone}
                    onValueChange={(val) => {
                      setLivingTimezone(val);
                      updateSettings({ user_timezone: val } as any);
                      toast.success(`Living timezone set to ${val}`);
                    }}
                  >
                    <SelectTrigger className="w-full font-medium text-xs bg-white h-9">
                      <SelectValue placeholder="Select timezone" />
                    </SelectTrigger>
                    <SelectContent>
                      {TIMEZONE_PRESETS.map((tz) => (
                        <SelectItem key={tz.value} value={tz.value} className="text-xs">
                          {tz.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={rescanRunning}
                    onClick={async () => {
                      setRescanRunning(true);
                      try {
                        await (finance as any).rescanAndFixTimezones();
                        toast.success('All past transactions recalibrated to your living timezone!');
                      } catch (err) {
                        toast.error('Failed to recalibrate transactions');
                      } finally {
                        setRescanRunning(false);
                      }
                    }}
                    className="text-xs font-bold text-indigo-700 bg-indigo-50/80 border-indigo-300 hover:bg-indigo-100 flex items-center justify-center gap-1.5 cursor-pointer py-2 h-9"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${rescanRunning ? 'animate-spin' : ''}`} />
                    {rescanRunning ? 'Recalibrating timestamps...' : 'Rescan & Fix All Past Month Transaction Dates'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* SECTION 4: CATEGORIES & SOURCES */}
      {activeSection === 'categories' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between pb-2 border-b border-slate-200/80">
            <div>
              <h2 className="text-xl font-display font-bold text-slate-900 flex items-center gap-2">
                <Tag className="w-5 h-5 text-[#FF2EB8]" />
                <span>Categories & Income Sources</span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Organize incoming money streams and customize spending classification rules.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Income Sources Management */}
            <div className="bg-white rounded-[2rem] p-6 border-2 border-[#FF7AD1]/30 shadow-sm space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-[#FFF5FA] flex items-center justify-center text-[#FF2EB8]">
                  <Briefcase className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-display font-bold text-slate-900">Income Sources</h3>
                  <p className="text-xs text-slate-500">Add or manage where your money comes from.</p>
                </div>
              </div>

              <div className="flex gap-2">
                <Input
                  value={newIncomeName}
                  onChange={(e) => setNewIncomeName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAddIncomeSource(); }}
                  placeholder="e.g. New Job, Consulting, Side Income"
                  className="rounded-xl border-slate-200 h-9 text-xs"
                />
                <Button
                  onClick={handleAddIncomeSource}
                  disabled={!newIncomeName.trim()}
                  className="bg-[#FF2EB8] hover:bg-[#e5299f] text-white font-display font-bold rounded-xl px-4 h-9 text-xs"
                >
                  <Plus className="w-3.5 h-3.5 mr-1" /> Add
                </Button>
              </div>

              {activeIncomeCats.length === 0 ? (
                <p className="text-xs text-slate-400 italic py-2">No active income sources configured.</p>
              ) : (
                <ul className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
                  {activeIncomeCats.map((c) => (
                    <li
                      key={c.id}
                      className="flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-100 hover:bg-[#FFF5FA]/50 transition-colors"
                    >
                      <Popover>
                        <PopoverTrigger asChild>
                          <button
                            className="w-3.5 h-3.5 rounded-full shrink-0 border border-slate-200 cursor-pointer hover:ring-2 hover:ring-pink-400 hover:ring-offset-1 transition-all"
                            style={{ backgroundColor: c.color || '#94a3b8' }}
                            title="Change color"
                          />
                        </PopoverTrigger>
                        <PopoverContent className="w-52 p-3 rounded-2xl border-2 border-[#FF7AD1]/30" align="start">
                          <p className="text-[10px] font-display font-bold uppercase tracking-widest text-slate-400 mb-2">Change Source Color</p>
                          <div className="grid grid-cols-5 gap-1.5">
                            {PRESET_COLORS.map(color => (
                              <button
                                key={color}
                                onClick={() => finance.updateCategory(c.id, { color })}
                                className={`w-7 h-7 rounded-full border-2 transition-all ${c.color === color ? 'border-slate-800 scale-110' : 'border-transparent hover:scale-105'}`}
                                style={{ backgroundColor: color }}
                              />
                            ))}
                          </div>
                        </PopoverContent>
                      </Popover>

                      {editingSourceId === c.id ? (
                        <div className="flex-1 flex items-center gap-2">
                          <Input
                            value={editingSourceName}
                            onChange={(e) => setEditingSourceName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveRenameSource(c.id);
                              if (e.key === 'Escape') setEditingSourceId(null);
                            }}
                            className="h-7 text-xs rounded-lg border-[#FF2EB8]"
                            autoFocus
                          />
                          <Button
                            size="sm"
                            onClick={() => handleSaveRenameSource(c.id)}
                            className="h-7 px-2 bg-[#FF2EB8] text-white hover:bg-[#e5299f] rounded-lg text-xs"
                          >
                            <Check className="w-3 h-3" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditingSourceId(null)}
                            className="h-7 px-1.5 text-slate-400 hover:text-slate-600 rounded-lg"
                          >
                            <X className="w-3 h-3" />
                          </Button>
                        </div>
                      ) : (
                        <>
                          <span className="flex-1 font-display font-semibold text-slate-800 text-xs truncate">{c.name}</span>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleStartRenameSource(c)}
                            className="h-7 w-7 p-0 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg"
                            title="Rename source"
                          >
                            <Pencil className="w-3 h-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleToggleArchiveSource(c)}
                            className="h-7 w-7 p-0 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg"
                            title="Archive source"
                          >
                            <Archive className="w-3 h-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteIncomeSource(c.id, c.name)}
                            className="h-7 w-7 p-0 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {/* Archived Income Sources */}
              {archivedIncomeCats.length > 0 && (
                <div className="border-t border-slate-100 pt-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Archived Sources ({archivedIncomeCats.length})</span>
                    <button
                      onClick={() => setShowArchivedSources(prev => !prev)}
                      className="text-xs font-semibold text-slate-500 hover:text-slate-800"
                    >
                      {showArchivedSources ? 'Hide' : 'Show'}
                    </button>
                  </div>
                  {showArchivedSources && (
                    <ul className="space-y-1.5 pt-1">
                      {archivedIncomeCats.map((c) => (
                        <li key={c.id} className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-slate-50 text-xs text-slate-500">
                          <span className="truncate">{c.name}</span>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleToggleArchiveSource(c)}
                              className="h-6 px-1.5 text-xs text-emerald-600 hover:bg-emerald-50 rounded"
                            >
                              <ArchiveRestore className="w-3 h-3 mr-1" /> Restore
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDeleteIncomeSource(c.id, c.name)}
                              className="h-6 w-6 p-0 text-red-500 hover:bg-red-50 rounded"
                            >
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>

            {/* Spending Categories Management */}
            <Card className="border-2 border-slate-200/80 shadow-xs">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-display font-bold text-slate-900">Spending Categories</CardTitle>
                <CardDescription className="text-xs">
                  Customize spending tags, toggle essential living costs, or exclude categories from budget tracking.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="divide-y divide-border max-h-[380px] overflow-y-auto pr-1">
                  {categories.filter(c => c.type !== 'income' && c.type !== 'transfer').map(c => (
                    <div key={c.id}>
                      {editingCat === c.id ? (
                        <div className="flex items-center gap-2 py-2">
                          <Input
                            value={editName}
                            onChange={e => setEditName(e.target.value)}
                            className="h-8 flex-1 text-xs"
                            onKeyDown={e => e.key === 'Enter' && handleSaveEdit(c.id)}
                          />
                          <Select value={editType} onValueChange={setEditType}>
                            <SelectTrigger className="w-24 h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="fixed">Fixed</SelectItem>
                              <SelectItem value="variable">Variable</SelectItem>
                              <SelectItem value="savings">Savings</SelectItem>
                            </SelectContent>
                          </Select>
                          <Button size="sm" className="h-8 text-xs px-2.5" onClick={() => handleSaveEdit(c.id)}>Save</Button>
                          <Button size="sm" variant="ghost" className="h-8 text-xs px-2" onClick={() => setEditingCat(null)}>✕</Button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between py-2 group">
                          <div className="flex items-center gap-2 min-w-0">
                            <CategoryColorPicker
                              color={c.color}
                              onChange={(color) => updateCategory(c.id, { color } as any)}
                            />
                            <span className="text-xs font-semibold text-slate-900 truncate">{c.name}</span>
                            <span className="text-[10px] text-muted-foreground capitalize font-medium">{c.type}</span>
                            {c.is_essential && <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 font-bold leading-none">essential</span>}
                            {c.is_cuttable && <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-bold leading-none">cuttable</span>}
                            {c.exclude_from_reports && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground flex items-center gap-0.5 leading-none font-bold">
                                <EyeOff className="w-2.5 h-2.5" /> Excluded
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => updateCategory(c.id, { is_essential: !c.is_essential } as any)}
                              className={`text-[9px] px-2 py-0.5 rounded font-bold transition-colors ${c.is_essential ? 'bg-purple-100 text-purple-700 hover:bg-purple-200' : 'bg-slate-100 text-slate-500 hover:text-slate-800'}`}
                              title={c.is_essential ? 'Remove from essentials budget' : 'Include in essentials budget'}
                            >
                              {c.is_essential ? '✓ Essential' : 'Essential'}
                            </button>
                            <Switch
                              checked={c.exclude_from_reports}
                              onCheckedChange={(checked) => updateCategory(c.id, { exclude_from_reports: checked })}
                            />
                            <button
                              onClick={() => handleStartEdit(c)}
                              className="p-1.5 rounded-lg hover:bg-muted text-slate-400 hover:text-slate-700 transition-colors"
                              title="Edit category"
                            >
                              <Pencil className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => setDeleteCatId(c.id)}
                              className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors"
                              title="Delete category"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Add Category Form */}
                <div className="flex gap-2 pt-3 border-t">
                  <CategoryColorPicker color={newCatColor} onChange={setNewCatColor} />
                  <Input
                    value={newCatName}
                    onChange={e => setNewCatName(e.target.value)}
                    placeholder="New category name"
                    className="flex-1 h-8 text-xs"
                    onKeyDown={e => e.key === 'Enter' && handleAddCategory()}
                  />
                  <Select value={newCatType} onValueChange={setNewCatType}>
                    <SelectTrigger className="w-24 h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="fixed">Fixed</SelectItem>
                      <SelectItem value="variable">Variable</SelectItem>
                      <SelectItem value="savings">Savings</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button onClick={handleAddCategory} size="sm" className="h-8 text-xs font-semibold px-3">
                    Add
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* SECTION 5: SECURITY & ACCOUNT */}
      {activeSection === 'security' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between pb-2 border-b border-slate-200/80">
            <div>
              <h2 className="text-xl font-display font-bold text-slate-900 flex items-center gap-2">
                <Lock className="w-5 h-5 text-[#FF2EB8]" />
                <span>Account & Security</span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Update your account password and review authentication credentials.
              </p>
            </div>
            {user?.email && (
              <Badge variant="outline" className="bg-[#FFF5FA] text-[#FF2EB8] border-[#FF7AD1]/40 font-bold text-xs py-1 px-3">
                <UserCheck className="w-3.5 h-3.5 mr-1.5" />
                {user.email}
              </Badge>
            )}
          </div>

          <Card className="border-2 border-[#FF7AD1]/30 bg-gradient-to-r from-white to-[#FFF5FA] max-w-xl">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2 text-slate-900 font-display font-bold">
                <KeyRound className="w-4 h-4 text-[#FF2EB8]" />
                <span>Change Password</span>
              </CardTitle>
              <CardDescription className="text-xs text-slate-500">
                Set or update your account password so you can sign in directly with your email & password.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <form onSubmit={handlePasswordChange} className="space-y-3 max-w-md">
                <div className="space-y-1">
                  <Label className="text-xs text-slate-600 font-medium">New Password</Label>
                  <div className="relative">
                    <Input
                      type={showNewPassword ? 'text' : 'password'}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Enter new password (min 6 characters)"
                      className="pr-10 h-9 text-xs rounded-xl border-slate-200 bg-white"
                      required
                    />
                    <button
                      type="button"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                      onClick={() => setShowNewPassword(!showNewPassword)}
                    >
                      {showNewPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs text-slate-600 font-medium">Confirm Password</Label>
                  <div className="relative">
                    <Input
                      type={showConfirmPassword ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Confirm new password"
                      className="pr-10 h-9 text-xs rounded-xl border-slate-200 bg-white"
                      required
                    />
                    <button
                      type="button"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    >
                      {showConfirmPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                <Button
                  type="submit"
                  size="sm"
                  disabled={updatingPassword}
                  className="bg-[#FF2EB8] hover:bg-[#e5299f] text-white font-display font-bold rounded-xl h-9 text-xs px-5 shadow-xs"
                >
                  {updatingPassword ? 'Updating...' : 'Update Password'}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Delete category confirmation dialog */}
      <DeleteConfirmDialog
        open={!!deleteCatId}
        onOpenChange={(open) => !open && setDeleteCatId(null)}
        onConfirm={() => {
          if (deleteCatId) {
            deleteCategory(deleteCatId);
            setDeleteCatId(null);
          }
        }}
        title="Delete Category"
        description="This will remove the category and unassign all transactions currently using it. This cannot be undone."
      />
    </div>
  );
}
