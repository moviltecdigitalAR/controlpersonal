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

  // ---- Gestión de vistas ----

  function showView(id) {
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    const el = document.getElementById(id);
    if (el) el.classList.remove('hidden');
    window.scrollTo(0, 0);
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

        // One Tap automático
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
        // Si falla el GPS y el servidor tiene geofencing activo,
        // el GAS lo rechazará. Si no tiene geofencing, continúa.
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
    const emp       = _state.empleado;
    const isDentro  = emp.estado === 'Dentro';

    setText('confirm-nombre',  `${emp.nombre} ${emp.apellido}`);
    setText('confirm-sector',  emp.sector || '—');
    setText('confirm-turno',   emp.turno  || '—');
    setText('confirm-estado-badge', isDentro ? 'DENTRO' : 'FUERA');

    const estadoBadge = document.getElementById('confirm-estado-badge');
    if (estadoBadge) {
      estadoBadge.className = 'estado-badge ' + (isDentro ? 'badge-dentro' : 'badge-fuera');
    }

    const btnTipo = document.getElementById('btn-confirmar');
    if (btnTipo) {
      btnTipo.textContent = isDentro ? '📤 Registrar SALIDA' : '📥 Registrar ENTRADA';
      btnTipo.className   = 'btn ' + (isDentro ? 'btn-danger' : 'btn-success') + ' btn-lg btn-full';
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
    _startCountdown();
  }

  function _startCountdown() {
    let secs = Math.round(window.APP_CONFIG.AUTO_CLOSE_DELAY / 1000);
    setText('countdown', secs);

    const iv = setInterval(() => {
      secs--;
      setText('countdown', secs);
      if (secs <= 0) {
        clearInterval(iv);
        showView('view-goodbye');
        // Intentar cerrar la pestaña (funciona si fue abierta por JS)
        setTimeout(() => { try { window.close(); } catch (_) {} }, 600);
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
