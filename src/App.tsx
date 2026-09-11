import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./contexts/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";
import Layout from "./components/Layout";
import Home from "./pages/Home";
import Tasks from "./pages/Tasks";
import Projects from "./pages/Projects";
import ProjectDetail from "./pages/ProjectDetail";
import Costs from "./pages/Costs";
import BrainDump from "./pages/BrainDump";
import Auth from "./pages/Auth";
import DataMigration from "./pages/DataMigration";
import Settings from "./pages/Settings";
import ResetPassword from "./pages/ResetPassword";
import CoverLetters from "./pages/CoverLetters";
import NotFound from "./pages/NotFound";
import FinanceSalarySnapshot from "./pages/FinanceSalarySnapshot";
import FinanceBudget from "./pages/FinanceBudget";
import FinancePoolsPage from "./pages/FinancePools";

import FinanceTransactionsPage from "./pages/FinanceTransactions";
import FinanceTransfersPage from "./pages/FinanceTransfers";
import FinanceAccountsPage from "./pages/FinanceAccounts";


import FinanceHistoryPage from "./pages/FinanceHistory";
import FinanceMonthlyPage from "./pages/FinanceMonthly";
import FinanceTravelPage from "./pages/FinanceTravel";
import TravelOverview from "./pages/TravelOverview";
import FinanceCostOfLivingPage from "./pages/FinanceCostOfLiving";
import FinanceIncomePage from "./pages/FinanceIncome";
import FinanceBalanceSheetPage from "./pages/FinanceBalanceSheet";
import Meals from "./pages/Meals";
import { AppDataProvider } from "./contexts/AppDataContext";
import { FinanceProvider } from "./contexts/FinanceContext";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <AppDataProvider>
        <FinanceProvider>
          <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/auth" element={<Auth />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
              <Route path="/" element={<Home />} />
              <Route path="/tasks" element={<Tasks />} />
              <Route path="/projects" element={<Projects />} />
              <Route path="/projects/:slug" element={<ProjectDetail />} />
              <Route path="/costs" element={<Costs />} />
              <Route path="/finance" element={<Navigate to="/finance/budget" replace />} />
              <Route path="/finance/budget" element={<FinanceBudget />} />
              <Route path="/finance/monthly" element={<FinanceMonthlyPage />} />
              <Route path="/finance/income" element={<FinanceIncomePage />} />
              <Route path="/finance/balance-sheet" element={<FinanceBalanceSheetPage />} />
              <Route path="/finance/travel" element={<Navigate to="/travel/trips" replace />} />
              <Route path="/travel" element={<TravelOverview />} />
              <Route path="/travel/trips" element={<FinanceTravelPage />} />
              <Route path="/finance/cost-of-living" element={<FinanceCostOfLivingPage />} />
              <Route path="/finance/dashboards" element={<FinanceSalarySnapshot />} />
              <Route path="/finance/pools" element={<FinancePoolsPage />} />
              <Route path="/finance/can-i-afford" element={<Navigate to="/finance/budget" replace />} />
              <Route path="/finance/transactions" element={<FinanceTransactionsPage />} />
              <Route path="/finance/transfers" element={<FinanceTransfersPage />} />
              <Route path="/finance/accounts" element={<FinanceAccountsPage defaultTab="accounts" />} />
              <Route path="/finance/goals" element={<Navigate to="/finance/budget" replace />} />
              <Route path="/finance/settings" element={<FinanceAccountsPage defaultTab="settings" />} />
              <Route path="/finance/history" element={<FinanceAccountsPage defaultTab="history" />} />
              <Route path="/afford" element={<Navigate to="/finance/budget" replace />} />

              <Route path="/brain-dump" element={<BrainDump />} />
              <Route path="/meals" element={<Meals />} />
              <Route path="/cover-letters" element={<CoverLetters />} />
              <Route path="/migrate" element={<DataMigration />} />
              <Route path="/settings" element={<Settings />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
          </TooltipProvider>
        </FinanceProvider>
      </AppDataProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
