// ============================================================
// CONTROL DE ACCESO PERSONAL - Google Apps Script Backend
// ============================================================
// INSTALACIÓN:
// 1. Ir a script.google.com → Nuevo proyecto
// 2. Pegar este código completo
// 3. Ir a Proyecto > Propiedades del script > Propiedades de secuencia de comandos
//    Agregar: SHEET_ID = (ID de tu Google Sheets, el número largo de la URL)
// 4. Desplegar: Implementar > Nueva implementación > Web App
//    - Ejecutar como: Yo (mi cuenta de Google)
//    - Quién tiene acceso: Cualquier persona
// 5. Copiar la URL del Web App y pegarla en js/config.js
// ============================================================

function getSpreadsheet() {
  const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!sheetId) throw new Error('SHEET_ID no configurado en las propiedades del script.');
  return SpreadsheetApp.openById(sheetId);
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const result = handleAction(data);
    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  try {
    const result = handleAction(e.parameter || {});
    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function handleAction(data) {
  switch (data.action) {
    case 'verificarEmpleado':    return verificarEmpleado(data);
    case 'registrarMovimiento':  return registrarMovimiento(data);
    case 'obtenerEstado':        return obtenerEstado(data);
    case 'obtenerReporte':       return obtenerReporte(data);
    case 'obtenerEmpleados':     return obtenerEmpleados(data);
    case 'agregarEmpleado':      return agregarEmpleado(data);
    case 'actualizarEmpleado':   return actualizarEmpleado(data);
    case 'resetearDispositivo':  return resetearDispositivo(data);
    case 'actualizarConfig':     return actualizarConfig(data);
    case 'getConfig':            return getConfig();
    default: return { success: false, error: 'Acción no válida: ' + data.action };
  }
}

// ============================================================
// HELPERS DE HOJAS
// ============================================================

function getEmpleadosSheet()   { return getSpreadsheet().getSheetByName('Empleados'); }
function getRegistrosSheet()   { return getSpreadsheet().getSheetByName('Registros'); }
function getConfigSheet()      { return getSpreadsheet().getSheetByName('Configuracion'); }

function findEmpleado(email) {
  const sheet = getEmpleadosSheet();
  const rows  = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).toLowerCase().trim() === String(email).toLowerCase().trim()) {
      return { rowIndex: i + 1, data: rows[i] };
    }
  }
  return null;
}

function rowToEmpleado(row) {
  return {
    email:         row[0],
    nombre:        row[1],
    apellido:      row[2],
    sector:        row[3],
    turno:         row[4],
    dispositivoId: row[5],
    activo:        row[6] === true || String(row[6]).toUpperCase() === 'TRUE',
    esAdmin:       row[7] === true || String(row[7]).toUpperCase() === 'TRUE',
    estado:        row[8] || 'Fuera'
  };
}

// ============================================================
// VERIFICAR EMPLEADO (con 3 capas de seguridad)
// ============================================================

function verificarEmpleado(data) {
  const { email, fingerprintId, lat, lng } = data;

  const emp = findEmpleado(email);
  if (!emp) {
    return { success: false, error: 'Email no registrado en el sistema. Contacte al administrador.' };
  }

  const empleado = rowToEmpleado(emp.data);

  if (!empleado.activo) {
    return { success: false, error: 'Empleado inactivo. Contacte al administrador.' };
  }

  // ---- CAPA 2: Dispositivo ----
  if (fingerprintId) {
    const devStored = String(empleado.dispositivoId || '').trim();
    const devSent   = String(fingerprintId).trim();

    if (!devStored) {
      // Primera vez: vincular dispositivo automáticamente
      getEmpleadosSheet().getRange(emp.rowIndex, 6).setValue(devSent);
      empleado.dispositivoId = devSent;
      empleado.primerDispositivo = true;
    } else if (devStored !== devSent) {
      return {
        success:   false,
        errorCode: 'DEVICE_MISMATCH',
        error:     'Dispositivo no autorizado. Solo puede registrarse desde su celular habitual. Si cambió de teléfono, contacte al administrador para vincularlo nuevamente.'
      };
    }
  }

  // ---- CAPA 3: Geofencing ----
  if (lat !== undefined && lat !== null && lng !== undefined && lng !== null) {
    const cfg = getConfigData();
    if (cfg.lat_empresa && cfg.lng_empresa && cfg.radio_metros) {
      const dist = haversine(
        parseFloat(lat), parseFloat(lng),
        parseFloat(cfg.lat_empresa), parseFloat(cfg.lng_empresa)
      );
      const radio = parseFloat(cfg.radio_metros);
      if (dist > radio) {
        return {
          success:   false,
          errorCode: 'OUT_OF_GEOFENCE',
          error:     `Fuera del área permitida. Debe estar a menos de ${radio}m del establecimiento. Distancia actual: ${Math.round(dist)}m.`,
          distancia: Math.round(dist)
        };
      }
    }
  }

  return { success: true, empleado };
}

