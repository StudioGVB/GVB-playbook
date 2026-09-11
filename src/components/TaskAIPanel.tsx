import { useState, useEffect } from 'react';
import { Sparkles, Loader2, RefreshCw, Clock, AlertTriangle, Lightbulb, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Task, Project } from '@/hooks/useAppData';
import { supabase } from '@/integrations/supabase/client';
import { formatDistanceToNow } from 'date-fns';

interface TaskBreakdown {
  overview: string;
  steps: string[];
  timeEstimate: string;
  complexity: 'Low' | 'Medium' | 'High';
  pitfalls: string[];
  tips: string | null;
}

interface CachedBreakdown {
  breakdown: TaskBreakdown;
  timestamp: number;
  taskId: string;
  taskUpdatedAt?: string;
}

const CACHE_KEY_PREFIX = 'task-ai-breakdown-';
const CACHE_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days

function getCachedBreakdown(taskId: string): CachedBreakdown | null {
  try {
    const cached = localStorage.getItem(CACHE_KEY_PREFIX + taskId);
    if (cached) {
      const parsed: CachedBreakdown = JSON.parse(cached);
      if (Date.now() - parsed.timestamp < CACHE_DURATION && parsed.taskId === taskId) {
        return parsed;
      }
    }
  } catch (e) {
    console.error('Failed to load cached breakdown:', e);
  }
  return null;
}

function setCachedBreakdown(taskId: string, breakdown: TaskBreakdown): void {
  try {
    const cache: CachedBreakdown = {
      breakdown,
      timestamp: Date.now(),
      taskId,
    };
    localStorage.setItem(CACHE_KEY_PREFIX + taskId, JSON.stringify(cache));
  } catch (e) {
    console.error('Failed to cache breakdown:', e);
  }
}

interface TaskAIPanelProps {
  task: Task;
  project: Project;
  isExpanded: boolean;
  onToggle: () => void;
}

