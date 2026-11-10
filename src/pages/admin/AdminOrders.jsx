import React, { useEffect, useState, useRef } from 'react';
import { collection, onSnapshot, query, orderBy, updateDoc, deleteDoc, doc, Timestamp } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { Link } from 'react-router-dom';
import {
  ArrowLeft, CheckCircle2, Clock, Eye, ExternalLink, Loader2, Package, XCircle,
  Trash2, Camera, MessageCircle, Copy, Check, Bell, X
} from 'lucide-react';
import {
  playNewOrderSound,
  requestBrowserNotificationPermission,
  showBrowserOrderNotification,
} from '../../services/notificationService';

function formatPrice(n) {
  return `$${(n || 0).toLocaleString('es-AR')}`;
}

function buildWhatsAppOrderUrl(order) {
  const rawPhone = String(order?.cliente?.telefono || '').replace(/\D/g, '');
  let phone = rawPhone;
  if (phone && !phone.startsWith('54') && phone.length >= 8 && phone.length <= 11) {
    phone = `549${phone.replace(/^0+/, '')}`;
  }
  const nombre = order?.cliente?.nombre || 'Hola';
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://ciancia-producciones.onrender.com';
  const directUrl = `${origin}/?pedido=${order.id}`;
  const text = `¡Hola ${nombre}! 📸 Tu pedido en *Ciancia Producciones* (${order.items?.length || 1} archivo/s) ya está aprobado.\n\nPodés descargar tus fotos originales en Alta Definición sin marca de agua entrando directo acá:\n${directUrl}`;
  return phone
    ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}`
    : `https://wa.me/?text=${encodeURIComponent(text)}`;
}

