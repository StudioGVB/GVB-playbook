/**
 * Safe CSV parser that handles quoted fields, commas in descriptions, etc.
 * Returns array of string arrays (rows of cells).
 */
export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let current = '';
  let inQuotes = false;
  let row: string[] = [];

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        current += '"';
        i++; // skip escaped quote
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(current.trim());
        current = '';
      } else if (ch === '\n' || (ch === '\r' && next === '\n')) {
        row.push(current.trim());
        if (row.some(cell => cell !== '')) rows.push(row);
        row = [];
        current = '';
        if (ch === '\r') i++; // skip \n after \r
      } else {
        current += ch;
      }
    }
  }
  // Last row
  row.push(current.trim());
  if (row.some(cell => cell !== '')) rows.push(row);

  return rows;
}

/** Parse date from common AU/ISO formats */
function parseDate(s: string): Date | null {
  const trimmed = s.trim();
  
  // dd/mm/yyyy
  let m = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const d = new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]));
    return isNaN(d.getTime()) ? null : d;
  }

  // dd-mm-yyyy
  m = trimmed.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (m) {
    const d = new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]));
    return isNaN(d.getTime()) ? null : d;
  }

  // yyyy-mm-dd (ISO)
  m = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    const d = new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));
    return isNaN(d.getTime()) ? null : d;
  }

  // Fallback
  const d = new Date(trimmed);
  return isNaN(d.getTime()) ? null : d;
}

/** Column name variants (lowercase) */
const DATE_VARIANTS = ['date', 'transaction date', 'posted date'];
const DESC_VARIANTS = ['description', 'narration', 'details', 'narrative'];
const DEBIT_VARIANTS = ['debit', 'withdrawal'];
const CREDIT_VARIANTS = ['credit', 'deposit'];
const AMOUNT_VARIANTS = ['amount', 'value'];
const BALANCE_VARIANTS = ['balance', 'total', 'running balance'];

function findCol(headers: string[], variants: string[]): number {
  const lower = headers.map(h => h.toLowerCase().trim());
  for (const v of variants) {
    const idx = lower.indexOf(v);
    if (idx !== -1) return idx;
  }
  return -1;
}

export interface ParsedTransaction {
  posted_at: string;
  description: string;
  amount: number;
  currency: string;
  external_transaction_id: string;
}

export interface ParseResult {
  rows: ParsedTransaction[];
  skipped: number;
  errors: string[];
  detectedHeaders: string[];
  extractedBalance: number | null;
  importLogId?: string; // Track which import log this came from
}

/**
 * Detect if CSV is headerless CommBank format (date, amount, description, balance).
 */
function isHeaderlessCommBank(rows: string[][]): boolean {
  if (rows.length < 2) return false;
  const first = rows[0];
  if (first.length !== 4) return false;
  const date = parseDate(first[0]);
  if (!date) return false;
  const amt = parseFloat(first[1].replace(/[^0-9.\-+]/g, ''));
  if (isNaN(amt)) return false;
  return true;
}

/**
 * Parse headerless CommBank CSV: date, amount, description, balance
 */
function parseHeaderlessCommBank(
  rows: string[][],
  accountId: string,
  currency: string,
  maxRows: number,
): ParseResult {
  const result: ParsedTransaction[] = [];
  let skipped = 0;
  const seenIds = new Set<string>();
  let lastBalance: number | null = null;

  for (let i = 0; i < rows.length && result.length < maxRows; i++) {
    const cells = rows[i];
    if (cells.length < 3) { skipped++; continue; }

    const date = parseDate(cells[0]);
    if (!date) { skipped++; continue; }

    const amount = parseFloat(cells[1].replace(/[^0-9.\-+]/g, ''));
    if (isNaN(amount) || amount === 0) { skipped++; continue; }

    const description = (cells[2] || '').trim();
    if (!description) { skipped++; continue; }

    // Extract balance from 4th column if present
    if (cells.length >= 4) {
      const bal = parseFloat(cells[3].replace(/[^0-9.\-+]/g, ''));
      if (!isNaN(bal)) lastBalance = bal;
    }

    const posted_at = date.toISOString();
    const extId = `${posted_at}|${description.slice(0, 80)}|${amount}|${accountId}`;

    if (seenIds.has(extId)) { skipped++; continue; }
    seenIds.add(extId);

    result.push({ posted_at, description, amount, currency, external_transaction_id: extId });
  }

  return { rows: result, skipped, errors: [], detectedHeaders: ['Date', 'Amount', 'Description', 'Balance'], extractedBalance: lastBalance };
}

/**
 * Parse CommBank-style CSV (or any bank CSV with common header names).
 */
