import { BrowserRouter } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import AppRoutes from './router'

function App() {
  return (
    <BrowserRouter>
      <div className="app">
        <Toaster position="top-right" />
        <AppRoutes />
      </div>
    </BrowserRouter>
  )
}

export default App
