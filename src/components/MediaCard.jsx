import React, { useState, useEffect, useRef } from 'react';
import { ShoppingCart, Play, Eye, Check, Trash2 } from 'lucide-react';
import { useCart } from '../context/CartContext';
import { getLowResSampleUrl } from '../services/cloudinary';
import { drawWatermarks } from './MagnifierViewer';

function formatPrice(n) {
  return `$${(n || 0).toLocaleString('es-AR')}`;
}

// Bloquea clic derecho y arrastrar en la miniatura
const blockMenu = (e) => e.preventDefault();
const blockDrag = (e) => e.preventDefault();

const CARD_MAX_DIM = 520; // Muestra en baja resolución para las tarjetas del catálogo

export default function MediaCard({ media, onView, onDelete }) {
  const { addItem, removeItem, items } = useCart();
  const [isPortrait, setIsPortrait]    = useState(false);
  const [loaded, setLoaded]            = useState(false);
  const canvasRef                      = useRef(null);

  const inCart    = items.some(i => i.id === media.id);
  const isVideo   = media.type === 'video';
  const itemPrice = Number(media.price) || (isVideo ? 3000 : 2000);

  const handleCart = (e) => {
    e.stopPropagation();
    if (inCart) removeItem(media.id);
    else addItem(media);
  };

  // Carga la miniatura en baja resolución en memoria y la dibuja en <canvas> con marca de agua Anti-IA
  useEffect(() => {
    let cancelled = false;
    setLoaded(false);

    const lowResSrc = getLowResSampleUrl(media.thumb || media.url, {
      width:   CARD_MAX_DIM,
      quality: 55,
    });

    if (!lowResSrc) return;

    const loadAndDraw = (useCors) => {
      const img = new window.Image();
      if (useCors) img.crossOrigin = 'anonymous';
      img.decoding = 'async';

      img.onload = () => {
        if (cancelled) return;
        const nw = img.naturalWidth  || 480;
        const nh = img.naturalHeight || 360;
        if (nh > nw * 1.08) setIsPortrait(true);

        const scale = Math.min(1, CARD_MAX_DIM / Math.max(nw, nh));
        const w = Math.max(1, Math.round(nw * scale));
        const h = Math.max(1, Math.round(nh * scale));

        const canvas = canvasRef.current;
        if (canvas) {
          canvas.width  = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.clearRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          drawWatermarks(ctx, w, h);
        }
        setLoaded(true);
      };

      img.onerror = () => {
        if (cancelled) return;
        if (useCors) loadAndDraw(false);
      };

      img.src = lowResSrc;
    };

    loadAndDraw(true);

    return () => {
      cancelled = true;
    };
  }, [media.id, media.thumb, media.url]);

  return (
    <div
      className="card-dark group hover:border-neon-green/40 hover:shadow-lg hover:shadow-neon-green/5 cursor-pointer select-none"
      style={{
        userSelect:         'none',
        WebkitUserSelect:   'none',
        WebkitTouchCallout: 'none',
      }}
      onContextMenu={blockMenu}
      onDragStart={blockDrag}
      onClick={() => onView && onView(media)}
    >
      {/* ── Thumbnail protegida en <canvas> (sin <img> expuesto) ──────── */}
      <div
        className="relative overflow-hidden h-52 bg-dark-900 select-none flex items-center justify-center"
        style={{
          userSelect:         'none',
          WebkitUserSelect:   'none',
          WebkitTouchCallout: 'none',
        }}
        onContextMenu={blockMenu}
      >
        {!loaded && (
          <div className="absolute inset-0 bg-dark-800 animate-pulse flex items-center justify-center">
            <span className="text-[11px] text-gray-500 font-medium">Cargando muestra…</span>
          </div>
        )}

        <canvas
          ref={canvasRef}
          onContextMenu={blockMenu}
          onDragStart={blockDrag}
          style={{
            userSelect:         'none',
            WebkitUserSelect:   'none',
            WebkitTouchCallout: 'none',
          }}
          className={`w-full h-full transition-transform duration-300 group-hover:scale-105 pointer-events-none select-none ${
            isPortrait ? 'object-contain bg-dark-900' : 'object-cover object-center'
          }`}
        />

        {/* Badge de video */}
        {isVideo && (
          <div className="absolute top-2 left-2 bg-neon-green/90 text-black rounded-full p-1 z-10">
            <Play className="w-3 h-3 fill-current" />
          </div>
        )}

        {/* Badge de duración */}
        {isVideo && media.duration && (
          <div className="absolute bottom-2 right-2 bg-black/80 text-white text-xs px-2 py-0.5 rounded z-10">
            {media.duration}
          </div>
        )}

        {/* Botón eliminar (solo visible cuando el admin está autenticado) */}
        {onDelete && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDelete(media); }}
            className="absolute top-2 right-2 z-30 bg-red-600/90 hover:bg-red-500 text-white p-1.5 rounded-lg shadow-lg transition-colors border border-red-400/40"
            title="Eliminar foto del álbum 🗑️"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}

        {/* Hover — botón ver */}
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 z-20">
          <button
            onClick={(e) => { e.stopPropagation(); onView && onView(media); }}
            className="bg-white/20 backdrop-blur-sm border border-white/30 text-white p-2 rounded-full hover:bg-white/30 transition-colors"
            title="Ver con Lupa 2×"
          >
            <Eye className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ── Info + Carrito ────────────────────────────────────────────── */}
      <div className="p-3 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-white text-sm font-semibold truncate">{media.fileName}</p>
          {media.dorsals && media.dorsals.length > 0 && (
            <p className="text-xs text-gray-400 mt-0.5 truncate">
              Dorsal: {media.dorsals.join(', ')}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-neon-green font-bold text-sm">{formatPrice(itemPrice)}</span>
          <button
            onClick={handleCart}
            className={`p-2 rounded-lg transition-all ${
              inCart
                ? 'bg-neon-green text-black'
                : 'bg-dark-500 text-gray-300 hover:bg-neon-green hover:text-black'
            }`}
            title={inCart ? 'Quitar del carrito' : 'Agregar al carrito'}
          >
            {inCart ? <Check className="w-4 h-4" /> : <ShoppingCart className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
