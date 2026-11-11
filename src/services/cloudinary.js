// Servicio de subida a Cloudinary — unsigned upload preset
// Cloud: khzko7rr | Preset: ciancia_uploads

const CLOUD_NAME    = 'khzko7rr';
const UPLOAD_PRESET = 'ciancia_uploads';

const BASE_URL = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}`;

/**
 * Sube un archivo a Cloudinary y reporta progreso.
 *
 * @param {File}     file        - Archivo a subir (imagen o video)
 * @param {Object}   options
 * @param {string}   [options.folder]            - Carpeta dentro del cloud (ej: 'ciancia/trail-2024')
 * @param {Function} [options.onProgress]        - Callback (0-100)
 * @param {string}   [options.eventLogoPublicId] - Public ID en Cloudinary del logo del evento para marca de agua dinámica
 * @param {string}   [options.eventLogoUrl]      - URL del logo del evento (si no se tiene publicId explícito)
 * @returns {Promise<CloudinaryResult>}
 */
export function uploadToCloudinary(file, { folder = 'ciancia', onProgress, eventLogoPublicId = '', eventLogoUrl = '' } = {}) {
  return new Promise((resolve, reject) => {
    const isVideo  = file.type.startsWith('video/');
    const endpoint = isVideo ? `${BASE_URL}/video/upload` : `${BASE_URL}/image/upload`;

    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', UPLOAD_PRESET);
    formData.append('folder', folder);

    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText);
          resolve(buildResult(data, isVideo, { eventLogoPublicId, eventLogoUrl }));
        } catch {
          reject(new Error('Respuesta inválida de Cloudinary'));
        }
      } else {
        let msg = `Error ${xhr.status}`;
        try {
          const err = JSON.parse(xhr.responseText);
          msg = err?.error?.message || msg;
        } catch { /* noop */ }
        reject(new Error(msg));
      }
    });

    xhr.addEventListener('error', () => reject(new Error('Error de red al subir a Cloudinary')));
    xhr.addEventListener('abort', () => reject(new Error('Subida cancelada')));

    xhr.open('POST', endpoint);
    xhr.send(formData);
  });
}

/**
 * Extrae el public_id de una URL de Cloudinary si pertenece al mismo cloud (`khzko7rr`).
 */
export function extractCloudinaryPublicId(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  if (!rawUrl.includes(`res.cloudinary.com/${CLOUD_NAME}/image/upload/`)) return '';
  const [, rest] = rawUrl.split('/image/upload/');
  if (!rest) return '';

  const segments = rest.split('/');
  // Filtrar segmentos de transformación o versión (v1234567)
  const cleanSegments = segments.filter((seg, idx) => {
    if (idx < segments.length - 1) {
      if (/^v\d+$/.test(seg)) return false;
      if (seg.includes(',') || /^(w_|h_|c_|q_|f_|g_|ar_|e_|fl_|bo_|r_|o_|a_|b_|l_)/.test(seg)) return false;
    }
    return true;
  });

  const withExt = cleanSegments.join('/');
  return withExt.replace(/\.(png|jpg|jpeg|webp|gif|svg)$/i, '');
}

/**
 * Construye el segmento de transformación de marca de agua dinámica de Cloudinary
 * (`l_<logo>/c_scale,w_0.42,fl_relative,o_35/fl_layer_apply,g_center`) a partir
 * del publicId o URL del logo del evento.
 * `opacity` (0-100) y `size` (ej. `w_0.42` relativo al ancho o `h_0.55` relativo al alto)
 * permiten variantes, como la marca más traslúcida del banner del álbum.
 */
export function buildCloudinaryWatermarkTransform({ eventLogoPublicId = '', eventLogoUrl = '', opacity = 35, size = 'w_0.42' } = {}) {
  const resolvedPublicId = (eventLogoPublicId || '').trim() || extractCloudinaryPublicId(eventLogoUrl);
  const layerParams = `${size},fl_relative,o_${Math.max(0, Math.min(100, Math.round(opacity)))}`;
  if (resolvedPublicId) {
    // En Cloudinary los "/" dentro del public_id de un overlay se reemplazan por ":"
    const overlayId = resolvedPublicId.replace(/\//g, ':');
    return `l_${overlayId},${layerParams}/fl_layer_apply,g_center`;
  }
  const cleanUrl = (eventLogoUrl || '').trim();
  if (cleanUrl && /^https?:\/\//i.test(cleanUrl) && typeof btoa === 'function') {
    try {
      const b64 = btoa(cleanUrl).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      return `l_fetch:${b64},${layerParams}/fl_layer_apply,g_center`;
    } catch {
      return '';
    }
  }
  return '';
}

/**
 * Construye el objeto de resultado normalizado a partir de la respuesta de Cloudinary.
 * Usa c_limit para preservar siempre la relación de aspecto nativa (horizontal o vertical)
 * sin recortar ni deformar fotos 9:16, 3:4 o 16:9.
 * La foto original (`url` y `secure_url`) se mantiene 100% limpia sin marca de agua para descarga HD.
 * La miniatura/vista previa (`thumb`) incluye la transformación de marca de agua dinámica si el álbum tiene logo.
 */
function buildResult(data, isVideo, { eventLogoPublicId = '', eventLogoUrl = '' } = {}) {
  const { public_id, secure_url, resource_type, format, duration, width, height } = data;
  const isPdf =
    String(format || '').toLowerCase() === 'pdf' ||
    resource_type === 'raw' ||
    /\.pdf$/i.test(secure_url || '');

  // URL de alta calidad reservada para la descarga post-compra manteniendo proporción original (100% LIMPIA)
  // Para PDFs o videos preservamos el secure_url directo sin inyectar transformaciones de imagen
  const url = (isVideo || isPdf)
    ? secure_url
    : buildImageUrl(public_id, 'w_3840,h_3840,c_limit,f_auto,q_auto:best');

  // Transformación opcional de marca de agua del evento para la muestra pública
  const watermarkTransform = (!isVideo && !isPdf)
    ? buildCloudinaryWatermarkTransform({ eventLogoPublicId, eventLogoUrl })
    : '';

  const baseThumbTransform = 'w_800,h_800,c_limit,q_55,f_auto';
  const fullThumbTransform = watermarkTransform
    ? `${baseThumbTransform}/${watermarkTransform}`
    : baseThumbTransform;

  // Muestra en baja resolución para grillas y visor público con lupa (máx 800px, comprimida q_55 + logo del evento)
  const thumb = isVideo
    ? buildVideoThumb(public_id)
    : isPdf
      ? secure_url
      : buildImageUrl(public_id, fullThumbTransform);

  return {
    publicId:     public_id,
    url,
    thumb,
    secure_url,
    resourceType: resource_type,
    format,
    width:        width || null,
    height:       height || null,
    duration:     duration ? formatDuration(duration) : null,
  };
}

// ─── Helpers de URL y Seguridad de Muestras ──────────────────────────────────

function buildImageUrl(publicId, transforms) {
  return `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/${transforms}/${publicId}`;
}

/** Thumbnail de video: frame del segundo 1, convertido a JPG en baja resolución con c_limit */
function buildVideoThumb(publicId) {
  return `https://res.cloudinary.com/${CLOUD_NAME}/video/upload/so_1,w_600,h_600,c_limit,f_jpg,q_55/${publicId}.jpg`;
}

