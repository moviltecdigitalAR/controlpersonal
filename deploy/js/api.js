// ============================================================
// API — Llamadas al Google Apps Script Backend
// Usa Content-Type: text/plain para evitar CORS preflight
// ============================================================

const API = (() => {

  const RETRYABLE_STATUS = new Set([404, 408, 429, 500, 502, 503, 504]);

  function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function call(action, params = {}, retrySafe = false) {
    const url = window.APP_CONFIG.GAS_URL;
    const body = JSON.stringify({ action, ...params });
    const maxAttempts = retrySafe ? 3 : 1;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      let response;
      try {
        response = await fetch(url, {
          method: 'POST',
          body,
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          redirect: 'follow'
        });
      } catch (error) {
        if (attempt + 1 < maxAttempts) {
          await wait(500 * (attempt + 1));
          continue;
        }
        throw new Error('No se pudo conectar con el servidor. Compruebe internet e intente de nuevo.');
      }

      if (!response.ok) {
        if (retrySafe && RETRYABLE_STATUS.has(response.status) && attempt + 1 < maxAttempts) {
          await wait(500 * (attempt + 1));
          continue;
        }
        throw new Error(`El servidor respondió HTTP ${response.status}. No vuelva a fichar hasta comprobar el estado.`);
      }

      try {
        return await response.json();
      } catch (error) {
        if (retrySafe && attempt + 1 < maxAttempts) {
          await wait(500 * (attempt + 1));
          continue;
        }
        throw new Error('El servidor respondió con un formato inesperado. Compruebe el estado antes de volver a fichar.');
      }
    }
  }

  function createRequestId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return 'req_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2);
  }

  const PENDING_MOTION_KEY = 'ca_pending_motion_v1';

  async function registrarMovimiento(email, fp, lat, lng, tipoEsperado, accuracy) {
    let pending = null;
    try {
      pending = JSON.parse(localStorage.getItem(PENDING_MOTION_KEY) || 'null');
    } catch (_) {}

    if (!pending || pending.email !== email || pending.tipo !== tipoEsperado || Date.now() - pending.createdAt > 6 * 60 * 60 * 1000) {
      pending = { requestId: createRequestId(), email, tipo: tipoEsperado, createdAt: Date.now() };
      try { localStorage.setItem(PENDING_MOTION_KEY, JSON.stringify(pending)); } catch (_) {}
    }

    const result = await call('registrarMovimiento', {
      email,
      fingerprintId: fp,
      lat,
      lng,
      accuracy,
      requestId: pending.requestId
    }, true);

    try {
      const current = JSON.parse(localStorage.getItem(PENDING_MOTION_KEY) || 'null');
      if (current && current.requestId === pending.requestId) localStorage.removeItem(PENDING_MOTION_KEY);
    } catch (_) {}
    return result;
  }

  // ---- Empleado ----
  const verificarEmpleado   = (email, fp, lat, lng, accuracy) => call('verificarEmpleado', { email, fingerprintId: fp, lat, lng, accuracy }, true);
  const obtenerEstado       = (email, fp)           => call('obtenerEstado',       { email, fingerprintId: fp });
  const getConfig           = ()                    => call('getConfig');

  // ---- Admin ----
  const obtenerEmpleados    = (adm)                 => call('obtenerEmpleados',    { adminEmail: adm });
  const agregarEmpleado     = (adm, emp)            => call('agregarEmpleado',     { adminEmail: adm, empleado: emp });
  const actualizarEmpleado  = (adm, email, c, v)   => call('actualizarEmpleado',  { adminEmail: adm, email, campo: c, valor: v });
  const resetearDispositivo = (adm, emailEmp)       => call('resetearDispositivo', { adminEmail: adm, emailEmpleado: emailEmp });
  const obtenerReporte      = (adm, filtros)        => call('obtenerReporte',      { adminEmail: adm, filtros });
  const actualizarConfig    = (adm, config)         => call('actualizarConfig',    { adminEmail: adm, config });

  return {
    verificarEmpleado, registrarMovimiento, obtenerEstado, getConfig,
    obtenerEmpleados, agregarEmpleado, actualizarEmpleado,
    resetearDispositivo, obtenerReporte, actualizarConfig
  };
})();
