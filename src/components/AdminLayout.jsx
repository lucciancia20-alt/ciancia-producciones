import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  ArrowLeft, Camera, Package, Settings, ExternalLink, LogOut, Tag,
} from 'lucide-react';

export default function AdminLayout({ children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  const isRootDashboard = location.pathname === '/admin' || location.pathname === '/admin/';

  const handleLogout = async () => {
    try {
      await logout();
      navigate('/admin/login');
    } catch (e) {
      console.error(e);
    }
  };

  const NAV_LINKS = [
    { to: '/admin/albums', label: 'Álbumes', icon: Camera },
    { to: '/admin/orders', label: 'Órdenes', icon: Package },
    { to: '/admin/coupons', label: 'Cupones', icon: Tag },
    { to: '/admin/payment-config', label: 'Config. Pagos', icon: Settings },
  ];

  return (
    <div className="min-h-screen bg-dark-900 text-gray-100 flex flex-col">
      {/* ── Barra superior persistente para todas las subpantallas de admin ── */}
      {!isRootDashboard && (
        <header className="sticky top-0 z-40 bg-dark-800/95 border-b border-dark-600 backdrop-blur-md px-4 py-3 shadow-lg">
          <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
            {/* Izquierda: Botón destacado "Volver al Dashboard" */}
            <div className="flex items-center gap-3">
              <Link
                to="/admin"
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-neon-green text-black hover:bg-neon-green/90 font-black text-xs uppercase tracking-wider transition-all shadow-md group flex-shrink-0"
                title="Volver al panel principal de control"
              >
                <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
                <span>Volver al Dashboard</span>
              </Link>

              {/* Título o breadcrumb en desktop */}
              <div className="hidden md:flex items-center text-xs text-gray-400 gap-1.5 border-l border-dark-600 pl-3">
                <span className="text-gray-500">Admin</span>
                <span>/</span>
                <span className="text-white font-medium">
                  {location.pathname.includes('albums') && 'Gestión de Álbumes'}
                  {location.pathname.includes('orders') && 'Órdenes y Pedidos'}
                  {location.pathname.includes('coupons') && 'Gestión de Cupones'}
                  {location.pathname.includes('payment') && 'Configuración de Pagos'}
                  {location.pathname.includes('settings') && 'Ajustes'}
                </span>
              </div>
            </div>

            {/* Centro: Enlaces directos entre subsecciones */}
            <nav className="hidden sm:flex items-center gap-1.5">
              {NAV_LINKS.map(({ to, label, icon: Icon }) => {
                const active = location.pathname.startsWith(to);
                return (
                  <Link
                    key={to}
                    to={to}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                      active
                        ? 'bg-dark-700 text-neon-green border border-neon-green/30'
                        : 'text-gray-400 hover:text-white hover:bg-dark-700/60'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span>{label}</span>
                  </Link>
                );
              })}
            </nav>

            {/* Derecha: Acciones rápidas (Tienda + Salir) */}
            <div className="flex items-center gap-3 text-xs">
              <Link
                to="/"
                target="_blank"
                rel="noreferrer"
                className="hidden lg:inline-flex items-center gap-1 text-gray-400 hover:text-neon-green transition-colors"
                title="Abrir tienda en nueva pestaña"
              >
                <span>Ver tienda</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </Link>

              <span className="text-gray-500 hidden xl:inline">{user?.email}</span>

              <button
                type="button"
                onClick={handleLogout}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-gray-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                title="Cerrar sesión"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Salir</span>
              </button>
            </div>
          </div>
        </header>
      )}

      {/* Contenido principal de la vista */}
      <main className="flex-1">
        {children}
      </main>
    </div>
  );
}
