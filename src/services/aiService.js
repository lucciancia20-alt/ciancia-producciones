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

const PROMPT_VISUAL_ATTRIBUTES = `Analiza esta fotografía deportiva (fútbol, ciclismo, MTB, running o trail) y devuelve ÚNICAMENTE un objeto JSON estricto con todos los atributos detectados en la imagen, sin texto adicional ni bloques markdown:
{
  "bibs": ["10", "256"],
  "helmetColors": ["blanco", "negro"],
  "bikeColors": ["rojo", "negro"],
  "jerseyColors": ["azul", "amarillo"],
  "hasVisibleFace": false
}
Reglas estrictas:
1. "bibs": array de strings con TODOS los números visibles de jugadores o corredores, incluyendo números estampados en camisetas de fútbol (espalda, pecho o shorts/pantalón, incluso si tienen bajo contraste, tipografía deportiva o pliegues en la tela), dorsales/pecheras de running o placas de bicicleta. Si no hay números visibles, devuelve [].
2. "helmetColors": colores dominantes de los cascos de los deportistas visibles. Si no usan casco (ej. fútbol o running), devuelve [].
3. "bikeColors": colores dominantes del cuadro de las bicicletas visibles. Si no hay bicicletas, devuelve [].
4. "jerseyColors": colores dominantes de las camisetas de fútbol, remeras o maillots de los deportistas visibles. Si no hay deportistas, devuelve [].
5. "hasVisibleFace": booleano (true o false). Debe ser false si las personas en la foto llevan casco y gafas/lentes que cubren los rasgos faciales, casco integral, están agachadas sobre el manubrio ocultando la cara, de espaldas o demasiado lejos para distinguir un rostro. Solo debe ser true si hay al menos un rostro descubierto y claramente identificable para reconocimiento facial.
6. Usa EXCLUSIVAMENTE colores de esta paleta estándar en español: "blanco", "negro", "gris", "rojo", "azul", "celeste", "verde", "amarillo", "naranja", "rosa", "violeta", "fluor".`;

// ─── Pipeline OCR con Preprocesamiento <canvas> + Tesseract.js (perfiles por deporte) ─
// El pipeline OCR se adapta a la categoría/etiqueta del álbum:
//   • Perfil "contact" (Fútbol / Deportes de contacto) → FLEXIBLE: alto contraste + binarización,
//     PSM 11/12 (sparse text) y umbral de confianza bajo para tolerar pliegues de la tela.
//   • Perfil "endurance" (Ciclismo / Running / Trail — POR DEFECTO) → ESTRICTO: escala de grises
//     suave sin binarizar, PSM 3 (segmentación automática en bloques estructurados, como el cartón
//     del dorsal), umbral de confianza alto y filtro anti-ruido de dígitos sueltos aislados.
export const OCR_PROFILES = {
  contact: {
    id:                  'contact',
    label:               'Fútbol / Deportes de contacto (perfil flexible)',
    charWhitelist:       '0123456789',
    pageSegMode:         '11',  // PSM 11: Sparse text (números sueltos en cualquier parte de la foto)
    fallbackPageSegMode: '12',  // PSM 12: Sparse text with OSD
    minConfidence:       38,    // Umbral reducido para tolerar pliegues en camisetas deportivas
    contrastBoost:       115,   // Incremento agresivo de contraste antes de binarizar
    binarize:            true,  // Thresholding duro (blanco/negro)
    invertPass:          true,  // Segunda pasada invertida (números claros sobre camiseta oscura)
    minDigits:           1,     // Camisetas de fútbol usan 1-2 dígitos
    allowIsolatedSingleDigit: true,
    textFallback:        true,  // Permite rescatar números desde data.text
    maxCanvasDim:        1600,
  },
  endurance: {
    id:                  'endurance',
    label:               'Ciclismo / Running (perfil estricto)',
    charWhitelist:       '0123456789',
    pageSegMode:         '3',   // PSM 3: segmentación automática por bloques (cartón del dorsal / placa)
    fallbackPageSegMode: null,  // Sin fallback sparse: es la principal fuente de falsos positivos
    minConfidence:       72,    // Umbral alto para rechazar pasto, ruido y marcas de agua
    contrastBoost:       35,    // Contraste suave (sin binarización extrema)
    binarize:            false, // Se entrega en escala de grises; Tesseract aplica su propio Otsu
    invertPass:          false,
    minDigits:           2,     // Dorsales de carrera suelen tener 2-5 dígitos
    allowIsolatedSingleDigit: false,
    textFallback:        false,
    maxCanvasDim:        1600,
  },
};

