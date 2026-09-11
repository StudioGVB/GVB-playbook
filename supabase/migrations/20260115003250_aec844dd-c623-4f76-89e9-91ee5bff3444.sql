-- Create projects table
CREATE TABLE public.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  color_class TEXT NOT NULL DEFAULT 'project-personal',
  status TEXT NOT NULL DEFAULT 'now' CHECK (status IN ('now', 'parked', 'later')),
  next_actions TEXT[] DEFAULT '{}',
  monthly_cost NUMERIC DEFAULT 0,
  notes TEXT,
  description TEXT,
  has_move_ai BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create sections table
CREATE TABLE public.sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  "order" INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create tasks table
CREATE TABLE public.tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
  section_id UUID REFERENCES public.sections(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('high', 'medium', 'low')),
  deadline DATE,
  notes TEXT,
  completed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create costs table
CREATE TABLE public.costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  amount NUMERIC NOT NULL DEFAULT 0,
  type TEXT NOT NULL DEFAULT 'ongoing' CHECK (type IN ('one-off', 'ongoing')),
  category TEXT NOT NULL DEFAULT 'tools' CHECK (category IN ('move', 'tools', 'life', 'learning', 'travel')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create brain_dump table
CREATE TABLE public.brain_dump (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create weekly_priorities table
CREATE TABLE public.weekly_priorities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  text TEXT NOT NULL,
  completed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create user_settings table (for move date, runway, etc.)
CREATE TABLE public.user_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  uk_move_date DATE,
  available_cash NUMERIC DEFAULT 0,
  monthly_non_negotiables NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brain_dump ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weekly_priorities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

-- RLS policies for projects
CREATE POLICY "Users can view own projects" ON public.projects FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own projects" ON public.projects FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own projects" ON public.projects FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own projects" ON public.projects FOR DELETE USING (auth.uid() = user_id);

-- RLS policies for sections
CREATE POLICY "Users can view own sections" ON public.sections FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own sections" ON public.sections FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own sections" ON public.sections FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own sections" ON public.sections FOR DELETE USING (auth.uid() = user_id);

-- RLS policies for tasks
CREATE POLICY "Users can view own tasks" ON public.tasks FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own tasks" ON public.tasks FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own tasks" ON public.tasks FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own tasks" ON public.tasks FOR DELETE USING (auth.uid() = user_id);

-- RLS policies for costs
CREATE POLICY "Users can view own costs" ON public.costs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own costs" ON public.costs FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own costs" ON public.costs FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own costs" ON public.costs FOR DELETE USING (auth.uid() = user_id);

-- RLS policies for brain_dump
CREATE POLICY "Users can view own brain_dump" ON public.brain_dump FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own brain_dump" ON public.brain_dump FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own brain_dump" ON public.brain_dump FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own brain_dump" ON public.brain_dump FOR DELETE USING (auth.uid() = user_id);

-- RLS policies for weekly_priorities
CREATE POLICY "Users can view own weekly_priorities" ON public.weekly_priorities FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own weekly_priorities" ON public.weekly_priorities FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own weekly_priorities" ON public.weekly_priorities FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own weekly_priorities" ON public.weekly_priorities FOR DELETE USING (auth.uid() = user_id);

-- RLS policies for user_settings
CREATE POLICY "Users can view own settings" ON public.user_settings FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own settings" ON public.user_settings FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own settings" ON public.user_settings FOR UPDATE USING (auth.uid() = user_id);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Add triggers for updated_at
CREATE TRIGGER update_projects_updated_at BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_tasks_updated_at BEFORE UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_user_settings_updated_at BEFORE UPDATE ON public.user_settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();