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

  // Temporizador de inactividad: si la app queda abierta sin acción,
  // vuelve sola a la pantalla de inicio después de INACTIVITY_MS ms.
  const INACTIVITY_MS = 5 * 60 * 1000; // 5 minutos
  let _inactivityTimer = null;

  function _resetInactivity() {
    clearTimeout(_inactivityTimer);
    _inactivityTimer = setTimeout(() => {
      // Solo actuar si estamos en una pantalla "de espera" (no cargando o procesando)
      const activa = document.querySelector('.view:not(.hidden)');
      if (activa && ['view-confirm', 'view-signin', 'view-error'].includes(activa.id)) {
        Auth.signOut();
        window.location.reload();
      }
    }, INACTIVITY_MS);
  }

  // Arrancar el detector de inactividad ante cualquier toque o clic
  function _initInactivity() {
    ['click', 'touchstart', 'keydown'].forEach(ev =>
      document.addEventListener(ev, _resetInactivity, { passive: true })
    );
    _resetInactivity();
  }

  // ---- Gestión de vistas ----

  function showView(id) {
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    const el = document.getElementById(id);
    if (el) el.classList.remove('hidden');
    window.scrollTo(0, 0);
    _resetInactivity();
  }

  function setLoading(text = 'Procesando...') {
    const el = document.getElementById('loading-text');
    if (el) el.textContent = text;
    showView('view-loading');
  }

  function showError(msg, title = 'Error', showRetry = true) {
    const tEl = document.getElementById('error-title');
    const mEl = document.getElementById('error-msg');
    const rBtn = document.getElementById('btn-retry');
    if (tEl) tEl.textContent = title;
    if (mEl) mEl.textContent = msg;
    if (rBtn) rBtn.style.display = showRetry ? 'inline-flex' : 'none';
    showView('view-error');
  }

  // ---- Flujo principal ----

  async function init() {
    _initInactivity();
    setLoading('Iniciando aplicación...');

    try {
      await Auth.init();

      const user = Auth.getUser();
      if (user) {
        _state.user = user;
        await proceed();
      } else {
        showView('view-signin');
        Auth.renderButton('google-btn-container');

        window.__onAuthSuccess = async (u) => {
          _state.user = u;
          await proceed();
        };

        google.accounts.id.prompt();
      }
    } catch (err) {
      showError(err.message, 'Error de inicio');
    }
  }

  async function proceed() {
    try {
      setLoading('Generando huella del dispositivo...');
      _state.fingerprint = await Fingerprint.generate();

      setLoading('Obteniendo ubicación GPS...');
      try {
        _state.location = await Geo.getCurrentPosition();
      } catch (geoErr) {
        _state.location = null;
        console.warn('GPS no disponible:', geoErr.message);
      }

      setLoading('Verificando empleado...');
      const { lat, lng } = _state.location || {};

      const verif = await API.verificarEmpleado(
        _state.user.email,
        _state.fingerprint,
        lat, lng
      );

      if (!verif.success) {
        const titles = {
          DEVICE_MISMATCH:  'Dispositivo no autorizado',
          OUT_OF_GEOFENCE:  'Fuera del área permitida'
        };
        showError(verif.error, titles[verif.errorCode] || 'Verificación fallida', true);
        return;
      }

      _state.empleado = verif.empleado;
      _showConfirmation();

    } catch (err) {
      showError('Error de conexión. Verifique su acceso a internet e intente nuevamente.\n\nDetalle: ' + err.message);
    }
  }

  function _showConfirmation() {
    const emp      = _state.empleado;
    const isDentro = emp.estado === 'Dentro';

    setText('confirm-nombre',       `${emp.nombre} ${emp.apellido}`);
    setText('confirm-sector',       emp.sector || '—');
    setText('confirm-turno',        emp.turno  || '—');
    setText('confirm-estado-badge', isDentro ? 'DENTRO' : 'FUERA');

    const estadoBadge = document.getElementById('confirm-estado-badge');
    if (estadoBadge) {
      estadoBadge.className = 'estado-badge ' + (isDentro ? 'badge-dentro' : 'badge-fuera');
    }

    const btnTipo = document.getElementById('btn-confirmar');
    if (btnTipo) {
      btnTipo.textContent = isDentro ? '📤 Registrar SALIDA' : '📥 Registrar ENTRADA';
      btnTipo.className   = 'btn ' + (isDentro ? 'btn-danger' : 'btn-success') + ' btn-lg btn-full';
      btnTipo.disabled    = false;
      btnTipo.onclick     = registrar;
    }

    const btnCancelar = document.getElementById('btn-cancelar');
    if (btnCancelar) btnCancelar.onclick = () => { Auth.signOut(); window.location.reload(); };

    showView('view-confirm');
  }

  async function registrar() {
    const btnConf = document.getElementById('btn-confirmar');
    if (btnConf) btnConf.disabled = true;

    setLoading('Registrando...');

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
      showError('No se pudo conectar con el servidor. ' + err.message);
    }
  }

  function _showSuccess(result) {
    const isIngreso = result.tipo === 'ingreso';

    setText('success-icon',   isIngreso ? '✅' : '👋');
    setText('success-titulo', isIngreso ? '¡Ingreso registrado!' : '¡Salida registrada!');
    setText('success-nombre', `${result.empleado.nombre} ${result.empleado.apellido}`);
    setText('success-hora',   result.hora);
    setText('success-fecha',  `${result.fecha} — ${result.diaSemana || ''}`);
    setText('success-sector', result.empleado.sector || '');

    const durContainer = document.getElementById('success-duracion-container');
    if (durContainer) {
      if (!isIngreso && result.duracionFormato) {
        setText('success-duracion', result.duracionFormato);
        durContainer.classList.remove('hidden');
      } else {
        durContainer.classList.add('hidden');
      }
    }

    showView('view-success');

    // Ingreso: 5s para ver el mensaje. Salida: 10s para leer la duración.
    const delay = isIngreso ? 5 : 10;
    _startCountdown(delay);
  }

  function _startCountdown(secs) {
    let remaining = secs;
    setText('countdown', remaining);

    const iv = setInterval(() => {
      remaining--;
      setText('countdown', remaining);
      if (remaining <= 0) {
        clearInterval(iv);
        // Volver a la pantalla de inicio (vista signin) listos para el próximo empleado
        Auth.signOut();
        window.location.reload();
      }
    }, 1000);
  }

  // ---- Utils ----

  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  return { init };
})();
