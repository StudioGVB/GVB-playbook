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
  { pattern: /\b(tfgm|beenetwork|bee network|greater manchester|piccadilly)\b/i, key: 'TFGM' },
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
  { pattern: /\bsuperdrug\b/i, key: 'SUPERDRUG' },
  { pattern: /\b(uber\s*eats|ubereats)\b/i, key: 'UBEREATS' },
  { pattern: /\buber\b/i, key: 'UBER' },
  { pattern: /\bbolt\b/i, key: 'BOLT' },
  { pattern: /\bdeliveroo\b/i, key: 'DELIVEROO' },
  { pattern: /\b(just\s*eat|justeat)\b/i, key: 'JUSTEAT' },
  { pattern: /\bmcdonald/i, key: 'MCDONALDS' },
  { pattern: /\bkfc\b/i, key: 'KFC' },
  { pattern: /\bnando/i, key: 'NANDOS' },
  { pattern: /\bwetherspoon/i, key: 'WETHERSPOONS' },
  { pattern: /\bpret\b/i, key: 'PRET' },
  { pattern: /\bstarbucks\b/i, key: 'STARBUCKS' },
  { pattern: /\b(caff[eè]\s*nero|nero)\b/i, key: 'CAFFENERO' },
  { pattern: /\bwaitrose\b/i, key: 'WAITROSE' },
  { pattern: /\bmorrison/i, key: 'MORRISONS' },
  { pattern: /\b(co-op|coop|co op|cooperative)\b/i, key: 'COOP' },
  { pattern: /\biceland\b/i, key: 'ICELAND' },
  { pattern: /\b(apple\.com|itunes|apple store)\b/i, key: 'APPLE' },
  { pattern: /\bspotify\b/i, key: 'SPOTIFY' },
  { pattern: /\bnetflix\b/i, key: 'NETFLIX' },
  { pattern: /\b(elevenlabs|11labs|eleven labs)\b/i, key: 'ELEVENLABS' },
  { pattern: /\bgamma\b/i, key: 'GAMMA' },
  { pattern: /\b(batchbase|batch base|venture advisory)\b/i, key: 'BATCHBASE' },
  { pattern: /\betsy\b/i, key: 'ETSY' },
  { pattern: /\bback pocket\b/i, key: 'BACKPOCKET' },
  { pattern: /\b(trainline|national rail|northern rail|avanti|lner|transpennine)\b/i, key: 'TRAINLINE' },
  { pattern: /\bryanair\b/i, key: 'RYANAIR' },
  { pattern: /\beasyjet\b/i, key: 'EASYJET' },
  { pattern: /\bairbnb\b/i, key: 'AIRBNB' },
  { pattern: /\bbooking\.com\b/i, key: 'BOOKING' },
  { pattern: /\b(whsmith|wh smith)\b/i, key: 'WHSMITH' },
  { pattern: /\buniqlo\b/i, key: 'UNIQLO' },
  { pattern: /\bzara\b/i, key: 'ZARA' },
  { pattern: /\basos\b/i, key: 'ASOS' },
  { pattern: /\bvinted\b/i, key: 'VINTED' },
  { pattern: /\bebay\b/i, key: 'EBAY' },
];

export function getCanonicalMerchantKey(text: string): string | null {
  const norm = text.toLowerCase();
  for (const { pattern, key } of KNOWN_MERCHANT_PATTERNS) {
    if (pattern.test(norm)) return key;
  }
  return null;
}

export function cleanMerchantString(s: string): string {
  const rawTokens = (s || '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(
      /\b(LTD|LIMITED|PLC|INC|CORP|CO|UK|GB|GBR|AUS|AU|MANCHESTER|LONDON|MANCHES|MCHESTE|SALFORD|STOCKPORT|LEEDS|LIVERPOOL|BIRMINGHAM|STORE|STORES|EXPRESS|SUPERSTORE|METRO|LOCAL|CARD|PURCHASE|PAYMENT|CONTACTLESS|POS|VISA|MASTERCARD|APPLE|GOOGLE|PAY|SQ|SUMUP|ZETTLE|IZ|NYX|PAYPAL|PP|STRIPE|WWW|HTTP|HTTPS|COM|COUK|ORG|NET|THE|AND|FOR|AT|IN|ON|TO|FROM|REF|TXN)\b/g,
      ' '
    )
    .replace(/\b\d+\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);

  // Deduplicate repeated tokens (e.g. when both description and merchant are "Habibi")
  return Array.from(new Set(rawTokens)).join(' ');
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
  if (!cleanA || !cleanB) {
    // Fallback if cleaning stripped all words (e.g. pure Apple Pay / PayPal / Transfer string)
    const rawNormA = textA.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const rawNormB = textB.toUpperCase().replace(/[^A-Z0-9]/g, '');
    return rawNormA.length >= 3 && rawNormA === rawNormB;
  }

  // Exact match on cleaned
  if (cleanA === cleanB) return true;

  // Substring match if long enough
  const compactA = cleanA.replace(/\s+/g, '');
  const compactB = cleanB.replace(/\s+/g, '');
  if (compactA.length >= 3 && compactB.length >= 3) {
    if (compactA.includes(compactB) || compactB.includes(compactA)) return true;
    if (compactA.slice(0, 5) === compactB.slice(0, 5) && compactA.length >= 5 && compactB.length >= 5) return true;
  }

  // Significant word intersection (words >= 3 chars)
  const wordsA = cleanA.split(' ').filter(w => w.length >= 3);
  const wordsB = cleanB.split(' ').filter(w => w.length >= 3);
  for (const w of wordsA) {
    if (wordsB.includes(w)) return true;
  }

  return false;
}

