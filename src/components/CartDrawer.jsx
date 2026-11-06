import React, { useState } from 'react';
import { X, Trash2, ShoppingCart, Tag, ChevronRight, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useCart } from '../context/CartContext';

function formatPrice(n) {
  return `$${n.toLocaleString('es-AR')}`;
}

export default function CartDrawer({ onClose }) {
  const { items, removeItem, coupon, couponError, couponLoading, applyCoupon, removeCoupon,
    subtotal, packDiscount, packRule, couponDiscount, total, itemCount } = useCart();
  const [couponInput, setCouponInput] = useState('');

  const handleApplyCoupon = () => {
    applyCoupon(couponInput);
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />

      {/* Drawer */}
      <div className="relative w-full max-w-md bg-dark-800 border-l border-dark-500 flex flex-col h-full shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-dark-600">
          <div className="flex items-center gap-2">
            <ShoppingCart className="w-5 h-5 text-neon-green" />
            <h2 className="font-bold text-white text-lg">Carrito ({itemCount})</h2>
          </div>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-white transition-colors rounded-lg hover:bg-dark-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Items */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-gray-400">
              <ShoppingCart className="w-12 h-12 mb-3 opacity-30" />
              <p className="font-medium">Tu carrito está vacío</p>
              <p className="text-sm mt-1">Explorá los álbumes para agregar fotos y videos</p>
            </div>
          ) : (
            items.map(item => (
              <div key={item.id} className="flex gap-3 bg-dark-700 rounded-lg p-3 border border-dark-500">
                <img src={item.thumb} alt={item.fileName} className="w-16 h-12 object-cover rounded-md flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-medium truncate">{item.fileName}</p>
                  <p className="text-gray-400 text-xs">{item.type === 'video' ? '🎬 Video' : '📷 Foto'}</p>
                  <p className="text-neon-green font-bold text-sm mt-1">{formatPrice(item.price)}</p>
                </div>
                <button
                  onClick={() => removeItem(item.id)}
                  className="p-1.5 text-gray-500 hover:text-red-400 transition-colors self-start"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))
          )}
        </div>

        {/* Summary + Coupon */}
        {items.length > 0 && (
          <div className="border-t border-dark-600 p-4 space-y-3">
            {/* Pack discount notification */}
            {packRule && (
              <div className="bg-neon-green/10 border border-neon-green/30 rounded-lg p-3 text-sm">
                <span className="text-neon-green font-bold">🎉 {packRule.label} activo!</span>
                <span className="text-gray-300 ml-2">-{(packRule.discount * 100).toFixed(0)}% de descuento</span>
              </div>
            )}

            {/* Coupon input */}
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Código de cupón"
                value={couponInput}
                onChange={e => setCouponInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleApplyCoupon()}
                className="input-dark text-sm py-2 flex-1 font-mono uppercase"
              />
              <button
                onClick={handleApplyCoupon}
                disabled={couponLoading || !couponInput.trim()}
                title="Aplicar cupón"
                className="bg-dark-600 hover:bg-dark-500 text-white px-3 py-2 rounded-lg text-sm font-medium transition-colors border border-dark-500 disabled:opacity-40 flex items-center justify-center min-w-[40px]"
              >
                {couponLoading ? <Loader2 className="w-4 h-4 animate-spin text-neon-green" /> : <Tag className="w-4 h-4" />}
              </button>
            </div>
            {couponError && <p className="text-red-400 text-xs">{couponError}</p>}
            {coupon && (
              <div className="flex items-center justify-between text-sm bg-neon-green/10 border border-neon-green/20 rounded-lg p-2">
                <span className="text-neon-green flex items-center gap-1.5 text-xs font-semibold">
                  <Tag className="w-3.5 h-3.5 flex-shrink-0" /> {coupon.code} — {coupon.label}
                </span>
                <button onClick={removeCoupon} className="text-gray-400 hover:text-red-400 text-xs font-medium transition-colors ml-2">
                  Quitar
                </button>
              </div>
            )}

            {/* Price breakdown */}
            <div className="space-y-2 text-sm border-t border-dark-600 pt-3">
              <div className="flex justify-between text-gray-400">
                <span>Subtotal ({itemCount} ítems)</span>
                <span>{formatPrice(subtotal)}</span>
              </div>
              {packDiscount > 0 && (
                <div className="flex justify-between text-neon-green">
                  <span>Descuento pack</span>
                  <span>-{formatPrice(packDiscount)}</span>
                </div>
              )}
              {couponDiscount > 0 && (
                <div className="flex justify-between text-neon-green">
                  <span>Cupón {coupon.code}</span>
                  <span>-{formatPrice(couponDiscount)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-white text-base pt-2 border-t border-dark-600">
                <span>Total</span>
                <span className="text-neon-green">{formatPrice(total)}</span>
              </div>
            </div>

            <Link
              to="/checkout"
              onClick={onClose}
              className="btn-neon w-full flex items-center justify-center gap-2 text-sm"
            >
              Finalizar compra <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
