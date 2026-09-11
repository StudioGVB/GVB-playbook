import { useMemo } from 'react';
import { Task } from '@/hooks/useAppData';
import { loadMoveSettings } from './MoveSettings';
import { differenceInWeeks, differenceInDays, parseISO, isAfter, isBefore, addDays, startOfDay } from 'date-fns';
import { Calendar, AlertCircle, Clock } from 'lucide-react';

const MOVE_PROJECT_ID = '1';

interface MoveCountdownProps {
  tasks: Task[];
}

export default function MoveCountdown({ tasks }: MoveCountdownProps) {
  const settings = loadMoveSettings();
  
  const countdown = useMemo(() => {
    if (!settings.departureDate) {
      return { type: 'no-date' as const };
    }
    
    const departure = parseISO(settings.departureDate);
    const today = startOfDay(new Date());
    
    if (isBefore(departure, today)) {
      return { type: 'past' as const };
    }
    
    const weeks = differenceInWeeks(departure, today);
    const days = differenceInDays(departure, today);
    
    return {
      type: 'future' as const,
      weeks,
      days,
      daysRemainder: days % 7,
    };
  }, [settings.departureDate]);

  const keyDeadlines = useMemo(() => {
    const today = startOfDay(new Date());
    const nextWeek = addDays(today, 7);
    
    return tasks
      .filter(t => {
        if (t.completed || !t.deadline || t.priority !== 'high') return false;
        const deadline = parseISO(t.deadline);
        return isBefore(deadline, nextWeek) || isAfter(deadline, today);
      })
      .filter(t => {
        const deadline = parseISO(t.deadline!);
        return !isBefore(deadline, today) && isBefore(deadline, nextWeek);
      })
      .sort((a, b) => parseISO(a.deadline!).getTime() - parseISO(b.deadline!).getTime())
      .slice(0, 2);
  }, [tasks]);

  return (
    <div className="grid grid-cols-2 gap-4">
      {/* Weeks until departure */}
      <div className="metric-card project-moving-abroad-border">
        <div className="flex items-center gap-2 mb-2">
          <Calendar className="h-4 w-4 text-[hsl(var(--project-moving-abroad))]" />
          <p className="section-header mb-0">Departure</p>
        </div>
        
        {countdown.type === 'no-date' && (
          <div>
            <p className="text-lg font-medium text-muted-foreground">No date set</p>
            <p className="text-xs text-muted-foreground mt-1">Set departure date in Move Settings</p>
          </div>
        )}
        
        {countdown.type === 'past' && (
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-[hsl(var(--priority-high))] mt-0.5" />
            <div>
              <p className="text-lg font-medium text-[hsl(var(--priority-high))]">Departure date passed</p>
              <p className="text-xs text-muted-foreground mt-1">Update in Move Settings</p>
            </div>
          </div>
        )}
        
        {countdown.type === 'future' && (
          <div>
            <p className="text-3xl font-bold text-[hsl(var(--project-moving-abroad))]">
              {countdown.weeks} <span className="text-lg font-normal">weeks</span>
            </p>
            {countdown.daysRemainder > 0 && (
              <p className="text-sm text-muted-foreground">
                + {countdown.daysRemainder} days ({countdown.days} days total)
              </p>
            )}
          </div>
        )}
      </div>

      {/* Key deadlines this week */}
      <div className="metric-card project-moving-abroad-border">
        <div className="flex items-center gap-2 mb-2">
          <Clock className="h-4 w-4 text-[hsl(var(--project-moving-abroad))]" />
          <p className="section-header mb-0">Must-do this week</p>
        </div>
        
        {keyDeadlines.length === 0 ? (
          <p className="text-sm text-muted-foreground">No urgent deadlines 🎉</p>
        ) : (
          <ul className="space-y-2">
            {keyDeadlines.map(task => (
              <li key={task.id} className="text-sm">
                <span className="font-medium">{task.title}</span>
                {task.deadline && (
                  <span className="text-xs text-muted-foreground ml-2">
                    {differenceInDays(parseISO(task.deadline), new Date()) === 0 
                      ? 'Today' 
                      : `${differenceInDays(parseISO(task.deadline), new Date())}d`
                    }
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}