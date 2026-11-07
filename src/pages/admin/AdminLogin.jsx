import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useNavigate, Link } from 'react-router-dom';
import { Camera, LogIn, Loader2, AlertCircle, Eye, EyeOff, ArrowLeft, Lock } from 'lucide-react';

export default function AdminLogin() {
  const { login } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      navigate('/admin');
    } catch {
      setError('Credenciales incorrectas. Acceso exclusivo para administración.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-dark-900 flex items-center justify-center px-4 relative overflow-hidden">
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-neon-green/5 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-64 h-64 bg-neon-green/3 rounded-full blur-3xl pointer-events-none" />

      <div className="w-full max-w-md relative">
        <div className="mb-6">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-xs font-semibold text-gray-400 hover:text-neon-green transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Volver a la tienda
          </Link>
        </div>

        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-neon-green rounded-2xl mb-4 shadow-neon">
            <Camera className="w-9 h-9 text-black" />
          </div>
          <h1 className="text-2xl font-black text-white">Panel de Administración</h1>
          <p className="text-gray-400 mt-1 text-xs flex items-center justify-center gap-1.5">
            <Lock className="w-3.5 h-3.5 text-neon-green" /> Acceso privado — Ciancia Producciones
          </p>
        </div>

        <div className="card-dark p-8 border-neon-green/20 space-y-5">
          <form onSubmit={handleSubmit} autoComplete="off" className="space-y-4">
            <div>
              <label className="text-sm text-gray-400 mb-1.5 block font-medium">Email de Administrador</label>
              <input
                type="email"
                name="admin_email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="tu@email.com"
                className="input-dark"
                required
                autoComplete="off"
                disabled={loading}
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
                  disabled={loading}
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

            {error && (
              <div className="flex items-start gap-2 text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-sm">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="btn-neon w-full flex items-center justify-center gap-2"
            >
              {loading
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Ingresando...</>
                : <><LogIn className="w-4 h-4" /> Ingresar al panel</>
              }
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
