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
      _admin = user;

      // 1) ¿Hay sesión admin válida (token vigente)? → entrar directo
      const sesion = await Auth.validarAdminSession();
      if (sesion.success) return await _entrarPanelConDatos();

      // 2) Sin token: pedir la contraseña (el backend valida email+pass
      //    y devuelve el token firmado)
      _setLoading(false);
      _pedirPassword(user.email);

    } catch (err) {
      _showAdminError('Error al conectar: ' + err.message);
    }
  }

  // Mostrar la pantalla de contraseña de administrador
  function _pedirPassword(email) {
    _setLoading(false);
    setText('admin-pass-email', email);
    _showSection('admin-pass');
    const form = document.getElementById('admin-pass-form');
    if (form && !form.dataset.bound) {
      form.dataset.bound = '1';
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const pass = document.getElementById('admin-pass-input').value;
        const btn  = document.getElementById('admin-pass-btn');
        const msg  = document.getElementById('admin-pass-msg');
        btn.disabled = true;
        btn.textContent = 'Verificando...';
        if (msg) msg.innerHTML = '';
        try {
          const r = await Auth.adminLogin(_admin.email, pass);
          if (!r.success) throw new Error(r.error || 'Contraseña incorrecta.');
          await _entrarPanelConDatos();
        } catch (err) {
          if (msg) msg.innerHTML = `<div class="form-msg error">${_esc(err.message)}</div>`;
          btn.disabled = false;
          btn.textContent = 'Ingresar al panel';
        }
      });
    }
    setTimeout(() => document.getElementById('admin-pass-input')?.focus(), 50);
  }

  // Entrar al panel asegurando tener la nómina cargada (con token válido)
  async function _entrarPanelConDatos() {
    const empResult = await API.obtenerEmpleados(_admin.email);
    if (!empResult.success) {
      _showAdminError('No se pudo cargar el panel: ' + (empResult.error || 'error desconocido'));
      return;
    }
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
    Operacion.init(_admin);   // Módulo Operación (ex-ShiftControl)
    _loadTab('overview');
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
      // ---- Módulo Operación (ex-ShiftControl) ----
      case 'operacion':
      case 'reemplazos':
      case 'observaciones':
      case 'vehiculos':
      case 'empresas':
      case 'trazabilidad':
        Operacion.render(tab);
        break;
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
    const abiertos = _registros.filter(r => r.fecha === today && !r.horaEgreso).length;

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
  // REGISTROS / ASISTENCIAS (resumen mensual, calendario y detalle)
  // ============================================================

  let _regVista   = 'resumen';
  let _regMes     = '';      // 'YYYY-MM'
  let _regPeriodo = 'mes';   // 'mes' | 'q1' | 'q2' (cierre quincenal UOCRA / mensual AOMA-FC)
  let _regFilas   = [];      // resumen agregado por empleado del mes
  let _regNovedades = {};    // email -> { 'dd/MM/yyyy': {codigo, detalle} }
  let _detalleRegs = [];     // registros de la vista detalle (con filtros propios)
  let _regBound   = false;

  // Códigos de novedad de la planilla de la empresa (P = presente, automático por fichada)
  const NOV_LABELS = {
    D: 'Descanso', V: 'Vacaciones', LC: 'Licencia', EC: 'Extra campamento',
    EB: 'Extra base', PM: 'Parte médico', AJ: 'Ausente justificado', AI: 'Ausente injustificado'
  };

  async function _renderRegistros() {
    _bindRegistrosUI();

    const mesInput = document.getElementById('reg-mes');
    if (mesInput && !mesInput.value) {
      const d = new Date();
      mesInput.value = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    }
    await _cargarMesRegistros();
  }

  function _bindRegistrosUI() {
    if (_regBound) return;
    _regBound = true;

    // Toggle de vista
    document.getElementById('reg-vista-toggle')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-vista]');
      if (!btn) return;
      _regVista = btn.dataset.vista;
      document.querySelectorAll('#reg-vista-toggle .seg-btn').forEach(b =>
        b.classList.toggle('seg-active', b === btn));
      _mostrarVistaRegistros();
    });

    document.getElementById('reg-mes')?.addEventListener('change', _cargarMesRegistros);
    document.getElementById('reg-periodo')?.addEventListener('change', _cargarMesRegistros);
    document.getElementById('reg-buscar')?.addEventListener('input', _renderVistaActiva);
    document.getElementById('btn-export-reg')?.addEventListener('click', _exportarRegistros);

    // Clic en una celda del calendario → marcar/editar novedad
    document.getElementById('reg-cal-tbody')?.addEventListener('click', (e) => {
      const td = e.target.closest('td[data-email]');
      if (!td) return;
      _abrirNovedadModal(td.dataset.email, td.dataset.fecha);
    });

    // Modal de novedad
    document.getElementById('reg-modal-close')?.addEventListener('click', _cerrarNovedadModal);
    document.getElementById('reg-modal-cancel')?.addEventListener('click', _cerrarNovedadModal);
    document.getElementById('reg-modal-overlay')?.addEventListener('click', (e) => {
      if (e.target.id === 'reg-modal-overlay') _cerrarNovedadModal();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') _cerrarNovedadModal();
    });

    // Filtros de la vista detalle
    ['reg-f-email','reg-f-sector','reg-f-desde','reg-f-hasta'].forEach(id => {
      document.getElementById(id)?.addEventListener('change', _renderDetalleRegistros);
    });

    // Expandir/contraer detalle diario en el resumen
    document.getElementById('reg-res-tbody')?.addEventListener('click', (e) => {
      const tr = e.target.closest('tr[data-idx]');
      if (!tr) return;
      const det = document.getElementById('reg-det-' + tr.dataset.idx);
      if (det) det.classList.toggle('hidden');
    });
  }

  function _mostrarVistaRegistros() {
    ['resumen','calendario','detalle'].forEach(v => {
      document.getElementById('reg-view-' + v)?.classList.toggle('hidden', v !== _regVista);
    });
    _renderVistaActiva();
  }

  async function _renderVistaActiva() {
    if (_regVista === 'resumen')       _renderResumenRegistros();
    else if (_regVista === 'calendario') _renderCalendarioRegistros();
    else await _renderDetalleRegistros();
  }

  // ---- carga del mes/período seleccionado ----
  async function _cargarMesRegistros() {
    const mesInput = document.getElementById('reg-mes');
    _regMes     = mesInput?.value || '';
    _regPeriodo = document.getElementById('reg-periodo')?.value || 'mes';
    if (!_regMes) return;

    const [y, m]   = _regMes.split('-').map(Number);
    const ultimo   = new Date(y, m, 0).getDate();
    const dIni     = _regPeriodo === 'q2' ? 16 : 1;
    const dFin     = _regPeriodo === 'q1' ? 15 : ultimo;
    const desde    = `${String(dIni).padStart(2,'0')}/${String(m).padStart(2,'0')}/${y}`;
    const hasta    = `${String(dFin).padStart(2,'0')}/${String(m).padStart(2,'0')}/${y}`;

    const tb = document.getElementById('reg-res-tbody');
    if (tb) tb.innerHTML = '<tr><td colspan="9" class="text-center text-muted">Cargando asistencias del período...</td></tr>';

    const [repRes, novRes] = await Promise.all([
      API.obtenerReporte(_admin.email, { fechaDesde: desde, fechaHasta: hasta }),
      API.obtenerNovedades(_admin.email, { fechaDesde: desde, fechaHasta: hasta })
    ]);
    if (!repRes.success) {
      if (tb) tb.innerHTML = `<tr><td colspan="9" class="text-center text-muted">${_esc(repRes.error || 'Error al cargar')}</td></tr>`;
      return;
    }

    // Mapa de novedades: email -> { fecha: {codigo, detalle} }
    _regNovedades = {};
    ((novRes && novRes.success && novRes.novedades) || []).forEach(n => {
      const em = String(n.email).toLowerCase();
      (_regNovedades[em] = _regNovedades[em] || {})[n.fecha] = { codigo: n.codigo, detalle: n.detalle || '' };
    });

    _regRegs = repRes.registros || [];
    _regFilas = _agregarPorEmpleado(_regRegs);
    _renderVistaActiva();
  }

  // ---- agregación: registros + novedades → una fila por empleado ----
  function _agregarPorEmpleado(registros) {
    const mapa = {};

    // Base: todos los empleados activos (aparecen aunque no tengan fichadas)
    _empleados.forEach(e => {
      mapa[e.email] = {
        email: e.email, nombre: e.nombre, apellido: e.apellido,
        dni: e.dni || '', empresa: e.empresa || '', sector: e.sector || '',
        convenio: e.convenio || '', activo: e.activo,
        diasMap: new Map(), totalMin: 0, sinCierre: 0,
        novMap: _regNovedades[String(e.email).toLowerCase()] || {},
        novCounts: {}
      };
    });

    (registros || []).forEach(r => {
      let f = mapa[r.email];
      if (!f) {
        f = mapa[r.email] = {
          email: r.email, nombre: r.nombre, apellido: r.apellido,
          dni: '', empresa: '', sector: r.sector || '', convenio: '', activo: false,
          diasMap: new Map(), totalMin: 0, sinCierre: 0,
          novMap: _regNovedades[String(r.email).toLowerCase()] || {},
          novCounts: {}
        };
      }
      const d = f.diasMap.get(r.fecha) || {
        fecha: r.fecha, diaSemana: r.diaSemana, ingreso: '', egreso: '',
        min: 0, abierta: false
      };
      if (r.horaIngreso && (!d.ingreso || r.horaIngreso < d.ingreso)) d.ingreso = r.horaIngreso;
      if (r.horaEgreso && r.horaEgreso > (d.egreso || ''))            d.egreso  = r.horaEgreso;
      if (!r.horaEgreso) { d.abierta = true; f.sinCierre++; }
      d.min += r.duracionMin || 0;
      f.totalMin += r.duracionMin || 0;
      f.diasMap.set(r.fecha, d);
    });

    // Merge de novedades: conteos por código + código en el día correspondiente
    Object.values(mapa).forEach(f => {
      Object.entries(f.novMap).forEach(([fecha, n]) => {
        f.novCounts[n.codigo] = (f.novCounts[n.codigo] || 0) + 1;
        const d = f.diasMap.get(fecha);
        if (d) d.nov = n.codigo;
      });
    });

    return Object.values(mapa)
      .filter(f => f.activo || f.diasMap.size > 0 || Object.keys(f.novMap).length > 0)
      .sort((a, b) => (a.apellido + ' ' + a.nombre).localeCompare(b.apellido + ' ' + b.nombre, 'es'));
  }

  function _filasFiltradas() {
    const q = (document.getElementById('reg-buscar')?.value || '').trim().toLowerCase();
    if (!q) return _regFilas;
    return _regFilas.filter(f =>
      `${f.nombre} ${f.apellido} ${f.email} ${f.empresa} ${f.sector}`.toLowerCase().includes(q));
  }

  // ---- vista RESUMEN ----
  function _renderResumenRegistros() {
    const tbody = document.getElementById('reg-res-tbody');
    if (!tbody) return;

    const filas    = _filasFiltradas();
    const conDatos = filas.filter(f => f.diasMap.size > 0);
    setText('reg-count', `${conDatos.length} con asistencia · ${filas.length} empleados en total`);

    if (!filas.length) {
      tbody.innerHTML = '<tr><td colspan="9" class="text-center text-muted">Sin resultados.</td></tr>';
      return;
    }

    tbody.innerHTML = filas.map((f, idx) => {
      const dias   = f.diasMap.size;
      const prom   = dias > 0 ? Math.round(f.totalMin / dias) : 0;
      const horas  = (f.totalMin / 60).toFixed(1).replace('.', ',');
      const novBadges = Object.entries(f.novCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([c, n]) => `<span class="nov-badge nov-${_esc(c)}" title="${_esc(NOV_LABELS[c] || c)}">${_esc(c)}×${n}</span>`)
        .join('');
      return `
      <tr data-idx="${idx}" style="cursor:pointer">
        <td>
          <div class="emp-name">${_esc(f.apellido)}, ${_esc(f.nombre)}</div>
          <div class="text-small text-muted">${f.dni ? 'DNI ' + _esc(f.dni) : _esc(f.email)}</div>
        </td>
        <td>${_esc(f.empresa) || _esc(f.sector) || '<span class="text-muted">—</span>'}
          ${f.empresa && f.sector ? `<div class="text-small text-muted">${_esc(f.sector)}</div>` : ''}
        </td>
        <td class="text-small">${_esc(f.convenio) || '<span class="text-muted">—</span>'}</td>
        <td class="text-center"><strong>${dias || '—'}</strong></td>
        <td class="text-center">${dias ? _fmtDur(f.totalMin) : '—'}<div class="text-small text-muted">${dias ? horas + ' h' : ''}</div></td>
        <td class="text-center">${prom ? _fmtDur(prom) : '—'}</td>
        <td class="text-center">${novBadges || '—'}</td>
        <td class="text-center">${f.sinCierre ? `<span class="badge badge-warning">${f.sinCierre}</span>` : '—'}</td>
        <td>${dias ? '<span class="text-muted">▾</span>' : ''}</td>
      </tr>
      ${dias ? `
      <tr class="reg-det-row hidden" id="reg-det-${idx}">
        <td colspan="9" style="background:var(--gray-50);padding:.5rem 1rem .75rem 2rem">
          <table style="width:100%;font-size:.82rem">
            <thead>
              <tr class="text-small text-muted">
                <th style="text-align:left;padding:.25rem .5rem">Fecha</th>
                <th style="text-align:left;padding:.25rem .5rem">Día</th>
                <th style="text-align:left;padding:.25rem .5rem">Ingreso</th>
                <th style="text-align:left;padding:.25rem .5rem">Egreso</th>
                <th style="text-align:left;padding:.25rem .5rem">Duración</th>
                <th style="text-align:left;padding:.25rem .5rem">Novedad</th>
                <th style="text-align:left;padding:.25rem .5rem">Estado</th>
              </tr>
            </thead>
            <tbody>
              ${[...f.diasMap.values()].map(d => `
                <tr>
                  <td style="padding:.25rem .5rem">${_esc(d.fecha)}</td>
                  <td style="padding:.25rem .5rem">${_esc(d.diaSemana || '')}</td>
                  <td style="padding:.25rem .5rem">${_esc(d.ingreso) || '—'}</td>
                  <td style="padding:.25rem .5rem">${_esc(d.egreso) || '—'}</td>
                  <td style="padding:.25rem .5rem">${d.min ? _fmtDur(d.min) : '—'}</td>
                  <td style="padding:.25rem .5rem">${d.nov ? `<span class="nov-badge nov-${_esc(d.nov)}" title="${_esc(NOV_LABELS[d.nov] || d.nov)}">${_esc(d.nov)}</span>` : '—'}</td>
                  <td style="padding:.25rem .5rem">${d.abierta ? '<span class="badge badge-warning">Abierta</span>' : '<span class="badge badge-success">OK</span>'}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </td>
      </tr>` : ''}`;
    }).join('');
  }

  // ---- vista CALENDARIO (grilla empleado × días, tipo cronograma) ----
  function _renderCalendarioRegistros() {
    const thead = document.getElementById('reg-cal-thead');
    const tbody = document.getElementById('reg-cal-tbody');
    if (!thead || !tbody || !_regMes) return;

    const [y, m]  = _regMes.split('-').map(Number);
    const dias    = new Date(y, m, 0).getDate();
    const filas   = _filasFiltradas();
    const nombres = ['D','L','M','M','J','V','S'];

    // Encabezado: empleado + días del mes
    let head = '<tr><th style="position:sticky;left:0;background:#fff;z-index:2;min-width:180px">Empleado</th>';
    for (let d = 1; d <= dias; d++) {
      const dow = new Date(y, m - 1, d).getDay();
      const we  = (dow === 0 || dow === 6) ? ' cal-we' : '';
      head += `<th class="cal-day-head${we}">${d}<div class="text-small text-muted" style="font-weight:400">${nombres[dow]}</div></th>`;
    }
    head += '<th class="cal-tot-head">Σ h</th></tr>';
    thead.innerHTML = head;

    if (!filas.length) {
      tbody.innerHTML = `<tr><td class="text-center text-muted" colspan="${dias + 2}">Sin resultados.</td></tr>`;
      return;
    }

    tbody.innerHTML = filas.map(f => {
      let row = `
        <tr>
          <td style="position:sticky;left:0;background:#fff;z-index:1">
            <div class="emp-name" style="font-size:.82rem">${_esc(f.apellido)}, ${_esc(f.nombre)}</div>
          </td>`;
      for (let d = 1; d <= dias; d++) {
        const dd    = String(d).padStart(2, '0');
        const key   = `${dd}/${String(m).padStart(2, '0')}/${y}`;
        const day   = f.diasMap.get(key);
        const nov   = f.novMap[key];
        const dow   = new Date(y, m - 1, d).getDay();
        const we    = (dow === 0 || dow === 6) ? ' cal-we' : '';
        const click = ' cal-click';
        const attrs = `data-email="${_esc(f.email)}" data-fecha="${key}"`;
        if (day) {
          const h = Math.round(day.min / 60 * 10) / 10;
          const novTxt = nov ? ` · ${NOV_LABELS[nov.codigo] || nov.codigo}${nov.detalle ? ' (' + nov.detalle + ')' : ''}` : '';
          row += `<td class="cal-cell cal-on${click}${we}${day.abierta ? ' cal-open' : ''}" ${attrs}
                     title="${_esc(key)} · Ingreso ${_esc(day.ingreso) || '—'} · Egreso ${_esc(day.egreso) || '—'}${day.abierta ? ' · SIN CIERRE' : ''}${novTxt} — clic para novedad">
                     ${h || '·'}${nov ? `<div class="cal-nov nov-${_esc(nov.codigo)}" style="font-size:.58rem;line-height:1">${_esc(nov.codigo)}</div>` : ''}</td>`;
        } else if (nov) {
          row += `<td class="cal-cell cal-nov nov-${_esc(nov.codigo)}${click}${we}" ${attrs}
                     title="${_esc(key)} · ${_esc(NOV_LABELS[nov.codigo] || nov.codigo)}${nov.detalle ? ' · ' + _esc(nov.detalle) : ''} — clic para editar">${_esc(nov.codigo)}</td>`;
        } else {
          row += `<td class="cal-cell${click}${we}" ${attrs} title="${_esc(key)} — clic para marcar novedad"></td>`;
        }
      }
      row += `<td class="cal-tot">${f.totalMin ? (Math.round(f.totalMin / 60 * 10) / 10) : ''}</td></tr>`;
      return row;
    }).join('');

    setText('reg-cal-legend', `${filas.filter(f => f.diasMap.size > 0).length} con asistencia · ${filas.length} empleados`);
  }

  // ---- modal de novedad (marcar / editar / quitar) ----
  function _cerrarNovedadModal() {
    document.getElementById('reg-modal-overlay')?.classList.add('hidden');
  }

  function _abrirNovedadModal(email, fecha) {
    const ov      = document.getElementById('reg-modal-overlay');
    const tt      = document.getElementById('reg-modal-title');
    const bb      = document.getElementById('reg-modal-body');
    const mm      = document.getElementById('reg-modal-msg');
    const delBtn  = document.getElementById('reg-modal-delete');
    if (!ov || !bb || !fecha) return;

    const f   = _regFilas.find(x => x.email === email);
    const nov = f && f.novMap ? f.novMap[fecha] : null;
    const nombre = f ? `${f.apellido}, ${f.nombre}` : email;

    tt.textContent = `Novedad — ${nombre} — ${fecha}`;
    if (mm) mm.innerHTML = '';
    delBtn?.classList.toggle('hidden', !nov);

    const opciones = [''].concat(Object.keys(NOV_LABELS));
    bb.innerHTML = `
      <div class="form-group" style="margin-bottom:.85rem">
        <label class="form-label">Novedad del día</label>
        <select id="reg-nov-codigo" class="form-input">
          ${opciones.map(c => `<option value="${_esc(c)}" ${nov && nov.codigo === c ? 'selected' : ''}>${c === '' ? '— Sin novedad —' : _esc(c + ' · ' + NOV_LABELS[c])}</option>`).join('')}
        </select>
      </div>
      <div class="form-group" style="margin-bottom:.85rem">
        <label class="form-label">Detalle (opcional)</label>
        <input type="text" id="reg-nov-detalle" class="form-input" value="${_esc(nov ? nov.detalle : '')}" placeholder="Ej: vacaciones período 2026, UNSJ día extra..." />
      </div>
      <p class="text-small text-muted">Se registra la novedad para el <strong>${_esc(fecha)}</strong>. Si el empleado fichó ese día, la fichada (P con horas) se mantiene; la novedad queda como referencia para liquidación.</p>`;

    const _err = (txt) => { if (mm) mm.innerHTML = `<div class="form-msg error">${_esc(txt)}</div>`; };

    // Guardar
    const saveBtn = document.getElementById('reg-modal-save');
    const freshSave = saveBtn.cloneNode(true);
    saveBtn.parentNode.replaceChild(freshSave, saveBtn);
    freshSave.addEventListener('click', async () => {
      const codigo  = document.getElementById('reg-nov-codigo')?.value || '';
      const detalle = document.getElementById('reg-nov-detalle')?.value.trim() || '';
      if (!codigo) { _cerrarNovedadModal(); return; }
      freshSave.disabled = true;
      freshSave.textContent = 'Guardando...';
      try {
        const r = await API.marcarNovedad(_admin.email, email, fecha, '', codigo, detalle);
        if (!r.success) throw new Error(r.error || 'Error al guardar');
        _cerrarNovedadModal();
        await _cargarMesRegistros();
      } catch (err) {
        _err(err.message || 'Error al guardar');
        freshSave.disabled = false;
        freshSave.textContent = '💾 Guardar';
      }
    });

    // Quitar novedad existente
    const freshDel = delBtn.cloneNode(true);
    delBtn.parentNode.replaceChild(freshDel, delBtn);
    freshDel.addEventListener('click', async () => {
      freshDel.disabled = true;
      try {
        const r = await API.borrarNovedad(_admin.email, email, fecha);
        if (!r.success) throw new Error(r.error || 'Error al eliminar');
        _cerrarNovedadModal();
        await _cargarMesRegistros();
      } catch (err) {
        _err(err.message || 'Error al eliminar');
        freshDel.disabled = false;
      }
    });

    ov.classList.remove('hidden');
  }

  // ---- vista DETALLE (lista completa con filtros propios) ----
  async function _renderDetalleRegistros() {
    const desdeEl = document.getElementById('reg-f-desde');
    const hastaEl = document.getElementById('reg-f-hasta');
    // Prefill del mes seleccionado la primera vez
    if (_regMes && desdeEl && !desdeEl.value) {
      const [y, m] = _regMes.split('-');
      desdeEl.value = `${y}-${m}-01`;
      hastaEl.value = `${y}-${m}-${String(new Date(Number(y), Number(m), 0).getDate()).padStart(2, '0')}`;
    }

    const filtros = _getRegistrosFiltros();
    const result  = await API.obtenerReporte(_admin.email, filtros);
    _detalleRegs  = result.success ? (result.registros || []) : [];

    const tbody = document.getElementById('reg-tbody');
    if (!tbody) return;

    tbody.innerHTML = _detalleRegs.length === 0
      ? '<tr><td colspan="6" class="text-center text-muted">Sin registros para los filtros seleccionados</td></tr>'
      : _detalleRegs.map(r => `
          <tr>
            <td>${_esc(r.fecha)}</td>
            <td>
              <div class="emp-name">${_esc(r.nombre)} ${_esc(r.apellido)}</div>
              <div class="text-small text-muted">${_esc(r.sector || '')} ${r.turno ? '· ' + _esc(r.turno) : ''}</div>
            </td>
            <td>${_esc(r.horaIngreso) || '—'}</td>
            <td>${_esc(r.horaEgreso)  || '<span class="text-warning">Pendiente</span>'}</td>
            <td>${r.duracionMin ? _fmtDur(r.duracionMin) : '—'}</td>
            <td>${_esc(r.diaSemana) || '—'}</td>
          </tr>`).join('');
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

  // ---- exportación (resumen o detalle según la vista activa) ----
  function _exportarRegistros() {
    if (_regVista === 'detalle') { _exportCSV(_detalleRegs, 'asistencias_detalle'); return; }
    if (!_regFilas.length) { alert('Sin datos para exportar.'); return; }

    const novCodes = Object.keys(NOV_LABELS);
    const headers = ['DNI','Apellido','Nombre','Email','Empresa','Sector','Convenio',
                     'Dias trabajados','Horas totales (h:mm)','Horas (decimal)',
                     'Promedio por dia (h:mm)']
                     .concat(novCodes.map(c => 'Novedad ' + c + ' (' + NOV_LABELS[c] + ')'))
                     .concat(['Entradas sin cierre','Activo']);
    const rows = _filasFiltradas().map(f => [
      f.dni, f.apellido, f.nombre, f.email, f.empresa, f.sector, f.convenio,
      f.diasMap.size, _fmtDur(f.totalMin), (f.totalMin / 60).toFixed(2).replace('.', ','),
      _fmtDur(f.diasMap.size ? Math.round(f.totalMin / f.diasMap.size) : 0)
    ].concat(novCodes.map(c => f.novCounts[c] || 0))
     .concat([f.sinCierre, f.activo ? 'SI' : 'NO']));
    const sufijo = _regMes || '';
    const periodo = _regPeriodo === 'q1' ? '_q1' : (_regPeriodo === 'q2' ? '_q2' : '');
    _exportTablaCSV(headers, rows, 'resumen_asistencias_' + sufijo + periodo);
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
    // Cambiar a la pestaña Asistencias, vista Detalle, filtrado por empleado
    _regVista = 'detalle';
    document.querySelectorAll('#reg-vista-toggle .seg-btn').forEach(b =>
      b.classList.toggle('seg-active', b.dataset.vista === 'detalle'));
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
    _exportTablaCSV(headers, rows, nombre);
  }

  function _exportTablaCSV(headers, rows, nombre) {
    if (!rows || rows.length === 0) { alert('Sin datos para exportar.'); return; }
    const csv  = [headers, ...rows].map(r => r.map(v => `"${String(v ?? '').replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `${nombre}_${_fmtFecha(new Date()).replace(/\//g,'-')}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ============================================================
  // HELPERS
  // ============================================================

  function _showAdminView() {
    document.getElementById('employee-app')?.classList.add('hidden');
    document.getElementById('admin-app')?.classList.remove('hidden');
  }

  function _showSection(id) {
    ['admin-login','admin-dashboard','admin-error','admin-pass'].forEach(s => {
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

  // Refresca la pestaña activa (botón "Actualizar" del topbar)
  function refresh() {
    _loadTab(_activeTab || 'overview');
  }

  // Exponer para onclick en HTML
  return {
    init,
    refresh,
    resetDispositivo,
    toggleActivo,
    verDetalleEmpleado,
    _setupEmployeeTab
  };
})();
