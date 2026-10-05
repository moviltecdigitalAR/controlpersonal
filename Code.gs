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
    case 'generarDatosDemo':     return generarDatosDemo(data);
    case 'borrarDatosDemo':      return borrarDatosDemo(data);
    case 'marcarNovedad':        return marcarNovedad(data);
    case 'borrarNovedad':        return borrarNovedad(data);
    case 'obtenerNovedades':     return obtenerNovedades(data);
    case 'actualizarConfig':     return actualizarConfig(data);
    case 'getConfig':            return getConfig();
    // ---- Módulo Operación (ex-ShiftControl) ----
    case 'obtenerOperacion':     return obtenerOperacion(data);
    case 'obtenerTrazabilidad':  return obtenerTrazabilidad(data);
    case 'agregarVehiculo':      return agregarVehiculo(data);
    case 'actualizarVehiculo':   return actualizarVehiculo(data);
    case 'agregarEmpresa':       return agregarEmpresa(data);
    case 'actualizarEmpresa':    return actualizarEmpresa(data);
    case 'agregarObservacion':   return agregarObservacion(data);
    case 'resolverObservacion':  return resolverObservacion(data);
    case 'marcarAlertasLeidas':  return marcarAlertasLeidas(data);
    case 'registrarAusencia':    return registrarAusencia(data);
    case 'asignarReemplazo':     return asignarReemplazo(data);
    case 'descartarReemplazo':   return descartarReemplazo(data);
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
    tieneDispositivo: !!(row[5] && row[5] !== ''),
    activo:        row[6] === true || String(row[6]).toUpperCase() === 'TRUE',
    esAdmin:       row[7] === true || String(row[7]).toUpperCase() === 'TRUE',
    estado:        row[8] || 'Fuera',
    // ---- Módulo Operación (columnas J..R, opcionales) ----
    empresa:       row[9]  || '',
    dni:           row[10] || '',
    telefono:      row[11] || '',
    aptoVenc:      fmtFechaCell(row[12]),
    licenciaTipo:  row[13] || '',
    licenciaVenc:  fmtFechaCell(row[14]),
    artEstado:     row[15] || 'ok',
    habilitacion:  row[16] || 'habilitado',
    obsGestion:    row[17] || '',
    // ---- Convenio (columna S) ----
    convenio:      row[18] || ''
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

  // ---- CAPA 1b: Habilitación operativa (módulo Operación) ----
  // Un empleado con habilitación 'bloqueado' no puede fichar el ingreso.
  if (String(empleado.habilitacion).toLowerCase() === 'bloqueado') {
    return {
      success:   false,
      errorCode: 'BLOQUEADO',
      error:     'Su habilitación operativa está bloqueada. Contacte al supervisor para regularizar su documentación.'
    };
  }

  // ---- CAPA 2: Dispositivo ----
  if (fingerprintId) {
    const devStored = String(empleado.dispositivoId || '').trim();
    const devSent   = String(fingerprintId).trim();
    // Solo considerar válido si tiene el formato real de fingerprint (fp_xxxxx)
    // Cualquier otro valor (vacío, "FALSE", espacio, etc.) se trata como no registrado
    const devStoredValid = devStored.startsWith('fp_');

    if (!devStoredValid) {
      // Primera vez o valor inválido: vincular dispositivo automáticamente
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
  const cfg = getConfigData();
  const geofenceEnabled = cfg.lat_empresa !== undefined && cfg.lng_empresa !== undefined && cfg.radio_metros !== undefined &&
    String(cfg.lat_empresa).trim() !== '' && String(cfg.lng_empresa).trim() !== '' && String(cfg.radio_metros).trim() !== '';

  if (geofenceEnabled) {
    const userLat = Number(lat);
    const userLng = Number(lng);
    const centerLat = Number(cfg.lat_empresa);
    const centerLng = Number(cfg.lng_empresa);
    const radio = Number(cfg.radio_metros);
    const accuracy = Math.max(0, Number(data.accuracy) || 0);

    if (!Number.isFinite(userLat) || !Number.isFinite(userLng)) {
      return {
        success: false,
        errorCode: 'LOCATION_REQUIRED',
        error: 'No se pudo validar la ubicación GPS. Active los permisos de ubicación e intente nuevamente.'
      };
    }

    if (!Number.isFinite(centerLat) || !Number.isFinite(centerLng) || !Number.isFinite(radio) || radio <= 0) {
      return {
        success: false,
        errorCode: 'GEOFENCE_CONFIG',
        error: 'La configuración del área GPS no es válida. Contacte al administrador.'
      };
    }

    const dist = haversine(userLat, userLng, centerLat, centerLng);
    if (accuracy > 200 || dist > radio) {
      return {
        success: false,
        errorCode: 'OUT_OF_GEOFENCE',
        error: `Ubicación fuera del área permitida o GPS impreciso. Radio: ${radio}m; distancia: ${Math.round(dist)}m; precisión: ±${Math.round(accuracy)}m.`,
        distancia: Math.round(dist),
        precision: Math.round(accuracy)
      };
    }
  }

  return { success: true, empleado };
}

// ============================================================
// REGISTRAR MOVIMIENTO (Ingreso / Egreso)
// ============================================================

function registrarMovimiento(data) {
  const requestId = String(data.requestId || '').trim();
  if (!requestId) return registrarMovimientoProcesar(data);
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(requestId)) {
    return { success: false, error: 'Identificador de solicitud inválido.' };
  }

  const cache = CacheService.getScriptCache();
  const cacheKey = 'mov_' + requestId;
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const cached = cache.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const result = registrarMovimientoProcesar(data);
    cache.put(cacheKey, JSON.stringify(result), 21600);
    return result;
  } finally {
    lock.releaseLock();
  }
}