export function parseBankCSV(
  text: string,
  accountId: string,
  currency: string = 'AUD',
  maxRows: number = 500,
): ParseResult {
  const parsed = parseCSV(text);
  if (parsed.length < 1) {
    return { rows: [], skipped: 0, errors: ['CSV has no data rows'], detectedHeaders: [], extractedBalance: null };
  }

  // Auto-detect headerless CommBank format
  if (isHeaderlessCommBank(parsed)) {
    return parseHeaderlessCommBank(parsed, accountId, currency, maxRows);
  }

  if (parsed.length < 2) {
    return { rows: [], skipped: 0, errors: ['CSV has no data rows'], detectedHeaders: [], extractedBalance: null };
  }

  const headers = parsed[0];
  const detectedHeaders = headers.map(h => h.trim());

  const dateIdx = findCol(headers, DATE_VARIANTS);
  const descIdx = findCol(headers, DESC_VARIANTS);
  const debitIdx = findCol(headers, DEBIT_VARIANTS);
  const creditIdx = findCol(headers, CREDIT_VARIANTS);
  const amountIdx = findCol(headers, AMOUNT_VARIANTS);
  const balanceIdx = findCol(headers, BALANCE_VARIANTS);

  const errors: string[] = [];
  if (dateIdx === -1) errors.push('Missing date column');
  if (descIdx === -1) errors.push('Missing description column');
  if (debitIdx === -1 && creditIdx === -1 && amountIdx === -1) {
    errors.push('Missing amount/debit/credit column');
  }
  if (errors.length > 0) {
    return { rows: [], skipped: 0, errors, detectedHeaders, extractedBalance: null };
  }

  const rows: ParsedTransaction[] = [];
  let skipped = 0;
  const seenIds = new Set<string>();
  let lastBalance: number | null = null;

  for (let i = 1; i < parsed.length && rows.length < maxRows; i++) {
    const cells = parsed[i];
    if (cells.length <= Math.max(dateIdx, descIdx)) {
      skipped++;
      continue;
    }

    const dateRaw = cells[dateIdx] || '';
    const date = parseDate(dateRaw);
    if (!date) { skipped++; continue; }

    const description = (cells[descIdx] || '').trim();
    if (!description) { skipped++; continue; }

    // Extract balance
    if (balanceIdx !== -1 && cells[balanceIdx]) {
      const bal = parseFloat(cells[balanceIdx].replace(/[^0-9.\-]/g, ''));
      if (!isNaN(bal)) lastBalance = bal;
    }

    let amount = 0;
    const hasDebitCredit = debitIdx !== -1 || creditIdx !== -1;

    if (hasDebitCredit) {
      const debitVal = debitIdx !== -1 ? parseFloat((cells[debitIdx] || '').replace(/[^0-9.\-]/g, '')) : NaN;
      const creditVal = creditIdx !== -1 ? parseFloat((cells[creditIdx] || '').replace(/[^0-9.\-]/g, '')) : NaN;
      
      if (!isNaN(debitVal) && debitVal !== 0) {
        amount = -Math.abs(debitVal);
      } else if (!isNaN(creditVal) && creditVal !== 0) {
        amount = Math.abs(creditVal);
      } else if (amountIdx !== -1) {
        amount = parseFloat((cells[amountIdx] || '').replace(/[^0-9.\-]/g, ''));
      }
    } else if (amountIdx !== -1) {
      amount = parseFloat((cells[amountIdx] || '').replace(/[^0-9.\-]/g, ''));
    }

    if (isNaN(amount) || amount === 0) { skipped++; continue; }

    const posted_at = date.toISOString();
    const extId = `${posted_at}|${description.slice(0, 80)}|${amount}|${accountId}`;
    
    if (seenIds.has(extId)) { skipped++; continue; }
    seenIds.add(extId);

    rows.push({
      posted_at,
      description,
      amount,
      currency,
      external_transaction_id: extId,
    });
  }

  return { rows, skipped, errors: [], detectedHeaders, extractedBalance: lastBalance };
}

/**
 * Parse NetBank transactions from markdown table format (from PDF extraction).
 * Format: | Date | Description | Amount | Balance |
 */
export function parseNetBankMarkdown(
  markdown: string,
  accountId: string,
  currency: string = 'AUD',
  maxRows: number = 500,
): ParseResult {
  const lines = markdown.split('\n');
  const result: ParsedTransaction[] = [];
  let skipped = 0;
  const seenIds = new Set<string>();
  let lastBalance: number | null = null;

  // Find table start (first line starting with |)
  let startIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith('|')) {
      startIdx = i;
      break;
    }
  }

  if (startIdx === -1) {
    return { rows: [], skipped: 0, errors: ['No table found in markdown'], detectedHeaders: [], extractedBalance: null };
  }

  // Parse rows (skip header row and separator row)
  for (let i = startIdx + 2; i < lines.length && result.length < maxRows; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('|')) break;

    const cells = line
      .split('|')
      .map(c => c.trim())
      .filter(c => c !== '');

    if (cells.length < 3) { skipped++; continue; }

    // Parse date
    const date = parseDate(cells[0]);
    if (!date) { skipped++; continue; }

    // Parse description
    const description = cells[1];
    if (!description) { skipped++; continue; }

    // Parse amount (remove currency symbols)
    const amountStr = cells[2].replace(/[^0-9.\-+]/g, '');
    const amount = parseFloat(amountStr);
    if (isNaN(amount) || amount === 0) { skipped++; continue; }

    // Parse balance if present (4th column)
    if (cells.length >= 4) {
      const balStr = cells[3].replace(/[^0-9.\-+]/g, '');
      const bal = parseFloat(balStr);
      if (!isNaN(bal)) lastBalance = bal;
    }

    const posted_at = date.toISOString();
    const extId = `${posted_at}|${description.slice(0, 80)}|${amount}|${accountId}`;

    if (seenIds.has(extId)) { skipped++; continue; }
    seenIds.add(extId);

    result.push({ posted_at, description, amount, currency, external_transaction_id: extId });
  }

  return { rows: result, skipped, errors: [], detectedHeaders: ['Date', 'Description', 'Amount', 'Balance'], extractedBalance: lastBalance };
}
