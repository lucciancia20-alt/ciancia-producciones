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
 * 1. VITE_GEMINI_API_KEY (admite una key o varias separadas por coma)
 * 2. VITE_GEMINI_API_KEY_BACKUP (opcional: segunda key de respaldo)
 * 3. localStorage ('ciancia_gemini_api_key')
 */
function getGeminiApiKeys() {
  const keys = [];
  try {
    const envMain = import.meta.env?.VITE_GEMINI_API_KEY;
    if (envMain) {
      String(envMain).split(',').map(k => k.trim()).filter(Boolean).forEach(k => keys.push(k));
    }
    const envBackup = import.meta.env?.VITE_GEMINI_API_KEY_BACKUP;
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

/**
 * Pool de modelos alternativos en v1beta con servidores independientes.
 * Si el primero está saturado (503), sin cuota (429) o demora (>8s), el sistema
 * conmuta automáticamente al siguiente modelo en el acto sin perder la foto.
 */
const DEFAULT_MODEL_POOL = [
  'gemini-flash-latest',
  'gemini-flash-lite-latest',
  'gemini-2.0-flash',
  'gemini-pro-latest',
];

function getModelPool() {
  const custom = import.meta.env?.VITE_GEMINI_MODEL && String(import.meta.env.VITE_GEMINI_MODEL).trim();
  return custom ? [...new Set([custom, ...DEFAULT_MODEL_POOL])] : DEFAULT_MODEL_POOL;
}

const GEMINI_TIMEOUT_MS = 8500; // timeout ágil por intento para conmutar rápido al backup
const COOLDOWN_MS       = 60000; // 60s de enfriamiento para un modelo que dio 503/429/timeout

const aiClients = new Map();
const deadModels = new Set();        // modelos con 404 permanente
const deadKeys   = new Set();        // keys con 400/401/403
const modelCooldownUntil = new Map(); // model -> timestamp hasta cuando evitarlo por 503/429

function getAiClient(apiKey) {
  if (!aiClients.has(apiKey)) {
    aiClients.set(apiKey, new GoogleGenAI({ apiKey, apiVersion: 'v1beta' }));
  }
  return aiClients.get(apiKey);
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
    403: 'API key sin permisos o restringida por dominio.',
    404: 'El modelo consultado no está habilitado para esta key.',
    429: 'Cuota excedida (rate limit). Conmutando a respaldo.',
    500: 'Error interno de Google. Conmutando a respaldo.',
    503: 'Modelo sobrecargado en Google (503). Conmutando automáticamente a modelo alternativo.',
  };
  return {
    service: 'Gemini Vision (dorsales)',
    status,
    hint: err?.name === 'TimeoutError'
      ? `Tiempo agotado (${GEMINI_TIMEOUT_MS / 1000}s). Conmutando a modelo alternativo.`
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
 * Conmutación automática (failover) entre varios modelos de Gemini (y API keys si hay más de una).
 * Si el modelo principal devuelve 503 (saturado), 429 (cuota), 404 o timeout, salta en el acto
 * al modelo alternativo (ej. gemini-flash-lite-latest -> gemini-2.0-flash -> gemini-pro-latest)
 * y recuerda cuál está funcionando para no demorar las fotos siguientes.
 *
 * @param {File|Blob} imageFile
 * @returns {Promise<string[]>}
 */
export async function detectDorsalsFromFile(imageFile) {
  const allKeys = getGeminiApiKeys().filter(k => !deadKeys.has(k));
  if (allKeys.length === 0) {
    return [];
  }

  let base64Data;
  try {
    base64Data = await fileToBase64(imageFile);
  } catch (err) {
    console.warn('[aiService] No se pudo procesar la imagen para OCR:', err);
    return [];
  }

  const { base64, mimeType } = base64Data;
  const now = Date.now();
  const candidates = getModelPool().filter(m => !deadModels.has(m));
  if (candidates.length === 0) return [];

  // Priorizar modelos que NO estén en enfriamiento por 503/429 reciente
  const activeModels = [
    ...candidates.filter(m => (modelCooldownUntil.get(m) || 0) <= now),
    ...candidates.filter(m => (modelCooldownUntil.get(m) || 0) > now),
  ];

  // Probamos hasta 3 combinaciones rápidas (modelo / key) para no superar el límite de tiempo
  const maxAttempts = Math.min(3, activeModels.length);
  let lastError = null;

  for (let i = 0; i < maxAttempts; i++) {
    const model = activeModels[i];
    const apiKey = allKeys[i % allKeys.length];
    const ai = getAiClient(apiKey);

    try {
      const config = {
        temperature: 0.1,
        maxOutputTokens: 200,
        responseMimeType: 'application/json',
      };
      // thinkingConfig aplica a modelos 2.5 / flash-latest
      if (model.includes('flash-latest') || model.includes('2.5')) {
        config.thinkingConfig = { thinkingBudget: 0 };
      }

      const response = await withTimeout(
        (abortSignal) => ai.models.generateContent({
          model,
          contents: [
            {
              role: 'user',
              parts: [
                { text: PROMPT_DORSALES },
                { inlineData: { mimeType: mimeType || 'image/jpeg', data: base64 } },
              ],
            },
          ],
          config: { ...config, abortSignal },
        }),
        GEMINI_TIMEOUT_MS,
      );

      // Éxito: limpiamos cualquier cooldown previo de este modelo
      modelCooldownUntil.delete(model);
      const dorsals = parseDorsalsResponse(response?.text ?? '');
      console.log(`[aiService] Gemini (${model}) detectó ${dorsals.length} dorsal(es):`, dorsals);
      return dorsals;
    } catch (err) {
      lastError = { err, model };
      const status = getErrorStatus(err);

      if (status === 404) {
        deadModels.add(model);
        console.warn(`[aiService] Modelo "${model}" no disponible (404). Saltando a alternativo...`);
        continue;
      }

      if (status === 401 || status === 403) {
        deadKeys.add(apiKey);
        console.warn('[aiService] API key rechazada, probando clave alternativa si existe...');
        continue;
      }

      // 503 (Saturado), 429 (Rate limit), 500 o Timeout -> enfriar este modelo 60s y pasar al alternativo
      modelCooldownUntil.set(model, Date.now() + COOLDOWN_MS);
      const nextModel = activeModels[i + 1];
      if (nextModel && i + 1 < maxAttempts) {
        console.warn(`[aiService] "${model}" saturado o lento (${status || 'timeout'}). Cambiando automáticamente a "${nextModel}"...`);
      }
    }
  }

  if (lastError) {
    console.error('[aiService] Todos los modelos intentados fallaron para esta foto:', describeGeminiError(lastError.err, {
      model: lastError.model,
      file: imageFile?.name,
    }));
  }
  return [];
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
    // Tope global para toda la cadena de failover de dorsales (máx 25s entre todos los intentos)
    const dorsals = await settleWithin(detectDorsalsFromFile(file), GEMINI_TIMEOUT_MS * 3 + 2000, [], 'Detección de dorsales');
    const faceDescriptors = await settleWithin(extractFaceDescriptors(file, { forAdmin: true }), FACE_TIMEOUT_MS, [], 'Detección de rostros');
    return { dorsals, faceDescriptors };
  };
  const result = analysisChain.then(run, run);
  analysisChain = result.catch(() => {});
  return result;
}
