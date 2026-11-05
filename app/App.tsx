import { Suspense, lazy } from 'react'
import type { ComponentType } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MotionConfig } from 'motion/react'
import { Navigate, RouterProvider, createBrowserRouter } from 'react-router'
import { SessionProvider } from '../lib/client/session.tsx'
import { ToastProvider } from '../components/ui/overlay.tsx'
import { SkeletonPage } from '../components/ui/primitives.tsx'
import { Shell } from './shell/Shell.tsx'
import { ApiFailure } from '../lib/client/api.ts'
import { usePreferences } from './preferences.ts'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: (count, err) => !(err instanceof ApiFailure && err.status >= 400 && err.status < 500) && count < 2,
      refetchOnWindowFocus: true,
    },
  },
})

// Every route is its own chunk; the shell and the overview load first.
function page(load: () => Promise<Record<string, unknown>>, name: string) {
  const C = lazy(async () => ({ default: (await load())[name] as ComponentType }))
  return (
    <Suspense fallback={<SkeletonPage />}>
      <C />
    </Suspense>
  )
}

// "/" in a normal build; "/NEXUS" on GitHub Pages (vite.config.ts, mode "pages").
const basename = import.meta.env.BASE_URL.replace(/\/$/, '') || '/'

const router = createBrowserRouter([
  { path: '/signin', element: page(() => import('./routes/SignIn.tsx'), 'SignIn') },
  {
    path: '/',
    element: <Shell />,
    children: [
      { index: true, element: page(() => import('./routes/Overview.tsx'), 'Overview'), handle: { crumb: 'Overview' } },
      { path: 'cases', element: page(() => import('./routes/Cases.tsx'), 'Cases'), handle: { crumb: 'Cases' } },
      { path: 'cases/:id', element: page(() => import('./routes/case/CaseDetail.tsx'), 'CaseDetail'), handle: { crumb: 'Case', parent: { label: 'Cases', to: '/cases' } } },
      { path: 'vulnerabilities', element: page(() => import('./routes/Vulnerabilities.tsx'), 'Vulnerabilities'), handle: { crumb: 'Vulnerabilities' } },
      { path: 'vulnerabilities/new', element: page(() => import('./routes/VulnerabilityIntake.tsx'), 'VulnerabilityIntake'), handle: { crumb: 'Intake', parent: { label: 'Vulnerabilities', to: '/vulnerabilities' } } },
      { path: 'vulnerabilities/:id', element: page(() => import('./routes/VulnerabilityDetail.tsx'), 'VulnerabilityDetail'), handle: { crumb: 'Vulnerability', parent: { label: 'Vulnerabilities', to: '/vulnerabilities' } } },
      { path: 'products', element: page(() => import('./routes/Products.tsx'), 'Products'), handle: { crumb: 'Products' } },
      { path: 'products/:id', element: page(() => import('./routes/ProductDetail.tsx'), 'ProductDetail'), handle: { crumb: 'Product', parent: { label: 'Products', to: '/products' } } },
      { path: 'determinations', element: page(() => import('./routes/Determinations.tsx'), 'Determinations'), handle: { crumb: 'Determinations' } },
      { path: 'clocks', element: page(() => import('./routes/Clocks.tsx'), 'Clocks'), handle: { crumb: 'Clocks' } },
      { path: 'evidence', element: page(() => import('./routes/Evidence.tsx'), 'Evidence'), handle: { crumb: 'Evidence' } },
      { path: 'evidence/:id', element: page(() => import('./routes/EvidenceDetail.tsx'), 'EvidenceDetail'), handle: { crumb: 'Evidence item', parent: { label: 'Evidence', to: '/evidence' } } },
      { path: 'reports', element: page(() => import('./routes/Reports.tsx'), 'Reports'), handle: { crumb: 'Reports' } },
      { path: 'reports/:id', element: page(() => import('./routes/ReportDetail.tsx'), 'ReportDetail'), handle: { crumb: 'Report', parent: { label: 'Reports', to: '/reports' } } },
      { path: 'ledger', element: page(() => import('./routes/Ledger.tsx'), 'Ledger'), handle: { crumb: 'Audit Ledger' } },
      { path: 'rules', element: page(() => import('./routes/Rules.tsx'), 'Rules'), handle: { crumb: 'Rules' } },
      { path: 'analytics', element: page(() => import('./routes/Analytics.tsx'), 'Analytics'), handle: { crumb: 'Analytics' } },
      { path: 'settings', element: page(() => import('./routes/Settings.tsx'), 'Settings'), handle: { crumb: 'Settings' } },
      { path: 'scenarios', element: page(() => import('./routes/Scenarios.tsx'), 'Scenarios'), handle: { crumb: 'Scenario simulator', parent: { label: 'Settings', to: '/settings' } } },
      { path: 'import', element: page(() => import('./routes/ImportExport.tsx'), 'ImportExport'), handle: { crumb: 'Import & export', parent: { label: 'Settings', to: '/settings' } } },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
], { basename })

function Root() {
  const prefs = usePreferences()
  return (
    <MotionConfig reducedMotion={prefs.reduceMotion ? 'always' : 'user'}>
      <RouterProvider router={router} />
    </MotionConfig>
  )
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <ToastProvider>
          <Root />
        </ToastProvider>
      </SessionProvider>
    </QueryClientProvider>
  )
}
