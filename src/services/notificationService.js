/**
 * notificationService.js — Ciancia Producciones
 * 1. Sonido de alerta en vivo (Web Audio API, sin archivos externos)
 * 2. Notificaciones nativas del navegador / celular (Notification API)
 * 3. Envío automático de email al administrador en cada compra (Web3Forms + respaldo FormSubmit)
 */

const DEFAULT_ADMIN_EMAIL = 'lucciancia20@gmail.com';

/**
 * Reproduce un sonido doble de alerta agradable ("ding-dong" / compra nueva)
 * usando Web Audio API para no depender de archivos MP3 externos.
 */
export function playNewOrderSound() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();

    const playTone = (freq, startTime, duration, gainVal = 0.18) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, startTime);

      gain.gain.setValueAtTime(0.001, startTime);
      gain.gain.exponentialRampToValueAtTime(gainVal, startTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(startTime);
      osc.stop(startTime + duration);
    };

    const now = ctx.currentTime;
    playTone(1318.5, now, 0.22, 0.2);
    playTone(1975.5, now + 0.16, 0.45, 0.24);

    setTimeout(() => {
      try { ctx.close(); } catch { /* noop */ }
    }, 900);
  } catch {
    // noop
  }
}

/**
 * Solicita permiso para mostrar notificaciones nativas del sistema operativo / celular.
 * @returns {Promise<string>} 'granted' | 'denied' | 'default' | 'unsupported'
 */
export async function requestBrowserNotificationPermission() {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  if (Notification.permission === 'granted') return 'granted';
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission || 'default';
  }
}

/**
 * Muestra una notificación nativa de escritorio / móvil cuando entra una compra.
 */
export function showBrowserOrderNotification(order) {
  try {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;

    const cliente = order?.cliente?.nombre || 'Cliente';
    const total = `$${Number(order?.total || 0).toLocaleString('es-AR')}`;
    const count = order?.items?.length || 1;

    const notif = new Notification(`📸 ¡Nueva compra! ${total}`, {
      body: `${cliente} compró ${count} archivo${count !== 1 ? 's' : ''} (${order?.paymentMethod === 'transfer' ? 'Transferencia' : 'Mercado Pago'})`,
      icon: '/favicon.svg',
      tag: `order-${order?.id || Date.now()}`,
    });

    notif.onclick = () => {
      window.focus();
      notif.close();
    };
  } catch {
    // noop
  }
}

/**
 * Envía un email automático al administrador con todos los detalles de la compra.
 * Soporta:
 *   1. Web3Forms (https://api.web3forms.com/submit) si `web3formsKey` está configurado (100% instantáneo).
 *   2. FormSubmit AJAX como alternativa si el email fue activado previamente.
 *
 * @param {object} order Datos de la orden guardada en Firestore
 * @param {string} orderId ID del documento en Firestore
 * @param {string|object} [configOrEmail] Email o config { notifyEmail, web3formsKey }
 * @returns {Promise<{ ok: boolean, message?: string }>}
 */
export async function sendOrderEmailNotification(order, orderId, configOrEmail) {
  const isObj = configOrEmail && typeof configOrEmail === 'object';
  const targetEmail = String(
    (isObj ? configOrEmail.notifyEmail : configOrEmail) || DEFAULT_ADMIN_EMAIL
  ).trim() || DEFAULT_ADMIN_EMAIL;
  const web3formsKey = String(
    (isObj ? configOrEmail.web3formsKey : '') || import.meta.env?.VITE_WEB3FORMS_KEY || ''
  ).trim();

  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://ciancia-producciones.onrender.com';

  const itemsSummary = (order?.items || [])
    .map((it, idx) => `${idx + 1}. ${it.fileName || it.id} ($${Number(it.price || 0).toLocaleString('es-AR')})`)
    .join('\n');

  const subject = `📸 Nueva compra $${Number(order?.total || 0).toLocaleString('es-AR')} - ${order?.cliente?.nombre || 'Cliente'}`;

  // 1) Si hay clave de Web3Forms configurada, usamos Web3Forms (entrega inmediata sin redirección)
  if (web3formsKey) {
    try {
      const res = await fetch('https://api.web3forms.com/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          access_key: web3formsKey,
          subject,
          from_name: 'Ciancia Producciones',
          Codigo_Pedido: orderId || '-',
          Cliente: order?.cliente?.nombre || '-',
          Email_Cliente: order?.cliente?.email || '-',
          Telefono_WhatsApp: order?.cliente?.telefono || 'No informado',
          Metodo_de_Pago: order?.paymentMethod === 'transfer' ? 'Transferencia Bancaria' : 'Mercado Pago',
          Total_Pagado: `$${Number(order?.total || 0).toLocaleString('es-AR')}`,
          Cantidad_Archivos: String(order?.items?.length || 0),
          Detalle_Archivos: itemsSummary || '-',
          Comprobante_Adjunto: order?.voucherUrl ? order.voucherUrl : 'Sin comprobante adjunto',
          Link_Panel_Ordenes: `${origin}/admin/orders`,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.success) {
        return { ok: true, message: 'Email enviado correctamente vía Web3Forms.' };
      }
      return { ok: false, message: data?.message || `Error HTTP ${res.status} en Web3Forms.` };
    } catch (err) {
      return { ok: false, message: 'No se pudo conectar con Web3Forms: ' + (err?.message || err) };
    }
  }

  // 2) Respaldo FormSubmit AJAX
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(`https://formsubmit.co/ajax/${encodeURIComponent(targetEmail)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({
        _subject: subject,
        _template: 'table',
        _captcha: 'false',
        Codigo_Pedido: orderId || '-',
        Cliente: order?.cliente?.nombre || '-',
        Email_Cliente: order?.cliente?.email || '-',
        Telefono_WhatsApp: order?.cliente?.telefono || 'No informado',
        Metodo_de_Pago: order?.paymentMethod === 'transfer' ? 'Transferencia Bancaria' : 'Mercado Pago',
        Total_Pagado: `$${Number(order?.total || 0).toLocaleString('es-AR')}`,
        Cantidad_Archivos: String(order?.items?.length || 0),
        Detalle_Archivos: itemsSummary || '-',
        Comprobante_Adjunto: order?.voucherUrl ? order.voucherUrl : 'Sin comprobante adjunto',
        Administrar_Orden: `${origin}/admin/orders`,
      }),
    }).finally(() => clearTimeout(timer));

    const data = await res.json().catch(() => ({}));
    if (res.ok && (data?.success === true || data?.success === 'true')) {
      return { ok: true, message: 'Email enviado vía FormSubmit.' };
    }
    return {
      ok: false,
      message: data?.message || 'El servidor gratuito FormSubmit está demorado o requiere que pegues tu Access Key gratuita de Web3Forms.',
    };
  } catch {
    return {
      ok: false,
      message: 'El servidor de FormSubmit no respondió a tiempo. Para envío instantáneo 100% seguro, generá en 5 segundos tu clave gratuita en web3forms.com y pegala abajo.',
    };
  }
}