/** Retrocompatibilidad: configuración histórica (perfil flexible de fútbol). */
export const TESSERACT_OCR_CONFIG = OCR_PROFILES.contact;

const CONTACT_SPORT_PATTERN = /f[uú]tbol|futsal|f[uú]tbol\s*5|soccer|rugby|hockey|handball|h[aá]ndbol|b[aá]squet|basket|v[oó]ley|volley|waterpolo|contacto/i;

/**
 * Determina el perfil OCR según la categoría/etiqueta (o lista de etiquetas) del álbum.
 * Cualquier valor que no sea explícitamente un deporte de contacto usa el perfil estricto
 * de Ciclismo / Running (por defecto).
 *
 * @param {string|string[]|null|undefined} sportType
 * @returns {typeof OCR_PROFILES.contact}
 */
export function resolveOcrProfile(sportType) {
  const raw = Array.isArray(sportType) ? sportType.join(' ') : String(sportType ?? '');
  const normalized = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (CONTACT_SPORT_PATTERN.test(raw) || CONTACT_SPORT_PATTERN.test(normalized)) {
    return OCR_PROFILES.contact;
  }
  return OCR_PROFILES.endurance;
}

let tesseractWorkerPromise = null;

/**
 * Preprocesa una imagen en un <canvas> temporal antes de pasarla a Tesseract:
 * 1) Escala preservando nitidez (hasta 1600px).
 * 2) Convierte a escala de grises mediante luminancia perceptual.
 * 3a) Perfil flexible (`binarize: true`): estiramiento agresivo de contraste + binarización
 *     adaptativa para que los números estampados en camisetas de fútbol resalten sobre la tela.
 * 3b) Perfil estricto (`binarize: false`): contraste suave en escala de grises, sin thresholding,
 *     para no convertir pasto, sombras o marcas de agua en "trazos" que parezcan dígitos.
 *
 * @param {File|Blob} file
 * @param {Object} options
 * @param {boolean} [options.invert=false] - Si es true, invierte la polaridad (números claros sobre fondo oscuro)
 * @param {number}  [options.contrast=115] - Nivel de contraste (-255 a 255)
 * @param {number}  [options.threshold]    - Umbral de binarización (si se omite, usa la media adaptativa de luminancia)
 * @param {boolean} [options.binarize=true] - Si es false, se omite la binarización (solo escala de grises + contraste)
 * @param {number}  [options.maxCanvasDim=1600]
 * @returns {Promise<HTMLCanvasElement>}
 */
