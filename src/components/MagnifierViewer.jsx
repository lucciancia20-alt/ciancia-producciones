import React, { useEffect, useRef, useCallback, useState } from 'react';
import { X, ShoppingCart, Play, Pause, Volume2, VolumeX } from 'lucide-react';
import { useCart } from '../context/CartContext';

const LUPE_RADIUS    = 125;
const ZOOM_FACTOR    = 2;
const WATERMARK_TEXT = 'CIANCIA   PRODUCCIONES';

function formatPrice(n) {
  return `$${(n || 0).toLocaleString('es-AR')}`;
}

// ─── Dibuja todas las marcas de agua sobre el ctx actual ─────────────────────
// Adapta el tamaño tipográfico a la dimensión menor (Math.min(W, H)) con
// letter-spacing y separación amplia entre repeticiones para que nunca colisionen.
function drawWatermarks(ctx, W, H) {
  const minDim = Math.min(W, H);

  // ── 1) Patrón repetido sutil con amplia separación ────────────────────────
  const smallSize = Math.max(11, Math.round(minDim / 44));
  ctx.save();
  ctx.globalAlpha  = 0.15;
  ctx.fillStyle    = 'white';
  ctx.font         = `900 ${smallSize}px "Inter", "Arial Black", sans-serif`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  if ('letterSpacing' in ctx) {
    ctx.letterSpacing = `${Math.max(2, Math.round(smallSize * 0.24))}px`;
  }

  const measured = ctx.measureText(WATERMARK_TEXT).width;
  const stepX    = Math.round(measured * 1.65 + 110);
  const stepY    = Math.round(Math.max(smallSize * 8.5, measured * 0.62));

  for (let row = -2; row < H / stepY + 3; row++) {
    for (let col = -1; col < W / stepX + 2; col++) {
      const offsetX = (row % 2 === 0) ? 0 : stepX / 2;
      ctx.save();
      ctx.translate(col * stepX + offsetX, row * stepY);
      ctx.rotate(-Math.PI / 6);
      ctx.fillText(WATERMARK_TEXT, 0, 0);
      ctx.restore();
    }
  }
  ctx.restore();

  // ── 2) Marca central prominente sutil con letter-spacing amplio ───────────
  const bigSize = Math.max(20, Math.round(minDim / 14));
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.rotate(-Math.PI / 6);
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.font         = `900 ${bigSize}px "Inter", "Arial Black", sans-serif`;
  if ('letterSpacing' in ctx) {
    ctx.letterSpacing = `${Math.max(4, Math.round(bigSize * 0.22))}px`;
  }

  ctx.shadowColor   = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur    = 6;
  ctx.shadowOffsetX = 1;
  ctx.shadowOffsetY = 1;

  ctx.globalAlpha = 0.28;
  ctx.fillStyle   = 'white';
  ctx.fillText(WATERMARK_TEXT, 0, 0);

  // Segunda línea más pequeña con buen aire vertical
  const subSize = Math.round(bigSize * 0.48);
  ctx.globalAlpha = 0.16;
  ctx.font        = `900 ${subSize}px "Inter", "Arial Black", sans-serif`;
  if ('letterSpacing' in ctx) {
    ctx.letterSpacing = `${Math.max(3, Math.round(subSize * 0.25))}px`;
  }
  ctx.fillText(WATERMARK_TEXT, 0, bigSize * 1.85);

  ctx.restore();
}

