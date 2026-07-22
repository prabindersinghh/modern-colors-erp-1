import { Suspense, lazy } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from '@/lib/auth'
import { NavigationProvider } from '@/lib/navigation'
import { AppLayout } from '@/components/layout/AppLayout'
import { Toaster } from '@/components/common/Toaster'
import { LoginPage } from '@/pages/LoginPage'
import { DashboardPage } from '@/pages/DashboardPage'
import { CataloguePage } from '@/pages/CataloguePage'
import { SettingsPage } from '@/pages/SettingsPage'
import { PurchaseOrdersPage } from '@/pages/PurchaseOrdersPage'
import { ReviewPage } from '@/pages/ReviewPage'
import { LabelsPage } from '@/pages/LabelsPage'
import { ReceivingPage } from '@/pages/ReceivingPage'
import { AuditPage } from '@/pages/AuditPage'
import { RequestsPage } from '@/pages/RequestsPage'
import { StockPage } from '@/pages/StockPage'
import { StockLevelsPage } from '@/pages/StockLevelsPage'
import { DesignSystemPage } from '@/pages/DesignSystemPage'
import type { Role } from '@/types/api'

// Analytics dashboards pull in the charting library — lazy-load so recharts is a
// separate chunk fetched only when a dashboard is opened (keeps first load fast).
const OversightPage = lazy(() => import('@/pages/OversightPage').then((m) => ({ default: m.OversightPage })))
const StoreDashboardPage = lazy(() => import('@/pages/StoreDashboardPage').then((m) => ({ default: m.StoreDashboardPage })))
const HeadDashboardPage = lazy(() => import('@/pages/HeadDashboardPage').then((m) => ({ default: m.HeadDashboardPage })))
const BatchesPage = lazy(() => import('@/pages/BatchesPage').then((m) => ({ default: m.BatchesPage })))
const ProductionOutputPage = lazy(() => import('@/pages/ProductionOutputPage').then((m) => ({ default: m.ProductionOutputPage })))
const DispatchPage = lazy(() => import('@/pages/DispatchPage').then((m) => ({ default: m.DispatchPage })))

// Phase 1 screens belong to the Phase 1 roles (Store=ADMIN, Operator, Supervisor).
const PHASE1_ROLES: Role[] = ['ADMIN', 'OPERATOR', 'SUPERVISOR']

function RequireRole({ roles, children }: { roles: Role[]; children: React.ReactNode }) {
  const { user } = useAuth()
  if (user && !roles.includes(user.role)) return <Navigate to="/" replace />
  return <>{children}</>
}

// Role-aware landing: production heads and the view-only Admin start on Requests;
// Phase 1 roles keep the Phase 1 dashboard.
function DashboardFallback() {
  return <div className="h-40 animate-pulse rounded-lg bg-muted" />
}

function HomeRoute() {
  const { user } = useAuth()
  // Admin (view-only Oversight) lands on the factory-wide oversight dashboard.
  if (user?.role === 'OVERSIGHT') {
    return <Navigate to="/oversight" replace />
  }
  // Production heads land on their scoped analytics dashboard.
  if (user?.role === 'PRODUCTION_HEAD') {
    return <Navigate to="/my" replace />
  }
  // Dispatch lands straight on its scan screen (it has nothing else).
  if (user?.role === 'DISPATCH') {
    return <Navigate to="/dispatch" replace />
  }
  // Store (ADMIN) lands on the Store analytics dashboard.
  if (user?.role === 'ADMIN') {
    return <Navigate to="/store" replace />
  }
  // Phase 1 operators / supervisors keep the material-inward overview.
  return <DashboardPage />
}

function AuthedRoutes() {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    )
  }

  if (!user) {
    return (
      <Routes>
        {/* Design-system reference. Dev-only (import.meta.env.DEV is statically
            false in production, so this route and its chunk are tree-shaken out
            of the shipped bundle) and deliberately reachable without a login so
            the design language can be reviewed without factory credentials. */}
        {import.meta.env.DEV && (
          <Route path="/design-system" element={<DesignSystemPage />} />
        )}
        <Route path="*" element={<LoginPage />} />
      </Routes>
    )
  }

  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<HomeRoute />} />
        <Route path="requests" element={<RequireRole roles={['PRODUCTION_HEAD', 'OVERSIGHT', 'ADMIN']}><RequestsPage /></RequireRole>} />
        <Route path="stock" element={<RequireRole roles={['ADMIN']}><StockPage /></RequireRole>} />
        <Route path="stock-levels" element={<RequireRole roles={['ADMIN', 'OVERSIGHT']}><StockLevelsPage /></RequireRole>} />
        <Route path="oversight" element={<RequireRole roles={['OVERSIGHT']}><Suspense fallback={<DashboardFallback />}><OversightPage /></Suspense></RequireRole>} />
        <Route path="store" element={<RequireRole roles={['ADMIN']}><Suspense fallback={<DashboardFallback />}><StoreDashboardPage /></Suspense></RequireRole>} />
        <Route path="my" element={<RequireRole roles={['PRODUCTION_HEAD']}><Suspense fallback={<DashboardFallback />}><HeadDashboardPage /></Suspense></RequireRole>} />
        <Route path="batches" element={<RequireRole roles={['PRODUCTION_HEAD', 'ADMIN', 'OVERSIGHT']}><Suspense fallback={<DashboardFallback />}><BatchesPage /></Suspense></RequireRole>} />
        <Route path="production-output" element={<RequireRole roles={['PRODUCTION_HEAD']}><Suspense fallback={<DashboardFallback />}><ProductionOutputPage /></Suspense></RequireRole>} />
        <Route path="dispatch" element={<RequireRole roles={['DISPATCH']}><Suspense fallback={<DashboardFallback />}><DispatchPage /></Suspense></RequireRole>} />
        <Route path="purchase-orders" element={<RequireRole roles={PHASE1_ROLES}><PurchaseOrdersPage /></RequireRole>} />
        <Route path="review" element={<RequireRole roles={PHASE1_ROLES}><ReviewPage /></RequireRole>} />
        <Route path="review/:poId" element={<RequireRole roles={PHASE1_ROLES}><ReviewPage /></RequireRole>} />
        <Route path="labels" element={<RequireRole roles={PHASE1_ROLES}><LabelsPage /></RequireRole>} />
        <Route path="receiving" element={<RequireRole roles={PHASE1_ROLES}><ReceivingPage /></RequireRole>} />
        <Route path="catalogue" element={<RequireRole roles={PHASE1_ROLES}><CataloguePage /></RequireRole>} />
        <Route
          path="audit"
          element={
            <RequireRole roles={['ADMIN', 'SUPERVISOR']}>
              <AuditPage />
            </RequireRole>
          }
        />
        <Route
          path="settings"
          element={
            <RequireRole roles={['ADMIN']}>
              <SettingsPage />
            </RequireRole>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        {/* Inside the router (it reads location) and inside auth (back targets are
            role-checked), so every screen shares one back/forward implementation. */}
        <NavigationProvider>
          <AuthedRoutes />
        </NavigationProvider>
        <Toaster />
      </BrowserRouter>
    </AuthProvider>
  )
}
