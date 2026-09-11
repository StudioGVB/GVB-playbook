import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `You are a precise data extraction engine.
Your job is to parse a bank statement (PDF text and/or images) and return ONLY valid JSON matching the schema below.

Non-negotiables:
- Do not guess. Do not invent. Do not "fill gaps."
- If a value is missing or unclear, set it to null and add a note to warnings[].
- Extract exactly what appears in the statement, even if it's messy.
- Prefer statement-provided balances over computed balances.
- Output must be valid JSON only (no markdown, no commentary).

What to extract:

A) Account summary: bank/provider name, account name/nickname, BSB + account number (masked ok), statement period, opening/closing/available balance, currency (default "AUD").

B) Transactions table: date (posted_date, value_date if both exist), description (full text, cleaned but not paraphrased), amount (negative for debits, positive for credits), type (debit/credit), running_balance if present, merchant_name if derivable, reference/receipt/transaction id if present.

C) Quality checks: detect running balance column, compute totals, flag mismatches.

JSON Output Schema (STRICT):
{
  "provider": string,
  "account": {
    "account_name": string | null,
    "account_number_masked": string | null,
    "bsb": string | null,
    "currency": string | null
  },
  "statement_period": {
    "start_date": "YYYY-MM-DD" | null,
    "end_date": "YYYY-MM-DD" | null
  },
  "balances": {
    "opening_balance": number | null,
    "closing_balance": number | null,
    "available_balance": number | null
  },
  "transactions": [
    {
      "posted_date": "YYYY-MM-DD" | null,
      "value_date": "YYYY-MM-DD" | null,
      "description": string,
      "amount": number,
      "type": "debit" | "credit",
      "running_balance": number | null,
      "merchant": string | null,
      "reference": string | null,
      "raw_row": string | null
    }
  ],
  "confidence": {
    "overall": number,
    "balances": number,
    "transactions": number
  },
  "warnings": [string],
  "notes_for_importer": {
    "has_running_balance_column": boolean,
    "date_format_detected": string | null,
    "amount_format_detected": string | null,
    "suggested_dedupe_key_fields": ["posted_date", "amount", "description"]
  }
}

Parsing Rules:
- Dates: Convert to ISO YYYY-MM-DD. If only day+month, infer year from statement period.
- Amount sign: Debits/spend = negative. Credits/income = positive. Use Debit/Credit columns or DR/CR markers.
- Description: Keep original text, normalize whitespace, keep identifiers.
- Balances: Use statement values, don't compute unless necessary.
- Validation: If opening + net ≠ closing, add warning. If no transactions, warn.

Output JSON only. No markdown. No explanation.`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { pdf_base64, pdf_text, account_context } = await req.json();

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build user message with context
    const userParts: string[] = [];
    if (account_context) {
      userParts.push(`Account context: ${JSON.stringify(account_context)}`);
      userParts.push(`User locale: AU, Timezone: Australia/Melbourne`);
    }
    if (pdf_text) {
      userParts.push(`\nExtracted PDF text:\n${pdf_text}`);
    }
    if (!pdf_text && !pdf_base64) {
      return new Response(JSON.stringify({ error: "No PDF content provided" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build messages array
    const messages: any[] = [
      { role: "system", content: SYSTEM_PROMPT },
    ];

    if (pdf_base64) {
      // Use multimodal: send PDF pages as images
      messages.push({
        role: "user",
        content: [
          { type: "text", text: userParts.join("\n") || "Parse this bank statement PDF and return JSON." },
          {
            type: "image_url",
            image_url: {
              url: `data:application/pdf;base64,${pdf_base64}`,
            },
          },
        ],
      });
    } else {
      messages.push({
        role: "user",
        content: userParts.join("\n"),
      });
    }

    console.log("Sending to AI gateway for statement parsing...");

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages,
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again shortly." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please top up in workspace settings." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errText = await response.text();
      console.error("AI gateway error:", response.status, errText);
      return new Response(JSON.stringify({ error: "AI parsing failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiResult = await response.json();
    const rawContent = aiResult.choices?.[0]?.message?.content;

    if (!rawContent) {
      return new Response(JSON.stringify({ error: "No content returned from AI" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Strip markdown code fences if present
    let jsonStr = rawContent.trim();
    if (jsonStr.startsWith("```")) {
      jsonStr = jsonStr.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
    }

    // Validate it's valid JSON
    let parsed;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      console.error("AI returned non-JSON:", jsonStr.slice(0, 500));
      return new Response(JSON.stringify({ error: "AI returned invalid JSON", raw: jsonStr.slice(0, 2000) }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Parsed ${parsed.transactions?.length || 0} transactions, confidence: ${parsed.confidence?.overall}`);

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("parse-statement error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
