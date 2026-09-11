import OpenAI from 'https://esm.sh/openai@4.20.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface MoveSettings {
  target: string;
  stopover: string;
  stopoverDuration?: string;
  departureDate?: string;
  weeksRemaining?: number;
  workType: string;
  budgetSensitivity: string;
}

interface ExistingTask {
  title: string;
  notes?: string;
  completed: boolean;
}

interface SuggestionRequest {
  projectSlug: string;
  projectName: string;
  projectDescription?: string;
  moveSettings?: MoveSettings;
  existingTasks?: ExistingTask[];
  dismissedSuggestions?: string[];
  previouslyAddedTitles?: string[];
  focusTopic?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const openai = new OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY') });
    const { 
      projectSlug, 
      projectName, 
      projectDescription, 
      moveSettings,
      existingTasks = [],
      dismissedSuggestions = [],
      previouslyAddedTitles = [],
      focusTopic
    } = await req.json() as SuggestionRequest;

    // Build context about what's already done/dismissed
    const existingContext = existingTasks.length > 0 
      ? `\n\nALREADY HANDLED (do not suggest these or similar):\n${existingTasks.map(t => `- ${t.title}${t.completed ? ' ✓ DONE' : ''}${t.notes ? ` (notes: ${t.notes.substring(0, 100)})` : ''}`).join('\n')}`
      : '';
    
    const dismissedContext = dismissedSuggestions.length > 0
      ? `\n\nDISMISSED (user said not relevant, never suggest):\n${dismissedSuggestions.map(s => `- ${s}`).join('\n')}`
      : '';

    const addedContext = previouslyAddedTitles.length > 0
      ? `\n\nPREVIOUSLY ADDED AS TASKS (don't repeat):\n${previouslyAddedTitles.map(t => `- ${t}`).join('\n')}`
      : '';

    const contextBlock = existingContext + dismissedContext + addedContext;

    // Tone instruction for all projects
    const toneInstruction = `
TONE: Be a calm, supportive friend. Write like you're helping someone who's doing this for the first time.
- Reassuring, not alarming
- Concise, not overwhelming  
- Practical, not preachy
- Frame as "things people often forget" not "you must do this"
- If something is partially covered by existing tasks, say "You've started this — here's what people usually miss next."`;

    let systemPrompt = `You are a calm, supportive task advisor helping someone stay on top of their project without stress.

${toneInstruction}

Generate 5-8 practical suggestions that the user hasn't already covered.

Each suggestion MUST be a JSON object with these exact fields:
- id: unique string (use format "sug_" + random 6 chars)
- title: clear, friendly action title (max 60 chars)
- whyItMatters: one reassuring sentence explaining why this helps
- priority: "Must" or "Should" or "Nice"  
- suggestedDueWeek: number (weeks from now, 1-12)
- steps: array of 3-5 bullet point strings (actionable, specific steps)

CRITICAL: Check the "ALREADY HANDLED", "DISMISSED", and "PREVIOUSLY ADDED" lists carefully. Do NOT suggest anything that duplicates or overlaps with those items.`;

    let userPrompt = `Generate suggestions for project: "${projectName}"
Description: ${projectDescription || 'No description'}${contextBlock}`;

    // Topic focus instructions
    const topicDescriptions: Record<string, string> = {
      housing: 'finding and securing accommodation - rentals, flatshares, temporary housing, tenancy agreements, deposits, utilities setup',
      visa: 'visa applications, immigration requirements, work permits, right to work checks, passport validity, entry requirements',
      jobs: 'job searching, CV/resume adaptation, interviews, work culture, networking, LinkedIn optimization, recruitment agencies',
      banking: 'opening bank accounts, transferring money internationally, credit history, tax registration, National Insurance',
      social: 'making friends, finding communities, local groups, expat meetups, hobbies, dating, building a social circle',
      travel: 'flights, luggage, shipping belongings, travel insurance, airport logistics, first days planning',
      admin: 'address registration, government IDs, driver\'s license conversion, paperwork, official documents',
      health: 'healthcare registration, NHS, private insurance, prescriptions, finding doctors, mental health support',
    };

    // Special handling for Moving Abroad / Move to UK project
    if ((projectSlug === 'moving-abroad' || projectSlug === 'move-to-uk') && moveSettings) {
      const topicFocusInstruction = focusTopic && topicDescriptions[focusTopic]
        ? `\n\nFOCUS AREA: The user wants suggestions specifically about ${focusTopic.toUpperCase()}: ${topicDescriptions[focusTopic]}. Generate ALL suggestions in this area only. Go deep into specifics and nuances - things people don't think about.`
        : '';

      systemPrompt = `You are a calm, experienced friend who has helped many people relocate internationally. You're checking for gaps so nothing important slips through.

${toneInstruction}

Generate a week-by-week task plan focusing on things people often forget when moving abroad, especially if they haven't lived out of home before.
${topicFocusInstruction}

Each suggestion MUST be a JSON object with these exact fields:
- id: unique string (use format "sug_" + random 6 chars)
- title: clear, friendly action title (max 60 chars)
- whyItMatters: one reassuring sentence (mention the simplest/cheapest approach if relevant)
- priority: "Must" or "Should" or "Nice"
- suggestedDueWeek: number (weeks from now, 1-12)
- steps: array of 3-5 bullet point strings (specific, actionable, include links if helpful)
- category: one of "housing", "banking", "visa", "jobs", "social", "travel", "admin", "health"

${focusTopic ? `Since the user selected "${focusTopic}", generate 6-10 suggestions ALL focused on that specific topic. Be specific and detailed - cover edge cases and lesser-known tips.` : `Focus on:
- Housing, banking, SIM cards
- Taxes, National Insurance, admin docs
- Insurance, travel logistics
- Include the SIMPLEST and CHEAPEST approach
- Consider their work type for tax/visa implications`}

CRITICAL: Check the "ALREADY HANDLED", "DISMISSED", and "PREVIOUSLY ADDED" lists carefully. Do NOT suggest anything that duplicates or overlaps with those items. If the user has started something, frame your suggestion as the logical next step.`;

      userPrompt = `Generate a week-by-week relocation plan:
- Moving from: Australia
- Stopover: ${moveSettings.stopover}${moveSettings.stopoverDuration ? ` (${moveSettings.stopoverDuration})` : ''}
- Final destination: ${moveSettings.target}
- ${moveSettings.departureDate ? `Departure date: ${moveSettings.departureDate}` : `Weeks remaining: ${moveSettings.weeksRemaining || 12}`}
- Work type: ${moveSettings.workType}
- Budget sensitivity: ${moveSettings.budgetSensitivity}
${focusTopic ? `- FOCUS TOPIC: ${focusTopic}` : ''}
${contextBlock}

Generate 6-10 practical suggestions${focusTopic ? ` specifically about ${focusTopic}` : ' covering gaps in the above areas'}. Only suggest things not already covered.`;
    }

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 2000,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt + '\n\nRespond with JSON: { "suggestions": [...] }' }
      ]
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No response from AI');
    }

    const parsed = JSON.parse(content);
    
    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    console.error('Error generating suggestions:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to generate suggestions';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