export function preprocessImageForOcr(file, {
  invert = false,
  contrast = OCR_PROFILES.contact.contrastBoost,
  threshold = null,
  binarize = true,
  maxCanvasDim = OCR_PROFILES.contact.maxCanvasDim,
} = {}) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);
      try {
        const nw = img.naturalWidth || img.width || 1;
        const nh = img.naturalHeight || img.height || 1;
        const scale = Math.min(1, maxCanvasDim / Math.max(nw, nh));
        const w = Math.max(1, Math.round(nw * scale));
        const h = Math.max(1, Math.round(nh * scale));

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, w, h);

        const imgData = ctx.getImageData(0, 0, w, h);
        const data = imgData.data;
        const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));

        // Paso 1: Convertir a escala de grises, aplicar contraste y calcular luminancia media
        const grayValues = new Uint8Array(data.length / 4);
        let sumLum = 0;

        for (let i = 0, p = 0; i < data.length; i += 4, p++) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          // Luminancia perceptual ITU-R BT.601
          const lum = 0.299 * r + 0.587 * g + 0.114 * b;
          const contrasted = Math.max(0, Math.min(255, factor * (lum - 128) + 128));
          grayValues[p] = contrasted;
          sumLum += contrasted;
        }

        if (!binarize) {
          // Perfil estricto: escala de grises suave (sin thresholding duro)
          for (let i = 0, p = 0; i < data.length; i += 4, p++) {
            const v = invert ? 255 - grayValues[p] : grayValues[p];
            data[i]     = v;
            data[i + 1] = v;
            data[i + 2] = v;
            data[i + 3] = 255;
          }
          ctx.putImageData(imgData, 0, 0);
          resolve(canvas);
          return;
        }

        // Paso 2: Thresholding / Binarización para separar el dorsal de la textura de la camiseta
        const meanLum = sumLum / Math.max(1, grayValues.length);
        const effectiveThreshold = typeof threshold === 'number'
          ? threshold
          : Math.max(95, Math.min(175, Math.round(meanLum * 1.05)));

        for (let i = 0, p = 0; i < data.length; i += 4, p++) {
          const isBright = grayValues[p] >= effectiveThreshold;
          // Tesseract rinde mejor con dígitos oscuros (0) sobre fondo blanco (255)
          const binaryVal = invert
            ? (isBright ? 0 : 255)
            : (isBright ? 255 : 0);
          data[i]     = binaryVal;
          data[i + 1] = binaryVal;
          data[i + 2] = binaryVal;
          data[i + 3] = 255;
        }

        ctx.putImageData(imgData, 0, 0);
        resolve(canvas);
      } catch (err) {
        reject(err);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('No se pudo cargar la imagen para preprocesamiento OCR'));
    };

    img.src = url;
  });
}

async function getTesseractWorker() {
  if (!tesseractWorkerPromise) {
    tesseractWorkerPromise = (async () => {
      const Tesseract = await import('tesseract.js');
      const createWorker = Tesseract.createWorker || Tesseract.default?.createWorker;
      const worker = await createWorker('eng');
      await worker.setParameters({
        tessedit_char_whitelist: OCR_PROFILES.contact.charWhitelist,
        tessedit_pageseg_mode:   OCR_PROFILES.contact.pageSegMode,
        preserve_interword_spaces: '1',
      });
      return worker;
    })().catch((err) => {
      tesseractWorkerPromise = null;
      throw err;
    });
  }
  return tesseractWorkerPromise;
}

/** Recolecta las palabras de Tesseract v5 (`data.words`) o v6/v7 (`data.blocks` → … → `words`) sin duplicados. */
function collectTesseractWords(data) {
  const fromBlocks = [];
  if (Array.isArray(data?.blocks)) {
    for (const block of data.blocks) {
      for (const para of block?.paragraphs || []) {
        for (const line of para?.lines || []) {
          for (const word of line?.words || []) {
            fromBlocks.push(word);
          }
        }
      }
    }
  }
  if (fromBlocks.length > 0) return fromBlocks;
  return Array.isArray(data?.words) ? data.words : [];
}

/**
 * Une fragmentos numéricos contiguos de la misma línea (dorsal partido, ej. "1" + "23" → "123"
 * o "1" + "0" → "10" en una camiseta de fútbol).
 * Perfil estricto: los dígitos aislados (pasto, letras de marcas de agua, sombras) se descartan.
 * Perfil flexible (`allowIsolatedSingleDigit`): los dígitos únicos aislados se conservan.
 */
