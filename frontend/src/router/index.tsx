/**
 * Application routes.
 */
import { Routes, Route } from 'react-router-dom'
import Dashboard from '../views/Dashboard'
import Simulation from '../views/Simulation'
import Report from '../views/Report'

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/simulation/:runId" element={<Simulation />} />
      <Route path="/report/:reportId" element={<Report />} />
      <Route path="*" element={<div style={{ padding: 32 }}>404 - Page Not Found</div>} />
    </Routes>
  )
}
