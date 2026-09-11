const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { name, category } = await req.json();
    if (!name) throw new Error("name required");

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("Missing LOVABLE_API_KEY");

    const prompt = `You are estimating grocery pricing in the UK (GBP) for a home-cooked meal ingredient.
Ingredient: "${name}" (category: ${category || "unknown"} — base=carb/starch, meat=protein, side=veg/salad).
Return realistic UK supermarket estimates (Tesco/Sainsbury's mid-range) for a typical pack:
- pack_price: total pack price in GBP
- servings_per_pack: how many meal-sized servings that pack yields
- calories_per_serving: kcal per serving`;

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "user", content: prompt }],
        tools: [{
          type: "function",
          function: {
            name: "estimate",
            description: "Return numeric estimates",
            parameters: {
              type: "object",
              properties: {
                pack_price: { type: "number" },
                servings_per_pack: { type: "number" },
                calories_per_serving: { type: "number" },
              },
              required: ["pack_price", "servings_per_pack", "calories_per_serving"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "estimate" } },
      }),
    });

    if (!resp.ok) {
      const t = await resp.text();
      return new Response(JSON.stringify({ error: t }), { status: resp.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const data = await resp.json();
    const args = data?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    const parsed = args ? JSON.parse(args) : null;
    if (!parsed) throw new Error("No estimate returned");

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
