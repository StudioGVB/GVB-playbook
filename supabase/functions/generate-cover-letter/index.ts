import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { profile, jobTitle, companyName, jobDescription, customNotes } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    // Extract candidate name from personal_details for sign-off
    const personalDetails = profile.personal_details || '';
    
    const systemPrompt = `You are an expert cover letter writer. You write specific, honest, compelling, FORMALLY STRUCTURED cover letters that match a candidate's real experience to a job's actual requirements.

FORMAT & STRUCTURE (follow this exactly):
1. Start with "Dear [Hiring Manager's name if found in the listing, otherwise 'Hiring Manager'],"
2. Opening paragraph: Introduce yourself, state which role you're applying for and where you found it, and give a compelling reason why you're interested.
3. 2-3 body paragraphs that match your experience directly to the job requirements. Reference real projects, metrics, and skills from the candidate profile.
4. A paragraph showing alignment with the company's mission or goals (if evident from the listing).
5. Closing paragraph: Confident call to action, mention availability/start date if provided in personal details, restate enthusiasm.
6. Sign off with "Yours sincerely," followed by a blank line and the candidate's full name (extract from personal details).

CRITICAL FORMATTING RULES:
- Output PLAIN TEXT ONLY. No markdown, no bold (**text**), no italic (*text*), no bullet points (• or -).
- Use normal prose paragraphs. Never use bullet lists.
- The output will be pasted directly into application forms, so it must read as a clean, professional letter with no formatting symbols.

TONE RULES:
- Keep the tone ${profile.preferred_tone || 'professional'}
- Never use generic filler like "I am passionate about..." or "I am excited to apply..."
- Be honest — don't fabricate experience, but frame existing experience in the most relevant light
- Aim for 350-500 words
- Address the company by name and reference specific requirements from the listing
- If the candidate mentions relocation, visa status, or availability in their personal details, weave it naturally into the closing paragraph`;

    const userPrompt = `Write a formally structured cover letter for this role:

**Company:** ${companyName}
**Role:** ${jobTitle}

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
${profile.interests}

${customNotes ? `**Additional Notes from candidate:** ${customNotes}` : ''}`;

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
      return new Response(JSON.stringify({ error: "AI generation failed" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("generate-cover-letter error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
