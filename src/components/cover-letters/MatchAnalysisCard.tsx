import { useMemo } from 'react';
import { CheckCircle2, Target, AlertTriangle, HelpCircle, Briefcase, TrendingUp, Star, DollarSign, MapPin, GraduationCap } from 'lucide-react';

interface MatchAnalysisCardProps {
  text: string;
  streaming?: boolean;
}

interface Section {
  icon: React.ReactNode;
  title: string;
  content: string;
  colorClass: string;
  bgClass: string;
}

function parseScore(text: string): number | null {
  const m = text.match(/Match Score:\s*(\d+)\s*\/\s*10/i);
  return m ? parseInt(m[1], 10) : null;
}

function parseSummary(text: string): string {
  const m = text.match(/Match Score:\s*\d+\s*\/\s*10\s*\n+([\s\S]*?)(?=\n##|\n$)/i);
  return m ? m[1].trim() : '';
}

function parseQualificationFit(text: string): number | null {
  const m = text.match(/Qualification\s*Fit:\s*(\d+)\s*\/\s*5/i);
  return m ? parseInt(m[1], 10) : null;
}

function parseCompanySummary(text: string): string {
  const m = text.match(/##\s*🏢\s*Company\s*Summary\s*\n+([\s\S]*?)(?=\n##|\n$)/i);
  return m ? m[1].trim() : '';
}

function parseRoleFunctions(text: string): string[] {
  const m = text.match(/##\s*🏷️\s*Role\s*Functions?:\s*(.+)/i);
  if (!m) return [];
  return m[1].split(',').map(s => s.trim()).filter(Boolean).slice(0, 3);
}

function parseSections(text: string): Section[] {
  const sectionDefs: { pattern: RegExp; icon: React.ReactNode; colorClass: string; bgClass: string }[] = [
    { pattern: /##\s*✅\s*Skills?\s*(?:That\s*)?Overlap([\s\S]*?)(?=\n##|$)/i, icon: <CheckCircle2 className="w-4 h-4" />, colorClass: 'text-emerald-600 dark:text-emerald-400', bgClass: 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800' },
    { pattern: /##\s*🎯\s*Tasks?\s*You'?d?\s*Enjoy([\s\S]*?)(?=\n##|$)/i, icon: <Target className="w-4 h-4" />, colorClass: 'text-blue-600 dark:text-blue-400', bgClass: 'bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800' },
    { pattern: /##\s*⚠️?\s*Gaps?\s*(?:&|and)\s*Stretch\s*Areas?([\s\S]*?)(?=\n##|$)/i, icon: <AlertTriangle className="w-4 h-4" />, colorClass: 'text-amber-600 dark:text-amber-400', bgClass: 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800' },
    { pattern: /##\s*💰\s*Salary\s*(?:&|and)\s*Compensation([\s\S]*?)(?=\n##|$)/i, icon: <DollarSign className="w-4 h-4" />, colorClass: 'text-green-600 dark:text-green-400', bgClass: 'bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800' },
    { pattern: /##\s*📍\s*Work\s*Arrangement([\s\S]*?)(?=\n##|$)/i, icon: <MapPin className="w-4 h-4" />, colorClass: 'text-indigo-600 dark:text-indigo-400', bgClass: 'bg-indigo-50 dark:bg-indigo-950/30 border-indigo-200 dark:border-indigo-800' },
    { pattern: /##\s*🤔\s*Would\s*You\s*Actually\s*Enjoy\s*This\??([\s\S]*?)(?=\n##|$)/i, icon: <HelpCircle className="w-4 h-4" />, colorClass: 'text-purple-600 dark:text-purple-400', bgClass: 'bg-purple-50 dark:bg-purple-950/30 border-purple-200 dark:border-purple-800' },
  ];

  const titles = ['Skills That Overlap', 'Tasks You\'d Enjoy', 'Gaps & Stretch Areas', 'Salary & Compensation', 'Work Arrangement', 'Would You Actually Enjoy This?'];

  return sectionDefs.map((def, i) => {
    const match = text.match(def.pattern);
    return {
      icon: def.icon,
      title: titles[i],
      content: match ? match[1].trim() : '',
      colorClass: def.colorClass,
      bgClass: def.bgClass,
    };
  }).filter(s => s.content.length > 0);
}

function renderContent(content: string) {
  const lines = content.split('\n');
  return lines.map((line, i) => {
    const trimmed = line.trim();
    if (!trimmed) return null;
    // Bullet point
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ') || trimmed.startsWith('• ')) {
      const text = trimmed.replace(/^[-*•]\s*/, '');
      // Bold text within bullets: **text**
      const parts = text.split(/(\*\*[^*]+\*\*)/g);
      return (
        <li key={i} className="text-sm leading-relaxed">
          {parts.map((part, j) => {
            if (part.startsWith('**') && part.endsWith('**')) {
              return <strong key={j} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>;
            }
            return <span key={j}>{part}</span>;
          })}
        </li>
      );
    }
    // Regular paragraph
    const parts = trimmed.split(/(\*\*[^*]+\*\*)/g);
    return (
      <p key={i} className="text-sm leading-relaxed">
        {parts.map((part, j) => {
          if (part.startsWith('**') && part.endsWith('**')) {
            return <strong key={j} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>;
          }
          return <span key={j}>{part}</span>;
        })}
      </p>
    );
  });
}

function parseSalaryType(salaryContent: string): 'quoted' | 'expected' {
  const lower = salaryContent.toLowerCase();
  if (lower.includes('not mentioned') || lower.includes('not specified') || lower.includes('not state') || lower.includes('does not list') || lower.includes('no salary') || lower.includes('estimated') || lower.includes('expect')) {
    return 'expected';
  }
  return 'quoted';
}

function parseHeadlineAndBody(content: string): { headline: string; body: string } {
  // Look for **Headline:** pattern
  const headlineMatch = content.match(/\*\*Headline:\*\*\s*(.+)/i);
  const headline = headlineMatch ? headlineMatch[1].trim() : '';
  const body = content.replace(/\*\*Headline:\*\*\s*.+\n?/i, '').trim();
  // Fallback: first meaningful line if no headline found
  if (!headline) {
    const lines = body.split('\n').map(l => l.trim().replace(/^[-*•]\s*/, '').replace(/\*\*/g, '')).filter(l => l.length > 0);
    return { headline: lines[0]?.slice(0, 40) ?? '', body: lines.slice(1).join('\n') };
  }
  return { headline, body };
}

function ScoreGauge({ score, sections, roleFunctions, qualFit }: { score: number; sections: Section[]; roleFunctions: string[]; qualFit: number | null }) {
  const percentage = (score / 10) * 100;
  const color = score >= 7 ? 'text-emerald-500' : score >= 5 ? 'text-amber-500' : 'text-red-500';
  const strokeColor = score >= 7 ? '#10b981' : score >= 5 ? '#f59e0b' : '#ef4444';

  const skillCount = sections.find(s => s.title === 'Skills That Overlap')?.content.split('\n').filter(l => l.trim().startsWith('-') || l.trim().startsWith('*') || l.trim().startsWith('•')).length ?? 0;
  const gapCount = sections.find(s => s.title === 'Gaps & Stretch Areas')?.content.split('\n').filter(l => l.trim().startsWith('-') || l.trim().startsWith('*') || l.trim().startsWith('•')).length ?? 0;

  const salaryContent = sections.find(s => s.title === 'Salary & Compensation')?.content ?? '';
  const salaryType = parseSalaryType(salaryContent);
  const salary = parseHeadlineAndBody(salaryContent);

  const workContent = sections.find(s => s.title === 'Work Arrangement')?.content ?? '';
  const work = parseHeadlineAndBody(workContent);

  return (
    <div className="space-y-3">
      {/* Three key containers */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Match Score */}
        <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-3">
          <div className="relative w-14 h-14 flex-shrink-0">
            <svg className="w-14 h-14 -rotate-90" viewBox="0 0 64 64">
              <circle cx="32" cy="32" r="28" fill="none" stroke="currentColor" strokeWidth="4" className="text-muted/20" />
              <circle
                cx="32" cy="32" r="28" fill="none"
                stroke={strokeColor} strokeWidth="4"
                strokeDasharray={`${percentage * 1.759} 175.9`}
                strokeLinecap="round"
              />
            </svg>
            <div className={`absolute inset-0 flex items-center justify-center font-bold text-lg ${color}`}>
              {score}
            </div>
          </div>
          <div>
            <div className={`text-base font-bold ${color}`}>
              {score >= 8 ? 'Strong Match' : score >= 6 ? 'Good Match' : score >= 4 ? 'Partial Match' : 'Weak Match'}
            </div>
            <div className="text-xs text-muted-foreground">out of 10</div>
          </div>
        </div>

        {/* Qualification Fit */}
        {qualFit !== null && (
          <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-3">
            <div className="relative w-14 h-14 flex-shrink-0">
              <svg className="w-14 h-14 -rotate-90" viewBox="0 0 64 64">
                <circle cx="32" cy="32" r="28" fill="none" stroke="currentColor" strokeWidth="4" className="text-muted/20" />
                <circle
                  cx="32" cy="32" r="28" fill="none"
                  stroke={qualFit >= 4 ? '#10b981' : qualFit >= 3 ? '#f59e0b' : '#ef4444'} strokeWidth="4"
                  strokeDasharray={`${(qualFit / 5) * 100 * 1.759} 175.9`}
                  strokeLinecap="round"
                />
              </svg>
              <div className={`absolute inset-0 flex items-center justify-center font-bold text-lg ${qualFit >= 4 ? 'text-emerald-500' : qualFit >= 3 ? 'text-amber-500' : 'text-red-500'}`}>
                {qualFit}
              </div>
            </div>
            <div>
              <div className={`text-base font-bold ${qualFit >= 4 ? 'text-emerald-500' : qualFit >= 3 ? 'text-amber-500' : 'text-red-500'}`}>
                {qualFit >= 5 ? 'Overqualified' : qualFit >= 4 ? 'Fully Qualified' : qualFit >= 3 ? 'Mostly Qualified' : qualFit >= 2 ? 'Gaps Present' : 'Under-qualified'}
              </div>
              <div className="text-xs text-muted-foreground">out of 5</div>
            </div>
          </div>
        )}

        {/* Salary */}
        <div className="group rounded-xl border border-border bg-card p-4 space-y-1 cursor-default transition-all duration-200 hover:shadow-md hover:border-primary/30">
          {salary.headline && (
            <div className="text-base font-bold text-foreground leading-tight">{salary.headline}</div>
          )}
          <div className="flex items-center gap-2">
            <DollarSign className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
            <span className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">
              {salaryType === 'quoted' ? 'Quoted in listing' : 'Expected range'}
            </span>
          </div>
          {salary.body && (
            <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2 group-hover:line-clamp-none transition-all duration-200">{salary.body.split('\n')[0]?.replace(/^[-*•]\s*/, '').replace(/\*\*/g, '')}</p>
          )}
        </div>

        {/* Work Arrangement */}
        <div className="group rounded-xl border border-border bg-card p-4 space-y-1 cursor-default transition-all duration-200 hover:shadow-md hover:border-primary/30">
          {work.headline && (
            <div className="text-base font-bold text-foreground leading-tight">{work.headline}</div>
          )}
          <div className="flex items-center gap-2">
            <MapPin className="w-3.5 h-3.5 text-indigo-500 flex-shrink-0" />
            <span className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">Work arrangement</span>
          </div>
          {work.body && (
            <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2 group-hover:line-clamp-none transition-all duration-200">{work.body.split('\n')[0]?.replace(/^[-*•]\s*/, '').replace(/\*\*/g, '')}</p>
          )}
        </div>
      </div>

      {/* Tags row */}
      <div className="flex flex-wrap gap-2">
        {skillCount > 0 && (
          <div className="flex items-center gap-1.5 text-xs bg-muted/50 rounded-full px-2.5 py-1 border border-border/50">
            <Star className="w-3 h-3 text-emerald-500" />
            <span className="font-medium text-foreground">{skillCount}</span>
            <span className="text-muted-foreground">skills match</span>
          </div>
        )}
        {gapCount > 0 && (
          <div className="flex items-center gap-1.5 text-xs bg-muted/50 rounded-full px-2.5 py-1 border border-border/50">
            <TrendingUp className="w-3 h-3 text-amber-500" />
            <span className="font-medium text-foreground">{gapCount}</span>
            <span className="text-muted-foreground">gaps</span>
          </div>
        )}
        {roleFunctions.map((fn, i) => (
          <div key={i} className="flex items-center gap-1.5 text-xs bg-muted/50 rounded-full px-2.5 py-1 border border-border/50">
            <Briefcase className="w-3 h-3 text-primary" />
            <span className="text-muted-foreground">{fn}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
export default function MatchAnalysisCard({ text, streaming }: MatchAnalysisCardProps) {
  const score = useMemo(() => parseScore(text), [text]);
  const summary = useMemo(() => parseSummary(text), [text]);
  const companySummary = useMemo(() => parseCompanySummary(text), [text]);
  const roleFunctions = useMemo(() => parseRoleFunctions(text), [text]);
  const qualFit = useMemo(() => parseQualificationFit(text), [text]);
  const sections = useMemo(() => parseSections(text), [text]);

  // If still streaming and we haven't parsed any sections yet, show raw streaming text
  const hasParsedContent = score !== null || sections.length > 0;

  if (!hasParsedContent) {
    return (
      <div className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
        {text}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Company summary */}
      {companySummary && (
        <p className="text-xs text-muted-foreground italic px-1">{companySummary}</p>
      )}
      {/* Score + Summary */}
      {score !== null && (
        <div className="space-y-2">
          <ScoreGauge score={score} sections={sections} roleFunctions={roleFunctions} qualFit={qualFit} />
          {summary && <p className="text-sm text-muted-foreground leading-relaxed px-1">{summary}</p>}
        </div>
      )}

      {/* Section cards */}
      <div className="grid gap-3">
        {sections.filter(s => s.title !== 'Salary & Compensation' && s.title !== 'Work Arrangement').map((section, i) => (
          <div key={i} className={`rounded-lg border p-4 ${section.bgClass}`}>
            <div className={`flex items-center gap-2 mb-2 font-semibold text-sm ${section.colorClass}`}>
              {section.icon}
              {section.title}
            </div>
            <ul className="space-y-1.5 list-disc list-inside text-muted-foreground marker:text-muted-foreground/40">
              {renderContent(section.content)}
            </ul>
          </div>
        ))}
      </div>

      {/* Show raw tail if streaming and more text is still coming */}
      {streaming && text && (() => {
        const lastSectionEnd = Math.max(
          ...['✅', '🎯', '⚠️', '💰', '📍', '🤔'].map(emoji => {
            const idx = text.lastIndexOf(emoji);
            if (idx === -1) return 0;
            const sectionEnd = text.indexOf('\n##', idx + 1);
            return sectionEnd === -1 ? text.length : sectionEnd;
          })
        );
        const tail = text.slice(lastSectionEnd).trim();
        if (tail && !sections.some(s => tail.startsWith(s.content.slice(0, 20)))) {
          return (
            <div className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed animate-pulse">
              {tail}
            </div>
          );
        }
        return null;
      })()}
    </div>
  );
}