export function isDuplicatePair(a: any, b: any): { isDuplicate: boolean; keeper: any; duplicate: any } {
  // Amount must match down to the penny (check both native amount and base_amount if same currency)
  const amtA = Number(a.amount) || 0;
  const amtB = Number(b.amount) || 0;
  const baseA = Number(a.base_amount ?? amtA) || 0;
  const baseB = Number(b.base_amount ?? amtB) || 0;

  const nativeMatches = Math.abs(Math.abs(amtA) - Math.abs(amtB)) <= 0.01;
  const baseMatches = Math.abs(Math.abs(baseA) - Math.abs(baseB)) <= 0.01;
  if (!nativeMatches && !baseMatches) {
    return { isDuplicate: false, keeper: null, duplicate: null };
  }

  // Must have same sign (both expenses or both income/refunds)
  if ((amtA < 0) !== (amtB < 0)) {
    return { isDuplicate: false, keeper: null, duplicate: null };
  }

  // Currency check: if both specify currency, require same currency unless baseMatches
  const curA = (a.currency || 'GBP').toUpperCase();
  const curB = (b.currency || 'GBP').toUpperCase();
  if (curA !== curB && !baseMatches) {
    return { isDuplicate: false, keeper: null, duplicate: null };
  }

  // Never deduplicate cross-account transfers
  if ((a.is_transfer || b.is_transfer) && a.account_id !== b.account_id) {
    return { isDuplicate: false, keeper: null, duplicate: null };
  }

  // Date comparison in UK local time
  const dateA = parseUkDate(a.posted_at);
  const dateB = parseUkDate(b.posted_at);
  const diffDays = Math.abs(differenceInCalendarDays(dateA, dateB));

  // Only consider transactions within 4 calendar days of each other
  if (diffDays > 4) {
    return { isDuplicate: false, keeper: null, duplicate: null };
  }

  // Must match merchant / description
  const descA = a.description || '';
  const merchA = a.merchant || '';
  const descB = b.description || '';
  const merchB = b.merchant || '';
  if (!areMerchantsMatching(descA, merchA, descB, merchB)) {
    return { isDuplicate: false, keeper: null, duplicate: null };
  }

  // Determine earlier (keeper = actual purchase date) vs later (duplicate = settlement / re-sync)
  // If on the same timestamp, prefer the row that already has a category_id or API external_transaction_id
  let earlier = a;
  let later = b;
  if (dateA.getTime() < dateB.getTime()) {
    earlier = a;
    later = b;
  } else if (dateB.getTime() < dateA.getTime()) {
    earlier = b;
    later = a;
  } else {
    const scoreA = (a.category_id ? 2 : 0) + (a.external_transaction_id && !String(a.external_transaction_id).includes('|') ? 1 : 0);
    const scoreB = (b.category_id ? 2 : 0) + (b.external_transaction_id && !String(b.external_transaction_id).includes('|') ? 1 : 0);
    if (scoreB > scoreA) {
      earlier = b;
      later = a;
    }
  }

  // Any two transactions with the exact same amount, same sign, and matching merchant
  // within 0–4 calendar days (same-day sync duplicates, weekday/weekend card clearing,
  // CSV vs API duplicates, or pending-to-settled duplicates) are treated as duplicates.
  return { isDuplicate: true, keeper: earlier, duplicate: later };
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

        // Preserve goal / trip / fixed bill / reimbursable metadata on keeper
        if (duplicate.goal_id && !keeper.goal_id) keeper.goal_id = duplicate.goal_id;
        if (duplicate.trip_id && !keeper.trip_id) keeper.trip_id = duplicate.trip_id;
        if (duplicate.is_travel_spend && !keeper.is_travel_spend) keeper.is_travel_spend = duplicate.is_travel_spend;
        if (duplicate.fixed_expense_id && !keeper.fixed_expense_id) keeper.fixed_expense_id = duplicate.fixed_expense_id;
        if (duplicate.is_fixed && !keeper.is_fixed) keeper.is_fixed = duplicate.is_fixed;
        if (duplicate.is_reimbursable && !keeper.is_reimbursable) {
          keeper.is_reimbursable = duplicate.is_reimbursable;
          keeper.reimbursement_status = duplicate.reimbursement_status;
        }
        if (duplicate.merchant && !keeper.merchant) keeper.merchant = duplicate.merchant;

        // Preserve API external_transaction_id on keeper
        const dupExt = duplicate.external_transaction_id;
        const keepExt = keeper.external_transaction_id;
        if (dupExt && (!keepExt || keepExt.includes('|'))) {
          keeper.external_transaction_id = dupExt;
          externalIdTransfers[keeper.id] = dupExt;
        }

        // Only break out of the inner loop if the outer item `a` itself was marked as the duplicate.
        // When `a` is the keeper, continue scanning `j` so 3+ copies (a, b, c) are all caught!
        if (duplicate.id === a.id) {
          break;
        }
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