function registrarMovimientoProcesar(data) {
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
      '', '',   // egreso y duración: la fórmula se setea abajo
      diaSemana
    ]);
    // Poner fórmula en col J: calcula duración h:mm:ss en cuanto se llene col I (egreso).
    // MOD(...) soporta turnos que cruzan medianoche (ej: 23:00 → 01:00 = 2:00:00)
    const filaIngreso = registrosSheet.getLastRow();
    registrosSheet.getRange(filaIngreso, 10)
      .setFormula('=IF(I' + filaIngreso + '="","",TEXT(MOD(TIMEVALUE(I' + filaIngreso + ')-TIMEVALUE(H' + filaIngreso + '),1),"[h]:mm:ss"))');
    empleadosSheet.getRange(emp.rowIndex, 9).setValue('Dentro');
    logTraza(`Fichada ingreso — ${empleado.nombre} ${empleado.apellido} (${hora})`, empleado.email, 'azul');

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

    // Calcular duración para mostrar en la app (no se escribe en sheet, la fórmula lo hace)
    const ingresoDate    = parseFechaHora(ingresoFecha, ingresoHora);
    const duracionSec    = Math.max(0, Math.round((now - ingresoDate) / 1000));
    const duracionFormato = formatDuracionSec(duracionSec);

    // Solo escribir la hora de egreso — la fórmula en col J calcula la duración sola
    registrosSheet.getRange(lastRow, 9).setValue(hora);
    empleadosSheet.getRange(emp.rowIndex, 9).setValue('Fuera');
    logTraza(`Fichada egreso — ${empleado.nombre} ${empleado.apellido} (${hora}, ${duracionFormato})`, empleado.email, 'azul');

    return {
      success: true, tipo: 'egreso',
      hora, fecha, diaSemana,
      duracionSec, duracionFormato,
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

  migrarEmpleadosColumnas();
  const sheet = getEmpleadosSheet();
  const rows  = sheet.getDataRange().getValues();
  const empleados = [];

  for (let i = 1; i < rows.length; i++) {
    if (!rows[i][0]) continue;
    empleados.push(rowToEmpleado(rows[i]));
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
    'Fuera',
    // ---- Módulo Operación ----
    e.empresa || '', e.dni || '', e.telefono || '',
    e.aptoVenc || '', e.licenciaTipo || '', e.licenciaVenc || '',
    'ok', 'habilitado', '',
    e.convenio || ''
  ]);
  logTraza(`Empleado agregado — ${e.nombre} ${e.apellido} (${e.sector || 'sin sector'})`, data.adminEmail, 'verde');
  return { success: true, message: 'Empleado agregado correctamente.' };
}

function actualizarEmpleado(data) {
  if (!esAdminFn(data.adminEmail)) return { success: false, error: 'Sin permisos.' };
  const emp = findEmpleado(data.email);
  if (!emp) return { success: false, error: 'Empleado no encontrado.' };

  migrarEmpleadosColumnas();
  const colMap = {
    nombre: 2, apellido: 3, sector: 4, turno: 5, activo: 7, esAdmin: 8,
    // ---- Módulo Operación ----
    empresa: 10, dni: 11, telefono: 12, aptoVenc: 13, licenciaTipo: 14,
    licenciaVenc: 15, artEstado: 16, habilitacion: 17, obsGestion: 18,
    convenio: 19
  };
  const col = colMap[data.campo];
  if (!col) return { success: false, error: 'Campo no válido.' };

  getEmpleadosSheet().getRange(emp.rowIndex, col).setValue(data.valor);
  if (data.campo === 'habilitacion') {
    logTraza(`Habilitación cambiada a "${data.valor}" — ${emp.data[1]} ${emp.data[2]}`, data.adminEmail,
      data.valor === 'bloqueado' ? 'rojo' : (data.valor === 'observado' ? 'amarillo' : 'verde'));
  } else {
    logTraza(`Empleado actualizado (${data.campo}) — ${emp.data[1]} ${emp.data[2]}`, data.adminEmail, 'azul');
  }
  return { success: true };
}

function resetearDispositivo(data) {
  if (!esAdminFn(data.adminEmail)) return { success: false, error: 'Sin permisos.' };
  const emp = findEmpleado(data.emailEmpleado);
  if (!emp) return { success: false, error: 'Empleado no encontrado.' };
  getEmpleadosSheet().getRange(emp.rowIndex, 6).setValue('');
  logTraza(`Dispositivo reseteado — ${emp.data[1]} ${emp.data[2]}`, data.adminEmail, 'amarillo');
  return { success: true, message: 'Dispositivo desvinculado. El empleado podrá vincular uno nuevo en su próximo acceso.' };
}

// ============================================================
// DATOS DEMO — empleados y fichadas de ejemplo para probar
// las vistas Resumen / Calendario / Detalle de Asistencias.
// Se crean con el MISMO formato que las fichadas reales.
// ============================================================

const DEMO_EMAILS = ['demo.perez@demo.com', 'demo.gomez@demo.com'];

