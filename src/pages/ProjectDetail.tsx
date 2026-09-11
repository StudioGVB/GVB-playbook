import { useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAppData, Task, Cost, Section, Project, getProjectBySlug, getProjectColorHSL } from '@/hooks/useAppData';
import { format, parseISO, differenceInWeeks, differenceInDays, startOfDay, isBefore } from 'date-fns';
import { Trash2, ArrowLeft, Edit2, Plus, Sparkles, ChevronDown, ChevronRight, List, AlignJustify, Calendar, CalendarCheck } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import InlineTaskEntry from '@/components/InlineTaskEntry';
import AISuggestions from '@/components/AISuggestions';
import TaskAIPanel from '@/components/TaskAIPanel';
import { loadMoveSettings } from '@/components/MoveSettings';
import MoveSettings from '@/components/MoveSettings';
import ReadyToLeaveChecklist from '@/components/ReadyToLeaveChecklist';
import DeleteConfirmDialog from '@/components/DeleteConfirmDialog';
import SuggestedSectionTag from '@/components/SuggestedSectionTag';

const categories = [
  { id: 'move', label: 'Move' },
  { id: 'tools', label: 'Tools' },
  { id: 'life', label: 'Life' },
  { id: 'learning', label: 'Learning' },
  { id: 'travel', label: 'Travel' },
] as const;

// The ID of the "Move to UK" project - stable identifier
const MOVE_PROJECT_ID = '1';

function MoveCountdownInline() {
  const settings = loadMoveSettings();
  if (!settings.departureDate) return null;
  const departure = parseISO(settings.departureDate);
  const today = startOfDay(new Date());
  if (isBefore(departure, today)) return null;
  const weeks = differenceInWeeks(departure, today);
  const days = differenceInDays(departure, today);
  const rem = days % 7;
  return (
    <div className="flex items-center gap-2 text-muted-foreground">
      <Calendar className="h-4 w-4" />
      <span className="text-sm font-medium">
        {weeks}w{rem > 0 ? ` ${rem}d` : ''} <span className="font-normal text-xs">to go</span>
      </span>
    </div>
  );
}