// ============================================================
// REGISTRAR MOVIMIENTO (Ingreso / Egreso)
// ============================================================

function registrarMovimiento(data) {
  const verif = verificarEmpleado(data);
  if (!verif.success) return verif;

  const empleado = verif.empleado;
  const emp      = findEmpleado(data.email);

  const ss  = getSpreadsheet();
  const tz  = ss.getSpreadsheetTimeZone();
  const now  = new Date();
  const fecha    = Utilities.formatDate(now, tz, 'dd/MM/yyyy');
  const hora     = Utilities.formatDate(now, tz, 'HH:mm:ss');
  const dias     = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
  const diaSemana = dias[now.getDay()];

  const registrosSheet = getRegistrosSheet();
  const empleadosSheet = getEmpleadosSheet();

  const estaFuera = !empleado.estado || empleado.estado === '' || empleado.estado === 'Fuera';

  if (estaFuera) {
    // ---- INGRESO ----
    registrosSheet.appendRow([
      Utilities.getUuid(),
      empleado.email, empleado.nombre, empleado.apellido,
      empleado.sector, empleado.turno,
      fecha, hora,
      '', '',   // egreso y duración vacíos
      diaSemana
    ]);
    empleadosSheet.getRange(emp.rowIndex, 9).setValue('Dentro');

    return {
      success: true, tipo: 'ingreso',
      hora, fecha, diaSemana,
      empleado: { nombre: empleado.nombre, apellido: empleado.apellido, sector: empleado.sector, turno: empleado.turno }
    };

  } else {
    // ---- EGRESO: buscar el último ingreso abierto (sin egreso) ----
    const registros = registrosSheet.getDataRange().getValues();
    let lastRow     = -1;
    let ingresoHora = '';
    let ingresoFecha = '';

    for (let i = registros.length - 1; i >= 1; i--) {
      const rowEmail   = String(registros[i][1]).toLowerCase();
      const tieneIngr  = registros[i][7] !== '' && registros[i][7] !== null && registros[i][7] !== undefined;
      const sinEgreso  = !registros[i][8] || registros[i][8] === '';
      if (rowEmail === String(data.email).toLowerCase() && tieneIngr && sinEgreso) {
        lastRow      = i + 1;
        ingresoHora  = registros[i][7];
        ingresoFecha = registros[i][6];
        break;
      }
    }

    if (lastRow === -1) {
      empleadosSheet.getRange(emp.rowIndex, 9).setValue('Fuera');
      return { success: false, error: 'No se encontró un ingreso abierto. Estado reseteado a Fuera.' };
    }

    // Calcular duración
    const ingresoDate  = parseFechaHora(ingresoFecha, ingresoHora);
    const duracionMin  = Math.max(0, Math.round((now - ingresoDate) / 60000));
    if (isNaN(duracionMin)) duracionMin = 0;
    const duracionFormato = formatDuracion(duracionMin);

    registrosSheet.getRange(lastRow, 9).setValue(hora);
    registrosSheet.getRange(lastRow, 10).setValue(duracionMin);
    empleadosSheet.getRange(emp.rowIndex, 9).setValue('Fuera');

    return {
      success: true, tipo: 'egreso',
      hora, fecha, diaSemana,
      duracionMin, duracionFormato,
      empleado: { nombre: empleado.nombre, apellido: empleado.apellido, sector: empleado.sector, turno: empleado.turno }
    };
  }
}

function obtenerEstado(data) {
  const verif = verificarEmpleado(data);
  if (!verif.success) return verif;
  return { success: true, estado: verif.empleado.estado || 'Fuera', empleado: verif.empleado };
}

// ============================================================
// FUNCIONES ADMIN
// ============================================================

function esAdminFn(email) {
  const emp = findEmpleado(email);
  if (!emp) return false;
  return emp.data[7] === true || String(emp.data[7]).toUpperCase() === 'TRUE';
}

function obtenerEmpleados(data) {
  if (!esAdminFn(data.adminEmail)) return { success: false, error: 'Sin permisos de administrador.' };

  const sheet = getEmpleadosSheet();
  const rows  = sheet.getDataRange().getValues();
  const empleados = [];

  for (let i = 1; i < rows.length; i++) {
    if (!rows[i][0]) continue;
    empleados.push({
      email:           rows[i][0],
      nombre:          rows[i][1],
      apellido:        rows[i][2],
      sector:          rows[i][3],
      turno:           rows[i][4],
      tieneDispositivo: !!(rows[i][5] && rows[i][5] !== ''),
      activo:          rows[i][6] === true || String(rows[i][6]).toUpperCase() === 'TRUE',
      esAdmin:         rows[i][7] === true || String(rows[i][7]).toUpperCase() === 'TRUE',
      estado:          rows[i][8] || 'Fuera'
    });
  }
  return { success: true, empleados };
}

