import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { CartProvider } from './context/CartContext';
import Navbar from './components/Navbar';
import ProtectedRoute from './components/ProtectedRoute';
import AdminLayout from './components/AdminLayout';

// Rutas con carga diferida (Code Splitting) para que el arranque en celulares sea ultra liviano
const Home = lazy(() => import('./pages/Home'));
const AlbumDetail = lazy(() => import('./pages/AlbumDetail'));
const Cart = lazy(() => import('./pages/Cart'));
const Checkout = lazy(() => import('./pages/Checkout'));
const AdminLogin = lazy(() => import('./pages/admin/AdminLogin'));
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'));
const AdminAlbums = lazy(() => import('./pages/admin/AdminAlbums'));
const AdminOrders = lazy(() => import('./pages/admin/AdminOrders'));
const AdminCoupons = lazy(() => import('./pages/admin/AdminCoupons'));
const AdminPaymentConfig = lazy(() => import('./pages/admin/AdminPaymentConfig'));

// Fallback de carga ligero y elegante
function RouteFallback() {
  return (
    <div className="min-h-[50vh] flex flex-col items-center justify-center p-8 text-center">
      <div className="w-8 h-8 border-2 border-neon-green border-t-transparent rounded-full animate-spin mb-3" />
      <span className="text-gray-400 text-xs tracking-wider uppercase font-medium">Cargando...</span>
    </div>
  );
}

// Public layout — with navbar
function PublicLayout({ children }) {
  return (
    <>
      <Navbar />
      <main>
        <Suspense fallback={<RouteFallback />}>
          {children}
        </Suspense>
      </main>
      <footer className="border-t border-dark-700 py-8 px-4 text-center text-gray-600 text-sm mt-16">
        <p>© 2024 Ciancia Producciones · Todos los derechos reservados</p>
        <p className="text-xs mt-1 text-gray-700">Fotografía y video deportivo profesional · Argentina</p>
      </footer>
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <CartProvider>
        <BrowserRouter>
          <Routes>
            {/* Public routes */}
            <Route path="/" element={<PublicLayout><Home /></PublicLayout>} />
            <Route path="/album/:albumId" element={<PublicLayout><AlbumDetail /></PublicLayout>} />
            <Route path="/cart" element={<PublicLayout><Cart /></PublicLayout>} />
            <Route path="/checkout" element={<PublicLayout><Checkout /></PublicLayout>} />

            {/* Admin routes (completamente aislados en chunks separados) */}
            <Route path="/admin/login" element={
              <Suspense fallback={<RouteFallback />}><AdminLogin /></Suspense>
            } />
            <Route path="/admin" element={
              <ProtectedRoute>
                <AdminLayout>
                  <Suspense fallback={<RouteFallback />}><AdminDashboard /></Suspense>
                </AdminLayout>
              </ProtectedRoute>
            } />
            <Route path="/admin/albums" element={
              <ProtectedRoute>
                <AdminLayout>
                  <Suspense fallback={<RouteFallback />}><AdminAlbums /></Suspense>
                </AdminLayout>
              </ProtectedRoute>
            } />
            <Route path="/admin/orders" element={
              <ProtectedRoute>
                <AdminLayout>
                  <Suspense fallback={<RouteFallback />}><AdminOrders /></Suspense>
                </AdminLayout>
              </ProtectedRoute>
            } />
            <Route path="/admin/coupons" element={
              <ProtectedRoute>
                <AdminLayout>
                  <Suspense fallback={<RouteFallback />}><AdminCoupons /></Suspense>
                </AdminLayout>
              </ProtectedRoute>
            } />
            <Route path="/admin/payment-config" element={
              <ProtectedRoute>
                <AdminLayout>
                  <Suspense fallback={<RouteFallback />}><AdminPaymentConfig /></Suspense>
                </AdminLayout>
              </ProtectedRoute>
            } />
            <Route path="/admin/settings" element={<Navigate to="/admin/payment-config" replace />} />

            {/* Fallback */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </CartProvider>
    </AuthProvider>
  );
}
