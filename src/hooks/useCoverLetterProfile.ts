import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';

export interface CoverLetterProfile {
  user_id: string;
  resume_text: string;
  skills: string;
  projects: string;
  education: string;
  personal_details: string;
  interests: string;
  preferred_tone: string;
  created_at: string;
  updated_at: string;
}

export function useCoverLetterProfile() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [profile, setProfile] = useState<CoverLetterProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('cover_letter_profiles' as any)
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();

    if (error) console.error('Error fetching profile:', error);
    setProfile(data as unknown as CoverLetterProfile | null);
    setLoading(false);
  }, [user]);

  useEffect(() => { fetchProfile(); }, [fetchProfile]);

  const saveProfile = async (updates: Partial<CoverLetterProfile>) => {
    if (!user) return;
    const payload = { ...updates, user_id: user.id };

    if (profile) {
      const { error } = await supabase
        .from('cover_letter_profiles' as any)
        .update(payload)
        .eq('user_id', user.id);
      if (error) { toast({ title: 'Error', description: 'Failed to save profile', variant: 'destructive' }); return; }
    } else {
      const { error } = await supabase
        .from('cover_letter_profiles' as any)
        .insert(payload);
      if (error) { toast({ title: 'Error', description: 'Failed to create profile', variant: 'destructive' }); return; }
    }
    toast({ title: 'Saved', description: 'Profile updated' });
    await fetchProfile();
  };

  return { profile, loading, saveProfile, hasProfile: !!profile && (profile.resume_text.length > 0 || profile.skills.length > 0) };
}
