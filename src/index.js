import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import Catalog from './Catalog';
import reportWebVitals from './reportWebVitals';
import * as serviceWorkerRegistration from './serviceWorkerRegistration';

// 🛣️ Path-based routing — public catalog แยกจาก ERP
const path = window.location.pathname;
const isCatalog = path === "/catalog" || path.startsWith("/catalog/");

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    {isCatalog ? <Catalog /> : <App />}
  </React.StrictMode>
);

serviceWorkerRegistration.register();
reportWebVitals();
