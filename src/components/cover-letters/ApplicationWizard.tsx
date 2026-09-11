import { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Copy, RefreshCw, Link, Loader2, Sparkles, Download, Pencil, Eye, ArrowRight, ArrowLeft, Plus, Check, MessageSquare, ChevronDown, ChevronUp, Minimize2 } from 'lucide-react';
import MatchAnalysisCard from './MatchAnalysisCard';
import { useToast } from '@/hooks/use-toast';
import type { CoverLetterProfile } from '@/hooks/useCoverLetterProfile';
import type { QA } from '@/hooks/useJobApplications';

interface ApplicationWizardProps {
  profile: CoverLetterProfile;
  onAnalyzeMatch: (
    profile: CoverLetterProfile, jobTitle: string, companyName: string, jobDescription: string,
    onDelta: (text: string) => void, onDone: () => void,
  ) => Promise<string>;
  onAnswerQuestion: (
    profile: CoverLetterProfile, jobTitle: string, companyName: string, jobDescription: string,
    question: string, previousQAs: QA[],
    onDelta: (text: string) => void, onDone: () => void,
  ) => Promise<string>;
  onGenerateLetter: (
    profile: CoverLetterProfile, jobTitle: string, companyName: string, jobDescription: string, customNotes: string,
    onDelta: (text: string) => void, onDone: () => void,
  ) => Promise<string>;
  onSave: (app: {
    job_title: string; company_name: string; job_description: string; source_url: string | null;
    match_analysis: { raw_text: string } | null; questions_answers: QA[];
    cover_letter: string | null; custom_notes: string | null; status: string;
  }) => Promise<void>;
  onParseJob: (text: string) => Promise<{ company_name: string; job_title: string; job_description: string } | null>;
  onScrape: (url: string) => Promise<string>;
}

type Step = 'input' | 'match' | 'questions' | 'cover-letter' | 'done';

