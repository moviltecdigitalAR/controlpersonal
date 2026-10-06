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
    // Adjuntar el token de sesión admin a todas las acciones que lo
    // requieran. El backend lo verifica (firma HMAC + expiración) y
    // rechaza si no es válido. Las acciones públicas (login, fichada
    // de empleado) no llevan token.
    let payload = { action, ...params };
    // Adjuntar el token de sesión admin si existe. OJO: Auth es un const
    // global (no propiedad de window), se referencia directamente.
    if (!params.token && typeof Auth !== 'undefined' && typeof Auth.getAdminToken === 'function') {
      const t = Auth.getAdminToken();
      if (t) payload.token = t;
    }
    const body = JSON.stringify(payload);
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

  // ---- Novedades diarias (V, LC, EC, EB, PM, D, AJ, AI) ----
  const marcarNovedad   = (adm, email, fecha, fechaHasta, codigo, detalle) =>
    call('marcarNovedad', { adminEmail: adm, email, fecha, fechaHasta, codigo, detalle });
  const borrarNovedad   = (adm, email, fecha, fechaHasta) =>
    call('borrarNovedad', { adminEmail: adm, email, fecha, fechaHasta });
  const obtenerNovedades = (adm, filtros)           => call('obtenerNovedades',    { adminEmail: adm, ...filtros });

  // ---- Módulo Operación (ex-ShiftControl) ----
  const obtenerOperacion     = (adm)                => call('obtenerOperacion',     { adminEmail: adm });
  const obtenerTrazabilidad  = (adm)                => call('obtenerTrazabilidad',  { adminEmail: adm });
  const agregarVehiculo      = (adm, vehiculo)      => call('agregarVehiculo',      { adminEmail: adm, vehiculo });
  const actualizarVehiculo   = (adm, id, c, v)      => call('actualizarVehiculo',   { adminEmail: adm, id, campo: c, valor: v });
  const agregarEmpresa       = (adm, empresa)       => call('agregarEmpresa',       { adminEmail: adm, empresa });
  const actualizarEmpresa    = (adm, id, c, v)      => call('actualizarEmpresa',    { adminEmail: adm, id, campo: c, valor: v });
  const agregarObservacion   = (adm, observacion)   => call('agregarObservacion',   { adminEmail: adm, observacion });
  const resolverObservacion  = (adm, id)            => call('resolverObservacion',  { adminEmail: adm, id });
  const marcarAlertasLeidas  = (adm)                => call('marcarAlertasLeidas',  { adminEmail: adm });
  const registrarAusencia    = (adm, reemplazo)     => call('registrarAusencia',    { adminEmail: adm, reemplazo });
  const asignarReemplazo     = (adm, id, nombre)    => call('asignarReemplazo',     { adminEmail: adm, id, candidatoNombre: nombre });
  const descartarReemplazo   = (adm, id)            => call('descartarReemplazo',   { adminEmail: adm, id });

  return {
    verificarEmpleado, registrarMovimiento, obtenerEstado, getConfig,
    obtenerEmpleados, agregarEmpleado, actualizarEmpleado,
    resetearDispositivo, obtenerReporte, actualizarConfig,
    marcarNovedad, borrarNovedad, obtenerNovedades,
    obtenerOperacion, obtenerTrazabilidad,
    agregarVehiculo, actualizarVehiculo,
    agregarEmpresa, actualizarEmpresa,
    agregarObservacion, resolverObservacion, marcarAlertasLeidas,
    registrarAusencia, asignarReemplazo, descartarReemplazo
  };
})();
