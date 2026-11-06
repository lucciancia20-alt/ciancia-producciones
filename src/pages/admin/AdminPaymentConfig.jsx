import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Save, CheckCircle, Loader2, CreditCard, Banknote, Tag } from 'lucide-react';
import { getPaymentConfig, savePaymentConfig } from '../../firebase/paymentConfig';

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
    defaultPricePhoto: 2000, defaultPriceVideo: 3000,
  });
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [saved, setSaved]       = useState(false);
  const [error, setError]       = useState('');

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
