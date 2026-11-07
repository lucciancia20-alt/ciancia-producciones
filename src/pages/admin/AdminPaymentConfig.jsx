import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Save, CheckCircle, Loader2, CreditCard, Banknote, Tag, Bell, Mail, ExternalLink } from 'lucide-react';
import { getPaymentConfig, savePaymentConfig } from '../../firebase/paymentConfig';
import { sendOrderEmailNotification } from '../../services/notificationService';

const FIELD_LABELS = {
  titular:   'Titular de la cuenta',
  banco:     'Nombre del banco',
  cbu:       'CBU',
  alias:     'Alias bancario',
  mpCelular: 'Celular asociado a Mercado Pago',
  mpAlias:   'Alias de Mercado Pago',
};

const FIELD_PLACEHOLDERS = {
  titular:   'Ej: Matías Ciancia',
  banco:     'Ej: Banco Galicia',
  cbu:       'Ej: 0070052730004008459352',
  alias:     'Ej: ciancia.foto.mp',
  mpCelular: 'Ej: +54 9 11 1234-5678',
  mpAlias:   'Ej: ciancia.foto.mp',
};

export default function AdminPaymentConfig() {
  const [form, setForm] = useState({
    titular: '', banco: '', cbu: '', alias: '', mpCelular: '', mpAlias: '',
    defaultPricePhoto: 2000, defaultPriceVideo: 3000, notifyEmail: 'lucciancia20@gmail.com', web3formsKey: '',
  });
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [saved, setSaved]       = useState(false);
  const [error, setError]       = useState('');
  const [testingEmail, setTestingEmail] = useState(false);
  const [testEmailStatus, setTestEmailStatus] = useState('');

  /* ── Carga inicial ── */
  useEffect(() => {
    getPaymentConfig()
      .then(cfg => setForm(f => ({ ...f, ...cfg })))
      .catch(e => setError('No se pudo cargar la configuración: ' + e.message))
      .finally(() => setLoading(false));
  }, []);

  const handleChange = (e) =>
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      await savePaymentConfig(form);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError('Error al guardar: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-dark-900 p-4 pt-6">
      <div className="max-w-2xl mx-auto">
        <Link
          to="/admin"
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-dark-800 border border-dark-600 text-gray-300 hover:text-neon-green hover:border-neon-green/50 transition-all mb-6 text-sm font-semibold shadow-sm group"
        >
          <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
          Volver al Dashboard
        </Link>

        <h1 className="text-3xl font-black text-white mb-2">
          CONFIGURACIÓN <span className="text-neon-green">DE PAGOS</span>
        </h1>
        <p className="text-gray-400 text-sm mb-8">
          Estos datos se muestran a los clientes en el checkout. Guardados en Firestore y visibles en tiempo real.
        </p>

        {loading ? (
          <div className="flex items-center gap-3 text-neon-green py-12">
            <Loader2 className="w-5 h-5 animate-spin" /> Cargando configuración...
          </div>
        ) : (
          <form onSubmit={handleSave} className="space-y-6">

            {/* Transferencia bancaria */}
            <div className="card-dark p-6 space-y-4">
              <h2 className="font-bold text-white flex items-center gap-2 text-lg">
                <Banknote className="w-5 h-5 text-neon-green" />
                Transferencia bancaria
              </h2>
              {(['titular', 'banco', 'cbu', 'alias']).map(key => (
                <div key={key}>
                  <label className="text-sm text-gray-400 mb-1 block">{FIELD_LABELS[key]}</label>
                  <input
                    name={key}
                    value={form[key]}
                    onChange={handleChange}
                    placeholder={FIELD_PLACEHOLDERS[key]}
                    className="input-dark"
                    autoComplete="off"
                  />
                </div>
              ))}
            </div>

            {/* Mercado Pago */}
            <div className="card-dark p-6 space-y-4">
              <h2 className="font-bold text-white flex items-center gap-2 text-lg">
                <CreditCard className="w-5 h-5 text-blue-400" />
                Mercado Pago
              </h2>
              {(['mpCelular', 'mpAlias']).map(key => (
                <div key={key}>
                  <label className="text-sm text-gray-400 mb-1 block">{FIELD_LABELS[key]}</label>
                  <input
                    name={key}
                    value={form[key]}
                    onChange={handleChange}
                    placeholder={FIELD_PLACEHOLDERS[key]}
                    className="input-dark"
                    autoComplete="off"
                  />
                </div>
              ))}
            </div>

            {/* Precios por Defecto */}
            <div className="card-dark p-6 space-y-4">
              <h2 className="font-bold text-white flex items-center gap-2 text-lg">
                <Tag className="w-5 h-5 text-neon-green" />
                Precios por Defecto de la Tienda
              </h2>
              <p className="text-gray-400 text-xs">
                Estos valores se aplicarán como precio base ($2.000 fotos / $3.000 videos) cuando un álbum no especifique montos personalizados.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm text-gray-400 mb-1 block">Precio por Foto ($)</label>
                  <input
                    type="number"
                    name="defaultPricePhoto"
                    value={form.defaultPricePhoto ?? 2000}
                    onChange={handleChange}
                    placeholder="2000"
                    className="input-dark font-mono"
                  />
                </div>
                <div>
                  <label className="text-sm text-gray-400 mb-1 block">Precio por Video / Dron ($)</label>
                  <input
                    type="number"
                    name="defaultPriceVideo"
                    value={form.defaultPriceVideo ?? 3000}
                    onChange={handleChange}
                    placeholder="3000"
                    className="input-dark font-mono"
                  />
                </div>
              </div>
            </div>

            {/* Notificaciones de compras por Email */}
            <div className="card-dark p-6 space-y-4 border-neon-green/30">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h2 className="font-bold text-white flex items-center gap-2 text-lg">
                  <Bell className="w-5 h-5 text-neon-green" />
                  Notificaciones de Nuevas Compras (Gmail)
                </h2>
                <a
                  href="https://web3forms.com/#start"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-bold text-neon-green hover:underline bg-neon-green/10 border border-neon-green/30 px-3 py-1 rounded-full"
                >
                  <span>Obtener Access Key gratis (5 seg)</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>

              <div className="bg-dark-700/80 border border-dark-500 rounded-xl p-3.5 text-xs text-gray-300 space-y-1.5 leading-relaxed">
                <p className="text-white font-bold">¿Cómo activar el envío instantáneo a tu Gmail en 1 paso?</p>
                <p>1. Tocá arriba en <strong>"Obtener Access Key gratis"</strong> (<code className="text-neon-green">web3forms.com</code>), escribí <strong>lucciancia20@gmail.com</strong> y tocá <em>"Create Access Key"</em>.</p>
                <p>2. Te va a llegar en el acto un código a tu Gmail (ej. <code className="text-gray-400">a1b2c3d4-...</code>). Pegalo en el campo de abajo y tocá <strong>Guardar configuración</strong>.</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm text-gray-400 mb-1 block">Clave de Web3Forms (Access Key)</label>
                  <input
                    type="text"
                    name="web3formsKey"
                    value={form.web3formsKey || ''}
                    onChange={handleChange}
                    placeholder="Pegá acá tu Access Key (ej: 4f8a9b2c-...)"
                    className="input-dark font-mono text-xs"
                    autoComplete="off"
                  />
                </div>
                <div>
                  <label className="text-sm text-gray-400 mb-1 block">Email receptor</label>
                  <input
                    type="email"
                    name="notifyEmail"
                    value={form.notifyEmail || ''}
                    onChange={handleChange}
                    placeholder="lucciancia20@gmail.com"
                    className="input-dark text-sm"
                    autoComplete="off"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 flex-wrap pt-1">
                <button
                  type="button"
                  disabled={testingEmail}
                  onClick={async () => {
                    setTestingEmail(true);
                    setTestEmailStatus('');
                    try {
                      // Guardamos primero la configuración actual para no perder la clave pegada
                      await savePaymentConfig(form);
                      const result = await sendOrderEmailNotification(
                        {
                          cliente: { nombre: 'Compra de Prueba', email: 'cliente@ejemplo.com', telefono: '+54 9 291 000-0000' },
                          paymentMethod: 'transfer',
                          total: 4000,
                          items: [{ fileName: 'foto-ejemplo-1.jpg', price: 2000 }, { fileName: 'foto-ejemplo-2.jpg', price: 2000 }],
                        },
                        'TEST-ORDEN-001',
                        form
                      );
                      if (result?.ok) {
                        setTestEmailStatus('✅ ¡Correo enviado con éxito! Ya debería estar en tu bandeja de entrada de Gmail.');
                      } else {
                        setTestEmailStatus('⚠️ ' + (result?.message || 'Falta pegar la Access Key gratuita de Web3Forms.'));
                      }
                    } catch {
                      setTestEmailStatus('⚠️ No se pudo enviar el correo de prueba.');
                    } finally {
                      setTestingEmail(false);
                    }
                  }}
                  className="btn-outline-neon text-xs py-2 px-4 flex items-center justify-center gap-2"
                >
                  {testingEmail ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                  Probar envío de email ahora
                </button>
              </div>

              {testEmailStatus && (
                <p className={`text-xs rounded-lg px-3 py-2 border ${
                  testEmailStatus.startsWith('✅')
                    ? 'text-neon-green bg-neon-green/10 border-neon-green/30'
                    : 'text-yellow-300 bg-yellow-500/10 border-yellow-500/30'
                }`}>
                  {testEmailStatus}
                </p>
              )}
            </div>

            {/* Feedback */}
            {error && (
              <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={saving}
              className="btn-neon w-full flex items-center justify-center gap-2"
            >
              {saving ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Guardando...</>
              ) : saved ? (
                <><CheckCircle className="w-4 h-4" /> ¡Guardado!</>
              ) : (
                <><Save className="w-4 h-4" /> Guardar configuración</>
              )}
            </button>

            <p className="text-xs text-gray-600 text-center">
              Los cambios se reflejan de inmediato en el Checkout para todos los clientes.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
