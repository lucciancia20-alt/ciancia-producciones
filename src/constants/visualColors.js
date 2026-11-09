// Paleta estándar de colores normalizados en español para Búsqueda por Atributos Visuales (Ciclismo / Running)

export const VISUAL_COLOR_PALETTE = [
  { id: 'blanco',   label: 'Blanco',   hex: '#F9FAFB', border: '#D1D5DB', textDark: true },
  { id: 'negro',    label: 'Negro',    hex: '#111827', border: '#4B5563', textDark: false },
  { id: 'gris',     label: 'Gris',     hex: '#9CA3AF', border: '#6B7280', textDark: true },
  { id: 'rojo',     label: 'Rojo',     hex: '#EF4444', border: '#DC2626', textDark: false },
  { id: 'azul',     label: 'Azul',     hex: '#2563EB', border: '#1D4ED8', textDark: false },
  { id: 'celeste',  label: 'Celeste',  hex: '#38BDF8', border: '#0284C7', textDark: true },
  { id: 'verde',    label: 'Verde',    hex: '#16A34A', border: '#15803D', textDark: false },
  { id: 'amarillo', label: 'Amarillo', hex: '#FACC15', border: '#CA8A04', textDark: true },
  { id: 'naranja',  label: 'Naranja',  hex: '#F97316', border: '#EA580C', textDark: false },
  { id: 'rosa',     label: 'Rosa',     hex: '#EC4899', border: '#DB2777', textDark: false },
  { id: 'violeta',  label: 'Violeta',  hex: '#8B5CF6', border: '#7C3AED', textDark: false },
  { id: 'fluor',    label: 'Flúor',    hex: '#39FF14', border: '#22C55E', textDark: true },
];

export const ALLOWED_VISUAL_COLORS = VISUAL_COLOR_PALETTE.map(c => c.id);

export const VISUAL_COLOR_MAP = Object.fromEntries(VISUAL_COLOR_PALETTE.map(c => [c.id, c]));

const COLOR_SYNONYMS = {
  blanco: 'blanco',
  blanca: 'blanco',
  blancos: 'blanco',
  blancas: 'blanco',
  white: 'blanco',
  negro: 'negro',
  negra: 'negro',
  negros: 'negro',
  negras: 'negro',
  black: 'negro',
  gris: 'gris',
  grises: 'gris',
  plateado: 'gris',
  plateada: 'gris',
  plata: 'gris',
  plomo: 'gris',
  carbono: 'gris',
  gray: 'gris',
  grey: 'gris',
  silver: 'gris',
  rojo: 'rojo',
  roja: 'rojo',
  rojos: 'rojo',
  rojas: 'rojo',
  bordo: 'rojo',
  granate: 'rojo',
  red: 'rojo',
  azul: 'azul',
  azules: 'azul',
  'azul marino': 'azul',
  'azul oscuro': 'azul',
  marino: 'azul',
  navy: 'azul',
  blue: 'azul',
  celeste: 'celeste',
  celestes: 'celeste',
  turquesa: 'celeste',
  cyan: 'celeste',
  cian: 'celeste',
  'azul claro': 'celeste',
  'light blue': 'celeste',
  'sky blue': 'celeste',
  verde: 'verde',
  verdes: 'verde',
  'verde oscuro': 'verde',
  'verde militar': 'verde',
  'verde oliva': 'verde',
  green: 'verde',
  amarillo: 'amarillo',
  amarilla: 'amarillo',
  amarillos: 'amarillo',
  amarillas: 'amarillo',
  dorado: 'amarillo',
  dorada: 'amarillo',
  oro: 'amarillo',
  yellow: 'amarillo',
  gold: 'amarillo',
  naranja: 'naranja',
  naranjas: 'naranja',
  anaranjado: 'naranja',
  anaranjada: 'naranja',
  coral: 'naranja',
  orange: 'naranja',
  rosa: 'rosa',
  rosas: 'rosa',
  rosado: 'rosa',
  rosada: 'rosa',
  fucsia: 'rosa',
  magenta: 'rosa',
  pink: 'rosa',
  violeta: 'violeta',
  violetas: 'violeta',
  morado: 'violeta',
  morada: 'violeta',
  purpura: 'violeta',
  lila: 'violeta',
  purple: 'violeta',
  violet: 'violeta',
  fluor: 'fluor',
  fluorescente: 'fluor',
  neon: 'fluor',
  lima: 'fluor',
  'verde fluor': 'fluor',
  'amarillo fluor': 'fluor',
  'naranja fluor': 'fluor',
  'verde lima': 'fluor',
};

/**
 * Normaliza un color individual a la paleta estándar de 12 colores en español.
 * Devuelve null si no corresponde a ningún color válido.
 */
export function normalizeSingleColor(rawColor) {
  if (!rawColor) return null;
  const clean = String(rawColor)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!clean) return null;
  if (COLOR_SYNONYMS[clean]) return COLOR_SYNONYMS[clean];

  if (clean.includes('fluor') || clean.includes('neon') || clean.includes('lima')) {
    return 'fluor';
  }
  if (clean.includes('celeste') || clean.includes('turquesa') || clean.includes('azul claro')) {
    return 'celeste';
  }

  for (const token of clean.split(' ')) {
    if (COLOR_SYNONYMS[token]) return COLOR_SYNONYMS[token];
  }
  return null;
}

/**
 * Normaliza un array o string separado por comas de colores a un array único de colores estándar.
 */
export function normalizeColorList(input) {
  if (!input) return [];
  const rawList = Array.isArray(input)
    ? input
    : String(input).split(/[,;/]+/);

  const normalized = rawList
    .map(normalizeSingleColor)
    .filter(Boolean);

  return [...new Set(normalized)];
}
