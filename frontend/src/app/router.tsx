import { createBrowserRouter } from 'react-router'
import { AppShell } from '@/components/layout/app-shell'
import { AgentsPage } from '@/routes/agents/agents-page'
import { RunPage } from '@/routes/agents/run-page'
import { NotFound, RouteError } from '@/routes/errors'
import { LodgingImport } from '@/routes/lodging-import'
import { SettingsPage } from '@/routes/settings-page'
import { TripDay } from '@/routes/trip/trip-day'
import { TripFlights } from '@/routes/trip/trip-flights'
import { TripItinerary } from '@/routes/trip/trip-itinerary'
import { TripLodging } from '@/routes/trip/trip-lodging'
import { TripLayout } from '@/routes/trip/trip-layout'
import { TripOverview } from '@/routes/trip/trip-overview'
import { TripsHome } from '@/routes/trips-home'

export const router = createBrowserRouter([
  {
    element: <AppShell />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <TripsHome /> },
      {
        path: 'trips/:tripId',
        element: <TripLayout />,
        children: [
          { index: true, element: <TripOverview /> },
          { path: 'flights', element: <TripFlights /> },
          { path: 'itinerary', element: <TripItinerary /> },
          { path: 'itinerary/:day', element: <TripDay /> },
          { path: 'lodging', element: <TripLodging /> },
        ],
      },
      { path: 'lodging/import', element: <LodgingImport /> },
      { path: 'agents', element: <AgentsPage /> },
      { path: 'agents/runs/:runId', element: <RunPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: '*', element: <NotFound /> },
    ],
  },
])