function mergeAndFilterIsolatedDigits(tokens, { minDigits, allowIsolatedSingleDigit }) {
  const withBox = tokens.filter(t => t.bbox);
  const withoutBox = tokens.filter(t => !t.bbox);

  // Ordenamos por línea (centro vertical) y luego por X para unir fragmentos contiguos
  withBox.sort((a, b) => (a.cy - b.cy) || (a.bbox.x0 - b.bbox.x0));
  const groups = [];
  for (const tok of withBox) {
    const last = groups[groups.length - 1];
    const prev = last?.[last.length - 1];
    if (prev) {
      const hPrev = prev.bbox.y1 - prev.bbox.y0;
      const hTok = tok.bbox.y1 - tok.bbox.y0;
      const hRef = Math.max(1, Math.max(hPrev, hTok));
      const sameLine = Math.abs(prev.cy - tok.cy) <= hRef * 0.5;
      const similarHeight = Math.min(hPrev, hTok) / hRef >= 0.6;
      const gap = tok.bbox.x0 - prev.bbox.x1;
      const adjacent = gap >= -hRef * 0.2 && gap <= hRef * 0.6;
      if (sameLine && similarHeight && adjacent) {
        last.push(tok);
        continue;
      }
    }
    groups.push([tok]);
  }

  const results = [];
  for (const g of groups) {
    const merged = g.map(t => t.digits).join('');
    if (merged.length >= minDigits || (allowIsolatedSingleDigit && merged.length >= 1)) {
      results.push(merged);
    }
  }
  for (const t of withoutBox) {
    if (t.digits.length >= minDigits || allowIsolatedSingleDigit) results.push(t.digits);
  }
  return results;
}

function extractNumbersFromTesseractData(data, profile = OCR_PROFILES.contact, minConfidence = profile.minConfidence) {
  const tokens = [];
  const pageHeight = Number(data?.imageHeight) || 0;

  for (const w of collectTesseractWords(data)) {
    const conf = typeof w?.confidence === 'number' ? w.confidence : 0;
    const digits = String(w?.text || '').replace(/\D/g, '').trim();
    if (!digits || conf < minConfidence) continue;

    const bbox = w?.bbox && typeof w.bbox.x0 === 'number' ? w.bbox : null;
    if (bbox && profile.id === 'endurance') {
      const bh = bbox.y1 - bbox.y0;
      const bw = bbox.x1 - bbox.x0;
      // Descartamos trazos diminutos (textura de pasto/ripio) y formas imposibles para un dígito
      if (bh < 12) continue;
      if (pageHeight > 0 && bh < pageHeight * 0.012) continue;
      const perDigitAspect = bw / Math.max(1, digits.length) / Math.max(1, bh);
      if (perDigitAspect < 0.18 || perDigitAspect > 1.4) continue;
    }

    tokens.push({
      digits,
      conf,
      bbox,
      cy: bbox ? (bbox.y0 + bbox.y1) / 2 : 0,
    });
  }

  // Ambos perfiles unen fragmentos contiguos de un mismo número (ej. "1" + "0" → "10" en una camiseta,
  // frecuente con PSM 11 que segmenta caracteres sueltos). El perfil flexible además conserva los
  // dígitos únicos aislados; el estricto los descarta como ruido.
  const candidates = mergeAndFilterIsolatedDigits(tokens, profile);

  // Fallback sobre data.text (solo perfil flexible) cuando el bloque general supera el umbral reducido
  if (candidates.length === 0 && profile.textFallback && data?.text) {
    const overallConf = typeof data.confidence === 'number' ? data.confidence : minConfidence;
    if (overallConf >= minConfidence * 0.8) {
      const matches = String(data.text).match(/\b\d{1,5}\b/g) || [];
      candidates.push(...matches);
    }
  }

  return cleanBibsList(candidates, { minDigits: profile.minDigits });
}

