import React, { useState, useEffect } from 'react';
import {
  collection, getDocs, addDoc, updateDoc, deleteDoc, doc,
  query, orderBy, Timestamp
} from 'firebase/firestore';
import { db } from '../../firebase/config';
import {
  Tag, Plus, Trash2, CheckCircle2, XCircle, AlertCircle,
  Loader2, Percent, DollarSign, Sparkles, Check
} from 'lucide-react';

function formatPrice(n) {
  return `$${(n || 0).toLocaleString('es-AR')}`;
}

function normalizeStr(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export default function AdminCoupons() {
  const [coupons, setCoupons] = useState([]);
  const [albums, setAlbums] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [togglingId, setTogglingId] = useState(null);
  const [updatingAlbumId, setUpdatingAlbumId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  // Form state
  const [form, setForm] = useState({
    code: '',
    type: 'percent', // 'percent' | 'fixed'
    value: '',
    albumId: '',     // ID del álbum asociado (o 'ALL' para todos los álbumes)
    label: '',
    active: true,
  });
  const [formError, setFormError] = useState('');
  const [formSuccess, setFormSuccess] = useState('');

  useEffect(() => {
    loadCoupons();
  }, []);

  async function loadCoupons() {
    setLoading(true);
    try {
      // Cargar álbumes para asociar cupones por álbum
      let loadedAlbums = [];
      try {
        const albumSnap = await getDocs(query(collection(db, 'albums'), orderBy('createdAt', 'desc')));
        loadedAlbums = albumSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      } catch {
        const albumSnap = await getDocs(collection(db, 'albums'));
        loadedAlbums = albumSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      }
      setAlbums(loadedAlbums);

      const q = query(collection(db, 'coupons'), orderBy('createdAt', 'desc'));
      const snap = await getDocs(q);
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setCoupons(list);

      if (loadedAlbums.length > 0) {
        setForm(prev => ({ ...prev, albumId: prev.albumId || loadedAlbums[0].id }));
      }
    } catch (err) {
      console.error('Error cargando cupones:', err);
      // Si la colección no tiene índice o falla el orderBy, fallback simple
      try {
        const snap = await getDocs(collection(db, 'coupons'));
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        list.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
        setCoupons(list);
      } catch (e) {
        console.error('Error fallback cupones:', e);
      }
    } finally {
      setLoading(false);
    }
  }

  // Resuelve a qué álbum pertenece un cupón (compatible con cupones previos donde el nombre del álbum se guardó en label)
  const resolveCouponAlbum = (coupon) => {
    if (!coupon) return null;
    if (coupon.albumId === 'ALL') return { id: 'ALL', title: 'Todos los álbumes' };
    if (coupon.albumId) {
      const byId = albums.find(a => a.id === coupon.albumId);
      if (byId) return { id: byId.id, title: byId.title };
      if (coupon.albumTitle) return { id: coupon.albumId, title: coupon.albumTitle };
    }
    if (coupon.albumTitle) {
      const byTitle = albums.find(a => normalizeStr(a.title) === normalizeStr(coupon.albumTitle));
      if (byTitle) return { id: byTitle.id, title: byTitle.title };
      return { id: '', title: coupon.albumTitle };
    }
    if (coupon.label) {
      const byLabel = albums.find(a => normalizeStr(a.title) === normalizeStr(coupon.label));
      if (byLabel) return { id: byLabel.id, title: byLabel.title };
      const isGenericLabel = /^\d+%?\s*(de descuento|off)/i.test(coupon.label.trim());
      if (!isGenericLabel) {
        return { id: '', title: coupon.label.trim() };
      }
    }
    return null;
  };

  const handleAssignAlbum = async (coupon, nextAlbumId) => {
    if (!coupon) return;
    setUpdatingAlbumId(coupon.id);
    try {
      const targetAlbum = albums.find(a => a.id === nextAlbumId);
      const updates = nextAlbumId === 'ALL'
        ? { albumId: 'ALL', albumTitle: '' }
        : {
            albumId: targetAlbum?.id || nextAlbumId,
            albumTitle: targetAlbum?.title || '',
          };
      await updateDoc(doc(db, 'coupons', coupon.id), updates);
      setCoupons(prev => prev.map(c => c.id === coupon.id ? { ...c, ...updates } : c));
    } catch (err) {
      alert('Error al actualizar el álbum del cupón: ' + err.message);
    } finally {
      setUpdatingAlbumId(null);
    }
  };

  const handleCreateCoupon = async (e) => {
    e.preventDefault();
    setFormError('');
    setFormSuccess('');

    const cleanCode = form.code.trim().toUpperCase().replace(/\s+/g, '');
    if (!cleanCode) {
      setFormError('El código del cupón es obligatorio.');
      return;
    }

    const numValue = Number(form.value);
    if (!numValue || numValue <= 0) {
      setFormError('El valor del descuento debe ser mayor a 0.');
      return;
    }

    if (form.type === 'percent' && numValue > 100) {
      setFormError('El porcentaje no puede ser mayor a 100%.');
      return;
    }

    if (!form.albumId) {
      setFormError('Seleccioná el álbum para el cual será válido este cupón.');
      return;
    }

    // Chequear si ya existe un cupón con el mismo código
    if (coupons.some(c => c.code === cleanCode)) {
      setFormError(`Ya existe un cupón con el código "${cleanCode}".`);
      return;
    }

    setCreating(true);
    try {
      const selectedAlbum = form.albumId === 'ALL'
        ? null
        : albums.find(a => a.id === form.albumId);

      const defaultLabel = form.label.trim() || selectedAlbum?.title || (
        form.type === 'percent'
          ? `${numValue}% de descuento`
          : `${formatPrice(numValue)} de descuento`
      );

      const newCouponData = {
        code: cleanCode,
        type: form.type,
        value: numValue,
        albumId: form.albumId === 'ALL' ? 'ALL' : (selectedAlbum?.id || form.albumId),
        albumTitle: selectedAlbum?.title || '',
        label: defaultLabel,
        active: Boolean(form.active),
        createdAt: Timestamp.now(),
      };

      const docRef = await addDoc(collection(db, 'coupons'), newCouponData);
      const createdItem = { id: docRef.id, ...newCouponData };

      setCoupons(prev => [createdItem, ...prev]);
      setForm(prev => ({
        code: '',
        type: 'percent',
        value: '',
        albumId: prev.albumId || (albums[0]?.id || ''),
        label: '',
        active: true,
      }));
      setFormSuccess(`¡Cupón "${cleanCode}" creado exitosamente para ${selectedAlbum ? `"${selectedAlbum.title}"` : 'todos los álbumes'}!`);
      setTimeout(() => setFormSuccess(''), 4000);
    } catch (err) {
      console.error('Error al crear cupón:', err);
      setFormError('Error al guardar el cupón: ' + (err.message || 'Error desconocido'));
    } finally {
      setCreating(false);
    }
  };

  const handleToggleActive = async (coupon) => {
    setTogglingId(coupon.id);
    const nextState = !coupon.active;
    try {
      await updateDoc(doc(db, 'coupons', coupon.id), { active: nextState });
      setCoupons(prev => prev.map(c => c.id === coupon.id ? { ...c, active: nextState } : c));
    } catch (err) {
      console.error('Error al cambiar estado del cupón:', err);
      alert('Error al actualizar estado: ' + err.message);
    } finally {
      setTogglingId(null);
    }
  };

  const handleDeleteCoupon = async (coupon) => {
    if (!coupon) return;
    setDeletingId(coupon.id);
    try {
      await deleteDoc(doc(db, 'coupons', coupon.id));
      setCoupons(prev => prev.filter(c => c.id !== coupon.id));
      setConfirmDelete(null);
    } catch (err) {
      console.error('Error al eliminar cupón:', err);
      alert('Error al eliminar el cupón: ' + err.message);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-8">
      {/* ── Encabezado ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-dark-600 pb-5">
        <div>
          <h1 className="text-2xl font-black text-white flex items-center gap-2.5">
            <Tag className="w-6 h-6 text-neon-green" />
            GESTIÓN DE CUPONES DE DESCUENTO
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            Creá, administrá y pausá códigos promocionales para deportistas, sponsors y eventos especiales.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="px-3 py-1.5 rounded-xl bg-dark-700 border border-dark-500 text-xs text-gray-300">
            Total creados: <strong className="text-neon-green font-mono">{coupons.length}</strong>
          </span>
        </div>
      </div>

      {/* ── Formulario de Creación ──────────────────────────────────────────── */}
      <div className="card-dark p-6 border border-dark-500 shadow-xl relative overflow-hidden">
        <div className="flex items-center gap-2 text-neon-green font-bold text-base mb-4">
          <Plus className="w-5 h-5" />
          <span>Crear Nuevo Cupón</span>
        </div>

        {formError && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-sm flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{formError}</span>
          </div>
        )}

        {formSuccess && (
          <div className="mb-4 p-3 bg-neon-green/10 border border-neon-green/30 rounded-xl text-neon-green text-sm flex items-center gap-2">
            <Check className="w-4 h-4 flex-shrink-0" />
            <span>{formSuccess}</span>
          </div>
        )}

        <form onSubmit={handleCreateCoupon} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            {/* Código */}
            <div>
              <label className="block text-xs font-semibold text-gray-300 uppercase tracking-wider mb-1.5">
                Código del Cupón *
              </label>
              <input
                type="text"
                value={form.code}
                onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
                placeholder="EJ: TEAM-BIKE-15 o RUNNING20"
                className="input-dark font-mono uppercase tracking-wider text-sm w-full"
                required
              />
              <span className="text-[11px] text-gray-500 mt-1 block">Ej: TEAM-BIKE-15, RUNNING20</span>
            </div>

            {/* Álbum Asociado */}
            <div>
              <label className="block text-xs font-semibold text-gray-300 uppercase tracking-wider mb-1.5">
                Álbum Asociado *
              </label>
              <select
                value={form.albumId}
                onChange={e => setForm(f => ({ ...f, albumId: e.target.value }))}
                className="input-dark text-sm w-full"
                required
              >
                <option value="" disabled>Seleccionar álbum...</option>
                {albums.map(album => (
                  <option key={album.id} value={album.id}>
                    📸 {album.title}
                  </option>
                ))}
                <option value="ALL">🌐 Todos los álbumes (General)</option>
              </select>
              <span className="text-[11px] text-gray-500 mt-1 block">
                Solo válido en las fotos de este álbum
              </span>
            </div>

            {/* Tipo de Descuento */}
            <div>
              <label className="block text-xs font-semibold text-gray-300 uppercase tracking-wider mb-1.5">
                Tipo de Descuento
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setForm(f => ({ ...f, type: 'percent' }))}
                  className={`py-2 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all border ${
                    form.type === 'percent'
                      ? 'bg-neon-green text-black border-neon-green shadow-md'
                      : 'bg-dark-700 text-gray-300 border-dark-500 hover:border-gray-400'
                  }`}
                >
                  <Percent className="w-3.5 h-3.5" />
                  <span>Porcentaje</span>
                </button>
                <button
                  type="button"
                  onClick={() => setForm(f => ({ ...f, type: 'fixed' }))}
                  className={`py-2 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all border ${
                    form.type === 'fixed'
                      ? 'bg-neon-green text-black border-neon-green shadow-md'
                      : 'bg-dark-700 text-gray-300 border-dark-500 hover:border-gray-400'
                  }`}
                >
                  <DollarSign className="w-3.5 h-3.5" />
                  <span>Monto Fijo</span>
                </button>
              </div>
            </div>

            {/* Valor */}
            <div>
              <label className="block text-xs font-semibold text-gray-300 uppercase tracking-wider mb-1.5">
                Valor del Descuento * {form.type === 'percent' ? '(%)' : '($ ARS)'}
              </label>
              <div className="relative flex items-center">
                <span className="absolute left-3 text-gray-400 text-sm font-mono">
                  {form.type === 'percent' ? '%' : '$'}
                </span>
                <input
                  type="number"
                  value={form.value}
                  onChange={e => setForm(f => ({ ...f, value: e.target.value }))}
                  placeholder={form.type === 'percent' ? '15' : '1500'}
                  className="input-dark font-mono text-sm w-full pl-8"
                  min="1"
                  max={form.type === 'percent' ? '100' : undefined}
                  required
                />
              </div>
              <span className="text-[11px] text-gray-500 mt-1 block">
                {form.type === 'percent' ? 'Ej. 15 = 15% OFF sobre el total' : 'Ej. 1500 = $1.500 ARS de descuento directo'}
              </span>
            </div>

            {/* Etiqueta / Descripción opcional */}
            <div>
              <label className="block text-xs font-semibold text-gray-300 uppercase tracking-wider mb-1.5">
                Descripción / Etiqueta (opcional)
              </label>
              <input
                type="text"
                value={form.label}
                onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
                placeholder="Ej. Promoción Carrera Sierras"
                className="input-dark text-sm w-full"
              />
              <span className="text-[11px] text-gray-500 mt-1 block">Visible para el cliente en el resumen</span>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-2 border-t border-dark-600">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={form.active}
                onChange={e => setForm(f => ({ ...f, active: e.target.checked }))}
                className="w-4 h-4 rounded text-neon-green focus:ring-neon-green bg-dark-700 border-dark-500 cursor-pointer"
              />
              <span className="text-xs text-gray-300">
                Habilitar cupón inmediatamente al crearlo
              </span>
            </label>

            <button
              type="submit"
              disabled={creating}
              className="btn-neon px-6 py-2.5 text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg"
            >
              {creating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Creando cupón...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>Guardar y Publicar Cupón</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* ── Listado de Cupones ──────────────────────────────────────────────── */}
      <div className="space-y-4">
        <h2 className="text-lg font-bold text-white flex items-center gap-2">
          <span>Cupones Registrados</span>
          <span className="text-xs text-gray-500 font-normal">({coupons.length})</span>
        </h2>

        {loading ? (
          <div className="card-dark p-12 text-center text-neon-green flex flex-col items-center justify-center gap-3">
            <Loader2 className="w-8 h-8 animate-spin" />
            <p className="text-sm">Cargando cupones desde Firestore...</p>
          </div>
        ) : coupons.length === 0 ? (
          <div className="card-dark p-12 text-center text-gray-500 flex flex-col items-center justify-center gap-2 border border-dark-600">
            <Tag className="w-10 h-10 opacity-30 text-gray-400" />
            <p className="text-base text-gray-300 font-semibold">No hay cupones creados todavía</p>
            <p className="text-xs text-gray-500 max-w-md">
              Usá el formulario superior para generar tu primer código de descuento para deportistas o sponsors.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {coupons.map(coupon => {
              const isToggling = togglingId === coupon.id;
              const isDeleting = deletingId === coupon.id;
              const isUpdatingAlbum = updatingAlbumId === coupon.id;
              const resolvedAlbum = resolveCouponAlbum(coupon);
              const discountDisplay = coupon.type === 'fixed'
                ? formatPrice(coupon.value)
                : `${coupon.value}%`;

              return (
                <div
                  key={coupon.id}
                  className={`card-dark p-5 border transition-all relative overflow-hidden flex flex-col justify-between ${
                    coupon.active
                      ? 'border-dark-500 hover:border-neon-green/40 shadow-lg'
                      : 'border-dark-700 opacity-60 bg-dark-800/40'
                  }`}
                >
                  <div>
                    {/* Header de la tarjeta */}
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="p-2 rounded-lg bg-neon-green/10 text-neon-green border border-neon-green/20 flex-shrink-0">
                          <Tag className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <span className="font-mono font-black text-white text-base tracking-wider truncate block">
                            {coupon.code}
                          </span>
                          <span className="text-[11px] text-gray-400 truncate block">
                            {coupon.label || 'Sin descripción'}
                          </span>
                        </div>
                      </div>

                      {/* Badge de Descuento */}
                      <span className="badge-neon font-mono font-black text-xs px-2.5 py-1 flex-shrink-0">
                        {discountDisplay} OFF
                      </span>
                    </div>

                    {/* Meta info */}
                    <div className="bg-dark-700/60 rounded-lg p-2.5 mb-4 text-xs space-y-1.5 border border-dark-600">
                      <div className="flex justify-between items-center gap-2 text-gray-400">
                        <span>Álbum válido:</span>
                        <span className="text-cyan-300 font-bold truncate max-w-[180px]" title={resolvedAlbum?.title || 'Sin restringir'}>
                          {resolvedAlbum ? `📸 ${resolvedAlbum.title}` : '🌐 Todos los álbumes'}
                        </span>
                      </div>
                      <div className="flex justify-between text-gray-400">
                        <span>Modalidad:</span>
                        <span className="text-gray-200 font-medium">
                          {coupon.type === 'fixed' ? 'Monto fijo en pesos' : 'Porcentaje sobre el total'}
                        </span>
                      </div>
                      <div className="flex justify-between text-gray-400">
                        <span>Estado:</span>
                        <span className={coupon.active ? 'text-neon-green font-bold' : 'text-gray-400 font-medium'}>
                          {coupon.active ? '● Activo para clientes' : '○ Pausado / Inactivo'}
                        </span>
                      </div>
                      <div className="pt-1.5 border-t border-dark-600/80">
                        <label className="text-[10px] text-gray-400 uppercase tracking-wider block mb-1">
                          Cambiar álbum asociado:
                        </label>
                        <select
                          value={resolvedAlbum?.id || 'ALL'}
                          disabled={isUpdatingAlbum}
                          onChange={e => handleAssignAlbum(coupon, e.target.value)}
                          className="w-full bg-dark-800 border border-dark-500 rounded-md px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-cyan-400 disabled:opacity-50"
                        >
                          {albums.map(a => (
                            <option key={a.id} value={a.id}>
                              📸 {a.title}
                            </option>
                          ))}
                          <option value="ALL">🌐 Todos los álbumes (General)</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* Acciones de la tarjeta */}
                  <div className="flex items-center justify-between gap-2 pt-3 border-t border-dark-600">
                    <button
                      type="button"
                      onClick={() => handleToggleActive(coupon)}
                      disabled={isToggling}
                      title={coupon.active ? 'Pausar cupón (no podrá ser usado en checkout)' : 'Activar cupón'}
                      className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition-colors flex items-center gap-1.5 border ${
                        coupon.active
                          ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30 hover:bg-yellow-500/20'
                          : 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30 hover:bg-cyan-500/20'
                      }`}
                    >
                      {isToggling ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : coupon.active ? (
                        <>
                          <XCircle className="w-3.5 h-3.5" />
                          <span>Pausar</span>
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Activar</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => setConfirmDelete(coupon)}
                      disabled={isDeleting}
                      title="Eliminar cupón de Firestore 🗑️"
                      className="text-xs p-2 rounded-lg text-gray-400 hover:text-red-400 hover:bg-red-500/10 transition-colors border border-transparent hover:border-red-500/20"
                    >
                      {isDeleting ? <Loader2 className="w-4 h-4 animate-spin text-red-400" /> : <Trash2 className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Modal de confirmación para eliminar cupón ───────────────────────── */}
      {confirmDelete && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn"
          onClick={() => { if (!deletingId) setConfirmDelete(null); }}
        >
          <div
            className="bg-dark-800 border border-red-500/40 rounded-2xl p-6 max-w-md w-full shadow-2xl relative"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 text-red-400 mb-4">
              <div className="p-3 bg-red-500/10 rounded-full border border-red-500/30 flex-shrink-0">
                <Trash2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold text-white text-base">¿Eliminar cupón de descuento?</h3>
                <p className="text-xs text-red-400 font-mono mt-0.5">{confirmDelete.code}</p>
              </div>
            </div>

            <p className="text-gray-300 text-sm mb-6 leading-relaxed">
              Estás a punto de borrar permanentemente el código promocional{' '}
              <strong className="text-white font-mono bg-dark-700 px-1.5 py-0.5 rounded border border-dark-600">
                {confirmDelete.code}
              </strong>
              . Los clientes que intenten usarlo en el carrito o checkout ya no recibirán descuento.
            </p>

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                disabled={deletingId === confirmDelete.id}
                className="px-4 py-2 rounded-lg bg-dark-700 hover:bg-dark-600 text-gray-300 text-xs font-semibold transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => handleDeleteCoupon(confirmDelete)}
                disabled={deletingId === confirmDelete.id}
                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-bold transition-colors flex items-center gap-2 shadow-lg shadow-red-600/30"
              >
                {deletingId === confirmDelete.id ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Eliminando...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" />
                    <span>Sí, eliminar cupón</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
