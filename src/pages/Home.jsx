import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { collection, getDocs, query, orderBy, doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import AlbumCard from '../components/AlbumCard';
import {
  Camera, Zap, Shield, Download, X, Search, CheckCircle2, Clock,
  Sparkles, ScanFace, ShoppingBag, ArrowRight, Film, Image as ImageIcon,
  Loader2, AlertCircle, ExternalLink, Tag,
} from 'lucide-react';

const FEATURES = [
  {
    id:    'hd',
    icon:  Camera,
    title: 'Alta Definición',
    desc:  'Fotos y videos en máxima calidad profesional',
    badge: 'Specs 4K & RAW/JPG',
  },
  {
    id:    'anticaptura',
    icon:  Shield,
    title: 'Anticaptura',
    desc:  'Tecnología de lupa 2× y búsqueda con IA',
    badge: 'Demo interactiva',
  },
  {
    id:    'descarga',
    icon:  Zap,
    title: 'Descarga Inmediata',
    desc:  'Consultá tu pedido y descargá tus originales',
    badge: 'Mis pedidos',
  },
  {
    id:    'packs',
    icon:  Download,
    title: 'Packs con Descuento',
    desc:  'Ahorrá de 10% a 30% llevando 2 o más ítems',
    badge: 'Tabla de precios',
  },
];

function formatPrice(n) {
  return `$${(n || 0).toLocaleString('es-AR')}`;
}

function formatDate(ts) {
  if (!ts) return '-';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ─── Mini Demo Interactiva de Lupa 2x para el modal "Anticaptura" ─────────────
function MiniLoupeDemo() {
  const LOUPE_SIZE = 136;
  const LOUPE_R    = LOUPE_SIZE / 2;
  const ZOOM       = 2;
  const [pos, setPos] = useState({ x: 180, y: 110, w: 560, h: 240, active: false });
  const sampleImg = 'https://images.unsplash.com/photo-1551632811-561732d1e306?w=900&auto=format&fit=crop&q=80';

  const updatePos = (clientX, clientY, rect) => {
    if (!rect || !rect.width || !rect.height) return;
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, clientY - rect.top));
    setPos({ x, y, w: rect.width, h: rect.height, active: true });
  };

  return (
    <div
      className="relative rounded-xl overflow-hidden border border-dark-500 select-none h-52 sm:h-60 cursor-crosshair bg-dark-900"
      onMouseMove={(e) => updatePos(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect())}
      onMouseLeave={() => setPos(p => ({ ...p, active: false }))}
      onTouchMove={(e) => {
        const t = e.touches[0];
        if (t) updatePos(t.clientX, t.clientY, e.currentTarget.getBoundingClientRect());
      }}
      onTouchEnd={() => setPos(p => ({ ...p, active: false }))}
    >
      <img
        src={sampleImg}
        alt="Demo Lupa 2x"
        className="w-full h-full object-cover pointer-events-none"
        draggable={false}
      />

      {/* Marca de agua de muestra con espaciado amplio y limpio */}
      <div className="absolute inset-0 pointer-events-none select-none overflow-hidden">
        <div className="absolute inset-0 grid grid-cols-2 grid-rows-2 gap-10 p-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center justify-center">
              <span
                className="rotate-[-24deg] text-white/15 font-black text-[9px] sm:text-[10px] whitespace-nowrap"
                style={{ letterSpacing: '0.28em', wordSpacing: '0.5em' }}
              >
                CIANCIA PRODUCCIONES
              </span>
            </div>
          ))}
        </div>
        <div className="absolute inset-0 flex items-center justify-center">
          <span
            className="rotate-[-24deg] text-white/40 font-black text-base sm:text-xl whitespace-nowrap drop-shadow-[0_2px_6px_rgba(0,0,0,0.9)]"
            style={{ letterSpacing: '0.26em', wordSpacing: '0.45em' }}
          >
            CIANCIA PRODUCCIONES
          </span>
        </div>
      </div>

      {/* Lupa interactiva con Zoom In REAL de 2x (basado en dimensiones exactas del contenedor) */}
      {pos.active && (
        <div
          className="absolute rounded-full border-2 border-neon-green shadow-neon pointer-events-none overflow-hidden bg-dark-900"
          style={{
            width:  `${LOUPE_SIZE}px`,
            height: `${LOUPE_SIZE}px`,
            left:   `${pos.x - LOUPE_R}px`,
            top:    `${pos.y - LOUPE_R}px`,
          }}
        >
          {/* Capa interna escalada exactamente al doble (2x) del contenedor */}
          <div
            className="absolute pointer-events-none"
            style={{
              width:  `${pos.w * ZOOM}px`,
              height: `${pos.h * ZOOM}px`,
              left:   `${LOUPE_R - pos.x * ZOOM}px`,
              top:    `${LOUPE_R - pos.y * ZOOM}px`,
            }}
          >
            <img
              src={sampleImg}
              alt=""
              className="w-full h-full object-cover"
              draggable={false}
            />
            <div className="absolute inset-0 flex items-center justify-center">
              <span
                className="rotate-[-24deg] text-white/35 font-black text-3xl sm:text-4xl whitespace-nowrap drop-shadow-[0_2px_6px_rgba(0,0,0,0.9)]"
                style={{ letterSpacing: '0.26em', wordSpacing: '0.45em' }}
              >
                CIANCIA PRODUCCIONES
              </span>
            </div>
          </div>

          {/* Mira central */}
          <div className="relative z-10 w-full h-full flex items-center justify-center">
            <div className="w-3.5 h-3.5 border border-neon-green/80 rounded-full" />
          </div>
        </div>
      )}

      <div className="absolute bottom-2.5 left-1/2 -translate-x-1/2 bg-black/75 backdrop-blur-sm border border-neon-green/30 text-neon-green text-xs px-3 py-1 rounded-full pointer-events-none whitespace-nowrap">
        {pos.active ? '🔍 Zoom 2× activo' : '👆 Pasá el mouse o tu dedo por acá para probar la Lupa 2×'}
      </div>
    </div>
  );
}