/**
 * Separa los segmentos de transformación de Cloudinary de la ruta real del archivo (`v123/folder/file.jpg`).
 */
function stripCloudinaryTransforms(rest) {
  if (!rest) return '';
  const segments = rest.split('/');
  let startIdx = 0;
  while (startIdx < segments.length - 1) {
    const seg = segments[startIdx] || '';
    const isTransform =
      seg.includes(',') ||
      /^(w_|h_|c_|q_|f_|g_|ar_|e_|fl_|bo_|r_|o_|a_|b_|l_|so_)/.test(seg);
    if (isTransform) {
      startIdx++;
    } else {
      break;
    }
  }
  return segments.slice(startIdx).join('/');
}

/**
 * Transforma cualquier URL de imagen (Cloudinary o externa) en una muestra de baja
 * resolución y alta compresión para el catálogo público y el visor con lupa.
 * Si se provee `eventLogoPublicId` o `eventLogoUrl` (o si la URL ya tenía `l_...`),
 * aplica la capa de marca de agua dinámica de Cloudinary (`fl_layer_apply,g_center,o_35`).
 * Nunca expone la resolución original en el frontend público.
 */
export function getLowResSampleUrl(rawUrl, { width = 800, quality = 55, eventLogoPublicId = '', eventLogoUrl = '' } = {}) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';

  // 1) Si es una imagen alojada en Cloudinary, forzamos transformación w_{width},q_{quality},f_auto (+ overlay si aplica)
  if (rawUrl.includes('res.cloudinary.com') && rawUrl.includes('/image/upload/')) {
    const [prefix, rest] = rawUrl.split('/image/upload/');
    if (rest) {
      // Preservar overlay existente si la URL ya lo traía estampado en thumb
      const existingOverlayMatch = rest.match(/(l_[^/]+(?:\/[^/]+)?\/fl_layer_apply[^/]*)/);
      const explicitWatermark = buildCloudinaryWatermarkTransform({ eventLogoPublicId, eventLogoUrl });
      const watermarkLayer = explicitWatermark || (existingOverlayMatch ? existingOverlayMatch[1] : '');

      const cleanPath = stripCloudinaryTransforms(rest);
      const transformChain = watermarkLayer
        ? `w_${width},h_${width},c_limit,q_${quality},f_auto/${watermarkLayer}`
        : `w_${width},h_${width},c_limit,q_${quality},f_auto`;

      return `${prefix}/image/upload/${transformChain}/${cleanPath}`;
    }
  }

  // 2) Si es una URL de Unsplash u otro CDN con parámetros de query
  if (rawUrl.includes('images.unsplash.com')) {
    try {
      const u = new URL(rawUrl);
      u.searchParams.set('w', String(width));
      u.searchParams.set('q', String(quality));
      return u.toString();
    } catch {
      return rawUrl;
    }
  }

  return rawUrl;
}

