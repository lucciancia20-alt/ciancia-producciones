/**
 * aiService.js — Ciancia Producciones
 * Client-side AI (ejecutado ÚNICAMENTE al subir fotos en el Panel Admin):
 *   1. Extracción unificada de Dorsales (`bibs`) + Atributos Visuales de Ciclismo/Running
 *      (`helmetColors`, `bikeColors`, `jerseyColors`) en una sola llamada de visión.
 *      Soporta Groq Vision (`VITE_GROQ_API_KEY` con `llama-3.2-11b-vision-preview` /
 *      `llama-3.2-90b-vision-preview`) y Google Gemini (`VITE_GEMINI_API_KEY`) como
 *      motor principal o de respaldo, con cola estrictamente secuencial (1 petición cada 3s)
 *      para no disparar nunca el error 429.
 *   2. Reconocimiento Facial (@vladmandic/face-api con serialización plana para Firestore)
 */

import { GoogleGenAI } from '@google/genai';
import {
  VISUAL_COLOR_PALETTE,
  ALLOWED_VISUAL_COLORS,
  VISUAL_COLOR_MAP,
  normalizeSingleColor,
  normalizeColorList,
} from '../constants/visualColors';

export {
  VISUAL_COLOR_PALETTE,
  ALLOWED_VISUAL_COLORS,
  VISUAL_COLOR_MAP,
  normalizeSingleColor,
  normalizeColorList,
};

/**
 * Convierte un File o Blob en base64 puro y su correspondiente MIME type.
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
 * Obtiene la lista de API Keys de Groq Vision disponibles:
 * 1. VITE_GROQ_API_KEY
 * 2. localStorage ('ciancia_groq_api_key')
 */
function getGroqApiKeys() {
  const keys = [];
  try {
    const envGroq = import.meta.env.VITE_GROQ_API_KEY;
    if (envGroq) {
      String(envGroq).split(',').map(k => k.trim()).filter(Boolean).forEach(k => keys.push(k));
    }
    const localKey = localStorage.getItem('ciancia_groq_api_key');
    if (localKey && localKey.trim()) {
      keys.push(localKey.trim());
    }
  } catch {
    // ignorar restricciones de storage
  }
  return [...new Set(keys)];
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

const PROMPT_VISUAL_ATTRIBUTES = `Analiza esta fotografía deportiva (ciclismo, MTB, running o trail) y devuelve ÚNICAMENTE un objeto JSON estricto con todos los atributos detectados en la imagen, sin texto adicional ni bloques markdown:
{
  "bibs": ["104", "256"],
  "helmetColors": ["blanco", "negro"],
  "bikeColors": ["rojo", "negro"],
  "jerseyColors": ["azul", "amarillo"],
  "hasVisibleFace": false
}
Reglas estrictas:
1. "bibs": array de strings con los números de dorsal, pechera o placa de bicicleta visibles. Si no hay números visibles, devuelve [].
2. "helmetColors": colores dominantes de los cascos de los deportistas visibles. Si no usan casco, devuelve [].
3. "bikeColors": colores dominantes del cuadro de las bicicletas visibles. Si no hay bicicletas, devuelve [].
4. "jerseyColors": colores dominantes de las remeras, camisetas o maillots de los deportistas visibles. Si no hay deportistas, devuelve [].
5. "hasVisibleFace": booleano (true o false). Debe ser false si las personas en la foto llevan casco y gafas/lentes que cubren los rasgos faciales, casco integral, están agachadas sobre el manubrio ocultando la cara, de espaldas o demasiado lejos para distinguir un rostro. Solo debe ser true si hay al menos un rostro descubierto y claramente identificable para reconocimiento facial.
6. Usa EXCLUSIVAMENTE colores de esta paleta estándar en español: "blanco", "negro", "gris", "rojo", "azul", "celeste", "verde", "amarillo", "naranja", "rosa", "violeta", "fluor".`;

// Modelos de visión para Groq y Gemini
const GROQ_VISION_MODELS = [
  'llama-3.2-11b-vision-preview',
  'llama-3.2-90b-vision-preview',
  'meta-llama/llama-4-scout-17b-16e-instruct',
];
const GEMINI_MODEL       = 'gemini-3.5-flash-lite';
const GEMINI_API_VERSION = 'v1';
const VISION_TIMEOUT_MS  = 12000; // Timeout estricto de 12 segundos por petición
const THROTTLE_DELAY_MS  = 3000;  // Cola secuencial: 1 petición cada 3 segundos para nunca disparar error 429
const BACKOFF_429_MS     = 4000;  // Espera de 4s antes de reintentar con motor/clave de respaldo

const aiClients = new Map();
let preferredGeminiKeyIndex = 0;
let preferredGroqModelIndex = 0;
let lastVisionCallEnd = 0;

function getAiClient(apiKey) {
  if (!aiClients.has(apiKey)) {
    aiClients.set(apiKey, new GoogleGenAI({ apiKey, apiVersion: GEMINI_API_VERSION }));
  }
  return aiClients.get(apiKey);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Garantiza al menos `minDelayMs` (3s) entre el fin de una llamada de visión y el inicio de la siguiente. */
async function waitRateLimitSlot(minDelayMs = THROTTLE_DELAY_MS) {
  const elapsed = Date.now() - lastVisionCallEnd;
  if (lastVisionCallEnd > 0 && elapsed < minDelayMs) {
    await sleep(minDelayMs - elapsed);
  }
}

/** Extrae el código HTTP de un error (si lo hay). */
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
      const e = new Error(`Timeout de ${ms} ms esperando al motor de visión`);
      e.name = 'TimeoutError';
      reject(e);
    }, ms);
  });
  return Promise.race([promiseFactory(controller.signal), timeout]).finally(() => clearTimeout(timer));
}