function generarDatosDemo(data) {
  if (!esAdminFn(data.adminEmail)) return { success: false, error: 'Sin permisos.' };

  // Idempotencia: si ya hay registros demo, no duplicar
  const regSheet = getRegistrosSheet();
  const existentes = regSheet.getDataRange().getValues();
  for (let i = 1; i < existentes.length; i++) {
    if (DEMO_EMAILS.indexOf(String(existentes[i][1]).toLowerCase()) !== -1) {
      return { success: false, error: 'Los datos demo ya existen. Ejecutá "borrarDatosDemo" primero si querés regenerarlos.' };
    }
  }

  const emps = [
    { email: 'demo.perez@demo.com', nombre: 'Carlos', apellido: 'Pérez',
      sector: 'Perforación', turno: '12h (L-V)', dni: '30111222',
      empresa: 'Logistica San Juan', aptoVenc: '15/11/2026' },
    { email: 'demo.gomez@demo.com', nombre: 'María', apellido: 'Gómez',
      sector: 'Planta', turno: '10h (14x14)', dni: '30222333',
      empresa: 'Logistica San Juan', aptoVenc: '20/12/2026' }
  ];

  // Fichadas: [mes, día, horaIngreso, horaEgreso | null (sin cierre)]
  // Pérez: L-V 12h con ausencias, un sábado corto y un viernes sin cierre.
  const perez = [
    [9,  1, '05:58:00', '18:05:00'], [9,  2, '06:12:00', '18:20:00'],
    [9,  3, '05:55:00', '17:50:00'], [9,  4, '06:05:00', '18:10:00'],
    // 5-6 finde ausente, 7 lunes ausente
    [9,  8, '06:02:00', '18:00:00'], [9,  9, '06:18:00', '18:25:00'],
    [9, 10, '05:52:00', '17:48:00'], [9, 11, '06:08:00', '18:15:00'],
    [9, 12, '07:00:00', '13:00:00'],  // sábado, media jornada 6h
    [9, 14, '05:57:00', '18:02:00'], [9, 15, '06:11:00', '18:18:00'],
    [9, 16, '06:00:00', '18:05:00'], [9, 17, '05:49:00', '17:55:00'],
    [9, 18, '06:15:00', '18:22:00'],
    // 21 lunes ausente
    [9, 22, '06:03:00', '18:08:00'], [9, 23, '05:56:00', '18:00:00'],
    [9, 24, '06:10:00', '18:16:00'],
    [9, 25, '06:07:00', null],        // viernes SIN CIERRE
    [9, 28, '05:59:00', '18:03:00'], [9, 29, '06:13:00', '18:19:00'],
    [9, 30, '06:01:00', '18:06:00'],
    [10, 1, '06:04:00', '18:09:00'], [10, 2, '05:58:00', '18:00:00'],
    [10, 5, '06:00:00', '14:30:00']  // jornada corta 8h30
  ];
  // Gómez: ciclo 14x14 (14 días corridos incl. fines de semana, 14 de franco).
  const gomez = [
    [9,  1, '06:55:00', '17:05:00'], [9,  2, '07:10:00', '17:20:00'],
    [9,  3, '06:48:00', '16:58:00'], [9,  4, '07:02:00', '17:12:00'],
    [9,  5, '06:58:00', '17:03:00'], [9,  6, '07:00:00', '12:05:00'],  // domingo corto 5h
    [9,  7, '07:15:00', '17:25:00'], [9,  8, '06:52:00', '17:00:00'],
    [9,  9, '07:05:00', '17:15:00'], [9, 10, '06:59:00', '17:08:00'],
    [9, 11, '07:12:00', '17:22:00'], [9, 12, '06:50:00', '17:00:00'],
    [9, 13, '07:03:00', '17:13:00'], [9, 14, '07:08:00', '17:18:00'],
    // 15-28 franco (14x14)
    [9, 29, '06:57:00', '17:07:00'], [9, 30, '07:11:00', '17:21:00'],
    [10, 1, '07:00:00', '17:10:00'], [10, 2, '06:54:00', '17:04:00'],
    [10, 3, '06:52:00', '17:02:00'], [10, 4, '07:06:00', '17:16:00'],
    [10, 5, '06:58:00', '17:08:00']
  ];

  // 1) Crear empleados demo (si no existen)
  emps.forEach(e => {
    if (findEmpleado(e.email)) return;
    getEmpleadosSheet().appendRow([
      e.email.toLowerCase().trim(),
      e.nombre, e.apellido, e.sector, e.turno,
      '', true, false, 'Fuera',
      e.empresa, e.dni, '', e.aptoVenc, '', '', 'ok', 'habilitado', ''
    ]);
  });

  // 2) Escribir fichadas en bloque (mismo formato que registrarMovimiento)
  const dias = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const startRow = regSheet.getLastRow() + 1;
  const values = [];
  let n = startRow;

  const escribir = (emp, regs) => {
    regs.forEach(r => {
      const fecha = String(r[1]).padStart(2, '0') + '/' + String(r[0]).padStart(2, '0') + '/2026';
      const diaSemana = dias[new Date(2026, r[0] - 1, r[1]).getDay()];
      values.push([
        Utilities.getUuid(), emp.email, emp.nombre, emp.apellido,
        emp.sector, emp.turno,
        fecha, r[2], r[3] || '',
        '=IF(I' + n + '="","",TEXT(MOD(TIMEVALUE(I' + n + ')-TIMEVALUE(H' + n + '),1),"[h]:mm:ss"))',
        diaSemana
      ]);
      n++;
    });
  };
  escribir(emps[0], perez);
  escribir(emps[1], gomez);

  regSheet.getRange(startRow, 1, values.length, 11).setValues(values);
  logTraza('Datos demo generados (' + values.length + ' fichadas, 2 empleados)', data.adminEmail, 'verde');
  return { success: true, message: 'Creados 2 empleados demo con ' + values.length + ' fichadas (sep-oct 2026).' };
}

