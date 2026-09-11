import OpenAI from 'https://esm.sh/openai@4.20.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface TaskBreakdownRequest {
  taskTitle: string;
  taskNotes?: string;
  projectName: string;
  projectDescription?: string;
  isMoveProject?: boolean;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const openai = new OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY') });
    const { 
      taskTitle, 
      taskNotes, 
      projectName, 
      projectDescription,
      isMoveProject 
    } = await req.json() as TaskBreakdownRequest;

    const moveContext = isMoveProject 
      ? `This is part of an international relocation from Australia to the UK. Consider UK-specific requirements, costs, and practical tips for someone who may not have done this before.`
      : '';

    const systemPrompt = `You are a calm, supportive friend helping someone complete a task confidently. Your job is to break down the task so they don't forget anything important.

TONE: Friendly, practical, reassuring. Like a friend who's done this before and wants to help.

${moveContext}

Respond with a JSON object containing:
{
  "overview": "1-2 sentence summary of what to do (friendly, not robotic)",
  "steps": ["step 1", "step 2", ...], // 5-8 practical steps max
  "timeEstimate": "20-40 min", // realistic range
  "complexity": "Low" | "Medium" | "High",
  "pitfalls": ["thing 1", "thing 2", ...], // 2-4 common mistakes or things people forget
  "tips": "One short practical tip for the cheapest/simplest correct approach (or null if not relevant)"
}

Keep everything SHORT and ACTIONABLE. No essays. Be specific where helpful.`;

    const userPrompt = `Help me complete this task:

Task: ${taskTitle}
${taskNotes ? `Notes: ${taskNotes}` : ''}
Project: ${projectName}${projectDescription ? ` - ${projectDescription}` : ''}

Give me a friendly breakdown so I can do this confidently.`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 1000,
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
    
    return new Response(JSON.stringify({ breakdown: parsed }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    console.error('Error generating task breakdown:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to generate breakdown';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
