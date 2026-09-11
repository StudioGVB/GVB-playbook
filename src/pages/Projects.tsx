import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAppData, Project, getProjectColorHSL } from '@/hooks/useAppData';
import { Plus, X, ArrowRight, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import ProjectColorPicker from '@/components/ProjectColorPicker';

const statusConfig = {
  now: { label: 'Now', className: 'status-now' },
  parked: { label: 'Parked', className: 'status-parked' },
  later: { label: 'Later', className: 'status-later' },
};

export default function Projects() {
  const { data, addProject, updateProject, deleteProject: deleteProjectMutation } = useAppData();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [form, setForm] = useState<{
    name: string;
    status: string;
    monthly_cost: number;
    notes: string;
    next_actions: string[];
    description: string;
    color_class: string;
  }>({
    name: '',
    status: 'now',
    monthly_cost: 0,
    notes: '',
    next_actions: [],
    description: '',
    color_class: 'project-personal',
  });
  const [newAction, setNewAction] = useState('');

  const handleSubmit = async () => {
    if (!form.name?.trim()) return;

    if (editingProject) {
      await updateProject(editingProject.id, {
        name: form.name,
        description: form.description || null,
        status: form.status,
        color_class: form.color_class,
        next_actions: form.next_actions,
        notes: form.notes || null,
      });
    } else {
      const slug = form.name!.toLowerCase().replace(/\s+/g, '-');
      await addProject({
        name: form.name!,
        slug,
        color_class: form.color_class || 'project-personal',
        status: form.status,
        notes: form.notes || null,
        next_actions: form.next_actions || [],
        description: form.description || null,
      });
    }

    setDialogOpen(false);
    setEditingProject(null);
    resetForm();
  };

  const resetForm = () => {
    setForm({ name: '', status: 'now', monthly_cost: 0, notes: '', next_actions: [], description: '', color_class: 'project-personal' });
    setNewAction('');
  };

  const confirmDelete = (project: Project, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setProjectToDelete(project);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirmed = async () => {
    if (projectToDelete) {
      await deleteProjectMutation(projectToDelete.id);
    }
    setDeleteDialogOpen(false);
    setProjectToDelete(null);
  };

  const openEdit = (project: Project, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setEditingProject(project);
    setForm({
      name: project.name,
      status: project.status,
      monthly_cost: project.monthly_cost || 0,
      notes: project.notes || '',
      next_actions: project.next_actions || [],
      description: project.description || '',
      color_class: project.color_class,
    });
    setDialogOpen(true);
  };

  const addAction = () => {
    if (!newAction.trim() || (form.next_actions?.length || 0) >= 3) return;
    setForm(prev => ({
      ...prev,
      next_actions: [...(prev.next_actions || []), newAction]
    }));
    setNewAction('');
  };

  const removeAction = (index: number) => {
    setForm(prev => ({
      ...prev,
      next_actions: prev.next_actions?.filter((_, i) => i !== index)
    }));
  };

  const updateStatus = async (id: string, status: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    await updateProject(id, { status });
  };

  const getProjectTaskCount = (projectId: string) => {
    return data.tasks.filter(t => t.project_id === projectId).length;
  };

  const getProjectCostTotal = (projectId: string) => {
    return data.costs
      .filter(c => c.project_id === projectId && c.type === 'ongoing')
      .reduce((sum, c) => sum + c.amount, 0);
  };

  const totalMonthlyCost = data.projects.reduce((sum, p) => sum + getProjectCostTotal(p.id), 0);

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold mb-1">Projects</h1>
          <p className="text-muted-foreground text-sm">
            Mental separation across life and work · A${totalMonthlyCost}/mo total
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) resetForm(); }}>
          <DialogTrigger asChild>
            <Button onClick={() => setEditingProject(null)} className="w-full sm:w-auto">
              <Plus className="h-4 w-4 mr-2" />
              Add Project
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingProject ? 'Edit Project' : 'Add Project'}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-4">
              <Input
                placeholder="Project name"
                value={form.name}
                onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
              />
              <Input
                placeholder="Short description"
                value={form.description}
                onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))}
              />
              <Select
                value={form.status}
                onValueChange={v => setForm(prev => ({ ...prev, status: v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="now">Now</SelectItem>
                  <SelectItem value="parked">Parked</SelectItem>
                  <SelectItem value="later">Later</SelectItem>
              </SelectContent>
              </Select>
              
              <ProjectColorPicker 
                value={form.color_class || 'project-personal'} 
                onChange={(color) => setForm(prev => ({ ...prev, color_class: color }))} 
              />
              
              <div>
                <p className="text-sm font-medium mb-2">Next Actions (max 3)</p>
                <div className="space-y-2 mb-2">
                  {form.next_actions?.map((action, index) => (
                    <div key={index} className="flex items-center gap-2 text-sm bg-secondary px-3 py-2 rounded-md">
                      <span className="flex-1">{action}</span>
                      <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => removeAction(index)}>
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
                {(form.next_actions?.length || 0) < 3 && (
                  <div className="flex gap-2">
                    <Input
                      placeholder="Add next action..."
                      value={newAction}
                      onChange={e => setNewAction(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && addAction()}
                    />
                    <Button size="icon" variant="outline" onClick={addAction}>
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>

              <Textarea
                placeholder="Notes..."
                value={form.notes}
                onChange={e => setForm(prev => ({ ...prev, notes: e.target.value }))}
              />
              <div className="flex gap-2">
                <Button onClick={handleSubmit} className="flex-1">
                  {editingProject ? 'Save Changes' : 'Add Project'}
                </Button>
                {editingProject && (
                  <Button 
                    variant="outline" 
                    className="text-destructive hover:bg-destructive/10"
                    onClick={() => {
                      setDialogOpen(false);
                      confirmDelete(editingProject, { preventDefault: () => {}, stopPropagation: () => {} } as React.MouseEvent);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{projectToDelete?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the project and all its associated tasks and costs. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleDeleteConfirmed}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete Project
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {(['now', 'parked', 'later'] as const).map(status => {
        const statusProjects = data.projects.filter(p => p.status === status);
        if (statusProjects.length === 0) return null;

        return (
          <div key={status}>
            <p className="section-header">{statusConfig[status].label}</p>
            <div className="grid gap-3">
              {statusProjects.map(project => {
                const taskCount = getProjectTaskCount(project.id);
                const costTotal = getProjectCostTotal(project.id);
                
                const projectColor = getProjectColorHSL(project.color_class);
                
                return (
                  <Link
                    key={project.id}
                    to={`/projects/${project.slug}`}
                    className="metric-card hover:border-2 transition-all"
                    style={{ borderLeftWidth: '4px', borderLeftColor: `hsl(${projectColor})` }}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-3">
                        <div 
                          className="w-3 h-3 rounded-full" 
                          style={{ backgroundColor: `hsl(${projectColor})` }}
                        />
                        <h3 className="font-medium">{project.name}</h3>
                        <span className={`text-xs px-1.5 py-0.5 rounded border ${statusConfig[status].className}`}>
                          {statusConfig[status].label}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-sm text-muted-foreground">
                        {taskCount > 0 && <span>{taskCount} tasks</span>}
                        {costTotal > 0 && <span>A${costTotal}/mo</span>}
                        <ArrowRight className="h-4 w-4" />
                      </div>
                    </div>

                    {project.description && (
                      <p className="text-sm text-muted-foreground mb-2 ml-6">{project.description}</p>
                    )}

                    {(project.next_actions?.length || 0) > 0 && (
                      <div className="space-y-1 mb-2 ml-6">
                        {project.next_actions?.map((action, i) => (
                          <p key={i} className="text-sm text-muted-foreground flex items-center gap-2">
                            <span 
                              className="w-1.5 h-1.5 rounded-full"
                              style={{ backgroundColor: `hsl(${projectColor})` }}
                            />
                            {action}
                          </p>
                        ))}
                      </div>
                    )}

                    <div className="flex gap-1 mt-3 pt-3 border-t border-border ml-6">
                      {(['now', 'parked', 'later'] as const).map(s => (
                        <Button
                          key={s}
                          variant={project.status === s ? 'secondary' : 'ghost'}
                          size="sm"
                          className="text-xs h-7"
                          onClick={(e) => updateStatus(project.id, s, e)}
                        >
                          {statusConfig[s].label}
                        </Button>
                      ))}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs h-7 ml-auto"
                        onClick={(e) => openEdit(project, e)}
                      >
                        Edit
                      </Button>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
