import React from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';
import './styles.css';
import './styles-planner.css';
import './styles-notifications.css';
import './styles-contextmenu.css';
import './styles-update.css';
import './styles-sections.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Notes_MJ could not find its mount point. The window failed to load.');
}

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