function cleanBibsList(rawBibs) {
  if (!Array.isArray(rawBibs)) return [];
  return [...new Set(
    rawBibs
      .map(v => String(v ?? '').replace(/\D/g, '').trim())
      .filter(v => v.length >= 1 && v.length <= 5 && !/^0+$/.test(v))
  )];
}

/**
 * Extrae el JSON estructurado `{ bibs, dorsals, helmetColors, bikeColors, jerseyColors, hasVisibleFace }`
 * desde la respuesta de texto de Groq Vision o Gemini Vision.
 */
export function parseVisualAttributesResponse(rawText) {
  const empty = { bibs: [], dorsals: [], helmetColors: [], bikeColors: [], jerseyColors: [], hasVisibleFace: true };
  const cleanedText = String(rawText || '')
    .replace(/```(?:json)?/gi, '')
    .trim();

  if (!cleanedText) return empty;

  let parsed = null;
  try {
    parsed = JSON.parse(cleanedText);
  } catch {
    const objMatch = cleanedText.match(/\{[\s\S]*\}/);
    if (objMatch) {
      try {
        parsed = JSON.parse(objMatch[0]);
      } catch {
        parsed = null;
      }
    }
    if (!parsed) {
      const arrMatch = cleanedText.match(/\[[\s\S]*?\]/);
      if (arrMatch) {
        try {
          parsed = JSON.parse(arrMatch[0]);
        } catch {
          parsed = null;
        }
      }
    }
  }

  if (!parsed) return empty;

  if (Array.isArray(parsed)) {
    const bibs = cleanBibsList(parsed);
    return { bibs, dorsals: bibs, helmetColors: [], bikeColors: [], jerseyColors: [], hasVisibleFace: true };
  }

  if (typeof parsed === 'object') {
    const rawBibs = parsed.bibs || parsed.dorsales || parsed.dorsals || parsed.numbers || [];
    const bibs = cleanBibsList(rawBibs);
    const helmetColors = normalizeColorList(parsed.helmetColors || parsed.casco || parsed.cascos || []);
    const bikeColors = normalizeColorList(parsed.bikeColors || parsed.bici || parsed.bicicleta || parsed.bicicletas || []);
    const jerseyColors = normalizeColorList(parsed.jerseyColors || parsed.remera || parsed.maillot || parsed.ropa || []);

    let hasVisibleFace = true;
    if (typeof parsed.hasVisibleFace === 'boolean') {
      hasVisibleFace = parsed.hasVisibleFace;
    } else if (typeof parsed.hasVisibleFace === 'string') {
      hasVisibleFace = parsed.hasVisibleFace.toLowerCase().trim() !== 'false';
    } else if (helmetColors.length > 0 && bikeColors.length > 0) {
      hasVisibleFace = false;
    }

    return {
      bibs,
      dorsals: bibs,
      helmetColors,
      bikeColors,
      jerseyColors,
      hasVisibleFace,
    };
  }

  return empty;
}

/** Retrocompatibilidad: devuelve solo el array de dorsales desde el texto crudo. */
export function parseDorsalsResponse(rawText) {
  return parseVisualAttributesResponse(rawText).bibs;
}

/**
 * Ejecuta una consulta a Groq Vision (`llama-3.2-11b-vision-preview` / `llama-3.2-90b-vision-preview`
 * con fallback automático si el modelo preview fue actualizado en el endpoint de Groq).
 */
async function callGroqVisionOnce(apiKey, base64, mimeType) {
  const customModel = import.meta.env.VITE_GROQ_MODEL;
  const modelsToTry = customModel
    ? [String(customModel).trim(), ...GROQ_VISION_MODELS]
    : [
        GROQ_VISION_MODELS[preferredGroqModelIndex % GROQ_VISION_MODELS.length],
        ...GROQ_VISION_MODELS.filter((_, i) => i !== (preferredGroqModelIndex % GROQ_VISION_MODELS.length)),
      ];

  const uniqueModels = [...new Set(modelsToTry)];
  let lastError = null;

  for (let i = 0; i < uniqueModels.length; i++) {
    const model = uniqueModels[i];
    try {
      const data = await withTimeout(async (abortSignal) => {
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'text', text: PROMPT_VISUAL_ATTRIBUTES },
                  {
                    type: 'image_url',
                    image_url: {
                      url: `data:${mimeType || 'image/jpeg'};base64,${base64}`,
                    },
                  },
                ],
              },
            ],
            temperature: 0.1,
            max_completion_tokens: 300,
            response_format: { type: 'json_object' },
          }),
          signal: abortSignal,
        });

        if (!res.ok) {
          const errBody = await res.text().catch(() => '');
          const err = new Error(`Groq HTTP ${res.status}: ${errBody.slice(0, 200)}`);
          err.status = res.status;
          err.body = errBody;
          throw err;
        }

        return res.json();
      }, VISION_TIMEOUT_MS);

      const workingIdx = GROQ_VISION_MODELS.indexOf(model);
      if (workingIdx !== -1) {
        preferredGroqModelIndex = workingIdx;
      }

      const content = data?.choices?.[0]?.message?.content || '';
      return {
        provider: `Groq (${model})`,
        attributes: parseVisualAttributesResponse(content),
      };
    } catch (err) {
      lastError = err;
      // Si el modelo específico devuelve 400 o 404 (ej. model_decommissioned), probamos el siguiente modelo de Groq
      if (err?.status === 400 || err?.status === 404) {
        continue;
      }
      throw err;
    }
  }

  throw lastError || new Error('Groq Vision falló en todos los modelos configurados');
}

/**
 * Ejecuta una consulta al endpoint oficial v1 de Google Gemini Vision.
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
            { text: PROMPT_VISUAL_ATTRIBUTES },
            { inlineData: { mimeType: mimeType || 'image/jpeg', data: base64 } },
          ],
        },
      ],
      config: {
        temperature: 0.1,
        maxOutputTokens: 250,
        abortSignal,
      },
    }),
    VISION_TIMEOUT_MS,
  );
  return {
    provider: `Gemini (${GEMINI_MODEL})`,
    attributes: parseVisualAttributesResponse(response?.text ?? ''),
  };
}

/**
 * detectVisualAttributesFromFile(imageFile)
 * - Analiza dorsales (`bibs`) y atributos visuales (`helmetColors`, `bikeColors`, `jerseyColors`)
 *   en una única petición de visión.
 * - Respeta una pausa obligatoria de 3 segundos (`THROTTLE_DELAY_MS = 3000`) entre llamadas
 *   para no disparar nunca el error 429.
 * - Usa Groq Vision (`VITE_GROQ_API_KEY`) como motor principal y Gemini (`VITE_GEMINI_API_KEY`)
 *   como motor de respaldo (o viceversa según las claves disponibles).
 *
 * @param {File|Blob} imageFile
 * @returns {Promise<{ bibs: string[], dorsals: string[], helmetColors: string[], bikeColors: string[], jerseyColors: string[] }>}
 */
export async function detectVisualAttributesFromFile(imageFile) {
  const emptyResult = { bibs: [], dorsals: [], helmetColors: [], bikeColors: [], jerseyColors: [], hasVisibleFace: true };
  try {
    const groqKeys = getGroqApiKeys();
    const geminiKeys = getGeminiApiKeys();

    if (groqKeys.length === 0 && geminiKeys.length === 0) {
      return emptyResult;
    }

    const { base64, mimeType } = await fileToBase64(imageFile);

    // Pausa obligatoria de 3s entre peticiones para evitar por completo errores 429
    await waitRateLimitSlot(THROTTLE_DELAY_MS);

    // Construimos la lista ordenada de intentos: Groq primero (si está configurado) + Gemini como respaldo
    const attempts = [];
    groqKeys.forEach((k, idx) => {
      attempts.push({ type: 'groq', key: k, label: `Groq Key #${idx + 1}` });
    });
    if (geminiKeys.length > 0) {
      const primaryIdx = preferredGeminiKeyIndex % geminiKeys.length;
      attempts.push({ type: 'gemini', key: geminiKeys[primaryIdx], label: `Gemini Key #${primaryIdx + 1}`, idx: primaryIdx });
      if (geminiKeys.length > 1) {
        const backupIdx = (primaryIdx + 1) % geminiKeys.length;
        attempts.push({ type: 'gemini', key: geminiKeys[backupIdx], label: `Gemini Key #${backupIdx + 1} (respaldo)`, idx: backupIdx });
      }
    }

    // Ejecutamos hasta máximo 2 intentos (principal + 1 respaldo)
    const maxAttempts = Math.min(2, attempts.length);
    for (let i = 0; i < maxAttempts; i++) {
      const current = attempts[i];
      try {
        const res = current.type === 'groq'
          ? await callGroqVisionOnce(current.key, base64, mimeType)
          : await callGeminiOnce(current.key, base64, mimeType);

        lastVisionCallEnd = Date.now();
        if (current.type === 'gemini' && geminiKeys.length > 1) {
          preferredGeminiKeyIndex = (current.idx + 1) % geminiKeys.length;
        }

        const { attributes, provider } = res;
        console.log(
          `[aiService] ${provider} [${current.label}] -> dorsales: [${attributes.bibs.join(', ')}] | casco: [${attributes.helmetColors.join(', ')}] | bici: [${attributes.bikeColors.join(', ')}] | ropa: [${attributes.jerseyColors.join(', ')}] | hasVisibleFace: ${attributes.hasVisibleFace}`
        );
        return attributes;
      } catch (err) {
        lastVisionCallEnd = Date.now();
        const status = getErrorStatus(err);
        if (i + 1 < maxAttempts) {
          console.warn(
            `[aiService] Aviso en ${current.label} (${status || err?.name || 'error'}). Esperando ${BACKOFF_429_MS / 1000}s para reintentar con respaldo (${attempts[i + 1].label})...`
          );
          await sleep(BACKOFF_429_MS);
        } else {
          console.warn(
            `[aiService] IA omitida para "${imageFile?.name || 'imagen'}" (${status || err?.name || 'error'}). La foto puede subirse normalmente.`
          );
        }
      }
    }

    return emptyResult;
  } catch (unexpectedErr) {
    console.warn('[aiService] Error inesperado en análisis visual (fail-safe):', unexpectedErr?.message || unexpectedErr);
    return emptyResult;
  }
}

