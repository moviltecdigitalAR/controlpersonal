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
    if (typeof google !== 'undefined') google.accounts.id.disableAutoSelect();
  }

  return { init, signIn, renderButton, getUser, isSignedIn, signOut };
})();
