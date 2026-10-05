# Auditoría de Seguridad + Arquitectura de Migración D1 + Workers

**Proyecto:** Control de Acceso Personal (HG — mina, San Juan, Argentina)
**Fecha:** 2026-10-03
**Alcance:** auditoría del sistema actual (Apps Script + Sheets) y diseño completo del sistema de producción (Cloudflare Workers + D1 + PWA offline-first). **Este documento no modifica el código existente.**

---

## PARTE 1 — AUDITORÍA DE SEGURIDAD DEL SISTEMA ACTUAL

### 1.1 Veredicto general

La brecha que se sospechaba **existe y es crítica**: el backend confía ciegamente en lo que el frontend declara. La app funciona bien como demo, pero **no es apta como sistema de producción** para liquidación de sueldos, porque cualquier persona con la URL del backend puede fichar en nombre de cualquiera, incluidos los administradores.

### 1.2 Brechas confirmadas (ordenadas por gravedad)

#### CRÍTICA 1 — Identidad no verificada (suplantación total)

`Code.gs` recibe el email como un campo más del JSON y nunca valida contra Google:

```js
function verificarEmpleado(data) {
  const { email, fingerprintId, lat, lng } = data;   // email = string cualquiera
  const emp = findEmpleado(email);                    // busca en la hoja y listo
```

El login de Google (`js/auth.js`) decodifica el JWT **en el navegador** y nunca lo envía al backend. Es decir: el "login" es cosmético. Un atacante con la URL del Web App (pública, por diseño) hace:

```
POST /exec  {"action":"registrarMovimiento","email":"admin@empresa.com","lat":-31.522,"lng":-68.567,...}
```

y ficha entrada/salida de cualquier empleado, sin saber su clave ni su teléfono. La geocerca es el único freno (necesita coordenadas dentro del radio), y esas están publicadas en `getConfig` — **una acción sin autenticación que devuelve las coordenadas exactas de la mina**.

**Impacto:** fraude de asistencia masivo, imposibilidad de defender legalmente una sanción.

#### CRÍTICA 2 — "Permisos de admin" = un string

```js
function obtenerEmpleados(data) {
  if (!esAdminFn(data.adminEmail)) ...
```

`esAdminFn` verifica que `data.adminEmail` tenga `Es_Admin=TRUE` en la hoja. Cualquiera que escriba `{"action":"agregarEmpleado","adminEmail":"moviltecdigital@gmail.com",...}` es admin. Además `getConfig` no pide permisos y `actualizarConfig` solo lo finge.

**Impacto:** un tercero puede crear empleados, resetear dispositivos (eliminando el único control de vinculación), mover la geocerca y alterar la configuración.

#### CRÍTICA 3 — Acciones de escritura también por GET

`doGet(e)` llama al mismo `handleAction` que `doPost`. Cualquier estado (agregar empleado, resetear dispositivo, cambiar configuración) se ejecuta pegando una URL en el navegador. Los GET se cachean en proxies y quedan en logs de historial — riesgo adicional de re-ejecución accidental.

#### ALTA 4 — Fingerprint spoofeable y débil

- Se calcula en el cliente (UA + canvas + audio) con FNV-1a de 32 bits ×2. No es criptográfico y es idéntico en todos los navegadores del mismo modelo de equipo.
- Viaja como campo del body: el atacante de la brecha 1 simplemente no lo envía o envía el que quiera.
- La auto-vinculación (`!devStoredValid → setValue(devSent)`) significa que **el primer dispositivo que hable, se vincula** — si un admin resetea por error o un empleado se da de baja/reactiva, el control desaparece.

#### ALTA 5 — Sin audit log

`actualizarEmpleado`, `resetearDispositivo`, `actualizarConfig` y las fichadas no dejan registro de quién hizo qué, cuándo, desde dónde. Para un entorno con riesgo de conflicto laboral, la trazabilidad es un requisito legal, no un extra. Borrar/alterar una fila en la hoja no deja rastro (ni siquiera el historial de versiones distingue ediciones por API de ediciones humanas).

#### ALTA 6 — Sin rate limiting ni control de abuso

`registrarMovimiento` puede llamarse miles de veces por minuto. La idempotencia (CacheService 6 h) mitiga reintentos pero: (a) CacheService puede desalojar entradas antes de 6 h bajo presión, (b) con `requestId` distinto cada llamada genera un movimiento nuevo — 50 ingresos en 1 minuto pasan sin rechazo.

#### MEDIA 7 — Integridad de datos estructural

- Fechas como strings `dd/MM/yyyy` y horas `HH:mm:ss`: ordenar/comparar es frágil (`parseFechaSimple` construye fechas locales, `new Date(fechaStr)` con formatos raros devuelve Invalid Date). Sin UTC, sin zona horaria explícita por registro (solo la del spreadsheet).
- El estado `Dentro/Fuera` es una celda mutable en la hoja `Empleados` — la única fuente de verdad para decidir si el próximo movimiento es ingreso o egreso. Dos fichadas simultáneas leen el mismo estado y generan dos ingresos (o un egreso sin ingreso).
- `appendRow` + `getLastRow` no es transaccional: bajo concurrencia, `filaIngreso` puede apuntar a la fila de otro empleado.
- El escaneo de egreso recorre TODA la hoja por cada fichada: O(n) creciente, y con 200 empleados × 3 turnos × 365 días son ~200k filas/año — Apps Script se vuelve lento y eventualmente supera el límite de 30 s de ejecución.

