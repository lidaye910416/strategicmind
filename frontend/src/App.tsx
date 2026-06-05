import { BrowserRouter } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import AppRoutes from './router'
import Layout from './components/layout/Layout'

function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Toaster position="top-right" />
        <AppRoutes />
      </Layout>
    </BrowserRouter>
  )
}

export default App
