import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const toolDef = {
  type: "function" as const,
  function: {
    name: "extract_profile",
    description: "Extract structured profile data from resume/CV text",
    parameters: {
      type: "object",
      properties: {
        personal_details: {
          type: "string",
          description: "Personal details: full name, location/address, phone number, email, LinkedIn URL, website, available start date, visa/work rights status. Format as key: value pairs separated by newlines.",
        },
        resume_text: {
          type: "string",
          description: "Work experience and employment history. Include job titles, companies, dates, and key responsibilities/achievements.",
        },
        skills: {
          type: "string",
          description: "Technical skills, tools, languages, frameworks, and soft skills. Comma-separated.",
        },
        projects: {
          type: "string",
          description: "Notable projects with brief descriptions of what was built and the impact.",
        },
        education: {
          type: "string",
          description: "Education background, qualifications, certifications, degrees, courses. Include institution names, dates, and grades/honors if mentioned.",
        },
        interests: {
          type: "string",
          description: "Personal interests, values, volunteer work, hobbies, and what motivates them.",
        },
      },
      required: ["personal_details", "resume_text", "skills", "projects", "education", "interests"],
      additionalProperties: false,
    },
  },
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const { text, file_base64, file_mime_type } = body;

    if (!text && !file_base64) {
      return new Response(JSON.stringify({ error: "No text or file provided" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    // Build messages – if a file is provided, use multimodal content parts
    const userContent: any = file_base64
      ? [
          { type: "text", text: "Extract profile information from this resume/CV document. Be thorough — capture every relevant detail." },
          {
            type: "image_url",
            image_url: { url: `data:${file_mime_type || "application/pdf"};base64,${file_base64}` },
          },
        ]
      : `Extract profile information from this text:\n\n${text}`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content: "You are a resume/CV parser. Extract structured information from the provided text or document and return it using the extract_profile tool. Be thorough — capture all relevant details. If a section has no data, return an empty string for it.",
          },
          { role: "user", content: userContent },
        ],
        tools: [toolDef],
        tool_choice: { type: "function", function: { name: "extract_profile" } },
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
      return new Response(JSON.stringify({ error: "AI parsing failed" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];

    if (!toolCall) {
      return new Response(JSON.stringify({ error: "AI did not return structured data" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const extracted = JSON.parse(toolCall.function.arguments);

    return new Response(JSON.stringify({ success: true, profile: extracted }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("parse-profile-text error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