export default function ProjectDetail() {
  const { slug } = useParams<{ slug: string }>();
  const { 
    data, 
    addTask, 
    updateTask, 
    deleteTask: deleteTaskMutation, 
    addSection,
    deleteSection: deleteSectionMutation,
    addCost,
    deleteCost: deleteCostMutation,
    updateProject
  } = useAppData();
  
  const [costDialogOpen, setCostDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [editForm, setEditForm] = useState<Partial<Task>>({});
  const [costForm, setCostForm] = useState({
    name: '',
    amount: 0,
    type: 'ongoing' as 'ongoing' | 'one-off',
    category: 'tools',
  });
  const [expandedAITaskId, setExpandedAITaskId] = useState<string | null>(null);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [addingSectionName, setAddingSectionName] = useState('');
  const [isAddingSection, setIsAddingSection] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [taskToDelete, setTaskToDelete] = useState<string | null>(null);
  const [compactView, setCompactView] = useState(true);
  const [scheduledTasks, setScheduledTasks] = useState<Set<string>>(new Set());

  const project = useMemo(() => getProjectBySlug(data.projects, slug || ''), [data.projects, slug]);
  
  // Check if this is the Move to UK project
  const isMoveProject = project && (project.id === MOVE_PROJECT_ID || project.has_move_ai);
  
  const projectTasks = useMemo(() => 
    data.tasks.filter(t => t.project_id === project?.id),
    [data.tasks, project?.id]
  );

  const projectSections = useMemo(() =>
    data.sections.filter(s => s.project_id === project?.id).sort((a, b) => a.order - b.order),
    [data.sections, project?.id]
  );

  const projectCosts = useMemo(() => 
    data.costs.filter(c => c.project_id === project?.id),
    [data.costs, project?.id]
  );

  const ongoingCosts = projectCosts.filter(c => c.type === 'ongoing');
  const oneOffCosts = projectCosts.filter(c => c.type === 'one-off');
  const monthlyTotal = ongoingCosts.reduce((sum, c) => sum + c.amount, 0);
  const oneOffTotal = oneOffCosts.reduce((sum, c) => sum + c.amount, 0);

  if (!project) {
    return (
      <div className="space-y-4">
        <Link to="/projects" className="text-primary hover:underline flex items-center gap-2">
          <ArrowLeft className="h-4 w-4" />
          Back to Projects
        </Link>
        <p className="text-muted-foreground">Project not found</p>
      </div>
    );
  }

  const handleAddTask = (taskData: { title: string; project_id: string; priority: string; deadline?: string; notes?: string; section_id?: string }) => {
    addTask({
      title: taskData.title,
      project_id: project.id,
      priority: taskData.priority,
      deadline: taskData.deadline || null,
      notes: taskData.notes || null,
      section_id: taskData.section_id || null,
      completed: false,
    });
  };

  const handleEditSubmit = () => {
    if (!editingTask || !editForm.title?.trim()) return;

    updateTask(editingTask.id, {
      title: editForm.title,
      priority: editForm.priority,
      deadline: editForm.deadline || null,
      notes: editForm.notes || null,
      section_id: editForm.section_id || null,
    });

    setEditDialogOpen(false);
    setEditingTask(null);
    setEditForm({});
  };

  const handleCostSubmit = () => {
    if (!costForm.name?.trim() || !costForm.amount) return;

    addCost({
      name: costForm.name,
      amount: costForm.amount,
      type: costForm.type,
      category: costForm.category,
      project_id: project.id,
    });

    setCostDialogOpen(false);
    setCostForm({ name: '', amount: 0, type: 'ongoing', category: 'tools' });
  };

  const toggleTask = (id: string) => {
    const task = projectTasks.find(t => t.id === id);
    if (task) {
      updateTask(id, { completed: !task.completed });
    }
  };

  const handleDeleteTask = (id: string) => {
    setTaskToDelete(id);
    setDeleteConfirmOpen(true);
  };

  const confirmDeleteTask = () => {
    if (taskToDelete) {
      deleteTaskMutation(taskToDelete);
      setTaskToDelete(null);
    }
    setDeleteConfirmOpen(false);
  };

  const deleteCost = (id: string) => {
    deleteCostMutation(id);
  };

  const openEditTask = (task: Task) => {
    setEditingTask(task);
    setEditForm(task);
    setEditDialogOpen(true);
  };

  const updateProjectNotes = (notes: string) => {
    updateProject(project.id, { notes });
  };

  const handleToggleAI = (taskId: string) => {
    setExpandedAITaskId(prev => prev === taskId ? null : taskId);
  };

  // Section handlers
  const handleAddSection = (sectionData: { name: string; project_id: string; order: number }) => {
    addSection(sectionData);
  };

  const handleDeleteSection = (sectionId: string) => {
    deleteSectionMutation(sectionId);
  };

  const handleUpdateTaskSection = (taskId: string, sectionId: string | undefined) => {
    updateTask(taskId, { section_id: sectionId || null });
  };

  const toggleSectionCollapse = (sectionId: string) => {
    setCollapsedSections(prev => {
      const next = new Set(prev);
      if (next.has(sectionId)) {
        next.delete(sectionId);
      } else {
        next.add(sectionId);
      }
      return next;
    });
  };

  const handleQuickAddSection = () => {
    if (!addingSectionName.trim() || !project) return;
    handleAddSection({
      name: addingSectionName.trim(),
      project_id: project.id,
      order: projectSections.length,
    });
    setAddingSectionName('');
    setIsAddingSection(false);
  };

  // Create section and assign task in one go
  const handleCreateAndAssignSection = async (taskId: string, sectionName: string) => {
    if (!project) return;
    // First create the section
    await addSection({
      name: sectionName,
      project_id: project.id,
      order: projectSections.length,
    });
    // The section will be added - we need to find it after refetch
    // For now, we set a flag to assign once sections update
    setTimeout(() => {
      // Find the newly created section
      const newSection = data.sections.find(
        s => s.project_id === project.id && s.name.toLowerCase() === sectionName.toLowerCase()
      );
      if (newSection) {
        updateTask(taskId, { section_id: newSection.id });
      }
    }, 500);
  };

  // Get project color for styling
  const projectColorHSL = project ? getProjectColorHSL(project.color_class) : 'var(--primary)';

  const completedTaskCount = projectTasks.filter(t => t.completed).length;
  const pendingTasks = projectTasks.filter(t => !t.completed);

  const toggleScheduled = (taskId: string) => {
    setScheduledTasks(prev => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  // Render a compact task item (single line: checkbox + title + priority + scheduled)
  const renderCompactTaskItem = (task: Task) => (
    <div
      key={task.id}
      className="flex items-center gap-2 py-1 px-2 rounded hover:bg-secondary/50 cursor-pointer group"
      onClick={() => openEditTask(task)}
    >
      <Checkbox
        checked={task.completed}
        onCheckedChange={() => toggleTask(task.id)}
        onClick={(e) => e.stopPropagation()}
        className="flex-shrink-0"
      />
      <span className={`text-sm truncate flex-1 ${task.completed ? 'line-through text-muted-foreground' : ''}`}>
        {task.title}
      </span>
      <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium priority-badge-${task.priority} whitespace-nowrap flex-shrink-0`}>
        {task.priority === 'high' ? 'Must' : task.priority === 'medium' ? 'Should' : 'Nice'}
      </span>
      <button
        onClick={(e) => { e.stopPropagation(); toggleScheduled(task.id); }}
        className={`flex-shrink-0 p-0.5 rounded transition-colors ${scheduledTasks.has(task.id) ? 'text-green-600' : 'text-muted-foreground/40 hover:text-muted-foreground'}`}
        title={scheduledTasks.has(task.id) ? 'Scheduled' : 'Not scheduled'}
      >
        {scheduledTasks.has(task.id) ? <CalendarCheck className="h-4 w-4" /> : <Calendar className="h-4 w-4" />}
      </button>
    </div>
  );

  // Render a task item (full or compact based on toggle)
  const renderTaskItem = (task: Task) => {
    if (compactView) return renderCompactTaskItem(task);

    const isAIExpanded = expandedAITaskId === task.id;
    
    return (
      <div key={task.id} className="space-y-0">
        <div
          className={`flex items-start gap-2 sm:gap-3 py-2 px-2 sm:p-3 rounded-lg hover:bg-secondary/50 group cursor-pointer transition-all ${project.color_class}-border bg-white`}
          onClick={() => openEditTask(task)}
        >
          <Checkbox
            checked={task.completed}
            onCheckedChange={() => toggleTask(task.id)}
            onClick={(e) => e.stopPropagation()}
            className="mt-1 flex-shrink-0"
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-medium text-sm leading-snug">{task.title}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium priority-badge-${task.priority} whitespace-nowrap`}>
                {task.priority === 'high' ? 'Must' : task.priority === 'medium' ? 'Should' : 'Nice'}
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); toggleScheduled(task.id); }}
                className={`p-0.5 rounded transition-colors ${scheduledTasks.has(task.id) ? 'text-green-600' : 'text-muted-foreground/50 hover:text-muted-foreground'}`}
                title={scheduledTasks.has(task.id) ? 'Scheduled' : 'Not scheduled'}
              >
                {scheduledTasks.has(task.id) ? <CalendarCheck className="h-3.5 w-3.5" /> : <Calendar className="h-3.5 w-3.5" />}
              </button>
              {!task.section_id && (
                <SuggestedSectionTag
                  task={task}
                  sections={projectSections}
                  onAssignSection={handleUpdateTaskSection}
                />
              )}
            </div>
            {task.notes && (
              <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">{task.notes}</p>
            )}
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              {task.deadline && (
                <p className="text-[11px] text-muted-foreground whitespace-nowrap">
                  Due: {format(parseISO(task.deadline), 'MMM d, yyyy')}
                </p>
              )}
              <Select
                value={task.section_id || 'none'}
                onValueChange={(v) => {
                  handleUpdateTaskSection(task.id, v === 'none' ? undefined : v);
                }}
              >
                <SelectTrigger 
                  className="h-5 w-auto min-w-[70px] text-[10px] bg-secondary/30 border-0 px-2"
                  onClick={(e) => e.stopPropagation()}
                >
                  <SelectValue placeholder="Section" />
                </SelectTrigger>
                <SelectContent className="bg-white z-50">
                  <SelectItem value="none">No section</SelectItem>
                  {projectSections.map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex gap-0.5 flex-shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className={`h-6 w-6 ${isAIExpanded ? 'opacity-100 bg-[hsl(var(--project-studio-gvb)/0.15)]' : 'sm:opacity-0 sm:group-hover:opacity-100'} text-[hsl(var(--project-studio-gvb))] hover:text-[hsl(var(--project-studio-gvb))] hover:bg-[hsl(var(--project-studio-gvb)/0.15)]`}
              onClick={(e) => {
                e.stopPropagation();
                handleToggleAI(task.id);
              }}
              title="AI Help"
            >
              <Sparkles className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 sm:opacity-0 sm:group-hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                openEditTask(task);
              }}
            >
              <Edit2 className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 sm:opacity-0 sm:group-hover:opacity-100 text-destructive"
              onClick={(e) => {
                e.stopPropagation();
                handleDeleteTask(task.id);
              }}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        </div>
        <TaskAIPanel 
          task={task} 
          project={project} 
          isExpanded={isAIExpanded}
          onToggle={() => handleToggleAI(task.id)}
        />
      </div>
    );
  };

  return (
    <div className="space-y-8">
      {/* Delete Confirmation Dialog */}
      <DeleteConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        onConfirm={confirmDeleteTask}
        title="Delete Task"
        description="Are you sure you want to delete this task? This action cannot be undone."
      />

      {/* Header */}
      <div>
        <Link to="/projects" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 mb-4">
          <ArrowLeft className="h-3 w-3" />
          All Projects
        </Link>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <div className={`w-4 h-4 rounded-full ${project.color_class}-solid`} />
            <h1 className="text-2xl font-bold">{project.name}</h1>
            <span className={`text-xs px-3 py-1 rounded-full font-medium ${
              project.status === 'now' ? 'bg-[hsl(var(--project-back-pocket-games)/0.15)] text-[hsl(var(--project-back-pocket-games))]' :
              project.status === 'parked' ? 'bg-[hsl(var(--project-travel-app)/0.15)] text-[hsl(var(--project-travel-app))]' : 
              'bg-muted text-muted-foreground'
            }`}>
              {project.status === 'now' ? 'Active' : project.status === 'parked' ? 'Parked' : 'Later'}
            </span>
          </div>
          {isMoveProject && (
            <MoveCountdownInline />
          )}
        </div>
        {project.description && (
          <p className="text-muted-foreground">{project.description}</p>
        )}
      </div>

      {/* Move-specific: Settings toggle */}
      {isMoveProject && (
        <div className="flex justify-end">
          <MoveSettings />
        </div>
      )}

      {/* Inline Task Entry */}
      <InlineTaskEntry 
        projects={data.projects}
        sections={projectSections}
        defaultProjectId={project.id}
        defaultSectionId={undefined}
        onAddTask={handleAddTask}
        showProjectSelector={false}
      />

      {/* Tasks section - grouped by sections */}
      <div className="metric-card">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <p className="section-header mb-0" style={{ color: `hsl(${projectColorHSL})` }}>Tasks</p>
            <div className="flex items-center border rounded-md overflow-hidden">
              <button
                onClick={() => setCompactView(false)}
                className={`p-1.5 transition-colors ${!compactView ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary/50'}`}
                title="Detailed view"
              >
                <AlignJustify className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setCompactView(true)}
                className={`p-1.5 transition-colors ${compactView ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary/50'}`}
                title="Compact view"
              >
                <List className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">{pendingTasks.length} pending</span>
            {isAddingSection ? (
              <div className="flex items-center gap-2">
                <Input
                  value={addingSectionName}
                  onChange={(e) => setAddingSectionName(e.target.value)}
                  placeholder="Section name..."
                  className="h-7 text-xs w-40"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleQuickAddSection();
                    if (e.key === 'Escape') {
                      setIsAddingSection(false);
                      setAddingSectionName('');
                    }
                  }}
                />
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={handleQuickAddSection}>
                  Add
                </Button>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => {
                  setIsAddingSection(false);
                  setAddingSectionName('');
                }}>
                  Cancel
                </Button>
              </div>
            ) : (
              <Button 
                size="sm" 
                variant="outline" 
                className="h-7 text-xs gap-1"
                onClick={() => setIsAddingSection(true)}
              >
                <Plus className="h-3 w-3" />
                Add Section
              </Button>
            )}
          </div>
        </div>

        {pendingTasks.length === 0 && completedTaskCount === 0 ? (
          <p className="text-sm text-muted-foreground">No tasks yet. Add one above!</p>
        ) : (
          <div className="space-y-4">
            {/* Tasks grouped by sections */}
            {projectSections.map(section => {
              const sectionTasks = pendingTasks.filter(t => t.section_id === section.id);
              const isCollapsed = collapsedSections.has(section.id);
              
              return (
                <Collapsible key={section.id} open={!isCollapsed} onOpenChange={() => toggleSectionCollapse(section.id)}>
                  <div 
                    className={`flex items-center gap-2 ${compactView ? 'py-1.5 px-2' : 'py-2 px-3'} rounded-lg cursor-pointer group`}
                    style={{ backgroundColor: `hsl(${projectColorHSL} / 0.08)` }}
                  >
                    <CollapsibleTrigger asChild>
                      <button className="flex items-center gap-2 flex-1">
                        {isCollapsed ? (
                          <ChevronRight className={`${compactView ? 'h-3.5 w-3.5' : 'h-4 w-4'}`} style={{ color: `hsl(${projectColorHSL})` }} />
                        ) : (
                          <ChevronDown className={`${compactView ? 'h-3.5 w-3.5' : 'h-4 w-4'}`} style={{ color: `hsl(${projectColorHSL})` }} />
                        )}
                        <h3 
                          className={`font-bold ${compactView ? 'text-sm' : 'text-base'}`}
                          style={{ color: `hsl(${projectColorHSL})` }}
                        >
                          {section.name}
                        </h3>
                        <span className="text-xs text-muted-foreground">({sectionTasks.length})</span>
                      </button>
                    </CollapsibleTrigger>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 opacity-0 group-hover:opacity-100 text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteSection(section.id);
                      }}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                  <CollapsibleContent>
                    <div className={`${compactView ? 'space-y-0 pl-3 mt-1' : 'space-y-2 pl-4 mt-2'}`}>
                      {sectionTasks
                        .sort((a, b) => {
                          const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
                          return (priorityOrder[a.priority] || 2) - (priorityOrder[b.priority] || 2);
                        })
                        .map(task => renderTaskItem(task))}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              );
            })}

            {/* Unsectioned tasks */}
            {(() => {
              const unsectionedTasks = pendingTasks.filter(t => !t.section_id);
              if (unsectionedTasks.length === 0) return null;
              
              return (
                <div>
                  {projectSections.length > 0 && (
                    <div className={`flex items-center gap-2 ${compactView ? 'mb-1 pb-1' : 'mb-3 pb-2'} border-b`}>
                      <h3 className={`font-semibold ${compactView ? 'text-xs' : 'text-sm'} text-muted-foreground`}>Unsorted</h3>
                      <span className="text-xs text-muted-foreground">({unsectionedTasks.length})</span>
                    </div>
                  )}
                  <div className={`${compactView ? 'space-y-0' : 'space-y-2'} ${projectSections.length > 0 ? 'pl-2' : ''}`}>
                    {unsectionedTasks
                      .sort((a, b) => {
                        const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
                        return (priorityOrder[a.priority] || 2) - (priorityOrder[b.priority] || 2);
                      })
                      .map(task => renderTaskItem(task))}
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* Completed tasks */}
        {completedTaskCount > 0 && (
          <details className="mt-4">
            <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
              Completed ({completedTaskCount})
            </summary>
            <div className="space-y-2 mt-2">
              {projectTasks.filter(t => t.completed).map(task => (
                <div key={task.id} className="flex items-start gap-3 p-2 rounded-md opacity-60">
                  <Checkbox
                    checked={task.completed}
                    onCheckedChange={() => toggleTask(task.id)}
                    className="mt-0.5"
                  />
                  <span className="line-through text-sm">{task.title}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 ml-auto"
                    onClick={() => handleDeleteTask(task.id)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>

      {/* Overview cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <div className={`metric-card ${project.color_class}-border`}>
          <p className="section-header text-[10px] sm:text-xs">Tasks</p>
          <p className="text-xl sm:text-2xl font-bold">{projectTasks.length}</p>
          <p className="text-[10px] sm:text-xs text-muted-foreground">{completedTaskCount} done</p>
        </div>
        <div className={`metric-card ${project.color_class}-border`}>
          <p className="section-header text-[10px] sm:text-xs">Monthly</p>
          <p className="text-xl sm:text-2xl font-bold">A${monthlyTotal.toLocaleString()}</p>
        </div>
        <div className={`metric-card ${project.color_class}-border`}>
          <p className="section-header text-[10px] sm:text-xs">One-off</p>
          <p className="text-xl sm:text-2xl font-bold">A${oneOffTotal.toLocaleString()}</p>
        </div>
        <div className={`metric-card ${project.color_class}-border`}>
          <p className="section-header text-[10px] sm:text-xs">Status</p>
          <p className="text-lg sm:text-xl font-bold capitalize">{project.status}</p>
        </div>
      </div>

      {/* Costs section */}
      <div className="metric-card">
        <div className="flex items-center justify-between mb-4">
          <p className="section-header mb-0">Costs</p>
          <Dialog open={costDialogOpen} onOpenChange={setCostDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline">
                <Plus className="h-4 w-4 mr-1" />
                Add Cost
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Cost</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 mt-4">
                <Input
                  placeholder="Cost name"
                  value={costForm.name}
                  onChange={e => setCostForm(prev => ({ ...prev, name: e.target.value }))}
                />
                <Input
                  type="number"
                  placeholder="Amount (AUD)"
                  value={costForm.amount || ''}
                  onChange={e => setCostForm(prev => ({ ...prev, amount: Number(e.target.value) }))}
                />
                <div className="grid grid-cols-2 gap-4">
                  <Select
                    value={costForm.type}
                    onValueChange={v => setCostForm(prev => ({ ...prev, type: v as 'ongoing' | 'one-off' }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ongoing">Ongoing (Monthly)</SelectItem>
                      <SelectItem value="one-off">One-off</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select
                    value={costForm.category}
                    onValueChange={v => setCostForm(prev => ({ ...prev, category: v }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Category" />
                    </SelectTrigger>
                    <SelectContent>
                      {categories.map(cat => (
                        <SelectItem key={cat.id} value={cat.id}>{cat.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button onClick={handleCostSubmit} className="w-full bg-[hsl(var(--project-studio-gvb))] hover:bg-[hsl(340_100%_78%)] text-[hsl(340_70%_25%)]">
                  Add Cost
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {projectCosts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No costs tracked yet</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projectCosts.map(cost => (
                <TableRow key={cost.id}>
                  <TableCell className="font-medium">{cost.name}</TableCell>
                  <TableCell>
                    <span className={`text-xs px-2 py-1 rounded-full ${cost.type === 'ongoing' ? 'bg-[hsl(var(--project-pip)/0.15)] text-[hsl(var(--project-pip))]' : 'bg-muted text-muted-foreground'}`}>
                      {cost.type}
                    </span>
                  </TableCell>
                  <TableCell className="capitalize">{cost.category}</TableCell>
                  <TableCell className="text-right font-medium">A${cost.amount.toLocaleString()}</TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => deleteCost(cost.id)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Notes section */}
      <div className="metric-card">
        <p className="section-header">Project Notes</p>
        <Textarea
          placeholder="Add notes about this project..."
          value={project.notes || ''}
          onChange={e => updateProjectNotes(e.target.value)}
          className="min-h-[120px]"
        />
      </div>

      {/* Move-specific: Ready to Leave Checklist */}
      {isMoveProject && <ReadyToLeaveChecklist tasks={projectTasks} />}

      {/* AI Suggestions - Only for Move to UK project (ID='1' or has_move_ai flag) */}
      {isMoveProject && (
        <AISuggestions project={project} onAddTask={handleAddTask} />
      )}

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
            {/* Section selector in edit dialog */}
            {projectSections.length > 0 && (
              <Select
                value={editForm.section_id || 'none'}
                onValueChange={v => setEditForm(prev => ({ ...prev, section_id: v === 'none' ? undefined : v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Section" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No section</SelectItem>
                  {projectSections.map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
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
    </div>
  );
}
