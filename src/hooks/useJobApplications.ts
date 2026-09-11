import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import type { CoverLetterProfile } from './useCoverLetterProfile';

export interface QA {
  question: string;
  answer: string;
}

export interface MatchAnalysis {
  raw_text: string;
}

export interface JobApplication {
  id: string;
  user_id: string;
  job_title: string;
  company_name: string;
  job_description: string;
  source_url: string | null;
  match_analysis: MatchAnalysis | null;
  questions_answers: QA[];
  cover_letter: string | null;
  custom_notes: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export function useJobApplications() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [applications, setApplications] = useState<JobApplication[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchApplications = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from('job_applications' as any)
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) console.error('Error fetching applications:', error);
    setApplications((data || []) as unknown as JobApplication[]);
    setLoading(false);
  }, [user]);

  useEffect(() => { fetchApplications(); }, [fetchApplications]);

  const saveApplication = async (app: Omit<JobApplication, 'id' | 'created_at' | 'updated_at' | 'user_id'>) => {
    if (!user) return;
    const { error } = await supabase
      .from('job_applications' as any)
      .insert({ ...app, user_id: user.id });
    if (error) { toast({ title: 'Error', description: 'Failed to save application', variant: 'destructive' }); return; }
    await fetchApplications();
  };

  const deleteApplication = async (id: string) => {
    const { error } = await supabase
      .from('job_applications' as any)
      .delete()
      .eq('id', id);
    if (error) { toast({ title: 'Error', description: 'Failed to delete', variant: 'destructive' }); return; }
    await fetchApplications();
  };

  // Streaming helper
  const streamFromFunction = async (
    functionName: string,
    body: Record<string, unknown>,
    onDelta: (text: string) => void,
    onDone: () => void,
  ): Promise<string> => {
    const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${functionName}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: 'Request failed' }));
      toast({ title: 'Error', description: err.error || 'Request failed', variant: 'destructive' });
      onDone();
      return '';
    }

    if (!resp.body) { onDone(); return ''; }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let full = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let idx: number;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        let line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        if (line.endsWith('\r')) line = line.slice(0, -1);
        if (!line.startsWith('data: ')) continue;
        const json = line.slice(6).trim();
        if (json === '[DONE]') break;
        try {
          const parsed = JSON.parse(json);
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) { full += content; onDelta(content); }
        } catch { /* partial json */ }
      }
    }

    onDone();
    return full;
  };

  const analyzeMatch = async (
    profile: CoverLetterProfile,
    jobTitle: string,
    companyName: string,
    jobDescription: string,
    onDelta: (text: string) => void,
    onDone: () => void,
  ) => {
    return streamFromFunction('analyze-job-match', { profile, jobTitle, companyName, jobDescription }, onDelta, onDone);
  };

  const answerQuestion = async (
    profile: CoverLetterProfile,
    jobTitle: string,
    companyName: string,
    jobDescription: string,
    question: string,
    previousQAs: QA[],
    onDelta: (text: string) => void,
    onDone: () => void,
  ) => {
    return streamFromFunction('answer-application-question', { profile, jobTitle, companyName, jobDescription, question, previousQAs }, onDelta, onDone);
  };

  const generateLetter = async (
    profile: CoverLetterProfile,
    jobTitle: string,
    companyName: string,
    jobDescription: string,
    customNotes: string,
    onDelta: (text: string) => void,
    onDone: () => void,
  ) => {
    return streamFromFunction('generate-cover-letter', { profile, jobTitle, companyName, jobDescription, customNotes }, onDelta, onDone);
  };

  const parseJobListing = async (text: string): Promise<{ company_name: string; job_title: string; job_description: string } | null> => {
    const { data, error } = await supabase.functions.invoke('parse-job-listing', { body: { text } });
    if (error || !data?.success) {
      toast({ title: 'Parse failed', description: data?.error || 'Could not extract job details', variant: 'destructive' });
      return null;
    }
    return { company_name: data.company_name, job_title: data.job_title, job_description: data.job_description };
  };

  const scrapeJobUrl = async (url: string): Promise<string> => {
    const { data, error } = await supabase.functions.invoke('scrape-job-listing', { body: { url } });
    if (error || !data?.success) {
      toast({ title: 'Scrape failed', description: data?.error || 'Could not fetch job listing', variant: 'destructive' });
      return '';
    }
    return data.text || '';
  };

  return {
    applications,
    loading,
    saveApplication,
    deleteApplication,
    analyzeMatch,
    answerQuestion,
    generateLetter,
    parseJobListing,
    scrapeJobUrl,
    refetch: fetchApplications,
  };
}
