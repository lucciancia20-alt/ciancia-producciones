import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useCart } from '../context/CartContext';
import { ShoppingCart, Trash2, Tag, ArrowLeft, ChevronRight, X, Loader2 } from 'lucide-react';

function formatPrice(n) {
  return `$${n.toLocaleString('es-AR')}`;
}

export default function Cart() {
  const {
    items, removeItem, coupon, couponError, couponLoading, applyCoupon, removeCoupon,
    subtotal, packDiscount, packRule, couponDiscount, total, itemCount
  } = useCart();
  const [couponInput, setCouponInput] = useState('');

  return (
    <div className="min-h-screen pt-24 pb-16 px-4">
      <div className="max-w-4xl mx-auto">
        <Link to="/" className="inline-flex items-center gap-2 text-gray-400 hover:text-neon-green transition-colors mb-6 text-sm">
          <ArrowLeft className="w-4 h-4" />
          Seguir comprando
        </Link>

        <h1 className="text-3xl font-black text-white mb-8">
          MI <span className="text-neon-green">CARRITO</span>
          <span className="text-gray-500 text-lg font-normal ml-3">({itemCount} ítems)</span>
        </h1>

        {items.length === 0 ? (
          <div className="text-center py-24">
            <ShoppingCart className="w-20 h-20 mx-auto mb-6 text-gray-700" />
            <h2 className="text-xl font-bold text-gray-400 mb-2">Tu carrito está vacío</h2>
            <p className="text-gray-500 mb-6">Explorá los álbumes y encontrá tus fotos y videos</p>
            <Link to="/" className="btn-neon">Ver Álbumes</Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Items list */}
            <div className="lg:col-span-2 space-y-4">
              {items.map(item => (
                <div key={item.id} className="card-dark p-4 flex gap-4">
                  <img src={item.thumb} alt={item.fileName} className="w-24 h-18 object-cover rounded-lg flex-shrink-0" style={{ height: '72px' }} />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-white truncate">{item.fileName}</p>
                    <p className="text-gray-400 text-sm">{item.type === 'video' ? '🎬 Video' : '📷 Foto'}</p>
                    {item.dorsals?.length > 0 && (
                      <p className="text-gray-500 text-xs mt-1">Dorsal: {item.dorsals.join(', ')}</p>
                    )}
                    <p className="text-neon-green font-bold mt-2">{formatPrice(item.price)}</p>
                  </div>
                  <button onClick={() => removeItem(item.id)} className="text-gray-500 hover:text-red-400 transition-colors self-start">
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
              ))}
            </div>

            {/* Summary sidebar */}
            <div className="space-y-4">
              {/* Coupon */}
              <div className="card-dark p-4 space-y-3">
                <h3 className="font-bold text-white flex items-center gap-2 text-sm">
                  <Tag className="w-4 h-4 text-neon-green" /> ¿Tenés un código de descuento?
                </h3>
                <div className="flex gap-2">
                  <input
                    type="text"
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck="false"
                    data-lpignore="true"
                    data-form-type="other"
                    placeholder="Código..."
                    value={couponInput}
                    onChange={e => setCouponInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && applyCoupon(couponInput)}
                    className="input-dark text-sm py-2 flex-1 font-mono uppercase"
                  />
                  <button
                    onClick={() => applyCoupon(couponInput)}
                    disabled={couponLoading || !couponInput.trim()}
                    className="bg-dark-600 hover:bg-dark-500 border border-dark-500 text-white px-3 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-40 flex items-center justify-center gap-1.5 min-w-[75px]"
                  >
                    {couponLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Aplicar'}
                  </button>
                </div>
                {couponError && <p className="text-red-400 text-xs">{couponError}</p>}
                {coupon && (
                  <div className="flex items-center justify-between bg-neon-green/10 border border-neon-green/20 rounded-lg p-2">
                    <span className="text-neon-green text-sm font-semibold">{coupon.code} — {coupon.label}</span>
                    <button onClick={removeCoupon} className="text-gray-500 hover:text-red-400 transition-colors" title="Quitar cupón">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}
                <p className="text-gray-500 text-xs">Ej: TEAM-BIKE-15, RUNNING20, CIANCIA10</p>
              </div>

              {/* Price summary */}
              <div className="card-dark p-4 space-y-3">
                <h3 className="font-bold text-white">Resumen</h3>

                {packRule && (
                  <div className="bg-neon-green/10 border border-neon-green/30 rounded-lg p-3 text-sm">
                    <p className="text-neon-green font-bold">🎉 {packRule.label} aplicado</p>
                    <p className="text-gray-400">Comprás {itemCount} ítems → -{(packRule.discount * 100).toFixed(0)}% automático</p>
                  </div>
                )}

                <div className="space-y-2 text-sm">
                  <div className="flex justify-between text-gray-400">
                    <span>Subtotal</span>
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
                  <div className="flex justify-between font-bold text-white text-lg pt-2 border-t border-dark-600">
                    <span>TOTAL</span>
                    <span className="text-neon-green">{formatPrice(total)}</span>
                  </div>
                </div>

                <Link to="/checkout" className="btn-neon w-full flex items-center justify-center gap-2">
                  Finalizar compra <ChevronRight className="w-4 h-4" />
                </Link>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
