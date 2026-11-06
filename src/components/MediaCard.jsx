import React, { useState } from 'react';
import { ShoppingCart, Play, Eye, Check, Trash2 } from 'lucide-react';
import { useCart } from '../context/CartContext';

function formatPrice(n) {
  return `$${(n || 0).toLocaleString('es-AR')}`;
}

// Bloquea clic derecho y arrastrar en la miniatura
const blockMenu = (e) => e.preventDefault();
const blockDrag = (e) => e.preventDefault();

export default function MediaCard({ media, onView, onDelete }) {
  const { addItem, removeItem, items } = useCart();
  const [isPortrait, setIsPortrait]    = useState(false);
  const inCart  = items.some(i => i.id === media.id);
  const isVideo = media.type === 'video';
  const itemPrice = Number(media.price) || (isVideo ? 3000 : 2000);

  const handleCart = (e) => {
    e.stopPropagation();
    if (inCart) removeItem(media.id);
    else addItem(media);
  };

  const handleImgLoad = (e) => {
    const img = e.currentTarget;
    if (img.naturalHeight > img.naturalWidth * 1.08) {
      setIsPortrait(true);
    }
  };

  return (
    <div
      className="card-dark group hover:border-neon-green/40 hover:shadow-lg hover:shadow-neon-green/5 cursor-pointer"
      onClick={() => onView && onView(media)}
    >
      {/* ── Thumbnail ─────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden h-52 bg-dark-900 select-none flex items-center justify-center">

        {/* Imagen nítida: si es vertical se muestra completa sin estirar ni mutilar */}
        <img
          src={media.thumb || media.url}
          alt={media.fileName}
          onLoad={handleImgLoad}
          className={`w-full h-full transition-transform duration-300 group-hover:scale-105 pointer-events-none ${
            isPortrait ? 'object-contain bg-dark-900' : 'object-cover object-center'
          }`}
          loading="lazy"
          onContextMenu={blockMenu}
          onDragStart={blockDrag}
          draggable="false"
        />

        {/* ── Capa de marcas de agua (sin fondo oscuro) ─────────────── */}
        <div className="absolute inset-0 pointer-events-none select-none overflow-hidden">

          {/* Patrón repetido sutil — grid 3×3 */}
          <div className="absolute inset-0 grid grid-cols-3 grid-rows-3">
            {Array.from({ length: 9 }).map((_, i) => (
              <div key={i} className="flex items-center justify-center">
                <span className="text-white/15 font-black text-[8px] tracking-widest rotate-[-30deg] whitespace-nowrap leading-none">
                  CIANCIA PROD.
                </span>
              </div>
            ))}
          </div>

          {/* Marca central prominente sutil diagonal */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="rotate-[-30deg] text-center">
              <p
                className="font-black text-[11px] tracking-widest whitespace-nowrap"
                style={{
                  color: 'rgba(255,255,255,0.28)',
                  textShadow: '0 1px 3px rgba(0,0,0,0.6), 0 0 6px rgba(0,0,0,0.4)',
                  letterSpacing: '0.18em',
                }}
              >
                CIANCIA PRODUCCIONES
              </p>
            </div>
          </div>
        </div>
        {/* ─────────────────────────────────────────────────────────────── */}

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
