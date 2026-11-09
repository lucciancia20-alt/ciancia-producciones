import React from 'react';
import { X } from 'lucide-react';
import Checkout from '../pages/Checkout';

/**
 * Modal envolvente para el flujo de Checkout con soporte completo de cupones de descuento.
 */
export default function CheckoutModal({ open, onClose }) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-5xl bg-dark-900 border border-neon-green/30 rounded-2xl shadow-2xl overflow-hidden my-8 max-h-[92vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="absolute top-4 right-4 z-20 p-2 rounded-lg bg-dark-800 border border-dark-600 text-gray-400 hover:text-white transition-colors"
            aria-label="Cerrar checkout"
          >
            <X className="w-5 h-5" />
          </button>
        )}
        <Checkout />
      </div>
    </div>
  );
}
