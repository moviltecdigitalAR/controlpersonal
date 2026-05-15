// ============================================================
// DASHBOARD.JS — Panel del empleador (admin)
// ============================================================

const Dashboard = (() => {

  let _admin     = null;
  let _empleados = [];
  let _registros = [];
  let _config    = {};
  let _activeTab = 'overview';

  // ============================================================
  // INIT
  // ============================================================

  async function init() {
    _showAdminView();
    _setLoading(true, 'Iniciando panel de administración...');

    try {
      await Auth.init();

      const user = Auth.getUser();
      if (user) {
        await _onAdminAuth(user);
      } else {
        _setLoading(false);
        _showSection('admin-login');
        Auth.renderButton('admin-google-btn');
        window.__onAuthSuccess = _onAdminAuth;
        google.accounts.id.prompt();
      }
    } catch (err) {
      _showAdminError(err.message);
    }
  }

  async function _onAdminAuth(user) {
    _setLoading(true, 'Verificando permisos...');
    try {
      const cfg = await API.getConfig();
      if (cfg.success) _config = cfg.config;

      // Verificar que el email tiene permisos admin en Sheets
      const empResult = await API.obtenerEmpleados(user.email);
      if (!empResult.success) {
        _showAdminError('Sin permisos de administrador. Verifique que su email esté marcado como Es_Admin=TRUE en la planilla.');
        Auth.signOut();
        return;
      }

      _admin     = user;
      _empleados = empResult.empleados;

      setText('admin-user-name',    _admin.name || _admin.email);
      setText('admin-user-email',   _admin.email);
      if (_admin.picture) {
        const img = document.getElementById('admin-avatar');
        if (img) img.src = _admin.picture;
      }

      _setLoading(false);
      _showSection('admin-dashboard');
      _setupTabs();
      _loadTab('overview');

    } catch (err) {
      _showAdminError('Error al conectar: ' + err.message);
    }
  }

  // ============================================================
  // TABS
  // ============================================================

  function _setupTabs() {
    document.querySelectorAll('[data-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        _loadTab(btn.dataset.tab);
      });
    });
  }

  function _loadTab(tab) {
    _activeTab = tab;

    document.querySelectorAll('[data-tab]').forEach(btn => {
      btn.classList.toggle('tab-active', btn.dataset.tab === tab);
    });
    document.querySelectorAll('.tab-pane').forEach(pane => {
      pane.classList.toggle('hidden', pane.dataset.tabPane !== tab);
    });

    switch (tab) {
      case 'overview':   _renderOverview();   break;
      case 'employees':  _renderEmpleados();  break;
      case 'records':    _renderRegistros();  break;
      case 'reports':    _renderInformes();   break;
      case 'settings':   _renderConfig();     break;
    }
  }

  // ============================================================
  // OVERVIEW
  // ============================================================

  async function _renderOverview() {
    const today = _fmtFecha(new Date());

    // Recargar datos
    const [empR, regR] = await Promise.all([
      API.obtenerEmpleados(_admin.email),
      API.obtenerReporte(_admin.email, { fechaDesde: today, fechaHasta: today })
    ]);

    if (empR.success)  _empleados = empR.empleados;
    if (regR.success) { _registros = regR.registros; }

    const dentro   = _empleados.filter(e => e.estado === 'Dentro').length;
    const fuera    = _empleados.filter(e => e.estado !== 'Dentro' && e.activo).length;
    const total    = _empleados.filter(e => e.activo).length;
    const hoy      = _registros.filter(r => r.fecha === today).length;
    const abiertos = _registros.filter(r => r.fecha === today && r.horaEgreso === '').length;

    setText('ov-dentro',   dentro);
    setText('ov-fuera',    fuera);
    setText('ov-total',    total);
    setText('ov-hoy',      hoy);
    setText('ov-abiertos', abiertos);
    setText('ov-fecha',    'Hoy: ' + today);

    // Tabla de presentes
    const tbody = document.getElementById('ov-presentes-tbody');
    if (tbody) {
      const presentes = _empleados.filter(e => e.estado === 'Dentro');
      tbody.innerHTML = presentes.length === 0
        ? '<tr><td colspan="4" class="text-center text-muted">Sin empleados dentro del establecimiento</td></tr>'
        : presentes.map(e => `
            <tr>
              <td>${e.nombre} ${e.apellido}</td>
              <td>${e.sector || '—'}</td>
              <td>${e.turno || '—'}</td>
              <td><span class="badge badge-success">Dentro</span></td>
            </tr>`).join('');
    }

    // Últimos registros del día
    const todayRegs = _registros.filter(r => r.fecha === today).slice(-10).reverse();
    const rTbody = document.getElementById('ov-registros-tbody');
    if (rTbody) {
      rTbody.innerHTML = todayRegs.length === 0
        ? '<tr><td colspan="5" class="text-center text-muted">Sin registros hoy</td></tr>'
        : todayRegs.map(r => `
            <tr>
              <td>${r.nombre} ${r.apellido}</td>
              <td>${r.sector || '—'}</td>
              <td>${r.horaIngreso || '—'}</td>
              <td>${r.horaEgreso  || '<span class="text-warning">Pendiente</span>'}</td>
              <td>${r.duracionMin ? _fmtDur(r.duracionMin) : '—'}</td>
            </tr>`).join('');
    }
  }

  // ============================================================
  // EMPLEADOS
  // ============================================================

  async function _renderEmpleados(filter = '') {
    const result = await API.obtenerEmpleados(_admin.email);
    if (result.success) _empleados = result.empleados;

    const lista = filter
      ? _empleados.filter(e =>
          (e.nombre + ' ' + e.apellido + ' ' + e.email + ' ' + e.sector).toLowerCase().includes(filter.toLowerCase()))
      : _empleados;

    const tbody = document.getElementById('emp-tbody');
    if (!tbody) return;

    tbody.innerHTML = lista.length === 0
      ? '<tr><td colspan="7" class="text-center text-muted">No hay empleados</td></tr>'
      : lista.map(e => `
          <tr>
            <td>
              <div class="emp-name">${e.nombre} ${e.apellido}</div>
              <div class="text-small text-muted">${e.email}</div>
            </td>
            <td>${e.sector || '—'}</td>
            <td>${e.turno  || '—'}</td>
            <td>
              <span class="badge ${e.estado === 'Dentro' ? 'badge-success' : 'badge-secondary'}">
                ${e.estado || 'Fuera'}
              </span>
            </td>
            <td>
              <span class="badge ${e.activo ? 'badge-success' : 'badge-danger'}">
                ${e.activo ? 'Activo' : 'Inactivo'}
              </span>
            </td>
            <td>
              <span class="badge ${e.tieneDispositivo ? 'badge-info' : 'badge-secondary'}">
                ${e.tieneDispositivo ? 'Vinculado' : 'Sin vincular'}
              </span>
            </td>
            <td class="actions-cell">
              ${e.tieneDispositivo ? `<button class="btn btn-sm btn-warning" onclick="Dashboard.resetDispositivo('${e.email}')">🔄 Reset</button>` : ''}
              <button class="btn btn-sm ${e.activo ? 'btn-danger' : 'btn-success'}"
                onclick="Dashboard.toggleActivo('${e.email}', ${!e.activo})">
                ${e.activo ? 'Desactivar' : 'Activar'}
              </button>
            </td>
          </tr>`).join('');

    // Search handler
    const searchEl = document.getElementById('emp-search');
    if (searchEl && !searchEl._bound) {
      searchEl._bound = true;
      searchEl.addEventListener('input', () => _renderEmpleados(searchEl.value));
    }
  }

  async function resetDispositivo(email) {
    if (!confirm(`¿Resetear el dispositivo vinculado de ${email}? El empleado podrá vincular uno nuevo en su próximo acceso.`)) return;
    const r = await API.resetearDispositivo(_admin.email, email);
    alert(r.success ? r.message : 'Error: ' + r.error);
    if (r.success) _renderEmpleados();
  }

  async function toggleActivo(email, nuevoEstado) {
    const accion = nuevoEstado ? 'activar' : 'desactivar';
    if (!confirm(`¿Desea ${accion} al empleado ${email}?`)) return;
    const r = await API.actualizarEmpleado(_admin.email, email, 'activo', nuevoEstado);
    if (r.success) _renderEmpleados();
    else alert('Error: ' + r.error);
  }

  function _setupAgregarEmpleado() {
    const form = document.getElementById('form-agregar-empleado');
    if (!form || form._bound) return;
    form._bound = true;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(form));
      data.esAdmin = form.querySelector('[name="esAdmin"]').checked;
      const r = await API.agregarEmpleado(_admin.email, data);
      const msg = document.getElementById('msg-agregar');
      if (msg) {
        msg.textContent  = r.success ? r.message : 'Error: ' + r.error;
        msg.className    = r.success ? 'form-msg success' : 'form-msg error';
      }
      if (r.success) { form.reset(); _renderEmpleados(); }
    });
  }

  // ============================================================
  // REGISTROS
  // ============================================================

  async function _renderRegistros() {
    const filtros = _getRegistrosFiltros();
    const result  = await API.obtenerReporte(_admin.email, filtros);
    if (result.success) _registros = result.registros;

    const tbody = document.getElementById('reg-tbody');
    if (!tbody) return;

    tbody.innerHTML = _registros.length === 0
      ? '<tr><td colspan="6" class="text-center text-muted">Sin registros para los filtros seleccionados</td></tr>'
      : _registros.map(r => `
          <tr>
            <td>${r.fecha}</td>
            <td>
              <div class="emp-name">${r.nombre} ${r.apellido}</div>
              <div class="text-small text-muted">${r.sector || ''} ${r.turno ? '· ' + r.turno : ''}</div>
            </td>
            <td>${r.horaIngreso || '—'}</td>
            <td>${r.horaEgreso  || '<span class="text-warning">Pendiente</span>'}</td>
            <td>${r.duracionMin ? _fmtDur(r.duracionMin) : '—'}</td>
            <td>${r.diaSemana || '—'}</td>
          </tr>`).join('');

    setText('reg-count', `${_registros.length} registros`);

    // Bind filtros
    ['reg-f-email','reg-f-sector','reg-f-desde','reg-f-hasta'].forEach(id => {
      const el = document.getElementById(id);
      if (el && !el._bound) { el._bound = true; el.addEventListener('change', _renderRegistros); }
    });
    // Botón exportar
    const btnExp = document.getElementById('btn-export-reg');
    if (btnExp && !btnExp._bound) {
      btnExp._bound = true;
      btnExp.addEventListener('click', () => _exportCSV(_registros, 'registros'));
    }
  }

  function _getRegistrosFiltros() {
    const f = {};
    const email  = document.getElementById('reg-f-email');
    const sector = document.getElementById('reg-f-sector');
    const desde  = document.getElementById('reg-f-desde');
    const hasta  = document.getElementById('reg-f-hasta');
    if (email  && email.value)  f.email  = email.value;
    if (sector && sector.value) f.sector = sector.value;
    if (desde  && desde.value)  f.fechaDesde = _isoToDDMMYYYY(desde.value);
    if (hasta  && hasta.value)  f.fechaHasta = _isoToDDMMYYYY(hasta.value);
    return f;
  }

  // ============================================================
  // INFORMES
  // ============================================================

  async function _renderInformes() {
    const btnGenerar = document.getElementById('btn-generar-informe');
    if (btnGenerar && !btnGenerar._bound) {
      btnGenerar._bound = true;
      btnGenerar.addEventListener('click', _generarInforme);
    }
    // Poblar selector de empleados
    const selEmp = document.getElementById('inf-empleado');
    if (selEmp && _empleados.length > 0 && selEmp.options.length < 2) {
      _empleados.filter(e => e.activo).forEach(e => {
        const opt    = document.createElement('option');
        opt.value    = e.email;
        opt.textContent = `${e.nombre} ${e.apellido} (${e.sector || '—'})`;
        selEmp.appendChild(opt);
      });
    }
  }

  async function _generarInforme() {
    const periodo  = document.getElementById('inf-periodo')?.value;
    const emailEmp = document.getElementById('inf-empleado')?.value;

    const { desde, hasta } = _calcularPeriodo(periodo);

    const filtros = { fechaDesde: desde, fechaHasta: hasta };
    if (emailEmp) filtros.email = emailEmp;

    const loader = document.getElementById('inf-loader');
    if (loader) loader.classList.remove('hidden');

    const result = await API.obtenerReporte(_admin.email, filtros);

    if (loader) loader.classList.add('hidden');
    if (!result.success) { alert(result.error); return; }

    _renderResumenInforme(result.resumen, result.registros, periodo, desde, hasta);
  }

  function _calcularPeriodo(periodo) {
    const hoy  = new Date();
    const anio = hoy.getFullYear();
    const mes  = hoy.getMonth();

    let desde, hasta;
    if (periodo === 'q1') {
      desde = new Date(anio, mes, 1);
      hasta = new Date(anio, mes, 15);
    } else if (periodo === 'q2') {
      desde = new Date(anio, mes, 16);
      hasta = new Date(anio, mes + 1, 0);
    } else {  // mensual
      desde = new Date(anio, mes, 1);
      hasta = new Date(anio, mes + 1, 0);
    }
    return { desde: _fmtFecha(desde), hasta: _fmtFecha(hasta) };
  }

  function _renderResumenInforme(resumen, registros, periodo, desde, hasta) {
    const nPeriodo = { q1: '1ra Quincena', q2: '2da Quincena', mensual: 'Mensual' }[periodo] || periodo;
    setText('inf-titulo-resultado', `Informe ${nPeriodo} — ${desde} al ${hasta}`);

    const tbody = document.getElementById('inf-tbody');
    if (!tbody) return;

    tbody.innerHTML = resumen.length === 0
      ? '<tr><td colspan="6" class="text-center text-muted">Sin datos para el período</td></tr>'
      : resumen.map(e => `
          <tr>
            <td>
              <div class="emp-name">${e.nombre} ${e.apellido}</div>
              <div class="text-small text-muted">${e.sector || ''} ${e.turno ? '· ' + e.turno : ''}</div>
            </td>
            <td class="text-center"><strong>${e.diasAsistidos}</strong></td>
            <td class="text-center">${e.totalFormato}</td>
            <td class="text-center">${e.totalHoras}h</td>
            <td class="text-center">${_fmtDur(e.promedioDiarioMin)}</td>
            <td class="text-center">
              <button class="btn btn-sm btn-outline" onclick="Dashboard.verDetalleEmpleado('${e.email}')">
                Ver detalle
              </button>
            </td>
          </tr>`).join('');

    document.getElementById('inf-resultado')?.classList.remove('hidden');

    // Exportar
    const btnExp = document.getElementById('btn-export-inf');
    if (btnExp) {
      btnExp.onclick = () => _exportCSV(registros, `informe_${nPeriodo}_${desde}_${hasta}`);
    }
  }

  function verDetalleEmpleado(email) {
    // Filtrar y mostrar registros del empleado en la pestaña de registros
    document.getElementById('reg-f-email').value = email;
    _loadTab('records');
  }

  // ============================================================
  // CONFIGURACIÓN
  // ============================================================

  async function _renderConfig() {
    const r = await API.getConfig();
    if (r.success) _config = r.config;

    _setInput('cfg-nombre-empresa',  _config.nombre_empresa || '');
    _setInput('cfg-lat',             _config.lat_empresa    || '');
    _setInput('cfg-lng',             _config.lng_empresa    || '');
    _setInput('cfg-radio',           _config.radio_metros   || '200');

    const form = document.getElementById('form-config');
    if (form && !form._bound) {
      form._bound = true;
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const config = {
          nombre_empresa: document.getElementById('cfg-nombre-empresa')?.value,
          lat_empresa:    document.getElementById('cfg-lat')?.value,
          lng_empresa:    document.getElementById('cfg-lng')?.value,
          radio_metros:   document.getElementById('cfg-radio')?.value
        };
        const result = await API.actualizarConfig(_admin.email, config);
        const msg = document.getElementById('cfg-msg');
        if (msg) {
          msg.textContent = result.success ? '✅ Configuración guardada.' : '❌ Error: ' + result.error;
          msg.className   = result.success ? 'form-msg success' : 'form-msg error';
        }
      });
    }

    // Botón obtener mi ubicación
    const btnGPS = document.getElementById('btn-get-gps');
    if (btnGPS && !btnGPS._bound) {
      btnGPS._bound = true;
      btnGPS.addEventListener('click', async () => {
        btnGPS.textContent = 'Obteniendo GPS...';
        try {
          const pos = await Geo.getCurrentPosition();
          _setInput('cfg-lat', pos.lat.toFixed(7));
          _setInput('cfg-lng', pos.lng.toFixed(7));
          btnGPS.textContent = '📍 Ubicación obtenida';
        } catch (err) {
          alert('Error GPS: ' + err.message);
          btnGPS.textContent = '📍 Usar mi ubicación actual';
        }
      });
    }
  }

  // ============================================================
  // EXPORT CSV
  // ============================================================

  function _exportCSV(registros, nombre) {
    if (!registros || registros.length === 0) { alert('Sin datos para exportar.'); return; }

    const headers = ['Fecha', 'Dia', 'Email', 'Nombre', 'Apellido', 'Sector', 'Turno', 'Ingreso', 'Egreso', 'Duracion_Min', 'Duracion'];
    const rows = registros.map(r => [
      r.fecha, r.diaSemana || '', r.email, r.nombre, r.apellido,
      r.sector, r.turno, r.horaIngreso, r.horaEgreso,
      r.duracionMin, _fmtDur(r.duracionMin)
    ]);

    const csv     = [headers, ...rows].map(r => r.map(v => `"${String(v||'').replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob    = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url     = URL.createObjectURL(blob);
    const a       = document.createElement('a');
    a.href        = url;
    a.download    = `${nombre}_${_fmtFecha(new Date()).replace(/\//g,'-')}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ============================================================
  // HELPERS
  // ============================================================

  function _showAdminView() {
    document.getElementById('employee-app')?.classList.add('hidden');
    document.getElementById('admin-app')?.classList.remove('hidden');
  }

  function _showSection(id) {
    ['admin-login','admin-dashboard','admin-error'].forEach(s => {
      const el = document.getElementById(s);
      if (el) el.classList.toggle('hidden', s !== id);
    });
  }

  function _setLoading(show, text = '') {
    const el = document.getElementById('admin-loading');
    if (!el) return;
    el.classList.toggle('hidden', !show);
    const txt = el.querySelector('.loading-text');
    if (txt && text) txt.textContent = text;
    if (show) _showSection('_none');
  }

  function _showAdminError(msg) {
    _setLoading(false);
    setText('admin-error-msg', msg);
    _showSection('admin-error');
  }

  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function _setInput(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val;
  }

  function _fmtFecha(d) {
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yy = d.getFullYear();
    return `${dd}/${mm}/${yy}`;
  }

  function _fmtDur(min) {
    if (!min) return '0h 0m';
    return Math.floor(min / 60) + 'h ' + (min % 60) + 'm';
  }

  function _isoToDDMMYYYY(iso) {
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  }

  // Setup de tab empleados (agregar form)
  function _setupEmployeeTab() {
    _setupAgregarEmpleado();
  }

  // Exponer para onclick en HTML
  return {
    init,
    resetDispositivo,
    toggleActivo,
    verDetalleEmpleado,
    _setupEmployeeTab
  };
})();
