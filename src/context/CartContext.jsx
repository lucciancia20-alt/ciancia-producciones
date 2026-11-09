import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../firebase/config';
import { getLowResSampleUrl } from '../services/cloudinary';

const CartContext = createContext(null);

function normalizeStr(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

// Pricing rules — Valores por defecto de Ciancia Producciones
export const DEFAULT_PRICES = {
  PHOTO_SINGLE: 2000,
  VIDEO_SINGLE: 3000,
};
export const PRICES = DEFAULT_PRICES;

export const PACK_RULES = [
  { minItems: 5, label: 'Pack 5+ (30% OFF)', discount: 0.30 },
  { minItems: 3, label: 'Pack 3+ (20% OFF)', discount: 0.20 },
  { minItems: 2, label: 'Pack 2 (10% OFF)',  discount: 0.10 },
];

export const COUPONS = {
  'CIANCIA10':    { discount: 0.10, label: '10% de descuento' },
  'DEPORTE20':    { discount: 0.20, label: '20% deportistas' },
  'PROMO2024':    { discount: 0.15, label: '15% promocional' },
  'TEAM-BIKE-15': { discount: 0.15, label: '15% Team Bike' },
  'RUNNING20':    { discount: 0.20, label: '20% Running' },
};

const CART_ITEMS_STORAGE_KEY  = 'ciancia_cart_items_v1';
const CART_COUPON_STORAGE_KEY = 'ciancia_cart_coupon_v1';

function loadStoredCartItems() {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(CART_ITEMS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(i => i && i.id) : [];
  } catch {
    return [];
  }
}

function loadStoredCartCoupon() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(CART_COUPON_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && parsed.code ? parsed : null;
  } catch {
    return null;
  }
}

