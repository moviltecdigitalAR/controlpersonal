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
  async function load(force) {
    if (_data && !force) return _data;
    const r = await API.obtenerOperacion(_admin.email);
    if (!r.success) throw new Error(r.error || 'No se pudo cargar el módulo Operación.');
    _data = r;
    return _data;
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
  }

  // ---------- delegación ----------
  function _onDelegatedClick(e) {
    const btn = e.target.closest('[data-op]');
    if (!btn) return;
    const { op, id, email, nombre } = btn.dataset;
    const handlers = {
      resolverObs:   () => _resolverObservacion(id),
      asignarRem:    () => _asignarReemplazo(id),
      descartarRem:  () => _descartarReemplazo(id),
      marcarLeidas:  () => _marcarAlertasLeidas(),
      obsEmpleado:   () => _abrirObsEmpleado(email, nombre),
      cerrarObsEmp:  () => _cerrarObsEmpleado()
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
  async function render(tab) {
    if (!_admin) return;
    try {
      if (tab === 'trazabilidad') return await _renderTrazabilidad();
      await load(true);
      if (tab === 'operacion')     _renderHabilitaciones();
      if (tab === 'reemplazos')    _renderReemplazos();
      if (tab === 'observaciones') _renderObservaciones();
      if (tab === 'vehiculos')     _renderVehiculos();
      if (tab === 'empresas')      _renderEmpresas();
    } catch (err) {
      console.error('[Operacion]', err);
      ['op-stats','hab-tbody','rem-lista','obs-tbody','alrt-lista','veh-tbody','emp-tbody','traza-tbody'].forEach(id => {
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
          <button data-op="obsEmpleado" data-email="${_esc(e.email)}" data-nombre="${_esc(e.nombre + ' ' + e.apellido)}"
                  class="btn btn-sm btn-outline">📝 Observación</button>
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
      tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">Sin vehículos cargados.</td></tr>';
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
    const tbody = document.getElementById('emp-tbody');
    if (!tbody) return;
    const emps = _data.empresas || [];

    if (!emps.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted">Sin empresas cargadas.</td></tr>';
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
      </tr>`).join('');
  }

  async function _submitEmpresa() {
    const c = {
      nombre: _val('emp-nombre'),
      tipo: _val('emp-tipo'),
      cuit: _val('emp-cuit'),
      artVenc: _val('emp-art'),
      seguroVenc: _val('emp-seguro')
    };
    if (!c.nombre) { _msg('emp-msg', false, 'La razón social es obligatoria.'); return; }
    const r = await API.agregarEmpresa(_admin.email, c);
    if (r.success) {
      ['emp-nombre', 'emp-tipo', 'emp-cuit', 'emp-art', 'emp-seguro'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
      _msg('emp-msg', true, r.message || 'Empresa agregada.');
      await load(true);
      _renderEmpresas();
    } else {
      _msg('emp-msg', false, r.error || 'Error al agregar.');
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
    const r = await API.obtenerTrazabilidad(_admin.email);
    if (!r.success) throw new Error(r.error || 'No se pudo cargar la trazabilidad.');
    const traza = r.traza || [];

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
