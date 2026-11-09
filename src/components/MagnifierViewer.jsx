import React, { useEffect, useRef, useCallback, useState } from 'react';
import { X, ShoppingCart, Play, Pause, Volume2, VolumeX, ShieldAlert, Lock } from 'lucide-react';
import { useCart } from '../context/CartContext';
import { getLowResSampleUrl } from '../services/cloudinary';

const LUPE_RADIUS    = 125;
const ZOOM_FACTOR    = 2;
const WATERMARK_TEXT = 'CIANCIA   PRODUCCIONES';
const MAX_SAMPLE_DIM = 850; // Máximo 850px en previsualización para no entregar nunca alta resolución

function formatPrice(n) {
  return `$${(n || 0).toLocaleString('es-AR')}`;
}

// ─── Generador de Marca de Agua Reforzada Anti-IA y Anti-Recorte ─────────────
// 1) Trama guilloché + red de líneas finas cruzadas de punta a punta sobre toda la foto.
// 2) Patrón diagonal repetido "CIANCIA PRODUCCIONES" en doble tono (borde oscuro + relleno claro).
// 3) Marca central de seguridad con líneas de guarda que cruza la zona media del corredor.
export function drawWatermarks(ctx, W, H) {
  const minDim = Math.min(W, H);
  const diag   = Math.hypot(W, H);

  // ── 1) Red de líneas finas cruzadas + ondas guilloché de punta a punta ────
  ctx.save();
  ctx.translate(W / 2, H / 2);

  // 1a. Malla diagonal cruzada (+28° y -28°) que cubre el 100% de la superficie
  const meshStep = Math.max(24, Math.round(minDim / 22));
  const angles   = [-Math.PI / 6.4, Math.PI / 6.4];

  angles.forEach((angle, idx) => {
    ctx.save();
    ctx.rotate(angle);
    ctx.lineWidth = Math.max(0.8, minDim / 750);

    for (let y = -diag; y <= diag; y += meshStep) {
      // Alternamos trazo claro y trazo oscuro sutil para afectar tanto zonas claras como oscuras
      ctx.strokeStyle = ((Math.round(y / meshStep) + idx) % 2 === 0)
        ? 'rgba(255, 255, 255, 0.11)'
        : 'rgba(0, 0, 0, 0.09)';
      ctx.beginPath();
      ctx.moveTo(-diag, y);
      ctx.lineTo(diag, y);
      ctx.stroke();
    }
    ctx.restore();
  });

  // 1b. Curvas sinusoidales guilloché entrelazadas (dificultan reconstrucción por IA)
  ctx.save();
  ctx.rotate(-Math.PI / 8);
  const waveStep = Math.max(38, Math.round(minDim / 13));
  const amp      = Math.max(6, Math.round(minDim / 65));
  const freq     = (Math.PI * 2) / Math.max(90, Math.round(minDim / 5));
  ctx.lineWidth  = Math.max(0.85, minDim / 680);

  for (let baseY = -diag; baseY <= diag; baseY += waveStep) {
    // Onda fase A (blanca sutil)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)';
    ctx.beginPath();
    for (let x = -diag; x <= diag; x += 14) {
      const y = baseY + Math.sin(x * freq) * amp;
      if (x === -diag) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Onda fase B (contrafase)
    ctx.strokeStyle = 'rgba(6, 182, 212, 0.06)';
    ctx.beginPath();
    for (let x = -diag; x <= diag; x += 14) {
      const y = baseY + Math.cos(x * freq) * amp;
      if (x === -diag) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();
  ctx.restore();

  // ── 2) Patrón repetido diagonal "CIANCIA PRODUCCIONES" bien espaciado ─────
  const smallSize = Math.max(11, Math.round(minDim / 42));
  ctx.save();
  ctx.font         = `900 ${smallSize}px "Inter", "Arial Black", sans-serif`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  if ('letterSpacing' in ctx) {
    ctx.letterSpacing = `${Math.max(2, Math.round(smallSize * 0.24))}px`;
  }

  const measured = ctx.measureText(WATERMARK_TEXT).width;
  const stepX    = Math.round(measured * 1.55 + 95);
  const stepY    = Math.round(Math.max(smallSize * 7.5, measured * 0.56));

  for (let row = -2; row < H / stepY + 3; row++) {
    for (let col = -1; col < W / stepX + 2; col++) {
      const offsetX = (row % 2 === 0) ? 0 : stepX / 2;
      ctx.save();
      ctx.translate(col * stepX + offsetX, row * stepY);
      ctx.rotate(-Math.PI / 6);

      ctx.lineWidth   = Math.max(1.5, smallSize * 0.12);
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.22)';
      ctx.strokeText(WATERMARK_TEXT, 0, 0);

      ctx.fillStyle = 'rgba(255, 255, 255, 0.20)';
      ctx.fillText(WATERMARK_TEXT, 0, 0);
      ctx.restore();
    }
  }
  ctx.restore();

  // ── 3) Marca central anti-IA cruzando la zona media del corredor ──────────
  const bigSize = Math.max(18, Math.round(minDim / 13.5));
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.rotate(-Math.PI / 6);
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';

  // Líneas de guarda paralelas que cruzan todo el torso del corredor
  const bandHalf = Math.round(bigSize * 1.05);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
  ctx.lineWidth   = Math.max(1, minDim / 480);
  ctx.beginPath();
  ctx.moveTo(-diag, -bandHalf);
  ctx.lineTo(diag, -bandHalf);
  ctx.moveTo(-diag, bandHalf);
  ctx.lineTo(diag, bandHalf);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(0, 0, 0, 0.20)';
  ctx.beginPath();
  ctx.moveTo(-diag, -bandHalf - 2);
  ctx.lineTo(diag, -bandHalf - 2);
  ctx.moveTo(-diag, bandHalf + 2);
  ctx.lineTo(diag, bandHalf + 2);
  ctx.stroke();

  // Texto central principal
  ctx.font = `900 ${bigSize}px "Inter", "Arial Black", sans-serif`;
  if ('letterSpacing' in ctx) {
    ctx.letterSpacing = `${Math.max(4, Math.round(bigSize * 0.22))}px`;
  }

  ctx.shadowColor   = 'rgba(0, 0, 0, 0.55)';
  ctx.shadowBlur    = 6;
  ctx.shadowOffsetX = 1;
  ctx.shadowOffsetY = 1;

  ctx.lineWidth   = Math.max(2, bigSize * 0.08);
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.32)';
  ctx.strokeText(WATERMARK_TEXT, 0, 0);

  ctx.fillStyle = 'rgba(255, 255, 255, 0.34)';
  ctx.fillText(WATERMARK_TEXT, 0, 0);

  // Sub-bandas superior e inferior sobre la zona media del sujeto
  const subSize = Math.max(10, Math.round(bigSize * 0.44));
  ctx.font = `900 ${subSize}px "Inter", "Arial Black", sans-serif`;
  if ('letterSpacing' in ctx) {
    ctx.letterSpacing = `${Math.max(3, Math.round(subSize * 0.25))}px`;
  }
  ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
  ctx.fillText('MUESTRA PROTEGIDA · CIANCIA PRODUCCIONES', 0, bigSize * 1.75);
  ctx.fillText('MUESTRA PROTEGIDA · CIANCIA PRODUCCIONES', 0, -bigSize * 1.75);

  ctx.restore();
}

// ─── Hook de Protección Activa contra Capturas y Pérdida de Foco ─────────────
function useCaptureShield() {
  const [shieldActive, setShieldActive] = useState(false);

  useEffect(() => {
    const activateShield = () => {
      setShieldActive(true);
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText('Contenido protegido — Ciancia Producciones').catch(() => {});
        }
      } catch {
        // noop
      }
    };

    const handleKeyDown = (e) => {
      const key = e.key || '';
      const lower = key.toLowerCase();

      // PrintScreen / Impr Pant
      if (key === 'PrintScreen' || e.code === 'PrintScreen' || e.keyCode === 44) {
        e.preventDefault();
        activateShield();
        return;
      }

      // Atajos de recorte de pantalla: Win+Shift+S / Cmd+Shift+S / Cmd+Shift+3/4/5
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && ['s', '3', '4', '5', 'i', 'c', 'j'].includes(lower)) {
        e.preventDefault();
        activateShield();
        return;
      }

      // Ctrl/Cmd + P (Imprimir), Ctrl/Cmd + S (Guardar), Ctrl/Cmd + U (Código fuente), Ctrl/Cmd + C
      if ((e.ctrlKey || e.metaKey) && ['p', 's', 'u', 'c'].includes(lower)) {
        e.preventDefault();
        if (lower === 'p' || lower === 's') {
          activateShield();
        }
      }
    };

    const handleKeyUp = (e) => {
      if (e.key === 'PrintScreen' || e.code === 'PrintScreen' || e.keyCode === 44) {
        e.preventDefault();
        activateShield();
      }
    };

    const handleWindowBlur = () => {
      activateShield();
    };

    const handleVisibilityChange = () => {
      if (document.hidden || document.visibilityState !== 'visible') {
        activateShield();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keyup', handleKeyUp, true);
    window.addEventListener('blur', handleWindowBlur);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keyup', handleKeyUp, true);
      window.removeEventListener('blur', handleWindowBlur);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const restoreView = useCallback((e) => {
    if (e) e.stopPropagation();
    setShieldActive(false);
  }, []);

  return { shieldActive, restoreView };
}

// ─── Banner informativo de Muestra en Baja Resolución ────────────────────────
function LowResProtectionBadge() {
  return (
    <div
      className="mt-3 w-full max-w-3xl rounded-xl border border-neon-green/35 bg-dark-800/95 px-4 py-2.5 shadow-lg flex items-center justify-center gap-2.5 text-center select-none"
      onClick={(e) => e.stopPropagation()}
    >
      <Lock className="w-4 h-4 text-neon-green flex-shrink-0 hidden sm:block" />
      <p className="text-xs sm:text-sm text-gray-200 leading-snug">
        🔒 <strong className="text-neon-green">Muestra protegida en baja resolución</strong> — Con tu compra descargás el archivo original en <strong className="text-white">Máxima Calidad (HD/4K)</strong> y sin marcas de agua.
      </p>
    </div>
  );
}

// ─── Visor de fotos en <canvas> con lupa 2x y escudo anticaptura ──────────────
function PhotoMagnifier({ media, onClose }) {
  const canvasRef = useRef(null);
  const imgObjRef = useRef(null);
  const animRef   = useRef(null);
  const mousePos  = useRef({ x: -9999, y: -9999 });

  const [imgLoaded, setImgLoaded]   = useState(false);
  const [canvasDims, setCanvasDims] = useState({ w: 800, h: 533 });
  const { shieldActive, restoreView } = useCaptureShield();

  const { addItem, removeItem, items } = useCart();
  const inCart    = items.some(i => i.id === media.id);
  const itemPrice = Number(media.price) || (media.type === 'video' ? 3000 : 2000);

  // Carga en memoria (sin etiqueta <img> en el DOM) usando siempre URL de muestra comprimida (w_850, q_55)
  useEffect(() => {
    let cancelled = false;
    setImgLoaded(false);
    imgObjRef.current = null;

    const sampleSrc = getLowResSampleUrl(media.thumb || media.url, {
      width:   MAX_SAMPLE_DIM,
      quality: 55,
    });

    const loadImg = (useCors) => {
      const img = new window.Image();
      if (useCors) img.crossOrigin = 'anonymous';
      img.decoding = 'async';

      img.onload = () => {
        if (cancelled) return;
        const nw = img.naturalWidth  || 800;
        const nh = img.naturalHeight || 600;
        const scale = Math.min(1, MAX_SAMPLE_DIM / Math.max(nw, nh));
        const w = Math.max(1, Math.round(nw * scale));
        const h = Math.max(1, Math.round(nh * scale));
        imgObjRef.current = img;
        setCanvasDims({ w, h });
        setImgLoaded(true);
      };

      img.onerror = () => {
        if (cancelled) return;
        if (useCors) {
          loadImg(false);
        }
      };

      img.src = sampleSrc;
    };

    loadImg(true);

    return () => {
      cancelled = true;
    };
  }, [media.id, media.thumb, media.url]);

  // ── Loop de dibujo en <canvas> ────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const img    = imgObjRef.current;
    if (!canvas || !img || !img.complete || img.naturalWidth === 0) {
      animRef.current = requestAnimationFrame(draw);
      return;
    }

    const ctx = canvas.getContext('2d');
    const W   = canvas.width;
    const H   = canvas.height;
    const { x: mx, y: my } = mousePos.current;

    ctx.clearRect(0, 0, W, H);

    // 1) Foto de muestra redimensionada a baja resolución (máx 850px)
    ctx.drawImage(img, 0, 0, W, H);

    // 2) Marcas de agua reforzadas Anti-IA (trama guilloché + diagonales + banda central)
    drawWatermarks(ctx, W, H);

    // 3) Lupa 2x sobre la muestra protegida (sólo cuando el cursor está activo y no hay bloqueo)
    const inBounds = !shieldActive && mx >= 0 && my >= 0 && mx <= W && my <= H;
    if (inBounds) {
      const r = Math.min(LUPE_RADIUS, Math.round(Math.min(W, H) * 0.28));

      ctx.save();
      ctx.beginPath();
      ctx.arc(mx, my, r, 0, Math.PI * 2);
      ctx.clip();

      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(mx - r, my - r, r * 2, r * 2);

      ctx.translate(mx, my);
      ctx.scale(ZOOM_FACTOR, ZOOM_FACTOR);
      ctx.translate(-mx, -my);

      ctx.drawImage(img, 0, 0, W, H);
      drawWatermarks(ctx, W, H);

      ctx.restore();

      // Borde del círculo (cyan)
      ctx.save();
      ctx.beginPath();
      ctx.arc(mx, my, r, 0, Math.PI * 2);
      ctx.strokeStyle = '#06b6d4';
      ctx.lineWidth   = 2.5;
      ctx.shadowColor = '#06b6d4';
      ctx.shadowBlur  = 14;
      ctx.stroke();
      ctx.restore();

      // Cruz de mira
      ctx.save();
      ctx.strokeStyle = 'rgba(6,182,212,0.75)';
      ctx.lineWidth   = 1;
      ctx.beginPath();
      ctx.moveTo(mx - 12, my); ctx.lineTo(mx + 12, my);
      ctx.moveTo(mx, my - 12); ctx.lineTo(mx, my + 12);
      ctx.stroke();
      ctx.restore();
    }

    animRef.current = requestAnimationFrame(draw);
  }, [shieldActive]);

  useEffect(() => {
    if (imgLoaded) animRef.current = requestAnimationFrame(draw);
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [imgLoaded, canvasDims, draw]);

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
    if (t) mousePos.current = getCanvasPos(t.clientX, t.clientY - 55);
  };
  const blockMenu = (e) => e.preventDefault();

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/95 flex flex-col items-center justify-center p-4 select-none"
      style={{
        userSelect:         'none',
        WebkitUserSelect:   'none',
        WebkitTouchCallout: 'none',
      }}
      onContextMenu={blockMenu}
      onClick={() => {
        if (shieldActive) restoreView();
        else onClose();
      }}
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
        className="relative flex items-center justify-center max-w-full overflow-hidden rounded-xl"
        style={{
          cursor:             imgLoaded && !shieldActive ? 'none' : 'default',
          userSelect:         'none',
          WebkitUserSelect:   'none',
          WebkitTouchCallout: 'none',
        }}
        onContextMenu={blockMenu}
        onClick={(e) => {
          e.stopPropagation();
          if (shieldActive) restoreView();
        }}
      >
        {/* Skeleton de carga */}
        {!imgLoaded && (
          <div className="w-[85vw] max-w-2xl h-[58vh] flex items-center justify-center rounded-xl border border-dark-500 bg-dark-700">
            <div className="text-neon-green animate-pulse font-bold">Cargando muestra protegida…</div>
          </div>
        )}

        {/* Canvas principal en baja resolución (nunca expone <img> ni URL HD) */}
        <canvas
          ref={canvasRef}
          width={canvasDims.w}
          height={canvasDims.h}
          className="rounded-xl border border-dark-500 shadow-2xl bg-dark-900 select-none"
          style={{
            display:            imgLoaded ? 'block' : 'none',
            maxWidth:           'min(92vw, 54rem)',
            maxHeight:          '70vh',
            width:              'auto',
            height:             'auto',
            aspectRatio:        `${canvasDims.w} / ${canvasDims.h}`,
            userSelect:         'none',
            WebkitUserSelect:   'none',
            WebkitTouchCallout: 'none',
            filter:             shieldActive ? 'blur(20px)' : 'none',
            transition:         shieldActive ? 'none' : 'filter 0.2s ease',
          }}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleMouseLeave}
          onContextMenu={blockMenu}
          onDragStart={blockMenu}
        />

        {/* Escudo activo ante intento de captura o pérdida de foco */}
        {shieldActive && (
          <div
            onClick={restoreView}
            onContextMenu={blockMenu}
            className="absolute inset-0 z-30 bg-black/65 flex flex-col items-center justify-center p-6 text-center cursor-pointer select-none"
          >
            <div className="bg-dark-800/95 border-2 border-neon-green/60 rounded-2xl p-5 max-w-sm shadow-2xl space-y-2.5">
              <ShieldAlert className="w-10 h-10 text-neon-green mx-auto" />
              <p className="text-white font-black text-base uppercase tracking-wide">
                Contenido protegido
              </p>
              <p className="text-xs text-gray-300 leading-relaxed">
                Por derechos de autor, las capturas de pantalla están deshabilitadas en las muestras. Hacé clic en la ventana para continuar viendo la vista previa.
              </p>
              <span className="inline-block mt-1 px-4 py-1.5 rounded-lg bg-neon-green text-black font-bold text-xs">
                Volver a ver muestra
              </span>
            </div>
          </div>
        )}

        {/* Hint flotante */}
        {imgLoaded && !shieldActive && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-black/75 backdrop-blur-sm text-neon-green text-xs px-3 py-1.5 rounded-full font-medium pointer-events-none select-none whitespace-nowrap border border-neon-green/20">
            🔍 Zoom 2× activo — mové el mouse para explorar
          </div>
        )}
      </div>

      {/* Aviso visible de Baja Calidad de Muestra */}
      <LowResProtectionBadge />
    </div>
  );
}