#### MEDIA 8 — Sin offline, sin tests, PII sin cifrar

- Sin soporte offline: en mina con conectividad intermitente, el empleado no puede fichar o la app falla a mitad del flujo.
- Cero tests automatizados. La duración ya rompió 3 veces por problemas de tipos/formato.
- Emails + geolocalización de 200 personas en una planilla sin cifrado a nivel de campo ni control fino de acceso.

### 1.3 Lo que está BIEN y se conserva

- La **idempotencia por requestId** del frontend (cola en localStorage) — concepto correcto, se migra a tabla `idempotency_keys`.
- El modelo **event-based ya implícito** (Registros = jornada con ingreso/egreso) — se formaliza en el schema nuevo.
- La **fórmula de duración en la hoja** resolvió el problema de tipos — en D1 se resuelve mejor: duración calculada en centavos de minuto (INTEGER) al cerrar la jornada.
- Geocerca **validada en el servidor** (haversine + accuracy) — concepto correcto, se refuerza.
- Reintentos acotados con backoff solo en acciones seguras — patrón correcto.

---

## PARTE 2 — ARQUITECTURA OBJETIVO (Cloudflare Workers + D1 + PWA)

### 2.1 Diagrama general

```
┌─────────────────────────┐        ┌──────────────────────────────────────┐
│  PWA (Cloudflare Pages) │  HTTPS │        Cloudflare Worker (API)       │
│  vanilla JS + IndexedDB │──────▶ │  /api/*  TypeScript                  │
│  - App shell cacheado   │        │  ┌────────────────────────────────┐  │
│  - Cola outbox offline  │        │  │ Middleware: CORS → rate limit  │  │
│  - Background Sync      │        │  │  → sesión → permisos → audit   │  │
└─────────────────────────┘        │  ├────────────────────────────────┤  │
        │   Google Identity        │  │ OAuth Google (JWKS verif.)     │  │
        ▼   Services (GIS)        │  │ Sesiones firmadas (cookie)     │  │
┌─────────────────────────┐        │  │ Geocerca server-side           │  │
│  accounts.google.com    │        │  └────────────────────────────────┘  │
└─────────────────────────┘        └──────┬───────────────────┬───────────┘
                                          │                   │
                                   ┌──────▼──────┐     ┌──────▼──────────┐
                                   │     D1      │     │  Durable Object │
                                   │ (SQLite)    │     │  rate limiter   │
                                   └──────┬──────┘     └─────────────────┘
                                          │
                              ┌───────────┴────────────┐
                              │ Cron Trigger (diario): │
                              │  cierre de jornadas,   │
                              │  export a R2, backup   │
                              └────────────────────────┘
```

Decisiones clave:

| Tema | Decisión | Por qué |
|---|---|---|
| Runtime | Workers (módulos ES, TypeScript) | Validación server-side real, sin cold start, escala a 200 usuarios trivialmente |
| DB | D1 (SQLite) | SQL relacional con transacciones atómicas por batch, Time Travel 30 días, precio acorde a 200 empleados |
| Auth | Google OAuth (GIS) + verificación JWT por JWKS en el Worker | Firma criptográfica verificada server-side; listo para Google Workspace después |
| Sesión | Cookie `HttpOnly; Secure; SameSite=Lax` con token opaco aleatorio; hash SHA-256 del token en D1 | Ni localStorage ni JWT en JS: imposible de robar por XSS, revocable al instante |
| Fichada | **Eventos**, no pares ingreso/egreso | Conciliación determinista, soporte offline y multi-dispositivo, audit completo |
| Frontend | Vanilla JS actual migrado a offline-first (IndexedDB outbox) | Menos riesgo que reescribir en framework; la UI premium ya está hecha |
| Export | CSV estándar minero configurable (ver §6) | Generado por el Worker, solo admin, con registro en audit log |

### 2.2 Modelo de fichada por eventos (el cambio conceptual más importante)

Hoy: celda `Estado = Dentro|Fuera` decide qué es la próxima fichada. Frágil y no auditable.

Nuevo: **toda fichada es un evento inmutable** con `tipo` declarado, timestamp UTC de servidor, y las jornadas se **derivan** por conciliación:

1. El empleado pulsa "Ingreso" → el cliente encola `{tipo:'ingreso', client_ts, lat, lng, accuracy, device_id, request_id}`.
2. El Worker valida identidad + geocerca + dispositivo y **inserta el evento** (nunca actualiza estado).
3. Un proceso de conciliación (al vuelo + cron de cierre diario) agrupa eventos en `jornadas`: primer `ingreso` → primer `egreso` posterior, con reglas documentadas para eventos huérfanos.
4. El estado visible del empleado se **calcula**, no se almacena.

Beneficios directos sobre los edge cases de §7: fichada doble, offline, reloj del celular malo, egreso sin ingreso — todos se vuelven reglas explícitas y auditable en lugar de excepciones.