function borrarDatosDemo(data) {
  if (!esAdminFn(data.adminEmail)) return { success: false, error: 'Sin permisos.' };

  // Registros
  const regSheet = getRegistrosSheet();
  const rows = regSheet.getDataRange().getValues();
  let delReg = 0;
  for (let i = rows.length - 1; i >= 1; i--) {
    if (DEMO_EMAILS.indexOf(String(rows[i][1]).toLowerCase()) !== -1) {
      regSheet.deleteRow(i + 1);
      delReg++;
    }
  }

  // Empleados
  const empSheet = getEmpleadosSheet();
  const erows = empSheet.getDataRange().getValues();
  let delEmp = 0;
  for (let i = erows.length - 1; i >= 1; i--) {
    if (DEMO_EMAILS.indexOf(String(erows[i][0]).toLowerCase()) !== -1) {
      empSheet.deleteRow(i + 1);
      delEmp++;
    }
  }

  logTraza('Datos demo eliminados (' + delReg + ' fichadas, ' + delEmp + ' empleados)', data.adminEmail, 'amarillo');
  return { success: true, message: 'Eliminadas ' + delReg + ' fichadas y ' + delEmp + ' empleados demo.' };
}

// ============================================================
// NOVEDADES DIARIAS — códigos de la planilla de la empresa
// P (presente) es automático: lo generan las fichadas.
// D=Descanso, V=Vacaciones, LC=Licencia, EC=Extra campamento,
// EB=Extra base, PM=Parte médico, AJ=Ausente justificado,
// AI=Ausente injustificado
// ============================================================

const NOVEDADES_CODIGOS = ['D', 'V', 'LC', 'EC', 'EB', 'PM', 'AJ', 'AI'];

function marcarNovedad(data) {
  if (!esAdminFn(data.adminEmail)) return { success: false, error: 'Sin permisos.' };
  const email = String(data.email || '').toLowerCase().trim();
  const emp   = findEmpleado(email);
  if (!emp) return { success: false, error: 'Empleado no encontrado.' };
  if (NOVEDADES_CODIGOS.indexOf(data.codigo) === -1) {
    return { success: false, error: 'Código no válido. Usar: ' + NOVEDADES_CODIGOS.join(', ') };
  }

  const desde = parseFechaSimple(data.fecha);
  if (!desde || isNaN(desde.getTime())) return { success: false, error: 'Fecha inválida.' };
  const hasta = data.fechaHasta ? parseFechaSimple(data.fechaHasta) : desde;
  if (!hasta || isNaN(hasta.getTime()) || hasta < desde) return { success: false, error: 'Rango de fechas inválido.' };
  if ((hasta - desde) / 86400000 > 62) return { success: false, error: 'El rango máximo es 62 días.' };

  const sh   = getNovedadesSheet();
  const rows = sh.getDataRange().getValues();
  const idx  = {};   // 'email|fecha' -> nro de fila (1-based)
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][1]) idx[String(rows[i][1]).toLowerCase() + '|' + fmtFechaCell(rows[i][0])] = i + 1;
  }

  const ss  = getSpreadsheet();
  const tz  = ss.getSpreadsheetTimeZone();
  const ahora = Utilities.formatDate(new Date(), tz, 'dd/MM/yyyy HH:mm');
  let altas = 0, cambios = 0;

  for (let d = new Date(desde.getTime()); d <= hasta; d.setDate(d.getDate() + 1)) {
    const fecha = Utilities.formatDate(d, tz, 'dd/MM/yyyy');
    const fila  = idx[email + '|' + fecha];
    if (fila) {
      sh.getRange(fila, 3, 1, 4).setValues([[data.codigo, data.detalle || '', data.adminEmail, ahora]]);
      cambios++;
    } else {
      sh.appendRow([fecha, email, data.codigo, data.detalle || '', data.adminEmail, ahora]);
      altas++;
    }
  }

  const rango = hasta > desde
    ? Utilities.formatDate(desde, tz, 'dd/MM/yyyy') + ' al ' + Utilities.formatDate(hasta, tz, 'dd/MM/yyyy')
    : Utilities.formatDate(desde, tz, 'dd/MM/yyyy');
  logTraza(`Novedad ${data.codigo} (${data.detalle || 'sin detalle'}) — ${emp.data[1]} ${emp.data[2]} · ${rango}`, data.adminEmail, 'amarillo');
  return { success: true, message: `Novedad ${data.codigo} guardada (${altas} nuevas, ${cambios} actualizadas).` };
}

function borrarNovedad(data) {
  if (!esAdminFn(data.adminEmail)) return { success: false, error: 'Sin permisos.' };
  const email = String(data.email || '').toLowerCase().trim();
  const desde = parseFechaSimple(data.fecha);
  if (!desde || isNaN(desde.getTime())) return { success: false, error: 'Fecha inválida.' };
  const hasta = data.fechaHasta ? parseFechaSimple(data.fechaHasta) : desde;
  if (!hasta || isNaN(hasta.getTime()) || hasta < desde) return { success: false, error: 'Rango de fechas inválido.' };

  const dMin = new Date(desde.getFullYear(), desde.getMonth(), desde.getDate());
  const dMax = new Date(hasta.getFullYear(), hasta.getMonth(), hasta.getDate());

  const sh   = getNovedadesSheet();
  const rows = sh.getDataRange().getValues();
  let del = 0;
  for (let i = rows.length - 1; i >= 1; i--) {
    if (String(rows[i][1] || '').toLowerCase() !== email) continue;
    const f = parseFechaSimple(fmtFechaCell(rows[i][0]));
    if (f >= dMin && f <= dMax) {
      sh.deleteRow(i + 1);
      del++;
    }
  }
  return { success: true, message: del + ' novedad(es) eliminada(s).' };
}