export default function Home() {
  const [albums, setAlbums]           = useState([]);
  const [loading, setLoading]         = useState(true);
  const [filterCat, setFilterCat]     = useState('Todos');
  const [activeModal, setActiveModal] = useState(null); // 'hd' | 'anticaptura' | 'descarga' | 'packs' | 'como-funciona' | null

  // Estado del buscador de órdenes en "Descarga Inmediata"
  const [orderQuery, setOrderQuery]         = useState('');
  const [orderLoading, setOrderLoading]     = useState(false);
  const [orderResults, setOrderResults]     = useState(null); // null | Order[]
  const [orderError, setOrderError]         = useState('');
  const [downloadingId, setDownloadingId]   = useState(null);

  useEffect(() => {
    async function load() {
      try {
        const snap = await getDocs(query(collection(db, 'albums'), orderBy('date', 'desc')));
        setAlbums(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const closeModal = useCallback(() => {
    setActiveModal(null);
  }, []);

  // Bloqueo de scroll en body + cierre con tecla Escape cuando hay un modal abierto
  useEffect(() => {
    if (!activeModal) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKey = (e) => {
      if (e.key === 'Escape') closeModal();
    };
    document.addEventListener('keydown', handleKey);

    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', handleKey);
    };
  }, [activeModal, closeModal]);

  const scrollToAlbums = () => {
    closeModal();
    setTimeout(() => {
      const el = document.getElementById('albums');
      if (el) el.scrollIntoView({ behavior: 'smooth' });
    }, 80);
  };

  // ─── Buscar pedidos en Firestore por Email o ID de orden ──────────────────
  const runOrderLookup = useCallback(async (rawQuery) => {
    const q = String(rawQuery || '').trim();
    if (!q) return;

    setOrderLoading(true);
    setOrderError('');
    setOrderResults(null);

    try {
      const qLower = q.toLowerCase();
      const matched = [];

      // 1) Si no contiene '@' y parece un ID directo, intentamos buscar el documento por ID
      if (!q.includes('@') && q.length >= 6) {
        try {
          const directSnap = await getDoc(doc(db, 'orders', q));
          if (directSnap.exists()) {
            matched.push({ id: directSnap.id, ...directSnap.data() });
          }
        } catch {
          // continuar con búsqueda general
        }
      }

      // 2) Búsqueda por email del cliente o coincidencia parcial de ID
      if (matched.length === 0) {
        const snap = await getDocs(query(collection(db, 'orders'), orderBy('createdAt', 'desc')));
        snap.docs.forEach(d => {
          const data = d.data();
          const email = String(data.cliente?.email || data.clienteEmailLower || '').trim().toLowerCase();
          const idMatch = d.id.toLowerCase() === qLower || (qLower.length >= 6 && d.id.toLowerCase().includes(qLower));
          if (email === qLower || idMatch) {
            matched.push({ id: d.id, ...data });
          }
        });
      }

      setOrderResults(matched);
    } catch (err) {
      console.error(err);
      setOrderError('No se pudo consultar tu pedido en este momento. Verificá tu conexión.');
    } finally {
      setOrderLoading(false);
    }
  }, []);

  const handleSearchOrders = async (e) => {
    e.preventDefault();
    await runOrderLookup(orderQuery);
  };

  // Si el cliente entra desde un link directo de WhatsApp (?pedido=ID), abrimos el modal y buscamos su orden automáticamente
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const pedidoParam = params.get('pedido') || params.get('order');
      if (pedidoParam && pedidoParam.trim()) {
        const cleanId = pedidoParam.trim();
        setOrderQuery(cleanId);
        setActiveModal('descarga');
        runOrderLookup(cleanId);
      }
    } catch {
      // noop
    }
  }, [runOrderLookup]);

  // ─── Descarga limpia del archivo original HD sin marca de agua ─────────────
  const handleDownloadOriginal = async (orderId, item) => {
    const key = `${orderId}_${item.id}`;
    setDownloadingId(key);
    try {
      let targetUrl = item.url;

      // Fallback para órdenes antiguas que solo guardaron thumb: buscamos el doc original en 'media'
      if (!targetUrl && item.id) {
        try {
          const mediaSnap = await getDoc(doc(db, 'media', item.id));
          if (mediaSnap.exists()) {
            targetUrl = mediaSnap.data().url;
          }
        } catch {
          // fallback a thumb
        }
      }
      targetUrl = targetUrl || item.thumb;
      if (!targetUrl) throw new Error('URL no disponible');

      // Intentamos descargar como Blob para forzar la descarga directa con su nombre original
      try {
        const resp = await fetch(targetUrl);
        if (!resp.ok) throw new Error('Fetch status ' + resp.status);
        const blob = await resp.blob();
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = item.fileName || `ciancia-${item.id}.${item.type === 'video' ? 'mp4' : 'jpg'}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);
      } catch {
        // Fallback si el servidor externo bloquea CORS en fetch: abrir original en pestaña nueva
        window.open(targetUrl, '_blank', 'noopener,noreferrer');
      }
    } catch (err) {
      alert('No se pudo iniciar la descarga: ' + err.message);
    } finally {
      setDownloadingId(null);
    }
  };

  const categories = ['Todos', ...Array.from(new Set(albums.map(a => a.category)))];
  const filtered   = filterCat === 'Todos' ? albums : albums.filter(a => a.category === filterCat);

  return (
    <div className="min-h-screen">
      {/* Hero */}
      <section className="relative pt-32 pb-20 px-4 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-dark-900 via-dark-800 to-dark-900" />
        <div className="hidden md:block absolute top-20 left-1/4 w-96 h-96 bg-neon-green/5 rounded-full blur-3xl pointer-events-none" />
        <div className="hidden md:block absolute bottom-0 right-1/4 w-64 h-64 bg-neon-green/3 rounded-full blur-3xl pointer-events-none" />

        <div className="relative max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 bg-neon-green/10 border border-neon-green/30 rounded-full px-4 py-2 mb-6">
            <div className="w-2 h-2 bg-neon-green rounded-full animate-pulse" />
            <span className="text-neon-green text-sm font-medium">Fotografía deportiva profesional</span>
          </div>

          <h1 className="text-5xl sm:text-7xl font-black text-white mb-4 leading-none tracking-tight">
            CIANCIA
            <br />
            <span className="text-neon-green" style={{ textShadow: '0 0 40px rgba(57,255,20,0.5)' }}>
              PRODUCCIONES
            </span>
          </h1>

          <p className="text-gray-400 text-lg sm:text-xl mb-8 max-w-2xl mx-auto leading-relaxed">
            Fotos y videos de tus eventos deportivos y tomas de dron. Encontrá tu dorsal o buscate con una selfie,
            explorá con la lupa HD y comprá sin complicaciones.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <a href="#albums" className="btn-neon inline-flex items-center justify-center gap-2">
              <Camera className="w-5 h-5" />
              Ver Álbumes
            </a>
            <button
              type="button"
              onClick={() => setActiveModal('como-funciona')}
              className="btn-outline-neon inline-flex items-center justify-center gap-2"
            >
              <Zap className="w-5 h-5" />
              ¿Cómo funciona?
            </button>
          </div>
        </div>
      </section>

      {/* Features (4 tarjetas interactivas) */}
      <section id="como-funciona" className="py-14 px-4 border-t border-dark-700">
        <div className="max-w-6xl mx-auto grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-5">
          {FEATURES.map(({ id, icon: Icon, title, desc, badge }) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveModal(id)}
              className="group text-center p-5 rounded-2xl bg-dark-800/80 border border-dark-600 hover:border-neon-green hover:shadow-neon-sm hover:-translate-y-1.5 transition-all duration-300 cursor-pointer flex flex-col items-center focus:outline-none focus:border-neon-green"
            >
              <span className="text-[10px] uppercase tracking-wider font-bold text-neon-green/80 bg-neon-green/10 border border-neon-green/20 px-2.5 py-0.5 rounded-full mb-3">
                {badge}
              </span>
              <div className="w-12 h-12 bg-neon-green/10 border border-neon-green/30 group-hover:bg-neon-green group-hover:text-black rounded-xl flex items-center justify-center mx-auto mb-3 transition-colors duration-300">
                <Icon className="w-6 h-6 text-neon-green group-hover:text-black transition-colors duration-300" />
              </div>
              <h3 className="font-bold text-white text-base mb-1 group-hover:text-neon-green transition-colors">
                {title}
              </h3>
              <p className="text-gray-400 text-xs leading-relaxed flex-1">{desc}</p>
              <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-neon-green opacity-80 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all">
                Abrir detalle <ArrowRight className="w-3.5 h-3.5" />
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* Albums section */}
      <section id="albums" className="py-12 px-4">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-3xl font-black text-white">
              ÁLBUMES <span className="text-neon-green">DE EVENTOS</span>
            </h2>
          </div>

          {/* Category filter */}
          <div className="flex gap-2 flex-wrap mb-8">
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setFilterCat(cat)}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                  filterCat === cat
                    ? 'bg-neon-green text-black shadow-neon-sm'
                    : 'bg-dark-700 text-gray-400 hover:text-white border border-dark-500'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="card-dark animate-pulse">
                  <div className="h-52 bg-dark-600" />
                  <div className="p-4 space-y-2">
                    <div className="h-4 bg-dark-600 rounded w-3/4" />
                    <div className="h-3 bg-dark-600 rounded w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-24 text-gray-400">
              <Camera className="w-16 h-16 mx-auto mb-4 opacity-20" />
              <p className="text-lg font-medium">No hay álbumes disponibles</p>
              <p className="text-sm mt-1">
                Visitá el <Link to="/admin" className="text-neon-green hover:underline">panel de admin</Link> para cargar datos de prueba.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {filtered.map(album => (
                <AlbumCard key={album.id} album={album} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ── MODALES INTERACTIVOS DE PORTADA ────────────────────────────────── */}
      {activeModal && (
        <div
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
          onClick={closeModal}
        >
          <div
            className="relative w-full max-w-2xl bg-dark-800 border border-neon-green/30 rounded-2xl shadow-2xl overflow-hidden my-8"
            onClick={e => e.stopPropagation()}
          >
            {/* Botón cerrar común */}
            <button
              type="button"
              onClick={closeModal}
              className="absolute top-4 right-4 p-2 rounded-lg text-gray-400 hover:text-white hover:bg-dark-600 transition-colors z-10"
              aria-label="Cerrar modal"
            >
              <X className="w-5 h-5" />
            </button>

            {/* ── 1. MODAL: ALTA DEFINICIÓN ───────────────────────────────── */}
            {activeModal === 'hd' && (
              <div className="p-6 sm:p-8 space-y-6">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-neon-green/15 border border-neon-green/40 flex items-center justify-center">
                    <Camera className="w-6 h-6 text-neon-green" />
                  </div>
                  <div>
                    <span className="text-xs font-bold uppercase tracking-wider text-neon-green">Calidad de Entrega</span>
                    <h2 className="text-2xl font-black text-white">Especificaciones en Alta Definición</h2>
                  </div>
                </div>

                <p className="text-gray-300 text-sm leading-relaxed">
                  Todas las entregas se realizan en su resolución nativa sin compresión destructiva ni marcas de agua, listas tanto para compartir en redes sociales como para impresiones de gran formato.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="bg-dark-700 border border-dark-500 rounded-xl p-4 space-y-2">
                    <div className="flex items-center gap-2 text-neon-green font-bold text-sm">
                      <ImageIcon className="w-4 h-4" /> Fotografía Deportiva Pro
                    </div>
                    <ul className="text-xs text-gray-300 space-y-1.5">
                      <li>• <strong>Resolución Original:</strong> 24 MP+ (hasta 6000 × 4000 px)</li>
                      <li>• <strong>Orientación Nativa:</strong> Formato vertical (9:16 / 3:4) u horizontal sin recortes forzados</li>
                      <li>• <strong>Colorimetría:</strong> Perfil sRGB calibrado y revelado profesional</li>
                      <li>• <strong>Entrega:</strong> Archivo JPG en máxima calidad (100% limpia)</li>
                    </ul>
                  </div>

                  <div className="bg-dark-700 border border-dark-500 rounded-xl p-4 space-y-2">
                    <div className="flex items-center gap-2 text-neon-green font-bold text-sm">
                      <Film className="w-4 h-4" /> Tomas de Dron & Video
                    </div>
                    <ul className="text-xs text-gray-300 space-y-1.5">
                      <li>• <strong>Resolución de Video:</strong> Full HD (1080p a 60/120fps) y 4K UHD</li>
                      <li>• <strong>Estabilización:</strong> Gimbal electrónico de 3 ejes / FPV</li>
                      <li>• <strong>Formato:</strong> MP4 (H.264 / HEVC) de alto bitrate</li>
                      <li>• <strong>Descarga:</strong> Streaming y descarga directa desde CDN</li>
                    </ul>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-3 pt-2">
                  <button type="button" onClick={scrollToAlbums} className="btn-neon flex-1 flex items-center justify-center gap-2">
                    <Camera className="w-4 h-4" /> Explorar Álbumes
                  </button>
                  <button type="button" onClick={closeModal} className="btn-outline-neon">
                    Cerrar
                  </button>
                </div>
              </div>
            )}

            {/* ── 2. MODAL: ANTICAPTURA & IA ──────────────────────────────── */}
            {activeModal === 'anticaptura' && (
              <div className="p-6 sm:p-8 space-y-5">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-neon-green/15 border border-neon-green/40 flex items-center justify-center">
                    <Shield className="w-6 h-6 text-neon-green" />
                  </div>
                  <div>
                    <span className="text-xs font-bold uppercase tracking-wider text-neon-green">Protección + Inteligencia Artificial</span>
                    <h2 className="text-2xl font-black text-white">Visor Lupa 2× & Búsqueda con IA</h2>
                  </div>
                </div>

                {/* Mini Demo interactiva */}
                <MiniLoupeDemo />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="bg-dark-700 border border-dark-500 rounded-xl p-4">
                    <div className="flex items-center gap-2 text-neon-green font-bold text-sm mb-1.5">
                      <Sparkles className="w-4 h-4" /> 1. Buscador por Dorsal (OCR)
                    </div>
                    <p className="text-xs text-gray-300 leading-relaxed">
                      Al subir las fotos del evento, nuestra IA lee los números de pechera automáticamente. Solo escribí tu número de dorsal dentro del álbum para filtrar tus fotos al instante.
                    </p>
                  </div>

                  <div className="bg-dark-700 border border-dark-500 rounded-xl p-4">
                    <div className="flex items-center gap-2 text-neon-green font-bold text-sm mb-1.5">
                      <ScanFace className="w-4 h-4" /> 2. Buscate con una Selfie 🤳
                    </div>
                    <p className="text-xs text-gray-300 leading-relaxed">
                      ¿Tu dorsal salió tapado por el barro o la bici? Tocá <strong>&ldquo;Buscarme con Selfie&rdquo;</strong> dentro de cualquier álbum y el reconocimiento facial encontrará todas las fotos donde aparecés.
                    </p>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-3 pt-1">
                  <button type="button" onClick={scrollToAlbums} className="btn-neon flex-1 flex items-center justify-center gap-2">
                    Probar en los Álbumes
                  </button>
                  <button type="button" onClick={closeModal} className="btn-outline-neon">
                    Cerrar
                  </button>
                </div>
              </div>
            )}

            {/* ── 3. MODAL: DESCARGA INMEDIATA (CONSULTAR PEDIDO FIRESTORE) ─ */}
            {activeModal === 'descarga' && (
              <div className="p-6 sm:p-8 space-y-5">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-neon-green/15 border border-neon-green/40 flex items-center justify-center">
                    <Zap className="w-6 h-6 text-neon-green" />
                  </div>
                  <div>
                    <span className="text-xs font-bold uppercase tracking-wider text-neon-green">Portal de Clientes</span>
                    <h2 className="text-2xl font-black text-white">Consultar mi Pedido / Descargar</h2>
                  </div>
                </div>

                <p className="text-gray-300 text-sm">
                  Ingresá el <strong>email</strong> con el que realizaste la compra o tu <strong>código de pedido</strong> para verificar el estado de tu pago y descargar tus fotos y videos originales sin marca de agua.
                </p>

                <form onSubmit={handleSearchOrders} className="flex flex-col sm:flex-row gap-2">
                  <div className="relative flex-1">
                    <Search className="w-4 h-4 text-gray-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={orderQuery}
                      onChange={e => setOrderQuery(e.target.value)}
                      placeholder="tu@email.com o código de pedido..."
                      className="input-dark pl-10"
                      autoComplete="off"
                      autoCorrect="off"
                      spellCheck="false"
                      data-lpignore="true"
                      data-form-type="other"
                      required
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={orderLoading}
                    className="btn-neon flex items-center justify-center gap-2 whitespace-nowrap"
                  >
                    {orderLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                    Buscar pedido
                  </button>
                </form>

                {orderError && (
                  <div className="flex items-center gap-2 text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-sm">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    <span>{orderError}</span>
                  </div>
                )}

                {orderResults !== null && (
                  <div className="space-y-4 max-h-96 overflow-y-auto pr-1">
                    {orderResults.length === 0 ? (
                      <div className="bg-dark-700 border border-dark-500 rounded-xl p-6 text-center text-gray-400 text-sm">
                        No encontramos pedidos asociados a <strong className="text-white">&ldquo;{orderQuery}&rdquo;</strong>.
                        Verificá que el email o el código estén bien escritos.
                      </div>
                    ) : (
                      orderResults.map(order => {
                        const isApproved = order.status === 'approved' || order.downloadEnabled === true;
                        return (
                          <div key={order.id} className="bg-dark-700 border border-dark-500 rounded-xl p-4 space-y-3">
                            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-dark-500 pb-3">
                              <div>
                                <p className="text-xs text-gray-400">
                                  Pedido <span className="font-mono text-gray-300">#{order.id.slice(0, 8)}</span> · {formatDate(order.createdAt)}
                                </p>
                                <p className="text-white font-bold text-sm">
                                  {order.cliente?.nombre} ({order.cliente?.email})
                                </p>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-neon-green font-black text-sm">{formatPrice(order.total)}</span>
                                {isApproved ? (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-green-500/20 text-green-400 border border-green-500/30">
                                    <CheckCircle2 className="w-3.5 h-3.5" /> Aprobado · Listo
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-yellow-500/20 text-yellow-300 border border-yellow-500/30">
                                    <Clock className="w-3.5 h-3.5" /> Pendiente de aprobación
                                  </span>
                                )}
                              </div>
                            </div>

                            {!isApproved ? (
                              <p className="text-xs text-yellow-300/90 bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-2.5">
                                Estamos verificando tu comprobante de pago. Apenas sea aprobado por administración, vas a poder descargar todos los archivos originales desde acá mismo.
                              </p>
                            ) : (
                              <div className="space-y-2">
                                <p className="text-xs text-neon-green font-semibold">
                                  ¡Pago verificado! Descargá tus archivos en calidad original sin marca de agua:
                                </p>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                  {(order.items || []).map(item => {
                                    const dlKey = `${order.id}_${item.id}`;
                                    const isDownloading = downloadingId === dlKey;
                                    return (
                                      <div
                                        key={item.id}
                                        className="flex items-center gap-2.5 bg-dark-800 border border-dark-500 rounded-lg p-2"
                                      >
                                        <img
                                          src={item.thumb || item.url}
                                          alt={item.fileName}
                                          className="w-12 h-10 object-cover rounded flex-shrink-0"
                                        />
                                        <div className="flex-1 min-w-0">
                                          <p className="text-xs text-white font-medium truncate">{item.fileName}</p>
                                          <p className="text-[10px] text-gray-400 uppercase">{item.type === 'video' ? 'Video HD' : 'Foto HD'}</p>
                                        </div>
                                        <button
                                          type="button"
                                          onClick={() => handleDownloadOriginal(order.id, item)}
                                          disabled={isDownloading}
                                          className="px-2.5 py-1.5 rounded-lg bg-neon-green text-black font-bold text-xs hover:bg-neon-green/90 transition-colors flex items-center gap-1 flex-shrink-0"
                                          title="Descargar archivo original sin marca de agua"
                                        >
                                          {isDownloading ? (
                                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                          ) : (
                                            <Download className="w-3.5 h-3.5" />
                                          )}
                                          HD
                                        </button>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ── 4. MODAL: PACKS CON DESCUENTO ───────────────────────────── */}
            {activeModal === 'packs' && (
              <div className="p-6 sm:p-8 space-y-5">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-neon-green/15 border border-neon-green/40 flex items-center justify-center">
                    <Download className="w-6 h-6 text-neon-green" />
                  </div>
                  <div>
                    <span className="text-xs font-bold uppercase tracking-wider text-neon-green">Ahorro Automático</span>
                    <h2 className="text-2xl font-black text-white">Tabla de Packs y Descuentos</h2>
                  </div>
                </div>

                <p className="text-gray-300 text-sm">
                  No necesitás activar nada: a medida que agregás fotos o videos al carrito (incluso de distintos álbumes), el sistema aplica el descuento escalonado en tiempo real.
                </p>

                {/* Precios unitarios base */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-dark-700 border border-dark-500 rounded-xl p-3.5 flex items-center justify-between">
                    <span className="text-xs text-gray-300 flex items-center gap-1.5">
                      <Camera className="w-4 h-4 text-neon-green" /> Foto Individual HD
                    </span>
                    <span className="text-white font-black text-base">$2.000</span>
                  </div>
                  <div className="bg-dark-700 border border-dark-500 rounded-xl p-3.5 flex items-center justify-between">
                    <span className="text-xs text-gray-300 flex items-center gap-1.5">
                      <Film className="w-4 h-4 text-neon-green" /> Video / Toma Dron
                    </span>
                    <span className="text-white font-black text-base">$3.000</span>
                  </div>
                </div>

                {/* Tabla de escalones */}
                <div className="overflow-hidden rounded-xl border border-dark-500">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-dark-700 text-gray-400 text-xs uppercase">
                      <tr>
                        <th className="py-3 px-4">Cantidad</th>
                        <th className="py-3 px-4">Pack</th>
                        <th className="py-3 px-4">Descuento</th>
                        <th className="py-3 px-4 text-right">Ej. en Fotos</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-dark-600 bg-dark-800">
                      <tr>
                        <td className="py-3 px-4 text-gray-300">1 archivo</td>
                        <td className="py-3 px-4 text-gray-400">Individual</td>
                        <td className="py-3 px-4 text-gray-400">—</td>
                        <td className="py-3 px-4 text-right font-semibold text-white">$2.000</td>
                      </tr>
                      <tr className="bg-neon-green/5">
                        <td className="py-3 px-4 text-white font-medium">2 archivos</td>
                        <td className="py-3 px-4 text-neon-green font-semibold">Pack 2</td>
                        <td className="py-3 px-4">
                          <span className="badge-neon">10% OFF</span>
                        </td>
                        <td className="py-3 px-4 text-right font-bold text-neon-green">
                          <span className="text-gray-500 line-through text-xs mr-1.5">$4.000</span>$3.600
                        </td>
                      </tr>
                      <tr className="bg-neon-green/10">
                        <td className="py-3 px-4 text-white font-medium">3 a 4 archivos</td>
                        <td className="py-3 px-4 text-neon-green font-semibold">Pack 3+</td>
                        <td className="py-3 px-4">
                          <span className="badge-neon">20% OFF</span>
                        </td>
                        <td className="py-3 px-4 text-right font-bold text-neon-green">
                          <span className="text-gray-500 line-through text-xs mr-1.5">$6.000</span>$4.800
                        </td>
                      </tr>
                      <tr className="bg-neon-green/15">
                        <td className="py-3 px-4 text-white font-bold">5 o más archivos</td>
                        <td className="py-3 px-4 text-neon-green font-black">Pack 5+ 🔥</td>
                        <td className="py-3 px-4">
                          <span className="bg-neon-green text-black font-black text-xs px-2.5 py-0.5 rounded-full">
                            30% OFF
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right font-black text-neon-green">
                          <span className="text-gray-500 line-through text-xs mr-1.5">$10.000</span>$7.000
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div className="flex items-center gap-2 text-xs text-gray-400 bg-dark-700 border border-dark-500 rounded-lg p-3">
                  <Tag className="w-4 h-4 text-neon-green flex-shrink-0" />
                  <span>
                    Además, en el carrito podés sumar cupones promocionales de evento (como <code className="text-neon-green font-bold">CIANCIA10</code> o <code className="text-neon-green font-bold">DEPORTE20</code>) sobre el total con Pack.
                  </span>
                </div>

                <div className="flex flex-col sm:flex-row gap-3 pt-1">
                  <button type="button" onClick={scrollToAlbums} className="btn-neon flex-1 flex items-center justify-center gap-2">
                    <ShoppingBag className="w-4 h-4" /> Armar mi Pack ahora
                  </button>
                  <button type="button" onClick={closeModal} className="btn-outline-neon">
                    Cerrar
                  </button>
                </div>
              </div>
            )}

            {/* ── 5. MODAL: ¿CÓMO FUNCIONA? (GUÍA EN 3 PASOS) ─────────────── */}
            {activeModal === 'como-funciona' && (
              <div className="p-6 sm:p-8 space-y-6">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-neon-green/15 border border-neon-green/40 flex items-center justify-center">
                    <Zap className="w-6 h-6 text-neon-green" />
                  </div>
                  <div>
                    <span className="text-xs font-bold uppercase tracking-wider text-neon-green">Guía Rápida</span>
                    <h2 className="text-2xl font-black text-white">¿Cómo funciona Ciancia Producciones?</h2>
                  </div>
                </div>

                <div className="space-y-4">
                  {[
                    {
                      step: '1',
                      icon: ScanFace,
                      title: 'Buscate por Dorsal o Selfie con IA',
                      desc: 'Entrá al álbum de tu carrera o torneo. Escribí tu número de pechera o tocá el botón "Buscarme con Selfie 🤳" para que la inteligencia artificial filtre todas tus fotos en segundos.',
                    },
                    {
                      step: '2',
                      icon: ShoppingBag,
                      title: 'Revisá con la Lupa 2× y armá tu Pack',
                      desc: 'Abrí cada foto para inspeccionar la nitidez con la Lupa 2×. Agregá tus favoritas al carrito: llevando 2 tenés 10% OFF, llevando 3+ tenés 20% OFF y con 5 o más un 30% OFF automático.',
                    },
                    {
                      step: '3',
                      icon: Download,
                      title: 'Pagá y descargá en Calidad Original',
                      desc: 'Aboná por Transferencia Bancaria (adjuntando tu comprobante) o Mercado Pago. Una vez aprobado, descargá tus archivos limpios en máxima resolución desde "Descarga Inmediata".',
                    },
                  ].map(({ step, icon: StepIcon, title, desc }) => (
                    <div key={step} className="flex gap-4 items-start bg-dark-700 border border-dark-500 rounded-xl p-4">
                      <div className="w-10 h-10 rounded-xl bg-neon-green text-black font-black text-lg flex items-center justify-center flex-shrink-0 shadow-neon-sm">
                        {step}
                      </div>
                      <div className="space-y-1">
                        <h3 className="text-white font-bold text-base flex items-center gap-2">
                          <StepIcon className="w-4 h-4 text-neon-green" /> {title}
                        </h3>
                        <p className="text-gray-300 text-xs sm:text-sm leading-relaxed">{desc}</p>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex flex-col sm:flex-row gap-3 pt-1">
                  <button type="button" onClick={scrollToAlbums} className="btn-neon flex-1 flex items-center justify-center gap-2">
                    <Camera className="w-4 h-4" /> Ir a los Álbumes
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveModal('descarga')}
                    className="btn-outline-neon flex items-center justify-center gap-2"
                  >
                    <ExternalLink className="w-4 h-4" /> Ya compré · Consultar pedido
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Footer discreto con acceso privado para administración */}
      <footer className="border-t border-dark-700 py-8 px-4 mt-12">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-gray-500">
          <p>© {new Date().getFullYear()} Ciancia Producciones · Fotografía deportiva profesional</p>
          <Link
            to="/admin"
            className="text-gray-600 hover:text-gray-400 transition-colors"
            title="Acceso exclusivo administración"
          >
            Acceso Admin
          </Link>
        </div>
      </footer>
    </div>
  );
}
