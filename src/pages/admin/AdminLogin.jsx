import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Camera, LogIn, Loader2, AlertCircle, Eye, EyeOff, Zap } from 'lucide-react';

// Ícono de Google inline (SVG) — sin dependencia extra
function GoogleIcon() {
  return (
    <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}

export default function AdminLogin() {
  const { login, loginWithGoogle, loginDev } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail]           = useState('');
  const [password, setPassword]     = useState('');
  const [showPass, setShowPass]     = useState(false);
  const [loading, setLoading]       = useState(false);
  const [loadingG, setLoadingG]     = useState(false);
  const [loadingDev, setLoadingDev] = useState(false);
  const [error, setError]           = useState('');

  /* ── Email / password ── */
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      navigate('/admin');
    } catch {
      setError('Credenciales incorrectas. Verificá tu email y contraseña.');
    } finally {
      setLoading(false);
    }
  };

  /* ── Google ── */
  const handleGoogle = async () => {
    setError('');
    setLoadingG(true);
    try {
      await loginWithGoogle();
      navigate('/admin');
    } catch (err) {
      if (err.code !== 'auth/popup-closed-by-user' && err.code !== 'auth/cancelled-popup-request') {
        setError('Error al iniciar sesión con Google: ' + err.message);
      }
    } finally {
      setLoadingG(false);
    }
  };

  /* ── Dev mode (bypass local) ── */
  const handleDev = async () => {
    setError('');
    setLoadingDev(true);
    try {
      await loginDev();
      navigate('/admin');
    } catch (err) {
      setError('Error en acceso de desarrollo: ' + err.message);
    } finally {
      setLoadingDev(false);
    }
  };

  const anyLoading = loading || loadingG || loadingDev;

  return (
    <div className="min-h-screen bg-dark-900 flex items-center justify-center px-4 relative overflow-hidden">
      {/* BG decoration */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-neon-green/5 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-64 h-64 bg-neon-green/3 rounded-full blur-3xl pointer-events-none" />

      <div className="w-full max-w-md relative">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-neon-green rounded-2xl mb-4 shadow-neon">
            <Camera className="w-9 h-9 text-black" />
          </div>
          <h1 className="text-2xl font-black text-white">Panel de Administración</h1>
          <p className="text-gray-400 mt-1 text-sm">Ciancia Producciones</p>
        </div>

        <div className="card-dark p-8 border-neon-green/20 space-y-5">

          {/* ── Google sign-in ── */}
          <button
            type="button"
            onClick={handleGoogle}
            disabled={anyLoading}
            className="w-full flex items-center justify-center gap-3 bg-white hover:bg-gray-100 text-gray-800 font-semibold py-3 px-4 rounded-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 shadow-sm"
          >
            {loadingG
              ? <Loader2 className="w-5 h-5 animate-spin text-gray-600" />
              : <GoogleIcon />
            }
            {loadingG ? 'Iniciando sesión...' : 'Continuar con Google'}
          </button>

          {/* Divider */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-dark-500" />
            <span className="text-gray-600 text-xs font-medium">o con email</span>
            <div className="flex-1 h-px bg-dark-500" />
          </div>

          {/* ── Email / password form ── */}
          <form onSubmit={handleSubmit} autoComplete="off" className="space-y-4">
            <div>
              <label className="text-sm text-gray-400 mb-1.5 block font-medium">Email</label>
              <input
                type="email"
                name="admin_email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="tu@email.com"
                className="input-dark"
                required
                autoComplete="off"
                disabled={anyLoading}
              />
            </div>
            <div>
              <label className="text-sm text-gray-400 mb-1.5 block font-medium">Contraseña</label>
              <div className="relative">
                <input
                  type={showPass ? 'text' : 'password'}
                  name="admin_password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="input-dark pr-10"
                  required
                  autoComplete="off"
                  disabled={anyLoading}
                />
                <button
                  type="button"
                  onClick={() => setShowPass(s => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors"
                  tabIndex={-1}
                  aria-label="Mostrar u ocultar contraseña"
                >
                  {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Error message */}
            {error && (
              <div className="flex items-start gap-2 text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-sm">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={anyLoading}
              className="btn-neon w-full flex items-center justify-center gap-2"
            >
              {loading
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Ingresando...</>
                : <><LogIn className="w-4 h-4" /> Ingresar al panel</>
              }
            </button>
          </form>

          {/* ── Dev mode button ── */}
          <div className="pt-1 border-t border-dark-600">
            <p className="text-xs text-gray-500 mb-3 text-center">Solo para pruebas locales</p>
            <button
              type="button"
              onClick={handleDev}
              disabled={anyLoading}
              className="w-full flex items-center justify-center gap-2 border border-dashed border-yellow-500/50 text-yellow-400 hover:bg-yellow-500/10 font-semibold py-2.5 px-4 rounded-lg transition-all duration-200 text-sm disabled:opacity-50 disabled:cursor-not-allowed active:scale-95"
            >
              {loadingDev
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Zap className="w-4 h-4" />
              }
              {loadingDev ? 'Accediendo...' : 'Acceso directo modo desarrollo ⚡'}
            </button>
            <p className="text-xs text-gray-600 mt-2 text-center">
              Bypass local de desarrollo — no usar en producción
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