/**
 * Ejecuta Tesseract OCR aplicando el perfil correspondiente al deporte del álbum.
 *  - Fútbol / contacto: binarización de alto contraste (polaridad normal + invertida), PSM 11/12, conf ≥ 38%.
 *  - Ciclismo / Running (por defecto): escala de grises suave, PSM 3 (bloques), conf ≥ 72%,
 *    descarte de dígitos sueltos aislados.
 *
 * @param {File|Blob} imageFile
 * @param {Object} [options]
 * @param {string|string[]} [options.sportType] - Categoría/etiqueta del álbum (ej. "Fútbol", "Ciclismo")
 * @returns {Promise<string[]>}
 */
export async function detectNumbersWithTesseractOcr(imageFile, { sportType } = {}) {
  if (!imageFile || !imageFile.type || !imageFile.type.startsWith('image/')) return [];
  const profile = resolveOcrProfile(sportType);
  try {
    const worker = await getTesseractWorker();
    const detected = new Set();
    const polarityPasses = profile.invertPass ? [false, true] : [false];

    for (const invertPass of polarityPasses) {
      const processedCanvas = await preprocessImageForOcr(imageFile, {
        invert:       invertPass,
        contrast:     profile.contrastBoost,
        binarize:     profile.binarize,
        maxCanvasDim: profile.maxCanvasDim,
      });

      await worker.setParameters({
        tessedit_char_whitelist: profile.charWhitelist,
        tessedit_pageseg_mode:   profile.pageSegMode,
      });

      const { data } = await worker.recognize(processedCanvas, {}, { text: true, blocks: true });
      const nums = extractNumbersFromTesseractData(
        { ...data, imageHeight: processedCanvas.height },
        profile,
      );
      nums.forEach(n => detected.add(n));

      // Perfil flexible: si en la última pasada aún no hay dígitos, probamos el PSM de respaldo (12)
      const isLastPass = invertPass === polarityPasses[polarityPasses.length - 1];
      if (detected.size === 0 && isLastPass && profile.fallbackPageSegMode) {
        await worker.setParameters({
          tessedit_char_whitelist: profile.charWhitelist,
          tessedit_pageseg_mode:   profile.fallbackPageSegMode,
        });
        const { data: osdData } = await worker.recognize(processedCanvas, {}, { text: true, blocks: true });
        const osdNums = extractNumbersFromTesseractData(
          { ...osdData, imageHeight: processedCanvas.height },
          profile,
        );
        osdNums.forEach(n => detected.add(n));
      }
    }

    const finalNumbers = [...detected];
    if (finalNumbers.length > 0) {
      console.log(`[aiService] Tesseract OCR [${profile.label}] (PSM ${profile.pageSegMode}, conf>=${profile.minConfidence}%) -> números: [${finalNumbers.join(', ')}]`);
    }
    return finalNumbers;
  } catch (err) {
    console.warn('[aiService] Tesseract OCR omitido:', err?.message || err);
    return [];
  }
}

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

