import { useState, useEffect, useMemo } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Home, CheckSquare, FolderKanban, CreditCard, Brain, LogOut, Settings, Menu, X, TrendingUp, ArrowLeftRight, Wallet, Upload, FileText, ChevronDown, History, CalendarDays, Plane, Receipt, DollarSign, Scale, UtensilsCrossed, ShoppingBag, Sparkles, Coins } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { useAppData, getProjectHexColor } from '@/hooks/useAppData';
import { Button } from '@/components/ui/button';
import { useIsMobile } from '@/hooks/use-mobile';
import { useFinanceData } from '@/hooks/useFinanceData';
import { useFinanceAssumptions } from '@/hooks/useFinanceAssumptions';
import { useFixedExpenses } from '@/hooks/useFixedExpenses';
import { useWeeklyBoosts } from '@/hooks/useWeeklyBoosts';
import { useWeekTypes } from '@/hooks/useWeekTypes';
import { computePolicySnapshot } from '@/lib/policyEngine';
import { checkAndTriggerDaily8pmNotification, checkAndTriggerDaily955pmNotification } from '@/lib/daily8pmNotification';

const mainNavItems = [
  { to: '/', icon: Home, label: 'Home' },
  { to: '/tasks', icon: CheckSquare, label: 'Tasks' },
];

const financeSubItems = [
  { to: '/finance/budget', icon: Wallet, label: 'Weekly Budget' },
  { to: '/finance/monthly', icon: CalendarDays, label: 'Monthly Report' },
  { to: '/finance/yearly', icon: TrendingUp, label: '12-Month Outlook' },
  { to: '/finance/income', icon: DollarSign, label: 'Income' },
  { to: '/finance/pools', icon: Coins, label: 'Money Pools' },
  { to: '/finance/transactions', icon: Upload, label: 'Transactions' },
  { to: '/finance/accounts', icon: Wallet, label: 'Accounts & Settings' },
];

const travelSubItems = [
  { to: '/travel', icon: Home, label: 'Overview' },
  { to: '/travel/trips', icon: Plane, label: 'Trips' },
];

const utilityNavItems = [
  { to: '/meals', icon: UtensilsCrossed, label: 'Meals' },
  { to: '/costs', icon: CreditCard, label: 'Costs' },
  { to: '/brain-dump', icon: Brain, label: 'Brain Dump' },
  { to: '/cover-letters', icon: FileText, label: 'Job Applications' },
];

