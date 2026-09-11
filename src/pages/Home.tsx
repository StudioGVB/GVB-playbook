import { useState } from 'react';
import { FinanceDashboard } from '@/components/finance/FinanceDashboard';
import { TravelHome } from '@/components/finance/TravelHome';
import { useFinanceTrips } from '@/hooks/useFinanceTrips';
import { useFinanceData } from '@/hooks/useFinanceData';
import { getActiveTripOn } from '@/lib/policyEngine';

export default function Home() {
  const { trips, loading: tripsLoading } = useFinanceTrips();
  const { goals, transactions, loading: financeLoading } = useFinanceData();
  const [forceBudget, setForceBudget] = useState(false);

  const activeTrip = getActiveTripOn(new Date(), trips);

  if (!tripsLoading && !financeLoading && activeTrip && !forceBudget) {
    const goal = activeTrip.goal_id ? goals.find(g => g.id === activeTrip.goal_id) || null : null;
    return (
      <div className="py-4">
        <TravelHome
          trip={activeTrip}
          goal={goal}
          transactions={transactions}
          onExitToBudget={() => setForceBudget(true)}
        />
      </div>
    );
  }

  return <FinanceDashboard />;
}
