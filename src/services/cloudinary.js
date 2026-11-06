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

  // URL de alta calidad para el visor/descarga manteniendo proporción original
  const url = isVideo
    ? secure_url
    : buildImageUrl(public_id, 'w_2400,h_2400,c_limit,f_auto,q_auto:best');

  // Thumbnail para grillas preservando orientación nativa con c_limit (sin recortes forzados)
  const thumb = isVideo
    ? buildVideoThumb(public_id)
    : buildImageUrl(public_id, 'w_600,h_600,c_limit,f_auto,q_80');

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

// ─── Helpers de URL ───────────────────────────────────────────────────────────

function buildImageUrl(publicId, transforms) {
  return `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/${transforms}/${publicId}`;
}

/** Thumbnail de video: frame del segundo 1, convertido a JPG manteniendo proporción con c_limit */
function buildVideoThumb(publicId) {
  return `https://res.cloudinary.com/${CLOUD_NAME}/video/upload/so_1,w_600,h_600,c_limit,f_jpg,q_80/${publicId}.jpg`;
}

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
