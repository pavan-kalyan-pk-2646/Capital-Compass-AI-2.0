import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'

import { router } from './routes'
import './styles/global.css'
import { LanguageProvider } from './components/LanguageContext'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LanguageProvider><RouterProvider router={router} /></LanguageProvider>
  </StrictMode>,
)
