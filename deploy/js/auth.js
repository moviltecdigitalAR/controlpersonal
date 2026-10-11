// ============================================================
// AUTENTICACIÓN CON GOOGLE (Google Identity Services)
// ============================================================

const Auth = (() => {

  const SESSION_KEY = 'ca_auth_user';
  let _resolveSign  = null;

  // Inicializar GIS
  function init() {
    return new Promise((resolve, reject) => {
      waitForGoogle()
        .then(() => {
          google.accounts.id.initialize({
            client_id:             window.APP_CONFIG.GOOGLE_CLIENT_ID,
            callback:              _handleCredential,
            auto_select:           false,
            cancel_on_tap_outside: false,
            // FedCM es requerido en navegadores modernos (Chrome 117+)
            use_fedcm_for_prompt:  true
          });
          resolve();
        })
        .catch(reject);
    });
  }

  // Procesar credencial JWT de Google
  function _handleCredential(response) {
    try {
      const payload = JSON.parse(atob(response.credential.split('.')[1]));
      const user = {
        email:      payload.email,
        name:       payload.name,
        picture:    payload.picture,
        credential: response.credential
      };
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(user));
      if (_resolveSign) {
        _resolveSign(user);
        _resolveSign = null;
      }
      if (window.__onAuthSuccess) window.__onAuthSuccess(user);
    } catch (e) {
      console.error('Error decodificando credencial:', e);
    }
  }

  // Esperar a que la librería de Google cargue
  function waitForGoogle() {
    return new Promise((resolve, reject) => {
      if (typeof google !== 'undefined' && google.accounts) { resolve(); return; }
      let tries = 0;
      const iv = setInterval(() => {
        tries++;
        if (typeof google !== 'undefined' && google.accounts) {
          clearInterval(iv);
          resolve();
        } else if (tries > 60) {
          clearInterval(iv);
          reject(new Error('No se pudo cargar Google Identity Services. Verifique su conexión a internet.'));
        }
      }, 200);
    });
  }

  // Mostrar botón de inicio de sesión
  function renderButton(containerId = 'google-btn-container') {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = '';
    google.accounts.id.renderButton(el, {
      type:   'standard',
      theme:  'outline',
      size:   'large',
      locale: 'es',
      text:   'signin_with',
      width:  280
    });
  }

  // Iniciar sesión (muestra One Tap o botón)
  function signIn() {
    return new Promise((resolve) => {
      window.__onAuthSuccess = resolve;
      google.accounts.id.prompt(notification => {
        // Si One Tap no está disponible, el botón renderizado tomará el control
        if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
          renderButton();
        }
      });
    });
  }

  function getUser()     { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch { return null; } }
  function isSignedIn()  { return !!getUser(); }

  function signOut() {
    sessionStorage.removeItem(SESSION_KEY);
    clearAdminToken();
    if (typeof google !== 'undefined') google.accounts.id.disableAutoSelect();
  }

  // ============================================================
  // SESIÓN DE ADMINISTRADOR (token firmado del backend)
  // ============================================================
  // Después de entrar con Google, el admin valida una contraseña y el
  // servidor devuelve un token HMAC firmado con expiración (12h).
  // Ese token acompaña TODAS las acciones admin: sin él, el backend
  // rechaza. Nunca se guarda en localStorage (solo sessionStorage,
  // se borra al cerrar la pestaña).

  const ADMIN_TOKEN_KEY = 'ca_admin_token';

  function getAdminToken() {
    try { return sessionStorage.getItem(ADMIN_TOKEN_KEY) || null; } catch { return null; }
  }
  function setAdminToken(t) {
    try { sessionStorage.setItem(ADMIN_TOKEN_KEY, t); } catch (_) {}
  }
  function clearAdminToken() {
    try { sessionStorage.removeItem(ADMIN_TOKEN_KEY); } catch (_) {}
  }
  function hasAdminSession() { return !!getAdminToken(); }

  // Login admin: Google ya validó el email; acá pedimos la contraseña
  // al backend, que verifica el hash y devuelve el token firmado.
  async function adminLogin(email, password) {
    const r = await API.call('loginAdmin', { email, password });
    if (!r.success) return r;
    setAdminToken(r.token);
    return r;
  }

  // Validar que el token guardado siga vigente (al recargar la página)
  async function validarAdminSession() {
    const token = getAdminToken();
    if (!token) return { success: false };
    const r = await API.call('validarToken', { token });
    if (!r.success) clearAdminToken();
    return r;
  }

  async function adminLogout() {
    const token = getAdminToken();
    if (token) { try { await API.call('logoutAdmin', { token }); } catch (_) {} }
    clearAdminToken();
  }

  return { init, signIn, renderButton, getUser, isSignedIn, signOut,
           getAdminToken, adminLogin, validarAdminSession, hasAdminSession, adminLogout };
})();
