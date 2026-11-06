/**
 * aiService.js — Ciancia Producciones
 * Client-side AI:
 *   1. Lectura de dorsales deportivos (SDK oficial @google/genai + Gemini Flash vigente)
 *   2. Reconocimiento Facial (@vladmandic/face-api con serialización plana para Firestore)
 */

import { GoogleGenAI } from '@google/genai';

/**
 * Convierte un File o Blob en base64 puro y su correspondiente MIME type para Gemini Vision.
 * Si la foto original supera 1600px, la escala suavemente en memoria a JPEG
 * para evitar payloads gigantes (HTTP 413) y acelerar la respuesta de la API.
 *
 * @param {File|Blob} file
 * @param {number} maxDimension
 * @returns {Promise<{ base64: string, mimeType: string }>}
 */
function fileToBase64(file, maxDimension = 1600) {
  return new Promise((resolve, reject) => {
    const rawMime = file.type || 'image/jpeg';

    if (!file.type || !file.type.startsWith('image/') || file.size < 400 * 1024) {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || '');
        const base64 = result.includes(',') ? result.split(',')[1] : result;
        resolve({ base64, mimeType: rawMime });
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
      return;
    }

    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      try {
        const nw = img.naturalWidth || img.width;
        const nh = img.naturalHeight || img.height;

        if (nw <= maxDimension && nh <= maxDimension && file.size < 1.2 * 1024 * 1024) {
          const reader = new FileReader();
          reader.onload = () => {
            const result = String(reader.result || '');
            const base64 = result.includes(',') ? result.split(',')[1] : result;
            resolve({ base64, mimeType: rawMime });
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
          return;
        }

        const scale = Math.min(1, maxDimension / Math.max(nw, nh));
        const w = Math.round(nw * scale);
        const h = Math.round(nh * scale);

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);

        const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
        const base64 = dataUrl.split(',')[1] || dataUrl;
        resolve({ base64, mimeType: 'image/jpeg' });
      } catch {
        const reader = new FileReader();
        reader.onload = () => {
          const result = String(reader.result || '');
          const base64 = result.includes(',') ? result.split(',')[1] : result;
          resolve({ base64, mimeType: rawMime });
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || '');
        const base64 = result.includes(',') ? result.split(',')[1] : result;
        resolve({ base64, mimeType: rawMime });
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    };
    img.src = url;
  });
}

/**
 * Obtiene la API Key de Google Gemini:
 * 1. Desde variables de entorno de Vite (import.meta.env.VITE_GEMINI_API_KEY)
 * 2. Fallback a localStorage ('ciancia_gemini_api_key') para pruebas en desarrollo
 */
function getGeminiApiKey() {
  try {
    const envKey = import.meta.env?.VITE_GEMINI_API_KEY;
    if (envKey && String(envKey).trim()) return String(envKey).trim();
    const localKey = localStorage.getItem('ciancia_gemini_api_key');
    if (localKey && localKey.trim()) return localKey.trim();
  } catch {
    // ignorar posibles restricciones de acceso a storage
  }
  return null;
}

const PROMPT_DORSALES = 'Extrae todos los números de dorsales/pecheras visibles en esta imagen de running y devuélvelos en un array JSON de strings puro, ejemplo: ["1442", "1341"]. Si no hay dorsales visibles, devuelve [].';

/**
 * Modelo ÚNICO y fijo (sin descubrimiento dinámico).
 * `gemini-flash-latest` es el alias oficial que Google mantiene apuntando al Flash
 * estable vigente. NO usar `gemini-1.5-flash` ni `gemini-pro`: fueron retirados y
 * devuelven 404 en v1 y v1beta. Override opcional con VITE_GEMINI_MODEL en Render.
 */
const GEMINI_MODEL = (import.meta.env?.VITE_GEMINI_MODEL && String(import.meta.env.VITE_GEMINI_MODEL).trim()) || 'gemini-flash-latest';
const GEMINI_TIMEOUT_MS = 10000;

let aiClient = null;
let aiClientKey = null;
// Si Gemini falla de forma permanente (404/400/401/403), se deshabilita para el resto
// de la sesión: se loguea UNA sola vez y las demás fotos no esperan nada.
let geminiDisabledReason = null;

