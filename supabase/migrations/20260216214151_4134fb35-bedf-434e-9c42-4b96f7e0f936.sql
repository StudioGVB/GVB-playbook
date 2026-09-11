
-- Cover letter profiles (one per user)
CREATE TABLE public.cover_letter_profiles (
  user_id UUID NOT NULL PRIMARY KEY,
  resume_text TEXT NOT NULL DEFAULT '',
  skills TEXT NOT NULL DEFAULT '',
  projects TEXT NOT NULL DEFAULT '',
  interests TEXT NOT NULL DEFAULT '',
  preferred_tone TEXT NOT NULL DEFAULT 'professional',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.cover_letter_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own profile" ON public.cover_letter_profiles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own profile" ON public.cover_letter_profiles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own profile" ON public.cover_letter_profiles FOR UPDATE USING (auth.uid() = user_id);

CREATE TRIGGER update_cover_letter_profiles_updated_at
  BEFORE UPDATE ON public.cover_letter_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Cover letters history
CREATE TABLE public.cover_letters (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  job_title TEXT NOT NULL DEFAULT '',
  company_name TEXT NOT NULL DEFAULT '',
  job_description TEXT NOT NULL DEFAULT '',
  source_url TEXT,
  custom_notes TEXT,
  generated_letter TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.cover_letters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own letters" ON public.cover_letters FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own letters" ON public.cover_letters FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own letters" ON public.cover_letters FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own letters" ON public.cover_letters FOR DELETE USING (auth.uid() = user_id);
