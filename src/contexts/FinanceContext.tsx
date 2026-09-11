import { createContext, ReactNode } from 'react';
import { useFinanceDataState } from '@/hooks/useFinanceData';
import { useFixedExpensesState } from '@/hooks/useFixedExpenses';
import { useFinanceTripsState } from '@/hooks/useFinanceTrips';
import { useWeekTypesState } from '@/hooks/useWeekTypes';
import { useWeeklyBoostsState } from '@/hooks/useWeeklyBoosts';
import { useFinanceAssumptionsState } from '@/hooks/useFinanceAssumptions';

export interface FinanceContextType {
  finance: ReturnType<typeof useFinanceDataState>;
  fixedExpenses: ReturnType<typeof useFixedExpensesState>;
  trips: ReturnType<typeof useFinanceTripsState>;
  weekTypes: ReturnType<typeof useWeekTypesState>;
  boosts: ReturnType<typeof useWeeklyBoostsState>;
  assumptions: ReturnType<typeof useFinanceAssumptionsState>;
}

export const FinanceContext = createContext<FinanceContextType | undefined>(undefined);

export function FinanceProvider({ children }: { children: ReactNode }) {
  const finance = useFinanceDataState();
  const fixedExpenses = useFixedExpensesState();
  const trips = useFinanceTripsState();
  const weekTypes = useWeekTypesState();
  const boosts = useWeeklyBoostsState();
  const assumptions = useFinanceAssumptionsState();

  const value = {
    finance,
    fixedExpenses,
    trips,
    weekTypes,
    boosts,
    assumptions,
  };

  return (
    <FinanceContext.Provider value={value}>
      {children}
    </FinanceContext.Provider>
  );
}
