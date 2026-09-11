import { useState, useMemo } from 'react';
import { Task, Project, getProjectById } from '@/hooks/useAppData';
import { 
  format, 
  startOfMonth, 
  endOfMonth, 
  eachDayOfInterval, 
  isSameMonth, 
  isSameDay, 
  addMonths, 
  subMonths, 
  parseISO, 
  startOfWeek, 
  endOfWeek, 
  isToday, 
  isBefore,
  addWeeks,
  subWeeks
} from 'date-fns';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, CalendarDays } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Checkbox } from '@/components/ui/checkbox';

interface TaskCalendarProps {
  tasks: Task[];
  projects: Project[];
  onTaskClick?: (task: Task) => void;
  onTaskToggle?: (taskId: string) => void;
}

type CalendarViewMode = 'month' | 'week';

// Get color from project - handles both preset classes and custom HSL
function getProjectColor(project: Project | undefined): string {
  if (!project) return '#6b7280';
  
  const colorClass = project.color_class;
  
  // Check if it's a preset class
  const presetMap: Record<string, string> = {
    'project-moving-abroad': '#4558ff',
    'project-pip': '#da60ff',
    'project-back-pocket-games': '#24af58',
    'project-studio-gvb': '#ffaded',
    'project-travel-app': '#ffb92c',
    'project-personal': '#6b7280',
  };
  
  if (presetMap[colorClass]) {
    return presetMap[colorClass];
  }
  
  // It's a custom HSL string - convert to hex
  const parts = colorClass.split(' ');
  if (parts.length >= 3) {
    const h = parseInt(parts[0]) / 360;
    const s = parseInt(parts[1]) / 100;
    const l = parseInt(parts[2]) / 100;
    
    let r, g, b;
    if (s === 0) {
      r = g = b = l;
    } else {
      const hue2rgb = (p: number, q: number, t: number) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1/6) return p + (q - p) * 6 * t;
        if (t < 1/2) return q;
        if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
        return p;
      };
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1/3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1/3);
    }
    
    const toHex = (x: number) => {
      const hex = Math.round(x * 255).toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    };
    
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }
  
  return '#6b7280';
}

