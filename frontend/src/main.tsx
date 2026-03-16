import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

const root = document.getElementById('root')!

// StrictMode intentionally double-invokes renders/effects in dev, which makes this app's
// heavy side panels feel much slower to paint. Keep it enabled for prod builds only.
ReactDOM.createRoot(root).render(
    import.meta.env.DEV ? <App /> : (
        <React.StrictMode>
            <App />
        </React.StrictMode>
    ),
)