function generatePrintHTML(letter: string, profile: CoverLetterProfile, jobTitle: string) {
  const lines = (profile.personal_details || '').split('\n').map(l => l.trim()).filter(Boolean);
  const name = (lines[0] || 'Your Name').replace(/^name:\s*/i, '');
  const emailLine = lines.find(l => l.includes('@')) || '';
  const phoneLine = lines.find(l => /\+?\d[\d\s\-()]{6,}/.test(l)) || '';
  const locationLine = lines.find(l => /(?:located|location|address|city|suburb)/i.test(l)) || lines.find(l => !l.includes('@') && !/\+?\d[\d\s\-()]{6,}/.test(l) && l !== name) || '';
  const linkedinLine = lines.find(l => /linkedin/i.test(l)) || '';
  const today = new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
  
  // Clean markdown bold (**text**) into HTML <strong> tags
  const cleanMarkdown = (text: string) => text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  
  const letterHTML = letter.split('\n\n').map(para => {
    if (para.includes('•') || para.includes('- ')) {
      const bulletLines = para.split('\n').map(line => {
        const cleaned = line.replace(/^[•\-]\s*/, '').trim();
        if (!cleaned) return '';
        const htmlCleaned = cleanMarkdown(cleaned);
        if (line.trim().startsWith('•') || line.trim().startsWith('- ')) return `<li style="margin-bottom:4px;">${htmlCleaned}</li>`;
        return `<p style="margin:0 0 8px 0;">${htmlCleaned}</p>`;
      }).join('');
      return `<ul style="margin:8px 0 8px 20px;padding:0;">${bulletLines}</ul>`;
    }
    return `<p style="margin:0 0 14px 0;line-height:1.6;">${cleanMarkdown(para.replace(/\n/g, '<br>'))}</p>`;
  }).join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Cover Letter - ${name}</title>
<style>@page{margin:0;size:A4}*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Georgia','Times New Roman',serif;color:#333}
.header{background:#2d2d2d;color:white;padding:40px 50px 30px;display:flex;justify-content:space-between;align-items:flex-start}
.header-left h1{font-size:28px;font-weight:700;letter-spacing:3px;text-transform:uppercase;margin-bottom:6px;font-family:'Helvetica Neue',Arial,sans-serif}
.header-left .subtitle{font-size:13px;letter-spacing:1px;color:#ccc;font-family:'Helvetica Neue',Arial,sans-serif}
.header-right{text-align:right;font-size:11px;line-height:1.8;font-family:'Helvetica Neue',Arial,sans-serif}.header-right .label{color:#999;margin-right:6px}
.body{padding:40px 50px 30px;font-size:12px;line-height:1.6}.date{text-align:right;margin-bottom:30px;font-size:12px;color:#555}
.letter-content{font-size:12px}.footer{background:#2d2d2d;height:30px;position:fixed;bottom:0;left:0;right:0}</style></head>
<body><div class="header"><div class="header-left"><h1>${name}</h1><div class="subtitle">${jobTitle || 'Cover Letter'}</div></div>
<div class="header-right">${phoneLine ? `<div><span class="label">T</span> ${phoneLine}</div>` : ''}${emailLine ? `<div><span class="label">E</span> ${emailLine}</div>` : ''}${locationLine ? `<div><span class="label">A</span> ${locationLine}</div>` : ''}${linkedinLine ? `<div><span class="label">L</span> ${linkedinLine}</div>` : ''}</div></div>
<div class="body"><div class="date">${today}</div><div class="letter-content">${letterHTML}</div></div><div class="footer"></div></body></html>`;
}

export default function ApplicationWizard({
  profile, onAnalyzeMatch, onAnswerQuestion, onGenerateLetter, onSave, onParseJob, onScrape,
}: ApplicationWizardProps) {
  const { toast } = useToast();

  const STORAGE_KEY = 'wizard-state';

  // Restore persisted state
  const loadSaved = useCallback(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch { /* ignore */ }
    return null;
  }, []);

  const saved = loadSaved();

  // Step state
  const [step, setStep] = useState<Step>(saved?.step || 'input');

  // Job input
  const [jobTitle, setJobTitle] = useState(saved?.jobTitle || '');
  const [companyName, setCompanyName] = useState(saved?.companyName || '');
  const [jobDescription, setJobDescription] = useState(saved?.jobDescription || '');
  const [sourceUrl, setSourceUrl] = useState(saved?.sourceUrl || '');
  const [dumpText, setDumpText] = useState(saved?.dumpText || '');
  const [parsing, setParsing] = useState(false);
  const [scraping, setScraping] = useState(false);

  // Match analysis
  const [matchText, setMatchText] = useState(saved?.matchText || '');
  const [analyzing, setAnalyzing] = useState(false);

  // Questions
  const [qas, setQas] = useState<QA[]>(saved?.qas || []);
  const [currentQuestion, setCurrentQuestion] = useState(saved?.currentQuestion || '');
  const [currentAnswer, setCurrentAnswer] = useState(saved?.currentAnswer || '');
  const [answering, setAnswering] = useState(false);
  const [editingAnswerIdx, setEditingAnswerIdx] = useState<number | null>(null);

  // Cover letter
  const [coverLetter, setCoverLetter] = useState(saved?.coverLetter || '');
  const [customNotes, setCustomNotes] = useState(saved?.customNotes || '');
  const [generating, setGenerating] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [skipCoverLetter, setSkipCoverLetter] = useState(saved?.skipCoverLetter || false);

  // Saving
  const [saving, setSaving] = useState(false);

  // Quick Paste collapsed
  const [dumpExpanded, setDumpExpanded] = useState(false);

  // Persist wizard state on change
  useEffect(() => {
    if (step === 'done') {
      sessionStorage.removeItem(STORAGE_KEY);
      return;
    }
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
      step, jobTitle, companyName, jobDescription, sourceUrl, dumpText,
      matchText, qas, currentQuestion, currentAnswer,
      coverLetter, customNotes, skipCoverLetter,
    }));
  }, [step, jobTitle, companyName, jobDescription, sourceUrl, dumpText, matchText, qas, currentQuestion, currentAnswer, coverLetter, customNotes, skipCoverLetter]);

  const handleParseDump = async () => {
    if (!dumpText.trim()) return;
    setParsing(true);
    const result = await onParseJob(dumpText);
    if (result) {
      setCompanyName(result.company_name);
      setJobTitle(result.job_title);
      setJobDescription(result.job_description);
      toast({ title: 'Auto-filled!', description: `Extracted details for ${result.job_title} at ${result.company_name}` });
    }
    setParsing(false);
  };

  const handleScrape = async () => {
    if (!sourceUrl) return;
    setScraping(true);
    const text = await onScrape(sourceUrl);
    if (text) setJobDescription(text);
    setScraping(false);
  };

  const goToMatch = async () => {
    // If user has dump text but no job description, auto-fill first
    let desc = jobDescription;
    let title = jobTitle;
    let company = companyName;

    if (!desc && dumpText.trim()) {
      // Auto-parse the dump text first
      const parsed = await onParseJob(dumpText);
      if (parsed) {
        desc = parsed.job_description; setJobDescription(parsed.job_description);
        if (!title.trim()) { title = parsed.job_title; setJobTitle(parsed.job_title); }
        if (!company.trim()) { company = parsed.company_name; setCompanyName(parsed.company_name); }
      } else {
        // Fallback: use dump text as raw description
        desc = dumpText; setJobDescription(dumpText);
      }
    }

    if (!desc && !company) {
      toast({ title: 'Missing info', description: 'Add a job description or company name', variant: 'destructive' });
      return;
    }

    // Auto-extract company & title from description if still missing
    if (desc && (!title.trim() || !company.trim())) {
      const parsed = await onParseJob(desc);
      if (parsed) {
        if (!title.trim()) { title = parsed.job_title; setJobTitle(parsed.job_title); }
        if (!company.trim()) { company = parsed.company_name; setCompanyName(parsed.company_name); }
      }
    }

    setStep('match');
    setAnalyzing(true);
    setMatchText('');
    let full = '';
    await onAnalyzeMatch(
      profile, title, company, desc,
      (delta) => { full += delta; setMatchText(full); },
      () => setAnalyzing(false),
    );
  };

  const handleAnswerQuestion = async () => {
    if (!currentQuestion.trim()) return;
    setAnswering(true);
    setCurrentAnswer('');
    let full = '';
    await onAnswerQuestion(
      profile, jobTitle, companyName, jobDescription, currentQuestion, qas,
      (delta) => { full += delta; setCurrentAnswer(full); },
      () => setAnswering(false),
    );
  };

  const saveCurrentQA = () => {
    if (!currentQuestion.trim() || !currentAnswer.trim()) return;
    setQas(prev => [...prev, { question: currentQuestion, answer: currentAnswer }]);
    setCurrentQuestion('');
    setCurrentAnswer('');
  };

  const removeQA = (idx: number) => {
    setQas(prev => prev.filter((_, i) => i !== idx));
  };

  const handleGenerateLetter = async (shortenExisting?: boolean) => {
    setGenerating(true);
    if (!shortenExisting) setCoverLetter('');
    setEditMode(false);
    let full = '';
    const notes = shortenExisting
      ? `IMPORTANT: Shorten this existing cover letter to under 250 words while keeping the key points. Keep it plain text with no markdown formatting.\n\nExisting letter:\n${coverLetter}\n\n${customNotes || ''}`
      : customNotes;
    await onGenerateLetter(
      profile, jobTitle, companyName, jobDescription, notes,
      (delta) => { full += delta; setCoverLetter(full); },
      () => setGenerating(false),
    );
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: 'Copied', description: 'Copied to clipboard' });
  };

  const handleDownloadPDF = () => {
    const html = generatePrintHTML(coverLetter, profile, jobTitle);
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      toast({ title: 'Popup blocked', description: 'Please allow popups to download the PDF', variant: 'destructive' });
      return;
    }
    printWindow.document.write(html);
    printWindow.document.close();
    setTimeout(() => printWindow.print(), 500);
  };

  const handleFinish = async () => {
    setSaving(true);
    await onSave({
      job_title: jobTitle,
      company_name: companyName,
      job_description: jobDescription,
      source_url: sourceUrl || null,
      match_analysis: matchText ? { raw_text: matchText } : null,
      questions_answers: qas,
      cover_letter: coverLetter || null,
      custom_notes: customNotes || null,
      status: 'completed',
    });
    setSaving(false);
    setStep('done');
    toast({ title: 'Application saved!', description: `${jobTitle} at ${companyName} added to history` });
  };

  const resetWizard = () => {
    sessionStorage.removeItem(STORAGE_KEY);
    setStep('input');
    setJobTitle(''); setCompanyName(''); setJobDescription(''); setSourceUrl(''); setDumpText('');
    setMatchText(''); setQas([]); setCurrentQuestion(''); setCurrentAnswer('');
    setCoverLetter(''); setCustomNotes(''); setSkipCoverLetter(false);
  };

  // Step indicators
  const steps: { key: Step; label: string }[] = [
    { key: 'input', label: 'Job Details' },
    { key: 'match', label: 'Match Analysis' },
    { key: 'questions', label: 'Questions' },
    { key: 'cover-letter', label: 'Cover Letter' },
  ];

  const stepIndex = steps.findIndex(s => s.key === step);

  return (
    <div className="space-y-6">
      {/* Step indicator */}
      {step !== 'done' && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1 text-xs">
            {steps.map((s, i) => (
              <div key={s.key} className="flex items-center gap-1">
                <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full transition-colors ${
                  i === stepIndex ? 'bg-primary text-primary-foreground font-medium' :
                  i < stepIndex ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'
                }`}>
                  {i < stepIndex ? <Check className="w-3 h-3" /> : <span>{i + 1}</span>}
                  <span className="hidden sm:inline">{s.label}</span>
                </div>
                {i < steps.length - 1 && <div className="w-4 h-px bg-border" />}
              </div>
            ))}
          </div>
          {step !== 'input' && (
            <Button variant="ghost" size="sm" onClick={resetWizard} className="text-muted-foreground hover:text-destructive text-xs h-7">
              Cancel
            </Button>
          )}
        </div>
      )}

      {/* STEP 1: Job Input */}
      {step === 'input' && (
        <div className="space-y-6">
          <div className="border rounded-lg bg-muted/30 overflow-hidden">
            <button
              type="button"
              onClick={() => setDumpExpanded(v => !v)}
              className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium hover:bg-muted/50 transition-colors"
            >
              <span className="flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-primary" />
                Quick Paste — dump a job listing
              </span>
              {dumpExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
            </button>
            {dumpExpanded && (
              <div className="px-4 pb-4 space-y-2">
                <Textarea
                  value={dumpText}
                  onChange={(e) => setDumpText(e.target.value)}
                  placeholder="Paste the full job listing text here and click Auto-Fill..."
                  className="min-h-[120px] text-sm"
                  autoFocus
                />
                <Button variant="outline" size="sm" onClick={handleParseDump} disabled={parsing || !dumpText.trim()} className="gap-1.5">
                  {parsing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                  {parsing ? 'Extracting...' : 'Auto-Fill'}
                </Button>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Job URL (optional)</label>
            <div className="flex gap-2">
              <Input value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://careers.example.com/job/..." className="flex-1 text-sm" />
              <Button variant="outline" size="sm" onClick={handleScrape} disabled={scraping || !sourceUrl} className="gap-1.5">
                {scraping ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link className="w-3.5 h-3.5" />}
                {scraping ? 'Fetching...' : 'Fetch'}
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Company Name</label>
              <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Acme Corp" className="text-sm" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Job Title</label>
              <Input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder="Senior Frontend Engineer" className="text-sm" />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Job Description</label>
            <Textarea value={jobDescription} onChange={(e) => setJobDescription(e.target.value)} placeholder="Paste the job listing here..." className="min-h-[160px] text-sm" />
          </div>

          <Button onClick={goToMatch} disabled={analyzing} className="gap-2">
            <ArrowRight className="w-4 h-4" /> Analyse Match
          </Button>
        </div>
      )}

      {/* STEP 2: Match Analysis */}
      {step === 'match' && (
        <div className="space-y-4">
          <div className="border rounded-lg p-5 bg-card">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-base font-semibold">{jobTitle}</h3>
                <p className="text-sm text-muted-foreground">{companyName}</p>
              </div>
              {!analyzing && matchText && (
                <Button variant="outline" size="sm" onClick={() => handleCopy(matchText)} className="gap-1.5 h-7">
                  <Copy className="w-3 h-3" /> Copy
                </Button>
              )}
            </div>
            {analyzing && !matchText && (
              <div className="flex items-center gap-2 text-muted-foreground py-6 justify-center">
                <Loader2 className="w-4 h-4 animate-spin" /> Analysing your match...
              </div>
            )}
            {matchText && (
              <MatchAnalysisCard text={matchText} streaming={analyzing} />
            )}
          </div>

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep('input')} className="gap-2">
              <ArrowLeft className="w-4 h-4" /> Back
            </Button>
            <Button onClick={() => setStep('questions')} disabled={analyzing} className="gap-2">
              <ArrowRight className="w-4 h-4" /> Application Questions
            </Button>
          </div>
        </div>
      )}

      {/* STEP 3: Application Questions */}
      {step === 'questions' && (
        <div className="space-y-4">
          {/* Saved Q&As */}
          {qas.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Answered Questions ({qas.length})</h3>
              {qas.map((qa, idx) => (
                <div key={idx} className="border rounded-lg p-3 bg-card space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium">{qa.question}</p>
                    <Button variant="ghost" size="sm" className="h-6 text-xs text-destructive hover:text-destructive shrink-0" onClick={() => removeQA(idx)}>Remove</Button>
                  </div>
                  {editingAnswerIdx === idx ? (
                    <div className="space-y-2">
                      <Textarea
                        value={qas[idx].answer}
                        onChange={(e) => {
                          const updated = [...qas];
                          updated[idx] = { ...updated[idx], answer: e.target.value };
                          setQas(updated);
                        }}
                        className="text-sm min-h-[100px]"
                      />
                      <Button variant="outline" size="sm" onClick={() => setEditingAnswerIdx(null)} className="h-7 text-xs">Done</Button>
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground whitespace-pre-wrap cursor-pointer hover:bg-muted/50 rounded p-1 -m-1" onClick={() => setEditingAnswerIdx(idx)}>
                      {qa.answer}
                    </div>
                  )}
                  <Button variant="outline" size="sm" onClick={() => handleCopy(qa.answer)} className="gap-1.5 h-7 text-xs">
                    <Copy className="w-3 h-3" /> Copy
                  </Button>
                </div>
              ))}
            </div>
          )}

          {/* Current Q&A */}
          <div className="border rounded-lg p-4 bg-muted/30 space-y-3">
            <label className="text-sm font-medium flex items-center gap-1.5">
              <MessageSquare className="w-4 h-4 text-primary" />
              {qas.length === 0 ? 'Paste an application question' : 'Answer another question'}
            </label>
            <Textarea
              value={currentQuestion}
              onChange={(e) => setCurrentQuestion(e.target.value)}
              placeholder="e.g. Why do you want to work at our company?"
              className="min-h-[80px] text-sm"
            />
            <Button variant="outline" size="sm" onClick={handleAnswerQuestion} disabled={answering || !currentQuestion.trim()} className="gap-1.5">
              {answering ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {answering ? 'Generating...' : 'Generate Answer'}
            </Button>

            {/* Streamed answer */}
            {(currentAnswer || answering) && (
              <div className="border rounded-lg p-3 bg-card space-y-2">
                <div className="text-sm whitespace-pre-wrap leading-relaxed">
                  {answering && !currentAnswer && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> Writing answer...
                    </div>
                  )}
                  {currentAnswer}
                </div>
                {!answering && currentAnswer && (
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={saveCurrentQA} className="gap-1.5 h-7 text-xs">
                      <Check className="w-3 h-3" /> Save & Continue
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => handleCopy(currentAnswer)} className="gap-1.5 h-7 text-xs">
                      <Copy className="w-3 h-3" /> Copy
                    </Button>
                    <Button variant="ghost" size="sm" onClick={handleAnswerQuestion} className="gap-1.5 h-7 text-xs">
                      <RefreshCw className="w-3 h-3" /> Regenerate
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep('match')} className="gap-2">
              <ArrowLeft className="w-4 h-4" /> Back
            </Button>
            <Button onClick={() => setStep('cover-letter')} className="gap-2">
              <ArrowRight className="w-4 h-4" /> Cover Letter
            </Button>
          </div>
        </div>
      )}

      {/* STEP 4: Cover Letter */}
      {step === 'cover-letter' && (
        <div className="space-y-4">
          {!skipCoverLetter ? (
            <>
              <div className="space-y-2">
                <label className="text-sm font-medium">Custom Notes (optional)</label>
                <Input value={customNotes} onChange={(e) => setCustomNotes(e.target.value)} placeholder="e.g. Emphasise React, mention relocating to London" className="text-sm" />
              </div>

              {!coverLetter && !generating && (
                <div className="flex gap-2">
                  <Button onClick={() => handleGenerateLetter()} className="gap-2">
                    <Sparkles className="w-4 h-4" /> Generate Cover Letter
                  </Button>
                  <Button variant="outline" onClick={() => { setSkipCoverLetter(true); }} className="gap-2">
                    Skip — no cover letter needed
                  </Button>
                </div>
              )}

              {(coverLetter || generating) && (
                <div className="space-y-3 border rounded-lg p-4 bg-card">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <span className="text-sm font-medium">Generated Letter</span>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" onClick={() => setEditMode(!editMode)} className="gap-1.5 h-8">
                        {editMode ? <Eye className="w-3.5 h-3.5" /> : <Pencil className="w-3.5 h-3.5" />}
                        {editMode ? 'Preview' : 'Edit'}
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => handleCopy(coverLetter)} className="gap-1.5 h-8">
                        <Copy className="w-3.5 h-3.5" /> Copy
                      </Button>
                      <Button variant="outline" size="sm" onClick={handleDownloadPDF} disabled={!coverLetter} className="gap-1.5 h-8">
                        <Download className="w-3.5 h-3.5" /> PDF
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => handleGenerateLetter()} disabled={generating} className="gap-1.5 h-8">
                        <RefreshCw className="w-3.5 h-3.5" /> Regenerate
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => handleGenerateLetter(true)} disabled={generating || !coverLetter} className="gap-1.5 h-8">
                        <Minimize2 className="w-3.5 h-3.5" /> Shorten
                      </Button>
                    </div>
                  </div>
                  {editMode ? (
                    <Textarea value={coverLetter} onChange={(e) => setCoverLetter(e.target.value)} className="min-h-[400px] text-sm" />
                  ) : (
                    <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap text-sm leading-relaxed py-2">
                      {generating && !coverLetter && <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Generating...</div>}
                      {coverLetter}
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="border rounded-lg p-4 bg-muted/30 text-sm text-muted-foreground">
              No cover letter for this application.
            </div>
          )}

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => { setSkipCoverLetter(false); setStep('questions'); }} className="gap-2">
              <ArrowLeft className="w-4 h-4" /> Back
            </Button>
            <Button onClick={handleFinish} disabled={saving || generating} className="gap-2">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              Finish & Save
            </Button>
          </div>
        </div>
      )}

      {/* STEP 5: Done */}
      {step === 'done' && (
        <div className="border rounded-lg p-8 bg-card text-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
            <Check className="w-6 h-6 text-primary" />
          </div>
          <h3 className="text-lg font-semibold">Application Saved</h3>
          <p className="text-sm text-muted-foreground">
            {jobTitle} at {companyName} has been saved to your history.
          </p>
          <Button onClick={resetWizard} className="gap-2">
            <Plus className="w-4 h-4" /> Start New Application
          </Button>
        </div>
      )}
    </div>
  );
}
