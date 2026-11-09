import React, { useEffect, useState, useCallback } from 'react';
import { useCart } from '../context/CartContext';
import { addDoc, collection, Timestamp } from 'firebase/firestore';
import { db } from '../firebase/config';
import { Link } from 'react-router-dom';
import {
  ArrowLeft, CreditCard, Banknote, Upload, CheckCircle, AlertCircle,
  Loader2, Copy, Check, ExternalLink, Tag,
} from 'lucide-react';
import { getPaymentConfig } from '../firebase/paymentConfig';
import { uploadToCloudinary } from '../services/cloudinary';
import { sendOrderEmailNotification } from '../services/notificationService';

function formatPrice(n) {
  return `$${n.toLocaleString('es-AR')}`;
}

/** Botón "Copiar al portapapeles" con feedback visual */
function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback para navegadores sin clipboard API
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={copied ? '¡Copiado!' : 'Copiar'}
      className={`ml-2 p-1 rounded transition-colors flex-shrink-0 ${
        copied ? 'text-neon-green' : 'text-gray-500 hover:text-gray-300'
      }`}
    >
      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

/** Fila de dato bancario con botón copiar y altura fija uniforme */
function BankRow({ label, value, copyable = false }) {
  if (!value) return null;
  return (
    <div className="flex items-center justify-between gap-2 min-h-[24px]">
      <span className="text-gray-400 text-sm flex-shrink-0 leading-none">{label}</span>
      <div className="flex items-center gap-1 min-w-0 h-6">
        <span className="text-white font-mono text-sm text-right break-all leading-none">{value}</span>
        {copyable && value && <CopyButton text={value} />}
      </div>
    </div>
  );
}

