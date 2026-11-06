import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

// Limpieza defensiva en el arranque para evitar que storage o autofill corrompido tiren el render process en Android
try {
  if (typeof window !== 'undefined') {
    const probe = '__ciancia_probe__';
    window.localStorage?.setItem(probe, '1');
    window.localStorage?.removeItem(probe);
  }
} catch {
  // Manejo seguro en caso de cuota excedida o restricciones de seguridad en navegadores móviles
}

const rootEl = document.getElementById('root');
if (rootEl) {
  try {
    ReactDOM.createRoot(rootEl).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
  } catch (err) {
    console.error('[Ciancia] Error crítico al montar React:', err);
  }
}
