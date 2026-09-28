import { useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Bot, 
  Download, 
  FileSpreadsheet, 
  FileText, 
  Copy, 
  Check, 
  Printer, 
  Sparkles, 
  Calendar, 
  Scale, 
  DollarSign, 
  ShieldCheck,
  Zap,
  Info
} from 'lucide-react';
import { toast } from 'sonner';
import { useFinanceData } from '@/hooks/useFinanceData';
import { useFinanceAssumptions } from '@/hooks/useFinanceAssumptions';
import { useFixedExpenses } from '@/hooks/useFixedExpenses';
import { useWeeklyBoosts } from '@/hooks/useWeeklyBoosts';
import { useWeekTypes } from '@/hooks/useWeekTypes';
import { computePolicySnapshot } from '@/lib/policyEngine';
import { 
  generate3MonthReportData, 
  generateAIMasterPrompt, 
  generateCSVReport, 
  downloadFile, 
  printPDFReport 
} from '@/lib/exportFinancialReport';

interface Props {
  trigger?: React.ReactNode;
}

export default function FinancialReportExporterModal({ trigger }: Props) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const finance = useFinanceData();
  const { assumptions } = useFinanceAssumptions();
  const { expenses: fixedExpenses, monthlyTotalInternal: fixedExpensesMonthly, monthlyTotal: fixedExpensesMonthlyAll } = useFixedExpenses();
  const { totalBoostThisWeek } = useWeeklyBoosts();
  const { weekTypeMap: wtMap } = useWeekTypes();

  const snapshot = useMemo(() => {
    if (!assumptions) return null;
    return computePolicySnapshot(
      assumptions,
      finance.accounts,
      finance.transactions,
      finance.categories,
      finance.goals,
      finance.convertToBase,
      fixedExpensesMonthly,
      totalBoostThisWeek,
      typeof wtMap === 'function' ? wtMap() : wtMap,
      [],
      fixedExpensesMonthlyAll
    );
  }, [assumptions, finance.accounts, finance.transactions, finance.categories, finance.goals, finance.convertToBase, fixedExpensesMonthly, fixedExpensesMonthlyAll, totalBoostThisWeek, wtMap]);

  const reportData = useMemo(() => {
    return generate3MonthReportData({
      finance,
      assumptions,
      fixedExpenses,
      snapshot
    });
  }, [finance, assumptions, fixedExpenses, snapshot]);

  const aiPromptMarkdown = useMemo(() => {
    return generateAIMasterPrompt(reportData);
  }, [reportData]);

  const csvContent = useMemo(() => {
    return generateCSVReport(reportData);
  }, [reportData]);

  const handleCopyPrompt = () => {
    navigator.clipboard.writeText(aiPromptMarkdown);
    setCopied(true);
    toast.success('AI Financial Prompt copied to clipboard! Ready to paste into ChatGPT or Claude.');
    setTimeout(() => setCopied(false), 2500);
  };

  const handleDownloadCSV = () => {
    const filename = `GVB_3Month_Financial_Report_${reportData.startDateStr}_to_${reportData.endDateStr}.csv`;
    downloadFile(csvContent, filename, 'text/csv;charset=utf-8;');
    toast.success(`Downloaded ${filename} for Excel / Google Sheets!`);
  };

  const handlePrintPDF = () => {
    printPDFReport(reportData);
    toast.info('Opened printable PDF report window');
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button
            size="sm"
            className="bg-gradient-to-r from-pink-600 to-rose-500 hover:from-pink-700 hover:to-rose-600 text-white font-bold rounded-2xl px-4 shadow-lg shadow-pink-500/20 gap-2 transition-all"
          >
            <Bot className="w-4 h-4 animate-bounce" />
            Export 3-Mo AI Financial Report
          </Button>
        )}
      </DialogTrigger>

      <DialogContent className="max-w-4xl max-h-[90vh] rounded-3xl p-6 sm:p-8 overflow-hidden font-body bg-white dark:bg-slate-900 border border-pink-200/50">
        <DialogHeader className="border-b border-slate-100 dark:border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-pink-500 to-rose-500 text-white flex items-center justify-center shadow-lg shadow-pink-500/20 shrink-0">
              <Bot className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <DialogTitle className="text-xl font-bold text-slate-900 dark:text-white">
                  3-Month AI Financial Report & Exporter
                </DialogTitle>
                <Badge className="bg-pink-100 text-pink-700 dark:bg-pink-950 dark:text-pink-300 font-bold border-pink-200 text-xs">
                  AI Ready
                </Badge>
              </div>
              <DialogDescription className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Export comprehensive 90-day financial data (income, rent due 1st, Gamma pay last day, fixed bills, pools) for AI bots or spreadsheets.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Export Options Tabs */}
        <Tabs defaultValue="copy-ai" className="w-full mt-4">
          <TabsList className="grid grid-cols-4 w-full bg-slate-100 dark:bg-slate-800/80 p-1.5 rounded-2xl">
            <TabsTrigger value="copy-ai" className="rounded-xl text-xs font-bold gap-1.5">
              <Bot className="w-4 h-4 text-[#FF2EB8]" />
              Copy AI Prompt
            </TabsTrigger>
            <TabsTrigger value="pdf" className="rounded-xl text-xs font-bold gap-1.5">
              <FileText className="w-4 h-4 text-rose-500" />
              Save PDF
            </TabsTrigger>
            <TabsTrigger value="csv" className="rounded-xl text-xs font-bold gap-1.5">
              <FileSpreadsheet className="w-4 h-4 text-emerald-500" />
              CSV Spreadsheet
            </TabsTrigger>
            <TabsTrigger value="preview" className="rounded-xl text-xs font-bold gap-1.5">
              <Sparkles className="w-4 h-4 text-amber-500" />
              3-Mo Summary
            </TabsTrigger>
          </TabsList>

          {/* TAB 1: Copy AI Prompt */}
          <TabsContent value="copy-ai" className="space-y-4 pt-4">
            <div className="bg-pink-50/70 dark:bg-pink-950/30 border border-pink-200/60 rounded-2xl p-4 flex items-start gap-3">
              <Bot className="w-5 h-5 text-[#FF2EB8] shrink-0 mt-0.5" />
              <div className="space-y-1">
                <h4 className="text-sm font-bold text-slate-900 dark:text-white">Formated for ChatGPT, Claude, and Gemini</h4>
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  Copy this master prompt into any AI bot. It includes your 3-month income, Gamma pay schedule (last day of month), Rent schedule (1st of month), itemized transactions, and active savings pools.
                </p>
              </div>
            </div>

            <div className="relative">
              <ScrollArea className="h-64 w-full rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-950 text-slate-100 p-4 font-mono text-xs">
                <pre className="whitespace-pre-wrap">{aiPromptMarkdown}</pre>
              </ScrollArea>
            </div>

            <div className="flex items-center justify-between pt-2">
              <span className="text-xs text-slate-500">
                Period: <strong>{reportData.startDateStr}</strong> to <strong>{reportData.endDateStr}</strong> ({reportData.recentTxns.length} txns)
              </span>

              <Button
                onClick={handleCopyPrompt}
                className="bg-[#FF2EB8] hover:bg-[#FF2EB8]/90 text-white font-bold rounded-xl px-5 shadow-lg shadow-pink-500/20 gap-2"
              >
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {copied ? 'Copied Master AI Prompt!' : 'Copy AI Master Prompt'}
              </Button>
            </div>
          </TabsContent>

          {/* TAB 2: Save / Print PDF */}
          <TabsContent value="pdf" className="space-y-4 pt-4">
            <div className="bg-rose-50/70 dark:bg-rose-950/30 border border-rose-200/60 rounded-2xl p-4 flex items-start gap-3">
              <Printer className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <h4 className="text-sm font-bold text-slate-900 dark:text-white">Printable Document & PDF Export</h4>
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  Opens a formatted report window with charts, metric tables, and upcoming pools ready to save as a PDF document.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Card className="border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 rounded-2xl p-4">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">Report Window</span>
                <span className="text-base font-bold text-slate-900 dark:text-white mt-1 block">90 Days</span>
                <span className="text-[10px] text-slate-500 block">{reportData.startDateStr} – {reportData.endDateStr}</span>
              </Card>

              <Card className="border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 rounded-2xl p-4">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">Income & Bills</span>
                <span className="text-base font-bold text-slate-900 dark:text-white mt-1 block">Included</span>
                <span className="text-[10px] text-slate-500 block">Gamma pay & Rent rules</span>
              </Card>

              <Card className="border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 rounded-2xl p-4">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">Savings Pools</span>
                <span className="text-base font-bold text-slate-900 dark:text-white mt-1 block">{reportData.activePools.length} Pools</span>
                <span className="text-[10px] text-slate-500 block">Assigned & shortfalls</span>
              </Card>
            </div>

            <div className="flex items-center justify-end pt-2">
              <Button
                onClick={handlePrintPDF}
                className="bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl px-5 shadow-lg shadow-rose-500/20 gap-2"
              >
                <Printer className="w-4 h-4" />
                Open PDF Report Window
              </Button>
            </div>
          </TabsContent>

          {/* TAB 3: CSV Spreadsheet */}
          <TabsContent value="csv" className="space-y-4 pt-4">
            <div className="bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200/60 rounded-2xl p-4 flex items-start gap-3">
              <FileSpreadsheet className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <h4 className="text-sm font-bold text-slate-900 dark:text-white">Excel & Google Sheets CSV Export</h4>
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  Downloads a `.csv` file containing multi-section data (Summary, Fixed Expenses, Goals/Pools, Itemized Transactions).
                </p>
              </div>
            </div>

            <ScrollArea className="h-56 w-full rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-900 text-slate-200 p-4 font-mono text-xs">
              <pre className="whitespace-pre-wrap">{csvContent.slice(0, 1200)}...</pre>
            </ScrollArea>

            <div className="flex items-center justify-end pt-2">
              <Button
                onClick={handleDownloadCSV}
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl px-5 shadow-lg shadow-emerald-500/20 gap-2"
              >
                <Download className="w-4 h-4" />
                Download CSV Spreadsheet (.csv)
              </Button>
            </div>
          </TabsContent>

          {/* TAB 4: 3-Mo Summary Preview */}
          <TabsContent value="preview" className="space-y-4 pt-4">
            {/* Predicted Income Highlight Banner */}
            <div className="bg-gradient-to-r from-emerald-500/10 to-teal-500/10 border border-emerald-500/30 p-4 rounded-2xl flex items-center gap-3">
              <Zap className="w-5 h-5 text-emerald-600 shrink-0" />
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300 block">Predicted Upcoming Income</span>
                <span className="text-sm font-bold text-slate-900 dark:text-white">{reportData.predictedIncome.formattedText}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Card className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800/80 rounded-2xl p-4">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">3-Mo Income</span>
                <span className="text-lg font-black text-emerald-600 dark:text-emerald-400 mt-1 block">{reportData.fmt(reportData.totalIncome3Mo)}</span>
              </Card>

              <Card className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800/80 rounded-2xl p-4">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">3-Mo Spending</span>
                <span className="text-lg font-black text-rose-600 dark:text-rose-400 mt-1 block">{reportData.fmt(reportData.totalSpent3Mo)}</span>
              </Card>

              <Card className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800/80 rounded-2xl p-4">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">Actual Emergency Saved</span>
                <span className="text-lg font-black text-slate-900 dark:text-white mt-1 block">{reportData.fmt(reportData.actualEmergencySaved)}</span>
                <span className="text-[10px] text-slate-500 block">Floor target: {reportData.fmt(reportData.emergencyTargetFloor)}</span>
              </Card>

              <Card className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800/80 rounded-2xl p-4">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">Fun Budget</span>
                <span className="text-lg font-black text-[#FF2EB8] mt-1 block">{reportData.fmt(snapshot?.weeklyFunBudget || 150)}/wk</span>
              </Card>
            </div>

            {/* Special Rules */}
            <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-2xl border border-slate-200/70 dark:border-slate-800 space-y-2">
              <h5 className="text-xs font-bold uppercase tracking-wider text-slate-400">Context Rules Included in Exporter:</h5>
              <div className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 font-medium">
                <Check className="w-4 h-4 text-emerald-500" />
                <span>Gamma Salary: <strong>Last day of each month ({reportData.predictedIncome.paydayDate})</strong></span>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 font-medium">
                <Check className="w-4 h-4 text-emerald-500" />
                <span>Rent Due: <strong>1st day of each month</strong></span>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 font-medium">
                <Check className="w-4 h-4 text-emerald-500" />
                <span>Pool Terminology: <strong>Current Saved Balance (Real Actuals)</strong></span>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
