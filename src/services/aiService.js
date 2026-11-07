/**
 * aiService.js — Ciancia Producciones
 * Client-side AI:
 *   1. Lectura de dorsales deportivos (SDK oficial @google/genai en endpoint estable v1)
 *      con cola secuencial (1 por vez), pausa de 3.5s (Rate Limit Throttling) y
 *      máximo 1 reintento limpio con la API Key de respaldo tras 4s de backoff.
 *   2. Reconocimiento Facial (@vladmandic/face-api con serialización plana para Firestore)
 */

import { GoogleGenAI } from '@google/genai';

/**
 * Convierte un File o Blob en base64 puro y su correspondiente MIME type para Gemini Vision.
 * Escala imágenes grandes en memoria a máx 1280px JPEG (calidad 0.85) para respuestas rápidas.
 *
 * @param {File|Blob} file
 * @param {number} maxDimension
 * @returns {Promise<{ base64: string, mimeType: string }>}
 */
function fileToBase64(file, maxDimension = 1280) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type || !file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || '');
        const base64 = result.includes(',') ? result.split(',')[1] : result;
        resolve({ base64, mimeType: file?.type || 'image/jpeg' });
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
        const scale = Math.min(1, maxDimension / Math.max(nw, nh));
        const w = Math.max(1, Math.round(nw * scale));
        const h = Math.max(1, Math.round(nh * scale));

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);

        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        const base64 = dataUrl.split(',')[1] || dataUrl;
        resolve({ base64, mimeType: 'image/jpeg' });
      } catch {
        const reader = new FileReader();
        reader.onload = () => {
          const result = String(reader.result || '');
          const base64 = result.includes(',') ? result.split(',')[1] : result;
          resolve({ base64, mimeType: 'image/jpeg' });
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
        resolve({ base64, mimeType: 'image/jpeg' });
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    };
    img.src = url;
  });
}

/**
 * Obtiene la lista de API Keys de Google Gemini disponibles:
 * 1. VITE_GEMINI_API_KEY (principal)
 * 2. VITE_GEMINI_API_KEY_BACKUP (respaldo)
 * 3. localStorage ('ciancia_gemini_api_key')
 */
function getGeminiApiKeys() {
  const keys = [];
  try {
    const envMain = import.meta.env.VITE_GEMINI_API_KEY;
    if (envMain) {
      String(envMain).split(',').map(k => k.trim()).filter(Boolean).forEach(k => keys.push(k));
    }
    const envBackup = import.meta.env.VITE_GEMINI_API_KEY_BACKUP;
    if (envBackup && String(envBackup).trim()) {
      keys.push(String(envBackup).trim());
    }
    const localKey = localStorage.getItem('ciancia_gemini_api_key');
    if (localKey && localKey.trim()) {
      keys.push(localKey.trim());
    }
  } catch {
    // ignorar restricciones de storage
  }
  return [...new Set(keys)];
}

const PROMPT_DORSALES = 'Extrae todos los números de dorsales/pecheras visibles en esta imagen de running y devuélvelos en un array JSON de strings puro, ejemplo: ["1442", "1341"]. Si no hay dorsales visibles, devuelve [].';

// Único modelo directo y ultra-rápido habilitado en el endpoint oficial v1 de Google AI Studio (~1.4s por foto, sin 404)
const GEMINI_MODEL       = 'gemini-3.5-flash-lite';
const GEMINI_API_VERSION = 'v1';
const GEMINI_TIMEOUT_MS  = 10000; // Timeout estricto de 10 segundos por petición
const THROTTLE_DELAY_MS  = 3500;  // Pausa mínima de 3.5s entre llamadas para no exceder jamás el límite RPM gratuito
const BACKOFF_429_MS     = 4500;  // Espera de 4.5s antes de hacer el único reintento con la API Key de respaldo

const aiClients = new Map();
let preferredKeyIndex = 0;
let lastGeminiCallEnd = 0;

