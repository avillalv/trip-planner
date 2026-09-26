import { createBrowserRouter } from 'react-router'
import { AppShell } from '@/components/layout/app-shell'
import { NotFound, RouteError } from '@/routes/errors'
import { TripLayout } from '@/routes/trip/trip-layout'
import { TripOverview } from '@/routes/trip/trip-overview'
import { TripsHome } from '@/routes/trips-home'

// The trips list and a trip's overview load with the app; every other page loads when first opened.
export const router = createBrowserRouter([
  {
    // Full screen, outside the app's navigation.
    path: 'trips/:tripId/present',
    errorElement: <RouteError />,
    lazy: async () => ({ Component: (await import('@/routes/present-page')).PresentPage }),
  },
  {
    element: <AppShell />,
    errorElement: <RouteError />,
    children: [
      {
        // A page that fails shows its error inside the app, with the navigation still there.
        errorElement: <RouteError />,
        children: [
          { index: true, element: <TripsHome /> },
          {
            path: 'trips/:tripId',
            element: <TripLayout />,
            children: [
              { index: true, element: <TripOverview /> },
              {
                path: 'flights',
                lazy: async () => ({ Component: (await import('@/routes/trip/trip-flights')).TripFlights }),
              },
              {
                path: 'itinerary',
                lazy: async () => ({ Component: (await import('@/routes/trip/trip-itinerary')).TripItinerary }),
              },
              {
                path: 'itinerary/:day',
                lazy: async () => ({ Component: (await import('@/routes/trip/trip-day')).TripDay }),
              },
              {
                path: 'lodging',
                lazy: async () => ({ Component: (await import('@/routes/trip/trip-lodging')).TripLodging }),
              },
            ],
          },
          {
            path: 'lodging/import',
            lazy: async () => ({ Component: (await import('@/routes/lodging-import')).LodgingImport }),
          },
          {
            path: 'agents',
            lazy: async () => ({ Component: (await import('@/routes/agents/agents-page')).AgentsPage }),
          },
          {
            path: 'agents/runs/:runId',
            lazy: async () => ({ Component: (await import('@/routes/agents/run-page')).RunPage }),
          },
          {
            path: 'settings',
            lazy: async () => ({ Component: (await import('@/routes/settings-page')).SettingsPage }),
          },
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
])
