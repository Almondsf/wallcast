import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Cross-origin isolation. ONNX Runtime's WASM backend only uses threads when
    // SharedArrayBuffer is available, and that requires these two headers —
    // without them segmentation runs single-threaded and several times slower.
    // The production host must send the same headers.
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
})
