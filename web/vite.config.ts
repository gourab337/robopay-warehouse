import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { proverPlugin } from './prover.ts'

export default defineConfig({
  plugins: [react(), proverPlugin()],
  server: { fs: { allow: ['..'] } }, // contract ABIs + broadcast live in ../contracts
})