function cleanBibsList(rawBibs, { minDigits = 1 } = {}) {
  if (!Array.isArray(rawBibs)) return [];
  const min = Math.max(1, Number(minDigits) || 1);
  return [...new Set(
    rawBibs
      .map(v => String(v ?? '').replace(/\D/g, '').trim())
      .filter(v => v.length >= min && v.length <= 5 && !/^0+$/.test(v))
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
 * @param {Object} [options]
 * @param {string|string[]} [options.sportType] - Categoría/etiqueta del álbum; define el perfil OCR (estricto o flexible)
 * @returns {Promise<{ bibs: string[], dorsals: string[], helmetColors: string[], bikeColors: string[], jerseyColors: string[] }>}
 */
export async function detectVisualAttributesFromFile(imageFile, { sportType } = {}) {
  const ocrProfile = resolveOcrProfile(sportType);
  const emptyResult = { bibs: [], dorsals: [], helmetColors: [], bikeColors: [], jerseyColors: [], hasVisibleFace: true };
  try {
    const groqKeys = getGroqApiKeys();
    const geminiKeys = getGeminiApiKeys();

    // Si no hay claves de API configuradas, ejecutamos directamente el pipeline local Tesseract OCR con preprocesamiento <canvas>
    if (groqKeys.length === 0 && geminiKeys.length === 0) {
      const ocrNumbers = await settleWithin(
        detectNumbersWithTesseractOcr(imageFile, { sportType }),
        15000,
        [],
        'Tesseract OCR para camisetas/dorsales'
      );
      return {
        ...emptyResult,
        bibs: ocrNumbers,
        dorsals: ocrNumbers,
      };
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

        // Si el motor de visión no encontró números (frecuente en camisetas de fútbol con pliegues o bajo contraste),
        // ejecutamos el pipeline Tesseract OCR con binarización en <canvas> (PSM 11/12 + whitelist '0123456789')
        let mergedBibs = attributes.bibs;
        if (mergedBibs.length === 0) {
          const ocrBibs = await settleWithin(
            detectNumbersWithTesseractOcr(imageFile, { sportType }),
            12000,
            [],
            'Tesseract OCR complementario para camisetas'
          );
          if (ocrBibs.length > 0) {
            mergedBibs = cleanBibsList([...mergedBibs, ...ocrBibs], { minDigits: ocrProfile.minDigits });
          }
        }

        const finalAttributes = {
          ...attributes,
          bibs: mergedBibs,
          dorsals: mergedBibs,
        };

        console.log(
          `[aiService] ${provider} [${current.label}] -> dorsales: [${finalAttributes.bibs.join(', ')}] | casco: [${finalAttributes.helmetColors.join(', ')}] | bici: [${finalAttributes.bikeColors.join(', ')}] | ropa: [${finalAttributes.jerseyColors.join(', ')}] | hasVisibleFace: ${finalAttributes.hasVisibleFace}`
        );
        return finalAttributes;
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
            `[aiService] IA Vision omitida para "${imageFile?.name || 'imagen'}" (${status || err?.name || 'error'}). Ejecutando fallback Tesseract OCR...`
          );
        }
      }
    }

    // Fallback final con Tesseract OCR preprocesado si ambos intentos de red fallaron
    const fallbackOcrBibs = await settleWithin(
      detectNumbersWithTesseractOcr(imageFile, { sportType }),
      15000,
      [],
      'Tesseract OCR fallback'
    );
    return {
      ...emptyResult,
      bibs: fallbackOcrBibs,
      dorsals: fallbackOcrBibs,
    };
  } catch (unexpectedErr) {
    console.warn('[aiService] Error inesperado en análisis visual (fail-safe):', unexpectedErr?.message || unexpectedErr);
    return emptyResult;
  }
}

/**
 * detectDorsalsFromFile(imageFile, { sportType })
 * Wrapper retrocompatible que devuelve únicamente el array de dorsales.
 */
export async function detectDorsalsFromFile(imageFile, { sportType } = {}) {
  const res = await detectVisualAttributesFromFile(imageFile, { sportType });
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

/**
 * analyzeImageFile(file, { shouldCancel, enableFaceDetection, sportType })
 * @param {string|string[]} [options.sportType] - Categoría/etiqueta del álbum (ej. "Fútbol", "Ciclismo", "Trail Running").
 *   Fútbol / contacto → perfil OCR flexible; cualquier otro valor (o vacío) → perfil estricto Ciclismo/Running.
 */
export function analyzeImageFile(file, { shouldCancel, enableFaceDetection = true, sportType } = {}) {
  const emptyAttrs = { bibs: [], dorsals: [], helmetColors: [], bikeColors: [], jerseyColors: [], hasVisibleFace: true };
  const run = async () => {
    try {
      if (typeof shouldCancel === 'function' && shouldCancel()) {
        return { ...emptyAttrs, faceDescriptors: [], faceSkipped: true, cancelled: true };
      }
      // 1) Ejecuta primero la extracción de dorsales, colores y visibilidad de rostro (hasVisibleFace)
      const attrs = await settleWithin(
        detectVisualAttributesFromFile(file, { sportType }),
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
