import { createContext, ReactNode } from 'react';
import { useAppDataState } from '@/hooks/useAppData';

export type AppDataContextType = ReturnType<typeof useAppDataState>;

export const AppDataContext = createContext<AppDataContextType | undefined>(undefined);

export function AppDataProvider({ children }: { children: ReactNode }) {
  const value = useAppDataState();
  return (
    <AppDataContext.Provider value={value}>
      {children}
    </AppDataContext.Provider>
  );
}
