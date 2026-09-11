import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar as CalendarIcon, Plus, Receipt } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { useFinanceData, type FinanceCategory } from '@/hooks/useFinanceData';
import { toast } from 'sonner';

interface LogTripExpenseDialogProps {
  tripId: string;
  tripName: string;
  categories: FinanceCategory[];
  trigger?: React.ReactNode;
}

export function LogTripExpenseDialog({ tripId, tripName, categories, trigger }: LogTripExpenseDialogProps) {
  const { getOrCreateExternalAccount, addManualTransaction } = useFinanceData();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState<Date>(new Date());
  const [categoryId, setCategoryId] = useState<string>('__none__');
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setAmount(''); setDescription(''); setDate(new Date()); setCategoryId('__none__');
  };

  const handleSave = async () => {
    const value = parseFloat(amount);
    if (!value || value <= 0) { toast.error('Enter an amount'); return; }
    setSaving(true);
    try {
      const accountId = await getOrCreateExternalAccount();
      if (!accountId) return;
      await addManualTransaction({
        account_id: accountId,
        amount: -Math.abs(value), // expense = negative
        description: description.trim() || `Trip expense — ${tripName}`,
        posted_at: date.toISOString(),
        trip_id: tripId,
        category_id: categoryId === '__none__' ? null : categoryId,
        raw: { source: 'manual_external', logged_via: 'trip_expense_dialog' },
      });
      toast.success('Trip expense logged');
      reset();
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const variableCats = categories.filter(c => c.type !== 'income' && c.type !== 'transfer');

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm" variant="outline" className="gap-1.5">
            <Plus className="w-3.5 h-3.5" /> Log trip expense
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Receipt className="w-5 h-5" /> Log trip expense
          </DialogTitle>
          <DialogDescription>
            For money you spent on this trip outside your tracked accounts (cash, paid by partner, etc.). It'll deduct from the trip pool and your weekly spend, but won't change any account balance.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label htmlFor="amt">Amount</Label>
            <Input
              id="amt"
              type="number"
              inputMode="decimal"
              step="0.01"
              placeholder="0.00"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="desc">What was it for?</Label>
            <Input
              id="desc"
              placeholder={`e.g. Reimbursed ${tripName} partner`}
              value={description}
              onChange={e => setDescription(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn('justify-start text-left font-normal w-full', !date && 'text-muted-foreground')}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {date ? format(date, 'LLL d, y') : 'Pick a date'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={date} onSelect={(d) => d && setDate(d)} initialFocus className="p-3 pointer-events-auto" />
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-2">
              <Label>Category</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Uncategorised</SelectItem>
                  {variableCats.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button onClick={handleSave} className="w-full" disabled={saving || !amount}>
            {saving ? 'Saving…' : 'Log expense'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