export default function Checkout() {
  const {
    items, total, subtotal, packDiscount, couponDiscount, coupon, packRule, clearCart,
    applyCoupon, removeCoupon, couponError, couponLoading,
  } = useCart();

  /* ── Estado ── */
  const [method, setMethod]         = useState('transfer');
  const [form, setForm]             = useState({ nombre: '', email: '', telefono: '' });
  const [voucher, setVoucher]       = useState(null);
  const [voucherName, setVoucherName] = useState('');
  const [loading, setLoading]       = useState(false);
  const [success, setSuccess]       = useState(false);
  const [createdOrderId, setCreatedOrderId] = useState('');
  const [error, setError]           = useState('');
  const [couponInput, setCouponInput] = useState('');

  /* ── Config de pagos desde Firestore ── */
  const [payConfig, setPayConfig]   = useState(null);
  const [configLoading, setConfigLoading] = useState(true);

  useEffect(() => {
    getPaymentConfig()
      .then(cfg => setPayConfig(cfg))
      .catch(() => setPayConfig({}))
      .finally(() => setConfigLoading(false));
  }, []);

  /* ── Handlers ── */
  const handleChange = (e) => setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));

  const handleVoucher = (e) => {
    const file = e.target.files[0];
    if (file) {
      setVoucher(file);
      setVoucherName(file.name);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.nombre || !form.email) {
      setError('Completá nombre y email.');
      return;
    }
    setError('');
    setLoading(true);

    try {
      /* ── Subir comprobante a Cloudinary (si existe) ── */
      let voucherUrl = null;
      if (voucher) {
        try {
          const result = await uploadToCloudinary(voucher, { folder: 'ciancia/vouchers' });
          voucherUrl = result.secure_url || result.url;
        } catch (uploadErr) {
          console.warn('[Checkout] No se pudo subir el comprobante a Cloudinary:', uploadErr.message);
          // No abortamos — la orden igual se guarda sin comprobante
        }
      }

      const order = {
        cliente: {
          nombre:   form.nombre.trim(),
          email:    form.email.trim(),
          telefono: form.telefono.trim(),
        },
        clienteEmailLower: form.email.trim().toLowerCase(),
        items: items.map(i => ({
          id:       i.id,
          fileName: i.fileName,
          type:     i.type,
          price:    i.price,
          thumb:    i.thumb,
          url:      i.url || i.thumb,
        })),
        subtotal,
        packDiscount,
        couponCode:     coupon?.code || null,
        couponType:     coupon?.type || null,
        couponValue:    coupon?.value || null,
        couponDiscount,
        total,
        paymentMethod:  method,
        status:         method === 'transfer' ? 'pending' : 'pending_mp',
        // Comprobante como URL de Cloudinary (no base64 — evita el límite de 1 MB de Firestore)
        voucherUrl:     voucherUrl,
        voucherName:    voucherName || null,
        createdAt:      Timestamp.now(),
        approvedAt:     null,
        downloadEnabled: false,
      };

      const docRef = await addDoc(collection(db, 'orders'), order);
      // Disparar notificación automática por email al administrador (no bloqueante)
      sendOrderEmailNotification(order, docRef.id, payConfig).catch(() => {});
      setCreatedOrderId(docRef.id);
      clearCart();
      setSuccess(true);
    } catch (err) {
      console.error(err);
      setError('Error al guardar la orden. Verificá tu conexión e intentá de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  /* ── Pantalla: carrito vacío ── */
  if (items.length === 0 && !success) {
    return (
      <div className="min-h-screen pt-24 flex flex-col items-center justify-center gap-4">
        <p className="text-gray-400 text-lg">Tu carrito está vacío.</p>
        <Link to="/" className="btn-neon">Ir al inicio</Link>
      </div>
    );
  }

  /* ── Pantalla: éxito ── */
  if (success) {
    return (
      <div className="min-h-screen pt-24 flex flex-col items-center justify-center px-4">
        <div className="card-dark p-10 max-w-md w-full text-center border-neon-green/30">
          <CheckCircle className="w-20 h-20 text-neon-green mx-auto mb-4" />
          <h2 className="text-2xl font-black text-white mb-2">¡Pedido recibido!</h2>
          <p className="text-gray-400 mb-4 leading-relaxed">
            {method === 'transfer'
              ? 'Tu pago está pendiente de verificación. Revisaremos tu comprobante y habilitaremos la descarga sin marca de agua en cuanto confirmemos la transferencia.'
              : 'Tu pedido fue recibido. Te avisaremos por email cuando esté aprobado.'}
          </p>

          {createdOrderId && (
            <div className="bg-dark-700 border border-dark-500 rounded-xl p-4 mb-4 text-left">
              <p className="text-xs text-gray-400 mb-1">Tu código de pedido:</p>
              <p className="font-mono text-sm text-neon-green font-bold break-all select-all">
                {createdOrderId}
              </p>
              <p className="text-[11px] text-gray-500 mt-2 leading-relaxed">
                Guardá este código. Podés consultar el estado y descargar tus archivos originales desde la tarjeta{' '}
                <strong className="text-gray-400">"Descarga Inmediata"</strong> en la portada usando este código o tu email.
              </p>
            </div>
          )}

          <p className="text-sm text-gray-500 mb-6">
            Asociado al email <span className="text-white font-medium">{form.email}</span>
          </p>

          <Link to="/" className="btn-neon w-full inline-flex justify-center">
            Volver al inicio
          </Link>
        </div>
      </div>
    );
  }

  /* ── Pantalla: checkout ── */
  return (
    <div className="min-h-screen pt-20 pb-10 px-4">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between gap-4 mb-4">
          <div>
            <Link
              to="/cart"
              className="inline-flex items-center gap-1.5 text-gray-400 hover:text-neon-green transition-colors mb-1 text-xs sm:text-sm"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Volver al carrito
            </Link>
            <h1 className="text-2xl sm:text-3xl font-black text-white leading-tight">
              CHECKOUT <span className="text-neon-green">/ PAGO</span>
            </h1>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

            {/* ── Columna izquierda ── */}
            <div className="lg:col-span-3 space-y-4">

              {/* Datos del cliente */}
              <div className="card-dark p-4 sm:p-5 space-y-3">
                <h2 className="font-bold text-white text-base">Tus datos</h2>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Nombre completo *</label>
                  <input
                    name="nombre" value={form.nombre} onChange={handleChange}
                    autoComplete="off" autoCorrect="off" spellCheck="false" data-lpignore="true"
                    placeholder="Juan Pérez" className="input-dark py-2 text-sm" required
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">Email *</label>
                    <input
                      name="email" value={form.email} onChange={handleChange}
                      autoComplete="off" autoCorrect="off" spellCheck="false" data-lpignore="true"
                      type="email" placeholder="juan@ejemplo.com" className="input-dark py-2 text-sm" required
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">Teléfono</label>
                    <input
                      name="telefono" value={form.telefono} onChange={handleChange}
                      autoComplete="off" autoCorrect="off" spellCheck="false" data-lpignore="true"
                      placeholder="+54 9 11 1234-5678" className="input-dark py-2 text-sm"
                    />
                  </div>
                </div>
              </div>

              {/* Método de pago */}
              <div className="card-dark p-4 sm:p-5 space-y-3">
                <h2 className="font-bold text-white text-base">Método de pago</h2>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <button
                    type="button" onClick={() => setMethod('transfer')}
                    className={`p-3 rounded-xl border-2 text-left transition-all flex items-center gap-3 ${
                      method === 'transfer'
                        ? 'border-neon-green bg-neon-green/10'
                        : 'border-dark-500 bg-dark-700 hover:border-dark-400'
                    }`}
                  >
                    <Banknote className={`w-6 h-6 flex-shrink-0 ${method === 'transfer' ? 'text-neon-green' : 'text-gray-400'}`} />
                    <div className="min-w-0">
                      <p className="font-bold text-white text-sm leading-tight">Transferencia bancaria</p>
                      <p className="text-xs text-gray-400 mt-0.5">CBU/Alias + comprobante</p>
                    </div>
                  </button>

                  <button
                    type="button" onClick={() => setMethod('mercadopago')}
                    className={`p-3 rounded-xl border-2 text-left transition-all flex items-center gap-3 ${
                      method === 'mercadopago'
                        ? 'border-neon-green bg-neon-green/10'
                        : 'border-dark-500 bg-dark-700 hover:border-dark-400'
                    }`}
                  >
                    <CreditCard className={`w-6 h-6 flex-shrink-0 ${method === 'mercadopago' ? 'text-neon-green' : 'text-gray-400'}`} />
                    <div className="min-w-0">
                      <p className="font-bold text-white text-sm leading-tight">Mercado Pago</p>
                      <p className="text-xs text-gray-400 mt-0.5">Alias / QR + comprobante</p>
                    </div>
                  </button>
                </div>

                {/* ── Tarjeta única estática de datos de pago (sin remount ni saltos de altura) ── */}
                <div
                  className={`rounded-xl p-4 space-y-2 border ${
                    method === 'transfer'
                      ? 'bg-cyan-500/10 border-cyan-500/30 shadow-[0_0_20px_rgba(6,182,212,0.08)]'
                      : 'bg-sky-900/20 border-sky-500/30 shadow-[0_0_20px_rgba(14,165,233,0.08)]'
                  }`}
                >
                  <p
                    className={`flex items-center gap-2 font-semibold text-sm ${
                      method === 'transfer' ? 'text-neon-green' : 'text-blue-300'
                    }`}
                  >
                    <span
                      className={`w-2 h-2 rounded-full flex-shrink-0 ${
                        method === 'transfer'
                          ? 'bg-neon-green shadow-neon-sm'
                          : 'bg-blue-400 shadow-[0_0_6px_rgba(96,165,250,0.8)]'
                      }`}
                    />
                    {method === 'transfer'
                      ? `Transferencia Bancaria${payConfig?.banco ? ` — ${payConfig.banco}` : ''}`
                      : 'Mercado Pago'}
                  </p>

                  <div className="min-h-[80px] flex flex-col justify-center">
                    {configLoading ? (
                      <div className="flex items-center gap-2 text-gray-400 text-sm">
                        <Loader2 className="w-4 h-4 animate-spin" /> Cargando datos...
                      </div>
                    ) : method === 'transfer' ? (
                      <div className="space-y-1.5">
                        <BankRow label="Titular" value={payConfig?.titular || 'Luciano Horacio Ciancia'} />
                        <BankRow label="Banco"   value={payConfig?.banco} />
                        <BankRow label="CBU"     value={payConfig?.cbu}   copyable />
                        <BankRow label="Alias"   value={payConfig?.alias} copyable />
                        {!payConfig?.cbu && !payConfig?.alias && (
                          <p className="text-yellow-400/80 text-xs">
                            Los datos bancarios aún no fueron configurados por el administrador.
                          </p>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        <BankRow label="Titular"  value={payConfig?.titular || 'Luciano Horacio Ciancia'} />
                        <BankRow label="Celular"  value={payConfig?.mpCelular} copyable />
                        <BankRow label="Alias MP" value={payConfig?.mpAlias}   copyable />
                        {!payConfig?.mpCelular && !payConfig?.mpAlias && (
                          <p className="text-yellow-400/80 text-xs">
                            Los datos de Mercado Pago aún no fueron configurados por el administrador.
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="pt-1 border-t border-white/10 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-gray-300 text-xs sm:text-sm">
                      Total a transferir:{' '}
                      <strong className="text-neon-green">{formatPrice(total)}</strong>
                    </p>
                    <p className="text-gray-400 text-[11px]">
                      Recibirás acceso a la descarga cuando el pago sea verificado.
                    </p>
                  </div>
                </div>

                {/* ── Adjuntar comprobante (común a Transferencia y Mercado Pago) ── */}
                <div className="bg-dark-700 border border-dark-500 rounded-xl p-3.5">
                  <label className="text-xs sm:text-sm text-gray-300 mb-1.5 block font-medium">
                    Adjuntá tu comprobante de pago
                    <span className="text-gray-500 ml-1 font-normal">(imagen o PDF)</span>
                  </label>
                  <label className="flex items-center gap-3 p-2.5 border-2 border-dashed border-dark-400 rounded-lg cursor-pointer hover:border-neon-green/50 transition-colors">
                    <Upload className="w-4 h-4 text-neon-green flex-shrink-0" />
                    <span className="text-sm text-gray-300 truncate">
                      {voucherName || 'Seleccionar imagen o PDF...'}
                    </span>
                    <input
                      type="file"
                      accept="image/*,.pdf"
                      onChange={handleVoucher}
                      className="hidden"
                    />
                  </label>
                  {voucher && (
                    <p className="text-xs text-gray-500 mt-1">
                      Se subirá de forma segura al confirmar el pedido.
                    </p>
                  )}
                </div>
              </div>

              {/* Error */}
              {error && (
                <div className="flex items-center gap-2 text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-sm">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  {error}
                </div>
              )}
            </div>

            {/* ── Columna derecha: resumen ── */}
            <div className="lg:col-span-2">
              <div className="card-dark p-4 sm:p-5 sticky top-20">
                <h2 className="font-bold text-white text-base mb-3">Resumen del pedido</h2>

                <div className="space-y-2 max-h-48 overflow-y-auto mb-4">
                  {items.map(item => (
                    <div key={item.id} className="flex gap-2 items-center">
                      <img src={item.thumb} className="w-10 h-8 object-cover rounded" alt={item.fileName} />
                      <span className="text-sm text-gray-300 flex-1 truncate">{item.fileName}</span>
                      <span className="text-neon-green text-sm font-semibold">{formatPrice(item.price)}</span>
                    </div>
                  ))}
                </div>

                {/* ── Cupón de descuento ── */}
                <div className="border-t border-dark-600 pt-3 pb-3 space-y-1.5">
                  <label className="text-xs font-semibold text-gray-300 flex items-center gap-1.5">
                    <Tag className="w-3.5 h-3.5 text-neon-green" />
                    <span>¿Tenés un código de descuento?</span>
                  </label>
                  {coupon ? (
                    <div className="flex items-center justify-between bg-dark-700/80 border border-neon-green/30 rounded-xl px-3 py-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Tag className="w-4 h-4 text-neon-green flex-shrink-0" />
                        <div className="min-w-0">
                          <span className="font-mono font-bold text-white text-xs block truncate">
                            {coupon.code}
                          </span>
                          <span className="text-[10px] text-neon-green block truncate">
                            {coupon.label} (-{formatPrice(couponDiscount)})
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={removeCoupon}
                        className="text-xs text-gray-400 hover:text-red-400 font-medium transition-colors ml-2"
                      >
                        Quitar
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <div className="flex gap-1.5">
                        <input
                          type="text"
                          autoComplete="off"
                          autoCorrect="off"
                          spellCheck="false"
                          data-lpignore="true"
                          data-form-type="other"
                          value={couponInput}
                          onChange={e => setCouponInput(e.target.value.toUpperCase())}
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              applyCoupon(couponInput);
                            }
                          }}
                          placeholder="Ej: TEAM-BIKE-15, RUNNING20"
                          className="input-dark text-xs py-1.5 px-2.5 flex-1 font-mono uppercase"
                        />
                        <button
                          type="button"
                          onClick={() => applyCoupon(couponInput)}
                          disabled={couponLoading || !couponInput.trim()}
                          className="bg-neon-green/15 hover:bg-neon-green hover:text-black border border-neon-green/40 text-neon-green px-3 py-1.5 rounded-lg text-xs font-bold transition-colors disabled:opacity-40"
                        >
                          {couponLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Aplicar'}
                        </button>
                      </div>
                      {couponError && <p className="text-red-400 text-[11px]">{couponError}</p>}
                    </div>
                  )}
                </div>

                <div className="border-t border-dark-600 pt-4 space-y-2 text-sm">
                  <div className="flex justify-between text-gray-400">
                    <span>Subtotal</span><span>{formatPrice(subtotal)}</span>
                  </div>
                  {packDiscount > 0 && (
                    <div className="flex justify-between text-neon-green">
                      <span>{packRule?.label}</span><span>-{formatPrice(packDiscount)}</span>
                    </div>
                  )}
                  {couponDiscount > 0 && (
                    <div className="flex justify-between text-neon-green">
                      <span>Cupón {coupon.code}</span><span>-{formatPrice(couponDiscount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-black text-white text-xl pt-2 border-t border-dark-600">
                    <span>TOTAL</span>
                    <span className="text-neon-green">{formatPrice(total)}</span>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="btn-neon w-full mt-6 flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <><Loader2 className="w-4 h-4 animate-spin" />
                      {voucher ? 'Subiendo comprobante...' : 'Enviando pedido...'}</>
                  ) : (
                    method === 'transfer'
                      ? 'Confirmar pedido'
                      : 'Confirmar pedido (MP)'
                  )}
                </button>

                <p className="text-xs text-gray-600 text-center mt-3 leading-relaxed">
                  Tu descarga sin marca de agua se habilitará una vez que verifiquemos el pago.
                </p>
              </div>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
