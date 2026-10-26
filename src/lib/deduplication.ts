import { differenceInCalendarDays } from 'date-fns';
import { parseUkDate } from './financeUtils';

export interface DeduplicationResult<T> {
  cleaned: T[];
  duplicatesToDelete: string[];
  categoryTransfers: Record<string, string>;
  externalIdTransfers: Record<string, string>;
}

const KNOWN_MERCHANT_PATTERNS: Array<{ pattern: RegExp; key: string }> = [
  { pattern: /\b(amazon|amzn)\b/i, key: 'AMAZON' },
  { pattern: /\btesco\b/i, key: 'TESCO' },
  { pattern: /\bhabibi\b/i, key: 'HABIBI' },
  { pattern: /\blidl\b/i, key: 'LIDL' },
  { pattern: /\bgreggs\b/i, key: 'GREGGS' },
  { pattern: /\bprimark\b/i, key: 'PRIMARK' },
  { pattern: /\b(tfgm|beenetwork|greater manchester|piccadilly)\b/i, key: 'TFGM' },
  { pattern: /\b(tfl|transport for london)\b/i, key: 'TFL' },
  { pattern: /\bthree square\b/i, key: 'THREESQUARE' },
  { pattern: /\bcosta\b/i, key: 'COSTA' },
  { pattern: /\b(m14 crispy|crispy burger)\b/i, key: 'M14BURGER' },
  { pattern: /\bko twins\b/i, key: 'KOTWINS' },
  { pattern: /\bsainsbury/i, key: 'SAINSBURYS' },
  { pattern: /\baldi\b/i, key: 'ALDI' },
  { pattern: /\basda\b/i, key: 'ASDA' },
  { pattern: /\b(m&s|marks and spencer|marks & spencer)\b/i, key: 'MAND_S' },
  { pattern: /\bboots\b/i, key: 'BOOTS' },
  { pattern: /\b(uber|ubereats)\b/i, key: 'UBER' },
  { pattern: /\bdeliveroo\b/i, key: 'DELIVEROO' },
  { pattern: /\bmcdonald/i, key: 'MCDONALDS' },
  { pattern: /\b(apple\.com|itunes|apple store)\b/i, key: 'APPLE' },
  { pattern: /\bspotify\b/i, key: 'SPOTIFY' },
  { pattern: /\bnetflix\b/i, key: 'NETFLIX' },
];

export function getCanonicalMerchantKey(text: string): string | null {
  const norm = text.toLowerCase();
  for (const { pattern, key } of KNOWN_MERCHANT_PATTERNS) {
    if (pattern.test(norm)) return key;
  }
  return null;
}

