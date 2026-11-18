import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import './index.css';

// MediaPipe WASM (Emscripten) binds console.error for C++ stderr, which causes benign
// TensorFlow Lite informational logs ("INFO: Created TensorFlow Lite XNNPACK delegate for CPU.")
// to appear as browser errors. Demote only those known benign C++ info/warning lines to console.info.
if (typeof console !== 'undefined' && typeof console.error === 'function') {
  const nativeConsoleError = console.error.bind(console);
  const BENIGN_TFLITE_STDERR_RE =
    /^(INFO:\s*Created TensorFlow Lite XNNPACK delegate|INFO:\s|WARNING:\s*Logging before InitGoogleLogging|I\d{4}\s+\d{2}:\d{2}:\d{2}\.\d+|W\d{4}\s+\d{2}:\d{2}:\d{2}\.\d+.*(gl_context|tflite|mediapipe|xnnpack|landmark|inference|feedback_manager|gpu_origin)|OpenGL error checking is disabled|Feedback manager requires a model)/i;

  console.error = (...args: unknown[]) => {
    if (
      args.length > 0 &&
      typeof args[0] === 'string' &&
      BENIGN_TFLITE_STDERR_RE.test(args[0].trim())
    ) {
      console.info(...args);
      return;
    }
    nativeConsoleError(...args);
  };
}

// Register PWA service worker for installability & offline MediaPipe caching
if ('serviceWorker' in navigator) {
  registerSW({
    immediate: true,
    onRegisterError() {
      // Service worker registration is optional in restricted preview sandboxes
    },
  });
}

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
