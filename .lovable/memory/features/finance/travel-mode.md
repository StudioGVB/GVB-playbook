---
name: Travel Mode (multi-trip)
description: Multi-trip travel planner where each trip links to a money pool as its budget, with tabbed UI and union-window travel mode on the Budget page
type: feature
---

# Travel Mode

The `/finance/travel` page supports multiple concurrent/upcoming trips via tabs.

## Data model
- **`finance_trips` table**: id, user_id, name, start_date, end_date, **goal_id (links to a money pool)**, checklist (jsonb), notes
- **`finance_transactions.trip_id`**: tags individual purchases to a specific trip — replaces the older `is_travel_spend` flag for spend attribution

## Pool linkage
Each trip links to an **existing money pool (finance_goals row)** rather than carrying its own budget number. The linked goal's `assigned_amount` IS the trip's spendable budget. This keeps the single-source-of-truth zero-sum allocation system intact (Money Pools page).

## Travel Mode (policy engine)
- `isTravelWeek = true` if today falls inside ANY trip's window (union of all trips)
- `snapshot.activeTrip` exposes the current trip; `snapshot.upcomingTrips` lists all future/active trips
- Runway uses **piecewise burn**: total weeks across ALL future trip windows burn fixed-only; non-trip weeks burn full
- Pool reservations across all upcoming trips are subtracted from `livingPool` so runway math doesn't double-count
- During travel weeks: variable Essentials and Fun budgets are zeroed; only fixed bills run

## Budget page banner
Shows the active trip name with date range badge; if multiple trips are upcoming, displays a "+N more trips" indicator.

## Legacy
The single-trip columns on `finance_assumptions` (`travel_start_date`, `travel_end_date`, `travel_pool_amount`, `travel_checklist`) are deprecated and unused by the UI. `isDateInTravelWindow()` and `computeTravelPoolSpent()` are kept as no-op stubs for backwards compat.
