// Helper para leer y guardar la configuración de métodos de pago en Firestore.
// Documento: db/config/payments

import { db } from './config';
import { doc, getDoc, setDoc } from 'firebase/firestore';

const REF = () => doc(db, 'config', 'payments');

/** Valores predeterminados de fábrica (se muestran si el doc no existe aún) */
const DEFAULTS = {
  cbu: '',
  alias: '',
  titular: 'Ciancia Producciones',
  banco: '',
  mpCelular: '',
  mpAlias: '',
  defaultPricePhoto: 2000,
  defaultPriceVideo: 3000,
  notifyEmail: 'lucciancia20@gmail.com',
  web3formsKey: '',
};

/**
 * Lee la configuración de pagos desde Firestore.
 * @returns {Promise<{cbu:string, alias:string, titular:string, banco:string, mpCelular:string, mpAlias:string}>}
 */
export async function getPaymentConfig() {
  try {
    const snap = await getDoc(REF());
    if (snap.exists()) {
      return { ...DEFAULTS, ...snap.data() };
    }
  } catch (e) {
    console.warn('[paymentConfig] Error al leer config:', e.message);
  }
  return { ...DEFAULTS };
}

/**
 * Guarda (merge) la configuración de pagos en Firestore.
 * @param {{ cbu?:string, alias?:string, titular?:string, banco?:string, mpCelular?:string, mpAlias?:string }} data
 */
export async function savePaymentConfig(data) {
  await setDoc(REF(), data, { merge: true });
}
