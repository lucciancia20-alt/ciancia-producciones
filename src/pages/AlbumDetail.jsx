import React, { useEffect, useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { collection, getDocs, query, where, doc, getDoc, deleteDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { useAuth } from '../context/AuthContext';
import MediaCard from '../components/MediaCard';
import MagnifierViewer from '../components/MagnifierViewer';
import SelfieSearchModal from '../components/SelfieSearchModal';
import { Search, ArrowLeft, Camera, Video, Filter, X, ScanFace, Trash2, Loader2 } from 'lucide-react';

export default function AlbumDetail() {
  const { albumId } = useParams();
  const { user } = useAuth();
  const [album, setAlbum] = useState(null);
  const [media, setMedia] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [viewingMedia, setViewingMedia] = useState(null);
  const [selfieModalOpen, setSelfieModalOpen] = useState(false);
  const [faceMatchIds, setFaceMatchIds] = useState(null); // null | Set<string>
  const [confirmDeleteMedia, setConfirmDeleteMedia] = useState(null);
  const [deletingMedia, setDeletingMedia] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        // Get album
        const albumDoc = await getDoc(doc(db, 'albums', albumId));
        if (albumDoc.exists()) {
          setAlbum({ id: albumDoc.id, ...albumDoc.data() });
        }
        // Get media for album
        const snap = await getDocs(query(collection(db, 'media'), where('albumId', '==', albumId)));
        setMedia(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [albumId]);

  const filtered = useMemo(() => {
    return media.filter(item => {
      // Face filter (selfie)
      if (faceMatchIds && !faceMatchIds.has(item.id)) return false;
      // Type filter
      if (filterType === 'photo' && item.type !== 'photo') return false;
      if (filterType === 'video' && item.type !== 'video') return false;
      // Dorsal search
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const inDorsals = (item.dorsals || []).some(d => String(d).toLowerCase().includes(q));
        const inName = (item.fileName || '').toLowerCase().includes(q);
        if (!inDorsals && !inName) return false;
      }
      return true;
    });
  }, [media, search, filterType, faceMatchIds]);

  const photosWithFaces = useMemo(
    () => media.filter(m => m.type === 'photo' && Array.isArray(m.faceDescriptors) && m.faceDescriptors.length > 0),
    [media]
  );

  const handleConfirmDelete = async () => {
    if (!confirmDeleteMedia) return;
    setDeletingMedia(true);
    try {
      await deleteDoc(doc(db, 'media', confirmDeleteMedia.id));
      try {
        await deleteDoc(doc(db, 'albums', albumId, 'media', confirmDeleteMedia.id));
      } catch {
        // noop
      }
      const nextCount = Math.max(0, (media.length || 1) - 1);
      await updateDoc(doc(db, 'albums', albumId), { totalMedia: nextCount });
      setMedia(prev => prev.filter(m => m.id !== confirmDeleteMedia.id));
      setAlbum(prev => prev ? { ...prev, totalMedia: nextCount } : prev);
      setConfirmDeleteMedia(null);
    } catch (err) {
      alert('Error al eliminar foto: ' + err.message);
    } finally {
      setDeletingMedia(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen pt-24 flex items-center justify-center">
        <div className="text-neon-green animate-pulse font-bold text-xl">Cargando álbum...</div>
      </div>
    );
  }

  if (!album) {
    return (
      <div className="min-h-screen pt-24 flex flex-col items-center justify-center gap-4">
        <p className="text-gray-400 text-lg">Álbum no encontrado.</p>
        <Link to="/" className="btn-outline-neon">Volver al inicio</Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen pt-20">
      {/* Album hero */}
      <div className="relative h-72 overflow-hidden">
        <img src={album.coverUrl} alt={album.title} className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-dark-900 via-dark-900/60 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 p-6 max-w-7xl mx-auto">
          <Link to="/" className="inline-flex items-center gap-2 text-gray-400 hover:text-neon-green transition-colors mb-3 text-sm">
            <ArrowLeft className="w-4 h-4" />
            Volver
          </Link>
          <h1 className="text-3xl sm:text-4xl font-black text-white leading-tight">{album.title}</h1>
          <div className="flex items-center gap-4 mt-2 text-gray-400 text-sm">
            <span>📍 {album.location}</span>
            <span>🗂 {media.length} archivos</span>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="flex flex-col sm:flex-row gap-4">
          {/* Dorsal search */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
            <input
              type="text"
              placeholder="Buscá por número de dorsal / pechera..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="input-dark pl-10 text-base"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Selfie search */}
          <button
            onClick={() => setSelfieModalOpen(true)}
            disabled={photosWithFaces.length === 0}
            title={photosWithFaces.length === 0 ? 'Este álbum aún no tiene rostros indexados por IA' : 'Buscar mis fotos con una selfie'}
            className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-bold whitespace-nowrap border border-neon-green/50 text-neon-green hover:bg-neon-green hover:text-black transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-neon-green"
          >
            <ScanFace className="w-4 h-4" />
            Buscarme con Selfie 🤳
          </button>

          {/* Type filter */}
          <div className="flex gap-2">
            {[
              { key: 'all', label: 'Todo', icon: Filter },
              { key: 'photo', label: 'Fotos', icon: Camera },
              { key: 'video', label: 'Videos', icon: Video },
            ].map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setFilterType(key)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  filterType === key
                    ? 'bg-neon-green text-black'
                    : 'bg-dark-700 text-gray-400 hover:text-white border border-dark-500'
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Face filter banner */}
        {faceMatchIds && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-neon-green/40 bg-neon-green/10 px-4 py-3">
            <div className="flex items-center gap-2 text-sm text-white">
              <ScanFace className="w-5 h-5 text-neon-green" />
              {faceMatchIds.size > 0
                ? <span>Mostrando <strong className="text-neon-green">{faceMatchIds.size}</strong> foto{faceMatchIds.size !== 1 ? 's' : ''} donde aparecés</span>
                : <span>No encontramos coincidencias faciales en este álbum</span>}
            </div>
            <button
              onClick={() => setFaceMatchIds(null)}
              className="flex items-center gap-1.5 text-sm text-gray-300 hover:text-white bg-dark-700 border border-dark-500 px-3 py-1.5 rounded-lg"
            >
              <X className="w-4 h-4" /> Limpiar filtro facial
            </button>
          </div>
        )}

        {/* Dorsal hint */}
        {search && (
          <div className="mt-3 text-sm text-gray-400">
            {filtered.length === 0
              ? `Sin resultados para dorsal "${search}"`
              : `${filtered.length} archivo${filtered.length !== 1 ? 's' : ''} con dorsal "${search}"`
            }
          </div>
        )}
      </div>

      {/* Media grid */}
      <div className="max-w-7xl mx-auto px-4 pb-16">
        {filtered.length === 0 ? (
          <div className="text-center py-24 text-gray-400">
            <Search className="w-16 h-16 mx-auto mb-4 opacity-20" />
            <p className="font-medium text-lg">Sin resultados</p>
            <p className="text-sm mt-1">Probá con otro número de dorsal</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {filtered.map(item => (
              <MediaCard
                key={item.id}
                media={item}
                onView={setViewingMedia}
                onDelete={user ? setConfirmDeleteMedia : undefined}
              />
            ))}
          </div>
        )}
      </div>

      {/* Magnifier viewer */}
      {viewingMedia && (
        <MagnifierViewer media={viewingMedia} onClose={() => setViewingMedia(null)} />
      )}

      {/* Selfie search modal */}
      <SelfieSearchModal
        open={selfieModalOpen}
        onClose={() => setSelfieModalOpen(false)}
        mediaItems={photosWithFaces}
        onResults={(ids) => {
          setFaceMatchIds(ids);
          setFilterType('all');
          setSearch('');
        }}
      />

      {/* Modal de confirmación rápido para eliminar foto (modo Admin) */}
      {confirmDeleteMedia && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn"
          onClick={() => { if (!deletingMedia) setConfirmDeleteMedia(null); }}
        >
          <div
            className="bg-dark-800 border border-red-500/40 rounded-2xl p-6 max-w-sm w-full shadow-2xl relative"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 text-red-400 mb-4">
              <div className="p-2.5 bg-red-500/10 rounded-full border border-red-500/30 flex-shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-black text-white text-base">¿Eliminar esta foto del álbum?</h3>
                <p className="text-xs text-red-400/90 font-medium">Se quitará de la tienda de inmediato</p>
              </div>
            </div>

            <div className="flex items-center gap-3 bg-dark-700/80 rounded-xl p-3 border border-dark-600 mb-5">
              <img
                src={confirmDeleteMedia.thumb || confirmDeleteMedia.url}
                alt={confirmDeleteMedia.fileName}
                className="w-16 h-12 object-cover rounded-lg flex-shrink-0"
              />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-white font-semibold truncate">{confirmDeleteMedia.fileName}</p>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  {confirmDeleteMedia.dorsals?.length
                    ? `Dorsales: ${confirmDeleteMedia.dorsals.join(', ')}`
                    : 'Sin dorsales asignados'}
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setConfirmDeleteMedia(null)}
                disabled={deletingMedia}
                className="btn-outline-neon flex-1 text-sm py-2 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={deletingMedia}
                className="flex-1 bg-red-600 hover:bg-red-500 text-white font-bold py-2 px-4 rounded-xl transition-colors flex items-center justify-center gap-2 text-sm disabled:opacity-50"
              >
                {deletingMedia ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Eliminando…
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" />
                    Eliminar 🗑️
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
