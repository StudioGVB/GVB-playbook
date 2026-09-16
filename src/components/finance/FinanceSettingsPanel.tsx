import { useState, useEffect, useRef, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CheckCircle2, XCircle, Loader2, Shield, Pencil, Trash2, EyeOff, Palette, Plus, Receipt } from 'lucide-react';
import DeleteConfirmDialog from '@/components/DeleteConfirmDialog';
import type { useFinanceData } from '@/hooks/useFinanceData';
import { useFixedExpenses } from '@/hooks/useFixedExpenses';
import { formatCurrency } from '@/lib/financeUtils';
import { useFinanceAssumptions } from '@/hooks/useFinanceAssumptions';

type Props = { finance: ReturnType<typeof useFinanceData> };

const FREQUENCY_OPTIONS = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'fortnightly', label: 'Fortnightly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'yearly', label: 'Yearly' },
];

const PRESET_COLORS = [
  '#EF4444', '#F97316', '#F59E0B', '#EAB308',
  '#84CC16', '#22C55E', '#10B981', '#14B8A6',
  '#06B6D4', '#0EA5E9', '#3B82F6', '#6366F1',
  '#8B5CF6', '#A855F7', '#D946EF', '#EC4899',
  '#F43F5E', '#78716C', '#64748B', '#6B7280',
  // Pastels & baby colours
  '#FBB5C5', '#FDBA9E', '#FDE68A', '#BBF7D0',
  '#A5F3FC', '#BAE6FD', '#C4B5FD', '#F0ABFC',
];

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
  const {
    settings, categories, accounts, updateSettings, addCategory, updateCategory,
    deleteCategory, checkUpStatus, syncUpTransactions, checkWiseStatus, connectWise, syncWiseTransactions,
    checkMonzoStatus, connectMonzo, syncMonzoTransactions
  } = finance;
  const { assumptions, update: updateAssumptions } = useFinanceAssumptions();
  const [audGbp, setAudGbp] = useState('');
  const [gbpAud, setGbpAud] = useState('');
  const [baseCurrency, setBaseCurrency] = useState('AUD');
  const [emergencyMonths, setEmergencyMonths] = useState('3');
  const [newCatName, setNewCatName] = useState('');
  const [newCatType, setNewCatType] = useState('variable');
  const [newCatColor, setNewCatColor] = useState('#3B82F6');
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
  const [editingCat, setEditingCat] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editType, setEditType] = useState('');
  const [deleteCatId, setDeleteCatId] = useState<string | null>(null);
  const { expenses: fixedExpenses, add: addFixedExpense, remove: removeFixedExpense, update: updateFixedExpense, monthlyTotal: fixedMonthlyTotal } = useFixedExpenses();
  const [newExpName, setNewExpName] = useState('');
  const [newExpAmount, setNewExpAmount] = useState('');
  const [newExpFreq, setNewExpFreq] = useState('monthly');
  const [newExpDueDay, setNewExpDueDay] = useState('');
  const [newExpCurrency, setNewExpCurrency] = useState('AUD');
  const [newExpFrom, setNewExpFrom] = useState('');
  const [newExpTo, setNewExpTo] = useState('');
  const [editingExp, setEditingExp] = useState<string | null>(null);
  const [editExpName, setEditExpName] = useState('');
  const [editExpAmount, setEditExpAmount] = useState('');
  const [editExpFreq, setEditExpFreq] = useState('monthly');
  const [editExpDueDay, setEditExpDueDay] = useState('');
  const [editExpCurrency, setEditExpCurrency] = useState('AUD');
  const [editExpFrom, setEditExpFrom] = useState('');
  const [editExpTo, setEditExpTo] = useState('');
  const [deleteExpId, setDeleteExpId] = useState<string | null>(null);

  const fmtCurrency = (n: number) => formatCurrency(n, settings?.base_currency || 'AUD');

  const upAccount = accounts.find(a => a.provider === 'up');
  const isUpConnected = !!upAccount || upStatus?.connected === true;

  const wiseAccount = accounts.find(a => a.provider === 'wise');
  const isWiseConnected = !!wiseAccount || wiseStatus?.connected === true;

  const monzoAccount = accounts.find(a => a.provider === 'monzo');
  const isMonzoConnected = !!monzoAccount || monzoStatus?.connected === true;

  useEffect(() => {
    if (settings) {
      const rates = (settings.fx_rates || {}) as Record<string, number>;
      setAudGbp(String(rates.AUD_GBP ?? 0.52));
      setGbpAud(String(rates.GBP_AUD ?? 1.92));
      setBaseCurrency(settings.base_currency || 'GBP');
    }
  }, [settings]);

  useEffect(() => {
    if (assumptions) {
      setEmergencyMonths(String(assumptions.buffer_months || 3));
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
  };

  const handleSaveEmergencyMonths = async () => {
    if (!updateAssumptions) return;
    await updateAssumptions({
      buffer_months: parseInt(emergencyMonths) || 3,
    });
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

  const handleAddFixedExpense = () => {
    if (!newExpName.trim() || !newExpAmount) return;
    addFixedExpense({
      name: newExpName.trim(),
      amount: parseFloat(newExpAmount),
      frequency: newExpFreq,
      due_day: newExpDueDay ? parseInt(newExpDueDay) : null,
      currency: newExpCurrency,
      effective_from: newExpFrom || null,
      effective_to: newExpTo || null,
    });
    setNewExpName('');
    setNewExpAmount('');
    setNewExpDueDay('');
    setNewExpFrom('');
    setNewExpTo('');
  };

  const handleVerify = async () => {
    setUpChecking(true);
    const result = await checkUpStatus();
    setUpStatus(result);
    setUpChecking(false);
  };

  const handleSync = async () => {
    setUpSyncing(true);
    await syncUpTransactions();
    setUpSyncing(false);
  };

  const handleWiseVerify = async () => {
    setWiseChecking(true);
    const result = await checkWiseStatus();
    setWiseStatus(result);
    setWiseChecking(false);
  };

  const handleWiseSync = async () => {
    setWiseSyncing(true);
    await syncWiseTransactions();
    setWiseSyncing(false);
  };

  const handleWiseConnect = async () => {
    if (!wiseToken.trim()) {
      toast.error('Please enter a Wise API key');
      return;
    }
    setWiseChecking(true);
    const success = await connectWise(wiseToken.trim());
    if (success) {
      setWiseStatus({ connected: true });
      setWiseToken('');
    }
    setWiseChecking(false);
  };

  const handleMonzoVerify = async () => {
    setMonzoChecking(true);
    const result = await checkMonzoStatus();
    setMonzoStatus(result);
    setMonzoChecking(false);
  };

  const handleMonzoSync = async () => {
    setMonzoSyncing(true);
    await syncMonzoTransactions();
    setMonzoSyncing(false);
  };

  const handleMonzoConnect = async () => {
    if (!monzoToken.trim()) {
      toast.error('Please enter a Monzo Access Token');
      return;
    }
    setMonzoChecking(true);
    const success = await connectMonzo(monzoToken.trim());
    if (success) {
      setMonzoStatus({ connected: true });
      setMonzoToken('');
    }
    setMonzoChecking(false);
  };

  return (
    <div className="space-y-6">
      {/* Up Bank */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Bank Integrations</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Up Bank */}
          <div className="border rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="font-medium text-sm">Up Bank</div>
                <div className="text-xs text-muted-foreground">
                  {isUpConnected ? (
                    <span className="flex items-center gap-1 text-green-600">
                      <CheckCircle2 className="h-3 w-3" /> Connected
                    </span>
                  ) : upStatus?.error === 'invalid_token' ? (
                    <span className="flex items-center gap-1 text-destructive">
                      <XCircle className="h-3 w-3" /> Token invalid or expired
                    </span>
                  ) : upStatus?.error === 'missing_secret' ? (
                    <span className="flex items-center gap-1 text-warning">
                      <XCircle className="h-3 w-3" /> Secret not configured
                    </span>
                  ) : (
                    <span>Not verified</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={handleVerify} disabled={upChecking}>
                  {upChecking ? <><Loader2 className="h-3 w-3 animate-spin mr-1" /> Checking...</> : 'Verify Connection'}
                </Button>
                {isUpConnected && (
                  <Button size="sm" onClick={handleSync} disabled={upSyncing}>
                    {upSyncing ? <><Loader2 className="h-3 w-3 animate-spin mr-1" /> Syncing...</> : 'Sync Now'}
                  </Button>
                )}
              </div>
            </div>

            {isUpConnected && upAccount?.last_synced_at && (
              <div className="text-xs text-muted-foreground mb-3">
                Last synced: {new Date(upAccount.last_synced_at).toLocaleString()}
              </div>
            )}

            {!isUpConnected && (
              <div className="rounded-lg bg-muted/50 p-3 space-y-2">
                <div className="flex items-start gap-2">
                  <Shield className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                  <div className="text-xs text-muted-foreground space-y-2">
                    <p><strong>Setup:</strong> Your Up token is stored as a server secret and never sent to your browser.</p>
                    <ol className="list-decimal list-inside space-y-1">
                      <li>Generate a Personal Access Token in the Up app (Settings → Developer)</li>
                      <li>Add it as a Cloud Secret named <code className="bg-muted px-1 py-0.5 rounded text-[11px]">UP_ACCESS_TOKEN</code></li>
                      <li>Click "Verify Connection" above</li>
                    </ol>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Wise */}
          <div className="border rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="font-medium text-sm">Wise Account</div>
                <div className="text-xs text-muted-foreground">
                  {isWiseConnected ? (
                    <span className="flex items-center gap-1 text-green-600">
                      <CheckCircle2 className="h-3 w-3" /> Connected
                    </span>
                  ) : wiseStatus?.error === 'invalid_token' ? (
                    <span className="flex items-center gap-1 text-destructive">
                      <XCircle className="h-3 w-3" /> Token invalid or expired
                    </span>
                  ) : wiseStatus?.error === 'missing_secret' ? (
                    <span className="flex items-center gap-1 text-warning">
                      <XCircle className="h-3 w-3" /> Secret not configured
                    </span>
                  ) : (
                    <span>Not verified</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={handleWiseVerify} disabled={wiseChecking}>
                  {wiseChecking ? <><Loader2 className="h-3 w-3 animate-spin mr-1" /> Checking...</> : 'Verify Connection'}
                </Button>
                {isWiseConnected && (
                  <Button size="sm" onClick={handleWiseSync} disabled={wiseSyncing}>
                    {wiseSyncing ? <><Loader2 className="h-3 w-3 animate-spin mr-1" /> Syncing...</> : 'Sync Now'}
                  </Button>
                )}
              </div>
            </div>

            {isWiseConnected && wiseAccount?.last_synced_at && (
              <div className="text-xs text-muted-foreground mb-3">
                Last synced: {new Date(wiseAccount.last_synced_at).toLocaleString()}
              </div>
            )}

            <div className="rounded-lg bg-muted/50 p-3 space-y-2 mt-3">
              <div className="flex items-start gap-2">
                <Shield className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                <div className="text-xs text-muted-foreground space-y-3 w-full">
                  <p><strong>Setup Option A (Recommended):</strong> Add your Wise API token as a Cloud Secret named <code className="bg-muted px-1 py-0.5 rounded text-[11px]">WISE_API_KEY</code>, then click "Verify Connection".</p>
                  
                  <div className="space-y-2 border-t pt-2 mt-2">
                    <p><strong>Setup Option B:</strong> Connect directly by pasting your API Token below:</p>
                    <div className="flex gap-2">
                      <Input
                        type="password"
                        placeholder="Paste Wise API Token here"
                        value={wiseToken}
                        onChange={e => setWiseToken(e.target.value)}
                        className="h-8 text-xs max-w-xs"
                      />
                      <Button size="sm" className="h-8 text-xs" onClick={handleWiseConnect} disabled={wiseChecking}>
                        {wiseChecking ? 'Connecting...' : 'Connect'}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Monzo */}
          <div className="border rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="font-medium text-sm">Monzo Account</div>
                <div className="text-xs text-muted-foreground">
                  {isMonzoConnected ? (
                    <span className="flex items-center gap-1 text-green-600">
                      <CheckCircle2 className="h-3 w-3" /> Connected
                    </span>
                  ) : monzoStatus?.error === 'invalid_token' ? (
                    <span className="flex items-center gap-1 text-destructive">
                      <XCircle className="h-3 w-3" /> Token invalid or expired
                    </span>
                  ) : monzoStatus?.error === 'missing_secret' ? (
                    <span className="flex items-center gap-1 text-warning">
                      <XCircle className="h-3 w-3" /> Secret not configured
                    </span>
                  ) : (
                    <span>Not verified</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={handleMonzoVerify} disabled={monzoChecking}>
                  {monzoChecking ? <><Loader2 className="h-3 w-3 animate-spin mr-1" /> Checking...</> : 'Verify Connection'}
                </Button>
                {isMonzoConnected && (
                  <Button size="sm" onClick={handleMonzoSync} disabled={monzoSyncing}>
                    {monzoSyncing ? <><Loader2 className="h-3 w-3 animate-spin mr-1" /> Syncing...</> : 'Sync Now'}
                  </Button>
                )}
              </div>
            </div>

            {isMonzoConnected && monzoAccount?.last_synced_at && (
              <div className="text-xs text-muted-foreground mb-3">
                Last synced: {new Date(monzoAccount.last_synced_at).toLocaleString()}
              </div>
            )}

            <div className="rounded-lg bg-muted/50 p-3 space-y-2 mt-3">
              <div className="flex items-start gap-2">
                <Shield className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                <div className="text-xs text-muted-foreground space-y-3 w-full">
                  <p><strong>Setup Option A (Recommended):</strong> Add your Monzo developer access token as a Cloud Secret named <code className="bg-muted px-1 py-0.5 rounded text-[11px]">MONZO_ACCESS_TOKEN</code>, then click "Verify Connection".</p>
                  
                  <div className="space-y-2 border-t pt-2 mt-2">
                    <p><strong>Setup Option B:</strong> Connect directly by pasting your API Access Token below:</p>
                    <div className="flex gap-2">
                      <Input
                        type="password"
                        placeholder="Paste Monzo Access Token here"
                        value={monzoToken}
                        onChange={e => setMonzoToken(e.target.value)}
                        className="h-8 text-xs max-w-xs"
                      />
                      <Button size="sm" className="h-8 text-xs" onClick={handleMonzoConnect} disabled={monzoChecking}>
                        {monzoChecking ? 'Connecting...' : 'Connect'}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Primary Display Currency */}
      <Card className="border-2 border-primary/20 bg-gradient-to-r from-white to-primary/5">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center justify-between">
            <span>Primary Display Currency</span>
            <Badge variant="outline" className="font-bold text-xs">Active: {baseCurrency || 'GBP'}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">Select your primary display currency. All amounts across your dashboards, balance sheet, and runways will convert into this currency.</p>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant={baseCurrency === 'GBP' ? 'default' : 'outline'}
              size="sm"
              onClick={() => {
                setBaseCurrency('GBP');
                updateSettings({ base_currency: 'GBP' });
                toast.success('Display currency set to GBP (£)');
              }}
              className="gap-1.5 font-bold"
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
              className="gap-1.5 font-bold"
            >
              🇦🇺 Australian Dollar ($ AUD)
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* FX Rates */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Exchange Rates</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">Set manual FX rates for currency conversion. Phase 2 will add live rates.</p>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>1 AUD = ? GBP</Label>
              <Input type="number" step="0.001" value={audGbp} onChange={e => setAudGbp(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>1 GBP = ? AUD</Label>
              <Input type="number" step="0.001" value={gbpAud} onChange={e => setGbpAud(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Base Currency</Label>
            <Select value={baseCurrency} onValueChange={(val) => {
              setBaseCurrency(val);
              updateSettings({ base_currency: val });
            }}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="GBP">GBP (£)</SelectItem>
                <SelectItem value="AUD">AUD ($)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={handleSaveFX} size="sm">Save Rates</Button>
        </CardContent>
      </Card>

      {/* Emergency Fund Target */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Emergency Fund Target</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Emergency Target (Months of Survival Cost)</Label>
            <div className="flex items-center gap-4">
              <Input
                type="number"
                min="1"
                max="36"
                value={emergencyMonths}
                onChange={e => setEmergencyMonths(e.target.value)}
                className="w-32"
              />
              <span className="text-sm text-muted-foreground font-semibold">months</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Determines how many months of fixed survival costs are reserved for your emergency fund before other liquid cash is allocated to goal pools.
            </p>
          </div>
          <Button onClick={handleSaveEmergencyMonths} size="sm">Save Target Months</Button>
        </CardContent>
      </Card>

      {/* Categories - Condensed list */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Spending Categories</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Toggle <EyeOff className="w-3 h-3 inline" /> to exclude from reports. Click the color dot to change.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="divide-y divide-border">
            {categories.filter(c => c.type !== 'income' && c.type !== 'transfer').map(c => (
              <div key={c.id}>
                {editingCat === c.id ? (
                  <div className="flex items-center gap-2 py-1.5">
                    <Input
                      value={editName}
                      onChange={e => setEditName(e.target.value)}
                      className="h-7 flex-1 text-sm"
                      onKeyDown={e => e.key === 'Enter' && handleSaveEdit(c.id)}
                    />
                    <Select value={editType} onValueChange={setEditType}>
                      <SelectTrigger className="w-24 h-7 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="fixed">Fixed</SelectItem>
                        <SelectItem value="variable">Variable</SelectItem>
                        <SelectItem value="savings">Savings</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button size="sm" variant="default" className="h-7 text-xs px-2" onClick={() => handleSaveEdit(c.id)}>Save</Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={() => setEditingCat(null)}>✕</Button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between py-1.5 group">
                    <div className="flex items-center gap-2 min-w-0">
                      <CategoryColorPicker
                        color={c.color}
                        onChange={(color) => updateCategory(c.id, { color } as any)}
                      />
                      <span className="text-sm font-medium truncate">{c.name}</span>
                      <span className="text-[11px] text-muted-foreground capitalize">{c.type}</span>
                      {c.is_essential && <span className="text-[10px] px-1 py-0.5 rounded bg-primary/15 text-primary leading-none">essential</span>}
                      {c.is_cuttable && <span className="text-[10px] px-1 py-0.5 rounded bg-warning/15 text-warning leading-none">cuttable</span>}
                      {c.exclude_from_reports && (
                        <span className="text-[10px] px-1 py-0.5 rounded bg-muted text-muted-foreground flex items-center gap-0.5 leading-none">
                          <EyeOff className="w-2.5 h-2.5" /> Excluded
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => updateCategory(c.id, { is_essential: !c.is_essential } as any)}
                        className={`text-[9px] px-1.5 py-0.5 rounded font-medium transition-colors ${c.is_essential ? 'bg-primary/15 text-primary hover:bg-primary/25' : 'bg-muted text-muted-foreground hover:text-foreground'}`}
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
                        className="p-1.5 rounded-lg hover:bg-muted transition-colors"
                        title="Edit category"
                      >
                        <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                      </button>
                      <button
                        onClick={() => setDeleteCatId(c.id)}
                        className="p-1.5 rounded-lg hover:bg-destructive/10 transition-colors"
                        title="Delete category"
                      >
                        <Trash2 className="w-3.5 h-3.5 text-destructive" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="flex gap-2 pt-2 border-t">
            <CategoryColorPicker color={newCatColor} onChange={setNewCatColor} />
            <Input value={newCatName} onChange={e => setNewCatName(e.target.value)} placeholder="Category name" className="flex-1 h-8" onKeyDown={e => e.key === 'Enter' && handleAddCategory()} />
            <Select value={newCatType} onValueChange={setNewCatType}>
              <SelectTrigger className="w-24 h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="fixed">Fixed</SelectItem>
                <SelectItem value="variable">Variable</SelectItem>
                <SelectItem value="savings">Savings</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={handleAddCategory} size="sm" className="h-8">Add</Button>
          </div>
        </CardContent>
      </Card>

      {/* Delete confirmation */}
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

      {/* Fixed Expenses moved to the Cost of Living page */}


      <DeleteConfirmDialog
        open={!!deleteExpId}
        onOpenChange={(open) => !open && setDeleteExpId(null)}
        onConfirm={() => {
          if (deleteExpId) {
            removeFixedExpense(deleteExpId);
            setDeleteExpId(null);
          }
        }}
        title="Delete Fixed Expense"
        description="This will permanently remove this fixed expense. This cannot be undone."
      />
    </div>
  );
}