---

## PARTE 3 — SCHEMA D1 COMPLETO

```sql
-- ============================================================
-- 0. CONFIGURACIÓN Y GEOCERCAS
-- ============================================================
CREATE TABLE geocercas (
  id           INTEGER PRIMARY KEY,
  nombre       TEXT NOT NULL,                     -- 'Mina San Juan - Porteria'
  lat          REAL NOT NULL,
  lng          REAL NOT NULL,
  radio_m      INTEGER NOT NULL CHECK (radio_m BETWEEN 10 AND 5000),
  accuracy_max_m INTEGER NOT NULL DEFAULT 150,    -- precisión GPS mínima exigida
  activo       INTEGER NOT NULL DEFAULT 1,
  creado_en    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE config (
  clave     TEXT PRIMARY KEY,
  valor     TEXT NOT NULL,
  actualizado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- 1. PERSONAS Y LEGAJOS
-- ============================================================
CREATE TABLE empleados (
  id            INTEGER PRIMARY KEY,
  legajo        TEXT NOT NULL UNIQUE,              -- número de legajo (mín. minero)
  email         TEXT NOT NULL COLLATE NOCASE UNIQUE,
  nombre        TEXT NOT NULL,
  apellido      TEXT NOT NULL,
  cuil          TEXT UNIQUE,                       -- 20-12345678-9; para exporte de liquidación
  telefono      TEXT,
  sector_id     INTEGER REFERENCES sectores(id),
  turno_id      INTEGER REFERENCES turnos(id),
  fecha_ingreso TEXT NOT NULL,                     -- ISO date
  fecha_egreso  TEXT,                              -- NULL = activo (baja = soft delete)
  rol           TEXT NOT NULL DEFAULT 'empleado'
                CHECK (rol IN ('empleado','supervisor','admin')),
  activo        INTEGER NOT NULL DEFAULT 1,
  creado_en     TEXT NOT NULL DEFAULT (datetime('now')),
  actualizado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sectores (
  id     INTEGER PRIMARY KEY,
  nombre TEXT NOT NULL UNIQUE                       -- 'Extracción', 'Planta', 'Mantenimiento'
);

CREATE TABLE turnos (
  id            INTEGER PRIMARY KEY,
  nombre        TEXT NOT NULL,                     -- 'Turno A', 'Noche'
  hora_inicio   TEXT NOT NULL,                     -- '06:00'
  duracion_horas REAL NOT NULL,                    -- 8.5 (con hora de almuerzo)
  cruzan_medianoche INTEGER NOT NULL DEFAULT 0
);

-- Dispositivos vinculados (1..N por empleado: cambio de teléfono con historial)
CREATE TABLE dispositivos (
  id           INTEGER PRIMARY KEY,
  empleado_id  INTEGER NOT NULL REFERENCES empleados(id),
  device_hash  TEXT NOT NULL,                      -- hash SHA-256 del fingerprint + salt del servidor
  vinculado_en TEXT NOT NULL DEFAULT (datetime('now')),
  revocado_en  TEXT,                               -- NULL = vigente
  vinculado_por TEXT NOT NULL,                     -- 'auto' | email del admin
  UNIQUE (empleado_id, device_hash)
);
CREATE INDEX idx_dispositivos_hash ON dispositivos(device_hash) WHERE revocado_en IS NULL;

-- ============================================================
-- 2. ASISTENCIA (eventos inmutables + jornadas derivadas)
-- ============================================================
-- El evento crudo NUNCA se modifica ni se borra. Correcciones = evento de ajuste.
CREATE TABLE fichadas (
  id            INTEGER PRIMARY KEY,
  request_id    TEXT NOT NULL UNIQUE,               -- UUIDv7 del cliente; idempotencia
  empleado_id   INTEGER NOT NULL REFERENCES empleados(id),
  tipo          TEXT NOT NULL CHECK (tipo IN ('ingreso','egreso')),
  ts_cliente    TEXT NOT NULL,                      -- reloj del teléfono (referencia)
  ts_servidor   TEXT NOT NULL DEFAULT (datetime('now')),  -- UTC, autoridad
  lat           REAL NOT NULL,
  lng           REAL NOT NULL,
  accuracy_m    REAL NOT NULL,
  geocerca_id   INTEGER REFERENCES geocercas(id),
  distancia_m   REAL,                               -- distancia calculada al centro
  dentro_geocerca INTEGER NOT NULL,                 -- 1 = validada; 0 = rechazada (queda como evidencia)
  dispositivo_id INTEGER REFERENCES dispositivos(id),
  origen        TEXT NOT NULL DEFAULT 'online'
                CHECK (origen IN ('online','offline_sync')),  -- llegó por cola offline
  ip            TEXT,                               -- para trazabilidad (hash, no PII cruda)
  rechazo_motivo TEXT                                -- NULL si aceptada
);
CREATE INDEX idx_fichadas_emp_ts   ON fichadas(empleado_id, ts_servidor);
CREATE INDEX idx_fichadas_ts       ON fichadas(ts_servidor);
CREATE INDEX idx_fichadas_pend     ON fichadas(dentro_geocerca, rechazo_motivo);

-- Jornada = par conciliado ingreso→egreso. La escribe la conciliación, no el cliente.
CREATE TABLE jornadas (
  id            INTEGER PRIMARY KEY,
  empleado_id   INTEGER NOT NULL REFERENCES empleados(id),
  fecha         TEXT NOT NULL,                      -- fecha del ingreso, ISO (zona America/Argentina/San_Juan)
  ingreso_fichada_id INTEGER NOT NULL UNIQUE REFERENCES fichadas(id),
  egreso_fichada_id  INTEGER UNIQUE REFERENCES fichadas(id),
  minutos_trabajados INTEGER,                       -- INTEGER al cierre (egreso NULL = jornada abierta)
  horas_extra_50     INTEGER NOT NULL DEFAULT 0,    -- minutos sobre jornada pactada, primer bloque
  horas_extra_100    INTEGER NOT NULL DEFAULT 0,    -- minutos feriado/descanso
  estado        TEXT NOT NULL DEFAULT 'abierta'
                CHECK (estado IN ('abierta','cerrada','anulada','a_revisar')),
  cerrada_en    TEXT,
  UNIQUE (ingreso_fichada_id)
);
CREATE INDEX idx_jornadas_emp_fecha ON jornadas(empleado_id, fecha);
CREATE INDEX idx_jornadas_fecha     ON jornadas(fecha) WHERE estado != 'anulada';

-- ============================================================
-- 3. LICENCIAS
-- ============================================================
CREATE TABLE licencias (
  id            INTEGER PRIMARY KEY,
  empleado_id   INTEGER NOT NULL REFERENCES empleados(id),
  tipo          TEXT NOT NULL
                CHECK (tipo IN ('vacaciones','enfermedad','accidente_laboral','maternidad',
                                'estudio','especial','licencia_sin_sueldo')),
  desde         TEXT NOT NULL,
  hasta         TEXT NOT NULL,
  estado        TEXT NOT NULL DEFAULT 'pendiente'
                CHECK (estado IN ('pendiente','aprobada','rechazada','finalizada')),
  articulo_ley  TEXT,                               -- ej 'LCT 207/44', para exporte
  observaciones TEXT,
  aprobada_por  INTEGER REFERENCES empleados(id),
  aprobada_en   TEXT,
  creado_en     TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (hasta >= desde)
);
CREATE INDEX idx_licencias_emp ON licencias(empleado_id, desde);

-- ============================================================
-- 4. CAPACITACIONES Y EVALUACIONES (módulo minero)
-- ============================================================
CREATE TABLE capacitaciones (
  id           INTEGER PRIMARY KEY,
  nombre       TEXT NOT NULL,                       -- 'Seguridad en perforación'
  obligatoria  INTEGER NOT NULL DEFAULT 0,
  vencimiento_dias INTEGER,                         -- vigencia del certificado (NULL = sin vto)
  descripcion  TEXT
);

CREATE TABLE capacitaciones_empleados (
  id              INTEGER PRIMARY KEY,
  capacitacion_id INTEGER NOT NULL REFERENCES capacitaciones(id),
  empleado_id     INTEGER NOT NULL REFERENCES empleados(id),
  fecha_realizada TEXT NOT NULL,
  fecha_vencimiento TEXT,                           -- calculada al cargar
  certificado_url TEXT,
  cargado_por     INTEGER NOT NULL REFERENCES empleados(id),
  UNIQUE (capacitacion_id, empleado_id, fecha_realizada)
);
CREATE INDEX idx_cap_emp_vto ON capacitaciones_empleados(empleado_id, fecha_vencimiento);

CREATE TABLE evaluaciones (
  id           INTEGER PRIMARY KEY,
  empleado_id  INTEGER NOT NULL REFERENCES empleados(id),
  periodo      TEXT NOT NULL,                       -- '2026-S2'
  puntaje      REAL NOT NULL,
  observaciones TEXT,
  evaluador_id INTEGER NOT NULL REFERENCES empleados(id),
  creado_en    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (empleado_id, periodo)
);

-- ============================================================
-- 5. IDEMPOTENCIA Y AUDIT LOG
-- ============================================================
-- Ficha de idempotencia: UNIQUE(request_id) garantiza atomicidad en D1 batch.
CREATE TABLE idempotency_keys (
  request_id   TEXT PRIMARY KEY,
  empleado_id  INTEGER NOT NULL,
  accion       TEXT NOT NULL,
  respuesta    TEXT,                                -- JSON de la primera respuesta
  creada_en    TEXT NOT NULL DEFAULT (datetime('now')),
  expira_en    TEXT NOT NULL                        -- ahora + 48h; limpieza por cron
);

-- Append-only: el Worker jamás expone UPDATE/DELETE sobre esta tabla.
-- Las filas se retienen 10 años (reserva legal laboral argentina).
CREATE TABLE audit_log (
  id          INTEGER PRIMARY KEY,
  ts          TEXT NOT NULL DEFAULT (datetime('now')),
  actor_email TEXT NOT NULL,                        -- quien ejecutó (o 'anonimo')
  actor_ip    TEXT,
  accion      TEXT NOT NULL,                        -- 'fichada.crear', 'empleado.resetear_dispositivo'...
  entidad     TEXT NOT NULL,                        -- 'fichadas', 'empleados', 'config'...
  entidad_id  TEXT,
  antes       TEXT,                                 -- JSON snapshot previo (para updates)
  despues     TEXT,                                 -- JSON snapshot posterior
  resultado   TEXT NOT NULL CHECK (resultado IN ('ok','rechazado','error')),
  detalle     TEXT
);
CREATE INDEX idx_audit_ts      ON audit_log(ts);
CREATE INDEX idx_audit_actor   ON audit_log(actor_email, ts);
CREATE INDEX idx_audit_entidad ON audit_log(entidad, entidad_id);

-- ============================================================
-- 6. SESIONES
-- ============================================================
CREATE TABLE sesiones (
  id            INTEGER PRIMARY KEY,
  token_hash    TEXT NOT NULL UNIQUE,               -- SHA-256 del token opaco; el token nunca se guarda
  empleado_id   INTEGER NOT NULL REFERENCES empleados(id),
  dispositivo_id INTEGER REFERENCES dispositivos(id),
  creada_en     TEXT NOT NULL DEFAULT (datetime('now')),
  expira_en     TEXT NOT NULL,                      -- creada + 12h
  ip            TEXT,
  user_agent    TEXT
);
CREATE INDEX idx_sesiones_exp ON sesiones(expira_en);
```

