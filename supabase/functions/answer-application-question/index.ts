import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { profile, jobTitle, companyName, jobDescription, question, previousQAs } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const previousContext = previousQAs?.length
      ? `\n\n**Previously answered questions in this application:**\n${previousQAs.map((qa: { question: string; answer: string }, i: number) => `Q${i + 1}: ${qa.question}\nA${i + 1}: ${qa.answer}`).join('\n\n')}`
      : '';

    const systemPrompt = `You are helping a candidate answer application questions for a job they're applying to. Write personalised, honest, compelling answers based on their actual profile and the specific job listing.

CRITICAL LENGTH RULE:
- Your answer MUST be 2-5 sentences. No more. Ever.
- Be punchy and direct. Cut filler words. Every sentence must add value.
- Think of it as a smart, paraphrased summary — not an essay.

RULES:
- Write in first person as the candidate
- Be specific — reference real experience from their profile but keep it brief
- Don't fabricate experience — if the candidate lacks direct experience, frame adjacent experience creatively in 1 sentence
- For salary questions, give a concise range or deflect tactfully in 1 sentence
- For availability/start date questions, check personal details for any mentioned dates
- Be consistent with any previous answers in the same application`;

    const userPrompt = `Answer this application question for the role of **${jobTitle}** at **${companyName}**:

**Question:** ${question}

---

**Job Description:**
${jobDescription}

---

**Candidate Profile:**

**Personal Details:**
${profile.personal_details || 'Not provided'}

**Experience/Resume:**
${profile.resume_text}

**Education & Qualifications:**
${profile.education || 'Not provided'}

**Skills:**
${profile.skills}

**Notable Projects:**
${profile.projects}

**Interests & Values:**
${profile.interests}${previousContext}`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        stream: true,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again shortly." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add credits." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(JSON.stringify({ error: "Answer generation failed" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("answer-application-question error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
