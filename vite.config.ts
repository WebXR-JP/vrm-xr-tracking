import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  root: 'dev',
  // IWER が別の three を持っているので、確認ページでは1つにまとめる
  resolve: { dedupe: ['three'] },
  test: {
    root: '.',
    globals: true,
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
