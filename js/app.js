// ============================================================
// APP.JS — Lógica de la app del empleado (check-in / check-out)
// ============================================================

const App = (() => {

  let _state = {
    user:        null,
    fingerprint: null,
    location:    null,
    empleado:    null
  };

  // ---- Inactividad: 5 min sin acción → vuelve al inicio ----
  const INACTIVITY_MS = 5 * 60 * 1000;
  let _inactivityTimer = null;
  let _clockInterval   = null;

  function _resetInactivity() {
    clearTimeout(_inactivityTimer);
    _inactivityTimer = setTimeout(() => {
      const activa = document.querySelector('.view:not(.hidden)');
      if (activa && ['view-confirm', 'view-signin', 'view-error'].includes(activa.id)) {
        Auth.signOut();
        window.location.reload();
      }
    }, INACTIVITY_MS);
  }

  function _initInactivity() {
    ['click', 'touchstart', 'keydown'].forEach(ev =>
      document.addEventListener(ev, _resetInactivity, { passive: true })
    );
    _resetInactivity();
  }

  // ---- Reloj en vivo ----
  function _startClock(elementId) {
    clearInterval(_clockInterval);
    const el = document.getElementById(elementId);
    if (!el) return;
    const tick = () => {
      const now = new Date();
      el.textContent =
        String(now.getHours()).padStart(2, '0')   + ':' +
        String(now.getMinutes()).padStart(2, '0') + ':' +
        String(now.getSeconds()).padStart(2, '0');
    };
    tick();
    _clockInterval = setInterval(tick, 1000);
  }

  function _stopClock() {
    clearInterval(_clockInterval);
    _clockInterval = null;
  }

  // ---- Vistas ----
  function showView(id) {
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    const el = document.getElementById(id);
    if (el) el.classList.remove('hidden');
    window.scrollTo(0, 0);
    _resetInactivity();
    if (id !== 'view-confirm') _stopClock();
  }

  function setLoading(text = 'Procesando...', step = '') {
    const tEl = document.getElementById('loading-text');
    const sEl = document.getElementById('loading-step');
    const sTxt = document.getElementById('loading-step-txt');
    if (tEl) tEl.textContent = text;
    if (sEl && sTxt) {
      if (step) { sTxt.textContent = step; sEl.style.display = 'inline-flex'; }
      else       { sEl.style.display = 'none'; }
    }
    showView('view-loading');
  }

  function showError(msg, title = 'Error', showRetry = true) {
    setText('error-title', title);
    const mEl = document.getElementById('error-msg');
    if (mEl) mEl.textContent = msg;
    const rBtn = document.getElementById('btn-retry');
    if (rBtn) rBtn.style.display = showRetry ? '' : 'none';
    showView('view-error');
  }

  // ---- Flujo ----
  async function init() {
    _initInactivity();

    // Aplicar nombre de empresa desde config
    const appName = (window.APP_CONFIG || {}).APP_NAME || 'Control de Acceso';
    ['loading-app-name', 'signin-app-title'].forEach(id => setText(id, appName));

    setLoading('Iniciando aplicación...', 'Cargando sistema');

    try {
      await Auth.init();
      const user = Auth.getUser();
      if (user) {
        _state.user = user;
        await proceed();
      } else {
        showView('view-signin');
        Auth.renderButton('google-btn-container');
        window.__onAuthSuccess = async (u) => { _state.user = u; await proceed(); };
        google.accounts.id.prompt();
      }
    } catch (err) {
      showError(err.message, 'Error de inicio');
    }
  }

  async function proceed() {
    try {
      setLoading('Generando huella del dispositivo...', 'Paso 1 de 3');
      _state.fingerprint = await Fingerprint.generate();

      setLoading('Obteniendo ubicación GPS...', 'Paso 2 de 3');
      try {
        _state.location = await Geo.getCurrentPosition();
      } catch (geoErr) {
        _state.location = null;
        console.warn('GPS:', geoErr.message);
      }

      setLoading('Verificando empleado...', 'Paso 3 de 3');
      const { lat, lng } = _state.location || {};
      const verif = await API.verificarEmpleado(
        _state.user.email,
        _state.fingerprint,
        lat, lng
      );

      if (!verif.success) {
        const titles = {
          DEVICE_MISMATCH: 'Dispositivo no autorizado',
          OUT_OF_GEOFENCE: 'Fuera del área permitida'
        };
        showError(verif.error, titles[verif.errorCode] || 'Verificación fallida', true);
        return;
      }

      _state.empleado = verif.empleado;
      _showConfirmation();

    } catch (err) {
      showError(
        'Error de conexión. Verifique su acceso a internet e intente nuevamente.\n\n' + err.message
      );
    }
  }

  function _showConfirmation() {
    const emp      = _state.empleado;
    const isDentro = emp.estado === 'Dentro';

    // Avatar con iniciales
    const initials = ((emp.nombre || '?')[0] + (emp.apellido || '?')[0]).toUpperCase();
    setText('confirm-avatar', initials);

    setText('confirm-nombre', `${emp.nombre} ${emp.apellido}`);

    const sectorPill = document.getElementById('confirm-sector-pill');
    const turnoPill  = document.getElementById('confirm-turno-pill');
    if (sectorPill) sectorPill.textContent = emp.sector || 'Sin sector';
    if (turnoPill) {
      if (emp.turno) {
        turnoPill.textContent = emp.turno;
        turnoPill.style.display = '';
      } else {
        turnoPill.style.display = 'none';
      }
    }

    const badge = document.getElementById('confirm-estado-badge');
    if (badge) {
      badge.textContent = isDentro ? '● DENTRO' : '● FUERA';
      badge.className   = 'estado-badge ' + (isDentro ? 'badge-dentro' : 'badge-fuera');
    }

    const btn = document.getElementById('btn-confirmar');
    if (btn) {
      btn.textContent = isDentro ? '📤 Registrar SALIDA' : '📥 Registrar ENTRADA';
      btn.className   = 'btn ' + (isDentro ? 'btn-danger' : 'btn-success') + ' btn-lg btn-full';
      btn.disabled    = false;
      btn.onclick     = registrar;
    }

    const btnCancelar = document.getElementById('btn-cancelar');
    if (btnCancelar) btnCancelar.onclick = () => { Auth.signOut(); window.location.reload(); };

    showView('view-confirm');
    _startClock('confirm-live-time');
  }

  async function registrar() {
    const btnConf = document.getElementById('btn-confirmar');
    if (btnConf) btnConf.disabled = true;
    _stopClock();

    setLoading('Registrando...', 'Guardando en planilla');

    try {
      const { lat, lng } = _state.location || {};
      const result = await API.registrarMovimiento(
        _state.user.email,
        _state.fingerprint,
        lat, lng
      );

      if (!result.success) {
        if (btnConf) btnConf.disabled = false;
        showError(result.error, 'Error al registrar');
        return;
      }

      _showSuccess(result);

    } catch (err) {
      if (btnConf) btnConf.disabled = false;
      showError('No se pudo conectar con el servidor.\n' + err.message);
    }
  }

  function _showSuccess(result) {
    const isIngreso = result.tipo === 'ingreso';

    // Icono y clase del contenedor
    const iconWrap = document.getElementById('success-icon-wrap');
    if (iconWrap) {
      iconWrap.className = 'success-icon-wrap ' + (isIngreso ? 'success-icon-ingreso' : 'success-icon-egreso');
    }

    // Fondo del view según tipo
    const view = document.getElementById('view-success');
    if (view) {
      view.classList.remove('success-bg-ingreso', 'success-bg-egreso');
      view.classList.add(isIngreso ? 'success-bg-ingreso' : 'success-bg-egreso');
    }

    setText('success-icon',   isIngreso ? '✅' : '👋');
    setText('success-titulo', isIngreso ? '¡Ingreso registrado!' : '¡Salida registrada!');
    setText('success-nombre', `${result.empleado.nombre} ${result.empleado.apellido}`);
    setText('success-hora',   result.hora);
    setText('success-fecha',  `${result.fecha} — ${result.diaSemana || ''}`);

    const sectTag = document.getElementById('success-sector');
    if (sectTag) sectTag.textContent = '📋 ' + (result.empleado.sector || '—');

    // Duración (solo en salidas)
    const durContainer = document.getElementById('success-duracion-container');
    if (durContainer) {
      if (!isIngreso && result.duracionFormato) {
        setText('success-duracion', result.duracionFormato);
        durContainer.classList.remove('hidden');
        durContainer.style.display = 'flex';
      } else {
        durContainer.classList.add('hidden');
      }
    }

    // Color del countdown fill
    const fill = document.getElementById('countdown-fill');
    if (fill) {
      fill.className = 'countdown-fill ' + (isIngreso ? 'countdown-fill-green' : '');
    }

    showView('view-success');

    // Ingreso: 5s — Salida: 10s para leer la duración
    _startCountdown(isIngreso ? 5 : 10);
  }

  function _startCountdown(total) {
    let remaining = total;
    const numEl   = document.getElementById('countdown');
    const fillEl  = document.getElementById('countdown-fill');

    const update = () => {
      if (numEl) numEl.textContent = remaining;
      if (fillEl) fillEl.style.width = ((remaining / total) * 100) + '%';
    };

    update();

    const iv = setInterval(() => {
      remaining--;
      update();
      if (remaining <= 0) {
        clearInterval(iv);
        Auth.signOut();
        window.location.reload();
      }
    }, 1000);
  }

  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  return { init };
})();