function formatDate(ts) {
  if (!ts) return '-';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const STATUS_CONFIG = {
  pending: { label: 'Pendiente', color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30', icon: Clock },
  pending_mp: { label: 'MP Pendiente', color: 'bg-sky-500/20 text-sky-400 border-sky-500/30', icon: Clock },
  pending_review: { label: 'En revisión (Comprobante)', color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30', icon: Clock },
  approved: { label: 'Aprobado', color: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30', icon: CheckCircle2 },
  rejected: { label: 'Rechazado', color: 'bg-red-500/20 text-red-400 border-red-500/30', icon: XCircle },
};

function isOrderPendingApproval(status) {
  return status === 'pending' || status === 'pending_mp' || status === 'pending_review';
}

function isSafeHttpsUrl(url) {
  return typeof url === 'string' && /^https:\/\//i.test(url.trim());
}

export default function AdminOrders() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('all');
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [approvingId, setApprovingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [confirmDeleteOrder, setConfirmDeleteOrder] = useState(null);
  const [copiedOrderId, setCopiedOrderId] = useState(null);
  const [liveAlertOrder, setLiveAlertOrder] = useState(null);
  const [notifPerm, setNotifPerm] = useState(() => (typeof window !== 'undefined' && 'Notification' in window) ? Notification.permission : 'unsupported');
  const initialOrdersLoadedRef = useRef(false);

  useEffect(() => {
    const qOrders = query(collection(db, 'orders'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(
      qOrders,
      (snap) => {
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setOrders(list);
        // Sincronizar en tiempo real el modal abierto o el toast si el cliente acaba de subir su comprobante
        setSelectedOrder(prev => prev ? (list.find(o => o.id === prev.id) || null) : null);
        setLiveAlertOrder(prev => prev ? (list.find(o => o.id === prev.id) || prev) : null);
        setLoading(false);

        if (initialOrdersLoadedRef.current) {
          const added = snap.docChanges().filter(ch => ch.type === 'added');
          if (added.length > 0) {
            const newest = { id: added[0].doc.id, ...added[0].doc.data() };
            playNewOrderSound();
            showBrowserOrderNotification(newest);
            setLiveAlertOrder(newest);
          }
        } else {
          initialOrdersLoadedRef.current = true;
        }
      },
      (err) => {
        console.error('[AdminOrders] Error en suscripción de órdenes:', err);
        setLoading(false);
      }
    );
    return () => unsub();
  }, []);

  const handleApprove = async (orderId) => {
    setApprovingId(orderId);
    try {
      await updateDoc(doc(db, 'orders', orderId), {
        status: 'approved',
        downloadEnabled: true,
        approvedAt: Timestamp.now(),
      });
      setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: 'approved', downloadEnabled: true } : o));
      if (selectedOrder?.id === orderId) {
        setSelectedOrder(prev => ({ ...prev, status: 'approved', downloadEnabled: true }));
      }
    } catch (e) { alert('Error: ' + e.message); }
    finally { setApprovingId(null); }
  };

  const handleDelete = async (orderId) => {
    setDeletingId(orderId);
    try {
      await deleteDoc(doc(db, 'orders', orderId));
      setOrders(prev => prev.filter(o => o.id !== orderId));
      if (selectedOrder?.id === orderId) {
        setSelectedOrder(null);
      }
      setConfirmDeleteOrder(null);
    } catch (e) {
      console.error('[handleDelete] Error:', e);
      alert('Error al eliminar: ' + (e.message || 'Error inesperado'));
    } finally {
      setDeletingId(null);
    }
  };

  const handleCopyOrderLink = async (orderId) => {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://ciancia-producciones.onrender.com';
    const link = `${origin}/?pedido=${orderId}`;
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = link;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopiedOrderId(orderId);
    setTimeout(() => setCopiedOrderId(null), 2200);
  };

  const filtered = filterStatus === 'all'
    ? orders
    : filterStatus === 'pending'
      ? orders.filter(o => isOrderPendingApproval(o.status))
      : orders.filter(o => o.status === filterStatus);

  return (
    <div className="min-h-screen bg-dark-900 p-4 pt-6">
      <div className="max-w-6xl mx-auto">
        {/* Barra superior de navegación */}
        <div className="flex items-center gap-3 mb-6 flex-wrap">
          <Link
            to="/admin"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-neon-green text-black hover:bg-neon-green/90 transition-all text-sm font-bold shadow-md group"
          >
            <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
            <span>Volver al Dashboard</span>
          </Link>

          <Link
            to="/admin/albums"
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-dark-800 border border-dark-600 text-gray-300 hover:text-white hover:border-neon-green/50 transition-all text-sm font-semibold shadow-sm"
          >
            <Camera className="w-4 h-4 text-neon-green" />
            <span>Gestionar Álbumes</span>
          </Link>

          <button
            type="button"
            onClick={async () => {
              playNewOrderSound();
              const res = await requestBrowserNotificationPermission();
              setNotifPerm(res);
            }}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border text-xs font-semibold transition-all ${
              notifPerm === 'granted'
                ? 'bg-neon-green/10 border-neon-green/40 text-neon-green'
                : 'bg-dark-800 border-dark-600 text-gray-300 hover:border-neon-green/50 hover:text-neon-green'
            }`}
            title="Probar sonido y activar notificaciones del navegador en cada compra"
          >
            <Bell className="w-3.5 h-3.5" />
            <span>{notifPerm === 'granted' ? 'Alertas en vivo activas' : 'Activar alertas y sonido'}</span>
          </button>

          <Link
            to="/"
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-dark-800 border border-dark-600 text-gray-300 hover:text-neon-green hover:border-neon-green/50 transition-all text-sm font-semibold shadow-sm ml-auto"
            title="Ir a la portada pública"
          >
            <span>Ver Tienda</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </Link>
        </div>

        {/* Cartel emergente en vivo (Toast) cuando entra una compra */}
        {liveAlertOrder && (
          <div className="fixed top-5 right-5 z-50 max-w-sm w-full bg-dark-800 border-2 border-neon-green rounded-2xl p-4 shadow-neon animate-bounce">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-neon-green text-black flex items-center justify-center flex-shrink-0">
                  <Bell className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-xs font-extrabold uppercase tracking-wider text-neon-green">¡Nueva compra recibida!</p>
                  <p className="text-white font-bold text-sm">{liveAlertOrder.cliente?.nombre || 'Cliente'}</p>
                  <p className="text-gray-300 text-xs">
                    {formatPrice(liveAlertOrder.total)} · {liveAlertOrder.items?.length || 1} archivo(s)
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setLiveAlertOrder(null)}
                className="text-gray-400 hover:text-white p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setSelectedOrder(liveAlertOrder);
                  setLiveAlertOrder(null);
                }}
                className="btn-neon text-xs py-1.5 px-3 flex-1"
              >
                Ver pedido ahora
              </button>
              <button
                type="button"
                onClick={() => setLiveAlertOrder(null)}
                className="btn-outline-neon text-xs py-1.5 px-3"
              >
                Cerrar
              </button>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-black text-white">
            ÓRDENES <span className="text-neon-green">/ PEDIDOS</span>
          </h1>
          <span className="text-gray-400 text-sm">{orders.length} orden{orders.length !== 1 ? 'es' : ''}</span>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-2 flex-wrap mb-6">
          {[
            { key: 'all', label: 'Todas' },
            { key: 'pending', label: 'Pendientes' },
            { key: 'approved', label: 'Aprobadas' },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setFilterStatus(key)}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                filterStatus === key
                  ? 'bg-neon-green text-black'
                  : 'bg-dark-700 text-gray-400 border border-dark-500 hover:text-white'
              }`}
            >
              {label}
              {key === 'pending' && orders.filter(o => isOrderPendingApproval(o.status)).length > 0 && (
                <span className="ml-2 badge-neon">
                  {orders.filter(o => isOrderPendingApproval(o.status)).length}
                </span>
              )}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="text-neon-green animate-pulse py-8">Cargando órdenes...</div>
        ) : filtered.length === 0 ? (
          <div className="card-dark p-12 text-center text-gray-500">
            <Package className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>No hay órdenes {filterStatus !== 'all' ? `con estado "${filterStatus}"` : ''}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(order => {
              const sc = STATUS_CONFIG[order.status] || STATUS_CONFIG.pending;
              const StatusIcon = sc.icon;
              return (
                <div key={order.id} className="card-dark p-5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold border ${sc.color}`}>
                          <StatusIcon className="w-3 h-3" /> {sc.label}
                        </span>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${
                          order.paymentMethod === 'transfer'
                            ? 'bg-neon-green/10 text-neon-green border-neon-green/30'
                            : 'bg-blue-500/15 text-blue-300 border-blue-500/30'
                        }`}>
                          {order.paymentMethod === 'transfer' ? 'Transferencia bancaria' : 'Mercado Pago'}
                        </span>
                        {order.couponCode && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-mono font-bold bg-neon-green/15 text-neon-green border border-neon-green/40">
                            🏷️ Cupón: {order.couponCode} {order.couponDiscount ? `(-${formatPrice(order.couponDiscount)})` : ''}
                          </span>
                        )}
                        {(order.voucherUrl || order.voucherBase64) ? (
                          <span className="text-[11px] text-cyan-400 font-medium">📎 Comprobante adjunto</span>
                        ) : (
                          <span className="text-[11px] text-yellow-400/80">Sin comprobante</span>
                        )}
                      </div>
                      <p className="font-bold text-white">{order.cliente?.nombre || 'Sin nombre'}</p>
                      <p className="text-gray-400 text-sm">
                        {order.cliente?.email}
                        {order.cliente?.telefono && <span className="text-gray-500"> · 📱 {order.cliente.telefono}</span>}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        {order.items?.length} ítems · {formatDate(order.createdAt)} · <span className="font-mono text-gray-400">#{order.id.slice(0, 8)}</span>
                      </p>
                    </div>

                    <div className="flex items-center gap-2.5 flex-shrink-0 flex-wrap">
                      <span className="text-neon-green font-black text-lg">{formatPrice(order.total)}</span>

                      {(order.voucherUrl || order.receipt || order.comprobanteUrl || order.voucherBase64) && (
                        <button
                          type="button"
                          onClick={() => setSelectedOrder(order)}
                          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-blue-300 hover:text-blue-200 border border-blue-500/30 bg-blue-500/10 hover:bg-blue-500/20 rounded-lg transition-colors"
                          title="Ver comprobante de pago"
                        >
                          <span>📄 Ver comprobante</span>
                        </button>
                      )}

                      {order.status === 'approved' && (
                        <>
                          <a
                            href={buildWhatsAppOrderUrl(order)}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border border-cyan-500/30 transition-colors"
                            title="Enviar link directo de descarga por WhatsApp"
                          >
                            <MessageCircle className="w-4 h-4" />
                            <span>WhatsApp</span>
                          </a>
                          <button
                            type="button"
                            onClick={() => handleCopyOrderLink(order.id)}
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-dark-700 hover:bg-dark-600 text-gray-200 hover:text-neon-green border border-dark-500 transition-colors"
                            title="Copiar link directo de descarga del pedido"
                          >
                            {copiedOrderId === order.id ? (
                              <span className="text-neon-green font-bold">¡Link copiado!</span>
                            ) : (
                              <span>🔗 Copiar Link</span>
                            )}
                          </button>
                        </>
                      )}

                      {isOrderPendingApproval(order.status) && (
                        <button
                          onClick={() => handleApprove(order.id)}
                          disabled={approvingId === order.id}
                          className="btn-neon text-sm py-2 flex items-center gap-2"
                        >
                          {approvingId === order.id
                            ? <Loader2 className="w-4 h-4 animate-spin" />
                            : <CheckCircle2 className="w-4 h-4" />
                          }
                          Aprobar
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => setConfirmDeleteOrder(order)}
                        disabled={deletingId === order.id}
                        className="ml-1 p-2 text-gray-400 hover:text-red-400 hover:bg-red-500/10 border border-dark-500 hover:border-red-500/30 rounded-lg transition-colors inline-flex items-center justify-center disabled:opacity-40"
                        title="Eliminar orden"
                      >
                        {deletingId === order.id ? (
                          <Loader2 className="w-4 h-4 animate-spin text-red-400" />
                        ) : (
                          <Trash2 className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Voucher & Order Detail Modal */}
      {selectedOrder && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto" onClick={() => setSelectedOrder(null)}>
          <div className="bg-dark-800 border border-dark-500 rounded-2xl p-6 max-w-lg w-full my-8 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <h3 className="font-bold text-white text-lg">Comprobante y Detalle de Orden</h3>
                <p className="text-gray-400 text-sm">
                  {selectedOrder.cliente?.nombre} · <strong className="text-neon-green">{formatPrice(selectedOrder.total)}</strong> ·{' '}
                  <span className="text-gray-300">{selectedOrder.paymentMethod === 'transfer' ? 'Transferencia bancaria' : 'Mercado Pago'}</span>
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {selectedOrder.cliente?.email} {selectedOrder.cliente?.telefono ? `· 📱 ${selectedOrder.cliente.telefono}` : ''}
                </p>
                {selectedOrder.couponCode && (
                  <p className="text-xs text-neon-green font-mono font-bold mt-1">
                    🏷️ Cupón aplicado: {selectedOrder.couponCode} {selectedOrder.couponDiscount ? `(Descuento: -${formatPrice(selectedOrder.couponDiscount)})` : ''}
                  </p>
                )}
              </div>
              <button onClick={() => setSelectedOrder(null)} className="text-gray-400 hover:text-white p-1">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Voucher — soporta URL segura de Cloudinary (imagen o PDF) y base64 legacy */}
            {isSafeHttpsUrl(selectedOrder.voucherUrl) ? (
              <div className="space-y-3 bg-dark-900/80 border border-dark-600 rounded-xl p-3">
                {selectedOrder.voucherUrl.toLowerCase().endsWith('.pdf') || selectedOrder.voucherName?.toLowerCase().endsWith('.pdf') ? (
                  <div className="p-6 bg-dark-700 rounded-lg text-center space-y-2">
                    <p className="text-white font-semibold text-sm">📄 Comprobante en PDF</p>
                    <p className="text-gray-400 text-xs">{selectedOrder.voucherName || 'comprobante.pdf'}</p>
                  </div>
                ) : (
                  <a href={selectedOrder.voucherUrl} target="_blank" rel="noreferrer" title="Clic para ampliar a pantalla completa">
                    <img
                      src={selectedOrder.voucherUrl}
                      alt="Comprobante de pago"
                      className="w-full rounded-lg max-h-96 object-contain bg-black/40 cursor-zoom-in"
                    />
                  </a>
                )}
                <div className="flex items-center justify-between gap-2 pt-1">
                  <span className="text-xs text-gray-400 truncate">
                    {selectedOrder.voucherName || 'Comprobante adjunto'}
                  </span>
                  <a
                    href={selectedOrder.voucherUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="btn-outline-neon py-1.5 px-3 inline-flex items-center gap-1.5 text-xs"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Abrir / Ampliar comprobante
                  </a>
                </div>
              </div>
            ) : selectedOrder.voucherBase64?.startsWith('data:image') ? (
              <img src={selectedOrder.voucherBase64} alt="Comprobante" className="w-full rounded-lg max-h-96 object-contain" />
            ) : selectedOrder.voucherBase64?.startsWith('data:application/pdf') ? (
              <div className="p-8 bg-dark-700 rounded-lg text-center">
                <p className="text-gray-400">PDF: {selectedOrder.voucherName}</p>
                <a href={selectedOrder.voucherBase64} download={selectedOrder.voucherName} className="btn-outline-neon mt-4 inline-flex">Descargar PDF</a>
              </div>
            ) : (
              <div className="p-6 bg-dark-700/60 border border-yellow-500/20 rounded-xl text-center">
                <p className="text-yellow-300/90 text-sm font-medium">El cliente no adjuntó archivo de comprobante</p>
                <p className="text-gray-400 text-xs mt-1">Verificá el ingreso en tu cuenta bancaria o Mercado Pago antes de aprobar.</p>
              </div>
            )}

            {/* Archivos incluidos en el pedido */}
            {selectedOrder.items?.length > 0 && (
              <div className="mt-4">
                <p className="text-xs text-gray-400 font-semibold uppercase tracking-wider mb-2">
                  Archivos del pedido ({selectedOrder.items.length})
                </p>
                <div className="max-h-28 overflow-y-auto space-y-1 pr-1">
                  {selectedOrder.items.map((it, idx) => (
                    <div key={it.id || idx} className="flex items-center justify-between text-xs bg-dark-700/70 px-2.5 py-1.5 rounded-lg">
                      <span className="text-gray-200 truncate">{it.fileName}</span>
                      <span className="text-neon-green font-mono ml-2">{formatPrice(it.price)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-2.5 mt-5">
              {isOrderPendingApproval(selectedOrder.status) ? (
                <button
                  onClick={() => handleApprove(selectedOrder.id)}
                  disabled={approvingId === selectedOrder.id}
                  className="btn-neon flex-1 flex items-center justify-center gap-2 text-sm py-2.5"
                >
                  {approvingId === selectedOrder.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  Aprobar y habilitar descarga
                </button>
              ) : (
                <>
                  <a
                    href={buildWhatsAppOrderUrl(selectedOrder)}
                    target="_blank"
                    rel="noreferrer"
                    className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-xs font-bold bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 transition-colors"
                  >
                    <MessageCircle className="w-4 h-4" />
                    Avisar por WhatsApp
                  </a>
                  <button
                    type="button"
                    onClick={() => handleCopyOrderLink(selectedOrder.id)}
                    className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-xs font-semibold bg-dark-700 hover:bg-dark-600 text-gray-200 border border-dark-500 transition-colors"
                  >
                    {copiedOrderId === selectedOrder.id ? <Check className="w-4 h-4 text-neon-green" /> : <Copy className="w-4 h-4" />}
                    {copiedOrderId === selectedOrder.id ? '¡Link copiado!' : 'Copiar link'}
                  </button>
                </>
              )}
              <button onClick={() => setSelectedOrder(null)} className="btn-outline-neon py-2.5 px-4 text-sm">
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de confirmación para eliminar orden */}
      {confirmDeleteOrder && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => { if (!deletingId) setConfirmDeleteOrder(null); }}
        >
          <div
            className="bg-dark-800 border border-red-500/40 rounded-2xl p-6 max-w-sm w-full shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 text-red-400 mb-3">
              <div className="p-2.5 bg-red-500/10 rounded-full border border-red-500/30 flex-shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-black text-white text-base">¿Eliminar esta orden?</h3>
                <p className="text-xs text-red-400/90">Esta acción es permanente</p>
              </div>
            </div>
            <p className="text-sm text-gray-300 mb-5">
              Se eliminará el pedido de <strong className="text-white">{confirmDeleteOrder.cliente?.nombre || 'Cliente'}</strong> por <strong className="text-neon-green">{formatPrice(confirmDeleteOrder.total)}</strong>.
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setConfirmDeleteOrder(null)}
                disabled={Boolean(deletingId)}
                className="btn-outline-neon flex-1 text-sm py-2"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => handleDelete(confirmDeleteOrder.id)}
                disabled={Boolean(deletingId)}
                className="flex-1 bg-red-600 hover:bg-red-500 text-white font-bold py-2 px-4 rounded-xl transition-colors flex items-center justify-center gap-2 text-sm disabled:opacity-50"
              >
                {deletingId ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                Sí, eliminar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
