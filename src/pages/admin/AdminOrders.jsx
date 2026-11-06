import React, { useEffect, useState } from 'react';
import { collection, getDocs, query, orderBy, updateDoc, deleteDoc, doc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { Link } from 'react-router-dom';
import {
  ArrowLeft, CheckCircle2, Clock, Eye, ExternalLink, Loader2, Package, XCircle,
  Trash2, Camera, MessageCircle, Copy, Check
} from 'lucide-react';

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
  pending_mp: { label: 'MP Pendiente', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30', icon: Clock },
  approved: { label: 'Aprobado', color: 'bg-green-500/20 text-green-400 border-green-500/30', icon: CheckCircle2 },
  rejected: { label: 'Rechazado', color: 'bg-red-500/20 text-red-400 border-red-500/30', icon: XCircle },
};

export default function AdminOrders() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('all');
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [approvingId, setApprovingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  useEffect(() => {
    async function load() {
      try {
        const snap = await getDocs(query(collection(db, 'orders'), orderBy('createdAt', 'desc')));
        setOrders(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    }
    load();
  }, []);

  const handleApprove = async (orderId) => {
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
    } catch (e) { alert('Error: ' + e.message); }
    finally { setApprovingId(null); }
  };

  const handleDelete = async (orderId) => {
    if (!window.confirm('¿Seguro que deseas eliminar esta orden? Se borrará de forma permanente de Firestore.')) {
      return;
    }
    setDeletingId(orderId);
    try {
      await deleteDoc(doc(db, 'orders', orderId));
      setOrders(prev => prev.filter(o => o.id !== orderId));
      if (selectedOrder?.id === orderId) {
        setSelectedOrder(null);
      }
    } catch (e) {
      console.error('[handleDelete] Error:', e);
      alert('Error al eliminar: ' + (e.message || 'Error inesperado'));
    } finally {
      setDeletingId(null);
    }
  };

  const filtered = filterStatus === 'all' ? orders : orders.filter(o => o.status === filterStatus);

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

          <Link
            to="/"
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-dark-800 border border-dark-600 text-gray-300 hover:text-neon-green hover:border-neon-green/50 transition-all text-sm font-semibold shadow-sm ml-auto"
            title="Ir a la portada pública"
          >
            <span>Ver Tienda</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </Link>
        </div>

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
              {key === 'pending' && orders.filter(o => o.status === 'pending' || o.status === 'pending_mp').length > 0 && (
                <span className="ml-2 badge-neon">
                  {orders.filter(o => o.status === 'pending' || o.status === 'pending_mp').length}
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
                      <div className="flex items-center gap-3 mb-1">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold border ${sc.color}`}>
                          <StatusIcon className="w-3 h-3" /> {sc.label}
                        </span>
                        <span className="text-gray-500 text-xs capitalize">{order.paymentMethod === 'transfer' ? 'Transferencia' : 'MercadoPago'}</span>
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

                      {order.status === 'approved' && (
                        <a
                          href={buildWhatsAppOrderUrl(order)}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-green-500/15 hover:bg-green-500/25 text-green-400 border border-green-500/30 transition-colors"
                          title="Enviar link directo de descarga por WhatsApp"
                        >
                          <MessageCircle className="w-4 h-4" />
                          <span>Enviar WhatsApp</span>
                        </a>
                      )}

                      {(order.voucherUrl || order.voucherBase64) && (
                        <button
                          onClick={() => setSelectedOrder(order)}
                          className="p-2 text-blue-400 hover:text-blue-300 border border-blue-500/30 bg-blue-500/10 rounded-lg transition-colors"
                          title="Ver comprobante"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                      )}

                      {(order.status === 'pending' || order.status === 'pending_mp') && (
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
                        onClick={() => handleDelete(order.id)}
                        disabled={deletingId === order.id}
                        className="p-2 text-gray-400 hover:text-red-400 hover:bg-red-500/10 border border-dark-500 hover:border-red-500/30 rounded-lg transition-colors inline-flex items-center justify-center disabled:opacity-40"
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

      {/* Voucher modal */}
      {selectedOrder && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={() => setSelectedOrder(null)}>
          <div className="bg-dark-800 border border-dark-500 rounded-2xl p-6 max-w-lg w-full" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-white text-lg mb-1">Comprobante</h3>
            <p className="text-gray-400 text-sm mb-4">
              {selectedOrder.cliente?.nombre} · {formatPrice(selectedOrder.total)}
            </p>

            {/* Voucher — soporta URL nueva (Cloudinary) y base64 legacy */}
            {selectedOrder.voucherUrl ? (
              <div className="space-y-3">
                <img
                  src={selectedOrder.voucherUrl}
                  alt="Comprobante"
                  className="w-full rounded-lg max-h-96 object-contain"
                  onError={e => { e.target.style.display = 'none'; }}
                />
                <a
                  href={selectedOrder.voucherUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-outline-neon inline-flex items-center gap-2 text-sm"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Abrir en nueva pestaña
                </a>
              </div>
            ) : selectedOrder.voucherBase64?.startsWith('data:image') ? (
              <img src={selectedOrder.voucherBase64} alt="Comprobante" className="w-full rounded-lg max-h-96 object-contain" />
            ) : selectedOrder.voucherBase64?.startsWith('data:application/pdf') ? (
              <div className="p-8 bg-dark-700 rounded-lg text-center">
                <p className="text-gray-400">PDF: {selectedOrder.voucherName}</p>
                <a href={selectedOrder.voucherBase64} download={selectedOrder.voucherName} className="btn-outline-neon mt-4 inline-flex">Descargar PDF</a>
              </div>
            ) : (
              <p className="text-gray-400 text-center py-8">Sin comprobante</p>
            )}

            <div className="flex gap-3 mt-5">
              {(selectedOrder.status === 'pending' || selectedOrder.status === 'pending_mp') && (
                <button onClick={() => handleApprove(selectedOrder.id)} disabled={approvingId === selectedOrder.id} className="btn-neon flex-1 flex items-center justify-center gap-2">
                  {approvingId === selectedOrder.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  Aprobar
                </button>
              )}
              <button onClick={() => setSelectedOrder(null)} className="btn-outline-neon flex-1">Cerrar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
