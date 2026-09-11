import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Copy, Trash2, ChevronDown, ChevronRight, MessageSquare, FileText, BarChart3 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import type { JobApplication } from '@/hooks/useJobApplications';

interface ApplicationHistoryProps {
  applications: JobApplication[];
  onDelete: (id: string) => Promise<void>;
}

export default function ApplicationHistory({ applications, onDelete }: ApplicationHistoryProps) {
  const { toast } = useToast();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedSection, setExpandedSection] = useState<string | null>(null);

  if (applications.length === 0) {
    return <p className="text-sm text-muted-foreground py-8 text-center">No applications yet. Start a new one from the Apply tab.</p>;
  }

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: 'Copied', description: 'Copied to clipboard' });
  };

  return (
    <div className="space-y-2">
      {applications.map((app) => {
        const expanded = expandedId === app.id;
        const qas = app.questions_answers || [];
        const hasMatch = app.match_analysis?.raw_text;
        const hasLetter = app.cover_letter;

        return (
          <div key={app.id} className="border rounded-lg bg-card">
            <button
              onClick={() => setExpandedId(expanded ? null : app.id)}
              className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/50 transition-colors rounded-lg"
            >
              {expanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium">{app.company_name || 'Untitled'}</span>
                {app.job_title && <span className="text-sm text-muted-foreground ml-2">— {app.job_title}</span>}
              </div>
              <div className="flex items-center gap-2">
                {hasMatch && <BarChart3 className="w-3.5 h-3.5 text-muted-foreground" />}
                {qas.length > 0 && <MessageSquare className="w-3.5 h-3.5 text-muted-foreground" />}
                {hasLetter && <FileText className="w-3.5 h-3.5 text-muted-foreground" />}
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {format(new Date(app.created_at), 'dd MMM yyyy')}
                </span>
              </div>
            </button>

            {expanded && (
              <div className="px-4 pb-4 space-y-3">
                {/* Match Analysis */}
                {hasMatch && (
                  <div>
                    <button
                      onClick={() => setExpandedSection(expandedSection === `match-${app.id}` ? null : `match-${app.id}`)}
                      className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground py-1"
                    >
                      <BarChart3 className="w-3.5 h-3.5" />
                      Match Analysis
                      {expandedSection === `match-${app.id}` ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                    </button>
                    {expandedSection === `match-${app.id}` && (
                      <div className="text-sm whitespace-pre-wrap bg-muted/50 rounded-lg p-3 max-h-[400px] overflow-auto mt-1">
                        {app.match_analysis!.raw_text}
                      </div>
                    )}
                  </div>
                )}

                {/* Q&As */}
                {qas.length > 0 && (
                  <div>
                    <button
                      onClick={() => setExpandedSection(expandedSection === `qa-${app.id}` ? null : `qa-${app.id}`)}
                      className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground py-1"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                      Questions & Answers ({qas.length})
                      {expandedSection === `qa-${app.id}` ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                    </button>
                    {expandedSection === `qa-${app.id}` && (
                      <div className="space-y-2 mt-1">
                        {qas.map((qa, idx) => (
                          <div key={idx} className="bg-muted/50 rounded-lg p-3 space-y-1">
                            <p className="text-sm font-medium">{qa.question}</p>
                            <p className="text-sm text-muted-foreground whitespace-pre-wrap">{qa.answer}</p>
                            <Button variant="outline" size="sm" onClick={() => handleCopy(qa.answer)} className="gap-1.5 h-6 text-xs mt-1">
                              <Copy className="w-3 h-3" /> Copy
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Cover Letter */}
                {hasLetter && (
                  <div>
                    <button
                      onClick={() => setExpandedSection(expandedSection === `letter-${app.id}` ? null : `letter-${app.id}`)}
                      className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground py-1"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      Cover Letter
                      {expandedSection === `letter-${app.id}` ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                    </button>
                    {expandedSection === `letter-${app.id}` && (
                      <div className="space-y-2 mt-1">
                        <pre className="text-sm whitespace-pre-wrap bg-muted/50 rounded-lg p-3 max-h-[400px] overflow-auto">
                          {app.cover_letter}
                        </pre>
                        <Button variant="outline" size="sm" onClick={() => handleCopy(app.cover_letter!)} className="gap-1.5 h-7 text-xs">
                          <Copy className="w-3 h-3" /> Copy
                        </Button>
                      </div>
                    )}
                  </div>
                )}

                <div className="pt-1">
                  <Button variant="ghost" size="sm" onClick={() => onDelete(app.id)} className="gap-1.5 text-destructive hover:text-destructive h-7 text-xs">
                    <Trash2 className="w-3 h-3" /> Delete
                  </Button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
