import { useState, useMemo } from 'react';
import { useAppData, Task, getProjectById, getProjectHexColor } from '@/hooks/useAppData';
import { format, parseISO, addDays, startOfDay, isBefore, isAfter } from 'date-fns';
import { Trash2, Filter, Edit2, Plus, ChevronDown, ChevronUp } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import InlineTaskEntry from '@/components/InlineTaskEntry';
import TaskAIPanel from '@/components/TaskAIPanel';
import TaskTimeBuckets, { TimeBucket } from '@/components/TaskTimeBuckets';
import TaskCalendar from '@/components/TaskCalendar';
import DeleteConfirmDialog from '@/components/DeleteConfirmDialog';

export default function Tasks() {
  const { data, addTask, updateTask, deleteTask } = useAppData();
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [filterProject, setFilterProject] = useState<string>('all');
  const [timeBucket, setTimeBucket] = useState<TimeBucket>('all');
  const [editForm, setEditForm] = useState<Partial<Task>>({});
  const [expandedAITaskId, setExpandedAITaskId] = useState<string | null>(null);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [taskToDelete, setTaskToDelete] = useState<Task | null>(null);

  // Filter by project first
  const projectFilteredTasks = useMemo(() => {
    if (filterProject === 'all') return data.tasks;
    return data.tasks.filter(t => t.project_id === filterProject);
  }, [data.tasks, filterProject]);

  // Calculate time bucket counts for pending tasks only
  const bucketCounts = useMemo(() => {
    const pending = projectFilteredTasks.filter(t => !t.completed);
    const today = startOfDay(new Date());
    const weekEnd = addDays(today, 7);
    
    let todayCount = 0;
    let weekCount = 0;
    let laterCount = 0;
    
    pending.forEach(task => {
      if (!task.deadline) {
        laterCount++;
        return;
      }
      
      const deadline = parseISO(task.deadline);
      
      if (isBefore(deadline, addDays(today, 1))) {
        todayCount++;
      } else if (isBefore(deadline, weekEnd)) {
        weekCount++;
      } else {
        laterCount++;
      }
    });
    
    return {
      today: todayCount,
      week: weekCount,
      later: laterCount,
      all: pending.length,
    };
  }, [projectFilteredTasks]);

  // Apply time bucket filter
  const filteredTasks = useMemo(() => {
    if (timeBucket === 'all') return projectFilteredTasks;
    
    const today = startOfDay(new Date());
    const weekEnd = addDays(today, 7);
    
    return projectFilteredTasks.filter(task => {
      if (task.completed) return true;
      
      if (!task.deadline) {
        return timeBucket === 'later';
      }
      
      const deadline = parseISO(task.deadline);
      
      switch (timeBucket) {
        case 'today':
          return isBefore(deadline, addDays(today, 1));
        case 'week':
          return isAfter(deadline, today) && isBefore(deadline, weekEnd);
        case 'later':
          return isAfter(deadline, weekEnd) || !task.deadline;
        default:
          return true;
      }
    });
  }, [projectFilteredTasks, timeBucket]);

  const pendingTasks = filteredTasks.filter(t => !t.completed);
  const completedTasks = filteredTasks.filter(t => t.completed);

  const handleAddTask = async (task: { title: string; project_id: string; priority: string; deadline?: string; notes?: string; section_id?: string }) => {
    await addTask({
      title: task.title,
      project_id: task.project_id,
      priority: task.priority as 'high' | 'medium' | 'low',
      deadline: task.deadline || null,
      notes: task.notes || null,
      section_id: task.section_id || null,
    });
  };

  const handleEditSubmit = async () => {
    if (!editingTask || !editForm.title?.trim()) return;

    await updateTask(editingTask.id, {
      title: editForm.title,
      project_id: editForm.project_id,
      priority: editForm.priority,
      deadline: editForm.deadline || null,
      notes: editForm.notes || null,
    });

    setEditDialogOpen(false);
    setEditingTask(null);
    setEditForm({});
  };

  const toggleTask = async (id: string) => {
    const task = data.tasks.find(t => t.id === id);
    if (task) {
      await updateTask(id, { completed: !task.completed });
    }
  };

  const confirmDeleteTask = (task: Task) => {
    setTaskToDelete(task);
    setDeleteConfirmOpen(true);
  };

  const handleDeleteConfirmed = async () => {
    if (taskToDelete) {
      await deleteTask(taskToDelete.id);
    }
    setDeleteConfirmOpen(false);
    setTaskToDelete(null);
  };

  const openEdit = (task: Task) => {
    setEditingTask(task);
    setEditForm(task);
    setEditDialogOpen(true);
  };

  const handleToggleAI = (taskId: string) => {
    setExpandedAITaskId(prev => prev === taskId ? null : taskId);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold mb-1 bg-gradient-to-r from-[hsl(var(--project-moving-abroad))] to-[hsl(var(--project-pip))] bg-clip-text text-transparent">All Tasks</h1>
          <p className="text-muted-foreground text-sm">
            {bucketCounts.all} pending · {data.tasks.filter(t => t.completed).length} completed
          </p>
        </div>
        <Select value={filterProject} onValueChange={setFilterProject}>
          <SelectTrigger className="w-full sm:w-[200px] bg-white">
            <Filter className="h-4 w-4 mr-2" />
            <SelectValue placeholder="Filter by project" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Projects</SelectItem>
            {data.projects.map(p => (
              <SelectItem key={p.id} value={p.id}>
                <span className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${p.color_class}-solid`} />
                  {p.name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Collapsible Quick Add */}
      <Collapsible open={quickAddOpen} onOpenChange={setQuickAddOpen}>
        <CollapsibleTrigger asChild>
          <Button 
            variant="outline" 
            className="w-full justify-between border-dashed border-2 hover:border-solid hover:bg-secondary/30"
          >
            <span className="flex items-center gap-2">
              <Plus className="h-4 w-4" />
              Quick Add Task
            </span>
            {quickAddOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-3">
          <InlineTaskEntry 
            projects={data.projects} 
            sections={data.sections}
            onAddTask={handleAddTask}
            showProjectSelector={true}
          />
        </CollapsibleContent>
      </Collapsible>

      {/* Calendar View */}
      <TaskCalendar 
        tasks={projectFilteredTasks} 
        projects={data.projects}
        onTaskClick={(task) => openEdit(task)}
        onTaskToggle={(taskId) => toggleTask(taskId)}
      />

      {/* List View */}
      <div className="space-y-4">
        <TaskTimeBuckets 
          value={timeBucket} 
          onChange={setTimeBucket} 
          counts={bucketCounts}
        />

        {/* Pending Tasks */}
        <div className="metric-card">
          <p className="section-header">
            {timeBucket === 'today' && 'Due Today / Overdue'}
            {timeBucket === 'week' && 'Due This Week'}
            {timeBucket === 'later' && 'Later / No Due Date'}
            {timeBucket === 'all' && 'Pending Tasks'}
          </p>
          {pendingTasks.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {timeBucket === 'all' ? 'No pending tasks' : `No tasks in this time range`}
            </p>
          ) : (
            <div className="space-y-0">
              {pendingTasks
                .sort((a, b) => {
                  const priorityOrder = { high: 0, medium: 1, low: 2 };
                  return (priorityOrder[a.priority as keyof typeof priorityOrder] || 1) - (priorityOrder[b.priority as keyof typeof priorityOrder] || 1);
                })
                .map(task => {
                  const project = getProjectById(data.projects, task.project_id);
                  const projectColor = project ? getProjectHexColor(project.color_class) : undefined;
                  return (
                    <div
                      key={task.id}
                      className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-secondary/50 cursor-pointer group"
                      onClick={() => openEdit(task)}
                    >
                      <Checkbox
                        checked={task.completed}
                        onCheckedChange={() => toggleTask(task.id)}
                        onClick={(e) => e.stopPropagation()}
                        className="flex-shrink-0"
                        style={projectColor ? { borderColor: projectColor } : undefined}
                      />
                      <span className={`text-sm truncate flex-1 ${task.completed ? 'line-through text-muted-foreground' : ''}`}>
                        {task.title}
                      </span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium priority-badge-${task.priority} whitespace-nowrap flex-shrink-0`}>
                        {task.priority === 'high' ? 'Must' : task.priority === 'medium' ? 'Should' : 'Nice'}
                      </span>
                      <div className="flex gap-0.5 flex-shrink-0 sm:opacity-0 sm:group-hover:opacity-100">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={(e) => { e.stopPropagation(); openEdit(task); }}
                        >
                          <Edit2 className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-destructive"
                          onClick={(e) => { e.stopPropagation(); confirmDeleteTask(task); }}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </div>

        {/* Completed Tasks */}
        {completedTasks.length > 0 && (
          <div className="metric-card">
            <details>
              <summary className="section-header cursor-pointer">
                Completed ({completedTasks.length})
              </summary>
              <div className="space-y-0 mt-2">
                {completedTasks.map(task => {
                  const project = getProjectById(data.projects, task.project_id);
                  const projectColor = project ? getProjectHexColor(project.color_class) : undefined;
                  return (
                    <div
                      key={task.id}
                      className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-secondary/50 group"
                    >
                      <Checkbox
                        checked={task.completed}
                        onCheckedChange={() => toggleTask(task.id)}
                        className="flex-shrink-0"
                        style={projectColor ? { borderColor: projectColor } : undefined}
                      />
                      <span className="text-sm truncate flex-1 line-through text-muted-foreground">{task.title}</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 opacity-0 group-hover:opacity-100"
                        onClick={() => confirmDeleteTask(task)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            </details>
          </div>
        )}
      </div>

      {/* Edit Task Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={(open) => { setEditDialogOpen(open); if (!open) { setEditingTask(null); setEditForm({}); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Task</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-4">
            <Input
              placeholder="Task title"
              value={editForm.title || ''}
              onChange={e => setEditForm(prev => ({ ...prev, title: e.target.value }))}
            />
            <Select
              value={editForm.project_id || ''}
              onValueChange={v => setEditForm(prev => ({ ...prev, project_id: v }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select project" />
              </SelectTrigger>
              <SelectContent>
                {data.projects.map(p => (
                  <SelectItem key={p.id} value={p.id}>
                    <span className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${p.color_class}-solid`} />
                      {p.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="grid grid-cols-2 gap-4">
              <Select
                value={editForm.priority}
                onValueChange={v => setEditForm(prev => ({ ...prev, priority: v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Priority" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="high">Must</SelectItem>
                  <SelectItem value="medium">Should</SelectItem>
                  <SelectItem value="low">Nice</SelectItem>
                </SelectContent>
              </Select>
              <Input
                type="date"
                value={editForm.deadline || ''}
                onChange={e => setEditForm(prev => ({ ...prev, deadline: e.target.value }))}
              />
            </div>
            <Textarea
              placeholder="Notes..."
              value={editForm.notes || ''}
              onChange={e => setEditForm(prev => ({ ...prev, notes: e.target.value }))}
            />
            <Button onClick={handleEditSubmit} className="w-full bg-[hsl(var(--project-studio-gvb))] hover:bg-[hsl(340_100%_78%)] text-[hsl(340_70%_25%)]">
              Save Changes
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <DeleteConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        onConfirm={handleDeleteConfirmed}
        title={`Delete "${taskToDelete?.title}"?`}
        description="This will permanently delete this task."
      />
    </div>
  );
}