function getAiClient(apiKey) {
  if (!aiClients.has(apiKey)) {
    aiClients.set(apiKey, new GoogleGenAI({ apiKey, apiVersion: GEMINI_API_VERSION }));
  }
  return aiClients.get(apiKey);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Garantiza al menos `minDelayMs` entre el fin de una llamada a Gemini y el inicio de la siguiente. */
async function waitRateLimitSlot(minDelayMs = THROTTLE_DELAY_MS) {
  const elapsed = Date.now() - lastGeminiCallEnd;
  if (lastGeminiCallEnd > 0 && elapsed < minDelayMs) {
    await sleep(minDelayMs - elapsed);
  }
}

/** Extrae el código HTTP de un error del SDK (si lo hay). */
function getErrorStatus(err) {
  if (typeof err?.status === 'number') return err.status;
  const m = String(err?.message || '').match(/\b(400|401|403|404|429|500|503)\b/);
  return m ? Number(m[1]) : undefined;
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

  if (parsed && !Array.isArray(parsed) && typeof parsed === 'object') {
    parsed = parsed.dorsales || parsed.dorsals || parsed.numbers || [];
  }
  if (!Array.isArray(parsed)) return [];

  return [...new Set(
    parsed
      .map(v => String(v ?? '').replace(/\D/g, '').trim())
      .filter(v => v.length >= 1 && v.length <= 5 && !/^0+$/.test(v))
  )];
}

/**
 * Ejecuta una única consulta al endpoint v1 con una API Key específica.
 */
async function callGeminiOnce(apiKey, base64, mimeType) {
  const ai = getAiClient(apiKey);
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
        maxOutputTokens: 150,
        abortSignal,
      },
    }),
    GEMINI_TIMEOUT_MS,
  );
  return parseDorsalsResponse(response?.text ?? '');
}

/**
 * detectDorsalsFromFile(imageFile)
 * - Respeta una pausa obligatoria (THROTTLE_DELAY_MS = 3.5s) antes de consultar a Gemini.
 * - Intenta con la API Key activa.
 * - Si falla (429, 503, 404 o timeout) y existe una 2da API Key de respaldo,
 *   espera 4.5s (backoff), rota a la clave de respaldo y realiza UN ÚNICO reintento limpio.
 * - Si vuelve a fallar, registra el aviso una sola vez y retorna `[]` sin bloquear la subida.
 *
 * @param {File|Blob} imageFile
 * @returns {Promise<string[]>}
 */