function obtenerNovedades(data) {
  if (!esAdminFn(data.adminEmail)) return { success: false, error: 'Sin permisos.' };
  const sh    = getNovedadesSheet();
  const rows  = sh.getDataRange().getValues();
  const desde = data.fechaDesde ? parseFechaSimple(data.fechaDesde) : null;
  const hasta = data.fechaHasta ? parseFechaSimple(data.fechaHasta) : null;
  const novedades = [];

  for (let i = 1; i < rows.length; i++) {
    if (!rows[i][1]) continue;
    const fecha = fmtFechaCell(rows[i][0]);
    const f     = parseFechaSimple(fecha);
    if (desde && f < desde) continue;
    if (hasta && f > hasta) continue;
    novedades.push({
      fecha:   fecha,
      email:   String(rows[i][1]),
      codigo:  String(rows[i][2] || ''),
      detalle: rows[i][3] || ''
    });
  }
  return { success: true, novedades };
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
      fecha:       fmtFechaCell(rows[i][6]),
      horaIngreso: fmtHoraCell(rows[i][7]),
      horaEgreso:  fmtHoraCell(rows[i][8]),
      duracionMin: parseDuracionTexto(rows[i][9]),
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
  logTraza(`Configuración actualizada (${Object.keys(config).join(', ')})`, data.adminEmail, 'azul');
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

// Formato con segundos para mostrar en la app móvil al registrar salida
function formatDuracionSec(secs) {
  if (!secs || secs < 0) return '0h 0m 0s';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return h + 'h ' + m + 'm ' + s + 's';
}

// Lee la duración de la hoja: la fórmula genera "h:mm:ss" (ej "1:25:42"),
// pero también acepta números enteros (registros viejos en minutos)
function parseDuracionTexto(val) {
  if (!val || val === '') return 0;
  const str = String(val).trim();
  // Formato de fórmula: "1:25:42" o "0:02:00"
  const partes = str.split(':');
  if (partes.length === 3) {
    return parseInt(partes[0] || 0) * 60 + parseInt(partes[1] || 0);
  }
  // Compatibilidad con registros viejos (número de minutos guardado como texto)
  return Number(str) || 0;
}

// Normaliza una celda de fecha (Date object o texto) a string dd/MM/yyyy
function fmtFechaCell(val) {
  if (val instanceof Date) {
    const d = String(val.getDate()).padStart(2, '0');
    const m = String(val.getMonth() + 1).padStart(2, '0');
    const y = val.getFullYear();
    return d + '/' + m + '/' + y;
  }
  return String(val || '');
}

// Normaliza una celda de hora (Date object o texto) a string HH:mm:ss
function fmtHoraCell(val) {
  if (val instanceof Date) {
    const h = String(val.getHours()).padStart(2, '0');
    const m = String(val.getMinutes()).padStart(2, '0');
    const s = String(val.getSeconds()).padStart(2, '0');
    return h + ':' + m + ':' + s;
  }
  return String(val || '');
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
  // Siempre forzar columna J (Duracion_Min) a texto plano — nunca debe ser fecha
  regSheet.getRange('J2:J10000').setNumberFormat('@');

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

  // ---- Módulo Operación: columnas nuevas en Empleados + hojas nuevas ----
  migrarEmpleadosColumnas();
  getVehiculosSheet();
  getEmpresasSheet();
  getObservacionesSheet();
  getAlertasSheet();
  getReemplazosSheet();
  getTrazabilidadSheet();

  return { success: true, message: 'Hojas inicializadas correctamente.' };
}

// ============================================================
// MÓDULO OPERACIÓN (ex-ShiftControl integrado)
// Gestión de habilitaciones, vehículos, empresas,
// observaciones, alertas, reemplazos y trazabilidad
// ============================================================

// --- Creación idempotente de hojas ---
function ensureSheet(nombre, headers) {
  const ss = getSpreadsheet();
  let sh = ss.getSheetByName(nombre);
  if (!sh) {
    sh = ss.insertSheet(nombre);
    sh.appendRow(headers);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#4F46E5').setFontColor('white');
  }
  return sh;
}

function getVehiculosSheet() {
  return ensureSheet('Vehiculos', ['ID', 'Patente', 'Tipo', 'Empresa', 'Estado', 'Seguro_Venc', 'VTV_Venc', 'Obs', 'Creado']);
}
function getEmpresasSheet() {
  return ensureSheet('Empresas', ['ID', 'Nombre', 'Tipo', 'CUIT', 'ART_Venc', 'Seguro_Venc', 'Contrato', 'Creado']);
}
function getObservacionesSheet() {
  return ensureSheet('Observaciones', ['ID', 'Fecha', 'Tipo', 'Entidad', 'Empresa', 'Descripcion', 'Severidad', 'Resuelta', 'Resuelto_Por']);
}
function getAlertasSheet() {
  return ensureSheet('Alertas', ['ID', 'Fecha', 'Hora', 'Tipo', 'Mensaje', 'Autor', 'Leida']);
}
function getReemplazosSheet() {
  return ensureSheet('Reemplazos', ['ID', 'Ausente', 'Turno', 'Causa', 'Urgente', 'Candidatos_JSON', 'Resuelto', 'Creado']);
}
function getTrazabilidadSheet() {
  return ensureSheet('Trazabilidad', ['Fecha', 'Hora', 'Usuario', 'Accion', 'Color']);
}
function getNovedadesSheet() {
  return ensureSheet('Novedades', ['Fecha', 'Email', 'Codigo', 'Detalle', 'Registrado_Por', 'Registrado_El']);
}

// --- Extensión de la hoja Empleados con columnas J..R ---
function migrarEmpleadosColumnas() {
  const sh = getEmpleadosSheet();
  const nuevos = ['Empresa', 'DNI', 'Telefono', 'Apto_Venc', 'Licencia_Tipo', 'Licencia_Venc', 'ART_Estado', 'Habilitacion', 'Obs_Gestion', 'Convenio'];
  if (sh.getLastColumn() < 9 + nuevos.length) {
    for (let i = 0; i < nuevos.length; i++) {
      if (!sh.getRange(1, 10 + i).getValue()) sh.getRange(1, 10 + i).setValue(nuevos[i]);
    }
    sh.getRange(1, 10, 1, nuevos.length).setFontWeight('bold').setBackground('#4F46E5').setFontColor('white');
  }
}

// --- Registro de trazabilidad ---
function logTraza(accion, usuario, color) {
  try {
    const ss  = getSpreadsheet();
    const tz  = ss.getSpreadsheetTimeZone();
    const now = new Date();
    getTrazabilidadSheet().appendRow([
      Utilities.formatDate(now, tz, 'dd/MM/yyyy'),
      Utilities.formatDate(now, tz, 'HH:mm'),
      usuario || 'Sistema',
      String(accion || '').substring(0, 250),
      color || 'azul'
    ]);
  } catch (_) { /* la traza nunca debe romper la operación principal */ }
}

// --- Estado de un vencimiento a partir de la fecha ---
function parseFechaFlexible(v) {
  if (v instanceof Date) return v;
  const s = String(v || '').trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return new Date(s.substring(0, 10) + 'T00:00:00');
  const p = s.split('/');
  if (p.length === 3) return new Date(parseInt(p[2]), parseInt(p[1]) - 1, parseInt(p[0]));
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function estadoDoc(venc, diasWarning) {
  const d = parseFechaFlexible(venc);
  if (!d) return 'ok'; // sin fecha cargada no se controla
  const diff = Math.round((d - new Date()) / 86400000);
  if (diff < 0) return 'vencido';
  if (diff <= (diasWarning || 15)) return 'warning';
  return 'ok';
}

// ============================================================
// OBTENER OPERACIÓN (lectura consolidada)
// ============================================================

function obtenerOperacion(data) {
  if (!esAdminFn(data.adminEmail)) return { success: false, error: 'Sin permisos.' };
  migrarEmpleadosColumnas();

  // ---- Empleados con habilitación ----
  const empRows = getEmpleadosSheet().getDataRange().getValues();
  const empleados = [];
  for (let i = 1; i < empRows.length; i++) {
    if (!empRows[i][0]) continue;
    const e = rowToEmpleado(empRows[i]);
    e.aptoEstado     = estadoDoc(e.aptoVenc);
    e.licenciaEstado = estadoDoc(e.licenciaVenc);
    empleados.push(e);
  }

  // ---- Vehículos ----
  const vehRows = getVehiculosSheet().getDataRange().getValues();
  const vehiculos = [];
  for (let i = 1; i < vehRows.length; i++) {
    if (!vehRows[i][1]) continue;
    vehiculos.push({
      id: vehRows[i][0], patente: vehRows[i][1], tipo: vehRows[i][2],
      empresa: vehRows[i][3], estado: vehRows[i][4] || 'habilitado',
      seguroVenc: fmtFechaCell(vehRows[i][5]), seguroEstado: estadoDoc(vehRows[i][5]),
      vtvVenc: fmtFechaCell(vehRows[i][6]), vtvEstado: estadoDoc(vehRows[i][6]),
      obs: vehRows[i][7] || '', creado: vehRows[i][8] || ''
    });
  }

  // ---- Empresas (con conteos calculados) ----
  const empSRows = getEmpresasSheet().getDataRange().getValues();
  const empresas = [];
  for (let i = 1; i < empSRows.length; i++) {
    if (!empSRows[i][1]) continue;
    const nombre = String(empSRows[i][1]);
    const relEmp = empleados.filter(e => String(e.empresa).toLowerCase() === nombre.toLowerCase());
    const hab    = relEmp.filter(e => e.habilitacion !== 'bloqueado').length;
    const relVeh = vehiculos.filter(v => String(v.empresa).toLowerCase() === nombre.toLowerCase());
    const vehObs = relVeh.filter(v => v.estado !== 'habilitado').length;
    empresas.push({
      id: empSRows[i][0], nombre, tipo: empSRows[i][2], cuit: empSRows[i][3],
      artVenc: fmtFechaCell(empSRows[i][4]), artEstado: estadoDoc(empSRows[i][4]),
      seguroVenc: fmtFechaCell(empSRows[i][5]), seguroEstado: estadoDoc(empSRows[i][5]),
      contrato: empSRows[i][6] || 'Activo',
      empleados: relEmp.length, habilitados: hab,
      vehiculos: vehObs === 0 ? 'OK' : vehObs + ' obs.',
      creado: empSRows[i][7] || ''
    });
  }

  // ---- Observaciones ----
  const obsRows = getObservacionesSheet().getDataRange().getValues();
  const observaciones = [];
  for (let i = 1; i < obsRows.length; i++) {
    if (!obsRows[i][0]) continue;
    observaciones.push({
      id: obsRows[i][0], fecha: fmtFechaCell(obsRows[i][1]), tipo: obsRows[i][2] || 'Personal',
      entidad: obsRows[i][3], empresa: obsRows[i][4] || '', descripcion: obsRows[i][5],
      severidad: obsRows[i][6] || 'observado',
      resuelta: obsRows[i][7] === true || String(obsRows[i][7]).toUpperCase() === 'TRUE',
      resueltoPor: obsRows[i][8] || ''
    });
  }

  // ---- Alertas (últimas 50) ----
  const alRows = getAlertasSheet().getDataRange().getValues();
  const alertas = [];
  for (let i = 1; i < alRows.length; i++) {
    if (!alRows[i][0]) continue;
    alertas.push({
      id: alRows[i][0], fecha: fmtFechaCell(alRows[i][1]), hora: String(alRows[i][2] || ''),
      tipo: alRows[i][3] || 'y', mensaje: alRows[i][4], autor: alRows[i][5] || 'Sistema',
      leida: alRows[i][6] === true || String(alRows[i][6]).toUpperCase() === 'TRUE'
    });
  }

  // ---- Reemplazos ----
  const remRows = getReemplazosSheet().getDataRange().getValues();
  const reemplazos = [];
  for (let i = 1; i < remRows.length; i++) {
    if (!remRows[i][0]) continue;
    let candidatos = [];
    try { candidatos = JSON.parse(remRows[i][5] || '[]'); } catch (_) {}
    reemplazos.push({
      id: remRows[i][0], ausente: remRows[i][1], turno: remRows[i][2] || '',
      causa: remRows[i][3] || '',
      urgente: remRows[i][4] === true || String(remRows[i][4]).toUpperCase() === 'TRUE',
      candidatos,
      resuelto: remRows[i][6] === true || String(remRows[i][6]).toUpperCase() === 'TRUE',
      creado: remRows[i][7] || ''
    });
  }

  return { success: true, empleados, vehiculos, empresas, observaciones, alertas: alertas.slice(-50).reverse(), reemplazos: reemplazos.reverse() };
}

// ============================================================
// TRAZABILIDAD
// ============================================================

function obtenerTrazabilidad(data) {
  if (!esAdminFn(data.adminEmail)) return { success: false, error: 'Sin permisos.' };
  const rows = getTrazabilidadSheet().getDataRange().getValues();
  const traza = [];
  for (let i = rows.length - 1; i >= 1 && traza.length < 100; i--) {
    if (!rows[i][3]) continue;
    traza.push({ fecha: fmtFechaCell(rows[i][0]), hora: String(rows[i][1] || ''), usuario: rows[i][2] || 'Sistema', accion: rows[i][3], color: rows[i][4] || 'azul' });
  }
  return { success: true, traza };
}

// ============================================================
// VEHÍCULOS
// ============================================================

function agregarVehiculo(data) {
  if (!esAdminFn(data.adminEmail)) return { success: false, error: 'Sin permisos.' };
  const v = data.vehiculo || {};
  if (!v.patente) return { success: false, error: 'La patente es obligatoria.' };
  const rows = getVehiculosSheet().getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][1]).toUpperCase() === String(v.patente).toUpperCase()) {
      return { success: false, error: 'Ya existe un vehículo con esa patente.' };
    }
  }
  const ss = getSpreadsheet();
  getVehiculosSheet().appendRow([
    Utilities.getUuid(), String(v.patente).toUpperCase(), v.tipo || '', v.empresa || '',
    'habilitado', v.seguroVenc || '', v.vtvVenc || '', v.obs || '',
    Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'dd/MM/yyyy')
  ]);
  logTraza(`Vehículo agregado — ${v.patente} (${v.tipo || 'sin tipo'})`, data.adminEmail, 'verde');
  return { success: true, message: 'Vehículo agregado correctamente.' };
}

