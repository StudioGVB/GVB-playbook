import OpenAI from 'https://esm.sh/openai@4.20.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface SuggestCategoryRequest {
  taskTitle: string;
  taskNotes?: string;
  sectionNames: string[];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const openai = new OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY') });
    const { taskTitle, taskNotes, sectionNames } = await req.json() as SuggestCategoryRequest;

    if (!sectionNames || sectionNames.length === 0) {
      return new Response(
        JSON.stringify({ suggestedSection: null }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const systemPrompt = `You are a task categorization assistant. Given a task title and optional notes, determine which category/section it best belongs to.

You MUST choose from ONLY these available sections: ${sectionNames.join(', ')}

Respond with a JSON object:
{
  "suggestedSection": "exact section name from the list" or null if none fit well,
  "confidence": "high" | "medium" | "low"
}

Be practical and choose the most relevant section. If the task could fit multiple sections, pick the most specific one. If none of the sections are a reasonable fit, return null.`;

    const userPrompt = `Task: ${taskTitle}${taskNotes ? `\nNotes: ${taskNotes}` : ''}

Which section does this task belong to?`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 100,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No response from AI');
    }

    const parsed = JSON.parse(content);
    
    // Validate that the suggested section is actually in our list
    if (parsed.suggestedSection && !sectionNames.includes(parsed.suggestedSection)) {
      // Try case-insensitive match
      const match = sectionNames.find(
        s => s.toLowerCase() === parsed.suggestedSection.toLowerCase()
      );
      parsed.suggestedSection = match || null;
    }
    
    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    console.error('Error suggesting category:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to suggest category';
    return new Response(
      JSON.stringify({ error: errorMessage, suggestedSection: null }),
      { 
        status: 200, // Return 200 so the UI can handle gracefully
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
