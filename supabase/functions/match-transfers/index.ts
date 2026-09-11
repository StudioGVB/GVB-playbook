import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TRANSFER_KEYWORDS = [
  "transfer", "fast transfer", "internal transfer",
  "to xx", "from xx", "osko", "pay anyone",
  "internet transfer", "bank transfer", "sweep",
  "move money", "top up", "withdrawal to", "deposit from",
  "commbank", "up bank",
];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "No auth" }), { status: 401, headers: corsHeaders });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: { user }, error: authErr } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authErr || !user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });

    const userId = user.id;

    // Parse optional action from body
    let body: any = {};
    try { body = await req.json(); } catch { /* empty body ok */ }
    const action = body.action; // 'confirm' | 'reject' | 'suggest' (default)

    // ---- CONFIRM action ----
    if (action === "confirm") {
      const { outId, inId } = body;
      if (!outId || !inId) {
        return new Response(JSON.stringify({ error: "outId and inId required" }), { status: 400, headers: corsHeaders });
      }

      // Fetch both transactions
      const { data: txPair } = await supabase
        .from("finance_transactions")
        .select("id, account_id, amount, description")
        .in("id", [outId, inId])
        .eq("user_id", userId);

      if (!txPair || txPair.length !== 2) {
        return new Response(JSON.stringify({ error: "Transactions not found" }), { status: 404, headers: corsHeaders });
      }

      const outTx = txPair.find(t => t.id === outId)!;
      const inTx = txPair.find(t => t.id === inId)!;
      const groupId = crypto.randomUUID();
      const roundedAmount = Math.round(Math.abs(outTx.amount));
      const patternKey = `${outTx.account_id}-${inTx.account_id}-${roundedAmount}`;

      // Update both transactions
      await supabase.from("finance_transactions").update({
        is_transfer: true,
        transfer_status: "confirmed",
        transfer_group_id: groupId,
        transfer_side: "out",
        matched_transaction_id: inId,
        transfer_pattern_key: patternKey,
      }).eq("id", outId);

      await supabase.from("finance_transactions").update({
        is_transfer: true,
        transfer_status: "confirmed",
        transfer_group_id: groupId,
        transfer_side: "in",
        matched_transaction_id: outId,
        transfer_pattern_key: patternKey,
      }).eq("id", inId);

      // Upsert pattern
      const { data: existingPattern } = await supabase
        .from("transfer_patterns")
        .select("id, confirmation_count")
        .eq("user_id", userId)
        .eq("pattern_key", patternKey)
        .maybeSingle();

      if (existingPattern) {
        const newCount = (existingPattern.confirmation_count || 0) + 1;
        await supabase.from("transfer_patterns").update({
          confirmation_count: newCount,
          auto_match_enabled: newCount >= 3,
        }).eq("id", existingPattern.id);
      } else {
        await supabase.from("transfer_patterns").insert({
          user_id: userId,
          pattern_key: patternKey,
          account_from_id: outTx.account_id,
          account_to_id: inTx.account_id,
          typical_amount: Math.abs(outTx.amount),
          amount_tolerance: 0.01,
          frequency: "irregular",
          confirmation_count: 1,
          auto_match_enabled: false,
        });
      }

      return new Response(JSON.stringify({ success: true, groupId, patternKey }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---- CONFIRM SINGLE action ----
    if (action === "confirm_single") {
      const { txId } = body;
      if (!txId) {
        return new Response(JSON.stringify({ error: "txId required" }), { status: 400, headers: corsHeaders });
      }
      const groupId = crypto.randomUUID();
      await supabase.from("finance_transactions").update({
        is_transfer: true,
        transfer_status: "confirmed",
        transfer_group_id: groupId,
      }).eq("id", txId).eq("user_id", userId);

      return new Response(JSON.stringify({ success: true, groupId }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---- REJECT SINGLE action ----
    if (action === "reject_single") {
      const { txId } = body;
      if (!txId) {
        return new Response(JSON.stringify({ error: "txId required" }), { status: 400, headers: corsHeaders });
      }
      await supabase.from("finance_transactions").update({
        is_transfer: false,
        transfer_status: "rejected",
      }).eq("id", txId).eq("user_id", userId);

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---- REJECT action ----
    if (action === "reject") {
      const { outId, inId } = body;
      if (!outId || !inId) {
        return new Response(JSON.stringify({ error: "outId and inId required" }), { status: 400, headers: corsHeaders });
      }

      for (const id of [outId, inId]) {
        await supabase.from("finance_transactions").update({
          transfer_status: "rejected",
          transfer_group_id: null,
          matched_transaction_id: null,
        }).eq("id", id).eq("user_id", userId);
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---- SUGGEST action (default) ----
    // 1. Fetch all transactions
    const { data: allTxs, error: txErr } = await supabase
      .from("finance_transactions")
      .select("id, account_id, posted_at, amount, description, merchant, category_id, is_transfer, transfer_group_id, transfer_side, transfer_status, transfer_pattern_key")
      .eq("user_id", userId)
      .order("posted_at", { ascending: true });

    if (txErr) throw txErr;
    if (!allTxs || allTxs.length === 0) {
      return new Response(JSON.stringify({ suggested: 0, autoConfirmed: 0, message: "No transactions" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch categories for "Transfers" detection
    const { data: cats } = await supabase
      .from("finance_categories")
      .select("id, name, type")
      .eq("user_id", userId);

    const transferCatIds = new Set((cats || []).filter(c => c.name === "Transfers" || c.type === "transfer").map(c => c.id));

    // Fetch learned patterns
    const { data: patterns } = await supabase
      .from("transfer_patterns")
      .select("*")
      .eq("user_id", userId);

    const autoPatterns = (patterns || []).filter(p => p.auto_match_enabled);

    // 2. Detect transfer candidates
    const candidates: typeof allTxs = [];
    const flagUpdates: Array<{ id: string; is_transfer: boolean; transfer_side: string }> = [];

    for (const tx of allTxs) {
      // Skip already confirmed/auto_confirmed
      if (tx.transfer_status === "confirmed" || tx.transfer_status === "auto_confirmed") continue;
      // Skip already in a group
      if (tx.transfer_group_id) continue;
      // Skip rejected (don't re-suggest)
      if (tx.transfer_status === "rejected") continue;

      const descLower = (tx.description || "").toLowerCase();
      const merchantLower = (tx.merchant || "").toLowerCase();
      const isCandidate =
        TRANSFER_KEYWORDS.some(kw => descLower.includes(kw)) ||
        merchantLower.includes("transfer") ||
        (tx.category_id && transferCatIds.has(tx.category_id));

      if (isCandidate) {
        const side = tx.amount < 0 ? "out" : "in";
        if (!tx.is_transfer) {
          flagUpdates.push({ id: tx.id, is_transfer: true, transfer_side: side });
        }
        candidates.push({ ...tx, is_transfer: true, transfer_side: side });
      } else if (tx.is_transfer && !tx.transfer_group_id) {
        const side = tx.transfer_side || (tx.amount < 0 ? "out" : "in");
        candidates.push({ ...tx, transfer_side: side });
      }
    }

    // Bulk flag candidates
    for (const u of flagUpdates) {
      await supabase.from("finance_transactions").update({
        is_transfer: u.is_transfer,
        transfer_side: u.transfer_side,
      }).eq("id", u.id);
    }

    // 3. Pair matching with scoring
    const outs = candidates.filter(t => (t.transfer_side === "out" || t.amount < 0));
    const ins = candidates.filter(t => (t.transfer_side === "in" || t.amount > 0));
    const matchedInIds = new Set<string>();
    let suggested = 0;
    let autoConfirmed = 0;

    for (const outTx of outs) {
      let bestMatch: typeof ins[0] | null = null;
      let bestScore = 0;

      for (const inTx of ins) {
        if (matchedInIds.has(inTx.id)) continue;
        if (inTx.account_id === outTx.account_id) continue;

        // Amount match (tolerance 0.01)
        const amountDiff = Math.abs(Math.abs(outTx.amount) - Math.abs(inTx.amount));
        if (amountDiff > 0.01) continue;

        // Date proximity (0-2 days)
        const outDate = new Date(outTx.posted_at).getTime();
        const inDate = new Date(inTx.posted_at).getTime();
        const daysDiff = Math.abs(outDate - inDate) / (1000 * 60 * 60 * 24);
        if (daysDiff > 2) continue;

        // Score
        let score = 50; // base for exact amount match
        score += daysDiff === 0 ? 20 : daysDiff <= 1 ? 10 : 5;

        // Description similarity
        const outDesc = (outTx.description || "").toLowerCase();
        const inDesc = (inTx.description || "").toLowerCase();
        const outTokens = new Set(outDesc.split(/\s+/));
        const inTokens = new Set(inDesc.split(/\s+/));
        let overlap = 0;
        for (const t of outTokens) if (inTokens.has(t)) overlap++;
        score += Math.min(overlap * 3, 10);

        // Last 4 digit matching
        const digits4 = /\d{4}/g;
        const outDigits = outDesc.match(digits4) || [];
        const inDigits = inDesc.match(digits4) || [];
        if (outDigits.some(d => inDigits.includes(d))) score += 5;

        // Pattern match bonus
        const roundedAmt = Math.round(Math.abs(outTx.amount));
        const pKey = `${outTx.account_id}-${inTx.account_id}-${roundedAmt}`;
        const matchedPattern = autoPatterns.find(p => p.pattern_key === pKey);
        if (matchedPattern) score += 10;

        if (score > bestScore) {
          bestScore = score;
          bestMatch = inTx;
        }
      }

      if (bestMatch && bestScore >= 60) {
        matchedInIds.add(bestMatch.id);

        const roundedAmt = Math.round(Math.abs(outTx.amount));
        const pKey = `${outTx.account_id}-${bestMatch.account_id}-${roundedAmt}`;
        const matchedPattern = autoPatterns.find(p => p.pattern_key === pKey);

        if (matchedPattern) {
          // Auto-confirm
          const groupId = crypto.randomUUID();
          await supabase.from("finance_transactions").update({
            is_transfer: true,
            transfer_status: "auto_confirmed",
            transfer_group_id: groupId,
            transfer_side: "out",
            matched_transaction_id: bestMatch.id,
            transfer_match_confidence: bestScore,
            transfer_pattern_key: pKey,
          }).eq("id", outTx.id);

          await supabase.from("finance_transactions").update({
            is_transfer: true,
            transfer_status: "auto_confirmed",
            transfer_group_id: groupId,
            transfer_side: "in",
            matched_transaction_id: outTx.id,
            transfer_match_confidence: bestScore,
            transfer_pattern_key: pKey,
          }).eq("id", bestMatch.id);

          // Increment pattern count
          await supabase.from("transfer_patterns").update({
            confirmation_count: (matchedPattern.confirmation_count || 0) + 1,
          }).eq("id", matchedPattern.id);

          autoConfirmed++;
        } else {
          // Suggest only - don't pair yet
          await supabase.from("finance_transactions").update({
            is_transfer: true,
            transfer_status: "suggested",
            transfer_side: "out",
            matched_transaction_id: bestMatch.id,
            transfer_match_confidence: bestScore,
          }).eq("id", outTx.id);

          await supabase.from("finance_transactions").update({
            is_transfer: true,
            transfer_status: "suggested",
            transfer_side: "in",
            matched_transaction_id: outTx.id,
            transfer_match_confidence: bestScore,
          }).eq("id", bestMatch.id);

          suggested++;
        }
      }
    }

    return new Response(JSON.stringify({
      suggested,
      autoConfirmed,
      candidates: candidates.length,
      message: `${suggested} suggested, ${autoConfirmed} auto-confirmed`,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("match-transfers error:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});
