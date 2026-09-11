/**
 * Compute a transaction fingerprint for deduplication.
 * Same logic must be used in CSV import, bank sync, and DB backfill.
 */

function normalizeDescription(desc: string): string {
  return desc
    .toUpperCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[^A-Z0-9 ]/g, '');
}

function dateOnly(isoOrDate: string | Date): string {
  const d = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate;
  return d.toISOString().slice(0, 10); // yyyy-mm-dd
}

/**
 * SHA-256 hex digest (browser-compatible via SubtleCrypto).
 * Falls back to a simple hash if crypto.subtle unavailable.
 */
async function sha256Hex(input: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const buf = new TextEncoder().encode(input);
    const hash = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hash))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }
  // Simple fallback (should never hit in modern browsers)
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) - h + input.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(16).padStart(16, '0');
}

export interface FingerprintInput {
  user_id: string;
  account_id: string;
  posted_at: string;
  amount: number;
  description: string;
}

export async function computeTxFingerprint(tx: FingerprintInput): Promise<string> {
  const input = [
    tx.user_id,
    tx.account_id,
    dateOnly(tx.posted_at),
    tx.amount.toFixed(2),
    normalizeDescription(tx.description),
  ].join('|');
  return sha256Hex(input);
}

/**
 * Batch compute fingerprints for multiple transactions.
 */
export async function computeTxFingerprints(
  txs: FingerprintInput[],
): Promise<string[]> {
  return Promise.all(txs.map(tx => computeTxFingerprint(tx)));
}
