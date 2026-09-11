import { useState, useEffect } from 'react';
import { Sparkles, Loader2, Check, ExternalLink, RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Project, Task } from '@/hooks/useAppData';
import { supabase } from '@/integrations/supabase/client';
import MoveSettings, { loadMoveSettings, MoveSettingsData } from './MoveSettings';
import { addWeeks, format } from 'date-fns';
import { Link } from 'react-router-dom';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const MOVE_PROJECT_ID = '1';

const TOPIC_OPTIONS = [
  { value: 'all', label: 'All Topics' },
  { value: 'housing', label: 'Housing' },
  { value: 'visa', label: 'Visa & Immigration' },
  { value: 'jobs', label: 'Jobs & Work' },
  { value: 'banking', label: 'Banking & Money' },
  { value: 'social', label: 'Social & Community' },
  { value: 'travel', label: 'Travel & Logistics' },
  { value: 'admin', label: 'Admin & Documents' },
  { value: 'health', label: 'Health & Insurance' },
] as const;
const generateId = () => Date.now().toString(36) + Math.random().toString(36).substr(2);

interface Suggestion {
  id: string;
  title: string;
  whyItMatters: string;
  priority: 'Must' | 'Should' | 'Nice';
  suggestedDueWeek: number;
  steps: string[];
  category?: string;
}

interface CachedSuggestions {
  suggestions: Suggestion[];
  timestamp: number;
  projectSlug: string;
}

const CACHE_KEY_PREFIX = 'ai-suggestions-';
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours
const DISMISSED_KEY_PREFIX = 'ai-dismissed-';
const ADDED_TASKS_KEY = 'ai-suggestions-added-';

function getCachedSuggestions(projectSlug: string): Suggestion[] | null {
  try {
    const cached = localStorage.getItem(CACHE_KEY_PREFIX + projectSlug);
    if (cached) {
      const parsed: CachedSuggestions = JSON.parse(cached);
      if (Date.now() - parsed.timestamp < CACHE_DURATION && parsed.projectSlug === projectSlug) {
        return parsed.suggestions;
      }
    }
  } catch (e) {
    console.error('Failed to load cached suggestions:', e);
  }
  return null;
}

function setCachedSuggestions(projectSlug: string, suggestions: Suggestion[]): void {
  try {
    const cache: CachedSuggestions = {
      suggestions,
      timestamp: Date.now(),
      projectSlug,
    };
    localStorage.setItem(CACHE_KEY_PREFIX + projectSlug, JSON.stringify(cache));
  } catch (e) {
    console.error('Failed to cache suggestions:', e);
  }
}

interface AddedTask {
  suggestionId: string;
  taskId: string;
  title: string;
}

function getAddedTasks(projectSlug: string): AddedTask[] {
  try {
    const stored = localStorage.getItem(ADDED_TASKS_KEY + projectSlug);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.error('Failed to load added tasks:', e);
  }
  return [];
}

function saveAddedTask(projectSlug: string, suggestionId: string, taskId: string, title: string): void {
  try {
    const existing = getAddedTasks(projectSlug);
    existing.push({ suggestionId, taskId, title });
    localStorage.setItem(ADDED_TASKS_KEY + projectSlug, JSON.stringify(existing));
  } catch (e) {
    console.error('Failed to save added task:', e);
  }
}

// Dismissed suggestions persistence
function getDismissedSuggestions(projectSlug: string): string[] {
  try {
    const stored = localStorage.getItem(DISMISSED_KEY_PREFIX + projectSlug);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.error('Failed to load dismissed suggestions:', e);
  }
  return [];
}

function saveDismissedSuggestion(projectSlug: string, title: string): void {
  try {
    const existing = getDismissedSuggestions(projectSlug);
    if (!existing.includes(title)) {
      existing.push(title);
      localStorage.setItem(DISMISSED_KEY_PREFIX + projectSlug, JSON.stringify(existing));
    }
  } catch (e) {
    console.error('Failed to save dismissed suggestion:', e);
  }
}

interface AISuggestionsProps {
  project: Project;
  onAddTask: (task: { title: string; project_id: string; priority: string; deadline?: string; notes?: string; section_id?: string }) => void;
}

