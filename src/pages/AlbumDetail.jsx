import React, { useEffect, useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { collection, getDocs, query, where, doc, getDoc, deleteDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import MediaCard from '../components/MediaCard';
import MagnifierViewer from '../components/MagnifierViewer';
import { VISUAL_COLOR_PALETTE, VISUAL_COLOR_MAP, normalizeColorList } from '../constants/visualColors';
import {
  Search, ArrowLeft, Camera, Video, Filter, X, ScanFace,
  Trash2, Loader2, ShoppingCart, Sparkles, Check, ChevronDown, ChevronUp,
} from 'lucide-react';

// Carga 100% diferida del modal de selfie para evitar que se cargue face-api / tensorflow al abrir el álbum
const SelfieSearchModal = React.lazy(() => import('../components/SelfieSearchModal'));

function VisualColorChipsRow({ title, subtitle, selectedColor, onSelectColor }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs sm:text-sm font-bold text-white flex items-center gap-1.5">
          {title}
          {subtitle && <span className="text-xs font-normal text-gray-400">{subtitle}</span>}
        </span>
        {selectedColor && (
          <button
            type="button"
            onClick={() => onSelectColor(null)}
            className="text-[11px] text-neon-green hover:underline font-semibold flex items-center gap-1"
          >
            <X className="w-3 h-3" /> Quitar ({VISUAL_COLOR_MAP[selectedColor]?.label})
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onSelectColor(null)}
          className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
            !selectedColor
              ? 'bg-neon-green text-black border-neon-green font-bold shadow-sm'
              : 'bg-dark-700 text-gray-300 border-dark-500 hover:border-gray-400 hover:text-white'
          }`}
        >
          Todos
        </button>

        {VISUAL_COLOR_PALETTE.map(color => {
          const isSelected = selectedColor === color.id;
          return (
            <button
              key={color.id}
              type="button"
              onClick={() => onSelectColor(isSelected ? null : color.id)}
              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                isSelected
                  ? 'bg-neon-green/20 border-neon-green text-white ring-2 ring-neon-green/40 shadow-md scale-[1.02]'
                  : 'bg-dark-700 border-dark-500 text-gray-300 hover:border-gray-400 hover:text-white'
              }`}
            >
              <span
                className="w-3.5 h-3.5 rounded-full flex-shrink-0 border shadow-inner"
                style={{ backgroundColor: color.hex, borderColor: color.border }}
              />
              <span>{color.label}</span>
              {isSelected && <Check className="w-3.5 h-3.5 text-neon-green" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function AlbumDetail() {
  const { albumId } = useParams();
  const { user } = useAuth();
  const { items: cartItems, addItem, total, packRule, itemCount } = useCart();
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

  // Estados para el filtro de Atributos Visuales (Ciclismo / Running)
  const [visualFilterOpen, setVisualFilterOpen] = useState(false);
  const [selectedHelmetColor, setSelectedHelmetColor] = useState(null);
  const [selectedBikeColor, setSelectedBikeColor] = useState(null);
  const [selectedJerseyColor, setSelectedJerseyColor] = useState(null);

  const activeVisualCount = [selectedHelmetColor, selectedBikeColor, selectedJerseyColor].filter(Boolean).length;
  const hasVisualFilter = activeVisualCount > 0;

  const clearVisualFilters = () => {
    setSelectedHelmetColor(null);
    setSelectedBikeColor(null);
    setSelectedJerseyColor(null);
  };

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
      // Visual attributes filter (Casco / Bicicleta / Remera-Maillot)
      if (selectedHelmetColor) {
        const helmetList = normalizeColorList(item.helmetColors || []);
        if (!helmetList.includes(selectedHelmetColor)) return false;
      }
      if (selectedBikeColor) {
        const bikeList = normalizeColorList(item.bikeColors || []);
        if (!bikeList.includes(selectedBikeColor)) return false;
      }
      if (selectedJerseyColor) {
        const jerseyList = normalizeColorList(item.jerseyColors || []);
        if (!jerseyList.includes(selectedJerseyColor)) return false;
      }
      // Dorsal / Bib search
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const dorsalsList = item.dorsals || item.bibs || [];
        const inDorsals = dorsalsList.some(d => String(d).toLowerCase().includes(q));
        const inName = (item.fileName || '').toLowerCase().includes(q);
        if (!inDorsals && !inName) return false;
      }
      return true;
    });
  }, [media, search, filterType, faceMatchIds, selectedHelmetColor, selectedBikeColor, selectedJerseyColor]);

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

  const heroCover = album.coverUrl || album.coverImage || (media.length > 0 ? (media[0].thumb || media[0].url) : null);

  return (
    <div className="min-h-screen pt-16">
      {/* Album hero — más alto para lucir la portada y encuadrar limpia la 1ra fila de fotos */}
      <div className="relative h-80 sm:h-96 md:h-[410px] overflow-hidden bg-dark-800">
        {heroCover ? (
          <img src={heroCover} alt="" role="presentation" className="w-full h-full object-cover object-center" />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-dark-800 via-dark-900 to-black" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-dark-900 via-dark-900/45 to-black/20" />
        <div className="absolute bottom-0 left-0 right-0 p-6 sm:pb-8 max-w-7xl mx-auto">
          <Link to="/" className="inline-flex items-center gap-2 text-gray-300 hover:text-neon-green transition-colors mb-3 text-sm font-medium drop-shadow">
            <ArrowLeft className="w-4 h-4" />
            Volver
          </Link>
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-black text-white leading-tight drop-shadow-lg">{album.title}</h1>
          <div className="flex items-center gap-4 mt-2.5 text-gray-300 text-sm font-medium drop-shadow">
            <span>📍 {album.location}</span>
            <span>🗂 {media.length} archivos</span>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="max-w-7xl mx-auto px-4 py-7">
        <div className="flex flex-col lg:flex-row gap-3">
          {/* Dorsal search */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
            <input
              type="text"
              inputMode="numeric"
              autoComplete="off"
              autoCorrect="off"
              spellCheck="false"
              data-lpignore="true"
              data-form-type="other"
              placeholder="Buscá por número de dorsal / pechera..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="input-dark pl-10 text-base font-mono"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Botón desplegable: Buscar por Casco / Bici / Ropa */}
            <button
              type="button"
              onClick={() => setVisualFilterOpen(prev => !prev)}
              className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-bold whitespace-nowrap border transition-all ${
                visualFilterOpen || hasVisualFilter
                  ? 'bg-neon-green text-black border-neon-green shadow-lg shadow-neon-green/20'
                  : 'bg-dark-800 border-neon-green/50 text-neon-green hover:bg-neon-green hover:text-black'
              }`}
            >
              <span>🚴 Buscar por Casco / Bici / Ropa</span>
              {activeVisualCount > 0 && (
                <span className={`px-1.5 py-0.5 rounded-full text-xs font-black ${
                  visualFilterOpen || hasVisualFilter ? 'bg-black text-neon-green' : 'bg-neon-green text-black'
                }`}>
                  {activeVisualCount}
                </span>
              )}
              {visualFilterOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>

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
        </div>

        {/* Panel desplegable de Búsqueda por Atributos Visuales (Casco / Bicicleta / Remera-Maillot) */}
        {visualFilterOpen && (
          <div className="mt-4 rounded-2xl border border-neon-green/40 bg-dark-800/95 p-4 sm:p-5 shadow-xl space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-dark-600 pb-3">
              <div>
                <h3 className="text-white font-black text-sm sm:text-base flex items-center gap-2">
                  <span>🚴 Filtro Visual de Ciclismo y Running</span>
                  {hasVisualFilter && (
                    <span className="badge-neon text-xs">
                      {filtered.length} {filtered.length === 1 ? 'foto encontrada' : 'fotos encontradas'}
                    </span>
                  )}
                </h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  ¿No se ve tu dorsal o llevabas casco y lentes? Combiná el color de tu casco, bicicleta y remera/maillot para encontrar tus fotos al instante.
                </p>
              </div>
              <div className="flex items-center gap-2">
                {hasVisualFilter && (
                  <button
                    type="button"
                    onClick={clearVisualFilters}
                    className="flex items-center gap-1.5 text-xs font-bold text-red-300 hover:text-white bg-red-500/15 hover:bg-red-500/25 border border-red-500/30 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    <X className="w-3.5 h-3.5" /> Limpiar colores
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setVisualFilterOpen(false)}
                  className="text-xs text-gray-400 hover:text-white px-2.5 py-1.5 rounded-lg bg-dark-700 border border-dark-500"
                >
                  Cerrar
                </button>
              </div>
            </div>

            <div className="space-y-4">
              <VisualColorChipsRow
                title="🪖 Color de Casco"
                subtitle="(Ciclismo / MTB)"
                selectedColor={selectedHelmetColor}
                onSelectColor={setSelectedHelmetColor}
              />

              <VisualColorChipsRow
                title="🚲 Color de Bicicleta"
                subtitle="(Cuadro principal)"
                selectedColor={selectedBikeColor}
                onSelectColor={setSelectedBikeColor}
              />

              <VisualColorChipsRow
                title="👕 Color de Remera / Maillot"
                subtitle="(Ciclismo / Running)"
                selectedColor={selectedJerseyColor}
                onSelectColor={setSelectedJerseyColor}
              />
            </div>
          </div>
        )}

        {/* Banner resumen de filtros visuales activos (cuando el panel está cerrado) */}
        {hasVisualFilter && !visualFilterOpen && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-neon-green/40 bg-neon-green/10 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2 text-sm text-white">
              <span className="font-bold text-neon-green">🚴 Filtro visual activo:</span>
              {selectedHelmetColor && (
                <span className="inline-flex items-center gap-1.5 bg-dark-800 border border-dark-500 px-2.5 py-1 rounded-full text-xs">
                  <span
                    className="w-3 h-3 rounded-full border"
                    style={{ backgroundColor: VISUAL_COLOR_MAP[selectedHelmetColor]?.hex, borderColor: VISUAL_COLOR_MAP[selectedHelmetColor]?.border }}
                  />
                  Casco: <strong>{VISUAL_COLOR_MAP[selectedHelmetColor]?.label}</strong>
                </span>
              )}
              {selectedBikeColor && (
                <span className="inline-flex items-center gap-1.5 bg-dark-800 border border-dark-500 px-2.5 py-1 rounded-full text-xs">
                  <span
                    className="w-3 h-3 rounded-full border"
                    style={{ backgroundColor: VISUAL_COLOR_MAP[selectedBikeColor]?.hex, borderColor: VISUAL_COLOR_MAP[selectedBikeColor]?.border }}
                  />
                  Bici: <strong>{VISUAL_COLOR_MAP[selectedBikeColor]?.label}</strong>
                </span>
              )}
              {selectedJerseyColor && (
                <span className="inline-flex items-center gap-1.5 bg-dark-800 border border-dark-500 px-2.5 py-1 rounded-full text-xs">
                  <span
                    className="w-3 h-3 rounded-full border"
                    style={{ backgroundColor: VISUAL_COLOR_MAP[selectedJerseyColor]?.hex, borderColor: VISUAL_COLOR_MAP[selectedJerseyColor]?.border }}
                  />
                  Ropa: <strong>{VISUAL_COLOR_MAP[selectedJerseyColor]?.label}</strong>
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={clearVisualFilters}
              className="flex items-center gap-1.5 text-sm text-gray-300 hover:text-white bg-dark-700 border border-dark-500 px-3 py-1.5 rounded-lg"
            >
              <X className="w-4 h-4" /> Limpiar filtro visual
            </button>
          </div>
        )}

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

        {/* Dorsal / Visual / Selfie hint + Botón Pack Completo estilo Fhotobase */}
        {(search.trim() || hasVisualFilter || (faceMatchIds && faceMatchIds.size > 0)) && (
          <div className="mt-4">
            {filtered.length === 0 ? (
              <div className="text-sm text-gray-400">
                {search.trim() ? `Sin resultados para dorsal "${search}"` : 'Sin resultados para la combinación de filtros seleccionada'}
              </div>
            ) : (
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-neon-green/40 bg-gradient-to-r from-neon-green/15 via-dark-800 to-dark-800 px-4 py-3.5 shadow-lg">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-neon-green/20 border border-neon-green/40 flex items-center justify-center flex-shrink-0">
                    <Sparkles className="w-5 h-5 text-neon-green" />
                  </div>
                  <div>
                    <p className="text-white font-bold text-sm sm:text-base">
                      ¡Encontramos <span className="text-neon-green font-black">{filtered.length}</span> {filtered.length === 1 ? 'archivo tuyo' : 'archivos tuyos'}!
                      {filtered.length >= 10 && <span className="ml-2 badge-neon">30% OFF Pack</span>}
                      {filtered.length >= 5 && filtered.length < 10 && <span className="ml-2 badge-neon">20% OFF Pack</span>}
                      {filtered.length >= 2 && filtered.length < 5 && <span className="ml-2 badge-neon">10% OFF Pack</span>}
                    </p>
                    <p className="text-xs text-gray-300 mt-0.5">
                      {filtered.length >= 2
                        ? 'Llevando tu pack completo se aplica el descuento por cantidad automáticamente.'
                        : 'Agregalo a tu carrito para descargar el original en Alta Definición sin marca de agua.'}
                    </p>
                  </div>
                </div>

                {filtered.every(item => cartItems.some(c => c.id === item.id)) ? (
                  <Link
                    to="/cart"
                    className="btn-neon text-xs sm:text-sm py-2.5 px-4 inline-flex items-center justify-center gap-2 whitespace-nowrap"
                  >
                    <Check className="w-4 h-4" />
                    Ya están en tu carrito · Ir a pagar
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={() => filtered.forEach(item => addItem(item))}
                    className="btn-neon text-xs sm:text-sm py-2.5 px-4 inline-flex items-center justify-center gap-2 whitespace-nowrap"
                  >
                    <ShoppingCart className="w-4 h-4" />
                    Agregar {filtered.length === 1 ? 'mi foto' : `mis ${filtered.length} archivos`} al carrito
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Media grid */}
      <div className="max-w-7xl mx-auto px-4 pb-28">
        {filtered.length === 0 ? (
          <div className="text-center py-24 text-gray-400">
            <Search className="w-16 h-16 mx-auto mb-4 opacity-20" />
            <p className="font-medium text-lg">Sin resultados</p>
            <p className="text-sm mt-1">Probá con otro número de dorsal o cambiá los colores del filtro visual</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-x-4 gap-y-8">
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

      {/* Barra flotante inferior de Carrito y Descuento por Pack (Sticky Bottom Bar) */}
      {itemCount > 0 && !viewingMedia && (
        <div className="fixed bottom-4 left-4 right-4 z-40 max-w-3xl mx-auto pointer-events-none">
          <div className="pointer-events-auto bg-dark-800/95 backdrop-blur-md border-2 border-neon-green/60 rounded-2xl px-4 py-3 shadow-2xl flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-white font-black text-sm sm:text-base">
                  {itemCount} {itemCount === 1 ? 'ítem seleccionado' : 'ítems seleccionados'}
                </span>
                {packRule && (
                  <span className="badge-neon text-[11px]">{packRule.label} activo</span>
                )}
              </div>
              <p className="text-xs text-gray-300 truncate mt-0.5">
                {itemCount === 1 && '💡 Sumá 1 foto más y obtené 10% OFF en todo tu pack'}
                {itemCount >= 2 && itemCount < 5 && `💡 Sumá ${5 - itemCount} más para desbloquear 20% OFF`}
                {itemCount >= 5 && itemCount < 10 && `💡 Sumá ${10 - itemCount} más para desbloquear 30% OFF`}
                {itemCount >= 10 && '🔥 ¡Tenés el descuento máximo del 30% OFF aplicado!'}
              </p>
            </div>

            <div className="flex items-center gap-3 flex-shrink-0">
              <div className="text-right hidden xs:block">
                <span className="text-[10px] text-gray-400 uppercase block leading-none">Total</span>
                <span className="text-neon-green font-black text-base sm:text-lg">
                  ${(total || 0).toLocaleString('es-AR')}
                </span>
              </div>
              <Link
                to="/cart"
                className="btn-neon py-2.5 px-4 text-xs sm:text-sm inline-flex items-center gap-2 whitespace-nowrap"
              >
                <ShoppingCart className="w-4 h-4" />
                <span>Ver carrito (${(total || 0).toLocaleString('es-AR')})</span>
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Selfie search modal (solo se descarga y monta cuando el usuario hace clic) */}
      {selfieModalOpen && (
        <React.Suspense fallback={null}>
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
        </React.Suspense>
      )}

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
