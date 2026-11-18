import { createRoot } from 'react-dom/client'
import { App } from './App'
import { setupEmulatorIfNeeded } from './emulator'

const root = document.getElementById('root')
if (root) {
  setupEmulatorIfNeeded().then(() => createRoot(root).render(<App />))
}
