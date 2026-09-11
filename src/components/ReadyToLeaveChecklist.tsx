import { useState, useMemo } from 'react';
import { Task } from '@/hooks/useAppData';
import { CheckCircle2, Circle, ChevronDown, ChevronRight } from 'lucide-react';
import { Progress } from '@/components/ui/progress';

// Move categories with keywords for auto-assignment
const MOVE_CATEGORIES = [
  { 
    id: 'documents', 
    label: 'Documents',
    keywords: ['passport', 'visa', 'document', 'certificate', 'license', 'permit', 'id card', 'birth', 'marriage', 'apostille', 'notary', 'translation']
  },
  { 
    id: 'money', 
    label: 'Money & Banking',
    keywords: ['bank', 'account', 'money', 'transfer', 'wise', 'revolut', 'credit', 'debit', 'card', 'currency', 'exchange', 'tax', 'pension', 'savings']
  },
  { 
    id: 'housing', 
    label: 'Housing',
    keywords: ['housing', 'apartment', 'flat', 'rent', 'landlord', 'deposit', 'utilities', 'electricity', 'gas', 'water', 'internet', 'furniture', 'move', 'storage']
  },
  { 
    id: 'health', 
    label: 'Health',
    keywords: ['health', 'doctor', 'gp', 'nhs', 'dentist', 'prescription', 'medication', 'vaccine', 'insurance', 'medical', 'records', 'pharmacy']
  },
  { 
    id: 'tech', 
    label: 'Tech & SIM',
    keywords: ['phone', 'sim', 'mobile', 'number', 'provider', 'contract', 'laptop', 'device', 'charger', 'adapter', 'plug']
  },
  { 
    id: 'work', 
    label: 'Work / Admin',
    keywords: ['work', 'job', 'employment', 'ni number', 'national insurance', 'utr', 'hmrc', 'self-employed', 'freelance', 'client', 'invoice', 'company', 'business', 'register', 'address']
  },
  { 
    id: 'travel', 
    label: 'Travel Logistics',
    keywords: ['flight', 'train', 'travel', 'luggage', 'bag', 'suitcase', 'shipping', 'pack', 'booking', 'ticket', 'airport', 'transport']
  },
];

function categorizeTask(task: Task): string {
  const searchText = `${task.title} ${task.notes || ''}`.toLowerCase();
  
  for (const category of MOVE_CATEGORIES) {
    for (const keyword of category.keywords) {
      if (searchText.includes(keyword)) {
        return category.id;
      }
    }
  }
  
  return 'other';
}

interface ReadyToLeaveChecklistProps {
  tasks: Task[];
}

export default function ReadyToLeaveChecklist({ tasks }: ReadyToLeaveChecklistProps) {
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

  const categorizedTasks = useMemo(() => {
    const result: Record<string, Task[]> = {};
    
    // Initialize all categories
    MOVE_CATEGORIES.forEach(cat => {
      result[cat.id] = [];
    });
    result['other'] = [];
    
    // Categorize each task
    tasks.forEach(task => {
      const category = categorizeTask(task);
      result[category].push(task);
    });
    
    return result;
  }, [tasks]);

  const stats = useMemo(() => {
    let totalTasks = 0;
    let completedTasks = 0;
    
    const categoryStats = MOVE_CATEGORIES.map(cat => {
      const catTasks = categorizedTasks[cat.id] || [];
      const completed = catTasks.filter(t => t.completed).length;
      totalTasks += catTasks.length;
      completedTasks += completed;
      
      return {
        ...cat,
        total: catTasks.length,
        completed,
        progress: catTasks.length > 0 ? Math.round((completed / catTasks.length) * 100) : 0,
      };
    });
    
    return {
      categories: categoryStats.filter(c => c.total > 0), // Only show categories with tasks
      total: totalTasks,
      completed: completedTasks,
      overallProgress: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
    };
  }, [categorizedTasks]);

  if (stats.total === 0) {
    return (
      <div className="metric-card">
        <p className="section-header">Ready to Leave</p>
        <p className="text-sm text-muted-foreground">
          Add some move-related tasks to see your departure readiness.
        </p>
      </div>
    );
  }

  return (
    <div className="metric-card">
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="section-header mb-0">Ready to Leave</p>
          <p className="text-sm text-muted-foreground mt-1">
            {stats.completed}/{stats.total} tasks done
          </p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-[hsl(var(--project-moving-abroad))]">
            {stats.overallProgress}%
          </p>
        </div>
      </div>

      <Progress value={stats.overallProgress} className="h-2 mb-6" />

      <div className="space-y-2">
        {stats.categories.map(category => {
          const isExpanded = expandedCategory === category.id;
          const categoryTasks = categorizedTasks[category.id] || [];
          
          return (
            <div key={category.id} className="border border-border rounded-lg overflow-hidden">
              <button
                onClick={() => setExpandedCategory(isExpanded ? null : category.id)}
                className="w-full p-3 flex items-center justify-between hover:bg-secondary/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="font-medium text-sm">{category.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {category.completed}/{category.total}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <Progress value={category.progress} className="w-20 h-1.5" />
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>
              </button>
              
              {isExpanded && categoryTasks.length > 0 && (
                <div className="border-t border-border bg-secondary/20 p-3 space-y-2">
                  {categoryTasks.map(task => (
                    <div key={task.id} className="flex items-center gap-2 text-sm">
                      {task.completed ? (
                        <CheckCircle2 className="h-4 w-4 text-[hsl(var(--project-back-pocket-games))]" />
                      ) : (
                        <Circle className="h-4 w-4 text-muted-foreground" />
                      )}
                      <span className={task.completed ? 'line-through text-muted-foreground' : ''}>
                        {task.title}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}