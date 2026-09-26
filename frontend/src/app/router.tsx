import { createBrowserRouter } from 'react-router'
import { AppShell } from '@/components/layout/app-shell'
import { NotFound, RouteError } from '@/routes/errors'
import { SectionPlaceholder } from '@/routes/section-placeholder'
import { SettingsPage } from '@/routes/settings-page'
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
          {
            path: 'flights',
            element: (
              <SectionPlaceholder
                title="Flights"
                description="Tracked routes and their cheapest fares, with price history, will appear here."
              />
            ),
          },
          {
            path: 'itinerary',
            element: <SectionPlaceholder title="Itinerary" description="Your day-by-day plan will appear here." />,
          },
          {
            path: 'lodging',
            element: (
              <SectionPlaceholder title="Lodging" description="Places to stay that you save and compare will appear here." />
            ),
          },
        ],
      },
      {
        path: 'agents',
        element: (
          <SectionPlaceholder
            title="Agents"
            description="Agent routines will be listed here: what each one searches for, when it runs, and what it found."
          />
        ),
      },
      { path: 'settings', element: <SettingsPage /> },
      { path: '*', element: <NotFound /> },
    ],
  },
])
