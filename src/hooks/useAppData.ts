import { useState, useEffect, useCallback, useContext } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Tables, TablesInsert, TablesUpdate } from '@/integrations/supabase/types';
import { AppDataContext } from '@/contexts/AppDataContext';

// Types from database
export type Project = Tables<'projects'>;
export type Task = Tables<'tasks'>;
export type Section = Tables<'sections'>;
export type Cost = Tables<'costs'>;
export type BrainDumpNote = Tables<'brain_dump'>;
export type WeeklyPriority = Tables<'weekly_priorities'>;
export type UserSettings = Tables<'user_settings'>;

export interface AppData {
  projects: Project[];
  tasks: Task[];
  sections: Section[];
  costs: Cost[];
  brainDump: BrainDumpNote[];
  weeklyPriorities: WeeklyPriority[];
  settings: UserSettings | null;
}

const defaultSettings: Omit<UserSettings, 'id' | 'user_id' | 'created_at' | 'updated_at'> = {
  uk_move_date: null,
  available_cash: 0,
  monthly_non_negotiables: 0,
};

export function useAppDataState() {
  const { user } = useAuth();
  const [data, setData] = useState<AppData>({
    projects: [],
    tasks: [],
    sections: [],
    costs: [],
    brainDump: [],
    weeklyPriorities: [],
    settings: null,
  });
  const [loading, setLoading] = useState(true);

  // Fetch all data
  const fetchData = useCallback(async () => {
    if (!user) {
      setData({
        projects: [],
        tasks: [],
        sections: [],
        costs: [],
        brainDump: [],
        weeklyPriorities: [],
        settings: null,
      });
      setLoading(false);
      return;
    }

    try {
      const [
        projectsRes,
        tasksRes,
        sectionsRes,
        costsRes,
        brainDumpRes,
        prioritiesRes,
        settingsRes,
      ] = await Promise.all([
        supabase.from('projects').select('*').order('created_at'),
        supabase.from('tasks').select('*').order('created_at'),
        supabase.from('sections').select('*').order('order'),
        supabase.from('costs').select('*').order('created_at'),
        supabase.from('brain_dump').select('*').order('created_at', { ascending: false }),
        supabase.from('weekly_priorities').select('*').order('created_at'),
        supabase.from('user_settings').select('*').maybeSingle(),
      ]);

      setData({
        projects: projectsRes.data || [],
        tasks: tasksRes.data || [],
        sections: sectionsRes.data || [],
        costs: costsRes.data || [],
        brainDump: brainDumpRes.data || [],
        weeklyPriorities: prioritiesRes.data || [],
        settings: settingsRes.data,
      });
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Project operations
  const addProject = async (project: Omit<TablesInsert<'projects'>, 'user_id'>) => {
    if (!user) return null;
    const { data: newProject, error } = await supabase
      .from('projects')
      .insert({ ...project, user_id: user.id })
      .select()
      .single();
    if (error) throw error;
    setData(prev => ({ ...prev, projects: [...prev.projects, newProject] }));
    return newProject;
  };

  const updateProject = async (id: string, updates: TablesUpdate<'projects'>) => {
    const { data: updated, error } = await supabase
      .from('projects')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    setData(prev => ({
      ...prev,
      projects: prev.projects.map(p => p.id === id ? updated : p),
    }));
    return updated;
  };

  const deleteProject = async (id: string) => {
    const { error } = await supabase.from('projects').delete().eq('id', id);
    if (error) throw error;
    setData(prev => ({
      ...prev,
      projects: prev.projects.filter(p => p.id !== id),
      tasks: prev.tasks.filter(t => t.project_id !== id),
      sections: prev.sections.filter(s => s.project_id !== id),
      costs: prev.costs.filter(c => c.project_id !== id),
    }));
  };

  // Task operations
  const addTask = async (task: Omit<TablesInsert<'tasks'>, 'user_id'>) => {
    if (!user) return null;
    const { data: newTask, error } = await supabase
      .from('tasks')
      .insert({ ...task, user_id: user.id })
      .select()
      .single();
    if (error) throw error;
    setData(prev => ({ ...prev, tasks: [...prev.tasks, newTask] }));
    return newTask;
  };

  const updateTask = async (id: string, updates: TablesUpdate<'tasks'>) => {
    const { data: updated, error } = await supabase
      .from('tasks')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    setData(prev => ({
      ...prev,
      tasks: prev.tasks.map(t => t.id === id ? updated : t),
    }));
    return updated;
  };

  const deleteTask = async (id: string) => {
    const { error } = await supabase.from('tasks').delete().eq('id', id);
    if (error) throw error;
    setData(prev => ({
      ...prev,
      tasks: prev.tasks.filter(t => t.id !== id),
    }));
  };

  // Section operations
  const addSection = async (section: Omit<TablesInsert<'sections'>, 'user_id'>) => {
    if (!user) return null;
    const { data: newSection, error } = await supabase
      .from('sections')
      .insert({ ...section, user_id: user.id })
      .select()
      .single();
    if (error) throw error;
    setData(prev => ({ ...prev, sections: [...prev.sections, newSection] }));
    return newSection;
  };

  const updateSection = async (id: string, updates: TablesUpdate<'sections'>) => {
    const { data: updated, error } = await supabase
      .from('sections')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    setData(prev => ({
      ...prev,
      sections: prev.sections.map(s => s.id === id ? updated : s),
    }));
    return updated;
  };

  const deleteSection = async (id: string) => {
    const { error } = await supabase.from('sections').delete().eq('id', id);
    if (error) throw error;
    setData(prev => ({
      ...prev,
      sections: prev.sections.filter(s => s.id !== id),
      tasks: prev.tasks.map(t => t.section_id === id ? { ...t, section_id: null } : t),
    }));
  };

  // Cost operations
  const addCost = async (cost: Omit<TablesInsert<'costs'>, 'user_id'>) => {
    if (!user) return null;
    const { data: newCost, error } = await supabase
      .from('costs')
      .insert({ ...cost, user_id: user.id })
      .select()
      .single();
    if (error) throw error;
    setData(prev => ({ ...prev, costs: [...prev.costs, newCost] }));
    return newCost;
  };

  const deleteCost = async (id: string) => {
    const { error } = await supabase.from('costs').delete().eq('id', id);
    if (error) throw error;
    setData(prev => ({
      ...prev,
      costs: prev.costs.filter(c => c.id !== id),
    }));
  };

  // Brain dump operations
  const addBrainDump = async (content: string) => {
    if (!user) return null;
    const { data: newNote, error } = await supabase
      .from('brain_dump')
      .insert({ content, user_id: user.id })
      .select()
      .single();
    if (error) throw error;
    setData(prev => ({ ...prev, brainDump: [newNote, ...prev.brainDump] }));
    return newNote;
  };

  const deleteBrainDump = async (id: string) => {
    const { error } = await supabase.from('brain_dump').delete().eq('id', id);
    if (error) throw error;
    setData(prev => ({
      ...prev,
      brainDump: prev.brainDump.filter(n => n.id !== id),
    }));
  };

  // Settings operations
  const updateSettings = async (updates: Partial<Omit<UserSettings, 'id' | 'user_id' | 'created_at' | 'updated_at'>>) => {
    if (!user) return null;
    
    if (data.settings) {
      const { data: updated, error } = await supabase
        .from('user_settings')
        .update(updates)
        .eq('user_id', user.id)
        .select()
        .single();
      if (error) throw error;
      setData(prev => ({ ...prev, settings: updated }));
      return updated;
    } else {
      const { data: created, error } = await supabase
        .from('user_settings')
        .insert({ ...defaultSettings, ...updates, user_id: user.id })
        .select()
        .single();
      if (error) throw error;
      setData(prev => ({ ...prev, settings: created }));
      return created;
    }
  };

  return {
    data,
    loading,
    refetch: fetchData,
    // Projects
    addProject,
    updateProject,
    deleteProject,
    // Tasks
    addTask,
    updateTask,
    deleteTask,
    // Sections
    addSection,
    updateSection,
    deleteSection,
    // Costs
    addCost,
    deleteCost,
    // Brain dump
    addBrainDump,
    deleteBrainDump,
    // Settings
    updateSettings,
  };
}

export function useAppData() {
  const context = useContext(AppDataContext);
  if (!context) {
    throw new Error('useAppData must be used within an AppDataProvider');
  }
  return context;
}

// Helper functions
export const PROJECT_COLORS: Record<string, string> = {
  'moving-abroad': 'project-moving-abroad',
  'pip': 'project-pip',
  'back-pocket-games': 'project-back-pocket-games',
  'studio-gvb': 'project-studio-gvb',
  'travel-app': 'project-travel-app',
  'personal': 'project-personal',
};

export const getProjectColorHSL = (colorClass: string): string => {
  const colorMap: Record<string, string> = {
    'project-moving-abroad': 'var(--project-moving-abroad)',
    'project-pip': 'var(--project-pip)',
    'project-back-pocket-games': 'var(--project-back-pocket-games)',
    'project-studio-gvb': 'var(--project-studio-gvb)',
    'project-travel-app': 'var(--project-travel-app)',
    'project-personal': 'var(--project-personal)',
  };
  if (colorMap[colorClass]) {
    return colorMap[colorClass];
  }
  return colorClass || 'var(--project-personal)';
};

export const getProjectHexColor = (colorClass: string): string => {
  const presetHexMap: Record<string, string> = {
    'project-moving-abroad': '#4558ff',
    'project-pip': '#da60ff',
    'project-back-pocket-games': '#24af58',
    'project-studio-gvb': '#ffaded',
    'project-travel-app': '#ffb92c',
    'project-personal': '#6b7280',
  };
  
  if (presetHexMap[colorClass]) {
    return presetHexMap[colorClass];
  }
  
  // Handle HSL values like "142 66% 41%" or "330 81% 60%"
  const parts = colorClass.replace(/%/g, '').split(' ');
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
};

export const getProjectById = (projects: Project[], id: string): Project | undefined => {
  return projects.find(p => p.id === id);
};

export const getProjectBySlug = (projects: Project[], slug: string): Project | undefined => {
  return projects.find(p => p.slug === slug);
};