export default function TaskAIPanel({ task, project, isExpanded, onToggle }: TaskAIPanelProps) {
  const [breakdown, setBreakdown] = useState<TaskBreakdown | null>(null);
  const [cachedAt, setCachedAt] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);

  const isMoveProject = project.has_move_ai;

  // Load cached breakdown immediately when component mounts
  useEffect(() => {
    const cached = getCachedBreakdown(task.id);
    if (cached) {
      setBreakdown(cached.breakdown);
      setCachedAt(cached.timestamp);
      setHasLoaded(true);
    }
  }, [task.id]);

  const generateBreakdown = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke('task-breakdown', {
        body: {
          taskTitle: task.title,
          taskNotes: task.notes,
          projectName: project.name,
          projectDescription: project.description,
          isMoveProject,
        },
      });

      if (fnError) throw fnError;
      if (data.error) throw new Error(data.error);

      const newBreakdown = data.breakdown;
      setBreakdown(newBreakdown);
      setCachedBreakdown(task.id, newBreakdown);
      setCachedAt(Date.now());
      setHasLoaded(true);
    } catch (err: any) {
      console.error('Failed to generate breakdown:', err);
      setError(err.message || 'Failed to generate breakdown');
    } finally {
      setIsLoading(false);
    }
  };

  const getComplexityColor = (complexity: string) => {
    switch (complexity) {
      case 'Low': return 'text-[hsl(var(--project-back-pocket-games))]';
      case 'Medium': return 'text-[hsl(var(--project-travel-app))]';
      case 'High': return 'text-[hsl(var(--priority-high))]';
      default: return 'text-muted-foreground';
    }
  };

  // If not expanded, show a minimal collapsed view
  if (!isExpanded) {
    // Don't show anything if there's no cached breakdown
    if (!breakdown) return null;
    
    // Show collapsed indicator that content is cached
    return (
      <div 
        className="mt-2 p-3 rounded-lg bg-gradient-to-r from-[hsl(var(--project-studio-gvb)/0.05)] to-[hsl(var(--project-pip)/0.03)] border border-[hsl(var(--project-studio-gvb)/0.15)] cursor-pointer hover:border-[hsl(var(--project-studio-gvb)/0.3)] transition-colors"
        onClick={onToggle}
      >
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <Sparkles className="h-3 w-3 text-[hsl(var(--project-studio-gvb))]" />
            <span>AI breakdown saved</span>
            {cachedAt && (
              <span className="text-xs opacity-70">
                ({formatDistanceToNow(cachedAt, { addSuffix: true })})
              </span>
            )}
          </div>
          <ChevronDown className="h-4 w-4" />
        </div>
      </div>
    );
  }

  return (
    <div className="mt-2 p-4 rounded-lg bg-gradient-to-r from-[hsl(var(--project-studio-gvb)/0.08)] to-[hsl(var(--project-pip)/0.05)] border border-[hsl(var(--project-studio-gvb)/0.2)]">
      {/* Collapse button at top */}
      {breakdown && (
        <button 
          onClick={onToggle}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-3 transition-colors"
        >
          <ChevronUp className="h-3 w-3" />
          Minimise
        </button>
      )}

      {!breakdown && !isLoading && !error && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Get a friendly breakdown to complete this task confidently.
          </p>
          <Button
            size="sm"
            onClick={generateBreakdown}
            className="bg-[hsl(var(--project-studio-gvb))] hover:bg-[hsl(340_100%_78%)] text-[hsl(340_70%_25%)] gap-2"
          >
            <Sparkles className="h-4 w-4" />
            Get Help
          </Button>
        </div>
      )}

      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Thinking...
        </div>
      )}

      {error && (
        <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
          {error}
          <Button
            variant="link"
            size="sm"
            onClick={generateBreakdown}
            className="ml-2 text-destructive"
          >
            Try again
          </Button>
        </div>
      )}

      {breakdown && (
        <div className="space-y-4">
          {/* Header with refresh + cached indicator */}
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <p className="text-sm font-medium text-foreground">{breakdown.overview}</p>
            </div>
            <div className="flex items-center gap-2">
              {cachedAt && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-[hsl(var(--project-back-pocket-games))]" />
                  Cached {formatDistanceToNow(cachedAt, { addSuffix: true })}
                </span>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={generateBreakdown}
                disabled={isLoading}
                className="text-[hsl(var(--project-studio-gvb))] hover:text-[hsl(var(--project-studio-gvb))] hover:bg-[hsl(var(--project-studio-gvb)/0.1)] gap-1"
              >
                <RefreshCw className={`h-3 w-3 ${isLoading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            </div>
          </div>

          {/* Meta info row */}
          <div className="flex items-center gap-4 text-xs">
            <div className="flex items-center gap-1">
              <Clock className="h-3 w-3 text-muted-foreground" />
              <span className="text-muted-foreground">{breakdown.timeEstimate}</span>
            </div>
            <div className={`font-medium ${getComplexityColor(breakdown.complexity)}`}>
              {breakdown.complexity} complexity
            </div>
          </div>

          {/* Steps */}
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">Steps:</p>
            <ul className="space-y-1.5">
              {breakdown.steps.map((step, i) => (
                <li key={i} className="text-sm flex items-start gap-2">
                  <span className="text-[hsl(var(--project-pip))] font-medium">{i + 1}.</span>
                  <span>{step}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Pitfalls */}
          {breakdown.pitfalls.length > 0 && (
            <div className="p-3 rounded-md bg-[hsl(var(--project-travel-app)/0.08)] border border-[hsl(var(--project-travel-app)/0.2)]">
              <div className="flex items-center gap-1.5 text-xs font-medium text-[hsl(40_90%_35%)] mb-2">
                <AlertTriangle className="h-3 w-3" />
                Don't forget:
              </div>
              <ul className="space-y-1">
                {breakdown.pitfalls.map((pitfall, i) => (
                  <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                    <span>•</span>
                    <span>{pitfall}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Tip */}
          {breakdown.tips && (
            <div className="p-3 rounded-md bg-[hsl(var(--project-back-pocket-games)/0.08)] border border-[hsl(var(--project-back-pocket-games)/0.2)]">
              <div className="flex items-center gap-1.5 text-xs font-medium text-[hsl(var(--project-back-pocket-games))] mb-1">
                <Lightbulb className="h-3 w-3" />
                Pro tip:
              </div>
              <p className="text-sm text-muted-foreground">{breakdown.tips}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}