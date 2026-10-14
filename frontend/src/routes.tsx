import { lazy, Suspense, type ReactNode } from 'react'
import { createBrowserRouter, Link } from 'react-router-dom'

import { AppShell } from '@/components/AppShell'
import { Loading } from '@/components/ui'

const Landing = lazy(() => import('@/pages/Landing'))
const Atlas = lazy(() => import('@/pages/Atlas'))
const Dashboard = lazy(() => import('@/pages/Dashboard'))
const Twin = lazy(() => import('@/pages/Twin'))
const Investment = lazy(() => import('@/pages/Investment'))
const Loan = lazy(() => import('@/pages/Loan'))
const Goals = lazy(() => import('@/pages/Goals'))
const Portfolio = lazy(() => import('@/pages/Portfolio'))
const Spending = lazy(() => import('@/pages/Spending'))
const Crisis = lazy(() => import('@/pages/Crisis'))
const Multiverse = lazy(() => import('@/pages/Multiverse'))
const Committee = lazy(() => import('@/pages/Committee'))
const Audit = lazy(() => import('@/pages/Audit'))
const Trust = lazy(() => import('@/pages/Trust'))
const Architecture = lazy(() => import('@/pages/Architecture'))
const Market = lazy(() => import('@/pages/Market'))
const Learn = lazy(() => import('@/pages/Learn'))
const HowItWorks = lazy(() => import('@/pages/HowItWorks'))
const History = lazy(() => import('@/pages/History'))
const Settings = lazy(() => import('@/pages/Settings'))

const page = (el: ReactNode) => (
  <Suspense
    fallback={
      <div className="page">
        <Loading label="Loading" height={160} />
      </div>
    }
  >
    {el}
  </Suspense>
)

function NotFound() {
  return (
    <div className="page">
      <div className="state">
        <h3>That page doesn’t exist</h3>
        <p>Use the navigation, or go back to the command center.</p>
        <Link className="btn primary mt" to="/dashboard">
          Open the command center
        </Link>
      </div>
    </div>
  )
}

export const router = createBrowserRouter([
  { path: '/', element: page(<Landing />) },
  { path: '/atlas', element: page(<Atlas />) },
  {
    element: <AppShell />,
    children: [
      { path: 'dashboard', element: page(<Dashboard />) },
      { path: 'twin', element: page(<Twin />) },
      { path: 'investment', element: page(<Investment />) },
      { path: 'loan', element: page(<Loan />) },
      { path: 'goals', element: page(<Goals />) },
      { path: 'portfolio', element: page(<Portfolio />) },
      { path: 'spending', element: page(<Spending />) },
      { path: 'crisis', element: page(<Crisis />) },
      { path: 'multiverse', element: page(<Multiverse />) },
      { path: 'committee', element: page(<Committee />) },
      { path: 'audit', element: page(<Audit />) },
      { path: 'trust', element: page(<Trust />) },
      { path: 'architecture', element: page(<Architecture />) },
      { path: 'market', element: page(<Market />) },
      { path: 'learn', element: page(<Learn />) },
      { path: 'how-it-works', element: page(<HowItWorks />) },
      { path: 'history', element: page(<History />) },
      { path: 'settings', element: page(<Settings />) },
      { path: '*', element: <NotFound /> },
    ],
  },
])
