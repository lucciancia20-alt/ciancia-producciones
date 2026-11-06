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
 * Modelos preferidos, en orden. `gemini-flash-latest` es el alias oficial que Google
 * mantiene apuntando siempre al Flash estable vigente, por eso va primero.
 * NOTA: gemini-1.5-flash y gemini-1.5-pro fueron RETIRADOS por Google; cualquier
 * llamada a ellos devuelve 404 "not found for API version v1/v1beta". Esa era la
 * causa real del error en producción (no los headers ni el payload).
 */
const PREFERRED_MODELS = [
  'gemini-flash-latest',
  'gemini-2.5-flash',
  'gemini-flash-lite-latest',
  'gemini-2.5-flash-lite',
];

let aiClient = null;
let aiClientKey = null;
let resolvedModelPromise = null;
const failedModels = new Set();

function getAiClient(apiKey) {
  if (!aiClient || aiClientKey !== apiKey) {
    aiClient = new GoogleGenAI({ apiKey });
    aiClientKey = apiKey;
    resolvedModelPromise = null;
  }
  return aiClient;
}

/** Arma un objeto de error descriptivo para diagnóstico en consola. */
function describeGeminiError(err, context = {}) {
  const message = String(err?.message || err || 'Error desconocido');
  const statusMatch = message.match(/\b(400|401|403|404|429|500|503)\b/);
  const status = err?.status ?? (statusMatch ? Number(statusMatch[1]) : undefined);
  const hints = {
    400: 'Solicitud inválida o API key con formato incorrecto. Revisá VITE_GEMINI_API_KEY.',
    401: 'API key inválida o no autorizada.',
    403: 'API key sin permisos para Generative Language API o restringida por dominio/referrer (agregá ciancia-producciones.onrender.com en Google Cloud Console).',
    404: 'El modelo no existe o fue retirado para esta API key.',
    429: 'Cuota excedida (rate limit del plan gratuito). Reintentar en unos segundos.',
    500: 'Error interno de Google. Reintentar.',
    503: 'Servicio de Gemini sobrecargado. Reintentar.',
  };
  return {
    service: 'Gemini Vision (dorsales)',
    status,
    hint: hints[status] || (err instanceof TypeError ? 'Fallo de red / CORS / sin conexión.' : 'Ver mensaje original.'),
    message,
    ...context,
  };
}

/**
 * Descubre (una sola vez por sesión) qué modelo Flash está realmente disponible
 * para la API key, consultando ListModels mediante el SDK oficial.
 * Permite override manual con VITE_GEMINI_MODEL.
 */
async function resolveGeminiModel(ai) {
  const override = import.meta.env?.VITE_GEMINI_MODEL;
  if (override && String(override).trim()) return String(override).trim();

  if (!resolvedModelPromise) {
    resolvedModelPromise = (async () => {
      const available = [];
      try {
        const pager = await ai.models.list({ config: { pageSize: 100 } });
        for await (const m of pager) {
          const name = String(m?.name || '').replace(/^models\//, '');
          const actions = m?.supportedActions || [];
          if (!name.startsWith('gemini')) continue;
          if (actions.length && !actions.includes('generateContent')) continue;
          if (failedModels.has(name)) continue;
          available.push(name);
        }
      } catch (err) {
        console.error('[aiService] No se pudo listar modelos de Gemini:', describeGeminiError(err, { step: 'models.list' }));
        return PREFERRED_MODELS.find(p => !failedModels.has(p)) || PREFERRED_MODELS[0];
      }

      const preferred = PREFERRED_MODELS.find(p => available.includes(p));
      if (preferred) return preferred;

      // Cualquier Flash estable con visión (sin exp/preview/tts/image/live/embedding)
      const stableFlash = available
        .filter(n => n.includes('flash') && !/(exp|preview|tts|image|live|audio|embedding|thinking)/i.test(n))
        .sort()
        .reverse();
      if (stableFlash.length) return stableFlash[0];

      console.warn('[aiService] Ningún modelo Flash estable disponible. Modelos visibles para la key:', available);
      return available[0] || PREFERRED_MODELS[0];
    })();
  }
  const model = await resolvedModelPromise;
  return model;
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
 * Extrae números de dorsales de una foto deportiva usando el SDK oficial @google/genai.
 * Ante cualquier error (red, auth, cuota, formato) imprime un diagnóstico detallado
 * y devuelve [] para no romper la cola de subida.
 *
 * @param {File|Blob} imageFile
 * @returns {Promise<string[]>}
 */
export async function detectDorsalsFromFile(imageFile) {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    console.warn('[aiService] VITE_GEMINI_API_KEY no configurada. Omitiendo detección automática de dorsales.');
    return [];
  }

  let model = null;
  try {
    const ai = getAiClient(apiKey);
    const { base64, mimeType } = await fileToBase64(imageFile);
    model = await resolveGeminiModel(ai);

    const request = {
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
      config: {
        temperature: 0.1,
        responseMimeType: 'application/json',
      },
    };

    let response;
    try {
      response = await ai.models.generateContent(request);
    } catch (err) {
      // Si el modelo cacheado dejó de existir (404), redescubrir una vez y reintentar
      if (describeGeminiError(err).status === 404 && !import.meta.env?.VITE_GEMINI_MODEL) {
        console.warn(`[aiService] Modelo "${model}" no disponible (404). Redescubriendo modelos...`);
        failedModels.add(model);
        resolvedModelPromise = null;
        model = await resolveGeminiModel(ai);
        response = await ai.models.generateContent({ ...request, model });
      } else {
        throw err;
      }
    }

    const rawText = response?.text ?? '';
    if (!rawText) {
      console.warn('[aiService] Gemini respondió sin texto.', {
        model,
        finishReason: response?.candidates?.[0]?.finishReason,
        promptFeedback: response?.promptFeedback,
      });
      return [];
    }

    const dorsals = parseDorsalsResponse(rawText);
    console.log(`[aiService] Gemini (${model}) detectó ${dorsals.length} dorsal(es):`, dorsals);
    return dorsals;
  } catch (err) {
    console.error('[aiService] Error en detección de dorsales:', describeGeminiError(err, { model, file: imageFile?.name }));
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
export function analyzeImageFile(file) {
  const run = async () => {
    const [dorsals, faceDescriptors] = await Promise.all([
      detectDorsalsFromFile(file),
      extractFaceDescriptors(file, { forAdmin: true }),
    ]);
    return { dorsals, faceDescriptors };
  };
  const result = analysisChain.then(run, run);
  analysisChain = result.catch(() => {});
  return result;
}
