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

export default function MediaCard({
  media,
  onView,
  onDelete,
  onUpdatePrice,
  albumLogoUrl = '',
  albumLogoPublicId = '',
  albumBasePrice,
}) {
  const { addItem, removeItem, items } = useCart();
  const [isPortrait, setIsPortrait]    = useState(false);
  const [loaded, setLoaded]            = useState(false);
  const canvasRef                      = useRef(null);

  const inCart    = items.some(i => i.id === media.id);
  const isVideo   = media.type === 'video';
  const defaultAlbumPrice = Number(albumBasePrice) || (isVideo ? 3000 : 2000);
  const itemPrice = Number(media.price) || defaultAlbumPrice;
  const suggestedIndividualPrice = Math.round(defaultAlbumPrice * 1.5);
  const isIndividualFeatured = Boolean(media.isIndividual || itemPrice > defaultAlbumPrice);
  const [priceDraft, setPriceDraft]    = useState(itemPrice);
  const [priceSavedFlash, setPriceSavedFlash] = useState(false);
  const resolvedLogoUrl = media.eventLogoUrl || albumLogoUrl || '';
  const resolvedLogoPublicId = media.eventLogoPublicId || albumLogoPublicId || '';

  useEffect(() => {
    setPriceDraft(Number(media.price) || defaultAlbumPrice);
  }, [media.price, defaultAlbumPrice]);

  const handleSaveCustomPrice = (nextVal, isIndividualOverride) => {
    if (!onUpdatePrice) return;
    const num = Number(nextVal);
    if (!Number.isFinite(num) || num < 0) return;
    const isInd = typeof isIndividualOverride === 'boolean' ? isIndividualOverride : num > defaultAlbumPrice;
    onUpdatePrice(media, num, isInd);
    setPriceDraft(num);
    setPriceSavedFlash(true);
    setTimeout(() => setPriceSavedFlash(false), 1600);
  };

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
      width:             CARD_MAX_DIM,
      quality:           55,
      eventLogoPublicId: resolvedLogoPublicId,
      eventLogoUrl:      resolvedLogoUrl,
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
  }, [media.id, media.thumb, media.url, resolvedLogoPublicId, resolvedLogoUrl]);

  return (
    <div
      className={`card-dark group cursor-pointer select-none transition-all ${
        isIndividualFeatured
          ? 'border border-amber-400/50 hover:border-amber-400 hover:shadow-lg hover:shadow-amber-500/10'
          : 'hover:border-neon-green/40 hover:shadow-lg hover:shadow-neon-green/5'
      }`}
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

        {/* Insignia de Foto Individual / Toma Exclusiva */}
        {isIndividualFeatured && !isVideo && (
          <div className="absolute top-2 left-2 z-20 inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-dark-900/85 backdrop-blur-sm text-amber-200 font-medium text-[11px] tracking-wide shadow-md border border-amber-400/60">
            <span>⭐ Toma Individual</span>
          </div>
        )}

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
          <span
            className={
              isIndividualFeatured
                ? 'text-amber-200 bg-amber-500/15 border border-amber-400/50 px-2 py-0.5 rounded-md font-semibold text-sm shadow-sm'
                : 'text-neon-green font-bold text-sm'
            }
            title={isIndividualFeatured ? 'Toma exclusiva individual' : undefined}
          >
            {formatPrice(itemPrice)}
          </span>
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

      {/* ── Controles rápidos Admin: Precio individual y Toma Exclusiva (+50%) ── */}
      {onUpdatePrice && (
        <div
          className="px-3 pb-2.5 pt-2 border-t border-dark-600/80 bg-dark-900/60 flex flex-wrap items-center justify-between gap-1.5"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              const nextPrice = isIndividualFeatured ? defaultAlbumPrice : suggestedIndividualPrice;
              handleSaveCustomPrice(nextPrice, !isIndividualFeatured);
            }}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium border transition-all ${
              isIndividualFeatured
                ? 'bg-amber-500/20 text-amber-200 border-amber-400/60 shadow-sm'
                : 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border-amber-500/40'
            }`}
            title={
              isIndividualFeatured
                ? `Quitar recargo individual y volver a $${defaultAlbumPrice.toLocaleString('es-AR')}`
                : `Aplicar +50% Foto Individual ($${suggestedIndividualPrice.toLocaleString('es-AR')})`
            }
          >
            <span>{isIndividualFeatured ? '⭐ Individual activa' : '⭐ +50% Individual'}</span>
          </button>

          <div className="inline-flex items-center gap-1">
            <span className="text-[10px] text-gray-400 font-bold">$</span>
            <input
              type="number"
              min="0"
              step="100"
              value={priceDraft}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setPriceDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.stopPropagation();
                  handleSaveCustomPrice(priceDraft);
                }
              }}
              className="w-16 bg-dark-800 border border-cyan-500/50 focus:border-cyan-400 rounded-md px-1.5 py-0.5 text-[11px] text-white font-bold focus:outline-none"
              title="Editar precio individual de esta foto"
            />
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleSaveCustomPrice(priceDraft);
              }}
              className={`px-1.5 py-0.5 rounded-md text-[10px] font-black border transition-colors ${
                priceSavedFlash
                  ? 'bg-emerald-500 text-black border-emerald-400'
                  : 'bg-cyan-500/20 hover:bg-cyan-500 text-cyan-300 hover:text-black border-cyan-500/50'
              }`}
              title="Guardar precio personalizado"
            >
              {priceSavedFlash ? '✓' : 'OK'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
