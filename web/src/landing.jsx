import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import './landing.css';
import Landing from './LandingPage.jsx';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Landing />
  </React.StrictMode>,
);
