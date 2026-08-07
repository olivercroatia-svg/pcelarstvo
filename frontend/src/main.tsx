import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from '@/App'
import { AuthProvider } from '@/auth/AuthContext'
import { ConfirmProvider } from '@/components/ui/confirm'
import { ToastProvider } from '@/components/ui/toast'
import { ThemeProvider } from '@/lib/theme'
import '@/index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* basename follows Vite's `base`, so the same build works at / in dev and at the Nginx
        subpath in production. */}
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <ThemeProvider>
        <ToastProvider>
          <ConfirmProvider>
            <AuthProvider>
              <App />
            </AuthProvider>
          </ConfirmProvider>
        </ToastProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
)
