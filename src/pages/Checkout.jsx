import React, { useEffect, useState, useRef } from 'react';
import { useCart } from '../context/CartContext';
import { addDoc, collection, doc, updateDoc, Timestamp } from 'firebase/firestore';
import { db } from '../firebase/config';
import { Link } from 'react-router-dom';
import {
  ArrowLeft, CreditCard, Banknote, Upload, CheckCircle, AlertCircle,
  Loader2, Copy, Check, ExternalLink, Tag, FileText, ShieldCheck,
} from 'lucide-react';
import { getPaymentConfig } from '../firebase/paymentConfig';
import { uploadToCloudinary } from '../services/cloudinary';
import { sendOrderEmailNotification } from '../services/notificationService';

const MAX_VOUCHER_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB máximo
const ALLOWED_VOUCHER_MIMES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf',
]);
const ALLOWED_VOUCHER_EXT_REGEX = /\.(jpe?g|png|webp|heic|heif|pdf)$/i;
const CHECKOUT_SESSION_KEY = 'ciancia_last_checkout_order_v1';

function sanitizeFileName(rawName) {
  return String(rawName || 'comprobante')
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, '_')
    .trim()
    .slice(0, 120) || 'comprobante';
}

function validateVoucherFile(file) {
  if (!file) return 'Seleccioná una imagen o archivo PDF de comprobante.';
  if (file.size <= 0) return 'El archivo seleccionado está vacío.';
  if (file.size > MAX_VOUCHER_SIZE_BYTES) {
    return 'El archivo supera el tamaño máximo permitido de 10 MB.';
  }
  const mime = String(file.type || '').toLowerCase().trim();
  const name = String(file.name || '').trim();
  // Bloquear explícitamente vectores XSS o ejecutables (.svg, .html, .xml, .js, .exe, etc.)
  if (
    mime.includes('svg') ||
    mime.includes('html') ||
    mime.includes('xml') ||
    mime.includes('script') ||
    /\.(svgz?|html?|xhtml|xml|swf|mhtml|js|mjs|exe|bat|cmd|sh|php)$/i.test(name)
  ) {
    return 'Formato no permitido por seguridad. Subí únicamente JPG, PNG, WEBP o PDF.';
  }
  const validExt = ALLOWED_VOUCHER_EXT_REGEX.test(name);
  // Algunos navegadores móviles reportan mime vacío o application/octet-stream para fotos .heic/.heif
  const isHeicFallback = (!mime || mime === 'application/octet-stream') && /\.(heic|heif)$/i.test(name);
  const validMime = ALLOWED_VOUCHER_MIMES.has(mime) || isHeicFallback;

  if (!validMime || !validExt) {
    return 'Formato inválido. Solo se aceptan imágenes (JPG, PNG, WEBP, HEIC) o PDF.';
  }
  return null;
}

function isTrustedCloudinaryUrl(url) {
  return (
    typeof url === 'string' &&
    /^https:\/\/res\.cloudinary\.com\/khzko7rr\/(image|raw|video)\/upload\//i.test(url)
  );
}

function loadPersistedCheckoutOrder() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(CHECKOUT_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && parsed.orderId ? parsed : null;
  } catch {
    return null;
  }
}

function savePersistedCheckoutOrder(data) {
  if (typeof window === 'undefined') return;
  try {
    if (!data) sessionStorage.removeItem(CHECKOUT_SESSION_KEY);
    else sessionStorage.setItem(CHECKOUT_SESSION_KEY, JSON.stringify(data));
  } catch {
    // noop
  }
}

