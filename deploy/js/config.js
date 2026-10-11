// ============================================================
// CONFIGURACIÓN DE LA APLICACIÓN
// Reemplazar estos valores luego de completar el setup (ver SETUP.md)
// ============================================================

window.APP_CONFIG = {

  // Google OAuth 2.0 Client ID
  // Obtener en: console.cloud.google.com → APIs y servicios → Credenciales
  // Formato: XXXXX.apps.googleusercontent.com
  GOOGLE_CLIENT_ID: '436729901852-ck4sgvmu8bji8522pknj1b40eq8u60kn.apps.googleusercontent.com',

  // URL del Web App de Google Apps Script (backend)
  // Obtener luego de desplegar Code.gs como Web App
  // Formato: https://script.google.com/macros/s/XXXXXXXX/exec
  GAS_URL: 'https://script.google.com/macros/s/AKfycbwRbNIB7tMNAGmMNoRIiViS4WW35AV58MnPAvYOyyJl4n87CU7SmxggJ-pGuNrGqiXZ/exec',

  // Nombre del producto (aparece en la pantalla y en el título de la pestaña)
  APP_NAME: 'Control Personal para Proveedores Mineros',

  // Variante del producto:
  //   'mineria' → todos los módulos (incluye Habilitaciones, Reemplazos, Vehículos)
  //   'general' → edición para colegios, comercios y empresas en general
  //               (oculta Habilitaciones, Reemplazos y Vehículos)
  VARIANTE: 'mineria',

  // Segundos de countdown antes de cerrar la pantalla del empleado
  AUTO_CLOSE_DELAY: 5000,

};

// Validación rápida para evitar olvidar la configuración
(function validateConfig() {
  const cfg = window.APP_CONFIG || {};
  const placeholders = [
    'TU_CLIENT_ID_AQUI.apps.googleusercontent.com',
    'https://script.google.com/macros/s/TU_ID_DE_DEPLOY/exec'
  ];
  const isPlaceholder = v => !v || placeholders.some(p => v.includes(p));
  if (isPlaceholder(cfg.GOOGLE_CLIENT_ID) || isPlaceholder(cfg.GAS_URL)) {
    console.error('[CONFIG] ERROR: config.js aún tiene valores de ejemplo. Reemplace GOOGLE_CLIENT_ID y GAS_URL con los valores reales del setup.');
  }
})();
