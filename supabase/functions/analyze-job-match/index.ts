import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { profile, jobTitle, companyName, jobDescription } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const systemPrompt = `You are a career advisor who gives honest, practical job match analysis. You compare a candidate's profile against a job listing and provide a detailed assessment.

Your response MUST follow this exact structure using markdown:

## Match Score: X/10

A one-sentence summary of the overall fit.

## 🏢 Company Summary
One sentence (max 15 words) describing what the company does and what industry it operates in. Keep it factual and brief.

## 🏷️ Role Functions: Tag1, Tag2, Tag3
List exactly 3 short function/department tags that best describe this role's core work areas (e.g. Sales, Marketing, Finance, Tech, Operations, Design, Product, Strategy, Data, HR, Legal, Customer Success). Use single words or two-word phrases max.

## ✅ Skills That Overlap
- List each matching skill/experience with a brief note on relevance
- Be specific — reference actual skills from the candidate profile

## 🎯 Tasks You'd Enjoy
Based on the candidate's interests and experience, list which job tasks/responsibilities they'd likely find fulfilling and why.

## 🎓 Qualification Fit: X/5
A single score from 1-5 reflecting how qualified the candidate is:
- 5 = Overqualified or perfectly qualified
- 4 = Meets all key requirements
- 3 = Meets most, with learnable gaps
- 2 = Missing significant experience or education
- 1 = Major gaps in required qualifications
One sentence explaining the rating.

## ⚠️ Gaps & Stretch Areas
- List areas where the candidate may be out of their depth
- Be honest but constructive — mention if it's learnable or a hard blocker
- If the job requires specific certifications or years of experience the candidate lacks, note it

## 💰 Salary & Compensation
**Headline:** [MUST be ≤5 words. Just the number/range. Examples: "$70k–$85k + super", "~$60k–$75k (est.)", "Not listed (~$65k est.)". NEVER write a full sentence here.]

One short sentence explaining if this was quoted or estimated and any notes on super/benefits.

## 📍 Work Arrangement
**Headline:** [MUST be ≤5 words. Just the arrangement. Examples: "Hybrid — 2 days WFH", "Fully remote", "On-site, Sydney CBD", "Remote-first, flex office". NEVER write a full sentence here.]

One short sentence with any extra location details.

## 🤔 Would You Actually Enjoy This?
Give a candid, personality-aware verdict. Consider:
- Does this align with their interests and values?
- Would the day-to-day tasks suit their working style?
- Any red flags in the listing (culture, expectations)?

IMPORTANT: Use today's date for all timeframe calculations. Do NOT guess dates — calculate precisely.

Keep the analysis honest and specific. No generic fluff. Reference actual details from both the profile and the listing.`;

    const today = new Date().toISOString().split('T')[0];
    const userPrompt = `Today's date is ${today}. Use this when calculating timeframes (e.g. if someone is relocating in March 2026 and today is February 2026, that is weeks away, NOT over a year).

Analyse this job match:

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
${profile.interests}`;

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
      return new Response(JSON.stringify({ error: "Analysis failed" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("analyze-job-match error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