function getAiClient(apiKey) {
  if (!aiClient || aiClientKey !== apiKey) {
    aiClient = new GoogleGenAI({ apiKey, apiVersion: 'v1beta' });
    aiClientKey = apiKey;
  }
  return aiClient;
}

/** Extrae el código HTTP de un error del SDK (si lo hay). */
function getErrorStatus(err) {
  if (typeof err?.status === 'number') return err.status;
  const m = String(err?.message || '').match(/\b(400|401|403|404|429|500|503)\b/);
  return m ? Number(m[1]) : undefined;
}

/** Arma un objeto de error descriptivo para diagnóstico en consola. */
function describeGeminiError(err, context = {}) {
  const status = getErrorStatus(err);
  const hints = {
    400: 'Solicitud inválida o API key con formato incorrecto. Revisá VITE_GEMINI_API_KEY.',
    401: 'API key inválida o no autorizada.',
    403: 'API key sin permisos o restringida por dominio. Agregá https://ciancia-producciones.onrender.com/* en las restricciones de la key (Google Cloud Console).',
    404: `El modelo "${GEMINI_MODEL}" no existe para esta key. Definí VITE_GEMINI_MODEL en Render con un modelo vigente (ej. gemini-2.5-flash).`,
    429: 'Cuota excedida (rate limit del plan gratuito).',
    500: 'Error interno de Google.',
    503: 'Servicio de Gemini sobrecargado.',
  };
  return {
    service: 'Gemini Vision (dorsales)',
    model: GEMINI_MODEL,
    status,
    hint: err?.name === 'TimeoutError'
      ? `Gemini no respondió en ${GEMINI_TIMEOUT_MS / 1000}s.`
      : hints[status] || (err instanceof TypeError ? 'Fallo de red / CORS / sin conexión.' : 'Ver mensaje original.'),
    message: String(err?.message || err || 'Error desconocido'),
    ...context,
  };
}

/** Rechaza la promesa si no resuelve dentro de `ms` (y aborta la petición). */
function withTimeout(promiseFactory, ms) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      const e = new Error(`Timeout de ${ms} ms esperando a Gemini`);
      e.name = 'TimeoutError';
      reject(e);
    }, ms);
  });
  return Promise.race([promiseFactory(controller.signal), timeout]).finally(() => clearTimeout(timer));
}

