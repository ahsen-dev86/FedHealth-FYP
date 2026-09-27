// Frontend entry point: mounts the React app into #root (see index.html) using
// the React 18 createRoot API, wrapped in StrictMode for extra dev-time checks.
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
