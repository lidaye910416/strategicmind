import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import Dashboard from './views/Dashboard'
import Simulation from './views/Simulation'
import Report from './views/Report'

function App() {
  return (
    <BrowserRouter>
      <div className="app">
        <Toaster position="top-right" />
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/simulation/:runId" element={<Simulation />} />
          <Route path="/report/:reportId" element={<Report />} />
        </Routes>
      </div>
    </BrowserRouter>
  )
}

export default App
