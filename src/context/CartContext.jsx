import React, { createContext, useContext, useState, useCallback } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../firebase/config';

const CartContext = createContext(null);

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
  'CIANCIA10': { discount: 0.10, label: '10% de descuento' },
  'DEPORTE20': { discount: 0.20, label: '20% deportistas' },
  'PROMO2024': { discount: 0.15, label: '15% promocional' },
};

export function CartProvider({ children }) {
  const [items, setItems] = useState([]);
  const [coupon, setCoupon] = useState(null);
  const [couponError, setCouponError] = useState('');
  const [couponLoading, setCouponLoading] = useState(false);

  const addItem = useCallback((media) => {
    setItems(prev => {
      if (prev.find(i => i.id === media.id)) return prev;
      const basePrice = Number(media.price) || (media.type === 'video' ? 3000 : 2000);
      return [...prev, { ...media, price: basePrice, quantity: 1 }];
    });
  }, []);

  const removeItem = useCallback((id) => {
    setItems(prev => prev.filter(i => i.id !== id));
  }, []);

  const clearCart = useCallback(() => {
    setItems([]);
    setCoupon(null);
    setCouponError('');
  }, []);

  const applyCoupon = useCallback(async (rawCode) => {
    if (!rawCode || !rawCode.trim()) {
      setCouponError('Ingresá un código');
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
          setCouponError('El cupón está inactivo o vencido');
          return false;
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
          label,
        });
        setCouponError('');
        return true;
      }

      // 2. Fallback a cupones estándar locales
      if (COUPONS[code]) {
        const c = COUPONS[code];
        setCoupon({
          code,
          type: 'percent',
          value: Math.round(c.discount * 100),
          discount: c.discount,
          label: c.label,
        });
        setCouponError('');
        return true;
      }

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
  }, []);

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