export function cleanMerchantString(s: string): string {
  return (s || '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\b(LTD|PLC|INC|CORP|CO|UK|GB|MANCHESTER|LONDON|MANCHES|MCHESTE|STORE|STORES|CARD|PURCHASE|PAYMENT|COM|COUK)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function areMerchantsMatching(
  descA: string = '',
  merchA: string = '',
  descB: string = '',
  merchB: string = ''
): boolean {
  const textA = `${descA} ${merchA}`.trim();
  const textB = `${descB} ${merchB}`.trim();

  // 1. Check known canonical aliases (e.g. AMZN MKTP vs AMAZON* LONDON vs Amazon.co.uk)
  const keyA = getCanonicalMerchantKey(textA);
  const keyB = getCanonicalMerchantKey(textB);
  if (keyA && keyB && keyA === keyB) return true;

  // 2. Cleaned merchant strings
  const cleanA = cleanMerchantString(textA);
  const cleanB = cleanMerchantString(textB);
  if (!cleanA || !cleanB) return false;

  // Exact match on cleaned
  if (cleanA === cleanB) return true;

  // Substring match if long enough
  const compactA = cleanA.replace(/\s+/g, '');
  const compactB = cleanB.replace(/\s+/g, '');
  if (compactA.length >= 4 && compactB.length >= 4) {
    if (compactA.includes(compactB) || compactB.includes(compactA)) return true;
    if (compactA.slice(0, 6) === compactB.slice(0, 6) && compactA.length >= 6) return true;
  }

  // Significant word intersection (words >= 4 chars)
  const wordsA = cleanA.split(' ').filter(w => w.length >= 4);
  const wordsB = cleanB.split(' ').filter(w => w.length >= 4);
  for (const w of wordsA) {
    if (wordsB.includes(w)) return true;
  }

  return false;
}

export function isDuplicatePair(a: any, b: any): { isDuplicate: boolean; keeper: any; duplicate: any } {
  // Amount must match down to the penny
  const amtA = Number(a.amount) || 0;
  const amtB = Number(b.amount) || 0;
  if (Math.abs(Math.abs(amtA) - Math.abs(amtB)) > 0.005) {
    return { isDuplicate: false, keeper: null, duplicate: null };
  }

  // Must have same sign (both expenses or both income/refunds)
  if ((amtA < 0) !== (amtB < 0)) {
    return { isDuplicate: false, keeper: null, duplicate: null };
  }

  // Account match: if both specify account_id, must match (or both GBP)
  if (a.account_id && b.account_id && a.account_id !== b.account_id) {
    return { isDuplicate: false, keeper: null, duplicate: null };
  }

  // Must match merchant
  const descA = a.description || '';
  const merchA = a.merchant || '';
  const descB = b.description || '';
  const merchB = b.merchant || '';
  if (!areMerchantsMatching(descA, merchA, descB, merchB)) {
    return { isDuplicate: false, keeper: null, duplicate: null };
  }

  // Date comparison in UK local time
  const dateA = parseUkDate(a.posted_at);
  const dateB = parseUkDate(b.posted_at);
  const diffDays = Math.abs(differenceInCalendarDays(dateA, dateB));

  // Determine earlier vs later
  const [earlier, later] = dateA <= dateB ? [a, b] : [b, a];
  const earlierDate = dateA <= dateB ? dateA : dateB;
  const laterDate = dateA <= dateB ? dateB : dateA;

  // Never deduplicate internal transfers
  if (a.is_transfer || b.is_transfer) {
    return { isDuplicate: false, keeper: null, duplicate: null };
  }

  // Never deduplicate fixed recurring bills across different days
  if (a.is_fixed && b.is_fixed && diffDays > 0) {
    return { isDuplicate: false, keeper: null, duplicate: null };
  }

  const key = getCanonicalMerchantKey(`${descA} ${merchA}`) || getCanonicalMerchantKey(`${descB} ${merchB}`);

  const extA = String(a.external_transaction_id || '');
  const extB = String(b.external_transaction_id || '');
  const bothAreDistinctApiTx =
    ((extA.startsWith('tx_') && extB.startsWith('tx_')) ||
     (extA.length > 20 && extB.length > 20 && !extA.includes('|') && !extB.includes('|'))) &&
    extA !== extB;
  const timeDiffMinutes = Math.abs(dateA.getTime() - dateB.getTime()) / (1000 * 60);

  // If both transactions have distinct official bank API transaction IDs (e.g. two distinct Monzo tx_ IDs),
  // they are guaranteed to be separate real-world card transactions, NOT clearing duplicates!
  if (bothAreDistinctApiTx && diffDays > 0) {
    return { isDuplicate: false, keeper: null, duplicate: null };
  }

  // Condition 1: Same calendar day (unless both are verified distinct bank API events > 5 mins apart)
  const isSameDay = diffDays === 0 && (!bothAreDistinctApiTx || timeDiffMinutes <= 5);

  // Condition 2: Weekend to Monday/Tuesday clearing
  const dayEarlier = earlierDate.getDay(); // 5 = Fri, 6 = Sat, 0 = Sun
  const dayLater = laterDate.getDay();    // 1 = Mon, 2 = Tue
  const isWeekendClearing =
    (dayEarlier === 5 || dayEarlier === 6 || dayEarlier === 0) &&
    (dayLater === 1 || dayLater === 2) &&
    diffDays <= 4;

  // Condition 3: CSV import vs API sync
  const hasCsv = extA.includes('|') || extB.includes('|');
  const hasApi = extA.startsWith('tx_') || extB.startsWith('tx_') || (!extA.includes('|') && extA.length > 10) || (!extB.includes('|') && extB.length > 10);
  const isCsvVsApi = hasCsv && hasApi && diffDays <= 4;

  // Condition 4: Amazon orders (auth vs capture can happen across 0-4 days)
  const isAmazonOrder = key === 'AMAZON' && diffDays <= 4;

  // Condition 5: Near-identical description within 48h (unless distinct API txs)
  const cleanA = cleanMerchantString(`${descA} ${merchA}`);
  const cleanB = cleanMerchantString(`${descB} ${merchB}`);
  const isCloseTimeIdentical = cleanA === cleanB && diffDays <= 2 && (!bothAreDistinctApiTx || timeDiffMinutes <= 5);

  if (isSameDay || isWeekendClearing || isCsvVsApi || isAmazonOrder || isCloseTimeIdentical) {
    // Keep earlier (actual transaction date), delete later (settlement/duplicate)
    return { isDuplicate: true, keeper: earlier, duplicate: later };
  }

  return { isDuplicate: false, keeper: null, duplicate: null };
}

export function deduplicateTransactions<T extends any>(transactions: T[]): DeduplicationResult<T> {
  const duplicateIdSet = new Set<string>();
  const duplicatesToDelete: string[] = [];
  const categoryTransfers: Record<string, string> = {};
  const externalIdTransfers: Record<string, string> = {};

  // Sort by date ascending so we process earlier transactions first
  const sorted = [...transactions].sort((a, b) => {
    const da = parseUkDate(a.posted_at).getTime();
    const db = parseUkDate(b.posted_at).getTime();
    return da - db;
  });

  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    if (duplicateIdSet.has(a.id)) continue;

    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j];
      if (duplicateIdSet.has(b.id)) continue;

      // Quick date difference check - if difference > 5 days, break (since sorted)
      const dateA = parseUkDate(a.posted_at);
      const dateB = parseUkDate(b.posted_at);
      if (differenceInCalendarDays(dateB, dateA) > 5) {
        break;
      }

      const { isDuplicate, keeper, duplicate } = isDuplicatePair(a, b);
      if (isDuplicate && keeper && duplicate) {
        duplicateIdSet.add(duplicate.id);
        duplicatesToDelete.push(duplicate.id);

        // Preserve category: if duplicate has category and keeper doesn't, transfer to keeper
        if (duplicate.category_id && !keeper.category_id) {
          keeper.category_id = duplicate.category_id;
          categoryTransfers[keeper.id] = duplicate.category_id;
        }

        // Preserve API external_transaction_id on keeper
        const dupExt = duplicate.external_transaction_id;
        const keepExt = keeper.external_transaction_id;
        if (dupExt && (!keepExt || keepExt.includes('|'))) {
          keeper.external_transaction_id = dupExt;
          externalIdTransfers[keeper.id] = dupExt;
        }

        // 1-to-1 match found for `a`, move to next `a`
        break;
      }
    }
  }

  const cleaned = transactions.filter(t => !duplicateIdSet.has(t.id));

  return {
    cleaned,
    duplicatesToDelete,
    categoryTransfers,
    externalIdTransfers,
  };
}