export default function Layout() {
  const { signOut } = useAuth();
  const { data } = useAppData();
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();

  const finance = useFinanceData();
  const { assumptions } = useFinanceAssumptions();
  const { monthlyTotalInternal: fixedExpensesMonthly, monthlyTotal: fixedExpensesMonthlyAll } = useFixedExpenses();
  const { totalBoostThisWeek } = useWeeklyBoosts();
  const { weekTypeMap: wtMap } = useWeekTypes();

  const snapshot = useMemo(() => {
    if (!assumptions) return null;
    return computePolicySnapshot(
      assumptions, finance.accounts, finance.transactions,
      finance.categories, finance.goals, finance.convertToBase,
      fixedExpensesMonthly, totalBoostThisWeek, wtMap(), [], fixedExpensesMonthlyAll,
    );
  }, [assumptions, finance.accounts, finance.transactions, finance.categories, finance.goals, finance.convertToBase, fixedExpensesMonthly, fixedExpensesMonthlyAll, totalBoostThisWeek, wtMap]);

  useEffect(() => {
    if (!finance.transactions.length) return;
    const baseCurrency = finance.settings?.base_currency || 'GBP';
    checkAndTriggerDaily8pmNotification(finance.transactions, finance.categories, snapshot, baseCurrency);
    checkAndTriggerDaily955pmNotification(finance.transactions, finance.categories, snapshot, baseCurrency);

    const interval = setInterval(() => {
      checkAndTriggerDaily8pmNotification(finance.transactions, finance.categories, snapshot, baseCurrency);
      checkAndTriggerDaily955pmNotification(finance.transactions, finance.categories, snapshot, baseCurrency);
    }, 60000);

    return () => clearInterval(interval);
  }, [finance.transactions, finance.categories, snapshot, finance.settings]);
  const isFinanceRoute = location.pathname.startsWith('/finance');
  const isTravelRoute = location.pathname.startsWith('/travel');
  const isProjectRoute = location.pathname.startsWith('/projects');
  const [financeOpen, setFinanceOpen] = useState(isFinanceRoute);
  const [travelOpen, setTravelOpen] = useState(isTravelRoute);
  const [projectsOpen, setProjectsOpen] = useState(isProjectRoute);

  const pageTitle = useMemo(() => {
    const p = location.pathname;
    if (p === '/') return 'Life Control';
    if (p === '/tasks') return 'Tasks';
    if (p === '/projects') return 'Projects';
    if (p.startsWith('/projects/')) return 'Project Detail';
    if (p === '/finance/budget') return 'Weekly Budget';
    if (p === '/finance/monthly') return 'Monthly Report';
    if (p === '/finance/yearly') return '12-Month Outlook';
    if (p === '/finance/income') return 'Income & Claims';
    if (p === '/finance/pools') return 'Money Pools';
    if (p === '/finance/transactions') return 'Transactions';
    if (p === '/finance/accounts') return 'Accounts & Settings';
    if (p.startsWith('/travel')) return 'Travel';
    if (p === '/costs') return 'Costs';
    if (p === '/meals') return 'Meals';
    if (p === '/brain-dump') return 'Brain Dump';
    if (p === '/cover-letters') return 'Job Applications';
    if (p === '/settings') return 'Settings';
    return 'Life Control';
  }, [location.pathname]);

  useEffect(() => { if (isFinanceRoute) setFinanceOpen(true); }, [isFinanceRoute]);
  useEffect(() => { if (isTravelRoute) setTravelOpen(true); }, [isTravelRoute]);
  useEffect(() => { if (isProjectRoute) setProjectsOpen(true); }, [isProjectRoute]);

  useEffect(() => {
    if (isMobile) setSidebarOpen(false);
  }, [isMobile]);

  const handleNavClick = () => {
    if (isMobile) setSidebarOpen(false);
  };

  const navLinkClasses = ({ isActive }: { isActive: boolean }) =>
    cn(
      'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all',
      isActive
        ? 'bg-accent text-foreground font-semibold'
        : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
    );

  const subNavClasses = ({ isActive }: { isActive: boolean }) =>
    cn(
      'flex items-center gap-2 px-3 py-1.5 text-sm transition-all rounded-r-lg',
      isActive
        ? 'bg-accent text-accent-foreground font-medium'
        : 'text-sidebar-foreground hover:bg-sidebar-accent'
    );

  const sectionTriggerClasses = (isActive: boolean) =>
    cn(
      'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-semibold w-full hover:bg-sidebar-accent transition-colors',
      isActive ? 'text-foreground' : 'text-sidebar-foreground'
    );

  return (
    <div className="min-h-screen flex bg-background">
      {/* Mobile header */}
      {isMobile && (
        <header className="fixed top-0 left-0 right-0 z-50 bg-card/95 backdrop-blur-md border-b border-border shadow-2xs">
          <div className="h-14 flex items-center justify-between px-3.5">
            <div className="flex items-center gap-2.5 min-w-0">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="h-9 w-9 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0 text-slate-700 dark:text-slate-200"
                aria-label="Toggle navigation menu"
              >
                <Menu className="w-5 h-5" />
              </Button>
              <div className="min-w-0">
                <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground block -mb-0.5">
                  Life Control
                </span>
                <h1 className="text-sm font-bold text-foreground tracking-tight truncate">
                  {pageTitle}
                </h1>
              </div>
            </div>

            {/* Quick action on mobile */}
            {isFinanceRoute && (
              <NavLink
                to="/finance/accounts"
                className="text-[11px] font-semibold text-primary px-2.5 py-1 rounded-full bg-primary/10 hover:bg-primary/20 transition-colors flex items-center gap-1 shrink-0"
              >
                <Wallet className="w-3.5 h-3.5" />
                <span>Accounts</span>
              </NavLink>
            )}
          </div>

          {/* Sub-nav Pill Strip on Mobile for Finance Pages */}
          {isFinanceRoute && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 overflow-x-auto touch-scroll border-t border-border/50 bg-slate-50/70 dark:bg-slate-900/70">
              {[
                { to: '/finance/budget', label: 'Weekly' },
                { to: '/finance/monthly', label: 'Monthly' },
                { to: '/finance/yearly', label: '12-Mo Outlook' },
                { to: '/finance/income', label: 'Income' },
                { to: '/finance/pools', label: 'Pots' },
                { to: '/finance/transactions', label: 'Transactions' },
                { to: '/finance/accounts', label: 'Settings' },
              ].map(({ to, label }) => {
                const isActive = location.pathname === to;
                return (
                  <NavLink
                    key={to}
                    to={to}
                    className={cn(
                      "px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap transition-all shrink-0 active:scale-95",
                      isActive
                        ? "bg-[#FF2EB8] text-white shadow-xs font-bold"
                        : "bg-white/90 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-slate-900 border border-slate-200/70 dark:border-slate-700/70"
                    )}
                  >
                    {label}
                  </NavLink>
                );
              })}
            </div>
          )}
        </header>
      )}

      {/* Mobile overlay */}
      {isMobile && sidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-40 transition-opacity" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "bg-card border-r border-border flex flex-col",
          isMobile
            ? "fixed top-0 left-0 h-full w-64 z-50 transform transition-transform duration-300 ease-in-out"
            : "w-56 sticky top-0 h-screen overflow-y-auto",
          isMobile && !sidebarOpen && "-translate-x-full",
          isMobile && sidebarOpen && "translate-x-0"
        )}
      >
        <div className="p-4 border-b border-border flex items-center justify-between">
          <h1 className="text-sm font-bold text-foreground tracking-tight">Life Control</h1>
          {isMobile && (
            <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(false)} className="h-8 w-8">
              <X className="w-4 h-4" />
            </Button>
          )}
        </div>

        <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
          {/* Main nav */}
          {mainNavItems.map(({ to, icon: Icon, label }) => (
            <NavLink key={to} to={to} onClick={handleNavClick} className={navLinkClasses}>
              <Icon className="w-4 h-4" /> {label}
            </NavLink>
          ))}

          {/* Finance section */}
          <Collapsible open={financeOpen} onOpenChange={setFinanceOpen} className="pt-3">
            <CollapsibleTrigger className={sectionTriggerClasses(isFinanceRoute)}>
              <TrendingUp className="w-4 h-4" />
              <span className="flex-1 text-left">Finance</span>
              <ChevronDown className={cn("w-3.5 h-3.5 text-muted-foreground transition-transform", financeOpen && "rotate-180")} />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="ml-7 mt-1 space-y-0.5 border-l border-border">
                {financeSubItems.map(({ to, icon: Icon, label }) => (
                  <NavLink key={to} to={to} onClick={handleNavClick} className={subNavClasses}>
                    <Icon className="w-3.5 h-3.5" />
                    <span className="truncate">{label}</span>
                  </NavLink>
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* Travel section */}
          <Collapsible open={travelOpen} onOpenChange={setTravelOpen} className="pt-3">
            <CollapsibleTrigger className={sectionTriggerClasses(isTravelRoute)}>
              <Plane className="w-4 h-4" />
              <span className="flex-1 text-left">Travel</span>
              <ChevronDown className={cn("w-3.5 h-3.5 text-muted-foreground transition-transform", travelOpen && "rotate-180")} />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="ml-7 mt-1 space-y-0.5 border-l border-border">
                {travelSubItems.map(({ to, icon: Icon, label }) => (
                  <NavLink key={to} to={to} end={to === '/travel'} onClick={handleNavClick} className={subNavClasses}>
                    <Icon className="w-3.5 h-3.5" />
                    <span className="truncate">{label}</span>
                  </NavLink>
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>


          {/* Projects section */}
          <Collapsible open={projectsOpen} onOpenChange={setProjectsOpen} className="pt-3">
            <CollapsibleTrigger className={sectionTriggerClasses(isProjectRoute)}>
              <FolderKanban className="w-4 h-4" />
              <span className="flex-1 text-left">Projects</span>
              <ChevronDown className={cn("w-3.5 h-3.5 text-muted-foreground transition-transform", projectsOpen && "rotate-180")} />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="ml-7 mt-1 space-y-0.5 border-l border-border">
                <NavLink to="/projects" end onClick={handleNavClick} className={subNavClasses}>
                  <span className="truncate">All Projects</span>
                </NavLink>
                {data.projects.map((project) => {
                  const projectColor = getProjectHexColor(project.color_class);
                  const statusColor = project.status === 'now' ? '#24af58' : '#ffb92c';
                  return (
                    <NavLink
                      key={project.id}
                      to={`/projects/${project.slug}`}
                      onClick={handleNavClick}
                      className={({ isActive }) =>
                        cn(
                          'flex items-center gap-2 px-3 py-1.5 text-sm transition-all rounded-r-lg',
                          isActive ? 'bg-accent font-medium' : 'hover:bg-sidebar-accent'
                        )
                      }
                    >
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: projectColor }} />
                      <span className="truncate flex-1" style={{ color: projectColor }}>{project.name}</span>
                      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: statusColor }} title={project.status === 'now' ? 'Active' : 'Parked'} />
                    </NavLink>
                  );
                })}
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* Utility nav */}
          <div className="pt-3">
            {utilityNavItems.map(({ to, icon: Icon, label }) => (
              <NavLink key={to} to={to} onClick={handleNavClick} className={navLinkClasses}>
                <Icon className="w-4 h-4" /> {label}
              </NavLink>
            ))}
          </div>
        </nav>

        {/* Settings + Sign out */}
        <div className="p-2 border-t border-border space-y-0.5">
          <NavLink to="/settings" onClick={handleNavClick} className={navLinkClasses}>
            <Settings className="w-4 h-4" /> Settings
          </NavLink>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 text-muted-foreground hover:text-foreground"
            onClick={() => { handleNavClick(); signOut(); }}
          >
            <LogOut className="w-4 h-4" /> Sign Out
          </Button>
        </div>
      </aside>

      {/* Main content */}
      <main className={cn(
        "flex-1 min-w-0 overflow-y-auto overflow-x-clip",
        (isFinanceRoute || location.pathname === '/') && "bg-[#FFF5FA]",
        isMobile && (isFinanceRoute ? "pt-[96px] pb-28" : "pt-14 pb-28")
      )}>
        <div className={cn(
          "mx-auto w-full",
          (isFinanceRoute || isTravelRoute) ? "max-w-7xl" : "max-w-4xl",
          isMobile ? "px-3 py-3.5" : "px-6 py-8"
        )}>
          <Outlet />
        </div>
      </main>

      {/* Mobile Bottom Navigation Bar */}
      {isMobile && (
        <nav className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200/80 dark:border-slate-800 px-1.5 pt-1 flex items-stretch justify-around gap-0.5 shadow-lg pb-[max(0.6rem,env(safe-area-inset-bottom))]">
          {[
            { to: '/', icon: Home, label: 'Home', exact: true },
            { to: '/finance/budget', icon: Wallet, label: 'Budget', exact: false },
            { to: '/finance/monthly', icon: CalendarDays, label: 'Monthly', exact: false },
            { to: '/finance/transactions', icon: Receipt, label: 'Activity', exact: false },
          ].map(({ to, icon: Icon, label, exact }) => {
            const isActive = exact ? location.pathname === '/' : location.pathname.startsWith(to);
            return (
              <NavLink
                key={to}
                to={to}
                className={cn(
                  "flex-1 flex flex-col items-center justify-center py-1.5 px-0.5 rounded-2xl transition-all min-h-[50px] active:scale-95",
                  isActive
                    ? "bg-[#FF2EB8]/10 text-[#FF2EB8] font-bold"
                    : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
                )}
              >
                <Icon className={cn("w-5 h-5 transition-transform", isActive && "scale-110 stroke-[2.5]")} />
                <span className="text-[11px] mt-0.5 tracking-tight font-display font-semibold">{label}</span>
              </NavLink>
            );
          })}
          {/* 5th Tab: Menu / More button */}
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className={cn(
              "flex-1 flex flex-col items-center justify-center py-1.5 px-0.5 rounded-2xl transition-all min-h-[50px] active:scale-95 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100",
              sidebarOpen && "bg-[#FF2EB8]/10 text-[#FF2EB8] font-bold"
            )}
            aria-label="Open navigation menu"
          >
            <Menu className="w-5 h-5" />
            <span className="text-[11px] mt-0.5 tracking-tight font-display font-semibold">More</span>
          </button>
        </nav>
      )}
    </div>
  );
}
