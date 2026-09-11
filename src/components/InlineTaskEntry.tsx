import { useState, useRef, useEffect } from 'react';
import { Project, Section } from '@/hooks/useAppData';
import { Plus, FolderOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface InlineTaskEntryProps {
  projects: Project[];
  sections?: Section[];
  defaultProjectId?: string;
  defaultSectionId?: string;
  onAddTask: (task: { title: string; project_id: string; priority: string; deadline?: string; notes?: string; section_id?: string }) => void;
  showProjectSelector?: boolean;
}

export default function InlineTaskEntry({ 
  projects, 
  sections = [],
  defaultProjectId, 
  defaultSectionId,
  onAddTask, 
  showProjectSelector = true 
}: InlineTaskEntryProps) {
  const [form, setForm] = useState({
    title: '',
    projectId: defaultProjectId || projects[0]?.id || '',
    sectionId: defaultSectionId || '',
    priority: 'medium',
    deadline: '',
    notes: '',
  });
  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (defaultProjectId) {
      setForm(prev => ({ ...prev, projectId: defaultProjectId }));
    }
  }, [defaultProjectId]);

  const projectSections = sections.filter(s => s.project_id === form.projectId);

  const handleSubmit = () => {
    if (!form.title.trim() || !form.projectId) return;

    onAddTask({
      title: form.title.trim(),
      project_id: form.projectId,
      section_id: form.sectionId || undefined,
      priority: form.priority,
      deadline: form.deadline || undefined,
      notes: form.notes || undefined,
    });
    
    setForm(prev => ({ 
      ...prev, 
      title: '', 
      deadline: '', 
      notes: '' 
    }));
    
    titleInputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const selectedProject = projects.find(p => p.id === form.projectId);

  return (
    <div className={`metric-card border-2 ${selectedProject?.color_class}-border bg-gradient-to-r from-white to-[hsl(var(--secondary)/0.3)]`}>
      <div className="flex items-center gap-2 mb-4">
        <div className={`w-3 h-3 rounded-full ${selectedProject?.color_class}-solid`} />
        <p className="font-medium text-sm">Quick Add Task</p>
      </div>
      
      <div className="space-y-3">
        <Input
          ref={titleInputRef}
          placeholder="What needs to be done?"
          value={form.title}
          onChange={e => setForm(prev => ({ ...prev, title: e.target.value }))}
          onKeyDown={handleKeyDown}
          className="text-base"
        />
        
        <div className="grid grid-cols-3 gap-3">
          {showProjectSelector && (
            <Select
              value={form.projectId}
              onValueChange={v => setForm(prev => ({ ...prev, projectId: v }))}
            >
              <SelectTrigger className="bg-white">
                <SelectValue placeholder="Project" />
              </SelectTrigger>
              <SelectContent>
                {projects.map(p => (
                  <SelectItem key={p.id} value={p.id}>
                    <span className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${p.color_class}-solid`} />
                      {p.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          
          {projectSections.length > 0 && (
            <Select
              value={form.sectionId || 'none'}
              onValueChange={v => setForm(prev => ({ ...prev, sectionId: v === 'none' ? '' : v }))}
            >
              <SelectTrigger className="bg-white">
                <FolderOpen className="h-4 w-4 mr-2 text-muted-foreground" />
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
          
          <Select
            value={form.priority}
            onValueChange={v => setForm(prev => ({ ...prev, priority: v }))}
          >
            <SelectTrigger className="bg-white">
              <SelectValue placeholder="Priority" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="high">
                <span className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-[hsl(var(--priority-high))]" />
                  Must
                </span>
              </SelectItem>
              <SelectItem value="medium">
                <span className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-[hsl(var(--priority-medium))]" />
                  Should
                </span>
              </SelectItem>
              <SelectItem value="low">
                <span className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-[hsl(var(--priority-low))]" />
                  Nice
                </span>
              </SelectItem>
            </SelectContent>
          </Select>
          
          <Input
            type="date"
            value={form.deadline}
            onChange={e => setForm(prev => ({ ...prev, deadline: e.target.value }))}
            className="bg-white"
          />
        </div>
        
        <Textarea
          placeholder="Notes (optional)..."
          value={form.notes}
          onChange={e => setForm(prev => ({ ...prev, notes: e.target.value }))}
          className="min-h-[60px] bg-white"
        />
        
        <Button 
          onClick={handleSubmit} 
          disabled={!form.title.trim() || !form.projectId}
          className="w-full bg-[hsl(var(--project-studio-gvb))] hover:bg-[hsl(340_100%_78%)] text-[hsl(340_70%_25%)] font-medium"
        >
          <Plus className="h-4 w-4 mr-2" />
          Add Task
        </Button>
      </div>
    </div>
  );
}