function actualizarVehiculo(data) {
  if (!esAdminFn(data.adminEmail)) return { success: false, error: 'Sin permisos.' };
  const colMap = { patente: 2, tipo: 3, empresa: 4, estado: 5, seguroVenc: 6, vtvVenc: 7, obs: 8 };
  const col = colMap[data.campo];
  if (!col) return { success: false, error: 'Campo no válido.' };
  const rows = getVehiculosSheet().getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === data.id) {
      getVehiculosSheet().getRange(i + 1, col).setValue(data.valor);
      if (data.campo === 'estado') {
        if (data.valor === 'habilitado') getVehiculosSheet().getRange(i + 1, 8).setValue('');
        logTraza(`Vehículo ${rows[i][1]} → estado "${data.valor}"`, data.adminEmail,
          data.valor === 'bloqueado' ? 'rojo' : (data.valor === 'observado' ? 'amarillo' : 'verde'));
      } else {
        logTraza(`Vehículo actualizado (${data.campo}) — ${rows[i][1]}`, data.adminEmail, 'azul');
      }
      return { success: true };
    }
  }
  return { success: false, error: 'Vehículo no encontrado.' };
}

// ============================================================
// EMPRESAS
// ============================================================

function agregarEmpresa(data) {
  if (!esAdminFn(data.adminEmail)) return { success: false, error: 'Sin permisos.' };
  const c = data.empresa || {};
  if (!c.nombre) return { success: false, error: 'La razón social es obligatoria.' };
  const rows = getEmpresasSheet().getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][1]).toLowerCase() === String(c.nombre).toLowerCase()) {
      return { success: false, error: 'Ya existe una empresa con ese nombre.' };
    }
  }
  const ss = getSpreadsheet();
  getEmpresasSheet().appendRow([
    Utilities.getUuid(), c.nombre, c.tipo || '', c.cuit || '',
    c.artVenc || '', c.seguroVenc || '', 'Activo',
    Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'dd/MM/yyyy')
  ]);
  logTraza(`Empresa agregada — ${c.nombre}`, data.adminEmail, 'verde');
  return { success: true, message: 'Empresa agregada correctamente.' };
}

