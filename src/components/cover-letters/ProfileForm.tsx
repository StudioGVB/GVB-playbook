import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Save, Sparkles, Loader2, Upload, FileText } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import type { CoverLetterProfile } from '@/hooks/useCoverLetterProfile';

interface ProfileFormProps {
  profile: CoverLetterProfile | null;
  onSave: (updates: Partial<CoverLetterProfile>) => Promise<void>;
}

const toneOptions = ['professional', 'conversational', 'confident', 'formal', 'friendly'];

export default function ProfileForm({ profile, onSave }: ProfileFormProps) {
  const { toast } = useToast();
  const [resumeText, setResumeText] = useState('');
  const [skills, setSkills] = useState('');
  const [projects, setProjects] = useState('');
  const [education, setEducation] = useState('');
  const [personalDetails, setPersonalDetails] = useState('');
  const [interests, setInterests] = useState('');
  const [preferredTone, setPreferredTone] = useState('professional');
  const [saving, setSaving] = useState(false);
  const [rawText, setRawText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (profile) {
      setResumeText(profile.resume_text);
      setSkills(profile.skills);
      setProjects(profile.projects);
      setEducation(profile.education || '');
      setPersonalDetails(profile.personal_details || '');
      setInterests(profile.interests);
      setPreferredTone(profile.preferred_tone);
    }
  }, [profile]);

  const handleSave = async () => {
    setSaving(true);
    await onSave({ resume_text: resumeText, skills, projects, education, personal_details: personalDetails, interests, preferred_tone: preferredTone });
    setSaving(false);
  };

  const applyExtracted = (p: any) => {
    if (p.resume_text) setResumeText(prev => prev ? `${prev}\n\n${p.resume_text}` : p.resume_text);
    if (p.skills) setSkills(prev => prev ? `${prev}, ${p.skills}` : p.skills);
    if (p.projects) setProjects(prev => prev ? `${prev}\n\n${p.projects}` : p.projects);
    if (p.education) setEducation(prev => prev ? `${prev}\n\n${p.education}` : p.education);
    if (p.personal_details) setPersonalDetails(prev => prev ? `${prev}\n${p.personal_details}` : p.personal_details);
    if (p.interests) setInterests(prev => prev ? `${prev}, ${p.interests}` : p.interests);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      toast({ title: 'File too large', description: 'Maximum file size is 10MB.', variant: 'destructive' });
      return;
    }

    const allowedTypes = ['application/pdf', 'text/plain', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    if (!allowedTypes.includes(file.type)) {
      toast({ title: 'Unsupported format', description: 'Please upload a PDF, DOCX, or TXT file.', variant: 'destructive' });
      return;
    }

    setUploadingFile(true);
    setUploadedFileName(file.name);

    try {
      if (file.type === 'text/plain') {
        const text = await file.text();
        const { data, error } = await supabase.functions.invoke('parse-profile-text', { body: { text } });
        if (error || !data?.success) {
          toast({ title: 'Parse failed', description: data?.error || 'Could not extract profile details', variant: 'destructive' });
        } else {
          applyExtracted(data.profile);
          toast({ title: 'Resume parsed!', description: 'Review the extracted details below and save when ready.' });
        }
      } else {
        // PDF or DOCX — send as base64
        const arrayBuffer = await file.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const base64 = btoa(binary);
        const { data, error } = await supabase.functions.invoke('parse-profile-text', {
          body: { file_base64: base64, file_mime_type: file.type },
        });
        if (error || !data?.success) {
          toast({ title: 'Parse failed', description: data?.error || 'Could not extract profile details', variant: 'destructive' });
        } else {
          applyExtracted(data.profile);
          toast({ title: 'Resume parsed!', description: 'Review the extracted details below and save when ready.' });
        }
      }
    } catch (err) {
      toast({ title: 'Error', description: 'Failed to process file', variant: 'destructive' });
    }

    setUploadingFile(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleAutoFill = async () => {
    if (!rawText.trim()) {
      toast({ title: 'Nothing to parse', description: 'Paste your resume or CV text first.', variant: 'destructive' });
      return;
    }
    setParsing(true);
    try {
      const { data, error } = await supabase.functions.invoke('parse-profile-text', {
        body: { text: rawText },
      });
      if (error || !data?.success) {
        toast({ title: 'Parse failed', description: data?.error || 'Could not extract profile details', variant: 'destructive' });
        setParsing(false);
        return;
      }
      applyExtracted(data.profile);
      setRawText('');
      toast({ title: 'Auto-filled!', description: 'Review the extracted details below and save when ready.' });
    } catch (e) {
      toast({ title: 'Error', description: 'Failed to parse text', variant: 'destructive' });
    }
    setParsing(false);
  };

  return (
    <div className="space-y-6">
      {/* Resume Upload section */}
      <div className="rounded-lg border-2 border-dashed border-primary/30 bg-primary/5 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Upload className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-medium">Upload Resume</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          Upload your resume (PDF, DOCX, or TXT). AI will extract and auto-fill all profile fields below.
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
          onChange={handleFileUpload}
          className="hidden"
        />
        <div className="flex items-center gap-3">
          <Button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadingFile}
            variant="outline"
            className="gap-2"
          >
            {uploadingFile ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
            {uploadingFile ? 'Parsing resume...' : 'Choose File'}
          </Button>
          {uploadedFileName && !uploadingFile && (
            <span className="text-xs text-muted-foreground">Last uploaded: {uploadedFileName}</span>
          )}
        </div>
      </div>

      {/* AI Auto-fill section */}
      <div className="rounded-lg border border-dashed border-muted-foreground/30 bg-muted/30 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-medium">AI Auto-Fill</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          Paste your resume, CV, LinkedIn bio, or any text about yourself. AI will extract and fill the fields below.
        </p>
        <Textarea
          value={rawText}
          onChange={(e) => setRawText(e.target.value)}
          placeholder="Paste your resume, CV, or any text describing your experience here..."
          className="min-h-[120px] text-sm"
        />
        <Button onClick={handleAutoFill} disabled={parsing || !rawText.trim()} variant="outline" className="gap-2">
          {parsing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {parsing ? 'Extracting...' : 'Extract & Auto-Fill'}
        </Button>
      </div>

      <p className="text-sm text-muted-foreground">
        Or fill in manually below. This info is used to generate tailored cover letters.
      </p>

      <div className="space-y-2">
        <label className="text-sm font-medium">Personal Details</label>
        <Textarea
          value={personalDetails}
          onChange={(e) => setPersonalDetails(e.target.value)}
          placeholder="Full name, location, phone, email, LinkedIn URL, available start date..."
          className="min-h-[100px] text-sm"
        />
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Resume / Experience</label>
        <Textarea
          value={resumeText}
          onChange={(e) => setResumeText(e.target.value)}
          placeholder="Paste your resume or key experience here..."
          className="min-h-[200px] text-sm"
        />
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Education & Qualifications</label>
        <Textarea
          value={education}
          onChange={(e) => setEducation(e.target.value)}
          placeholder="Degrees, certifications, courses, institutions..."
          className="min-h-[100px] text-sm"
        />
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Skills</label>
        <Textarea
          value={skills}
          onChange={(e) => setSkills(e.target.value)}
          placeholder="React, TypeScript, Node.js, project management..."
          className="min-h-[80px] text-sm"
        />
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Notable Projects</label>
        <Textarea
          value={projects}
          onChange={(e) => setProjects(e.target.value)}
          placeholder="Describe your key projects and what you achieved..."
          className="min-h-[120px] text-sm"
        />
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Interests & Values</label>
        <Textarea
          value={interests}
          onChange={(e) => setInterests(e.target.value)}
          placeholder="What motivates you, culture you thrive in, causes you care about..."
          className="min-h-[80px] text-sm"
        />
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Preferred Tone</label>
        <Select value={preferredTone} onValueChange={setPreferredTone}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {toneOptions.map((t) => (
              <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Button onClick={handleSave} disabled={saving} className="gap-2">
        <Save className="w-4 h-4" />
        {saving ? 'Saving...' : 'Save Profile'}
      </Button>
    </div>
  );
}
