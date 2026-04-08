import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import { HashRouter, Routes, Route } from 'react-router-dom';
import App from './App.tsx';
import HallOfFame from './components/HallOfFame.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/hall-of-fame" element={<HallOfFame />} />
      </Routes>
    </HashRouter>
  </StrictMode>,
);
