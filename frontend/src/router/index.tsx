/**
 * Application routes.
 */
import { Routes, Route } from 'react-router-dom'
import Dashboard from '../views/Dashboard'
import Demo from '../views/Demo'
import Simulation from '../views/Simulation'
import Report from '../views/Report'
import Workbench from '../views/Workbench'
import { APP_ROUTES, COMMON } from '../i18n/zh'

export default function AppRoutes() {
  return (
    <Routes>
      <Route path={APP_ROUTES.home} element={<Dashboard />} />
      <Route path="/demo" element={<Demo />} />
      <Route path="/simulation/:runId" element={<Simulation />} />
      <Route path="/report/:reportId" element={<Report />} />
      <Route path="/workbench" element={<Workbench />} />
      <Route path="/workbench/:runId" element={<Workbench />} />
      <Route
        path="*"
        element={
          <div className="min-h-screen flex items-center justify-center px-6">
            <div className="card p-8 text-center max-w-md">
              <div className="text-5xl font-bold text-ink-300 dark:text-ink-700 mb-2">404</div>
              <div className="text-ink-700 dark:text-ink-200 mb-4">{APP_ROUTES.notFound}</div>
              <a href={APP_ROUTES.home} className="btn-primary inline-flex">
                {COMMON.backToDashboard}
              </a>
            </div>
          </div>
        }
      />
    </Routes>
  )
}
