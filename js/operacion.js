/* ============================================================
   MÓDULO OPERACIÓN (ex-ShiftControl integrado)
   Habilitaciones · Reemplazos · Observaciones · Alertas
   Vehículos · Empresas · Trazabilidad
   ============================================================ */
const Operacion = (() => {
  'use strict';

  let _admin   = null;   // { email }
  let _data    = null;   // respuesta de obtenerOperacion
  let _ready   = false;  // listeners de forms instalados
  let _lastFetch    = 0;      // ts de la última carga de obtenerOperacion
  let _lastTraza    = 0;      // ts de la última carga de trazabilidad
  let _trazaCache   = null;   // respuesta cacheada de trazabilidad
  let _fetching     = null;   // promise en curso (evita fetchs duplicados)
  const CACHE_TTL   = 45000;  // 45s: vida útil de la caché antes de refrescar en background

  // ---------- utilidades ----------
  const _esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const _set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  const _val = (id)     => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
  const _msg = (id, ok, text) => {
    const el = document.getElementById(id);
    if (el) { el.innerHTML = `<div class="form-msg ${ok ? 'success' : 'error'}">${_esc(text)}</div>`; }
  };

  const _badgeEstado = (estado) => {
    const map = {
      ok:          ['success', 'OK'],
      warning:     ['warning', 'Por vencer'],
      vencido:     ['danger',  'Vencido'],
      habilitado:  ['success', 'Habilitado'],
      observado:   ['warning', 'Observado'],
      bloqueado:   ['danger',  'Bloqueado']
    };
    const [cls, label] = map[estado] || ['secondary', estado || '—'];
    return `<span class="badge badge-${cls}">${label}</span>`;
  };

  const _vencCell = (fecha, estado) => {
    if (!fecha) return '<span class="text-muted">—</span>';
    return `${_esc(fecha)} ${_badgeEstado(estado)}`;
  };

  // ---------- carga de datos ----------
  // Caché con TTL: los cambios de panel usan lo ya cargado (instantáneo)
  // y solo se pega al backend si la data está vencida. Las mutaciones
  // (agregar/editar vehículo, etc.) siempre llaman load(true) y refrescan.
  async function load(force) {
    if (!force && _data && (Date.now() - _lastFetch < CACHE_TTL)) return _data;
    if (_fetching) return _fetching;
    _fetching = (async () => {
      const r = await API.obtenerOperacion(_admin.email);
      if (!r.success) throw new Error(r.error || 'No se pudo cargar el módulo Operación.');
      _data = r;
      _lastFetch = Date.now();
      return _data;
    })();
    try { return await _fetching; } finally { _fetching = null; }
  }

  // ============================================================
  // INIT (instala listeners una sola vez)
  // ============================================================
  function init(admin) {
    _admin = admin;
    if (_ready) return;
    _ready = true;

    // Delegación global para controles dinámicos de las tablas
    document.addEventListener('click', _onDelegatedClick);
    document.addEventListener('change', _onDelegatedChange);
    document.addEventListener('input', _onDelegatedInput);

    // Formularios
    const fObs = document.getElementById('form-observacion');
    if (fObs) fObs.addEventListener('submit', (e) => { e.preventDefault(); _submitObservacion(); });

    const fVeh = document.getElementById('form-vehiculo');
    if (fVeh) fVeh.addEventListener('submit', (e) => { e.preventDefault(); _submitVehiculo(); });

    const fEmp = document.getElementById('form-empresa');
    if (fEmp) fEmp.addEventListener('submit', (e) => { e.preventDefault(); _submitEmpresa(); });

    const fRem = document.getElementById('form-reemplazo');
    if (fRem) fRem.addEventListener('submit', (e) => { e.preventDefault(); _submitReemplazo(); });

    const fObsEmp = document.getElementById('form-obs-empleado');
    if (fObsEmp) fObsEmp.addEventListener('submit', (e) => { e.preventDefault(); _submitObsEmpleado(); });

    // Cambio de tipo en el form de observación ajusta el datalist de entidad
    const obsTipo = document.getElementById('obs-tipo');
    if (obsTipo) obsTipo.addEventListener('change', () => _fillEntidades(obsTipo.value));

    // Tecla ESC cierra el modal de edición
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') _modal.close();
    });
  }

  // ---------- delegación ----------
  function _onDelegatedClick(e) {
    // Cerrar modal si se hace click en el fondo oscuro
    if (e.target.id === 'op-modal-overlay') { _modal.close(); return; }
    const btn = e.target.closest('[data-op]');
    if (!btn) return;
    const { op, id, email, nombre } = btn.dataset;
    const handlers = {
      resolverObs:     () => _resolverObservacion(id),
      asignarRem:      () => _asignarReemplazo(id),
      descartarRem:    () => _descartarReemplazo(id),
      marcarLeidas:    () => _marcarAlertasLeidas(),
      obsEmpleado:     () => _abrirObsEmpleado(email, nombre),
      cerrarObsEmp:    () => _cerrarObsEmpleado(),
      editarVehiculo:  () => _editarVehiculo(id),
      editarEmpresa:   () => _editarEmpresa(id),
      editarEmpleado:  () => _editarEmpleado(email),
      modalClose:      () => _modal.close(),
      modalCancel:     () => _modal.close()
    };
    if (handlers[op]) { e.preventDefault(); handlers[op](); }
  }

  function _onDelegatedInput(e) {
    const el = e.target.closest('[data-op]');
    if (!el) return;
    if (el.dataset.op === 'busquedaHab') _renderHabilitacionesTabla();
    else if (el.dataset.op === 'busquedaObs') _renderObservacionesTabla();
  }

  function _onDelegatedChange(e) {
    const el = e.target.closest('[data-op]');
    if (!el) return;
    const { op, email, id } = el.dataset;
    if (op === 'hab')            _setHabilitacion(email, el.value);
    else if (op === 'vehEstado') _setVehiculoEstado(id, el.value);
    else if (op === 'contrato')  _setEmpresaContrato(id, el.value);
    else if (op === 'busquedaHab') _renderHabilitacionesTabla();
    else if (op === 'busquedaObs')  _renderObservacionesTabla();
  }

  // ============================================================
  // RENDER DISPATCH
  // ============================================================
  function _renderTab(tab) {
    if (tab === 'operacion')     _renderHabilitaciones();
    if (tab === 'reemplazos')    _renderReemplazos();
    if (tab === 'observaciones') _renderObservaciones();
    if (tab === 'vehiculos')     _renderVehiculos();
    if (tab === 'empresas')      _renderEmpresas();
  }

  async function render(tab) {
    if (!_admin) return;
    try {
      if (tab === 'trazabilidad') return await _renderTrazabilidad();

      if (_data) {
        // 1) Render inmediato con la caché (cambio de panel sin espera)
        _renderTab(tab);
        // 2) Si la caché está vencida, refrescar en background y re-renderizar
        if (Date.now() - _lastFetch >= CACHE_TTL && !_fetching) {
          load().then(() => _renderTab(tab)).catch(() => {});
        }
      } else {
        // Primera vez: no hay caché, mostrar "Cargando..." y esperar
        await load();
        _renderTab(tab);
      }
    } catch (err) {
      console.error('[Operacion]', err);
      ['op-stats','hab-tbody','rem-lista','obs-tbody','alrt-lista','veh-tbody','empr-tbody','traza-tbody'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = `<div class="form-msg error">${_esc(err.message)}</div>`;
      });
    }
  }

  // ============================================================
  // TAB: OPERACIÓN / HABILITACIONES
  // ============================================================
  function _renderHabilitaciones() {
    const emps = _data.empleados || [];
    const activos    = emps.filter(e => e.activo);
    const bloqueados = activos.filter(e => e.habilitacion === 'bloqueado');
    const observados = activos.filter(e => e.habilitacion === 'observado');
    const docsAlerta = activos.filter(e =>
      (e.aptoEstado && e.aptoEstado !== 'ok') || (e.licenciaEstado && e.licenciaEstado !== 'ok'));

    _set('op-total',     activos.length);
    _set('op-habilitados',  activos.length - bloqueados.length - observados.length);
    _set('op-observados',   observados.length);
    _set('op-bloqueados',   bloqueados.length);
    _set('op-docs',         docsAlerta.length);

    _fillEmpresasSelect('obs-empresa');
    _renderHabilitacionesTabla();
  }

  function _renderHabilitacionesTabla() {
    const tbody = document.getElementById('hab-tbody');
    if (!tbody) return;
    const q = (_val('hab-search') || '').toLowerCase();
    const emps = (_data.empleados || []).filter(e => e.activo)
      .filter(e => !q || `${e.nombre} ${e.apellido} ${e.email} ${e.empresa} ${e.sector}`.toLowerCase().includes(q));

    if (!emps.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">Sin resultados.</td></tr>';
      return;
    }

    tbody.innerHTML = emps.map(e => `
      <tr>
        <td>
          <div style="font-weight:600">${_esc(e.nombre)} ${_esc(e.apellido)}</div>
          <div class="text-muted" style="font-size:.75rem">${_esc(e.email)}</div>
        </td>
        <td>${_esc(e.empresa) || '<span class="text-muted">—</span>'}</td>
        <td>${_esc(e.sector) || '—'}</td>
        <td>${_vencCell(e.aptoVenc, e.aptoEstado)}</td>
        <td>${e.licenciaTipo ? _esc(e.licenciaTipo) + '<br>' : ''}${_vencCell(e.licenciaVenc, e.licenciaEstado)}</td>
        <td>
          <select data-op="hab" data-email="${_esc(e.email)}" class="form-input" style="min-width:130px;padding:.35rem .5rem">
            <option value="habilitado" ${e.habilitacion === 'habilitado' ? 'selected' : ''}>Habilitado</option>
            <option value="observado"  ${e.habilitacion === 'observado'  ? 'selected' : ''}>Observado</option>
            <option value="bloqueado"  ${e.habilitacion === 'bloqueado'  ? 'selected' : ''}>Bloqueado</option>
          </select>
        </td>
        <td>
          <div style="display:flex;gap:.35rem;flex-wrap:wrap">
            <button data-op="obsEmpleado" data-email="${_esc(e.email)}" data-nombre="${_esc(e.nombre + ' ' + e.apellido)}"
                    class="btn btn-sm btn-outline">📝 Observación</button>
            <button data-op="editarEmpleado" data-email="${_esc(e.email)}"
                    class="btn btn-sm btn-outline">✏️ Editar</button>
          </div>
        </td>
      </tr>`).join('');
  }

  async function _setHabilitacion(email, valor) {
    const r = await API.actualizarEmpleado(_admin.email, email, 'habilitacion', valor);
    if (r.success) {
      const e = (_data.empleados || []).find(x => x.email === email);
      if (e) e.habilitacion = valor;
      _renderHabilitaciones();
    } else {
      alert(r.error || 'No se pudo actualizar.');
    }
  }

  // --- Observación rápida sobre un empleado ---
  function _abrirObsEmpleado(email, nombre) {
    const panel = document.getElementById('obs-emp-panel');
    if (!panel) return;
    document.getElementById('obs-emp-titulo').textContent = `Observación — ${nombre}`;
    document.getElementById('obs-emp-email').value = email;
    panel.classList.remove('hidden');
    panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function _cerrarObsEmpleado() {
    const panel = document.getElementById('obs-emp-panel');
    if (!panel) return;
    panel.classList.add('hidden');
    document.getElementById('obs-emp-desc').value = '';
    document.getElementById('obs-emp-sev').value = 'observado';
  }

  async function _submitObsEmpleado() {
    const email = _val('obs-emp-email');
    const emp = (_data.empleados || []).find(x => x.email === email);
    if (!emp) return;
    const o = {
      tipo: 'Personal',
      entidad: `${emp.nombre} ${emp.apellido}`,
      empresa: emp.empresa || '',
      severidad: _val('obs-emp-sev'),
      descripcion: _val('obs-emp-desc')
    };
    if (!o.descripcion) { _msg('obs-emp-msg', false, 'Escriba la descripción.'); return; }
    const r = await API.agregarObservacion(_admin.email, o);
    if (r.success) {
      if (o.severidad === 'bloqueado') await API.actualizarEmpleado(_admin.email, email, 'habilitacion', 'bloqueado');
      _cerrarObsEmpleado();
      await load(true);
      _renderHabilitaciones();
    } else {
      _msg('obs-emp-msg', false, r.error || 'Error al registrar.');
    }
  }

  // ============================================================
  // TAB: REEMPLAZOS
  // ============================================================
  function _renderReemplazos() {
    _fillEmpleadosSelect('rem-ausente');
    _renderReemplazosLista();
  }

  function _renderReemplazosLista() {
    const cont = document.getElementById('rem-lista');
    if (!cont) return;
    const reems = _data.reemplazos || [];

    if (!reems.length) {
      cont.innerHTML = '<p class="text-muted">No hay ausencias registradas.</p>';
      return;
    }

    const pendientes = reems.filter(r => !r.resuelto);
    const resueltos  = reems.filter(r => r.resuelto);

    const card = (r, isOpen) => {
      const opcionesCand = (r.candidatos || []).map((c, i) =>
        `<option value="${i}" ${c.asignado ? 'selected' : ''}>${_esc(c.nombre)}${c.asignado ? ' ✓' : ''}</option>`).join('');
      return `
      <div class="stat-card" style="padding:1rem;display:flex;flex-wrap:wrap;gap:.75rem;align-items:center;justify-content:space-between">
        <div>
          <div style="font-weight:700">${_esc(r.ausente)}</div>
          <div class="text-muted" style="font-size:.78rem">
            Turno: ${_esc(r.turno) || '—'} · Causa: ${_esc(r.causa) || '—'} · ${_esc(r.creado)}
            ${r.urgente ? ' <span class="badge badge-danger">URGENTE</span>' : ''}
          </div>
          ${!isOpen && (r.candidatos || []).some(c => c.asignado)
            ? `<div style="margin-top:.3rem"><span class="badge badge-success">Reemplazo: ${_esc((r.candidatos.find(c => c.asignado) || {}).nombre || '')}</span></div>` : ''}
        </div>
        ${isOpen ? `
        <div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap">
          ${opcionesCand
            ? `<select data-op="remCand" data-id="${_esc(r.id)}" class="form-input" style="min-width:170px;padding:.35rem .5rem">${opcionesCand}</select>
               <button data-op="asignarRem" data-id="${_esc(r.id)}" class="btn btn-sm btn-primary">✓ Asignar</button>`
            : '<span class="text-muted" style="font-size:.78rem">Sin candidatos cargados</span>'}
          <button data-op="descartarRem" data-id="${_esc(r.id)}" class="btn btn-sm btn-outline">Descartar</button>
        </div>` : ''}
      </div>`;
    };

    cont.innerHTML =
      (pendientes.length ? `<h4 style="font-weight:700;margin:.75rem 0">Pendientes (${pendientes.length})</h4>` +
        pendientes.map(r => card(r, true)).join('') : '') +
      (resueltos.length ? `<h4 style="font-weight:700;margin:1.25rem 0 .75rem">Resueltos</h4>` +
        resueltos.slice(0, 10).map(r => card(r, false)).join('') : '');
  }

  async function _submitReemplazo() {
    const ausenteSel = _val('rem-ausente');
    if (!ausenteSel) { _msg('rem-msg', false, 'Seleccione el empleado ausente.'); return; }

    const candidatos = [];
    ['rem-cand1', 'rem-cand2', 'rem-cand3'].forEach(id => {
      const v = _val(id);
      if (v) candidatos.push({ nombre: v });
    });

    const r = await API.registrarAusencia(_admin.email, {
      ausente: ausenteSel,
      turno: _val('rem-turno'),
      causa: _val('rem-causa'),
      urgente: document.getElementById('rem-urgente')?.checked === true,
      candidatos
    });
    if (r.success) {
      ['rem-turno', 'rem-causa', 'rem-cand1', 'rem-cand2', 'rem-cand3'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
      const u = document.getElementById('rem-urgente'); if (u) u.checked = false;
      _msg('rem-msg', true, r.message || 'Ausencia registrada.');
      await load(true);
      _renderReemplazosLista();
    } else {
      _msg('rem-msg', false, r.error || 'Error al registrar.');
    }
  }

  async function _asignarReemplazo(id) {
    const reem = (_data.reemplazos || []).find(r => r.id === id);
    if (!reem) return;
    const sel = document.querySelector(`[data-op="remCand"][data-id="${id}"]`);
    const idx = sel ? parseInt(sel.value, 10) : -1;
    const cand = (reem.candidatos || [])[idx];
    if (!cand) { alert('Seleccione un candidato.'); return; }
    const r = await API.asignarReemplazo(_admin.email, id, cand.nombre);
    if (r.success) { await load(true); _renderReemplazosLista(); }
    else alert(r.error || 'Error al asignar.');
  }

  async function _descartarReemplazo(id) {
    if (!confirm('¿Cerrar esta ausencia sin asignar reemplazo?')) return;
    const r = await API.descartarReemplazo(_admin.email, id);
    if (r.success) { await load(true); _renderReemplazosLista(); }
    else alert(r.error || 'Error al descartar.');
  }

  // ============================================================
  // TAB: OBSERVACIONES + ALERTAS
  // ============================================================
  function _renderObservaciones() {
    _fillEntidades(_val('obs-tipo') || 'Personal');
    _fillEmpresasSelect('obs-empresa');
    _renderObservacionesTabla();
    _renderAlertas();
  }

  function _renderObservacionesTabla() {
    const tbody = document.getElementById('obs-tbody');
    if (!tbody) return;
    const q = (_val('obs-search') || '').toLowerCase();
    const soloPend = document.getElementById('obs-solo-pend')?.checked;
    let obs = _data.observaciones || [];
    if (soloPend) obs = obs.filter(o => !o.resuelta);
    if (q) obs = obs.filter(o => `${o.entidad} ${o.descripcion} ${o.empresa} ${o.tipo}`.toLowerCase().includes(q));
    obs = obs.slice(-100).reverse();

    if (!obs.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">Sin observaciones.</td></tr>';
      return;
    }

    tbody.innerHTML = obs.map(o => `
      <tr>
        <td>${_esc(o.fecha)}</td>
        <td><span class="badge badge-info">${_esc(o.tipo)}</span></td>
        <td>
          <div style="font-weight:600">${_esc(o.entidad)}</div>
          ${o.empresa ? `<div class="text-muted" style="font-size:.75rem">${_esc(o.empresa)}</div>` : ''}
        </td>
        <td style="max-width:340px">${_esc(o.descripcion)}</td>
        <td>${_badgeEstado(o.severidad === 'bloqueado' ? 'bloqueado' : 'observado')}</td>
        <td>${o.resuelta
          ? `<span class="badge badge-success">Resuelta</span><div class="text-muted" style="font-size:.72rem">por ${_esc(o.resueltoPor)}</div>`
          : `<button data-op="resolverObs" data-id="${_esc(o.id)}" class="btn btn-sm btn-primary">✓ Resolver</button>`}
        </td>
      </tr>`).join('');
  }

  function _renderAlertas() {
    const cont = document.getElementById('alrt-lista');
    if (!cont) return;
    const alertas = _data.alertas || [];
    const noLeidas = alertas.filter(a => !a.leida).length;

    const btn = document.getElementById('btn-marcar-leidas');
    if (btn) btn.style.display = noLeidas ? 'inline-flex' : 'none';
    _set('alrt-count', noLeidas ? `${noLeidas} sin leer` : 'Todo leído');

    if (!alertas.length) {
      cont.innerHTML = '<p class="text-muted">Sin alertas.</p>';
      return;
    }

    const colorIcon = { r: '🔴', y: '🟡', g: '🟢' };
    cont.innerHTML = alertas.map(a => `
      <div style="display:flex;gap:.6rem;align-items:flex-start;padding:.55rem .75rem;border-bottom:1px solid var(--border);${a.leida ? 'opacity:.55' : ''}">
        <span>${colorIcon[a.tipo] || '🔵'}</span>
        <div style="flex:1">
          <div style="font-size:.85rem">${_esc(a.mensaje)}</div>
          <div class="text-muted" style="font-size:.72rem">${_esc(a.fecha)} ${_esc(a.hora)} · ${_esc(a.autor)}</div>
        </div>
        ${a.leida ? '' : '<span class="badge badge-danger" style="font-size:.65rem">nuevo</span>'}
      </div>`).join('');
  }

  function _fillEntidades(tipo) {
    const dl = document.getElementById('obs-entidades');
    if (!dl) return;
    let opts = [];
    if (tipo === 'Personal')       opts = (_data.empleados || []).map(e => `${e.nombre} ${e.apellido}`);
    else if (tipo === 'Vehículo')  opts = (_data.vehiculos || []).map(v => `${v.patente} — ${v.tipo || 'vehículo'}`);
    else if (tipo === 'Empresa')   opts = (_data.empresas  || []).map(c => c.nombre);
    dl.innerHTML = opts.map(o => `<option value="${_esc(o)}"></option>`).join('');
  }

  async function _submitObservacion() {
    const o = {
      tipo: _val('obs-tipo'),
      entidad: _val('obs-entidad'),
      empresa: _val('obs-empresa'),
      severidad: _val('obs-sev'),
      descripcion: _val('obs-desc')
    };
    if (!o.entidad || !o.descripcion) { _msg('obs-msg', false, 'Complete entidad y descripción.'); return; }
    const r = await API.agregarObservacion(_admin.email, o);
    if (r.success) {
      document.getElementById('obs-desc').value = '';
      document.getElementById('obs-entidad').value = '';
      _msg('obs-msg', true, r.message || 'Observación registrada.');
      await load(true);
      _renderObservacionesTabla();
      _renderAlertas();
    } else {
      _msg('obs-msg', false, r.error || 'Error al registrar.');
    }
  }

  async function _resolverObservacion(id) {
    const r = await API.resolverObservacion(_admin.email, id);
    if (r.success) { await load(true); _renderObservacionesTabla(); }
    else alert(r.error || 'Error al resolver.');
  }

  async function _marcarAlertasLeidas() {
    const r = await API.marcarAlertasLeidas(_admin.email);
    if (r.success) { await load(true); _renderAlertas(); }
    else alert(r.error || 'Error.');
  }

  // ============================================================
  // TAB: VEHÍCULOS
  // ============================================================
  function _renderVehiculos() {
    _fillEmpresasSelect('veh-empresa');
    const tbody = document.getElementById('veh-tbody');
    if (!tbody) return;
    const vehs = _data.vehiculos || [];

    if (!vehs.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted">Sin vehículos cargados.</td></tr>';
      return;
    }

    tbody.innerHTML = vehs.map(v => `
      <tr>
        <td style="font-weight:700">${_esc(v.patente)}</td>
        <td>${_esc(v.tipo) || '—'}</td>
        <td>${_esc(v.empresa) || '<span class="text-muted">—</span>'}</td>
        <td>${_vencCell(v.seguroVenc, v.seguroEstado)}</td>
        <td>${_vencCell(v.vtvVenc, v.vtvEstado)}</td>
        <td>${v.obs ? `<span class="badge badge-warning" title="${_esc(v.obs)}">con obs.</span>` : _badgeEstado(v.estado)}</td>
        <td>
          <select data-op="vehEstado" data-id="${_esc(v.id)}" class="form-input" style="min-width:125px;padding:.35rem .5rem">
            <option value="habilitado" ${v.estado === 'habilitado' ? 'selected' : ''}>Habilitado</option>
            <option value="observado"  ${v.estado === 'observado'  ? 'selected' : ''}>Observado</option>
            <option value="bloqueado"  ${v.estado === 'bloqueado'  ? 'selected' : ''}>Bloqueado</option>
          </select>
        </td>
        <td>
          <button data-op="editarVehiculo" data-id="${_esc(v.id)}" class="btn btn-sm btn-outline">✏️ Editar</button>
        </td>
      </tr>`).join('');
  }

  async function _submitVehiculo() {
    const v = {
      patente: _val('veh-patente'),
      tipo: _val('veh-tipo'),
      empresa: _val('veh-empresa'),
      seguroVenc: _val('veh-seguro'),
      vtvVenc: _val('veh-vtv'),
      obs: _val('veh-obs')
    };
    if (!v.patente) { _msg('veh-msg', false, 'La patente es obligatoria.'); return; }
    const r = await API.agregarVehiculo(_admin.email, v);
    if (r.success) {
      ['veh-patente', 'veh-tipo', 'veh-seguro', 'veh-vtv', 'veh-obs'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
      _msg('veh-msg', true, r.message || 'Vehículo agregado.');
      await load(true);
      _renderVehiculos();
    } else {
      _msg('veh-msg', false, r.error || 'Error al agregar.');
    }
  }

  async function _setVehiculoEstado(id, valor) {
    const r = await API.actualizarVehiculo(_admin.email, id, 'estado', valor);
    if (r.success) { await load(true); _renderVehiculos(); }
    else alert(r.error || 'No se pudo actualizar.');
  }

  // ============================================================
  // TAB: EMPRESAS
  // ============================================================
  function _renderEmpresas() {
    const tbody = document.getElementById('empr-tbody');
    if (!tbody) return;
    const emps = _data.empresas || [];

    if (!emps.length) {
      tbody.innerHTML = '<tr><td colspan="9" class="text-center text-muted">Sin empresas cargadas.</td></tr>';
      return;
    }

    tbody.innerHTML = emps.map(c => `
      <tr>
        <td style="font-weight:700">${_esc(c.nombre)}</td>
        <td>${_esc(c.tipo) || '—'}</td>
        <td>${_esc(c.cuit) || '—'}</td>
        <td>${_vencCell(c.artVenc, c.artEstado)}</td>
        <td>${_vencCell(c.seguroVenc, c.seguroEstado)}</td>
        <td>${c.empleados ? `${c.habilitados}/${c.empleados} hab.` : '<span class="text-muted">—</span>'}</td>
        <td>${c.vehiculos ? _esc(c.vehiculos) : '<span class="text-muted">—</span>'}</td>
        <td>
          <select data-op="contrato" data-id="${_esc(c.id)}" class="form-input" style="min-width:105px;padding:.35rem .5rem">
            <option value="Activo"    ${c.contrato === 'Activo'    ? 'selected' : ''}>Activo</option>
            <option value="Suspendido" ${c.contrato === 'Suspendido' ? 'selected' : ''}>Suspendido</option>
            <option value="Finalizado" ${c.contrato === 'Finalizado' ? 'selected' : ''}>Finalizado</option>
          </select>
        </td>
        <td>
          <button data-op="editarEmpresa" data-id="${_esc(c.id)}" class="btn btn-sm btn-outline">✏️ Editar</button>
        </td>
      </tr>`).join('');
  }

  async function _submitEmpresa() {
    const c = {
      nombre: _val('empr-nombre'),
      tipo: _val('empr-tipo'),
      cuit: _val('empr-cuit'),
      artVenc: _val('empr-art'),
      seguroVenc: _val('empr-seguro')
    };
    if (!c.nombre) { _msg('empr-msg', false, 'La razón social es obligatoria.'); return; }
    const r = await API.agregarEmpresa(_admin.email, c);
    if (r.success) {
      ['empr-nombre', 'empr-tipo', 'empr-cuit', 'empr-art', 'empr-seguro'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
      _msg('empr-msg', true, r.message || 'Empresa agregada.');
      await load(true);
      _renderEmpresas();
    } else {
      _msg('empr-msg', false, r.error || 'Error al agregar.');
    }
  }

  async function _setEmpresaContrato(id, valor) {
    const r = await API.actualizarEmpresa(_admin.email, id, 'contrato', valor);
    if (r.success) { await load(true); _renderEmpresas(); }
    else alert(r.error || 'No se pudo actualizar.');
  }

  // ============================================================
  // TAB: TRAZABILIDAD
  // ============================================================
  async function _renderTrazabilidad() {
    const tbody = document.getElementById('traza-tbody');
    if (!tbody) return;

    const fetchTraza = async () => {
      const r = await API.obtenerTrazabilidad(_admin.email);
      if (!r.success) throw new Error(r.error || 'No se pudo cargar la trazabilidad.');
      _trazaCache = r;
      _lastTraza  = Date.now();
      return r;
    };

    let r;
    if (_trazaCache && (Date.now() - _lastTraza < CACHE_TTL)) {
      r = _trazaCache;   // caché fresca: render inmediato
    } else if (_trazaCache) {
      r = _trazaCache;   // render con caché y refresco en background
      fetchTraza().then(fresh => { _trazaCache = fresh; _renderTrazaTabla(fresh.traza || []); }).catch(() => {});
    } else {
      r = await fetchTraza();   // primera vez
    }
    _renderTrazaTabla(r.traza || []);
  }

  function _renderTrazaTabla(traza) {
    const tbody = document.getElementById('traza-tbody');
    if (!tbody) return;
    if (!traza.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">Sin movimientos registrados.</td></tr>';
      return;
    }
    const colorBadge = {
      verde:    '<span class="badge badge-success">alta</span>',
      rojo:     '<span class="badge badge-danger">crítico</span>',
      amarillo: '<span class="badge badge-warning">aviso</span>',
      azul:     '<span class="badge badge-info">info</span>'
    };

    tbody.innerHTML = traza.map(t => `
      <tr>
        <td style="white-space:nowrap">${_esc(t.fecha)} ${_esc(t.hora)}</td>
        <td>${_esc(t.usuario)}</td>
        <td style="max-width:480px">${_esc(t.accion)}</td>
        <td>${colorBadge[t.color] || colorBadge.azul}</td>
      </tr>`).join('');
  }

  // ============================================================
  // MODAL DE EDICIÓN (datos maestros: vehículos, empresas, personal)
  // Solo se envían al backend los campos que cambiaron.
  // Cada cambio queda registrado en la hoja Trazabilidad.
  // ============================================================
  const _toISO = (s) => {
    if (!s) return '';
    const str = String(s).trim();
    const m = str.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
    return '';
  };

  const _modal = {
    open(title, fields, onSave) {
      const ov = document.getElementById('op-modal-overlay');
      const tt = document.getElementById('op-modal-title');
      const bb = document.getElementById('op-modal-body');
      const mm = document.getElementById('op-modal-msg');
      if (!ov || !bb) return;
      tt.textContent = title;
      if (mm) mm.innerHTML = '';
      bb.innerHTML = fields.map(f => `
        <div class="form-group" style="margin-bottom:.85rem">
          <label class="form-label">${_esc(f.label)}</label>
          ${f.type === 'select'
            ? `<select id="opmf-${_esc(f.key)}" class="form-input">${(f.options || []).map(o =>
                `<option value="${_esc(o)}" ${o === f.value ? 'selected' : ''}>${o === '' ? '— Sin asignar —' : _esc(o)}</option>`).join('')}</select>`
            : `<input type="${f.type || 'text'}" id="opmf-${_esc(f.key)}" class="form-input" value="${_esc(f.value || '')}" />`}
        </div>`).join('');

      const saveBtn = document.getElementById('op-modal-save');
      const fresh = saveBtn.cloneNode(true);
      saveBtn.parentNode.replaceChild(fresh, saveBtn);
      fresh.addEventListener('click', async () => {
        const vals = {};
        fields.forEach(f => { vals[f.key] = _val('opmf-' + f.key); });
        fresh.disabled = true;
        fresh.textContent = 'Guardando...';
        try {
          await onSave(vals);
          ov.classList.add('hidden');
        } catch (err) {
          _msg('op-modal-msg', false, err.message || 'Error al guardar.');
        } finally {
          fresh.disabled = false;
          fresh.textContent = '💾 Guardar cambios';
        }
      });
      ov.classList.remove('hidden');
    },
    close() {
      const ov = document.getElementById('op-modal-overlay');
      if (ov) ov.classList.add('hidden');
    }
  };

  // Envía solo los campos modificados, uno por acción (cada uno queda en trazabilidad)
  async function _applyUpdates(tipo, id, original, vals) {
    const calls = {
      vehiculo: (campo, valor) => API.actualizarVehiculo(_admin.email, id, campo, valor),
      empresa:  (campo, valor) => API.actualizarEmpresa(_admin.email, id, campo, valor),
      empleado: (campo, valor) => API.actualizarEmpleado(_admin.email, id, campo, valor)
    };
    const fn = calls[tipo];
    let cambios = 0;
    for (const [campo, valor] of Object.entries(vals)) {
      const prev = String(original[campo] || '').trim();
      const next = String(valor || '').trim();
      const prevNorm = /Venc$/.test(campo) ? _toISO(prev) : prev; // fechas: comparar en ISO
      const nextNorm = /Venc$/.test(campo) ? _toISO(next) : next;
      if (prevNorm === nextNorm) continue;
      const r = await fn(campo, valor);
      if (!r.success) throw new Error(r.error || `No se pudo actualizar el campo "${campo}".`);
      cambios++;
    }
    if (!cambios) throw new Error('No se detectaron cambios para guardar.');
  }

  function _editarVehiculo(id) {
    const v = (_data.vehiculos || []).find(x => x.id === id);
    if (!v) return;
    const empresas = (_data.empresas || []).map(c => c.nombre);
    _modal.open(`Editar vehículo — ${v.patente}`, [
      { key: 'patente',    label: 'Patente', value: v.patente },
      { key: 'tipo',       label: 'Tipo', value: v.tipo || '' },
      { key: 'empresa',    label: 'Empresa', type: 'select', value: v.empresa || '', options: [''].concat(empresas) },
      { key: 'seguroVenc', label: 'Vencimiento seguro', type: 'date', value: _toISO(v.seguroVenc) },
      { key: 'vtvVenc',    label: 'Vencimiento VTV', type: 'date', value: _toISO(v.vtvVenc) },
      { key: 'obs',        label: 'Observaciones', value: v.obs || '' }
    ], async (vals) => {
      if (vals.patente && vals.patente.toUpperCase() !== String(v.patente).toUpperCase()) {
        const dup = (_data.vehiculos || []).some(x => x.id !== id &&
          String(x.patente).toUpperCase() === vals.patente.toUpperCase());
        if (dup) throw new Error('Ya existe otro vehículo con esa patente.');
      }
      await _applyUpdates('vehiculo', id, v, vals);
      await load(true);
      _renderVehiculos();
    });
  }

  function _editarEmpresa(id) {
    const c = (_data.empresas || []).find(x => x.id === id);
    if (!c) return;
    _modal.open(`Editar empresa — ${c.nombre}`, [
      { key: 'nombre',     label: 'Razón social', value: c.nombre },
      { key: 'tipo',       label: 'Tipo', value: c.tipo || '' },
      { key: 'cuit',       label: 'CUIT', value: c.cuit || '' },
      { key: 'artVenc',    label: 'Vencimiento ART', type: 'date', value: _toISO(c.artVenc) },
      { key: 'seguroVenc', label: 'Vencimiento seguro', type: 'date', value: _toISO(c.seguroVenc) }
    ], async (vals) => {
      if (vals.nombre && vals.nombre.toLowerCase() !== String(c.nombre).toLowerCase()) {
        const dup = (_data.empresas || []).some(x => x.id !== id &&
          String(x.nombre).toLowerCase() === vals.nombre.toLowerCase());
        if (dup) throw new Error('Ya existe otra empresa con ese nombre.');
      }
      await _applyUpdates('empresa', id, c, vals);
      await load(true);
      _renderEmpresas();
    });
  }

  function _editarEmpleado(email) {
    const e = (_data.empleados || []).find(x => x.email === email);
    if (!e) return;
    const empresas = (_data.empresas || []).map(c => c.nombre);
    _modal.open(`Editar documentos — ${e.nombre} ${e.apellido}`, [
      { key: 'dni',           label: 'DNI', value: e.dni || '' },
      { key: 'telefono',      label: 'Teléfono', value: e.telefono || '' },
      { key: 'empresa',       label: 'Empresa', type: 'select', value: e.empresa || '', options: [''].concat(empresas) },
      { key: 'convenio',      label: 'Convenio (define cierre quincenal o mensual)', type: 'select', value: e.convenio || '',
        options: ['', 'UOCRA 76/75', 'AOMA 673/04', 'Fuera de convenio'] },
      { key: 'aptoVenc',      label: 'Vencimiento apto médico', type: 'date', value: _toISO(e.aptoVenc) },
      { key: 'licenciaTipo',  label: 'Tipo de licencia', value: e.licenciaTipo || '' },
      { key: 'licenciaVenc',  label: 'Vencimiento licencia', type: 'date', value: _toISO(e.licenciaVenc) }
    ], async (vals) => {
      await _applyUpdates('empleado', email, e, vals);
      await load(true);
      _renderHabilitaciones();
    });
  }

  // ---------- helpers de selects ----------
  function _fillEmpresasSelect(id) {
    const sel = document.getElementById(id);
    if (!sel) return;
    const current = sel.value;
    const nombres = (_data.empresas || []).map(c => c.nombre);
    sel.innerHTML = '<option value="">— Sin asignar —</option>' +
      nombres.map(n => `<option value="${_esc(n)}">${_esc(n)}</option>`).join('');
    if (nombres.includes(current)) sel.value = current;
  }

  function _fillEmpleadosSelect(id) {
    const sel = document.getElementById(id);
    if (!sel) return;
    const current = sel.value;
    const nombres = (_data.empleados || []).filter(e => e.activo)
      .map(e => `${e.nombre} ${e.apellido}`).sort();
    sel.innerHTML = '<option value="">— Seleccione —</option>' +
      nombres.map(n => `<option value="${_esc(n)}">${_esc(n)}</option>`).join('');
    if (nombres.includes(current)) sel.value = current;
  }

  // ---------- API pública ----------
  return { init, render, load };
})();