export async function detectDorsalsFromFile(imageFile) {
  try {
    const keys = getGeminiApiKeys();
    if (keys.length === 0) {
      return [];
    }

    const { base64, mimeType } = await fileToBase64(imageFile);

    // Pausa obligatoria entre fotos para respetar el límite por minuto (RPM) de la capa gratuita
    await waitRateLimitSlot(THROTTLE_DELAY_MS);

    const primaryIdx = preferredKeyIndex % keys.length;
    const primaryKey = keys[primaryIdx];

    try {
      const dorsals = await callGeminiOnce(primaryKey, base64, mimeType);
      lastGeminiCallEnd = Date.now();
      // Alternar suavemente entre las claves disponibles en la próxima foto
      if (keys.length > 1) {
        preferredKeyIndex = (primaryIdx + 1) % keys.length;
      }
      console.log(`[aiService] Gemini (${GEMINI_MODEL}) [Key #${primaryIdx + 1}] detectó ${dorsals.length} dorsal(es):`, dorsals);
      return dorsals;
    } catch (firstErr) {
      lastGeminiCallEnd = Date.now();
      const status = getErrorStatus(firstErr);

      // Si hay una segunda API Key de respaldo, hacemos MÁXIMO 1 reintento tras un backoff de 4.5s
      if (keys.length > 1) {
        const backupIdx = (primaryIdx + 1) % keys.length;
        const backupKey = keys[backupIdx];
        preferredKeyIndex = backupIdx;

        console.warn(
          `[aiService] Aviso en Key #${primaryIdx + 1} (${status || firstErr?.name || 'error'}). Esperando ${BACKOFF_429_MS / 1000}s para 1 reintento con Key #${backupIdx + 1}...`
        );
        await sleep(BACKOFF_429_MS);

        try {
          const dorsals = await callGeminiOnce(backupKey, base64, mimeType);
          lastGeminiCallEnd = Date.now();
          console.log(`[aiService] Gemini (${GEMINI_MODEL}) [Key #${backupIdx + 1} respaldo] detectó ${dorsals.length} dorsal(es):`, dorsals);
          return dorsals;
        } catch (retryErr) {
          lastGeminiCallEnd = Date.now();
          console.warn(
            `[aiService] IA omitida para "${imageFile?.name || 'imagen'}" tras reintento (${getErrorStatus(retryErr) || retryErr?.name || 'error'}). La foto puede subirse normalmente.`
          );
          return [];
        }
      }

      console.warn(
        `[aiService] IA omitida para "${imageFile?.name || 'imagen'}" (${status || firstErr?.name || 'error'}). La foto puede subirse normalmente.`
      );
      return [];
    }
  } catch (unexpectedErr) {
    console.warn('[aiService] Error inesperado en lectura de dorsales (fail-safe []):', unexpectedErr?.message || unexpectedErr);
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
 */
export async function initFaceApi({ forAdmin = false } = {}) {
  const key = forAdmin ? 'admin' : 'public';
  if (modelsLoaded[key] && faceapiModule) return faceapiModule;

  if (!faceapiModule) {
    faceapiModule = await import('@vladmandic/face-api');
    try {
      const isMobile = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
      if (isMobile) {
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

    return detections.map(d => ({ vector: Array.from(d.descriptor) }));
  } catch (err) {
    console.warn('[aiService] Face extraction failed:', err);
    return [];
  }
}

/**
 * extractSelfieDescriptor(imageFileOrElement)
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

// ─── Cola estrictamente secuencial (1 foto por vez) con Fail-Safe ─────────────
let sequentialQueue = Promise.resolve();
const FACE_TIMEOUT_MS = 25000;

/** Resuelve con `fallback` si la promesa no termina a tiempo o falla (nunca rechaza). */
function settleWithin(promise, ms, fallback, label) {
  let timer;
  const timeout = new Promise(resolve => {
    timer = setTimeout(() => {
      console.warn(`[aiService] ${label} superó ${ms / 1000}s. Se continúa con [].`);
      resolve(fallback);
    }, ms);
  });
  return Promise.race([Promise.resolve(promise).catch(() => fallback), timeout]).finally(() => clearTimeout(timer));
}

export function analyzeImageFile(file, { shouldCancel } = {}) {
  const run = async () => {
    try {
      if (typeof shouldCancel === 'function' && shouldCancel()) {
        return { dorsals: [], faceDescriptors: [], cancelled: true };
      }
      // Tope máximo de seguridad: 26s (cubre el intento inicial + backoff de 4.5s + 1 reintento)
      const dorsals = await settleWithin(detectDorsalsFromFile(file), 26000, [], 'Detección de dorsales');
      if (typeof shouldCancel === 'function' && shouldCancel()) {
        return { dorsals, faceDescriptors: [], cancelled: true };
      }
      const faceDescriptors = await settleWithin(extractFaceDescriptors(file, { forAdmin: true }), FACE_TIMEOUT_MS, [], 'Detección de rostros');
      return { dorsals: Array.isArray(dorsals) ? dorsals : [], faceDescriptors: Array.isArray(faceDescriptors) ? faceDescriptors : [] };
    } catch {
      return { dorsals: [], faceDescriptors: [] };
    }
  };

  // Encolado 100% secuencial (una foto tras otra) para nunca disparar ráfagas simultáneas a Gemini
  const result = sequentialQueue.then(run, run);
  sequentialQueue = result.catch(() => {});
  return result;
}