// ─── Visor de videos ──────────────────────────────────────────────────────────
function VideoViewer({ media, onClose }) {
  const videoRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [muted,   setMuted  ] = useState(false);
  const { shieldActive, restoreView } = useCaptureShield();
  const { addItem, removeItem, items } = useCart();
  const inCart    = items.some(i => i.id === media.id);
  const itemPrice = Number(media.price) || (media.type === 'video' ? 3000 : 2000);

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (playing) videoRef.current.pause(); else videoRef.current.play();
    setPlaying(p => !p);
  };

  const blockMenu = (e) => e.preventDefault();

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/95 flex flex-col items-center justify-center p-4 select-none"
      style={{
        userSelect:         'none',
        WebkitUserSelect:   'none',
        WebkitTouchCallout: 'none',
      }}
      onContextMenu={blockMenu}
      onClick={() => {
        if (shieldActive) restoreView();
        else onClose();
      }}
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
        onClick={(e) => {
          e.stopPropagation();
          if (shieldActive) restoreView();
        }}
        onContextMenu={blockMenu}
      >
        <video
          ref={videoRef}
          src={media.url}
          className="max-h-[70vh] w-auto max-w-full object-contain select-none"
          style={{
            filter:             shieldActive ? 'blur(20px)' : 'none',
            transition:         shieldActive ? 'none' : 'filter 0.2s ease',
            userSelect:         'none',
            WebkitUserSelect:   'none',
            WebkitTouchCallout: 'none',
          }}
          controlsList="nodownload noplaybackrate"
          disablePictureInPicture
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

        {shieldActive && (
          <div
            onClick={restoreView}
            onContextMenu={blockMenu}
            className="absolute inset-0 z-30 bg-black/65 flex flex-col items-center justify-center p-6 text-center cursor-pointer select-none"
          >
            <div className="bg-dark-800/95 border-2 border-neon-green/60 rounded-2xl p-5 max-w-sm shadow-2xl space-y-2.5">
              <ShieldAlert className="w-10 h-10 text-neon-green mx-auto" />
              <p className="text-white font-black text-base uppercase tracking-wide">
                Contenido protegido
              </p>
              <p className="text-xs text-gray-300 leading-relaxed">
                Hacé clic en la ventana para continuar viendo la vista previa.
              </p>
            </div>
          </div>
        )}

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

      <LowResProtectionBadge />
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
    ? <VideoViewer   media={media} onClose={onClose} />
    : <PhotoMagnifier media={media} onClose={onClose} />;
}
