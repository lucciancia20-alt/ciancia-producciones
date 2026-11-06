import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { CartProvider } from './context/CartContext';
import Navbar from './components/Navbar';
import ProtectedRoute from './components/ProtectedRoute';
import Home from './pages/Home';
import AlbumDetail from './pages/AlbumDetail';
import Cart from './pages/Cart';
import Checkout from './pages/Checkout';
import AdminLogin from './pages/admin/AdminLogin';
import AdminDashboard from './pages/admin/AdminDashboard';
import AdminAlbums from './pages/admin/AdminAlbums';
import AdminOrders from './pages/admin/AdminOrders';
import AdminCoupons from './pages/admin/AdminCoupons';
import AdminPaymentConfig from './pages/admin/AdminPaymentConfig';
import AdminLayout from './components/AdminLayout';

// Public layout — with navbar
function PublicLayout({ children }) {
  return (
    <>
      <Navbar />
      <main>{children}</main>
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

            {/* Admin routes */}
            <Route path="/admin/login" element={<AdminLogin />} />
            <Route path="/admin" element={
              <ProtectedRoute>
                <AdminLayout><AdminDashboard /></AdminLayout>
              </ProtectedRoute>
            } />
            <Route path="/admin/albums" element={
              <ProtectedRoute>
                <AdminLayout><AdminAlbums /></AdminLayout>
              </ProtectedRoute>
            } />
            <Route path="/admin/orders" element={
              <ProtectedRoute>
                <AdminLayout><AdminOrders /></AdminLayout>
              </ProtectedRoute>
            } />
            <Route path="/admin/coupons" element={
              <ProtectedRoute>
                <AdminLayout><AdminCoupons /></AdminLayout>
              </ProtectedRoute>
            } />
            <Route path="/admin/payment-config" element={
              <ProtectedRoute>
                <AdminLayout><AdminPaymentConfig /></AdminLayout>
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
