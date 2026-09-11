import { useState, useEffect } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Home, CheckSquare, FolderKanban, CreditCard, Brain, LogOut, Settings, Menu, X, TrendingUp, ArrowLeftRight, Wallet, Upload, FileText, ChevronDown, History, CalendarDays, Plane, Receipt, DollarSign, Scale, UtensilsCrossed } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { useAppData, getProjectHexColor } from '@/hooks/useAppData';
import { Button } from '@/components/ui/button';
import { useIsMobile } from '@/hooks/use-mobile';

const mainNavItems = [
  { to: '/', icon: Home, label: 'Home' },
  { to: '/tasks', icon: CheckSquare, label: 'Tasks' },
];

const financeSubItems = [
  { to: '/finance/monthly', icon: CalendarDays, label: 'Monthly Report' },
  { to: '/finance/budget', icon: Wallet, label: 'Budget Rules' },
  { to: '/finance/income', icon: DollarSign, label: 'Income' },
  { to: '/finance/pools', icon: Scale, label: 'Pools & Balance Sheet' },
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
  const isFinanceRoute = location.pathname.startsWith('/finance');
  const isTravelRoute = location.pathname.startsWith('/travel');
  const isProjectRoute = location.pathname.startsWith('/projects');
  const [financeOpen, setFinanceOpen] = useState(isFinanceRoute);
  const [travelOpen, setTravelOpen] = useState(isTravelRoute);
  const [projectsOpen, setProjectsOpen] = useState(isProjectRoute);

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
        <header className="fixed top-0 left-0 right-0 z-50 h-14 bg-card/95 backdrop-blur-sm border-b border-border flex items-center px-4">
          <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(!sidebarOpen)} className="mr-3">
            <Menu className="w-5 h-5" />
          </Button>
          <h1 className="text-sm font-bold text-foreground tracking-tight">Life Control</h1>
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
      <main className={cn("flex-1 overflow-auto", isMobile && "pt-14")}>
        <div className={cn(
          "container py-8",
          (isFinanceRoute || isTravelRoute) ? "max-w-7xl" : "max-w-4xl",
          isMobile ? "px-3 py-5" : "px-4"
        )}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}