**Notas de diseño:**

- **`fichadas` es append-only**: ni el admin tiene API de borrado. Correcciones = nueva fila en `audit_log` + evento de ajuste en conciliación. Responde al requisito "cómo evitar que un admin borre datos sin dejar rastro": no puede, por diseño.
- **Horas extra separadas en dos bloques** (50 % / 100 %): es como liquidan las mineras; `turnos` define la jornada pactada y la conciliación calcula el excedente.
- **`ts_servidor` es autoridad**; `ts_cliente` se guarda solo como evidencia. Un teléfono con reloj malo no distorsiona la nómina.
- **Cuil y legajo** permiten exportar sin joins frágiles contra datos escritos a mano.
- **`dispositivos` históricos**: cuando el empleado cambia de teléfono, el viejo vínculo se revoca (no se borra) → trazabilidad de qué dispositivo fichó cada evento.

**Backups / recuperación:**
1. **Time Travel de D1** (incluido): restaurar a cualquier punto de los últimos 30 días.
2. **Cron diario** exporta snapshot completo (SQL + CSV de jornadas cerradas) a un **bucket R2** con versionado — retención 1 año.
3. **Export mensual firmado** (CSV liquidación) queda en R2 como evidencia inmutable de lo que se envió a sueldos.
4. Restauración ensayada una vez al trimestre (procedimiento documentado, no supuesto).

