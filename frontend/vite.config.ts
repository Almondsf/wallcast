import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      // Transformers.js imports `onnxruntime-web/webgpu`, which drags in the
      // asyncify WASM build (23MB) purely to support WebGPU. Measured on this
      // project WebGPU gave no benefit, and the download dominates first-visit
      // time on a slow connection, so the wasm-only entry point is used instead
      // (12.6MB). Remove this alias to get WebGPU back.
      { find: /^onnxruntime-web\/webgpu$/, replacement: "onnxruntime-web/wasm" },
    ],
  },
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
  // `vite preview` serves only dist/, so it reproduces production exactly —
  // useful for catching assets that resolve from node_modules in dev but 404
  // once built. It needs the same isolation headers as the dev server.
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
})