export default function AISuggestions({ project, onAddTask }: AISuggestionsProps) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addedTasks, setAddedTasks] = useState<AddedTask[]>([]);
  const [dismissedTitles, setDismissedTitles] = useState<string[]>([]);
  const [moveSettings, setMoveSettings] = useState<MoveSettingsData>(loadMoveSettings);
  const [selectedTopic, setSelectedTopic] = useState<string>('all');

  const isMovingAbroad = project.id === MOVE_PROJECT_ID || project.has_move_ai;

  useEffect(() => {
    // Load cached suggestions (filter out dismissed ones)
    const dismissed = getDismissedSuggestions(project.slug);
    setDismissedTitles(dismissed);
    
    const cached = getCachedSuggestions(project.slug);
    if (cached) {
      // Filter out any suggestions that have been dismissed
      const filtered = cached.filter(s => !dismissed.includes(s.title));
      setSuggestions(filtered);
    }
    setAddedTasks(getAddedTasks(project.slug));
  }, [project.slug]);

  const generateSuggestions = async (forceRefresh = false) => {
    if (!forceRefresh && suggestions.length > 0) return;
    
    setIsLoading(true);
    setError(null);

    try {
      // We'll pass empty arrays since we don't have access to loadData anymore
      const existingTasks: { title: string; notes: string | null; completed: boolean }[] = [];

      // Get previously added suggestion titles
      const previouslyAdded = getAddedTasks(project.slug);
      const previouslyAddedTitles = previouslyAdded.map(a => a.title);

      // Get dismissed suggestions
      const dismissed = getDismissedSuggestions(project.slug);

      const { data, error: fnError } = await supabase.functions.invoke('generate-suggestions', {
        body: {
          projectSlug: project.slug,
          projectName: project.name,
          projectDescription: project.description,
          moveSettings: isMovingAbroad ? moveSettings : undefined,
          existingTasks,
          dismissedSuggestions: dismissed,
          previouslyAddedTitles,
          focusTopic: selectedTopic !== 'all' ? selectedTopic : undefined,
        },
      });

      if (fnError) throw fnError;
      if (data.error) throw new Error(data.error);

      const newSuggestions = data.suggestions || [];
      // Filter out any that match dismissed titles (extra safety)
      const filtered = newSuggestions.filter((s: Suggestion) => !dismissed.includes(s.title));
      
      setSuggestions(filtered);
      setCachedSuggestions(project.slug, filtered);
    } catch (err: any) {
      console.error('Failed to generate suggestions:', err);
      setError(err.message || 'Failed to generate suggestions');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDismiss = (suggestion: Suggestion) => {
    // Save to localStorage so it never appears again
    saveDismissedSuggestion(project.slug, suggestion.title);
    setDismissedTitles(prev => [...prev, suggestion.title]);
    
    // Remove from current list
    const updated = suggestions.filter(s => s.id !== suggestion.id);
    setSuggestions(updated);
    
    // Update cache
    setCachedSuggestions(project.slug, updated);
  };

  const handleAddTask = (suggestion: Suggestion) => {
    const baseDate = new Date();
    const dueDate = addWeeks(baseDate, suggestion.suggestedDueWeek);
    
    // Create checklist-style notes from steps
    const checklistNotes = [
      `Why: ${suggestion.whyItMatters}`,
      '',
      'Steps:',
      ...suggestion.steps.map(step => `☐ ${step}`),
    ].join('\n');

    const taskData = {
      title: suggestion.title,
      project_id: project.id,
      priority: suggestion.priority === 'Must' ? 'high' : suggestion.priority === 'Should' ? 'medium' : 'low',
      deadline: format(dueDate, 'yyyy-MM-dd'),
      notes: checklistNotes,
    };

    onAddTask(taskData);
    const taskId = generateId();
    saveAddedTask(project.slug, suggestion.id, taskId, suggestion.title);
    setAddedTasks(prev => [...prev, { suggestionId: suggestion.id, taskId, title: suggestion.title }]);
  };

  const isAdded = (suggestionId: string) => addedTasks.some(t => t.suggestionId === suggestionId);
  const getTaskId = (suggestionId: string) => addedTasks.find(t => t.suggestionId === suggestionId)?.taskId;

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'Must': return 'bg-[hsl(var(--project-moving-abroad)/0.15)] text-[hsl(var(--project-moving-abroad))]';
      case 'Should': return 'bg-[hsl(var(--project-travel-app)/0.15)] text-[hsl(var(--project-travel-app))]';
      default: return 'bg-[hsl(var(--project-pip)/0.15)] text-[hsl(var(--project-pip))]';
    }
  };

  // Filter out dismissed suggestions from display
  const visibleSuggestions = suggestions.filter(s => !dismissedTitles.includes(s.title));

  return (
    <div className={`metric-card border-2 ${project.color_class}-border`}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-[hsl(var(--project-personal))]" />
          <p className="font-bold text-lg">AI Suggestions</p>
        </div>
        <div className="flex items-center gap-2">
          {isMovingAbroad && (
            <Select value={selectedTopic} onValueChange={setSelectedTopic}>
              <SelectTrigger className="w-[160px] h-9">
                <SelectValue placeholder="Focus on..." />
              </SelectTrigger>
              <SelectContent>
                {TOPIC_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {visibleSuggestions.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => generateSuggestions(true)}
              disabled={isLoading}
              className="gap-2"
            >
              <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          )}
          {visibleSuggestions.length === 0 && (
            <Button
              onClick={() => generateSuggestions(false)}
              disabled={isLoading}
              className="bg-[hsl(var(--project-studio-gvb))] hover:bg-[hsl(340_100%_78%)] text-[hsl(340_70%_25%)] font-medium gap-2"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Checking...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Check for Gaps
                </>
              )}
            </Button>
          )}
        </div>
      </div>

      {/* MoveSettings is now shown in the project header area */}

      {/* Reassurance message */}
      {visibleSuggestions.length > 0 && (
        <p className="text-sm text-muted-foreground mb-4 italic">
          I'm checking for gaps so nothing important slips through.
        </p>
      )}

      {error && (
        <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm mb-4">
          {error}
        </div>
      )}

      {visibleSuggestions.length > 0 && (
        <div className="space-y-4">
          {visibleSuggestions.map(suggestion => {
            const added = isAdded(suggestion.id);
            const taskId = getTaskId(suggestion.id);
            
            return (
              <div
                key={suggestion.id}
                className={`p-4 rounded-lg border transition-all ${
                  added ? 'bg-[hsl(var(--project-back-pocket-games)/0.08)] border-[hsl(var(--project-back-pocket-games)/0.3)]' : 'bg-white border-border hover:border-[hsl(var(--project-personal)/0.5)]'
                }`}
              >
                <div className="flex items-start justify-between gap-4 mb-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="font-semibold">{suggestion.title}</h4>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${getPriorityColor(suggestion.priority)}`}>
                        {suggestion.priority}
                      </span>
                      {suggestion.category && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                          {suggestion.category}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground mb-2">{suggestion.whyItMatters}</p>
                    <p className="text-xs text-muted-foreground mb-3">
                      📅 Suggested: Week {suggestion.suggestedDueWeek}
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 items-end">
                    {added ? (
                      <>
                        <div className="flex items-center gap-1 text-[hsl(var(--project-back-pocket-games))] text-sm font-medium">
                          <Check className="h-4 w-4" />
                          Added
                        </div>
                        <Link
                          to="#"
                          onClick={(e) => {
                            e.preventDefault();
                            document.querySelector(`[data-task-id="${taskId}"]`)?.scrollIntoView({ behavior: 'smooth' });
                          }}
                          className="text-xs text-primary hover:underline flex items-center gap-1"
                        >
                          <ExternalLink className="h-3 w-3" />
                          View task
                        </Link>
                      </>
                    ) : (
                      <>
                        <Button
                          size="sm"
                          onClick={() => handleAddTask(suggestion)}
                          className="bg-[hsl(var(--project-pip))] hover:bg-[hsl(235_100%_68%)] text-white"
                        >
                          Add as task
                        </Button>
                        <button
                          onClick={() => handleDismiss(suggestion)}
                          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
                        >
                          <X className="h-3 w-3" />
                          Not relevant
                        </button>
                      </>
                    )}
                  </div>
                </div>
                
                <div className="bg-muted/50 rounded-md p-3">
                  <p className="text-xs font-medium text-muted-foreground mb-2">Steps:</p>
                  <ul className="space-y-1">
                    {suggestion.steps.map((step, i) => (
                      <li key={i} className="text-sm flex items-start gap-2">
                        <span className="text-muted-foreground">•</span>
                        {step}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!isLoading && visibleSuggestions.length === 0 && !error && (
        <p className="text-sm text-muted-foreground">
          Click "Check for Gaps" to find things you might have missed for this project.
        </p>
      )}
    </div>
  );
}