---

## PARTE 4 — BACKEND EN CLOUDFLARE WORKERS (TypeScript)

### 4.1 Estructura del proyecto

```
controlpersonal-api/
├── src/
│   ├── index.ts              # entrypoint, router
│   ├── middleware/
│   │   ├── auth.ts           # sesión → req.empleado (o 401)
│   │   ├── permissions.ts    # requireRole('admin'|'supervisor'|'empleado')
│   │   ├── rateLimit.ts      # DO-based, por IP y por empleado
│   │   └── audit.ts          # inserta en audit_log para toda mutación
│   ├── routes/
│   │   ├── auth.ts           # /api/auth/google, /api/auth/logout, /api/auth/me
│   │   ├── fichadas.ts       # POST /api/fichadas, GET /api/fichadas/me, POST /api/sync
│   │   ├── empleados.ts      # CRUD admin + reset dispositivo
│   │   ├── licencias.ts
│   │   ├── capacitaciones.ts
│   │   ├── reportes.ts       # jornadas, resumen por período
│   │   ├── export.ts         # CSV liquidación (solo admin)
│   │   └── config.ts         # geocercas, turnos, sectores
│   ├── lib/
│   │   ├── googleAuth.ts     # verificación JWT vía JWKS
│   │   ├── geofence.ts       # haversine + heurísticas anti-spoof
│   │   ├── conciliacion.ts   # eventos → jornadas
│   │   └── exportCSV.ts
│   └── cron/
│       ├── cierreJornadas.ts # diaria 03:00 ART: cierra jornadas abiertas >24h a 'a_revisar'
│       ├── backupR2.ts       # snapshot diario
│       └── limpieza.ts       # idempotency_keys expiradas, sesiones vencidas
├── migrations/               # 0001_init.sql, 0002_seed.sql...
├── test/                     # vitest + miniflare (ver §7)
└── wrangler.toml
```

### 4.2 Autenticación Google con verificación criptográfica real