function actualizarEmpresa(data) {
  if (!esAdminFn(data.adminEmail)) return { success: false, error: 'Sin permisos.' };
  const colMap = { nombre: 2, tipo: 3, cuit: 4, artVenc: 5, seguroVenc: 6, contrato: 7 };
  const col = colMap[data.campo];
  if (!col) return { success: false, error: 'Campo no válido.' };
  const rows = getEmpresasSheet().getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === data.id) {
      getEmpresasSheet().getRange(i + 1, col).setValue(data.valor);
      logTraza(`Empresa actualizada (${data.campo}) — ${rows[i][1]}`, data.adminEmail, 'azul');
      return { success: true };
    }
  }
  return { success: false, error: 'Empresa no encontrada.' };
}

// ============================================================
// OBSERVACIONES + ALERTAS
// ============================================================

function agregarObservacion(data) {
  if (!esAdminFn(data.adminEmail)) return { success: false, error: 'Sin permisos.' };
  const o = data.observacion || {};
  if (!o.entidad || !o.descripcion) return { success: false, error: 'Entidad y descripción son obligatorias.' };

  const ss  = getSpreadsheet();
  const tz  = ss.getSpreadsheetTimeZone();
  const now = new Date();
  const fecha = Utilities.formatDate(now, tz, 'dd/MM/yyyy');
  const hora  = Utilities.formatDate(now, tz, 'HH:mm');
  const sev   = o.severidad === 'bloqueado' ? 'bloqueado' : 'observado';

  getObservacionesSheet().appendRow([
    Utilities.getUuid(), fecha, o.tipo || 'Personal', o.entidad, o.empresa || '',
    o.descripcion, sev, false, ''
  ]);
  getAlertasSheet().appendRow([
    Utilities.getUuid(), fecha, hora, sev === 'bloqueado' ? 'r' : 'y',
    `Nueva observación: ${o.entidad} — ${o.descripcion}`, data.adminEmail, false
  ]);
  logTraza(`Observación registrada — ${o.entidad}: ${o.descripcion}`, data.adminEmail, 'amarillo');
  return { success: true, message: 'Observación registrada.' };
}

