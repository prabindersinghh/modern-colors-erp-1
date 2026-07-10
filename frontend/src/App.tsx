import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from '@/lib/auth'
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
import type { Role } from '@/types/api'

// Phase 1 screens belong to the Phase 1 roles (Store=ADMIN, Operator, Supervisor).
const PHASE1_ROLES: Role[] = ['ADMIN', 'OPERATOR', 'SUPERVISOR']

function RequireRole({ roles, children }: { roles: Role[]; children: React.ReactNode }) {
  const { user } = useAuth()
  if (user && !roles.includes(user.role)) return <Navigate to="/" replace />
  return <>{children}</>
}

// Role-aware landing: production heads and the view-only Admin start on Requests;
// Phase 1 roles keep the Phase 1 dashboard.
function HomeRoute() {
  const { user } = useAuth()
  if (user?.role === 'PRODUCTION_HEAD' || user?.role === 'OVERSIGHT') {
    return <Navigate to="/requests" replace />
  }
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
        <AuthedRoutes />
        <Toaster />
      </BrowserRouter>
    </AuthProvider>
  )
}
