// ============================================================
// API — Llamadas al Google Apps Script Backend
// Usa Content-Type: text/plain para evitar CORS preflight
// ============================================================

const API = (() => {

  async function call(action, params = {}) {
    const url  = window.APP_CONFIG.GAS_URL;
    const body = JSON.stringify({ action, ...params });

    const resp = await fetch(url, {
      method:  'POST',
      body,
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }
    });

    if (!resp.ok) throw new Error(`Error HTTP ${resp.status}`);
    return resp.json();
  }

  // ---- Empleado ----
  const verificarEmpleado   = (email, fp, lat, lng) => call('verificarEmpleado',   { email, fingerprintId: fp, lat, lng });
  const registrarMovimiento = (email, fp, lat, lng) => call('registrarMovimiento', { email, fingerprintId: fp, lat, lng });
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