```ts
// lib/googleAuth.ts (resumen del diseño)
// 1. El cliente hace Google Sign-In (GIS) y envía el ID token al Worker.
// 2. El Worker NO confía en el payload: verifica firma contra JWKS de Google,
//    iss, aud (= GOOGLE_CLIENT_ID), exp, y email_verified === true.
// 3. Solo entonces busca/crea el empleado por email y abre sesión.
export async function verifyGoogleIdToken(idToken: string, env: Env): Promise<GoogleUser> {
  const header  = decodeHeader(idToken);
  const jwk     = await getGoogleJWK(header.kid);            // cacheado 24h en KV
  const key     = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok      = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature(idToken), payloadBytes(idToken));
  if (!ok) throw new HttpError(401, 'Firma de Google inválida');
  const claims  = decodePayload(idToken);
  if (claims.iss !== 'https://accounts.google.com' && claims.iss !== 'accounts.google.com') throw new HttpError(401, 'Issuer inválido');
  if (claims.aud !== env.GOOGLE_CLIENT_ID) throw new HttpError(401, 'Audience inválido');
  if (claims.exp * 1000 < Date.now())      throw new HttpError(401, 'Token expirado');
  if (!claims.email_verified)              throw new HttpError(401, 'Email no verificado');
  return { email: claims.email, name: claims.name, picture: claims.picture };
}
```

**Sesión**: tras verificar, el Worker genera un token opaco de 256 bits (`crypto.getRandomValues`), guarda `SHA-256(token)` en `sesiones` con expiración 12 h, y responde `Set-Cookie: ca_session=<token>; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=43200`. Cada request: leer cookie → hash → lookup → adjuntar empleado al request. Logout = delete de la fila (revocación inmediata, imposible con JWT-en-localStorage).

**Modo dual Workspace (para el futuro)**: el flujo OIDC es el mismo; con Workspace solo se agrega la verificación opcional de `claims.hd` (dominio de la empresa) y un segundo `client_id`. No requiere reescritura — la abstracción `verifyGoogleIdToken` queda lista. Dicho de otro modo: **el diseño ya contempla el upgrade a Workspace sin cambios estructurales**.

### 4.3 Fichada (la ruta crítica)

```ts
// POST /api/fichadas — pseudocódigo del flujo completo
1. rateLimit: máx 10 fichadas/min por empleado, 30/min por IP (Durable Object). Excedido → 429.
2. auth: requireRole('empleado') → req.empleado (activo obligatorio).
3. validar body con zod: { tipo, request_id (UUIDv7), lat, lng, accuracy, client_ts, device_hash }.
4. idempotencia: SELECT respuesta FROM idempotency_keys WHERE request_id = ?
   → si existe, devolver la MISMA respuesta (200). Si no:
   INSERT INTO idempotency_keys ...  (UNIQUE falla si dos devices mandan el mismo request_id → gana 1, el otro lee)
5. dispositivo: SELECT FROM dispositivos WHERE empleado_id = ? AND device_hash = ? AND revocado_en IS NULL
   → si no hay vínculo vigente: 403 DEVICE_NOT_BOUND (nada de auto-vinculación silenciosa;
     la primera vinculación exige acción del empleado confirmada + queda auditada).
6. geocerca (server-side): distancia haversine + accuracy ≤ geocerca.accuracy_max_m
   → fuera: 200 con { aceptada: false, motivo } pero SE INSERTA el evento con dentro_geocerca=0
     (evidencia del intento: cuándo y dónde intentó fichar alguien rechazado — oro en un conflicto laboral).
7. INSERT fichada + UPDATE audit_log en un solo db.batch() → atómico.
8. conciliar jornada del empleado (mismo request) y devolver estado actualizado.
```

### 4.4 Conciliación de jornadas (reglas explícitas)

| Situación | Regla |
|---|---|
| Ingreso sin egreso al cierre del día | Jornada queda `abierta`; el cron la pasa a `a_revisar` si sigue abierta >24 h |
| Doble ingreso (empleado tocó dos veces / dos dispositivos) | El 2º ingreso se registra como evento pero la conciliación lo marca `a_revisar` con motivo `doble_ingreso`; nunca genera dos jornadas |
| Egreso sin ingreso abierto | Evento guardado, jornada `a_revisar` motivo `egreso_huerfano`; supervisor resuelve desde panel asignándolo al ingreso que corresponda |
| Turno cruza medianoche | La jornada pertenece a la **fecha del ingreso**; duración = egreso − ingreso sin split (los turnos lo definen con `cruzan_medianoche`) |
| Reloj del teléfono malo | `ts_servidor` manda; `ts_cliente` solo evidencia. Si `|ts_cliente − ts_servidor| > 10 min` el evento se marca `a_revisar` (posible manipulación) |
| Desplazamiento imposible (anti-spoof GPS) | Si distancia entre dos fichadas consecutivas / Δt implica > 900 km/h, se marca `a_revisar` |
| Anulación de jornada errónea | Soft: `estado='anulada'` + fila de audit_log con motivo. Jamás DELETE |

### 4.5 Rate limiting y otros controles

- **Durable Object `RateLimiter`** (una instancia global, contadores en memoria + checkpoint): límites por ruta (`auth` 10/min/IP, `fichadas` 10/min/empleado, `export` 5/hora/admin).
- **Turnstile** (invisible) en el login para frenar bots sin molestar al empleado.
- **WAF de Cloudflare**: reglas adicionales gratis (bloqueo por país si aplica, bot fight mode).
- **CORS cerrado**: solo el dominio de Pages puede llamar a la API.
- **Secrets en wrangler**: `GOOGLE_CLIENT_ID`, sesión `SECRETS` (nunca en el repo).