// ─── Visor de fotos con lupa y proporción nativa ──────────────────────────────
function PhotoMagnifier({ media, onClose }) {
  const canvasRef = useRef(null);
  const imgRef    = useRef(null);
  const animRef   = useRef(null);
  const mousePos  = useRef({ x: -9999, y: -9999 });

  const [imgLoaded, setImgLoaded]   = useState(false);
  // Dimensiones internas del canvas calculadas según naturalWidth/naturalHeight reales
  const [canvasDims, setCanvasDims] = useState({ w: 1200, h: 800 });

  const { addItem, removeItem, items } = useCart();
  const inCart = items.some(i => i.id === media.id);
  const itemPrice = Number(media.price) || (media.type === 'video' ? 3000 : 2000);

  // Al cargar la imagen, calculamos ancho y alto reales manteniendo la proporción exacta
  const handleImageLoad = () => {
    const img = imgRef.current;
    if (img && img.naturalWidth > 0 && img.naturalHeight > 0) {
      const MAX_SIDE = 1400;
      const scale    = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
      const w        = Math.max(1, Math.round(img.naturalWidth * scale));
      const h        = Math.max(1, Math.round(img.naturalHeight * scale));
      setCanvasDims({ w, h });
    }
    setImgLoaded(true);
  };

  // ── Loop de dibujo ────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const img    = imgRef.current;
    if (!canvas || !img || !img.complete || img.naturalWidth === 0) {
      animRef.current = requestAnimationFrame(draw);
      return;
    }

    const ctx = canvas.getContext('2d');
    const W   = canvas.width;
    const H   = canvas.height;
    const { x: mx, y: my } = mousePos.current;

    ctx.clearRect(0, 0, W, H);

    // 1) Foto completa nítida con su proporción nativa exacta
    ctx.drawImage(img, 0, 0, W, H);

    // 2) Marcas de agua sobre toda la foto
    drawWatermarks(ctx, W, H);

    // 3) Lupa 2x real (sólo cuando el cursor está dentro del canvas)
    const inBounds = mx >= 0 && my >= 0 && mx <= W && my <= H;
    if (inBounds) {
      const r = Math.min(LUPE_RADIUS, Math.round(Math.min(W, H) * 0.28));

      ctx.save();
      ctx.beginPath();
      ctx.arc(mx, my, r, 0, Math.PI * 2);
      ctx.clip();

      // Fondo oscuro por si la lupa se acerca al borde exterior de la imagen
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(mx - r, my - r, r * 2, r * 2);

      // Transformación afín exacta: amplía 2x el punto (mx, my) bajo el cursor
      ctx.translate(mx, my);
      ctx.scale(ZOOM_FACTOR, ZOOM_FACTOR);
      ctx.translate(-mx, -my);

      ctx.drawImage(img, 0, 0, W, H);
      drawWatermarks(ctx, W, H);

      ctx.restore();

      // Borde del círculo (neon green)
      ctx.save();
      ctx.beginPath();
      ctx.arc(mx, my, r, 0, Math.PI * 2);
      ctx.strokeStyle = '#39FF14';
      ctx.lineWidth   = 2.5;
      ctx.shadowColor = '#39FF14';
      ctx.shadowBlur  = 14;
      ctx.stroke();
      ctx.restore();

      // Cruz de mira
      ctx.save();
      ctx.strokeStyle = 'rgba(57,255,20,0.75)';
      ctx.lineWidth   = 1;
      ctx.beginPath();
      ctx.moveTo(mx - 12, my); ctx.lineTo(mx + 12, my);
      ctx.moveTo(mx, my - 12); ctx.lineTo(mx, my + 12);
      ctx.stroke();
      ctx.restore();
    }

    animRef.current = requestAnimationFrame(draw);
  }, []);

  useEffect(() => {
    if (imgLoaded) animRef.current = requestAnimationFrame(draw);
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [imgLoaded, canvasDims, draw]);

  // ── Bloqueo de atajos de teclado mientras el visor está abierto ───────────
  useEffect(() => {
    const block = (e) => {
      const badKeys = ['s', 'S', 'p', 'P', 'c', 'C', 'u', 'U'];
      if ((e.ctrlKey || e.metaKey) && badKeys.includes(e.key)) e.preventDefault();
      if (e.key === 'PrintScreen') e.preventDefault();
    };
    document.addEventListener('keydown', block);
    return () => document.removeEventListener('keydown', block);
  }, []);

  // ── Posición del mouse / táctil en coordenadas reales del canvas ──────────
  const getCanvasPos = (clientX, clientY) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: -9999, y: -9999 };
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return { x: -9999, y: -9999 };
    return {
      x: (clientX - rect.left) * (canvas.width  / rect.width),
      y: (clientY - rect.top)  * (canvas.height / rect.height),
    };
  };

  const handleMouseMove  = (e) => { mousePos.current = getCanvasPos(e.clientX, e.clientY); };
  const handleMouseLeave = ()  => { mousePos.current = { x: -9999, y: -9999 }; };
  const handleTouchMove  = (e) => {
    e.preventDefault();
    const t = e.touches[0];
    // En pantallas táctiles desplazamos 55px hacia arriba para que el dedo no tape el centro de la lupa
    if (t) mousePos.current = getCanvasPos(t.clientX, t.clientY - 55);
  };
  const blockMenu = (e) => e.preventDefault();

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/95 flex flex-col items-center justify-center p-4"
      onClick={onClose}
    >
      {/* Header */}
      <div
        className="w-full max-w-4xl flex items-center justify-between mb-3 gap-3"
        onClick={e => e.stopPropagation()}
      >
        <div className="min-w-0">
          <p className="text-white font-semibold truncate">{media.fileName}</p>
          <p className="text-gray-400 text-xs sm:text-sm">Mové el cursor o el dedo sobre la imagen para activar la Lupa 2×</p>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <span className="text-neon-green font-bold text-lg">{formatPrice(itemPrice)}</span>
          <button
            onClick={() => inCart ? removeItem(media.id) : addItem(media)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-semibold text-sm transition-all ${
              inCart ? 'bg-neon-green text-black' : 'btn-neon'
            }`}
          >
            <ShoppingCart className="w-4 h-4" />
            {inCart ? 'En carrito' : 'Agregar'}
          </button>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-white transition-colors" aria-label="Cerrar">
            <X className="w-6 h-6" />
          </button>
        </div>
      </div>

      {/* Contenedor del Canvas centrado respetando orientación horizontal o vertical */}
      <div
        className="relative flex items-center justify-center max-w-full"
        style={{ cursor: imgLoaded ? 'none' : 'default' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Imagen oculta como fuente del canvas */}
        <img
          ref={imgRef}
          src={media.url}
          alt=""
          className="hidden"
          onLoad={handleImageLoad}
          crossOrigin="anonymous"
          onContextMenu={blockMenu}
          onDragStart={blockMenu}
        />

        {/* Skeleton de carga */}
        {!imgLoaded && (
          <div className="w-[85vw] max-w-2xl h-[60vh] flex items-center justify-center rounded-xl border border-dark-500 bg-dark-700">
            <div className="text-neon-green animate-pulse font-bold">Cargando imagen en alta definición…</div>
          </div>
        )}

        {/* Canvas principal con proporción nativa exacta (sin deformar fotos verticales ni horizontales) */}
        <canvas
          ref={canvasRef}
          width={canvasDims.w}
          height={canvasDims.h}
          className="rounded-xl border border-dark-500 shadow-2xl bg-dark-900"
          style={{
            display:     imgLoaded ? 'block' : 'none',
            maxWidth:    'min(92vw, 56rem)',
            maxHeight:   '78vh',
            width:       'auto',
            height:      'auto',
            aspectRatio: `${canvasDims.w} / ${canvasDims.h}`,
          }}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleMouseLeave}
          onContextMenu={blockMenu}
          onDragStart={blockMenu}
        />

        {/* Hint flotante */}
        {imgLoaded && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-black/75 backdrop-blur-sm text-neon-green text-xs px-3 py-1.5 rounded-full font-medium pointer-events-none select-none whitespace-nowrap border border-neon-green/20">
            🔍 Zoom 2× activo — mové el mouse para explorar
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Visor de videos ──────────────────────────────────────────────────────────
function VideoViewer({ media, onClose }) {
  const videoRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [muted,   setMuted  ] = useState(false);
  const { addItem, removeItem, items } = useCart();
  const inCart = items.some(i => i.id === media.id);
  const itemPrice = Number(media.price) || (media.type === 'video' ? 3000 : 2000);

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (playing) videoRef.current.pause(); else videoRef.current.play();
    setPlaying(p => !p);
  };

  const blockMenu = (e) => e.preventDefault();

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/95 flex flex-col items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl flex items-center justify-between mb-3 gap-3"
        onClick={e => e.stopPropagation()}
      >
        <div className="min-w-0">
          <p className="text-white font-semibold truncate">{media.fileName}</p>
          <p className="text-gray-400 text-sm">Vista previa con marca de agua</p>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <span className="text-neon-green font-bold text-lg">{formatPrice(itemPrice)}</span>
          <button
            onClick={() => inCart ? removeItem(media.id) : addItem(media)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-semibold text-sm transition-all ${
              inCart ? 'bg-neon-green text-black' : 'btn-neon'
            }`}
          >
            <ShoppingCart className="w-4 h-4" />
            {inCart ? 'En carrito' : 'Agregar'}
          </button>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-white transition-colors" aria-label="Cerrar">
            <X className="w-6 h-6" />
          </button>
        </div>
      </div>

      <div
        className="relative max-w-4xl rounded-xl overflow-hidden border border-dark-500 bg-black flex items-center justify-center"
        onClick={e => e.stopPropagation()}
      >
        <video
          ref={videoRef}
          src={media.url}
          className="max-h-[78vh] w-auto max-w-full object-contain"
          muted={muted}
          loop
          playsInline
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onContextMenu={blockMenu}
        />

        {/* Marca de agua video — patrón espaciado + central */}
        <div className="absolute inset-0 pointer-events-none select-none overflow-hidden">
          <div className="absolute inset-0 grid grid-cols-2 grid-rows-3 gap-10 p-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center justify-center">
                <span
                  className="text-white/14 font-black text-[10px] rotate-[-28deg] whitespace-nowrap"
                  style={{ letterSpacing: '0.26em', wordSpacing: '0.45em' }}
                >
                  CIANCIA PRODUCCIONES
                </span>
              </div>
            ))}
          </div>
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="rotate-[-28deg] text-center drop-shadow-[0_2px_4px_rgba(0,0,0,0.6)]">
              <p
                className="text-white/28 font-black text-xl whitespace-nowrap"
                style={{ letterSpacing: '0.26em', wordSpacing: '0.45em' }}
              >
                CIANCIA PRODUCCIONES
              </p>
              <p
                className="text-white/16 font-black text-xs whitespace-nowrap mt-3"
                style={{ letterSpacing: '0.28em', wordSpacing: '0.45em' }}
              >
                CIANCIA PRODUCCIONES
              </p>
            </div>
          </div>
        </div>

        {/* Controles */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4 flex items-center gap-3">
          <button onClick={togglePlay} className="p-2 bg-neon-green text-black rounded-full hover:shadow-neon-sm transition-shadow">
            {playing ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 fill-current" />}
          </button>
          <button onClick={() => setMuted(m => !m)} className="p-2 text-white hover:text-neon-green transition-colors">
            {muted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
          </button>
          <span className="text-white/60 text-xs flex-1">Vista previa — comprá para descargar sin marca de agua</span>
        </div>
      </div>
    </div>
  );
}

// ─── Componente principal exportado ──────────────────────────────────────────
export default function MagnifierViewer({ media, onClose }) {
  useEffect(() => {
    if (!media) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', handleKey);
    };
  }, [media, onClose]);

  if (!media) return null;
  return media.type === 'video'
    ? <VideoViewer  media={media} onClose={onClose} />
    : <PhotoMagnifier media={media} onClose={onClose} />;
}
