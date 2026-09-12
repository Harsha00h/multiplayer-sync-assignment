import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.js';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('#root missing');

// StrictMode is on deliberately: its double-mount is a free test that the room's
// teardown path is correct (dispose closes a still-CONNECTING socket, the server sees a
// clean close, and no ghost seat is left behind).
createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
