import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import './index.css'
import Area3DPage from './pages/Area3DPage.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Area3DPage />
  </StrictMode>
)