export function CartProvider({ children }) {
  const [items, setItems] = useState(loadStoredCartItems);
  const [coupon, setCoupon] = useState(loadStoredCartCoupon);
  const [couponError, setCouponError] = useState('');
  const [couponLoading, setCouponLoading] = useState(false);

  // Sincronización con localStorage para que el corredor no pierda su selección al recargar en el celular
  useEffect(() => {
    try {
      if (items.length === 0) {
        localStorage.removeItem(CART_ITEMS_STORAGE_KEY);
      } else {
        // Excluimos faceDescriptors pesados para mantener localStorage ultraliviano
        const compactItems = items.map(({ faceDescriptors, ...rest }) => rest);
        localStorage.setItem(CART_ITEMS_STORAGE_KEY, JSON.stringify(compactItems));
      }
    } catch {
      // noop
    }
  }, [items]);

  useEffect(() => {
    try {
      if (!coupon) {
        localStorage.removeItem(CART_COUPON_STORAGE_KEY);
      } else {
        localStorage.setItem(CART_COUPON_STORAGE_KEY, JSON.stringify(coupon));
      }
    } catch {
      // noop
    }
  }, [coupon]);

  const addItem = useCallback((media) => {
    setItems(prev => {
      const basePrice = Number(media.price) || (media.type === 'video' ? 3000 : 2000);
      const lowResThumb = getLowResSampleUrl(media.thumb || media.url, { width: 320, quality: 50 });
      const { faceDescriptors, ...cleanMedia } = media;
      const existingIdx = prev.findIndex(i => i.id === media.id);
      if (existingIdx !== -1) {
        return prev.map((it, idx) => idx === existingIdx ? { ...it, price: basePrice, isIndividual: media.isIndividual } : it);
      }
      return [...prev, { ...cleanMedia, thumb: lowResThumb, price: basePrice, quantity: 1 }];
    });
  }, []);

  const removeItem = useCallback((id) => {
    setItems(prev => prev.filter(i => i.id !== id));
  }, []);

  const clearCart = useCallback(() => {
    setItems([]);
    setCoupon(null);
    setCouponError('');
    try {
      localStorage.removeItem(CART_ITEMS_STORAGE_KEY);
      localStorage.removeItem(CART_COUPON_STORAGE_KEY);
    } catch {
      // noop
    }
  }, []);

  // Re-validar cupón automáticamente si cambian las fotos del carrito
  useEffect(() => {
    if (!coupon) return;
    if (items.length === 0) {
      setCoupon(null);
      return;
    }
    const targetAlbumId = coupon.albumId && coupon.albumId !== 'ALL' ? coupon.albumId : '';
    const targetAlbumTitle = coupon.albumTitle || '';
    if (!targetAlbumId && !targetAlbumTitle) return;

    const allMatch = items.every(item => {
      const itemAlbumId = item.albumId || '';
      const itemAlbumTitle = item.albumTitle || '';
      const matchId = Boolean(targetAlbumId && itemAlbumId && itemAlbumId === targetAlbumId);
      const matchTitle = Boolean(
        targetAlbumTitle && itemAlbumTitle && normalizeStr(itemAlbumTitle) === normalizeStr(targetAlbumTitle)
      );
      return matchId || matchTitle;
    });

    if (!allMatch) {
      setCoupon(null);
      setCouponError('Este cupón no es válido para este álbum');
    }
  }, [items, coupon]);

  const applyCoupon = useCallback(async (rawCode) => {
    if (!rawCode || !rawCode.trim()) {
      setCouponError('Ingresá un código');
      return false;
    }
    if (items.length === 0) {
      setCouponError('Agregá fotos al carrito antes de aplicar un cupón');
      return false;
    }

    const code = rawCode.trim().toUpperCase().replace(/\s+/g, '');
    setCouponLoading(true);
    setCouponError('');

    try {
      // 1. Consultar en Firestore colección 'coupons'
      const q = query(collection(db, 'coupons'), where('code', '==', code));
      const snap = await getDocs(q);

      if (!snap.empty) {
        const docData = snap.docs[0].data();
        if (docData.active === false) {
          setCoupon(null);
          setCouponError('El cupón está inactivo o vencido');
          return false;
        }

        // 2. Validar restricción obligatoria por Álbum
        if (docData.albumId !== 'ALL') {
          let albumsById = {};
          let albumsList = [];
          try {
            const albumsSnap = await getDocs(collection(db, 'albums'));
            albumsList = albumsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
            albumsList.forEach(a => {
              albumsById[a.id] = a.title || '';
            });
          } catch (albumErr) {
            console.warn('[CartContext] No se pudo consultar colección albums:', albumErr);
          }

          let targetAlbumId = docData.albumId || '';
          let targetAlbumTitle = docData.albumTitle || (targetAlbumId ? (albumsById[targetAlbumId] || '') : '');

          // Compatibilidad con cupones donde el álbum fue ingresado en label/albumTitle (ej. "Prueba" o "Desafío Circuito Chico")
          if (!targetAlbumId && !targetAlbumTitle && docData.label) {
            const rawLabel = String(docData.label).trim();
            const matchedAlbum = albumsList.find(a => normalizeStr(a.title) === normalizeStr(rawLabel));
            if (matchedAlbum) {
              targetAlbumId = matchedAlbum.id;
              targetAlbumTitle = matchedAlbum.title || rawLabel;
            } else {
              const isGenericDiscountText = /^\d+%?\s*(de descuento|off)/i.test(rawLabel);
              if (!isGenericDiscountText) {
                targetAlbumTitle = rawLabel;
              }
            }
          } else if (!targetAlbumId && targetAlbumTitle) {
            const matchedAlbum = albumsList.find(a => normalizeStr(a.title) === normalizeStr(targetAlbumTitle));
            if (matchedAlbum) {
              targetAlbumId = matchedAlbum.id;
            }
          }

          // Si el cupón pertenece a un álbum específico, todas las fotos del carrito deben ser de ese mismo álbum
          if (targetAlbumId || targetAlbumTitle) {
            const allItemsBelongToCouponAlbum = items.every(item => {
              const itemAlbumId = item.albumId || '';
              const itemAlbumTitle = item.albumTitle || (itemAlbumId ? (albumsById[itemAlbumId] || '') : '');
              const matchById = Boolean(targetAlbumId && itemAlbumId && itemAlbumId === targetAlbumId);
              const matchByTitle = Boolean(
                targetAlbumTitle && itemAlbumTitle && normalizeStr(itemAlbumTitle) === normalizeStr(targetAlbumTitle)
              );
              return matchById || matchByTitle;
            });

            if (!allItemsBelongToCouponAlbum) {
              setCoupon(null);
              setCouponError('Este cupón no es válido para este álbum');
              return false;
            }
          }

          const type = docData.type || 'percent';
          const numValue = Number(docData.value) || 0;
          const discountFraction = type === 'percent' ? (numValue > 1 ? numValue / 100 : numValue) : 0;
          const label = docData.label || targetAlbumTitle || (
            type === 'percent'
              ? `${numValue}% de descuento`
              : `$${numValue.toLocaleString('es-AR')} de descuento`
          );

          setCoupon({
            id: snap.docs[0].id,
            code,
            type,
            value: numValue,
            discount: discountFraction,
            albumId: targetAlbumId,
            albumTitle: targetAlbumTitle,
            label,
          });
          setCouponError('');
          return true;
        }

        const type = docData.type || 'percent';
        const numValue = Number(docData.value) || 0;
        const discountFraction = type === 'percent' ? (numValue > 1 ? numValue / 100 : numValue) : 0;
        const label = docData.label || (
          type === 'percent'
            ? `${numValue}% de descuento`
            : `$${numValue.toLocaleString('es-AR')} de descuento`
        );

        setCoupon({
          id: snap.docs[0].id,
          code,
          type,
          value: numValue,
          discount: discountFraction,
          albumId: 'ALL',
          albumTitle: '',
          label,
        });
        setCouponError('');
        return true;
      }

      // 3. Fallback a cupones estándar locales
      if (COUPONS[code]) {
        const c = COUPONS[code];
        setCoupon({
          code,
          type: 'percent',
          value: Math.round(c.discount * 100),
          discount: c.discount,
          albumId: 'ALL',
          albumTitle: '',
          label: c.label,
        });
        setCouponError('');
        return true;
      }

      setCoupon(null);
      setCouponError('Cupón inválido');
      return false;
    } catch (err) {
      console.error('Error al validar cupón:', err);
      // Fallback local si hay error de red
      if (COUPONS[code]) {
        const c = COUPONS[code];
        setCoupon({
          code,
          type: 'percent',
          value: Math.round(c.discount * 100),
          discount: c.discount,
          albumId: 'ALL',
          albumTitle: '',
          label: c.label,
        });
        setCouponError('');
        return true;
      }
      setCouponError('No se pudo verificar el cupón');
      return false;
    } finally {
      setCouponLoading(false);
    }
  }, [items]);

  const removeCoupon = useCallback(() => {
    setCoupon(null);
    setCouponError('');
  }, []);

  // Calculate totals
  const subtotal = items.reduce((acc, item) => {
    const p = Number(item.price) || (item.type === 'video' ? 3000 : 2000);
    return acc + p;
  }, 0);

  // Pack discount (10% en 2 ítems, 20% en 3-4 ítems, 30% en 5+ ítems)
  const packRule = PACK_RULES.find(r => items.length >= r.minItems);
  const packDiscount = packRule ? Math.round(subtotal * packRule.discount) : 0;

  // Coupon discount applied after pack
  const afterPack = Math.max(0, subtotal - packDiscount);
  let couponDiscount = 0;
  if (coupon) {
    if (coupon.type === 'fixed') {
      couponDiscount = Math.min(afterPack, Number(coupon.value) || 0);
    } else {
      const pct = (Number(coupon.value) > 1 ? Number(coupon.value) / 100 : Number(coupon.discount)) || 0;
      couponDiscount = Math.round(afterPack * pct);
    }
  }

  const total = Math.max(0, afterPack - couponDiscount);

  return (
    <CartContext.Provider value={{
      items,
      coupon,
      couponError,
      couponLoading,
      addItem,
      removeItem,
      clearCart,
      applyCoupon,
      removeCoupon,
      subtotal,
      packDiscount,
      packRule,
      couponDiscount,
      total,
      itemCount: items.length,
    }}>
      {children}
    </CartContext.Provider>
  );
}

export const useCart = () => useContext(CartContext);
