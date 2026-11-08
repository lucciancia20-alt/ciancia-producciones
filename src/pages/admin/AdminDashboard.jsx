import React, { useEffect, useState, useRef } from 'react';
import { collection, getDocs, onSnapshot, query, orderBy, updateDoc, deleteDoc, doc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useAuth } from '../../context/AuthContext';
import { Link, useNavigate } from 'react-router-dom';
import {
  BarChart3, ShoppingBag, Clock, CheckCircle2, TrendingUp, LogOut,
  Camera, Package, ChevronRight, Loader2, Eye, ExternalLink, Settings, Tag,
  Trash2, ArrowLeft, Bell, X
} from 'lucide-react';
import {
  playNewOrderSound,
  requestBrowserNotificationPermission,
  showBrowserOrderNotification,
} from '../../services/notificationService';

function formatPrice(n) {
  return `$${(n || 0).toLocaleString('es-AR')}`;
}

export default function AdminDashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const [orders, setOrders] = useState([]);
  const [albums, setAlbums] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [approvingId, setApprovingId] = useState(null);
  const [deletingOrderId, setDeletingOrderId] = useState(null);
  const [confirmDeleteOrder, setConfirmDeleteOrder] = useState(null);
  const [copiedOrderId, setCopiedOrderId] = useState(null);
  const [liveAlertOrder, setLiveAlertOrder] = useState(null);
  const [notifPerm, setNotifPerm] = useState(() => (typeof window !== 'undefined' && 'Notification' in window) ? Notification.permission : 'unsupported');
  const initialOrdersLoadedRef = useRef(false);

  useEffect(() => {
    getDocs(collection(db, 'albums'))
      .then(snap => setAlbums(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
      .catch(console.error);

    const qOrders = query(collection(db, 'orders'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(
      qOrders,
      (snap) => {
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setOrders(list);
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
        console.error('[AdminDashboard] Error en suscripción de órdenes:', err);
        setLoading(false);
      }
    );

    return () => unsub();
  }, []);

  const handleLogout = async () => {
    await logout();
    navigate('/admin/login');
  };

  const handleApproveOrder = async (orderId) => {
    setApprovingId(orderId);
    try {
      await updateDoc(doc(db, 'orders', orderId), {
        status: 'approved',
        downloadEnabled: true,
        approvedAt: new Date(),
      });
      setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: 'approved', downloadEnabled: true } : o));
      if (selectedOrder?.id === orderId) {
        setSelectedOrder(prev => ({ ...prev, status: 'approved', downloadEnabled: true }));
      }
    } catch (e) {
      alert('Error al aprobar: ' + e.message);
    } finally {
      setApprovingId(null);
    }
  };

  const handleDeleteOrder = async (orderId) => {
    setDeletingOrderId(orderId);
    try {
      await deleteDoc(doc(db, 'orders', orderId));
      setOrders(prev => prev.filter(o => o.id !== orderId));
      if (selectedOrder?.id === orderId) {
        setSelectedOrder(null);
      }
      setConfirmDeleteOrder(null);
    } catch (e) {
      console.error('[handleDeleteOrder] Error:', e);
      alert('Error al eliminar la orden: ' + (e.message || 'Error inesperado'));
    } finally {
      setDeletingOrderId(null);
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

  // Metrics
  const totalRevenue = orders.filter(o => o.status === 'approved').reduce((s, o) => s + (o.total || 0), 0);
  const pendingOrders = orders.filter(o => o.status === 'pending' || o.status === 'pending_mp');
  const approvedOrders = orders.filter(o => o.status === 'approved');

  const STAT_CARDS = [
    { label: 'Ingresos totales', value: formatPrice(totalRevenue), icon: TrendingUp, color: 'text-neon-green', bg: 'bg-neon-green/10 border-neon-green/30' },
    { label: 'Órdenes aprobadas', value: approvedOrders.length, icon: CheckCircle2, color: 'text-green-400', bg: 'bg-green-500/10 border-green-500/30' },
    { label: 'Pendientes de pago', value: pendingOrders.length, icon: Clock, color: 'text-yellow-400', bg: 'bg-yellow-500/10 border-yellow-500/30' },
    { label: 'Total órdenes', value: orders.length, icon: ShoppingBag, color: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/30' },
  ];

  return (
    <div className="min-h-screen pt-0 bg-dark-900">
      {/* Admin header */}
      <div className="bg-dark-800 border-b border-dark-600 px-4 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-neon-green rounded-lg flex items-center justify-center">
              <Camera className="w-5 h-5 text-black" />
            </div>
            <div>
              <h1 className="font-black text-white text-sm leading-none">PANEL DE ADMIN</h1>
              <p className="text-neon-green text-xs">Ciancia Producciones</p>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-4 flex-wrap">
            <button
              type="button"
              onClick={async () => {
                playNewOrderSound();
                const res = await requestBrowserNotificationPermission();
                setNotifPerm(res);
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all ${
                notifPerm === 'granted'
                  ? 'bg-neon-green/10 border-neon-green/40 text-neon-green'
                  : 'bg-dark-700 border-dark-500 text-gray-300 hover:border-neon-green/40 hover:text-neon-green'
              }`}
              title="Probar sonido y activar notificaciones del navegador en cada compra"
            >
              <Bell className="w-3.5 h-3.5" />
              <span>{notifPerm === 'granted' ? 'Alertas en vivo activas' : 'Activar alertas y sonido'}</span>
            </button>
            <Link
              to="/"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-dark-700 hover:bg-dark-600 border border-dark-500 hover:border-neon-green/40 text-gray-200 hover:text-neon-green text-xs font-semibold transition-all"
              title="Volver a la tienda principal"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Volver a la Tienda</span>
            </Link>
            <span className="text-gray-400 text-sm hidden sm:block">{user?.email}</span>
            <button onClick={handleLogout} className="flex items-center gap-1.5 text-gray-400 hover:text-red-400 transition-colors text-sm px-2 py-1">
              <LogOut className="w-4 h-4" />
              Salir
            </button>
          </div>
        </div>
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

      <div className="max-w-7xl mx-auto px-4 py-8 space-y-8">

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {STAT_CARDS.map(({ label, value, icon: Icon, color, bg }) => (
            <div key={label} className={`card-dark p-5 border ${bg}`}>
              <Icon className={`w-6 h-6 ${color} mb-3`} />
              <p className={`text-2xl font-black ${color}`}>{value}</p>
              <p className="text-gray-400 text-xs mt-1">{label}</p>
            </div>
          ))}
        </div>

        {/* Nav tabs */}
        <div className="flex gap-3 flex-wrap">
          <Link to="/admin/albums" className="flex items-center gap-2 bg-dark-700 border border-dark-500 hover:border-neon-green/50 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors">
            <Camera className="w-4 h-4 text-neon-green" /> Gestionar Álbumes
          </Link>
          <Link to="/admin/orders" className="flex items-center gap-2 bg-dark-700 border border-dark-500 hover:border-neon-green/50 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors">
            <Package className="w-4 h-4 text-yellow-400" /> Ver Órdenes
            {pendingOrders.length > 0 && <span className="badge-neon">{pendingOrders.length}</span>}
          </Link>
          <Link to="/admin/coupons" className="flex items-center gap-2 bg-dark-700 border border-dark-500 hover:border-neon-green/50 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors">
            <Tag className="w-4 h-4 text-neon-green" /> Gestionar Cupones
          </Link>
          <Link to="/admin/payment-config" className="flex items-center gap-2 bg-dark-700 border border-dark-500 hover:border-neon-green/50 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors">
            <Settings className="w-4 h-4 text-neon-green" /> Config. de Pagos
          </Link>
        </div>

        {/* Pending orders */}
        <div>
          <h2 className="text-xl font-black text-white mb-4 flex items-center gap-2">
            <Clock className="w-5 h-5 text-yellow-400" />
            ÓRDENES PENDIENTES
            {pendingOrders.length > 0 && <span className="badge-neon">{pendingOrders.length}</span>}
          </h2>

          {loading ? (
            <div className="text-neon-green animate-pulse py-4">Cargando órdenes...</div>
          ) : pendingOrders.length === 0 ? (
            <div className="card-dark p-8 text-center text-gray-500">
              <CheckCircle2 className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p>No hay órdenes pendientes</p>
            </div>
          ) : (
            <div className="space-y-4">
              {pendingOrders.map(order => (
                <div key={order.id} className="card-dark p-5 border border-yellow-500/20">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <p className="font-bold text-white">{order.cliente?.nombre || 'Sin nombre'}</p>
                      <p className="text-gray-400 text-sm">{order.cliente?.email}</p>
                      <p className="text-sm text-gray-400 mt-1">
                        {order.items?.length} ítems •
                        <span className="text-neon-green font-bold ml-1">{formatPrice(order.total)}</span> •
                        <span className="ml-1 capitalize">{order.paymentMethod === 'transfer' ? 'Transferencia bancaria' : 'Mercado Pago'}</span>
                        {(order.voucherUrl || order.voucherBase64) ? (
                          <span className="ml-2 text-xs text-emerald-400 font-medium">· 📎 Comprobante adjunto</span>
                        ) : (
                          <span className="ml-2 text-xs text-yellow-400/80">· Sin comprobante</span>
                        )}
                      </p>
                    </div>

                    <div className="flex items-center gap-3 flex-wrap">
                      {(order.voucherUrl || order.receipt || order.comprobanteUrl || order.voucherBase64) && (
                        <button
                          type="button"
                          onClick={() => setSelectedOrder(order)}
                          className="flex items-center gap-1.5 text-blue-300 hover:text-blue-200 border border-blue-500/30 bg-blue-500/10 hover:bg-blue-500/20 px-3 py-2 rounded-lg text-sm font-semibold transition-colors"
                        >
                          <span>📄 Ver comprobante</span>
                        </button>
                      )}
                      <button
                        onClick={() => handleApproveOrder(order.id)}
                        disabled={approvingId === order.id}
                        className="flex items-center gap-2 btn-neon text-sm py-2"
                      >
                        {approvingId === order.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <CheckCircle2 className="w-4 h-4" />
                        )}
                        Aprobar
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteOrder(order)}
                        disabled={deletingOrderId === order.id}
                        className="p-2 text-gray-400 hover:text-red-400 hover:bg-red-500/10 border border-dark-500 hover:border-red-500/30 rounded-lg transition-colors inline-flex items-center justify-center disabled:opacity-40"
                        title="Eliminar orden"
                      >
                        {deletingOrderId === order.id ? (
                          <Loader2 className="w-4 h-4 animate-spin text-red-400" />
                        ) : (
                          <Trash2 className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent approved */}
        {approvedOrders.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-black text-white flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-green-400" />
                ÓRDENES APROBADAS
              </h2>
              <span className="text-gray-400 text-xs">
                {approvedOrders.length} orden{approvedOrders.length !== 1 ? 'es' : ''}
              </span>
            </div>
            <div className="card-dark overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-dark-600 text-gray-400">
                    <th className="p-4 text-left font-medium">Cliente</th>
                    <th className="p-4 text-left font-medium hidden sm:table-cell">Email</th>
                    <th className="p-4 text-left font-medium hidden md:table-cell">Ítems</th>
                    <th className="p-4 text-right font-medium">Total</th>
                    <th className="p-4 text-center font-medium">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {approvedOrders.slice(0, 15).map(order => (
                    <tr key={order.id} className="border-b border-dark-700 hover:bg-dark-600/50 transition-colors">
                      <td className="p-4 text-white font-medium">{order.cliente?.nombre || '-'}</td>
                      <td className="p-4 text-gray-400 hidden sm:table-cell">{order.cliente?.email}</td>
                      <td className="p-4 text-gray-400 hidden md:table-cell">{order.items?.length}</td>
                      <td className="p-4 text-neon-green font-bold text-right">{formatPrice(order.total)}</td>
                      <td className="p-4 text-center">
                        <div className="inline-flex items-center gap-2 flex-wrap justify-center">
                          {(order.voucherUrl || order.receipt || order.comprobanteUrl || order.voucherBase64) && (
                            <button
                              type="button"
                              onClick={() => setSelectedOrder(order)}
                              className="px-2.5 py-1 text-xs font-semibold text-blue-300 bg-blue-500/15 hover:bg-blue-500/25 border border-blue-500/30 rounded-lg transition-colors"
                              title="Ver comprobante de pago"
                            >
                              📄 Ver comprobante
                            </button>
                          )}
                          <a
                            href={(() => {
                              const rawPhone = String(order?.cliente?.telefono || '').replace(/\D/g, '');
                              const phone = rawPhone && !rawPhone.startsWith('54') && rawPhone.length >= 8 && rawPhone.length <= 11
                                ? `549${rawPhone.replace(/^0+/, '')}`
                                : rawPhone;
                              const origin = typeof window !== 'undefined' ? window.location.origin : 'https://ciancia-producciones.onrender.com';
                              const text = `¡Hola ${order?.cliente?.nombre || ''}! 📸 Tu pedido en *Ciancia Producciones* ya está aprobado.\n\nDescargá tus fotos originales en HD acá:\n${origin}/?pedido=${order.id}`;
                              return phone ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}` : `https://wa.me/?text=${encodeURIComponent(text)}`;
                            })()}
                            target="_blank"
                            rel="noreferrer"
                            className="px-2.5 py-1 text-xs font-bold text-green-400 bg-green-500/15 hover:bg-green-500/25 border border-green-500/30 rounded-lg transition-colors"
                            title="Enviar link de descarga por WhatsApp"
                          >
                            📲 WhatsApp
                          </a>
                          <button
                            type="button"
                            onClick={() => handleCopyOrderLink(order.id)}
                            className="px-2.5 py-1 text-xs font-semibold text-gray-200 bg-dark-700 hover:bg-dark-600 border border-dark-500 hover:border-neon-green/40 rounded-lg transition-colors"
                            title="Copiar link directo de descarga"
                          >
                            {copiedOrderId === order.id ? (
                              <span className="text-neon-green font-bold">¡Link copiado!</span>
                            ) : (
                              <span>🔗 Copiar Link</span>
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteOrder(order)}
                            disabled={deletingOrderId === order.id}
                            className="ml-1 p-1.5 text-gray-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors inline-flex items-center justify-center disabled:opacity-40"
                            title="Eliminar orden"
                          >
                            {deletingOrderId === order.id ? (
                              <Loader2 className="w-4 h-4 animate-spin text-red-400" />
                            ) : (
                              <Trash2 className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Voucher modal */}
      {selectedOrder && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={() => setSelectedOrder(null)}>
          <div className="bg-dark-800 border border-dark-500 rounded-2xl p-6 max-w-lg w-full" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-white text-lg mb-1">Comprobante de pago</h3>
            <p className="text-gray-400 text-sm mb-4">{selectedOrder.cliente?.nombre} — {formatPrice(selectedOrder.total)}</p>

            {/* Voucher — soporta URL de Cloudinary (imagen o PDF) y base64 legacy */}
            {selectedOrder.voucherUrl ? (
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
                <p className="text-gray-400">Archivo PDF adjunto: {selectedOrder.voucherName}</p>
                <a
                  href={selectedOrder.voucherBase64}
                  download={selectedOrder.voucherName}
                  className="btn-outline-neon mt-4 inline-flex items-center gap-2"
                >
                  Descargar PDF
                </a>
              </div>
            ) : (
              <div className="p-6 bg-dark-700/60 border border-yellow-500/20 rounded-xl text-center">
                <p className="text-yellow-300/90 text-sm font-medium">El cliente no adjuntó archivo de comprobante</p>
                <p className="text-gray-400 text-xs mt-1">Verificá el ingreso en tu cuenta bancaria o Mercado Pago antes de aprobar.</p>
              </div>
            )}

            <div className="flex gap-3 mt-5">
              {selectedOrder.status !== 'approved' && (
                <button
                  onClick={() => handleApproveOrder(selectedOrder.id)}
                  disabled={approvingId === selectedOrder.id}
                  className="btn-neon flex-1 flex items-center justify-center gap-2"
                >
                  {approvingId === selectedOrder.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  Aprobar orden
                </button>
              )}
              <button onClick={() => setSelectedOrder(null)} className="btn-outline-neon flex-1">
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
          onClick={() => { if (!deletingOrderId) setConfirmDeleteOrder(null); }}
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
                disabled={Boolean(deletingOrderId)}
                className="btn-outline-neon flex-1 text-sm py-2"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => handleDeleteOrder(confirmDeleteOrder.id)}
                disabled={Boolean(deletingOrderId)}
                className="flex-1 bg-red-600 hover:bg-red-500 text-white font-bold py-2 px-4 rounded-xl transition-colors flex items-center justify-center gap-2 text-sm disabled:opacity-50"
              >
                {deletingOrderId ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                Sí, eliminar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
