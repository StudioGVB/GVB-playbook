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

  // Never deduplicate transactions across different accounts
  if (a.account_id && b.account_id && a.account_id !== b.account_id) {
    return { isDuplicate: false, keeper: null, duplicate: null };
  }

  // If both rows have real bank API external_transaction_ids and they differ,
  // they are two distinct real-world purchases (e.g., buying two rounds of drinks at the same bar).
  const extA = a.external_transaction_id ? String(a.external_transaction_id).trim() : '';
  const extB = b.external_transaction_id ? String(b.external_transaction_id).trim() : '';
  const hasRealExtA = Boolean(extA && !extA.includes('|'));
  const hasRealExtB = Boolean(extB && !extB.includes('|'));
  if (hasRealExtA && hasRealExtB && extA !== extB) {
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

  // Check exact timestamp difference:
  // Two card taps at different times of day (> 5 seconds apart) are separate purchases
  // unless one is a date-only CSV import (00:00:00 without API status) or a legacy HELD -> SETTLED pair on different days.
  const rawTimeA = new Date(a.posted_at).getTime();
  const rawTimeB = new Date(b.posted_at).getTime();
  const diffMs = Math.abs(rawTimeA - rawTimeB);
  const statusA = String(a.raw?.status || '').toUpperCase();
  const statusB = String(b.raw?.status || '').toUpperCase();
  const isDateOnlyCsvA = !statusA && (!String(a.posted_at).includes(':') || String(a.posted_at).includes('00:00:00'));
  const isDateOnlyCsvB = !statusB && (!String(b.posted_at).includes(':') || String(b.posted_at).includes('00:00:00'));

  if (diffMs > 5000 && !(hasRealExtA && hasRealExtB && extA === extB)) {
    const isOneCsv = isDateOnlyCsvA || isDateOnlyCsvB;
    const isHeldToSettledCrossDay =
      diffDays >= 1 &&
      !hasRealExtA &&
      !hasRealExtB &&
      ((statusA === 'HELD' && statusB === 'SETTLED') || (statusA === 'SETTLED' && statusB === 'HELD'));

    if (!isOneCsv && !isHeldToSettledCrossDay) {
      return { isDuplicate: false, keeper: null, duplicate: null };
    }
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
    const scoreA = (a.category_id ? 2 : 0) + (hasRealExtA ? 1 : 0);
    const scoreB = (b.category_id ? 2 : 0) + (hasRealExtB ? 1 : 0);
    if (scoreB > scoreA) {
      earlier = b;
      later = a;
    }
  }

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
        if (duplicate.reimbursement_payout_id && !keeper.reimbursement_payout_id) {
          keeper.reimbursement_payout_id = duplicate.reimbursement_payout_id;
        }
        if (duplicate.raw?.payback_meta && !keeper.raw?.payback_meta) {
          keeper.raw = { ...(keeper.raw || {}), payback_meta: duplicate.raw.payback_meta };
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

  const rawCleaned = transactions.filter(t => !duplicateIdSet.has(t.id));
  const cleaned = applyPairedPaybackNetting(rawCleaned);

  return {
    cleaned,
    duplicatesToDelete,
    categoryTransfers,
    externalIdTransfers,
  };
}

/**
 * Nets paired payback transactions against their linked expense transactions:
 * - Exact match (Payback == Expense): Both expense and payback become £0.00 (neutral — £0 spending, £0 income).
 * - Partial payback (Payback < Expense): Payback becomes £0.00 (neutral — £0 income), and Expense only deducts the remaining uncovered amount (Expense - Payback) from weekly/monthly spending.
 * - Excess payback (Payback > Expense): Expense becomes £0.00 (neutral — £0 spending), and Payback only adds the remaining excess amount (Payback - Expense) to income.
 */
export function applyPairedPaybackNetting<T extends any>(transactions: T[]): T[] {
  if (!transactions || transactions.length === 0) return transactions;

  // Clone items and restore original baseline amounts so repeated calls are 100% idempotent
  const items: any[] = transactions.map(tx => {
    const origAmt =
      (tx as any).original_amount !== undefined
        ? Number((tx as any).original_amount)
        : Number(tx.amount) || 0;
    const origBase =
      (tx as any).original_base_amount !== undefined
        ? Number((tx as any).original_base_amount)
        : Number(tx.base_amount ?? tx.amount) || 0;

    return {
      ...tx,
      amount: origAmt,
      base_amount: origBase,
      original_amount: origAmt,
      original_base_amount: origBase,
    };
  });

  const txById = new Map<string, any>();
  for (const tx of items) {
    if (tx.id) txById.set(tx.id, tx);
  }

  // Discover all unique (expenseId, incomeId) payback pairings
  const pairKeySet = new Set<string>();
  const pairs: Array<{ expenseId: string; incomeId: string }> = [];

  const addPair = (expenseId?: string | null, incomeId?: string | null) => {
    if (!expenseId || !incomeId || expenseId === incomeId) return;
    const key = `${expenseId}::${incomeId}`;
    if (pairKeySet.has(key)) return;
    pairKeySet.add(key);
    pairs.push({ expenseId, incomeId });
  };

  for (const tx of items) {
    const origAmt = Number(tx.original_amount) || 0;
    const meta = (tx.raw as any)?.payback_meta;

    if (meta) {
      if (meta.is_payback) {
        if (meta.linked_expense_id) addPair(meta.linked_expense_id, tx.id);
        if (Array.isArray(meta.linked_expense_ids)) {
          meta.linked_expense_ids.forEach((eid: string) => addPair(eid, tx.id));
        }
      }
      if (meta.has_payback) {
        if (meta.linked_income_id) addPair(tx.id, meta.linked_income_id);
        if (Array.isArray(meta.linked_income_ids)) {
          meta.linked_income_ids.forEach((iid: string) => addPair(tx.id, iid));
        }
      }
    }

    // Work Reimbursement paired payout deposit
    if (origAmt < 0 && tx.reimbursement_payout_id) {
      addPair(tx.id, tx.reimbursement_payout_id);
    }

    // Same-account or refund-flagged matched_transaction_id pair
    if (tx.matched_transaction_id) {
      const other = txById.get(tx.matched_transaction_id);
      if (other) {
        const otherOrigAmt = Number(other.original_amount) || 0;
        const isPaybackMatch =
          other.matched_transaction_id === tx.id ||
          Boolean(meta || (other.raw as any)?.payback_meta || tx.is_refund || other.is_refund) ||
          (tx.account_id && tx.account_id === other.account_id && !tx.is_transfer);
        if (isPaybackMatch) {
          if (origAmt < 0 && otherOrigAmt > 0) addPair(tx.id, other.id);
          else if (origAmt > 0 && otherOrigAmt < 0) addPair(other.id, tx.id);
        }
      }
    }
  }

  // Track remaining uncovered base amount for each paired transaction
  const remBaseById = new Map<string, number>();
  const pairedExpenseIds = new Set<string>();
  const pairedIncomeIds = new Set<string>();
  const matchedInSliceExpenseIds = new Set<string>();
  const matchedInSliceIncomeIds = new Set<string>();

  for (const { expenseId, incomeId } of pairs) {
    const expTx = txById.get(expenseId);
    const incTx = txById.get(incomeId);

    if (expTx) {
      pairedExpenseIds.add(expenseId);
      if (!remBaseById.has(expenseId)) {
        remBaseById.set(expenseId, Math.abs(Number(expTx.original_base_amount) || 0));
      }
    }
    if (incTx) {
      pairedIncomeIds.add(incomeId);
      if (!remBaseById.has(incomeId)) {
        remBaseById.set(incomeId, Math.abs(Number(incTx.original_base_amount) || 0));
      }
    }

    if (expTx && incTx) {
      matchedInSliceExpenseIds.add(expenseId);
      matchedInSliceIncomeIds.add(incomeId);
      const expRem = remBaseById.get(expenseId) || 0;
      const incRem = remBaseById.get(incomeId) || 0;
      const offset = Math.min(expRem, incRem);
      remBaseById.set(expenseId, Math.max(0, Math.round((expRem - offset) * 100) / 100));
      remBaseById.set(incomeId, Math.max(0, Math.round((incRem - offset) * 100) / 100));
    }
  }

  // Fallback when a caller passes a date-filtered subset of transactions where only one side of the pair is in the slice
  for (const tx of items) {
    const meta = (tx.raw as any)?.payback_meta;
    if (!meta) continue;
    const origBaseAbs = Math.abs(Number(tx.original_base_amount) || 0);
    const origAmtAbs = Math.abs(Number(tx.original_amount) || 0);
    const basePerNative = origAmtAbs > 0 ? origBaseAbs / origAmtAbs : 1;

    if (meta.has_payback && !matchedInSliceExpenseIds.has(tx.id)) {
      pairedExpenseIds.add(tx.id);
      const recordedPaybackNative = Math.abs(Number(meta.payback_amount) || 0);
      const recordedPaybackBase =
        meta.payback_base_amount !== undefined
          ? Math.abs(Number(meta.payback_base_amount) || 0)
          : recordedPaybackNative * basePerNative;
      const offset = Math.min(origBaseAbs, recordedPaybackBase);
      remBaseById.set(tx.id, Math.max(0, Math.round((origBaseAbs - offset) * 100) / 100));
    }

    if (meta.is_payback && !matchedInSliceIncomeIds.has(tx.id)) {
      pairedIncomeIds.add(tx.id);
      const recordedExpenseNative = Math.abs(Number(meta.expense_amount) || 0);
      const recordedExpenseBase =
        meta.expense_base_amount !== undefined
          ? Math.abs(Number(meta.expense_base_amount) || 0)
          : recordedExpenseNative > 0
          ? recordedExpenseNative * basePerNative
          : origBaseAbs; // If expense_amount wasn't stored, assume full payback covered the expense
      const offset = Math.min(origBaseAbs, recordedExpenseBase);
      remBaseById.set(tx.id, Math.max(0, Math.round((origBaseAbs - offset) * 100) / 100));
    }
  }

  // Apply netted amounts to paired expense transactions
  for (const expId of pairedExpenseIds) {
    const expTx = txById.get(expId);
    if (!expTx) continue;
    const origBaseAbs = Math.abs(Number(expTx.original_base_amount) || 0);
    const origAmtAbs = Math.abs(Number(expTx.original_amount) || 0);
    const fxRatio = origBaseAbs > 0 ? origAmtAbs / origBaseAbs : 1;
    const remBase = remBaseById.get(expId) ?? origBaseAbs;
    const coveredBase = Math.max(0, Math.round((origBaseAbs - remBase) * 100) / 100);

    expTx.is_payback_pair = true;
    expTx.is_paired_payback_expense = true;
    expTx.payback_covered_base = coveredBase;

    if (remBase <= 0.01) {
      // Paid back >= expense cost -> Expense stays 100% neutral (£0 spending)
      expTx.amount = 0;
      expTx.base_amount = 0;
      expTx.is_payback_neutral = true;
    } else {
      // Paid back < expense cost -> Only deduct the remaining uncovered amount from weekly/monthly spending
      expTx.base_amount = -remBase;
      expTx.amount = -Math.round(remBase * fxRatio * 100) / 100;
      expTx.is_payback_neutral = false;
    }
  }

  // Apply netted amounts to paired payback (income) transactions
  for (const incId of pairedIncomeIds) {
    const incTx = txById.get(incId);
    if (!incTx) continue;
    const origBaseAbs = Math.abs(Number(incTx.original_base_amount) || 0);
    const origAmtAbs = Math.abs(Number(incTx.original_amount) || 0);
    const fxRatio = origBaseAbs > 0 ? origAmtAbs / origBaseAbs : 1;
    const remBase = remBaseById.get(incId) ?? 0;
    const usedBase = Math.max(0, Math.round((origBaseAbs - remBase) * 100) / 100);

    incTx.is_payback_pair = true;
    incTx.is_paired_payback_income = true;
    incTx.payback_used_base = usedBase;
    // Clear refund/reimbursable flags because the covered portion has already been netted directly out of the paired expense
    incTx.is_refund = false;
    incTx.is_kiri_payback = false;
    incTx.is_reimbursable = false;

    if (remBase <= 0.01) {
      // Paid back <= expense cost -> Payback stays 100% neutral (£0 added to income)
      incTx.amount = 0;
      incTx.base_amount = 0;
      incTx.is_payback_neutral = true;
      incTx.has_payback_excess_income = false;
    } else {
      // Paid back > expense cost -> Only add the remaining excess money to income
      incTx.base_amount = remBase;
      incTx.amount = Math.round(remBase * fxRatio * 100) / 100;
      incTx.is_payback_neutral = false;
      incTx.has_payback_excess_income = true;
      incTx.is_transfer = false;
      incTx.transfer_status = null;
    }
  }

  return items as T[];
}