---

## PARTE 5 — FRONTEND PWA OFFLINE-FIRST

### 5.1 Estrategia de cache (Service Worker v4)

| Recurso | Estrategia |
|---|---|
| App shell (HTML/CSS/JS/icons) | Precache + cache-first con versionado (hash) |
| Google GIS SDK | Network-only |
| API GET (estado mío, mis jornadas) | Network-first con timeout 3 s → fallback a cache → indicador "datos del dd/mm hh:mm" |
| API POST (fichadas) | **Nunca** se cachea: van a la outbox |

### 5.2 Cola outbox (IndexedDB) — el corazón del offline

```ts
interface OutboxItem {
  request_id: string;      // UUIDv7, generado AL MOMENTO de fichar (no al sincronizar)
  tipo: 'ingreso' | 'egreso';
  client_ts: number;
  payload: { lat, lng, accuracy, device_hash };
  intentos: number;
  creado_en: number;
}
```

Flujo:

1. Sin red (o red caída a mitad del request): la fichada se guarda en outbox con su `request_id` **fijo** y la UI muestra "Ingreso guardado — se enviará cuando haya señal". El empleado puede cerrar la app: al reabrirla (o por Background Sync API), se drena la cola.
2. `POST /api/sync` drena la outbox completa en un solo request (array de items). El servidor procesa cada uno con su idempotencia individual y responde por-item: `{ request_id, resultado: 'ok'|'rechazado_geocerca'|'duplicado'|'a_revisar' }`.
3. La UI reconcilia: los `ok` desaparecen; los `rechazado_geocerca` muestran el motivo; los `duplicado` (ya existían en el server) simplemente se confirman sin duplicar — **el mismo request_id nunca genera dos fichadas, online u offline**.
4. Resolución de conflictos: por diseño casi no hay conflictos — los eventos son independientes y la conciliación server-side es determinista. El único "conflicto" real (doble fichada simultánea) cae en `a_revisar` para el supervisor, nunca se resuelve silenciosamente en el cliente.

### 5.3 UI

- Se conserva el diseño premium actual (index.html/css ya trabajados) y se le suma:
  - Banner persistente de estado de conexión + contador de fichadas pendientes en outbox.
  - Pantalla "Mis jornadas" para el empleado (transparencia: ve lo que el admin ve → menos conflictos por sorpresa).
  - Panel admin: nuevas pestañas Licencias, Capacitaciones (con alertas de vencimiento), Evaluaciones y Revisión de jornadas `a_revisar` (aprobar/corregir con motivo → audit log).
- Exportación CSV solo visible para admin; cada descarga registra `actor + filtros + timestamp` en audit log.

---

## PARTE 6 — EXPORT PARA LIQUIDACIÓN (estándar minero)

Formato propuesto (CSV UTF-8 con BOM + XLSX), siguiendo lo que usan las mineras sanjuaninas para liquidación y art. 161 LCT:

```
LEGAJO;APELLIDO_Y_NOMBRE;CUIL;SECTOR;TURNO;PERIODO;DIAS_TRABAJADOS;
HORAS_ORDINARIAS;HORAS_EXTRA_50;HORAS_EXTRA_100;AUSENCIAS_JUSTIFICADAS;
AUSENCIAS_INJUSTIFICADAS;DIAS_LICENCIA;OBSERVACIONES
```

- Una fila por empleado por período (quincena o mes, configurable), más un detalle expandido por jornada.
- `HORAS_EXTRA_50/100` salen de las columnas del schema (no de fórmulas a mano).
- Ausencias cruzadas con `licencias` (justificadas) y con jornadas faltantes según `turnos` (injustificadas).
- El admin elige período → vista previa → descarga. Cada exporte queda registrado en `audit_log` (quién, qué período, qué datos) — necesario si RRHH discute después qué números se enviaron.
- Como aún no definieron el formato final, el generador es **mapeable por columnas** (config de mapeo en `config`): cuando la minera/liquidador pida otro layout, se ajusta sin tocar código.

---

## PARTE 7 — TESTING SISTEMÁTICO

**Stack**: Vitest + `@cloudflare/vitest-pool-workers` (corre el Worker real sobre Miniflare con D1 local). CI en GitHub Actions en cada push.

Cobertura obligatoria por módulo:

| Módulo | Tests clave |
|---|---|
| `googleAuth` | firma válida/inválida, `aud` incorrecto, token expirado, `email_verified=false`, JWKS cache |
| `auth` middleware | cookie válida, expirada, revocada (logout), inexistente; empleado inactivo |
| `permissions` | empleado→401 en rutas admin, supervisor solo su sector, admin todo |
| `fichadas` | **idempotencia**: mismo request_id N veces = 1 fichada; geocerca dentro/fuera/borde; accuracy excedida; dispositivo no vinculado; empleado inactivo; rate limit 429 |
| `conciliacion` | turno normal, **cruce de medianoche** (23:00→01:00 = 2 h), doble ingreso, egreso huérfano, jornada >24 h abierta, horas extra 50/100 |
| `licencias` | solapamiento de licencias, aprobación por no-admin rechazada, días de licencia vs jornadas faltantes |
| `export` | cálculo de horas totales contra fixture conocido, permisos, registro en audit_log |
| **offline sync (e2e)** | outbox con 5 items → /api/sync → mezcla ok/duplicado/rechazado; reconexión con request_id repetido no duplica |