// Get lighter background version of color
function getProjectBgColor(color: string, opacity: number = 0.15): string {
  // Convert hex to rgba
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(color);
  if (!result) return `rgba(107, 114, 128, ${opacity})`;
  
  const r = parseInt(result[1], 16);
  const g = parseInt(result[2], 16);
  const b = parseInt(result[3], 16);
  
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

export default function TaskCalendar({ tasks, projects, onTaskClick, onTaskToggle }: TaskCalendarProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [calendarView, setCalendarView] = useState<CalendarViewMode>('month');

  // Get unique projects that have tasks with dates for the legend
  const projectsWithTasks = useMemo(() => {
    const projectIds = new Set(tasks.filter(t => t.deadline).map(t => t.project_id));
    return projects.filter(p => projectIds.has(p.id));
  }, [tasks, projects]);

  // Get tasks with deadlines mapped to dates
  const tasksByDate = useMemo(() => {
    const map = new Map<string, Task[]>();
    tasks.forEach(task => {
      if (task.deadline) {
        const dateKey = task.deadline;
        if (!map.has(dateKey)) {
          map.set(dateKey, []);
        }
        map.get(dateKey)!.push(task);
      }
    });
    return map;
  }, [tasks]);

  // Get calendar days based on view mode
  const calendarDays = useMemo(() => {
    if (calendarView === 'week') {
      const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 });
      const weekEnd = endOfWeek(currentDate, { weekStartsOn: 1 });
      return eachDayOfInterval({ start: weekStart, end: weekEnd });
    } else {
      const monthStart = startOfMonth(currentDate);
      const monthEnd = endOfMonth(currentDate);
      const calStart = startOfWeek(monthStart, { weekStartsOn: 1 });
      const calEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
      return eachDayOfInterval({ start: calStart, end: calEnd });
    }
  }, [currentDate, calendarView]);

  // Get tasks for selected date
  const selectedDateTasks = useMemo(() => {
    if (!selectedDate) return [];
    const dateKey = format(selectedDate, 'yyyy-MM-dd');
    return tasksByDate.get(dateKey) || [];
  }, [selectedDate, tasksByDate]);

  // Get dominant project for a day (for background color)
  const getDominantProject = (dayTasks: Task[]) => {
    if (dayTasks.length === 0) return null;
    const pendingTasks = dayTasks.filter(t => !t.completed);
    if (pendingTasks.length === 0) return null;
    
    // Count tasks per project
    const projectCounts = new Map<string, number>();
    pendingTasks.forEach(t => {
      projectCounts.set(t.project_id, (projectCounts.get(t.project_id) || 0) + 1);
    });
    
    // Get project with most tasks
    let maxCount = 0;
    let dominantProjectId = pendingTasks[0].project_id;
    projectCounts.forEach((count, projectId) => {
      if (count > maxCount) {
        maxCount = count;
        dominantProjectId = projectId;
      }
    });
    
    return getProjectById(projects, dominantProjectId);
  };

  const goToPrev = () => {
    if (calendarView === 'week') {
      setCurrentDate(prev => subWeeks(prev, 1));
    } else {
      setCurrentDate(prev => subMonths(prev, 1));
    }
  };

  const goToNext = () => {
    if (calendarView === 'week') {
      setCurrentDate(prev => addWeeks(prev, 1));
    } else {
      setCurrentDate(prev => addMonths(prev, 1));
    }
  };

  const goToToday = () => {
    setCurrentDate(new Date());
    setSelectedDate(new Date());
  };

  const getDateLabel = () => {
    if (calendarView === 'week') {
      const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 });
      const weekEnd = endOfWeek(currentDate, { weekStartsOn: 1 });
      return `${format(weekStart, 'MMM d')} - ${format(weekEnd, 'MMM d, yyyy')}`;
    }
    return format(currentDate, 'MMMM yyyy');
  };

  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
      {/* Header */}
      <div className="p-4 border-b border-border bg-secondary/20">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-[hsl(var(--project-moving-abroad)/0.1)] rounded-lg">
              <CalendarIcon className="h-5 w-5 text-[hsl(var(--project-moving-abroad))]" />
            </div>
            <h2 className="text-lg font-semibold">Schedule</h2>
          </div>
          
          <div className="flex items-center gap-2">
            {/* View Mode Toggle */}
            <div className="flex rounded-lg border border-border bg-card p-0.5">
              <Button
                variant={calendarView === 'week' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-8 px-3 text-sm font-medium"
                onClick={() => setCalendarView('week')}
              >
                Week
              </Button>
              <Button
                variant={calendarView === 'month' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-8 px-3 text-sm font-medium"
                onClick={() => setCalendarView('month')}
              >
                Month
              </Button>
            </div>
          </div>
        </div>

        {/* Project Legend */}
        {projectsWithTasks.length > 0 && (
          <div className="flex flex-wrap gap-3">
            {projectsWithTasks.map(project => {
              const color = getProjectColor(project);
              return (
                <div key={project.id} className="flex items-center gap-1.5">
                  <div 
                    className="w-3 h-3 rounded"
                    style={{ backgroundColor: color }}
                  />
                  <span className="text-xs text-muted-foreground">{project.name}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between p-3 border-b border-border">
        <Button 
          variant="outline" 
          size="sm" 
          onClick={goToToday} 
          className="text-sm font-medium"
        >
          Today
        </Button>
        
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={goToPrev}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-semibold min-w-[160px] text-center">
            {getDateLabel()}
          </span>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={goToNext}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        
        <div className="w-[68px]" /> {/* Spacer for alignment */}
      </div>

      {/* Calendar Grid */}
      {calendarView === 'month' ? (
        <div className="p-3">
          {/* Day headers */}
          <div className="grid grid-cols-7 mb-2">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => (
              <div key={day} className="text-xs font-medium text-muted-foreground text-center py-2">
                {day}
              </div>
            ))}
          </div>

          {/* Calendar days - Monthly View */}
          <div className="grid grid-cols-7 gap-1">
            {calendarDays.map(day => {
              const dateKey = format(day, 'yyyy-MM-dd');
              const dayTasks = tasksByDate.get(dateKey) || [];
              const pendingTasks = dayTasks.filter(t => !t.completed);
              const isCurrentMonth = isSameMonth(day, currentDate);
              const isSelected = selectedDate && isSameDay(day, selectedDate);
              const isTodayDate = isToday(day);
              const dominantProject = getDominantProject(dayTasks);
              const dominantColor = dominantProject ? getProjectColor(dominantProject) : null;

              return (
                <button
                  key={dateKey}
                  onClick={() => setSelectedDate(day)}
                  className={cn(
                    "relative min-h-[80px] rounded-lg transition-all flex flex-col p-2",
                    isCurrentMonth ? "bg-secondary/30" : "bg-transparent opacity-40",
                    isSelected && "ring-2 ring-[hsl(var(--project-moving-abroad))]",
                    "hover:bg-secondary/50"
                  )}
                  style={dominantColor && isCurrentMonth ? { 
                    backgroundColor: getProjectBgColor(dominantColor, 0.2),
                    borderLeft: `3px solid ${dominantColor}`
                  } : undefined}
                >
                  <span className={cn(
                    "text-sm font-medium mb-1",
                    isTodayDate && "bg-[hsl(var(--project-moving-abroad))] text-white rounded-full w-6 h-6 flex items-center justify-center text-xs",
                    !isTodayDate && !isCurrentMonth && "text-muted-foreground"
                  )}>
                    {format(day, 'd')}
                  </span>
                  
                  {/* Task previews */}
                  {pendingTasks.length > 0 && (
                    <div className="flex flex-col gap-0.5 flex-1">
                      {pendingTasks.slice(0, 2).map(task => {
                        const project = getProjectById(projects, task.project_id);
                        const color = getProjectColor(project);
                        return (
                          <div
                            key={task.id}
                            className="text-[10px] truncate font-medium px-1 rounded"
                            style={{ color }}
                            title={task.title}
                          >
                            {task.title}
                          </div>
                        );
                      })}
                      {pendingTasks.length > 2 && (
                        <span className="text-[10px] text-muted-foreground">
                          +{pendingTasks.length - 2} more
                        </span>
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        /* Weekly View - Card style */
        <div className="p-3">
          <div className="grid grid-cols-7 gap-2">
            {calendarDays.map(day => {
              const dateKey = format(day, 'yyyy-MM-dd');
              const dayTasks = tasksByDate.get(dateKey) || [];
              const pendingTasks = dayTasks.filter(t => !t.completed);
              const isSelected = selectedDate && isSameDay(day, selectedDate);
              const isTodayDate = isToday(day);
              const dominantProject = getDominantProject(dayTasks);
              const dominantColor = dominantProject ? getProjectColor(dominantProject) : null;

              return (
                <button
                  key={dateKey}
                  onClick={() => setSelectedDate(day)}
                  className={cn(
                    "relative min-h-[200px] rounded-xl transition-all flex flex-col border-2",
                    isSelected 
                      ? "border-[hsl(var(--project-moving-abroad))] shadow-lg" 
                      : "border-transparent",
                    isTodayDate && !isSelected && "border-[hsl(var(--project-moving-abroad)/0.5)]",
                    "hover:shadow-md"
                  )}
                  style={{ 
                    backgroundColor: dominantColor 
                      ? getProjectBgColor(dominantColor, 0.1) 
                      : 'hsl(var(--secondary) / 0.3)',
                    borderColor: dominantColor && !isSelected 
                      ? getProjectBgColor(dominantColor, 0.3) 
                      : undefined
                  }}
                >
                  {/* Day header */}
                  <div className="p-3 text-center border-b border-border/50">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                      {format(day, 'EEEE')}
                    </div>
                    <div className={cn(
                      "text-2xl font-bold",
                      isTodayDate && "text-[hsl(var(--project-moving-abroad))]"
                    )}>
                      {format(day, 'd')}
                    </div>
                    <div className="text-xs text-muted-foreground uppercase">
                      {format(day, 'MMM')}
                    </div>
                  </div>
                  
                  {/* Tasks */}
                  <div className="flex-1 p-2 space-y-1">
                    {pendingTasks.slice(0, 3).map(task => {
                      const project = getProjectById(projects, task.project_id);
                      const color = getProjectColor(project);
                      return (
                        <div
                          key={task.id}
                          className="text-xs font-semibold uppercase tracking-wide"
                          style={{ color }}
                          title={task.title}
                        >
                          {task.title}
                        </div>
                      );
                    })}
                    {pendingTasks.length > 3 && (
                      <span className="text-[10px] text-muted-foreground">
                        +{pendingTasks.length - 3} more
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Selected Date Tasks Panel */}
      {selectedDate && (
        <div className="border-t border-border p-4 bg-secondary/10">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-muted-foreground" />
              <p className="font-semibold">
                {format(selectedDate, 'EEEE, MMMM d')}
              </p>
            </div>
            {selectedDateTasks.length > 0 && (
              <span className="text-sm text-muted-foreground">
                {selectedDateTasks.filter(t => !t.completed).length} pending
              </span>
            )}
          </div>
          
          {selectedDateTasks.length === 0 ? (
            <div className="text-center py-6">
              <CalendarIcon className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No tasks due on this date</p>
            </div>
          ) : (
            <div className="space-y-2">
              {selectedDateTasks.map(task => {
                const project = getProjectById(projects, task.project_id);
                const color = getProjectColor(project);
                const isOverdue = !task.completed && isBefore(parseISO(task.deadline!), new Date());
                
                return (
                  <div
                    key={task.id}
                    className={cn(
                      "flex items-center gap-3 p-3 rounded-lg bg-card border cursor-pointer hover:shadow-sm transition-all",
                      task.completed && "opacity-60"
                    )}
                    style={{ borderLeftWidth: '4px', borderLeftColor: color }}
                  >
                    <Checkbox
                      checked={task.completed}
                      onCheckedChange={() => onTaskToggle?.(task.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="flex-shrink-0"
                    />
                    <div 
                      className="flex-1 min-w-0"
                      onClick={() => onTaskClick?.(task)}
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <span 
                          className={cn(
                            "font-medium text-sm",
                            task.completed && "line-through text-muted-foreground"
                          )}
                          style={!task.completed ? { color } : undefined}
                        >
                          {task.title}
                        </span>
                        {!task.completed && (
                          <span className={cn(
                            "text-xs px-2 py-0.5 rounded-full font-medium",
                            task.priority === 'high' && "bg-[hsl(var(--priority-high)/0.12)] text-[hsl(var(--priority-high))]",
                            task.priority === 'medium' && "bg-[hsl(var(--priority-medium)/0.12)] text-[hsl(var(--priority-medium))]",
                            task.priority === 'low' && "bg-[hsl(var(--priority-low)/0.12)] text-[hsl(var(--priority-low))]"
                          )}>
                            {task.priority === 'high' ? 'Must' : task.priority === 'medium' ? 'Should' : 'Nice'}
                          </span>
                        )}
                        {project && (
                          <span 
                            className="text-xs px-2 py-0.5 rounded-full"
                            style={{ 
                              backgroundColor: getProjectBgColor(color, 0.15),
                              color
                            }}
                          >
                            {project.name}
                          </span>
                        )}
                        {isOverdue && (
                          <span className="text-xs text-destructive font-medium">Overdue</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
