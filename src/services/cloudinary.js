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
 * @param {string}   [options.folder]     - Carpeta dentro del cloud (ej: 'ciancia/trail-2024')
 * @param {Function} [options.onProgress] - Callback (0-100)
 * @returns {Promise<CloudinaryResult>}
 */
export function uploadToCloudinary(file, { folder = 'ciancia', onProgress } = {}) {
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
          resolve(buildResult(data, isVideo));
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
 * Construye el objeto de resultado normalizado a partir de la respuesta de Cloudinary.
 * Usa c_limit para preservar siempre la relación de aspecto nativa (horizontal o vertical)
 * sin recortar ni deformar fotos 9:16, 3:4 o 16:9.
 */
function buildResult(data, isVideo) {
  const { public_id, secure_url, resource_type, format, duration, width, height } = data;

  // URL de alta calidad reservada para la descarga post-compra manteniendo proporción original
  const url = isVideo
    ? secure_url
    : buildImageUrl(public_id, 'w_3840,h_3840,c_limit,f_auto,q_auto:best');

  // Muestra en baja resolución para grillas y visor público con lupa (máx 800px, comprimida q_55)
  const thumb = isVideo
    ? buildVideoThumb(public_id)
    : buildImageUrl(public_id, 'w_800,h_800,c_limit,q_55,f_auto');

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
 * Transforma cualquier URL de imagen (Cloudinary o externa) en una muestra de baja
 * resolución y alta compresión para el catálogo público y el visor con lupa.
 * Nunca expone la resolución original en el frontend público.
 */
export function getLowResSampleUrl(rawUrl, { width = 800, quality = 55 } = {}) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';

  // 1) Si es una imagen alojada en Cloudinary, forzamos transformación w_{width},q_{quality},f_auto
  if (rawUrl.includes('res.cloudinary.com') && rawUrl.includes('/image/upload/')) {
    const [prefix, rest] = rawUrl.split('/image/upload/');
    if (rest) {
      const segments = rest.split('/');
      const firstSeg = segments[0] || '';
      const looksLikeTransform =
        firstSeg.includes(',') ||
        /^(w_|h_|c_|q_|f_|g_|ar_|e_|fl_|bo_|r_|o_|a_|b_)/.test(firstSeg);
      const cleanPath = looksLikeTransform ? segments.slice(1).join('/') : rest;
      return `${prefix}/image/upload/w_${width},h_${width},c_limit,q_${quality},f_auto/${cleanPath}`;
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
 * Obtiene la URL en Máxima Calidad (HD/4K) exclusivamente para órdenes aprobadas.
 * Si `attachment: true`, agrega `fl_attachment` para que Cloudinary fuerce la descarga
 * directa (`Content-Disposition: attachment`) sin abrir el archivo en una pestaña.
 */
export function getHighResDownloadUrl(rawUrl, { attachment = false } = {}) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';

  if (rawUrl.includes('res.cloudinary.com') && rawUrl.includes('/image/upload/')) {
    const [prefix, rest] = rawUrl.split('/image/upload/');
    if (rest) {
      const segments = rest.split('/');
      const firstSeg = segments[0] || '';
      const looksLikeTransform =
        firstSeg.includes(',') ||
        /^(w_|h_|c_|q_|f_|g_|ar_|e_|fl_|bo_|r_|o_|a_|b_)/.test(firstSeg);
      const cleanPath = looksLikeTransform ? segments.slice(1).join('/') : rest;
      const flags = attachment ? 'fl_attachment,q_auto:best' : 'q_auto:best';
      return `${prefix}/image/upload/${flags}/${cleanPath}`;
    }
  }

  if (rawUrl.includes('res.cloudinary.com') && rawUrl.includes('/video/upload/')) {
    const [prefix, rest] = rawUrl.split('/video/upload/');
    if (rest) {
      const segments = rest.split('/');
      const firstSeg = segments[0] || '';
      const looksLikeTransform =
        firstSeg.includes(',') ||
        /^(w_|h_|c_|q_|f_|g_|ar_|e_|fl_|bo_|r_|o_|a_|b_|so_)/.test(firstSeg);
      const cleanPath = looksLikeTransform ? segments.slice(1).join('/') : rest;
      return attachment
        ? `${prefix}/video/upload/fl_attachment/${cleanPath}`
        : `${prefix}/video/upload/${cleanPath}`;
    }
  }

  return rawUrl;
}

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
