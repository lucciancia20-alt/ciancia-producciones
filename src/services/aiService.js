/**
 * aiService.js — Ciancia Producciones
 * Client-side AI:
 *   1. Lectura de dorsales deportivos (Google Gemini 2.5 Flash / 1.5 Flash Vision API)
 *   2. Reconocimiento Facial (@vladmandic/face-api con serialización plana para Firestore)
 */

/**
 * Convierte un File o Blob en base64 puro para Gemini Vision.
 * Si la foto original supera 1600px, la escala suavemente en memoria
 * para evitar payloads gigantes (HTTP 413) y acelerar la respuesta de la API.
 */
function fileToBase64(file, maxDimension = 1600) {
  return new Promise((resolve, reject) => {
    if (!file.type || !file.type.startsWith('image/') || file.size < 500 * 1024) {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || '');
        const base64 = result.includes(',') ? result.split(',')[1] : result;
        resolve(base64);
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

        if (nw <= maxDimension && nh <= maxDimension) {
          const reader = new FileReader();
          reader.onload = () => {
            const result = String(reader.result || '');
            const base64 = result.includes(',') ? result.split(',')[1] : result;
            resolve(base64);
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
        resolve(base64);
      } catch {
        const reader = new FileReader();
        reader.onload = () => {
          const result = String(reader.result || '');
          const base64 = result.includes(',') ? result.split(',')[1] : result;
          resolve(base64);
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
        resolve(base64);
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

const PROMPT_DORSALES = "Analiza esta foto deportiva. Extrae todos los números de dorsales o pecheras visibles en los competidores (ej. 923, 106, 462). Devuelve estrictamente un array JSON plano de strings con los números encontrados. Si no hay dorsales, devuelve [].";

/**
 * Realiza la petición POST a la API de Google Generative Language.
 */
async function callGeminiVision(base64Data, mimeType, apiKey, modelName = 'gemini-2.5-flash') {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(apiKey)}`;

  return fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: PROMPT_DORSALES },
          { inline_data: { mime_type: mimeType, data: base64Data } },
        ],
      }],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json',
      },
    }),
  });
}

/**
 * detectDorsalsFromFile(imageFile)
 * Extrae números de dorsales de una foto deportiva utilizando Google Gemini Vision.
 * Si la API key no está definida o hay un error de red/cuota, devuelve [] de forma segura.
 *
 * @param {File|Blob} imageFile
 * @returns {Promise<string[]>}
 */
export async function detectDorsalsFromFile(imageFile) {
  try {
    const apiKey = getGeminiApiKey();
    if (!apiKey) {
      console.warn('[aiService] VITE_GEMINI_API_KEY no configurada. Omitiendo detección automática de dorsales.');
      return [];
    }

    const base64Data = await fileToBase64(imageFile);
    const mimeType = imageFile.type || 'image/jpeg';

    // 1. Intento primario con Gemini 2.5 Flash
    let response = await callGeminiVision(base64Data, mimeType, apiKey, 'gemini-2.5-flash');

    // 2. Si 2.5-flash no estuviese disponible (ej. 404), fallback a gemini-1.5-flash
    if (response.status === 404) {
      response = await callGeminiVision(base64Data, mimeType, apiKey, 'gemini-1.5-flash');
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      console.warn(`[aiService] Gemini API respondió con estado ${response.status}:`, errorText);
      return [];
    }

    const json = await response.json();
    const rawText = json?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '[]';

    // Limpieza en caso de envoltorios markdown ```json ... ```
    const cleanedText = rawText.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
    let parsed;
    try {
      parsed = JSON.parse(cleanedText);
    } catch {
      const match = cleanedText.match(/\[.*?\]/s);
      parsed = match ? JSON.parse(match[0]) : [];
    }

    if (!Array.isArray(parsed)) return [];

    // Normalizar a strings de 1 a 5 dígitos, sin ceros puros, únicos
    const dorsals = [...new Set(
      parsed
        .map(v => String(v).replace(/\D/g, '').trim())
        .filter(v => v.length >= 1 && v.length <= 5 && !/^0+$/.test(v))
    )];

    return dorsals;
  } catch (err) {
    console.warn('[aiService] Error en detección de dorsales con Gemini Vision:', err.message || err);
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
