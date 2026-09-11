import { useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import { Repeat, ChevronDown, Lock, Sparkles } from 'lucide-react';
import { formatCurrency, baseAmt } from '@/lib/financeUtils';
import type { FixedExpense } from '@/hooks/useFixedExpenses';
import type { FinanceTransaction, FinanceCategory } from '@/hooks/useFinanceData';
import { subMonths } from 'date-fns';

const FREQ_TO_MONTHLY: Record<string, number> = {
  weekly: 52 / 12,
  fortnightly: 26 / 12,
  monthly: 1,
  quarterly: 1 / 3,
  yearly: 1 / 12,
};

interface DetectedSubscription {
  merchant: string;
  avgAmount: number;
  monthlyAmount: number;
  cadence: 'monthly' | 'yearly' | 'weekly';
  occurrences: number;
  lastDate: string;
  currency: string;
}

function normaliseMerchant(s: string): string {
  return (s || '')
    .toUpperCase()
    .replace(/\s+\d{2,}.*$/, '')
    .replace(/\s+#\w+/, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 40);
}

// Known subscription merchants — keyword → display name
const SUBSCRIPTION_KEYWORDS: { match: RegExp; display: string }[] = [
  { match: /netflix/i, display: 'Netflix' },
  { match: /spotify/i, display: 'Spotify' },
  { match: /disney\s*\+|disney\s*plus/i, display: 'Disney+' },
  { match: /amazon\s*prime|amznprime|prime\s*video/i, display: 'Amazon Prime' },
  { match: /apple\.com\/bill|itunes|icloud/i, display: 'Apple' },
  { match: /google\s*(one|storage|play|youtube)|youtube\s*premium/i, display: 'Google / YouTube' },
  { match: /cineworld\s*unlimited|unlimited\s*card/i, display: 'Cineworld Unlimited' },
  { match: /hbo|max\.com/i, display: 'HBO Max' },
  { match: /hulu/i, display: 'Hulu' },
  { match: /patreon/i, display: 'Patreon' },
  { match: /substack/i, display: 'Substack' },
  { match: /dropbox/i, display: 'Dropbox' },
  { match: /adobe/i, display: 'Adobe' },
  { match: /microsoft\s*365|office\s*365|onedrive/i, display: 'Microsoft 365' },
  { match: /linkedin\s*premium/i, display: 'LinkedIn Premium' },
  { match: /audible/i, display: 'Audible' },
  { match: /strava/i, display: 'Strava' },
  { match: /chatgpt|openai/i, display: 'ChatGPT' },
  { match: /claude\.ai|anthropic/i, display: 'Claude' },
  { match: /lovable/i, display: 'Lovable' },
  { match: /github/i, display: 'GitHub' },
  { match: /notion/i, display: 'Notion' },
  { match: /figma/i, display: 'Figma' },
  { match: /1password|lastpass|bitwarden/i, display: '1Password' },
  { match: /nordvpn|expressvpn|surfshark/i, display: 'VPN' },
  { match: /\bgym\b|puregym|fitness\s*first|virgin\s*active|anytime\s*fitness/i, display: 'Gym' },
];

function matchSubscription(text: string): string | null {
  for (const k of SUBSCRIPTION_KEYWORDS) {
    if (k.match.test(text)) return k.display;
  }
  return null;
}

function detectSubscriptions(
  transactions: FinanceTransaction[],
  categories: FinanceCategory[],
  _fixedExpenses: FixedExpense[],
): DetectedSubscription[] {
  const catMap = new Map(categories.map(c => [c.id, c]));
  const cutoff = subMonths(new Date(), 6);

  // Group by detected subscription brand
  const groups = new Map<string, FinanceTransaction[]>();
  for (const tx of transactions) {
    if (tx.amount >= 0 || tx.is_transfer || tx.is_fixed) continue;
    if ((tx as any).goal_id) continue;
    const cat = catMap.get(tx.category_id || '');
    if (cat?.type === 'fixed' || cat?.type === 'income' || cat?.type === 'transfer') continue;
    if (cat?.exclude_from_reports) continue;
    const d = new Date(tx.posted_at);
    if (d < cutoff) continue;
    const text = `${tx.merchant || ''} ${tx.description || ''}`;
    const brand = matchSubscription(text);
    if (!brand) continue;
    if (!groups.has(brand)) groups.set(brand, []);
    groups.get(brand)!.push(tx);
  }

  const result: DetectedSubscription[] = [];
  for (const [brand, txns] of groups) {
    if (txns.length < 1) continue;
    // Cluster identical-amount charges (rounded to 2dp). A merchant can have multiple price tiers.
    const byAmount = new Map<string, FinanceTransaction[]>();
    for (const tx of txns) {
      const key = `${tx.currency || 'AUD'}:${Math.abs(baseAmt(tx)).toFixed(2)}`;
      if (!byAmount.has(key)) byAmount.set(key, []);
      byAmount.get(key)!.push(tx);
    }
    for (const [, cluster] of byAmount) {
      // Need 2+ identical charges to call it recurring, OR a single charge if amount is "standard sub" range
      if (cluster.length < 2) continue;
      const sorted = [...cluster].sort((a, b) => +new Date(a.posted_at) - +new Date(b.posted_at));
      const gaps: number[] = [];
      for (let i = 1; i < sorted.length; i++) {
        gaps.push((+new Date(sorted[i].posted_at) - +new Date(sorted[i - 1].posted_at)) / 86400000);
      }
      const avgGap = gaps.reduce((s, g) => s + g, 0) / gaps.length;
      let cadence: 'monthly' | 'yearly' | 'weekly';
      let monthlyAmount: number;
      const amt = Math.abs(sorted[0].amount);
      if (avgGap >= 25 && avgGap <= 40) {
        cadence = 'monthly';
        monthlyAmount = amt;
      } else if (avgGap >= 330 && avgGap <= 400) {
        cadence = 'yearly';
        monthlyAmount = amt / 12;
      } else if (avgGap >= 5 && avgGap <= 10) {
        cadence = 'weekly';
        monthlyAmount = amt * (52 / 12);
      } else {
        continue;
      }
      result.push({
        merchant: brand,
        avgAmount: amt,
        monthlyAmount,
        cadence,
        occurrences: cluster.length,
        lastDate: sorted[sorted.length - 1].posted_at,
        currency: sorted[0].currency || 'AUD',
      });
    }
  }
  return result.sort((a, b) => b.monthlyAmount - a.monthlyAmount);
}


interface Props {
  fixedExpenses: FixedExpense[];
  transactions: FinanceTransaction[];
  categories: FinanceCategory[];
  baseCurrency: string;
  convertToBase: (amount: number, currency: string) => number;
}

export function RecurringCommitments({
  fixedExpenses,
  transactions,
  categories,
  baseCurrency,
  convertToBase,
}: Props) {
  const [open, setOpen] = useState(false);
  const fmt = (n: number) => formatCurrency(n, baseCurrency);

  const today = new Date().toISOString().slice(0, 10);
  const activeFixed = fixedExpenses.filter(e => {
    if (e.effective_from && today < e.effective_from) return false;
    if (e.effective_to && today > e.effective_to) return false;
    return true;
  });

  const scheduledFixed = fixedExpenses.filter(
    e => e.effective_from && today < e.effective_from,
  );

  const subscriptions = useMemo(
    () => detectSubscriptions(transactions, categories, fixedExpenses),
    [transactions, categories, fixedExpenses],
  );

  const fixedMonthlyTotal = activeFixed.reduce((sum, e) => {
    const mult = FREQ_TO_MONTHLY[e.frequency] || 1;
    return sum + convertToBase(e.amount * mult, e.currency || baseCurrency);
  }, 0);

  const subsMonthlyTotal = subscriptions.reduce(
    (s, x) => s + convertToBase(x.monthlyAmount, x.currency),
    0,
  );

  const grandTotal = fixedMonthlyTotal + subsMonthlyTotal;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card>
        <CollapsibleTrigger className="w-full group">
          <CardContent className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Repeat className="w-4 h-4 text-muted-foreground" />
              <div className="text-left">
                <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                  Recurring & Bills
                </p>
                <p className="text-xs text-muted-foreground/80 mt-0.5">
                  {activeFixed.length} fixed · {subscriptions.length} subscriptions detected
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right">
                <p className="text-base font-semibold tabular-nums">{fmt(grandTotal)}</p>
                <p className="text-[10px] text-muted-foreground">/month committed</p>
              </div>
              <ChevronDown className="w-4 h-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
            </div>
          </CardContent>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="px-4 pb-4 space-y-5 border-t border-border/60 pt-4">
            {/* Fixed */}
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Lock className="w-3 h-3 text-red-500" />
                  <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground">
                    Fixed bills
                  </p>
                </div>
                <p className="text-xs font-semibold tabular-nums">{fmt(fixedMonthlyTotal)}/mo</p>
              </div>
              {activeFixed.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">No active fixed bills.</p>
              ) : (
                <div className="space-y-1">
                  {activeFixed.map(e => {
                    const mult = FREQ_TO_MONTHLY[e.frequency] || 1;
                    const monthly = convertToBase(e.amount * mult, e.currency || baseCurrency);
                    return (
                      <div key={e.id} className="flex items-center justify-between text-sm py-1">
                        <div className="min-w-0">
                          <p className="font-medium truncate">{e.name}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {formatCurrency(e.amount, e.currency || baseCurrency)} · {e.frequency}
                            {e.due_day ? ` · due ${e.due_day}${suffix(e.due_day)}` : ''}
                          </p>
                        </div>
                        <p className="text-sm font-semibold tabular-nums shrink-0 ml-3">
                          {fmt(monthly)}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}

              {scheduledFixed.length > 0 && (
                <div className="mt-2 pt-2 border-t border-dashed border-border/60">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                    Scheduled
                  </p>
                  {scheduledFixed.map(e => (
                    <div key={e.id} className="flex items-center justify-between text-xs py-0.5 text-muted-foreground">
                      <span>
                        {e.name} · starts {e.effective_from}
                      </span>
                      <span className="tabular-nums">
                        {formatCurrency(e.amount, e.currency || baseCurrency)}/{e.frequency.replace('ly', '')}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Subscriptions */}
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Sparkles className="w-3 h-3 text-primary" />
                  <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground">
                    Auto-detected subscriptions
                  </p>
                </div>
                <p className="text-xs font-semibold tabular-nums">{fmt(subsMonthlyTotal)}/mo</p>
              </div>
              {subscriptions.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">
                  Nothing detected. Recurring charges (Netflix, Spotify, Amazon Prime, phone plans) will appear here once you have 2+ matching transactions.
                </p>
              ) : (
                <div className="space-y-1">
                  {subscriptions.map(s => (
                    <div key={s.merchant} className="flex items-center justify-between text-sm py-1">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-medium truncate">{titleCase(s.merchant)}</p>
                          <Badge variant="outline" className="text-[9px] py-0 px-1.5 h-4">
                            {s.cadence}
                          </Badge>
                        </div>
                        <p className="text-[10px] text-muted-foreground">
                          {formatCurrency(s.avgAmount, s.currency)} × {s.occurrences} charges · last {s.lastDate.slice(0, 10)}
                        </p>
                      </div>
                      <p className="text-sm font-semibold tabular-nums shrink-0 ml-3">
                        {fmt(convertToBase(s.monthlyAmount, s.currency))}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <div className="pt-2 border-t border-border/60 flex items-center justify-between">
              <p className="text-xs text-muted-foreground">Annual commitment</p>
              <p className="text-sm font-semibold tabular-nums">{fmt(grandTotal * 12)}/yr</p>
            </div>
          </div>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

function suffix(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return 'th';
  switch (n % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
