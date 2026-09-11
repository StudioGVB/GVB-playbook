import { useState, useEffect } from 'react';
import { Task, Section } from '@/hooks/useAppData';
import { Tag, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';

interface SuggestCategoryResponse {
  suggestedSection: string | null;
  confidence?: 'high' | 'medium' | 'low';
  error?: string;
}

// Cache for AI suggestions to avoid repeated API calls
const suggestionCache = new Map<string, { sectionName: string | null; confidence?: string }>();

interface SuggestedSectionTagProps {
  task: Task;
  sections: Section[];
  onAssignSection: (taskId: string, sectionId: string) => void;
}

export default function SuggestedSectionTag({ 
  task, 
  sections, 
  onAssignSection
}: SuggestedSectionTagProps) {
  const [suggestedSection, setSuggestedSection] = useState<Section | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [confidence, setConfidence] = useState<string | undefined>();

  useEffect(() => {
    const fetchSuggestion = async () => {
      // Check cache first
      const cacheKey = `${task.id}-${sections.map(s => s.id).join(',')}`;
      const cached = suggestionCache.get(cacheKey);
      
      if (cached !== undefined) {
        if (cached.sectionName) {
          const section = sections.find(s => s.name === cached.sectionName);
          setSuggestedSection(section || null);
          setConfidence(cached.confidence);
        }
        return;
      }

      if (sections.length === 0) {
        suggestionCache.set(cacheKey, { sectionName: null });
        return;
      }

      setIsLoading(true);
      try {
        const { data, error } = await supabase.functions.invoke('suggest-category', {
          body: {
            taskTitle: task.title,
            taskNotes: task.notes,
            sectionNames: sections.map(s => s.name)
          }
        });

        if (error) {
          console.error('Error fetching suggestion:', error);
          suggestionCache.set(cacheKey, { sectionName: null });
          return;
        }

        const response = data as SuggestCategoryResponse;
        
        if (response.suggestedSection) {
          const section = sections.find(
            s => s.name.toLowerCase() === response.suggestedSection!.toLowerCase()
          );
          setSuggestedSection(section || null);
          setConfidence(response.confidence);
          suggestionCache.set(cacheKey, { 
            sectionName: section?.name || null, 
            confidence: response.confidence 
          });
        } else {
          suggestionCache.set(cacheKey, { sectionName: null });
        }
      } catch (error) {
        console.error('Error fetching suggestion:', error);
        suggestionCache.set(cacheKey, { sectionName: null });
      } finally {
        setIsLoading(false);
      }
    };

    fetchSuggestion();
  }, [task.id, task.title, task.notes, sections]);

  if (isLoading) {
    return (
      <Badge variant="outline" className="text-xs gap-1 py-0.5 opacity-50">
        <Loader2 className="h-2.5 w-2.5 animate-spin" />
        Thinking...
      </Badge>
    );
  }

  if (!suggestedSection) return null;
  
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onAssignSection(task.id, suggestedSection.id);
  };

  const confidenceColor = confidence === 'high' 
    ? 'border-green-500/50 hover:border-green-500' 
    : confidence === 'medium'
    ? 'border-yellow-500/50 hover:border-yellow-500'
    : '';
  
  return (
    <Badge
      variant="outline"
      className={`text-xs cursor-pointer hover:bg-primary/10 transition-colors gap-1 py-0.5 ${confidenceColor}`}
      onClick={handleClick}
      title={`Add to ${suggestedSection.name}${confidence ? ` (${confidence} confidence)` : ''}`}
    >
      <Tag className="h-2.5 w-2.5" />
      {suggestedSection.name}
    </Badge>
  );
}