function formatPrice(n) {
  return `$${(n || 0).toLocaleString('es-AR')}`;
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

  /* ── Estado (con hidratación de seguridad desde sessionStorage solo si el carrito actual está vacío) ── */
  const activePersisted = items.length === 0 ? loadPersistedCheckoutOrder() : null;
  const [method, setMethod]         = useState(() => activePersisted?.method || 'transfer');
  const [form, setForm]             = useState(() => ({
    nombre:   activePersisted?.nombre || '',
    email:    activePersisted?.email || '',
    telefono: activePersisted?.telefono || '',
  }));
  const [voucher, setVoucher]       = useState(null);
  const [voucherName, setVoucherName] = useState('');
  const [loading, setLoading]       = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [success, setSuccess]       = useState(() => Boolean(activePersisted));
  const [createdOrderId, setCreatedOrderId] = useState(() => activePersisted?.orderId || '');
  const [confirmedTotal, setConfirmedTotal] = useState(() => activePersisted?.total || 0);
  const [confirmedVoucherUrl, setConfirmedVoucherUrl] = useState(() => activePersisted?.voucherUrl || null);
  const [confirmedVoucherName, setConfirmedVoucherName] = useState(() => activePersisted?.voucherName || '');
  const [initialUploadWarning, setInitialUploadWarning] = useState('');
  const [lateVoucherFile, setLateVoucherFile] = useState(null);
  const [lateVoucherName, setLateVoucherName] = useState('');
  const [uploadingLateVoucher, setUploadingLateVoucher] = useState(false);
  const [lateUploadProgress, setLateUploadProgress] = useState(0);
  const [lateVoucherError, setLateVoucherError] = useState('');
  const [lateVoucherSuccess, setLateVoucherSuccess] = useState(false);
  const [error, setError]           = useState('');
  const [couponInput, setCouponInput] = useState('');

  const isMountedRef = useRef(true);
  const isSubmittingRef = useRef(false);
  const isUploadingLateRef = useRef(false);
  const lateFileInputRef = useRef(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Si el usuario entra a Checkout con nuevos ítems en el carrito para una nueva compra, limpiamos cualquier orden previa en sessionStorage
  useEffect(() => {
    if (items.length > 0 && !success) {
      savePersistedCheckoutOrder(null);
      setCreatedOrderId('');
      setConfirmedVoucherUrl(null);
      setConfirmedVoucherName('');
    }
  }, [items.length, success]);

  /* ── Config de pagos desde Firestore ── */
  const [payConfig, setPayConfig]   = useState(null);
  const [configLoading, setConfigLoading] = useState(true);

  useEffect(() => {
    getPaymentConfig()
      .then(cfg => { if (isMountedRef.current) setPayConfig(cfg); })
      .catch(() => { if (isMountedRef.current) setPayConfig({}); })
      .finally(() => { if (isMountedRef.current) setConfigLoading(false); });
  }, []);

  /* ── Handlers ── */
  const handleChange = (e) => setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));

  const handleVoucher = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const validationErr = validateVoucherFile(file);
    if (validationErr) {
      setError(validationErr);
      return;
    }
    setError('');
    setVoucher(file);
    setVoucherName(sanitizeFileName(file.name));
  };

  const handleClearInitialVoucher = () => {
    setVoucher(null);
    setVoucherName('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading || isSubmittingRef.current) return;

    const cleanNombre   = form.nombre.trim();
    const cleanEmail    = form.email.trim();
    const cleanTelefono = form.telefono.trim();

    if (!cleanNombre || !cleanEmail) {
      setError('Completá tu nombre y email para continuar.');
      return;
    }
    if (voucher) {
      const validationErr = validateVoucherFile(voucher);
      if (validationErr) {
        setError(validationErr);
        return;
      }
    }

    isSubmittingRef.current = true;
    setError('');
    setInitialUploadWarning('');
    setLoading(true);
    setUploadProgress(0);

    try {
      /* ── Subir comprobante a Cloudinary (si el usuario adjuntó uno antes de confirmar) ── */
      let voucherUrl = null;
      let cleanVoucherName = voucher ? sanitizeFileName(voucherName || voucher.name) : null;

      if (voucher) {
        try {
          const result = await uploadToCloudinary(voucher, {
            folder: 'ciancia/vouchers',
            onProgress: (pct) => {
              if (isMountedRef.current) setUploadProgress(pct);
            },
          });
          const candidateUrl = result?.secure_url || result?.url || '';
          if (isTrustedCloudinaryUrl(candidateUrl)) {
            voucherUrl = candidateUrl;
          } else {
            throw new Error('URL de comprobante inválida');
          }
        } catch (uploadErr) {
          console.warn('[Checkout] No se pudo subir el comprobante en el paso inicial:', uploadErr.message);
          // No bloqueamos la creación del pedido: activamos la Red de Seguridad en la pantalla de éxito
          cleanVoucherName = null;
          if (isMountedRef.current) {
            setLateVoucherFile(voucher);
            setLateVoucherName(sanitizeFileName(voucher.name));
            setInitialUploadWarning(
              'Tu pedido fue registrado correctamente, pero hubo una demora de red al adjuntar el archivo. Podés terminar de subirlo desde acá abajo con un clic.'
            );
          }
        }
      }

      const hasVoucher = Boolean(voucherUrl);
      const orderStatus = hasVoucher
        ? 'pending_review'
        : (method === 'transfer' ? 'pending' : 'pending_mp');

      const order = {
        cliente: {
          nombre:   cleanNombre,
          email:    cleanEmail,
          telefono: cleanTelefono,
        },
        clienteEmailLower: cleanEmail.toLowerCase(),
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
        couponCode:        coupon?.code || null,
        couponType:        coupon?.type || null,
        couponValue:       coupon?.value || null,
        couponDiscount,
        total,
        paymentMethod:     method,
        status:            orderStatus,
        voucherStatus:     hasVoucher ? 'uploaded' : 'missing',
        voucherUrl:        voucherUrl,
        voucherName:       cleanVoucherName,
        voucherUploadedAt: hasVoucher ? Timestamp.now() : null,
        createdAt:         Timestamp.now(),
        approvedAt:        null,
        downloadEnabled:   false,
      };

      const docRef = await addDoc(collection(db, 'orders'), order);
      // Disparar notificación automática por email al administrador (no bloqueante)
      sendOrderEmailNotification(order, docRef.id, payConfig).catch(() => {});

      const orderSnapshotForSession = {
        orderId:     docRef.id,
        method,
        nombre:      cleanNombre,
        email:       cleanEmail,
        telefono:    cleanTelefono,
        total,
        voucherUrl:  voucherUrl,
        voucherName: cleanVoucherName || '',
      };
      savePersistedCheckoutOrder(orderSnapshotForSession);

      if (!isMountedRef.current) return;
      setCreatedOrderId(docRef.id);
      setConfirmedTotal(total);
      setConfirmedVoucherUrl(voucherUrl);
      setConfirmedVoucherName(cleanVoucherName || '');
      clearCart();
      setSuccess(true);
    } catch (err) {
      console.error(err);
      if (isMountedRef.current) {
        setError('Error al guardar la orden. Verificá tu conexión e intentá de nuevo.');
      }
    } finally {
      isSubmittingRef.current = false;
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  };

  /* ── Subida de comprobante desde la pantalla de Pedido Confirmado (Red de seguridad) ── */
  const handleUploadLateVoucherNow = async (fileOverride = null) => {
    const targetFile = fileOverride || lateVoucherFile;
    if (uploadingLateVoucher || isUploadingLateRef.current) return;

    if (!createdOrderId || typeof createdOrderId !== 'string' || !createdOrderId.trim()) {
      setLateVoucherError('No se encontró el identificador del pedido para adjuntar el comprobante.');
      return;
    }
    if (!targetFile) {
      if (lateFileInputRef.current) lateFileInputRef.current.click();
      return;
    }

    const validationErr = validateVoucherFile(targetFile);
    if (validationErr) {
      setLateVoucherError(validationErr);
      return;
    }

    isUploadingLateRef.current = true;
    setLateVoucherError('');
    setUploadingLateVoucher(true);
    setLateUploadProgress(0);

    try {
      const result = await uploadToCloudinary(targetFile, {
        folder: 'ciancia/vouchers',
        onProgress: (pct) => {
          if (isMountedRef.current) setLateUploadProgress(pct);
        },
      });

      const uploadedUrl = result?.secure_url || result?.url || '';
      if (!isTrustedCloudinaryUrl(uploadedUrl)) {
        throw new Error('La respuesta del servidor de archivos no fue válida.');
      }

      const safeName = sanitizeFileName(targetFile.name);

      await updateDoc(doc(db, 'orders', createdOrderId), {
        voucherUrl:        uploadedUrl,
        voucherName:       safeName,
        voucherUploadedAt: Timestamp.now(),
        voucherStatus:     'uploaded',
        status:            'pending_review',
      });

      const currentPersisted = loadPersistedCheckoutOrder();
      if (currentPersisted && currentPersisted.orderId === createdOrderId) {
        savePersistedCheckoutOrder({
          ...currentPersisted,
          voucherUrl:  uploadedUrl,
          voucherName: safeName,
        });
      }

      if (!isMountedRef.current) return;
      setConfirmedVoucherUrl(uploadedUrl);
      setConfirmedVoucherName(safeName);
      setInitialUploadWarning('');
      setLateVoucherFile(null);
      setLateVoucherName('');
      setLateVoucherSuccess(true);
    } catch (err) {
      console.error('[Checkout] Error al subir comprobante posterior:', err);
      if (isMountedRef.current) {
        setLateVoucherError(
          'No se pudo subir el comprobante. Verificá tu conexión a internet e intentá nuevamente.'
        );
      }
    } finally {
      isUploadingLateRef.current = false;
      if (isMountedRef.current) {
        setUploadingLateVoucher(false);
      }
    }
  };

  const handleSelectLateVoucher = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const validationErr = validateVoucherFile(file);
    if (validationErr) {
      setLateVoucherError(validationErr);
      return;
    }
    setLateVoucherError('');
    setLateVoucherFile(file);
    setLateVoucherName(sanitizeFileName(file.name));
    handleUploadLateVoucherNow(file);
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

  /* ── Pantalla: éxito (Red de Seguridad Híbrida sin redirección automática) ── */
  if (success) {
    const hasUploadedReceipt = Boolean(confirmedVoucherUrl);

    return (
      <div className="min-h-screen pt-24 pb-16 flex flex-col items-center justify-center px-4">
        <div className="card-dark p-6 sm:p-9 max-w-lg w-full text-center border-neon-green/30 space-y-5">
          <div>
            <CheckCircle className="w-16 h-16 text-neon-green mx-auto mb-3" />
            <h2 className="text-2xl font-black text-white">¡Pedido confirmado!</h2>
            <p className="text-gray-300 text-sm mt-1.5 leading-relaxed">
              {hasUploadedReceipt
                ? 'Recibimos tu pedido y tu comprobante de pago. Revisaremos la acreditación y habilitaremos tu descarga en Alta Definición sin marca de agua.'
                : 'Tu pedido ya quedó registrado y reservado en nuestro sistema.'}
            </p>
          </div>

          {/* ── RED DE SEGURIDAD: Alerta destacada y subida directa si confirmó SIN comprobante ── */}
          {!hasUploadedReceipt ? (
            <div className="bg-amber-500/10 border-2 border-amber-400/60 rounded-2xl p-4 sm:p-5 text-left space-y-4 shadow-lg">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-amber-400/20 border border-amber-400/50 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <AlertCircle className="w-5 h-5 text-amber-300" />
                </div>
                <div className="space-y-1">
                  <span className="inline-block text-[11px] font-extrabold uppercase tracking-wider text-amber-300">
                    Falta adjuntar tu comprobante
                  </span>
                  <h3 className="text-white font-bold text-sm sm:text-base leading-snug">
                    Subí tu comprobante de pago ahora para activar la descarga
                  </h3>
                  <p className="text-xs text-gray-300 leading-relaxed">
                    {initialUploadWarning ||
                      'Confirmaste tu pedido sin adjuntar el comprobante. Podés transferir ahora mismo con los datos de abajo y subir la captura o PDF acá sin salir de esta pantalla.'}
                  </p>
                </div>
              </div>

              {/* Resumen rápido de datos bancarios / MP por si el cliente necesita copiar CBU/Alias en este paso */}
              <div className="bg-dark-800/90 border border-dark-500 rounded-xl p-3 space-y-1.5">
                <div className="flex items-center justify-between text-xs pb-1 border-b border-dark-600">
                  <span className="text-gray-400 font-semibold">
                    {method === 'transfer' ? 'Datos para Transferencia' : 'Datos de Mercado Pago'}
                  </span>
                  {confirmedTotal > 0 && (
                    <span className="text-neon-green font-black">
                      Total: {formatPrice(confirmedTotal)}
                    </span>
                  )}
                </div>
                {method === 'transfer' ? (
                  <>
                    <BankRow label="Titular" value={payConfig?.titular || 'Luciano Horacio Ciancia'} />
                    <BankRow label="Banco"   value={payConfig?.banco} />
                    <BankRow label="CBU"     value={payConfig?.cbu}   copyable />
                    <BankRow label="Alias"   value={payConfig?.alias} copyable />
                  </>
                ) : (
                  <>
                    <BankRow label="Titular"  value={payConfig?.titular || 'Luciano Horacio Ciancia'} />
                    <BankRow label="Celular"  value={payConfig?.mpCelular} copyable />
                    <BankRow label="Alias MP" value={payConfig?.mpAlias}   copyable />
                  </>
                )}
              </div>

              {/* Input oculto para selección de archivo en la pantalla de éxito */}
              <input
                ref={lateFileInputRef}
                type="file"
                disabled={uploadingLateVoucher}
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,.pdf"
                onChange={handleSelectLateVoucher}
                className="hidden"
              />

              {/* Si había un archivo preseleccionado pendiente de reintento, mostrarlo */}
              {lateVoucherFile && !uploadingLateVoucher && (
                <div className="flex items-center justify-between gap-2 bg-dark-800 border border-amber-400/40 rounded-xl px-3 py-2 text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileText className="w-4 h-4 text-amber-300 flex-shrink-0" />
                    <span className="text-gray-200 truncate">{lateVoucherName || lateVoucherFile.name}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => lateFileInputRef.current?.click()}
                    className="text-amber-300 hover:text-white font-semibold flex-shrink-0"
                  >
                    Cambiar
                  </button>
                </div>
              )}

              {lateVoucherError && (
                <div className="flex items-center gap-2 text-red-300 bg-red-500/15 border border-red-500/30 rounded-xl p-2.5 text-xs">
                  <AlertCircle className="w-4 h-4 flex-shrink-0 text-red-400" />
                  <span>{lateVoucherError}</span>
                </div>
              )}

              <div className="space-y-2">
                <button
                  type="button"
                  disabled={uploadingLateVoucher}
                  onClick={() => {
                    if (lateVoucherFile) {
                      handleUploadLateVoucherNow(lateVoucherFile);
                    } else {
                      lateFileInputRef.current?.click();
                    }
                  }}
                  className="w-full py-3 px-4 rounded-xl bg-amber-400 hover:bg-amber-300 text-black font-black text-sm inline-flex items-center justify-center gap-2 transition-all shadow-lg shadow-amber-500/20 disabled:opacity-60"
                >
                  {uploadingLateVoucher ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>
                        Subiendo comprobante{lateUploadProgress > 0 ? ` (${lateUploadProgress}%)` : '...'}
                      </span>
                    </>
                  ) : (
                    <>
                      <Upload className="w-4 h-4" />
                      <span>
                        {lateVoucherFile ? 'Reintentar subida de comprobante ahora' : 'Subir comprobante de pago ahora'}
                      </span>
                    </>
                  )}
                </button>
                <p className="text-[11px] text-gray-400 text-center">
                  Acepta capturas de pantalla (JPG, PNG, WEBP) o PDF hasta 10 MB.
                </p>
              </div>
            </div>
          ) : (
            <div className="bg-neon-green/10 border border-neon-green/40 rounded-2xl p-4 text-left space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-neon-green font-bold text-sm">
                  <ShieldCheck className="w-5 h-5 flex-shrink-0" />
                  <span>
                    {lateVoucherSuccess
                      ? '¡Comprobante subido y vinculado a tu pedido!'
                      : 'Comprobante adjunto correctamente'}
                  </span>
                </div>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-neon-green text-black">
                  En revisión
                </span>
              </div>
              {confirmedVoucherName && (
                <p className="text-xs text-gray-300 truncate">
                  📎 Archivo: <span className="text-white font-medium">{confirmedVoucherName}</span>
                </p>
              )}
              <p className="text-xs text-gray-400 leading-relaxed">
                Tu pedido pasó a estado <strong className="text-gray-200">En revisión con comprobante</strong>. Apenas confirmemos la transferencia se habilitará tu descarga automática.
              </p>
            </div>
          )}

          {createdOrderId && (
            <div className="bg-dark-700 border border-dark-500 rounded-xl p-4 text-left">
              <div className="flex items-center justify-between gap-2 mb-1">
                <p className="text-xs text-gray-400">Tu código de pedido:</p>
                <CopyButton text={createdOrderId} />
              </div>
              <p className="font-mono text-sm text-neon-green font-bold break-all select-all">
                {createdOrderId}
              </p>
              <p className="text-[11px] text-gray-400 mt-2 leading-relaxed">
                Guardá este código. Podés consultar el estado en vivo y descargar tus archivos originales desde{' '}
                <strong className="text-white">&ldquo;Descarga Inmediata&rdquo;</strong> en la portada usando este código o tu email.
              </p>
            </div>
          )}

          <p className="text-xs sm:text-sm text-gray-400">
            Asociado al email <span className="text-white font-semibold">{form.email}</span>
          </p>

          <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
            <Link
              to={`/?pedido=${encodeURIComponent(createdOrderId)}`}
              onClick={() => {
                // Solo limpiamos sessionStorage si ya subió su comprobante; si no, lo conservamos por si vuelve atrás
                if (hasUploadedReceipt) savePersistedCheckoutOrder(null);
              }}
              className="btn-neon flex-1 inline-flex items-center justify-center gap-2 text-sm py-2.5"
            >
              <ExternalLink className="w-4 h-4" />
              <span>Ver estado de mi pedido</span>
            </Link>
            <Link
              to="/"
              onClick={() => savePersistedCheckoutOrder(null)}
              className="btn-outline-neon inline-flex items-center justify-center text-sm py-2.5 px-4"
            >
              Volver al inicio
            </Link>
          </div>
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

                {/* ── Adjuntar comprobante (Opcional antes de confirmar — con Red de Seguridad en el siguiente paso) ── */}
                <div className="bg-dark-700 border border-dark-500 rounded-xl p-3.5">
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <label className="text-xs sm:text-sm text-gray-200 font-medium">
                      Adjuntar comprobante de pago
                      <span className="text-gray-400 ml-1 font-normal">(imagen o PDF)</span>
                    </label>
                    <span className="text-[11px] text-cyan-300 bg-cyan-500/10 border border-cyan-500/30 px-2 py-0.5 rounded-full font-semibold">
                      Opcional en este paso
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="flex-1 flex items-center gap-3 p-2.5 border-2 border-dashed border-dark-400 rounded-lg cursor-pointer hover:border-neon-green/50 transition-colors min-w-0">
                      <Upload className="w-4 h-4 text-neon-green flex-shrink-0" />
                      <span className="text-sm text-gray-300 truncate">
                        {voucherName || 'Seleccionar captura o PDF (o subirlo en el siguiente paso)...'}
                      </span>
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,.pdf"
                        onChange={handleVoucher}
                        className="hidden"
                      />
                    </label>
                    {voucher && (
                      <button
                        type="button"
                        onClick={handleClearInitialVoucher}
                        className="px-2.5 py-2 text-xs font-semibold text-gray-400 hover:text-red-400 bg-dark-800 border border-dark-500 rounded-lg transition-colors flex-shrink-0"
                        title="Quitar archivo seleccionado"
                      >
                        Quitar
                      </button>
                    )}
                  </div>
                  <p className="text-[11px] text-gray-400 mt-1.5 leading-relaxed">
                    {voucher
                      ? '✅ Archivo listo: se adjuntará automáticamente al confirmar el pedido.'
                      : '💡 ¿Todavía no hiciste la transferencia? Podés confirmar tu pedido ahora y subir el comprobante en la pantalla siguiente.'}
                  </p>
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
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>
                        {voucher
                          ? `Subiendo comprobante${uploadProgress > 0 ? ` (${uploadProgress}%)` : '...'}`
                          : 'Registrando pedido...'}
                      </span>
                    </>
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
