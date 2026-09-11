import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Copy, RefreshCw, Link, Loader2, Sparkles, Download, Pencil, Eye } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { CoverLetterProfile } from '@/hooks/useCoverLetterProfile';

interface GenerateFormProps {
  profile: CoverLetterProfile;
  onGenerate: (
    profile: CoverLetterProfile,
    jobTitle: string,
    companyName: string,
    jobDescription: string,
    customNotes: string,
    onDelta: (text: string) => void,
    onDone: () => void,
  ) => Promise<string>;
  onSave: (letter: {
    job_title: string;
    company_name: string;
    job_description: string;
    source_url: string | null;
    custom_notes: string | null;
    generated_letter: string;
  }) => Promise<void>;
  onScrape: (url: string) => Promise<string>;
  onParseJob: (text: string) => Promise<{ company_name: string; job_title: string; job_description: string } | null>;
}

function generatePrintHTML(letter: string, profile: CoverLetterProfile, jobTitle: string) {
  // Parse personal details for header
  const lines = (profile.personal_details || '').split('\n').map(l => l.trim()).filter(Boolean);
  const name = lines[0] || 'Your Name';
  
  // Try to extract contact info
  const emailLine = lines.find(l => l.includes('@')) || '';
  const phoneLine = lines.find(l => /\+?\d[\d\s\-()]{6,}/.test(l)) || '';
  const locationLine = lines.find(l => /(?:located|location|address|city|suburb)/i.test(l)) || lines.find(l => !l.includes('@') && !/\+?\d[\d\s\-()]{6,}/.test(l) && l !== name) || '';
  const linkedinLine = lines.find(l => /linkedin/i.test(l)) || '';

  const today = new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });

  // Convert letter text to HTML paragraphs
  const letterHTML = letter
    .split('\n\n')
    .map(para => {
      // Handle bullet points
      if (para.includes('•') || para.includes('- ')) {
        const bulletLines = para.split('\n').map(line => {
          const cleaned = line.replace(/^[•\-]\s*/, '').trim();
          if (!cleaned) return '';
          if (line.trim().startsWith('•') || line.trim().startsWith('- ')) {
            return `<li style="margin-bottom:4px;">${cleaned}</li>`;
          }
          return `<p style="margin:0 0 8px 0;">${cleaned}</p>`;
        }).join('');
        return `<ul style="margin:8px 0 8px 20px;padding:0;">${bulletLines}</ul>`;
      }
      return `<p style="margin:0 0 14px 0;line-height:1.6;">${para.replace(/\n/g, '<br>')}</p>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Cover Letter - ${name}</title>
  <style>
    @page { margin: 0; size: A4; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Georgia', 'Times New Roman', serif; color: #333; }
    .header {
      background: #2d2d2d;
      color: white;
      padding: 40px 50px 30px;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
    }
    .header-left h1 {
      font-size: 28px;
      font-weight: 700;
      letter-spacing: 3px;
      text-transform: uppercase;
      margin-bottom: 6px;
      font-family: 'Helvetica Neue', Arial, sans-serif;
    }
    .header-left .subtitle {
      font-size: 13px;
      letter-spacing: 1px;
      color: #ccc;
      font-family: 'Helvetica Neue', Arial, sans-serif;
    }
    .header-right {
      text-align: right;
      font-size: 11px;
      line-height: 1.8;
      font-family: 'Helvetica Neue', Arial, sans-serif;
    }
    .header-right .label {
      color: #999;
      margin-right: 6px;
    }
    .body {
      padding: 40px 50px 30px;
      font-size: 12px;
      line-height: 1.6;
    }
    .date {
      text-align: right;
      margin-bottom: 30px;
      font-size: 12px;
      color: #555;
    }
    .letter-content {
      font-size: 12px;
    }
    .footer {
      background: #2d2d2d;
      height: 30px;
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-left">
      <h1>${name}</h1>
      <div class="subtitle">${jobTitle || 'Cover Letter'}</div>
    </div>
    <div class="header-right">
      ${phoneLine ? `<div><span class="label">T</span> ${phoneLine}</div>` : ''}
      ${emailLine ? `<div><span class="label">E</span> ${emailLine}</div>` : ''}
      ${locationLine ? `<div><span class="label">A</span> ${locationLine}</div>` : ''}
      ${linkedinLine ? `<div><span class="label">L</span> ${linkedinLine}</div>` : ''}
    </div>
  </div>
  <div class="body">
    <div class="date">${today}</div>
    <div class="letter-content">
      ${letterHTML}
    </div>
  </div>
  <div class="footer"></div>
</body>
</html>`;
}

export default function GenerateForm({ profile, onGenerate, onSave, onScrape, onParseJob }: GenerateFormProps) {
  const { toast } = useToast();
  const [jobTitle, setJobTitle] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [jobDescription, setJobDescription] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [customNotes, setCustomNotes] = useState('');
  const [generatedLetter, setGeneratedLetter] = useState('');
  const [generating, setGenerating] = useState(false);
  const [scraping, setScraping] = useState(false);

  // AI Dump state
  const [dumpText, setDumpText] = useState('');
  const [parsing, setParsing] = useState(false);

  // View mode for output
  const [editMode, setEditMode] = useState(false);

  const wordCount = generatedLetter.trim().split(/\s+/).filter(Boolean).length;

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

  const handleGenerate = async () => {
    if (!jobDescription && !companyName) {
      toast({ title: 'Missing info', description: 'Add a job description or company name', variant: 'destructive' });
      return;
    }
    setGenerating(true);
    setGeneratedLetter('');
    setEditMode(false);
    let full = '';

    const result = await onGenerate(
      profile,
      jobTitle,
      companyName,
      jobDescription,
      customNotes,
      (delta) => {
        full += delta;
        setGeneratedLetter(full);
      },
      () => setGenerating(false),
    );

    if (result) {
      await onSave({
        job_title: jobTitle,
        company_name: companyName,
        job_description: jobDescription,
        source_url: sourceUrl || null,
        custom_notes: customNotes || null,
        generated_letter: result,
      });
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(generatedLetter);
    toast({ title: 'Copied', description: 'Cover letter copied to clipboard' });
  };

  const handleDownloadPDF = () => {
    const html = generatePrintHTML(generatedLetter, profile, jobTitle);
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      toast({ title: 'Popup blocked', description: 'Please allow popups to download the PDF', variant: 'destructive' });
      return;
    }
    printWindow.document.write(html);
    printWindow.document.close();
    setTimeout(() => printWindow.print(), 500);
  };

  return (
    <div className="space-y-6">
      {/* AI Dump */}
      <div className="space-y-2 border rounded-lg p-4 bg-muted/30">
        <label className="text-sm font-medium flex items-center gap-1.5">
          <Sparkles className="w-4 h-4 text-primary" />
          Quick Paste — dump a job listing here
        </label>
        <Textarea
          value={dumpText}
          onChange={(e) => setDumpText(e.target.value)}
          placeholder="Paste the full job listing text here and click Auto-Fill to extract the company name, job title, and description automatically..."
          className="min-h-[120px] text-sm"
        />
        <Button
          variant="outline"
          size="sm"
          onClick={handleParseDump}
          disabled={parsing || !dumpText.trim()}
          className="gap-1.5"
        >
          {parsing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
          {parsing ? 'Extracting...' : 'Auto-Fill'}
        </Button>
      </div>

      {/* URL scraper */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Job URL (optional)</label>
        <div className="flex gap-2">
          <Input
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            placeholder="https://careers.example.com/job/..."
            className="flex-1 text-sm"
          />
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
        <Textarea
          value={jobDescription}
          onChange={(e) => setJobDescription(e.target.value)}
          placeholder="Paste the job listing here..."
          className="min-h-[160px] text-sm"
        />
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Custom Notes (optional)</label>
        <Input
          value={customNotes}
          onChange={(e) => setCustomNotes(e.target.value)}
          placeholder="e.g. Emphasise my React experience, mention I'm relocating to London"
          className="text-sm"
        />
      </div>

      <Button onClick={handleGenerate} disabled={generating} className="gap-2">
        {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
        {generating ? 'Generating...' : 'Generate Cover Letter'}
      </Button>

      {/* Output */}
      {(generatedLetter || generating) && (
        <div className="space-y-3 border rounded-lg p-4 bg-card">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium">Generated Letter</span>
              <span className="text-xs text-muted-foreground">{wordCount} words</span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditMode(!editMode)}
                className="gap-1.5 h-8"
              >
                {editMode ? <Eye className="w-3.5 h-3.5" /> : <Pencil className="w-3.5 h-3.5" />}
                {editMode ? 'Preview' : 'Edit'}
              </Button>
              <Button variant="outline" size="sm" onClick={handleCopy} className="gap-1.5 h-8">
                <Copy className="w-3.5 h-3.5" /> Copy Text
              </Button>
              <Button variant="outline" size="sm" onClick={handleDownloadPDF} disabled={!generatedLetter} className="gap-1.5 h-8">
                <Download className="w-3.5 h-3.5" /> Download PDF
              </Button>
              <Button variant="ghost" size="sm" onClick={handleGenerate} disabled={generating} className="gap-1.5 h-8">
                <RefreshCw className="w-3.5 h-3.5" /> Regenerate
              </Button>
            </div>
          </div>

          {editMode ? (
            <Textarea
              value={generatedLetter}
              onChange={(e) => setGeneratedLetter(e.target.value)}
              className="min-h-[400px] text-sm"
            />
          ) : (
            <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap text-sm leading-relaxed py-2">
              {generatedLetter}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