function agregarEmpleado(data) {
  if (!esAdminFn(data.adminEmail)) return { success: false, error: 'Sin permisos.' };
  const e = data.empleado;
  if (!e || !e.email || !e.nombre || !e.apellido) return { success: false, error: 'Datos incompletos.' };
  if (findEmpleado(e.email)) return { success: false, error: 'Ya existe un empleado con ese email.' };

  getEmpleadosSheet().appendRow([
    e.email.toLowerCase().trim(),
    e.nombre, e.apellido, e.sector || '', e.turno || '',
    '',   // dispositivo vacío
    true, // activo
    e.esAdmin === true || e.esAdmin === 'true' ? true : false,
    'Fuera'
  ]);
  return { success: true, message: 'Empleado agregado correctamente.' };
}

function actualizarEmpleado(data) {
  if (!esAdminFn(data.adminEmail)) return { success: false, error: 'Sin permisos.' };
  const emp = findEmpleado(data.email);
  if (!emp) return { success: false, error: 'Empleado no encontrado.' };

  const colMap = { nombre: 2, apellido: 3, sector: 4, turno: 5, activo: 7, esAdmin: 8 };
  const col = colMap[data.campo];
  if (!col) return { success: false, error: 'Campo no válido.' };

  getEmpleadosSheet().getRange(emp.rowIndex, col).setValue(data.valor);
  return { success: true };
}

function resetearDispositivo(data) {
  if (!esAdminFn(data.adminEmail)) return { success: false, error: 'Sin permisos.' };
  const emp = findEmpleado(data.emailEmpleado);
  if (!emp) return { success: false, error: 'Empleado no encontrado.' };
  getEmpleadosSheet().getRange(emp.rowIndex, 6).setValue('');
  return { success: true, message: 'Dispositivo desvinculado. El empleado podrá vincular uno nuevo en su próximo acceso.' };
}

// ============================================================
// REPORTES
// ============================================================

function obtenerReporte(data) {
  if (!esAdminFn(data.adminEmail)) return { success: false, error: 'Sin permisos.' };

  const filtros = data.filtros || {};
  const sheet   = getRegistrosSheet();
  const rows    = sheet.getDataRange().getValues();
  let registros = [];

  for (let i = 1; i < rows.length; i++) {
    if (!rows[i][0]) continue;
    registros.push({
      id:          rows[i][0],
      email:       rows[i][1],
      nombre:      rows[i][2],
      apellido:    rows[i][3],
      sector:      rows[i][4],
      turno:       rows[i][5],
      fecha:       rows[i][6],
      horaIngreso: rows[i][7],
      horaEgreso:  rows[i][8],
      duracionMin: Number(rows[i][9]) || 0,
      diaSemana:   rows[i][10]
    });
  }

  // Aplicar filtros
  if (filtros.email)      registros = registros.filter(r => String(r.email).toLowerCase() === String(filtros.email).toLowerCase());
  if (filtros.sector)     registros = registros.filter(r => r.sector === filtros.sector);
  if (filtros.turno)      registros = registros.filter(r => r.turno === filtros.turno);
  if (filtros.fechaDesde) {
    const desde = parseFechaSimple(filtros.fechaDesde);
    registros = registros.filter(r => parseFechaSimple(r.fecha) >= desde);
  }
  if (filtros.fechaHasta) {
    const hasta = parseFechaSimple(filtros.fechaHasta);
    registros = registros.filter(r => parseFechaSimple(r.fecha) <= hasta);
  }

  // Resumen por empleado
  const mapa = {};
  registros.forEach(r => {
    if (!mapa[r.email]) {
      mapa[r.email] = {
        email: r.email, nombre: r.nombre, apellido: r.apellido,
        sector: r.sector, turno: r.turno,
        diasSet: new Set(), totalMin: 0, cantRegistros: 0
      };
    }
    mapa[r.email].diasSet.add(String(r.fecha));
    mapa[r.email].totalMin    += r.duracionMin;
    mapa[r.email].cantRegistros++;
  });

  const resumen = Object.values(mapa).map(e => ({
    email:        e.email,
    nombre:       e.nombre,
    apellido:     e.apellido,
    sector:       e.sector,
    turno:        e.turno,
    diasAsistidos: e.diasSet.size,
    totalMin:     e.totalMin,
    totalHoras:   Math.round(e.totalMin / 60 * 10) / 10,
    totalFormato: formatDuracion(e.totalMin),
    promedioDiarioMin: e.diasSet.size > 0 ? Math.round(e.totalMin / e.diasSet.size) : 0,
    promedioDiarioFormato: formatDuracion(e.diasSet.size > 0 ? Math.round(e.totalMin / e.diasSet.size) : 0)
  }));

  return { success: true, registros, resumen };
}