/**
 * detectDorsalsFromFile(imageFile)
 * Wrapper retrocompatible que devuelve únicamente el array de dorsales.
 */
export async function detectDorsalsFromFile(imageFile) {
  const res = await detectVisualAttributesFromFile(imageFile);
  return res.bibs;
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
      console.warn(`[aiService] ${label} superó ${ms / 1000}s. Se continúa con valor por defecto.`);
      resolve(fallback);
    }, ms);
  });
  return Promise.race([Promise.resolve(promise).catch(() => fallback), timeout]).finally(() => clearTimeout(timer));
}

export function analyzeImageFile(file, { shouldCancel, enableFaceDetection = true } = {}) {
  const emptyAttrs = { bibs: [], dorsals: [], helmetColors: [], bikeColors: [], jerseyColors: [], hasVisibleFace: true };
  const run = async () => {
    try {
      if (typeof shouldCancel === 'function' && shouldCancel()) {
        return { ...emptyAttrs, faceDescriptors: [], faceSkipped: true, cancelled: true };
      }
      // 1) Ejecuta primero la extracción de dorsales, colores y visibilidad de rostro (hasVisibleFace)
      const attrs = await settleWithin(
        detectVisualAttributesFromFile(file),
        28000,
        emptyAttrs,
        'Detección de dorsales y atributos visuales'
      );
      const dorsals = Array.isArray(attrs?.bibs) ? attrs.bibs : [];
      const helmetColors = Array.isArray(attrs?.helmetColors) ? attrs.helmetColors : [];
      const bikeColors = Array.isArray(attrs?.bikeColors) ? attrs.bikeColors : [];
      const jerseyColors = Array.isArray(attrs?.jerseyColors) ? attrs.jerseyColors : [];
      const hasVisibleFace = typeof attrs?.hasVisibleFace === 'boolean' ? attrs.hasVisibleFace : true;

      if (typeof shouldCancel === 'function' && shouldCancel()) {
        return {
          bibs: dorsals,
          dorsals,
          helmetColors,
          bikeColors,
          jerseyColors,
          hasVisibleFace,
          faceDescriptors: [],
          faceSkipped: true,
          cancelled: true,
        };
      }

      // 2) Si el admin desactivó el toggle de reconocimiento facial o si la IA detectó que el rostro está cubierto (hasVisibleFace === false),
      //    omitimos por completo la ejecución de face-api para ahorrar CPU/GPU y acelerar la subida.
      const shouldSkipFace = !enableFaceDetection || hasVisibleFace === false;
      if (shouldSkipFace) {
        console.log(
          `[aiService] Reconocimiento facial omitido para "${file?.name || 'imagen'}" (${!enableFaceDetection ? 'desactivado por admin' : 'hasVisibleFace=false: casco/lentes'})`
        );
        return {
          bibs: dorsals,
          dorsals,
          helmetColors,
          bikeColors,
          jerseyColors,
          hasVisibleFace: false,
          faceSkipped: true,
          faceDescriptors: [],
        };
      }

      const faceDescriptors = await settleWithin(extractFaceDescriptors(file, { forAdmin: true }), FACE_TIMEOUT_MS, [], 'Detección de rostros');
      return {
        bibs: dorsals,
        dorsals,
        helmetColors,
        bikeColors,
        jerseyColors,
        hasVisibleFace: true,
        faceSkipped: false,
        faceDescriptors: Array.isArray(faceDescriptors) ? faceDescriptors : [],
      };
    } catch {
      return { ...emptyAttrs, faceDescriptors: [], faceSkipped: false };
    }
  };

  // Encolado 100% secuencial (una foto tras otra) para nunca disparar ráfagas simultáneas a Groq/Gemini
  const result = sequentialQueue.then(run, run);
  sequentialQueue = result.catch(() => {});
  return result;
}