/** Extrae un array plano de dorsales limpios desde el texto devuelto por Gemini. */
export function parseDorsalsResponse(rawText) {
  const cleanedText = String(rawText || '')
    .replace(/```(?:json)?/gi, '')
    .trim();

  let parsed = [];
  try {
    parsed = JSON.parse(cleanedText || '[]');
  } catch {
    const match = cleanedText.match(/\[[\s\S]*?\]/);
    try {
      parsed = match ? JSON.parse(match[0]) : [];
    } catch {
      parsed = [];
    }
  }

  // Tolerar formatos { dorsales: [...] } o { dorsals: [...] }
  if (parsed && !Array.isArray(parsed) && typeof parsed === 'object') {
    parsed = parsed.dorsales || parsed.dorsals || parsed.numbers || [];
  }
  if (!Array.isArray(parsed)) return [];

  // Normalizar a strings de 1 a 5 dígitos, sin ceros puros, únicos
  return [...new Set(
    parsed
      .map(v => String(v ?? '').replace(/\D/g, '').trim())
      .filter(v => v.length >= 1 && v.length <= 5 && !/^0+$/.test(v))
  )];
}

/**
 * detectDorsalsFromFile(imageFile)
 * Una única llamada al SDK oficial @google/genai con timeout de 10 s.
 * NUNCA lanza ni cuelga: ante cualquier error devuelve [] de inmediato.
 *
 * @param {File|Blob} imageFile
 * @returns {Promise<string[]>}
 */
export async function detectDorsalsFromFile(imageFile) {
  if (geminiDisabledReason) return [];

  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    geminiDisabledReason = 'sin API key';
    console.warn('[aiService] VITE_GEMINI_API_KEY no configurada. Detección de dorsales deshabilitada.');
    return [];
  }

  try {
    const ai = getAiClient(apiKey);
    const { base64, mimeType } = await fileToBase64(imageFile);

    const response = await withTimeout(
      (abortSignal) => ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: [
          {
            role: 'user',
            parts: [
              { text: PROMPT_DORSALES },
              { inlineData: { mimeType: mimeType || 'image/jpeg', data: base64 } },
            ],
          },
        ],
        config: {
          temperature: 0.1,
          responseMimeType: 'application/json',
          abortSignal,
        },
      }),
      GEMINI_TIMEOUT_MS,
    );

    const dorsals = parseDorsalsResponse(response?.text ?? '');
    console.log(`[aiService] Gemini (${GEMINI_MODEL}) detectó ${dorsals.length} dorsal(es):`, dorsals);
    return dorsals;
  } catch (err) {
    const status = getErrorStatus(err);
    if ([400, 401, 403, 404].includes(status)) {
      // Error permanente: loguear una sola vez y no volver a intentar en esta sesión
      geminiDisabledReason = `HTTP ${status}`;
      console.error('[aiService] Gemini deshabilitado para esta sesión:', describeGeminiError(err, { file: imageFile?.name }));
    } else {
      console.error('[aiService] Error en detección de dorsales:', describeGeminiError(err, { file: imageFile?.name }));
    }
    return [];
  }
}

// ─── face-api ────────────────────────────────────────────────────────────────
const FACE_API_CDN = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/';

let faceapiModule = null;
let modelsLoaded = { admin: false, public: false };

/**
 * initFaceApi({ forAdmin })
 * Lazily loads face-api and the required models from CDN.
 * forAdmin=true loads full models (ssdMobilenetv1 — more accurate for group photos)
 * forAdmin=false loads tinyFaceDetector (faster for selfie matching)
 */
export async function initFaceApi({ forAdmin = false } = {}) {
  const key = forAdmin ? 'admin' : 'public';
  if (modelsLoaded[key] && faceapiModule) return faceapiModule;

  if (!faceapiModule) {
    faceapiModule = await import('@vladmandic/face-api');
    try {
      const isMobile = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
      if (isMobile) {
        // En móviles Android/iOS usamos el backend CPU seguro para evitar crashes de WebGL/GPU
        await faceapiModule.tf?.setBackend('cpu');
      } else {
        await faceapiModule.tf?.setBackend('webgl');
      }
      await faceapiModule.tf?.ready();
    } catch {
      try {
        await faceapiModule.tf?.setBackend('cpu');
        await faceapiModule.tf?.ready();
      } catch {
        // noop
      }
    }
  }

  const faceapi = faceapiModule;

  if (forAdmin) {
    await Promise.all([
      faceapi.nets.ssdMobilenetv1.loadFromUri(FACE_API_CDN),
      faceapi.nets.faceLandmark68Net.loadFromUri(FACE_API_CDN),
      faceapi.nets.faceRecognitionNet.loadFromUri(FACE_API_CDN),
    ]);
  } else {
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(FACE_API_CDN),
      faceapi.nets.faceLandmark68Net.loadFromUri(FACE_API_CDN),
      faceapi.nets.faceRecognitionNet.loadFromUri(FACE_API_CDN),
    ]);
  }

  modelsLoaded[key] = true;
  return faceapiModule;
}

/**
 * fileToHTMLImage(file) — helper to convert a File/Blob to HTMLImageElement
 * Revokes the temporary ObjectURL immediately on load/error to prevent memory leaks.
 */
function fileToHTMLImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Image load failed'));
    };
    img.src = url;
  });
}

/**
 * extractFaceDescriptors(imageFileOrElement, { forAdmin })
 * Detects ALL faces in the image and returns their descriptors as
 * Array<{ vector: number[] }> (128 numbers each).
 * Safe to store in Firestore (no Float32Array, no nested arrays).
 */
export async function extractFaceDescriptors(imageFileOrElement, { forAdmin = true } = {}) {
  try {
    const faceapi = await initFaceApi({ forAdmin });

    let input = imageFileOrElement;
    if (imageFileOrElement instanceof File || imageFileOrElement instanceof Blob) {
      input = await fileToHTMLImage(imageFileOrElement);
    }

    let detections;
    if (forAdmin) {
      detections = await faceapi
        .detectAllFaces(input, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.45 }))
        .withFaceLandmarks()
        .withFaceDescriptors();
    } else {
      detections = await faceapi
        .detectAllFaces(input, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.45 }))
        .withFaceLandmarks()
        .withFaceDescriptors();
    }

    // Firestore NO soporta arrays anidados (number[][]) → array de objetos planos
    return detections.map(d => ({ vector: Array.from(d.descriptor) }));
  } catch (err) {
    console.warn('[aiService] Face extraction failed:', err);
    return [];
  }
}

/**
 * extractSelfieDescriptor(imageFileOrElement)
 * Extracts a SINGLE descriptor from a selfie (the largest/best face detected).
 * Returns Float32Array | null
 */
export async function extractSelfieDescriptor(imageFileOrElement) {
  try {
    const faceapi = await initFaceApi({ forAdmin: false });

    let input = imageFileOrElement;
    if (imageFileOrElement instanceof File || imageFileOrElement instanceof Blob) {
      input = await fileToHTMLImage(imageFileOrElement);
    }

    const detection = await faceapi
      .detectSingleFace(input, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.4 }))
      .withFaceLandmarks()
      .withFaceDescriptor();

    if (!detection) return null;
    return detection.descriptor;
  } catch (err) {
    console.warn('[aiService] Selfie extraction failed:', err);
    return null;
  }
}

/**
 * Normaliza descriptores guardados en Firestore ({ vector: number[] } o formatos previos)
 */
export function normalizeDescriptors(faceDescriptors) {
  if (!Array.isArray(faceDescriptors) || faceDescriptors.length === 0) return [];
  if (typeof faceDescriptors[0] === 'number') {
    const out = [];
    for (let i = 0; i + 128 <= faceDescriptors.length; i += 128) {
      out.push(new Float32Array(faceDescriptors.slice(i, i + 128)));
    }
    return out;
  }
  return faceDescriptors
    .map(entry => {
      if (entry && Array.isArray(entry.vector)) return new Float32Array(entry.vector);
      if (Array.isArray(entry)) return new Float32Array(entry);
      if (typeof entry === 'string') {
        try { return new Float32Array(JSON.parse(entry)); } catch { return null; }
      }
      return null;
    })
    .filter(d => d && d.length === 128);
}

/**
 * matchFaceAgainstAlbum(selfieDescriptor, mediaItems, threshold)
 * Compares a selfie's Float32Array descriptor against all faceDescriptors in
 * the album media items.
 */
export async function matchFaceAgainstAlbum(selfieDescriptor, mediaItems, threshold = 0.55) {
  const faceapi = await initFaceApi({ forAdmin: false });
  const matchingIds = new Set();

  for (const item of mediaItems) {
    const descriptors = normalizeDescriptors(item.faceDescriptors);
    if (descriptors.length === 0) continue;
    for (const storedDescriptor of descriptors) {
      const distance = faceapi.euclideanDistance(selfieDescriptor, storedDescriptor);
      if (distance < threshold) {
        matchingIds.add(item.id);
        break;
      }
    }
  }

  return matchingIds;
}

// ─── Análisis combinado (cola serializada) ───────────────────────────────────
let analysisChain = Promise.resolve();

/**
 * analyzeImageFile(file) → Promise<{ dorsals: string[], faceDescriptors: {vector:number[]}[] }>
 */
const FACE_TIMEOUT_MS = 45000;

/** Resuelve con `fallback` si la promesa no termina a tiempo o falla (nunca rechaza). */
function settleWithin(promise, ms, fallback, label) {
  let timer;
  const timeout = new Promise(resolve => {
    timer = setTimeout(() => {
      console.warn(`[aiService] ${label} superó ${ms / 1000}s. Se continúa sin ese dato.`);
      resolve(fallback);
    }, ms);
  });
  return Promise.race([Promise.resolve(promise).catch(() => fallback), timeout]).finally(() => clearTimeout(timer));
}

export function analyzeImageFile(file) {
  const run = async () => {
    // Fail-safe: ninguna de las dos tareas puede trabar la cola de subida
    const [dorsals, faceDescriptors] = await Promise.all([
      settleWithin(detectDorsalsFromFile(file), GEMINI_TIMEOUT_MS + 2000, [], 'Detección de dorsales'),
      settleWithin(extractFaceDescriptors(file, { forAdmin: true }), FACE_TIMEOUT_MS, [], 'Detección de rostros'),
    ]);
    return { dorsals, faceDescriptors };
  };
  const result = analysisChain.then(run, run);
  analysisChain = result.catch(() => {});
  return result;
}