/**
 * Transforma una URL maestra de video en Cloudinary en un stream de vista previa
 * de baja resolución (`w_850,h_850,c_limit,q_45`) para no exponer el video 4K/1080p original en el visor público.
 */
export function getLowResVideoUrl(rawUrl, { width = 850, quality = 45 } = {}) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  if (rawUrl.includes('res.cloudinary.com') && rawUrl.includes('/video/upload/')) {
    const [prefix, rest] = rawUrl.split('/video/upload/');
    if (rest) {
      const cleanPath = stripCloudinaryTransforms(rest);
      return `${prefix}/video/upload/w_${width},h_${width},c_limit,q_${quality}/${cleanPath}`;
    }
  }
  return rawUrl;
}

/**
 * Obtiene la URL en Máxima Calidad (HD/4K) exclusivamente para órdenes aprobadas.
 * Elimina cualquier transformación previa o capa de marca de agua para garantizar el original limpio.
 * Si `attachment: true`, agrega `fl_attachment` para que Cloudinary fuerce la descarga
 * directa (`Content-Disposition: attachment`) sin abrir el archivo en una pestaña.
 */
export function getHighResDownloadUrl(rawUrl, { attachment = false } = {}) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';

  if (rawUrl.includes('res.cloudinary.com') && rawUrl.includes('/image/upload/')) {
    const [prefix, rest] = rawUrl.split('/image/upload/');
    if (rest) {
      const cleanPath = stripCloudinaryTransforms(rest);
      const flags = attachment ? 'fl_attachment,q_auto:best' : 'q_auto:best';
      return `${prefix}/image/upload/${flags}/${cleanPath}`;
    }
  }

  if (rawUrl.includes('res.cloudinary.com') && rawUrl.includes('/video/upload/')) {
    const [prefix, rest] = rawUrl.split('/video/upload/');
    if (rest) {
      const cleanPath = stripCloudinaryTransforms(rest);
      return attachment
        ? `${prefix}/video/upload/fl_attachment/${cleanPath}`
        : `${prefix}/video/upload/${cleanPath}`;
    }
  }

  return rawUrl;
}

/**
 * Genera la URL optimizada para el banner/portada de un álbum.
 * - Parte siempre del archivo original (descarta transformaciones previas, ej. el thumb w_800 / q_55).
 * - Recorta exactamente al tamaño del banner (`c_fill`) con encuadre inteligente (`g_auto`): Cloudinary
 *   centra el recorte en el sujeto principal / rostro del deportista en lugar del centro geométrico,
 *   evitando que queden "decapitados" en el banner apaisado.
 * - `q_auto,f_auto` entrega la mejor relación calidad/peso y formato moderno (AVIF/WebP) según el navegador.
 *
 * @param {string} rawUrl
 * @param {Object} [options]
 * @param {number} [options.width=1920]
 * @param {number} [options.height=600]
 * @param {string} [options.gravity='auto'] - 'auto' (sujeto principal), 'auto:faces' o 'face'
 * @param {string} [options.eventLogoPublicId] - Logo del evento para la marca de agua del banner
 * @param {string} [options.eventLogoUrl]
 * @param {number} [options.watermarkOpacity=16] - Más traslúcida que la de las fotos del álbum (o_35)
 * @returns {string}
 */
export function getBannerImageUrl(rawUrl, {
  width = 1920,
  height = 600,
  gravity = 'auto',
  eventLogoPublicId = '',
  eventLogoUrl = '',
  watermarkOpacity = 16,
} = {}) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';

  if (rawUrl.includes('res.cloudinary.com') && rawUrl.includes('/image/upload/')) {
    const [prefix, rest] = rawUrl.split('/image/upload/');
    if (rest) {
      const cleanPath = stripCloudinaryTransforms(rest);
      // Marca de agua del evento: escalada según el ALTO del banner (h_0.5) para que el logo nunca
      // desborde el recorte apaisado, y con opacidad baja para no tapar la portada.
      const watermark = buildCloudinaryWatermarkTransform({
        eventLogoPublicId,
        eventLogoUrl,
        opacity: watermarkOpacity,
        size: 'h_0.5',
      });
      const base = `w_${width},h_${height},c_fill,g_${gravity},q_auto,f_auto`;
      return `${prefix}/image/upload/${watermark ? `${base}/${watermark}` : base}/${cleanPath}`;
    }
  }

  // Portadas externas de Unsplash (datos de ejemplo): recorte equivalente con foco en rostros
  if (rawUrl.includes('images.unsplash.com')) {
    try {
      const u = new URL(rawUrl);
      u.searchParams.set('w', String(width));
      u.searchParams.set('h', String(height));
      u.searchParams.set('fit', 'crop');
      u.searchParams.set('crop', 'faces,entropy');
      u.searchParams.set('auto', 'format');
      u.searchParams.set('q', '80');
      return u.toString();
    } catch {
      return rawUrl;
    }
  }

  return rawUrl;
}

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