// ============================================================
// CONFIGURACIÓN
// ============================================================

function getConfigData() {
  const sheet = getConfigSheet();
  if (!sheet) return {};
  const rows = sheet.getDataRange().getValues();
  const cfg  = {};
  rows.forEach(r => { if (r[0]) cfg[String(r[0])] = r[1]; });
  return cfg;
}

function getConfig() {
  return { success: true, config: getConfigData() };
}

function actualizarConfig(data) {
  if (!esAdminFn(data.adminEmail)) return { success: false, error: 'Sin permisos.' };
  const sheet  = getConfigSheet();
  const rows   = sheet.getDataRange().getValues();
  const config = data.config || {};

  Object.entries(config).forEach(([clave, valor]) => {
    let found = false;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i][0] === clave) {
        sheet.getRange(i + 1, 2).setValue(valor);
        found = true;
        break;
      }
    }
    if (!found) sheet.appendRow([clave, valor]);
  });
  return { success: true, message: 'Configuración actualizada correctamente.' };
}

// ============================================================
// UTILIDADES
// ============================================================

function haversine(lat1, lon1, lat2, lon2) {
  const R    = 6371000;
  const toRad = x => x * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDuracion(min) {
  if (!min || min < 0) return '0h 0m';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h + 'h ' + m + 'm';
}

function parseFechaHora(fecha, hora) {
  let y, M, d;
  if (fecha instanceof Date) {
    y = fecha.getFullYear();
    M = fecha.getMonth();
    d = fecha.getDate();
  } else {
    const parts = String(fecha).split('/');
    y = parseInt(parts[2]);
    M = parseInt(parts[1]) - 1;
    d = parseInt(parts[0]);
  }

  let h = 0, m = 0, s = 0;
  if (hora instanceof Date) {
    h = hora.getHours();
    m = hora.getMinutes();
    s = hora.getSeconds();
  } else {
    const parts = String(hora).split(':');
    h = parseInt(parts[0]);
    m = parseInt(parts[1]);
    s = parseInt(parts[2] || 0);
  }

  return new Date(y, M, d, h, m, s);
}

function parseFechaSimple(fechaStr) {
  if (fechaStr instanceof Date) {
    return new Date(fechaStr.getFullYear(), fechaStr.getMonth(), fechaStr.getDate());
  }
  const p = String(fechaStr).split('/');
  if (p.length === 3) return new Date(parseInt(p[2]), parseInt(p[1]) - 1, parseInt(p[0]));
  return new Date(fechaStr);
}

// ============================================================
// FUNCIÓN DE INICIALIZACIÓN DE HOJAS (ejecutar una sola vez)
// ============================================================

function inicializarHojas() {
  const ss = getSpreadsheet();

  // Hoja Empleados
  let empSheet = ss.getSheetByName('Empleados');
  if (!empSheet) {
    empSheet = ss.insertSheet('Empleados');
    empSheet.appendRow(['Email', 'Nombre', 'Apellido', 'Sector', 'Turno', 'Dispositivo_ID', 'Activo', 'Es_Admin', 'Estado']);
    empSheet.appendRow(['admin@tuempresa.com', 'Admin', 'Principal', 'Dirección', '', '', true, true, 'Fuera']);
    empSheet.getRange('1:1').setFontWeight('bold').setBackground('#4F46E5').setFontColor('white');
  }

  // Hoja Registros
  let regSheet = ss.getSheetByName('Registros');
  if (!regSheet) {
    regSheet = ss.insertSheet('Registros');
    regSheet.appendRow(['ID', 'Email', 'Nombre', 'Apellido', 'Sector', 'Turno', 'Fecha', 'Hora_Ingreso', 'Hora_Egreso', 'Duracion_Min', 'Dia_Semana']);
    regSheet.getRange('1:1').setFontWeight('bold').setBackground('#4F46E5').setFontColor('white');
  }

  // Hoja Configuracion
  let cfgSheet = ss.getSheetByName('Configuracion');
  if (!cfgSheet) {
    cfgSheet = ss.insertSheet('Configuracion');
    cfgSheet.appendRow(['Clave', 'Valor']);
    cfgSheet.appendRow(['nombre_empresa', 'Mi Empresa']);
    cfgSheet.appendRow(['lat_empresa', '']);
    cfgSheet.appendRow(['lng_empresa', '']);
    cfgSheet.appendRow(['radio_metros', '200']);
    cfgSheet.getRange('1:1').setFontWeight('bold').setBackground('#4F46E5').setFontColor('white');
  }

  return { success: true, message: 'Hojas inicializadas correctamente.' };
}
