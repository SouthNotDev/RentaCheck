import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import { Suspense, lazy } from 'react';
import MainLayout from './layout/MainLayout';
const Landing = lazy(() => import('./pages/Landing'));
const Contacto = lazy(() => import('./pages/Contacto'));
const Pago = lazy(() => import('./pages/Pago'));
const Reporte = lazy(() => import('./pages/Reporte'));
const Adjuntar = lazy(() => import('./pages/Adjuntar'));
const Cuestionario = lazy(() => import('./pages/Cuestionario'));
import { FlowProvider } from './context/FlowContext';
import { AnimatePresence, motion } from 'motion/react';
import React from 'react';

function AnimatedRoutes() {
  const location = useLocation();
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={location.pathname}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
      >
        <Suspense fallback={<div style={{ padding: 24 }}>Cargando…</div>}>
          <Routes location={location}>
            <Route path="/" element={<Landing />} />
            <Route path="/contacto" element={<Contacto />} />
            <Route path="/pago" element={<Pago />} />
            <Route path="/adjuntar" element={<Adjuntar />} />
            <Route path="/cuestionario" element={<Cuestionario />} />
            <Route path="/reporte" element={<Reporte />} />
          </Routes>
        </Suspense>
      </motion.div>
    </AnimatePresence>
  );
}

export default function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <FlowProvider>
        <MainLayout>
          <AnimatedRoutes />
        </MainLayout>
      </FlowProvider>
    </BrowserRouter>
  );
}