function resolverObservacion(data) {
  if (!esAdminFn(data.adminEmail)) return { success: false, error: 'Sin permisos.' };
  const rows = getObservacionesSheet().getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === data.id) {
      getObservacionesSheet().getRange(i + 1, 8).setValue(true);
      getObservacionesSheet().getRange(i + 1, 9).setValue(data.adminEmail);
      logTraza(`Observación resuelta — ${rows[i][3]}`, data.adminEmail, 'verde');
      return { success: true, message: 'Observación resuelta.' };
    }
  }
  return { success: false, error: 'Observación no encontrada.' };
}

function marcarAlertasLeidas(data) {
  if (!esAdminFn(data.adminEmail)) return { success: false, error: 'Sin permisos.' };
  const sheet = getAlertasSheet();
  const rows  = sheet.getDataRange().getValues();
  let n = 0;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] && !(rows[i][6] === true || String(rows[i][6]).toUpperCase() === 'TRUE')) {
      sheet.getRange(i + 1, 7).setValue(true);
      n++;
    }
  }
  logTraza(`Alertas marcadas como leídas (${n})`, data.adminEmail, 'azul');
  return { success: true, message: `${n} alertas marcadas como leídas.` };
}

// ============================================================
// REEMPLAZOS
// ============================================================

function registrarAusencia(data) {
  if (!esAdminFn(data.adminEmail)) return { success: false, error: 'Sin permisos.' };
  const r = data.reemplazo || {};
  if (!r.ausente) return { success: false, error: 'Indique el empleado ausente.' };

  const candidatos = Array.isArray(r.candidatos) ? r.candidatos.filter(c => c && c.nombre) : [];
  const ss = getSpreadsheet();
  getReemplazosSheet().appendRow([
    Utilities.getUuid(), r.ausente, r.turno || '', r.causa || '',
    r.urgente === true, JSON.stringify(candidatos), false,
    Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'dd/MM/yyyy HH:mm')
  ]);
  logTraza(`Ausencia registrada — ${r.ausente} (${r.causa || 'sin causa'})`, data.adminEmail, 'amarillo');
  return { success: true, message: 'Ausencia registrada. Busque y asigne un reemplazo.' };
}

function asignarReemplazo(data) {
  if (!esAdminFn(data.adminEmail)) return { success: false, error: 'Sin permisos.' };
  const rows = getReemplazosSheet().getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === data.id) {
      let candidatos = [];
      try { candidatos = JSON.parse(rows[i][5] || '[]'); } catch (_) {}
      const idx = candidatos.findIndex(c => c.nombre === data.candidatoNombre);
      if (idx === -1) return { success: false, error: 'Candidato no encontrado.' };
      candidatos[idx].asignado = true;
      getReemplazosSheet().getRange(i + 1, 6).setValue(JSON.stringify(candidatos));
      getReemplazosSheet().getRange(i + 1, 7).setValue(true);

      const ss  = getSpreadsheet();
      const tz  = ss.getSpreadsheetTimeZone();
      const now = new Date();
      getAlertasSheet().appendRow([
        Utilities.getUuid(),
        Utilities.formatDate(now, tz, 'dd/MM/yyyy'),
        Utilities.formatDate(now, tz, 'HH:mm'),
        'g',
        `Reemplazo confirmado: ${data.candidatoNombre} por ${rows[i][1]} (turno ${rows[i][2] || '—'})`,
        data.adminEmail, false
      ]);
      logTraza(`Reemplazo asignado — ${data.candidatoNombre} por ${rows[i][1]}`, data.adminEmail, 'verde');
      return { success: true, message: `${data.candidatoNombre} asignado como reemplazo.` };
    }
  }
  return { success: false, error: 'Reemplazo no encontrado.' };
}

function descartarReemplazo(data) {
  if (!esAdminFn(data.adminEmail)) return { success: false, error: 'Sin permisos.' };
  const rows = getReemplazosSheet().getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === data.id) {
      getReemplazosSheet().getRange(i + 1, 7).setValue(true);
      logTraza(`Reemplazo descartado — ${rows[i][1]}`, data.adminEmail, 'azul');
      return { success: true, message: 'Reemplazo cerrado sin asignación.' };
    }
  }
  return { success: false, error: 'Reemplazo no encontrado.' };
}