**Edge cases escritos como tests desde el día 1** (los del brief): fichada simultánea desde dos dispositivos, red caída entre validación e insert (transacción batch), admin que intenta borrar (no existe la ruta → 405 + audit del intento), GPS spoof (accuracy 5 m pero imposible travel), reloj del cliente con 3 h de diferencia.

---

## PARTE 8 — PLAN DE MIGRACIÓN Y COSTOS

### 8.1 Fases (cada fase entrega algo usable)

| Fase | Contenido | Verificación |
|---|---|---|
| **0. Preparación** | Google Cloud Project nuevo (OAuth consent + client ID web). Proyecto Workers + D1. Migrations + seed inicial | Login OIDC real funcionando en staging (`*.workers.dev`) |
| **1. Núcleo asistencia** | Auth + sesiones + fichadas por eventos + geocerca server-side + conciliación + audit log + PWA offline (outbox) | Tests §7 en verde; fichada real desde celular en la mina |
| **2. Admin panel completo** | Migración de la UI admin actual + revisión de jornadas + reset dispositivo auditable + export CSV v1 | Paralelo con sistema actual 2 semanas, comparar horas |
| **3. Módulos mineros** | Legajos completos, licencias, capacitaciones con vencimientos, evaluaciones, BI | Uso real del panel |
| **4. Corte final** | Sheets → read-only (archivo histórico importado a D1), dominio propio opcional, monitoreo | Cierre |

**Paralelo, no big-bang**: las dos semanas de fase 2, el sistema actual sigue corriendo y se comparan las horas calculadas por ambos — si discrepan, se investiga antes de cortar. Los datos históricos de la planilla se importan con un script de migración (fechas parseadas a ISO, duraciones normalizadas a minutos).

### 8.2 Costos estimados (200 empleados, ~600 fichadas/día)

| Ítem | Plan | Costo mensual aprox. |
|---|---|---|
| Workers | Paid ($5 base) | $5 |
| D1 | Incluido en Workers Paid (200k writes/día libres; usan ~2k) | $0 |
| Durable Objects | Incluido en Workers Paid | $0–1 |
| Pages + Turnstile + WAF básico | Free | $0 |
| R2 (backups) | 10 GB-class | <$1 |
| **Total** | | **≈ $5–7 USD/mes** |

(Con Google Workspace después: solo cambia el client ID/consent, sin costo adicional de infra.)

### 8.3 Monitoreo

- `wrangler tail` + **Workers Analytics** (latencia, errores 5xx, tasa de rechazo de geocerca — un pico de rechazos = problema de GPS o intento de fraude).
- **Health check** `GET /api/health` (DB ping) con alerta vía UptimeRobot free.
- Métrica de negocio semanal automática: jornadas `a_revisar` pendientes > N → aviso al admin.

---

## PARTE 9 — RESPUESTAS A LAS PREGUNTAS DEL BRIEF

1. **Empleados: 200** → arquitectura sobredimensionada a propósito pero barata (§8.2); el rate limiting por empleado y los índices por `(empleado_id, ts)` están elegidos para ese orden de magnitud y para crecer 10× sin cambios.
2. **Mina en San Juan** → las coordenadas exactas (porteria, talleres, planta) se cargan como **múltiples geocercas** (`geocercas` es una tabla, no una config): puede haber un radio por acceso. La geocerca precisa se define en fase 1 con el personal de la mina.
3. **Export**: se implementa el estándar minero propuesto en §6 con mapeo configurable; al ver una planilla real del liquidador se ajusta en minutos.
4. **Google Cloud Project aparte: sí** — nuevo GCP, OAuth consent screen interno, client ID web. **Modo dual con Workspace futuro: sí, soportado por diseño** (mismo flujo OIDC; solo se añade validación de `hd` y un client ID más — ver §4.2).
5. **Confirmación de dirección**: este documento ES la confirmación del plan D1+Workers completo. El sistema actual (Apps Script + Sheets) **no se toca** hasta que la fase 1 esté verificada en staging.

---

## PARTE 10 — CONCLUSIÓN DE LA AUDITORÍA (resumen ejecutivo)

- **¿Existía la brecha que se sospechaba?** Sí, y es peor: no es "una" brecha, es que **la autenticación es decorativa**. El sistema actual es válido como prototipo interno de baja confianza y como base de UI, pero no resiste un cuestionamiento legal de sus registros.
- **¿Qué se conserva?** La UI premium, el flujo de usuario, la idempotencia por requestId, la geocerca server-side y el modelo de duración calculada — todo se migra, nada se tira.
- **Qué cambia de raíz**: identidad verificada criptográficamente, sesiones revocables, eventos inmutables + conciliación, audit log append-only, offline real, y un schema relacional con reglas de negocio explícitas y testeadas.
- **Próximo paso sugerido**: aprobar este diseño → Fase 0 (GCP + proyecto Workers + login real en staging) puede estar corriendo sin tocar absolutamente nada del sistema que hoy usan.
