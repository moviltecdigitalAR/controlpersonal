# Arquitectura v2 — Asistencia QR + Roster (D1 + Workers)

**Proyecto:** Control de Asistencia — HG (proveedor minero, proyectos en San Juan: San Jorge, Veladero)
**Fecha:** 2026-10-04 · Reemplaza a v1 (conservada en git: commit 2aeac25)
**Alcance:** diseño de producción. Este documento no modifica el sistema actual (Apps Script + Sheets) que sigue operativo hasta el corte.

---

## PARTE 1 — ALCANCE CONFIRMADO POR LA EMPRESA

Requisitos tal como los definió la empresa (2026-10-04):

| # | Requisito | Implicancia en el diseño |
|---|---|---|
| R1 | **Asistencia con QR** | El registro se hace escaneando un código en cada proyecto. QR rotativo por sitio (no estático: una foto no sirve mañana) |
| R2 | **Si falla internet, queda grabado y sincroniza al volver la señal** | Outbox offline en IndexedDB (ya diseñado en v1, se mantiene) |
| R3 | **La asistencia muestra hora de entrada y salida** | Eventos ingreso/egreso con hora; jornada = par conciliado |
| R4 | **Se registra en todos los proyectos de mina** | Multi-sitio: cada proyecto tiene su geocerca y su QR propio |
| R5 | **Se debe ver el roster para organizar** (hoy en Drive, planilla tipo "Cronograma San Jorge") | Módulo Roster: grilla mensual empleados × días con estados, roles, DNI, ciudad, totales |
| R6 | **SIN cálculo de horas extras** ("que marque horario de entrada y de salida, y puedas organizar los rosters nomás") | Se elimina del schema todo el bloque extras 50/100, nocturnas, topes legales. La jornada guarda solo entrada, salida y segundos trabajados |
| R7 | Convenios: **UOCRA 76/75, AOMA Veladero 673/04, fuera de convenio** (operarios y oficina) | Metadata del empleado (para futura liquidación), NO cálculo |
| R8 | Jornadas reales: **12 h en 14x14**, **10 h en temporada baja 14x14**, **L-V de 10 y 9 h** | El roster define la jornada esperada; la asistencia solo la contrasta como alerta suave |
| R9 | Señal irregular en proyectos; **las camionetas tienen internet** | Sync en primer momento de conectividad; sin dependencia de permanecer online |
| R10 | Reemplaza el Drive actual de asistencia | Importación del histórico + export equivalente |

**Fuera de alcance (v2):** cálculo de horas extra/nocturnas, licencias, capacitaciones, evaluaciones, BI. Quedan documentadas como fase futura si la empresa las pide. Esta reducción elimina ~40 % de la complejidad y el grueso del riesgo legal de cálculo.

---

## PARTE 2 — CORRECCIONES INTEGRADAS DE LA REVISIÓN MULTI-MODELO

La v1 fue auditada por revisión cruzada (Opus/Gemini). Hallazgos y su resolución en v2:

| # | Hallazgo (v1) | Resolución en v2 |
|---|---|---|
| 1 | Cookie de sesión inviable cross-domain (Pages ≠ workers.dev) | **Topología same-origin**: un Worker sirve la API en `/api/*` y el front estático desde el mismo dominio (ver §3) |
| 2 | Idempotencia envenenada (crash entre marcar y insertar → fichada perdida) | Una sola escritura atómica: `INSERT ... ON CONFLICT DO NOTHING RETURNING` sobre `fichadas(empleado_id, request_id)` |
| 3 | Rate limit tumbaba el cambio de turno (200 personas / 1 IP NAT) | **Nunca se rechaza una fichada por rate limit**: se marca `a_revisar` con motivo `rafaga`. Fail-closed solo en `auth` y `export` |
| 4 | "El admin no puede borrar" era falso (wrangler d1 execute) | Inmutabilidad **demostrable**: triggers `BEFORE UPDATE/DELETE` que abortan + cadena de hash SHA-256 por fila + digest diario exportado fuera de la cuenta (R2 en otra cuenta + mail a RRHH) |
| 5 | Doble toque genera 2 request_id → idempotencia no lo frena | Debounce server-side: mismo empleado + mismo tipo ≤ 90 s → devuelve la fichada previa y audita el intento |
| 6 | Latencia D1 ~1 s desde San Juan | Sesión cacheada (Cache API, TTL 60 s + lista de revocación), toda la escritura en UN `db.batch()`, D1 location hint Americas |
| 7 | Background Sync no existe en iOS; IndexedDB se purga a los 7 días | Drenaje en `online` + `visibilitychange`; badge persistente de pendientes; reporte supervisor "egresos faltantes <24 h" |
| 8 | `datetime('now')` sin zona ni ms → fichadas inordenables | **Epoch ms INTEGER** (`ts_ms`) en todas las tablas; fecha ART calculada en el Worker |
| 9 | Jornada cruzando medianoche mal asignada por SQL UTC | `jornadas.fecha` la calcula el Worker en `America/Argentina/San_Juan` (UTC-3, sin DST); prohibido `substr(ts,1,10)` |
| 10 | Posibles 2 jornadas abiertas del mismo empleado | `CREATE UNIQUE INDEX ... WHERE estado='abierta'` |
| 11 | Tablas mutables al motor; sin STRICT | `STRICT` en todas + `CHECK (x IN (0,1))` en booleanos |
| 12 | Ausencia inferida de ausencia = indefendible | No se infiere: el **roster** define quién debía estar; las diferencias son "desvíos" informativos, nunca sanción automática |
| 13 | GPS como prueba única de presencia es débil (spoof con DevTools) | GPS = **corroborante**, no prueba. Prueba de presencia = QR rotativo (HMAC del sitio) + corroboración GPS + roster. Decisión tri-estado del geofence |
| 14 | Falta consentimiento geolocalización (Ley 25.326) | Tabla `consentimientos`: versión de política, timestamp, IP. Sin aceptación no se habilita el registro |
| 15 | Edición unilateral de jornada sin conformidad = nula en juicio | Toda corrección es evento `ajuste` con motivo + aprobador ≠ beneficiario + `conformidad_empleado` (acepta o impugna desde la app) |
| 16 | Fingerprints replicables (WhatsApp) | Se mantiene como factor de vinculación de dispositivo, pero la fichada exige sesión activa + QR del sitio; el fingerprint solo acota desde qué teléfono se opera |
| 17 | Sesión 12 h = expire a mitad de turno de 12 h | Acceso 1 h + refresh rotativo device-bound 30 días; idle-timeout 8 h empleado |
| 18 | `audit_log.actor_email` denormalizado | `actor_empleado_id` FK + `request_id` de correlación |
| 19 | Doble índice UNIQUE redundante en jornadas | Corregido en DDL |
| 20 | Request_id global → ataque de denegación ajeno | Unicidad por `(empleado_id, request_id)` |
| 21 | Kiosco de portería faltante | **Modo cartel** (ver §5.3): tablet en portería mostrando el QR rotativo, funciona offline. Registro del empleado siempre desde SU teléfono |
| 22 | Cron de backup full-dump en una invocación | Export paginado por cursor → R2 multipart |
| 23 | Periodos liquidados sin congelar | Tabla `periodos_congelados` con hash del dataset exportado (ver §8) |
| 24 | `sesiones` borradas en logout (pérdida de evidencia) | Append-only con `revocada_en` + `revocada_motivo` |
| 25 | Login sin allowlist / auto-creación | Solo empleados pre-enrolados por admin (el alta nace del roster, no del login) |

Lo que NO se integra de la revisión (por decisión de alcance R6): cálculo de extras/nocturnas/insalubres, WebAuthn/passkeys (fase futura opcional), polígono GeoJSON (radios múltiples bastan), UptimeRobot (se usa Workers Analytics + health check propio).

---

## PARTE 3 — TOPOLOGÍA (same-origin, un dominio)

```
                    https://asistencia.<empresa>.com   (dominio propio, ~USD 10/año)
                                │
                     Cloudflare Worker (un solo deploy)
                     ├── /*            → assets del front (PWA) [same-origin]
                     └── /api/*        → API JSON
                                │
            ┌───────────────────┼────────────────────┐
            │ D1 (primaria)     │ Cache API          │ Durable Object
            │ asist_prod        │ sesiones 60 s      │ RateLimiter (sharded)
            │ asist_staging     │ + revocación       │
            └───────────────────┴────────────────────┘
                                │
                     R2 (otra cuenta CF) — backups WORM
```

- **Cookie de sesión**: `__Host-ca_session=<token>; Path=/; Secure; SameSite=Strict; HttpOnly`. Same-origin elimina todo el problema CORS/ITP de la v1.
- **Sin dominio propio no hay Fase 1** (con `SameSite=None; Partitioned` se puede degradar, pero se exige dominio para producción; staging puede usar `*.workers.dev` con token en header en vez de cookie).
- Staging = mismo código, DB `asist_staging`, basic-auth del Worker para el período de prueba.

---

## PARTE 4 — SCHEMA D1 v2 (STRICT, epoch ms, append-only demostrable)

```sql
-- migrations/0001_init.sql  (D1 / SQLite STRICT)
PRAGMA defer_foreign_keys = true;

-- ---------- SITIOS (proyectos de mina) ----------
CREATE TABLE sitios (
  id             INTEGER PRIMARY KEY,
  nombre         TEXT NOT NULL UNIQUE,          -- 'San Jorge', 'Veladero'
  lat            REAL NOT NULL,
  lng            REAL NOT NULL,
  radio_m        INTEGER NOT NULL CHECK (radio_m BETWEEN 10 AND 10000),
  accuracy_max_m INTEGER NOT NULL DEFAULT 250,  -- exigible al GPS (realidad open-pit)
  qr_secret      TEXT NOT NULL,                 -- base32; vive SOLO en D1 y en el cartel del sitio
  activo         INTEGER NOT NULL CHECK (activo IN (0,1)) DEFAULT 1,
  creado_ms      INTEGER NOT NULL
) STRICT;

-- ---------- EMPLEADOS ----------
-- El alta nace del roster (admin), NUNCA del login. Login = allowlist por email.
CREATE TABLE empleados (
  id             INTEGER PRIMARY KEY,
  dni            TEXT NOT NULL UNIQUE,          -- '40070277' sin puntos (como el cronograma)
  email          TEXT COLLATE NOCASE UNIQUE,    -- Gmail personal; NULL hasta enrolar
  apellido       TEXT NOT NULL,
  nombre         TEXT NOT NULL,
  rol            TEXT NOT NULL,                 -- 'Perforista','Ayudante','Quinto','Mecánico','Prevención','Supervisor', ...
  ciudad_origen  TEXT,                          -- 'San Rafael','San Juan','Mendoza','Jachal' (columna del cronograma)
  convenio       TEXT CHECK (convenio IN ('UOCRA_76_75','AOMA_673_04','SIN_CONVENIO')),
  categoria      TEXT,                          -- 'operario' | 'oficina' (fuera de convenio)
  telefono       TEXT,
  rol_sistema    TEXT NOT NULL DEFAULT 'empleado'
                 CHECK (rol_sistema IN ('empleado','supervisor','admin')),
  activo         INTEGER NOT NULL CHECK (activo IN (0,1)) DEFAULT 1,
  creado_ms      INTEGER NOT NULL,
  actualizado_ms INTEGER NOT NULL
) STRICT;

-- ---------- DISPOSITIVOS (vinculación de teléfono) ----------
CREATE TABLE dispositivos (
  id            INTEGER PRIMARY KEY,
  empleado_id   INTEGER NOT NULL REFERENCES empleados(id),
  device_hash   TEXT NOT NULL,                  -- SHA-256(fingerprint + salt servidor)
  vinculado_ms  INTEGER NOT NULL,
  revocado_ms   INTEGER,                        -- NULL = vigente
  vinculado_por TEXT NOT NULL,                  -- 'auto-enrol' | email admin
  UNIQUE (empleado_id, device_hash)
) STRICT;

-- ---------- ROSTER / CRONOGRAMA ----------
CREATE TABLE roster_estados (                   -- catálogo configurable de celdas
  codigo    TEXT PRIMARY KEY,                   -- 'P','B','EC','V','L','C', ...
  nombre    TEXT NOT NULL,                      -- 'Trabajando','Descanso', ...
  color     TEXT NOT NULL,                      -- para la grilla
  orden     INTEGER NOT NULL DEFAULT 0
) STRICT;
-- seed: P=Trabajando, B=Descanso, EC=(a confirmar con la empresa), V=Vacaciones, L=Licencia, C=Capacitación

CREATE TABLE roster_asignaciones (
  id          INTEGER PRIMARY KEY,
  empleado_id INTEGER NOT NULL REFERENCES empleados(id),
  fecha       TEXT NOT NULL,                    -- 'YYYY-MM-DD' en ART (zona del proyecto)
  estado      TEXT NOT NULL REFERENCES roster_estados(codigo),
  sitio_id    INTEGER REFERENCES sitios(id),    -- en qué proyecto está asignado ese día
  creado_ms   INTEGER NOT NULL,
  creado_por  INTEGER NOT NULL REFERENCES empleados(id),
  UNIQUE (empleado_id, fecha)                   -- una asignación por empleado por día
) STRICT;
CREATE INDEX idx_roster_fecha ON roster_asignaciones(fecha, estado);
CREATE INDEX idx_roster_emp   ON roster_asignaciones(empleado_id, fecha);

-- ---------- FICHADAS (eventos inmutables) ----------
-- Correcciones = fila nueva tipo 'ajuste' que referencia la original. Nada se updatea/borra (triggers §4.1).
CREATE TABLE fichadas (
  id            INTEGER PRIMARY KEY,
  empleado_id   INTEGER NOT NULL REFERENCES empleados(id),
  request_id    TEXT NOT NULL,                  -- UUIDv7 generado por el teléfono AL fichar
  tipo          TEXT NOT NULL CHECK (tipo IN ('ingreso','egreso','ajuste')),
  corrige_id    INTEGER REFERENCES fichadas(id),-- solo para tipo='ajuste'
  ts_cliente_ms INTEGER NOT NULL,               -- reloj del teléfono (referencia)
  ts_servidor_ms INTEGER,                       -- NULL hasta que sincroniza; autoridad
  fecha_art     TEXT,                          -- 'YYYY-MM-DD' calculada por el Worker
  lat           REAL, lng REAL, accuracy_m REAL,
  sitio_id      INTEGER REFERENCES sitios(id),
  qr_payload    TEXT,                           -- código crudo escaneado (evidencia)
  qr_valido     INTEGER CHECK (qr_valido IN (0,1)),  -- HMAC genuino del sitio (ver §5)
  qr_window_ms  INTEGER,                        -- ventana de 30 s que codificaba el QR
  gps_estado    TEXT CHECK (gps_estado IN ('dentro','indeterminado','fuera','sin_datos')),
  distancia_m   REAL,
  origen        TEXT NOT NULL DEFAULT 'app' CHECK (origen IN ('app','manual','importado')),
  estado        TEXT NOT NULL DEFAULT 'valida'
                CHECK (estado IN ('valida','a_revisar','anulada')),
  revision_motivo TEXT,
  hash_prev     TEXT NOT NULL,                  -- cadena SHA-256 (inmutabilidad demostrable)
  hash          TEXT NOT NULL,
  UNIQUE (empleado_id, request_id)              -- idempotencia por par, no global
) STRICT;
CREATE INDEX idx_fich_emp_ts ON fichadas(empleado_id, ts_servidor_ms);
CREATE INDEX idx_fich_revisar ON fichadas(estado, revision_motivo) WHERE estado='a_revisar';

-- ---------- JORNADAS (derivadas por conciliación) ----------
CREATE TABLE jornadas (
  id                 INTEGER PRIMARY KEY,
  empleado_id        INTEGER NOT NULL REFERENCES empleados(id),
  fecha              TEXT NOT NULL,             -- fecha ART del ingreso (turno nocturno → día de inicio)
  ingreso_fichada_id INTEGER NOT NULL UNIQUE REFERENCES fichadas(id),
  egreso_fichada_id  INTEGER UNIQUE REFERENCES fichadas(id),
  ts_ingreso_ms      INTEGER NOT NULL,
  ts_egreso_ms       INTEGER,
  segundos           INTEGER,                   -- NULL hasta cerrar; sin desglose de extras (R6)
  estado             TEXT NOT NULL DEFAULT 'abierta'
                     CHECK (estado IN ('abierta','cerrada','anulada','a_revisar')),
  revision_motivo    TEXT,
  conciliacion_v     INTEGER NOT NULL DEFAULT 1,
  cerrada_ms         INTEGER
) STRICT;
CREATE UNIQUE INDEX ux_jornada_abierta ON jornadas(empleado_id) WHERE estado='abierta';
CREATE INDEX idx_jornadas_fecha ON jornadas(fecha) WHERE estado != 'anulada';

-- ---------- CONSENTIMIENTOS (Ley 25.326) ----------
CREATE TABLE consentimientos (
  id            INTEGER PRIMARY KEY,
  empleado_id   INTEGER NOT NULL REFERENCES empleados(id),
  tipo          TEXT NOT NULL CHECK (tipo IN ('geolocalizacion','politica_privacidad')),
  texto_version TEXT NOT NULL,                  -- hash del texto aceptado
  aceptado_ms   INTEGER NOT NULL,
  ip            TEXT NOT NULL
) STRICT;

-- ---------- SESIONES (append-only) ----------
CREATE TABLE sesiones (
  id             INTEGER PRIMARY KEY,
  token_hash     TEXT NOT NULL UNIQUE,          -- SHA-256 del token opaco; el token nunca se guarda
  empleado_id    INTEGER NOT NULL REFERENCES empleados(id),
  dispositivo_id INTEGER REFERENCES dispositivos(id),
  creada_ms      INTEGER NOT NULL,
  expira_ms      INTEGER NOT NULL,              -- acceso 1 h
  refresca_ms    INTEGER,                       -- refresh device-bound 30 días
  revocada_ms    INTEGER, revocada_motivo TEXT, -- logout NO borra: queda evidencia
  ultimo_uso_ms  INTEGER,
  ip             TEXT, user_agent TEXT
) STRICT;
CREATE INDEX idx_sesiones_emp ON sesiones(empleado_id, revocada_ms);

-- ---------- IDEMPOTENCIA (solo mutaciones no-fichada; fichadas usan UNIQUE propio) ----------
CREATE TABLE idempotency_keys (
  request_id  TEXT PRIMARY KEY,
  empleado_id INTEGER NOT NULL,
  accion      TEXT NOT NULL,
  respuesta   TEXT,
  creada_ms   INTEGER NOT NULL,
  expira_ms   INTEGER NOT NULL                  -- TTL 30 días (vida real del outbox)
) STRICT;

-- ---------- AUDIT LOG (append-only + cadena de hash) ----------
CREATE TABLE audit_log (
  id                INTEGER PRIMARY KEY,
  ts_ms             INTEGER NOT NULL,
  actor_empleado_id INTEGER,                    -- NULL = sistema/anónimo
  actor_ip          TEXT,
  accion            TEXT NOT NULL,              -- 'fichada.sync','roster.editar','empleado.alta',...
  entidad           TEXT NOT NULL, entidad_id TEXT,
  antes             TEXT, despues TEXT,         -- JSON diff
  resultado         TEXT NOT NULL CHECK (resultado IN ('ok','rechazado','error','pendiente')),
  detalle           TEXT,
  hash_prev         TEXT NOT NULL, hash TEXT NOT NULL
) STRICT;
CREATE INDEX idx_audit_ts ON audit_log(ts_ms);
CREATE INDEX idx_audit_actor ON audit_log(actor_empleado_id, ts_ms);

-- ---------- CONFIG (versionada) ----------
CREATE TABLE config (
  clave    TEXT NOT NULL,
  valor    TEXT NOT NULL,
  vigente_desde_ms INTEGER NOT NULL,
  PRIMARY KEY (clave, vigente_desde_ms)         -- append-only: la historia no se pisa
) STRICT;

-- ---------- PERIODOS CONGELADOS (export a liquidación) ----------
CREATE TABLE periodos_congelados (
  id          INTEGER PRIMARY KEY,
  desde       TEXT NOT NULL, hasta TEXT NOT NULL,
  dataset_hash TEXT NOT NULL,                   -- hash del CSV exportado
  congelado_ms INTEGER NOT NULL,
  congelado_por INTEGER NOT NULL REFERENCES empleados(id)
) STRICT;
```

### 4.1 Inmutabilidad demostrable (no declarada)

```sql
-- migrations/0002_append_only.sql
CREATE TRIGGER fichadas_no_update BEFORE UPDATE ON fichadas
BEGIN SELECT RAISE(ABORT, 'fichadas es append-only'); END;
CREATE TRIGGER fichadas_no_delete BEFORE DELETE ON fichadas
BEGIN SELECT RAISE(ABORT, 'fichadas es append-only'); END;
CREATE TRIGGER audit_no_update  BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log es append-only'); END;
CREATE TRIGGER audit_no_delete  BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log es append-only'); END;
-- (ídem jornadas y roster_asignaciones: la edición de roster inserta versión nueva)
```

- Cada fila de `fichadas`/`audit_log` lleva `hash = SHA-256(hash_prev || contenido_fila)` → cualquier alteración rompe la cadena y se detecta con una verificación.
- **Cron diario**: digest del día (hash de la última fila + conteos) firmado y exportado a (a) bucket R2 de **otra cuenta Cloudflare** con retención WORM, (b) mail automático a RRHH. Aunque alguien con credenciales de wrangler reescribiera la base, no puede reescribir el digest que ya salió de la cuenta.
- Verificación de cadena: endpoint `/api/admin/verificar-cadena?desde=&hasta=` que recorre y valida; su resultado también se audita.

### 4.2 Backups

1. Time Travel D1 (30 días) — restauración a punto en el tiempo.
2. Cron diario: dump SQL paginado → R2 (cuenta secundaria), retención 1 año.
3. Digests firmados diarios (arriba) — la capa que sobrevive incluso a un compromiso total de la cuenta.
4. Ensayo de restauración trimestral con acta (quién, cuándo, resultado) — el ensayo sin evidencia no vale en un peritaje.

---

## PARTE 5 — FICHADA CON QR (flujo completo)

### 5.1 El QR rotativo del sitio

- Cada sitio tiene `qr_secret` (base32, solo en D1 y en el dispositivo cartel).
- **Modo cartel**: página del PWA en una tablet/PC en portería que muestra el QR en pantalla grande. El código se calcula localmente con TOTP (`HMAC(qr_secret, floor(now/30s))`) → **funciona sin internet**.
- El QR contiene: `https://asistencia.<empresa>.com/#f=<sitio_id>&<código>&<ventana_ms>`.
- Rota cada 30 s → una foto de ayer no sirve hoy; una foto de hoy caduca en 30 s.

### 5.2 Registro del empleado (teléfono propio)

1. Empleado abre la PWA → **login Google** (allowlist por email; sesión 1 h + refresh 30 días device-bound).
2. Si no aceptó aún el consentimiento de geolocalización (25.326) → pantalla de aceptación con versión del texto. Sin aceptar no puede fichar (queda registrado el rechazo).
3. Toca "Fichar" → cámara escanea el QR del sitio (`BarcodeDetector` en Android; fallback `jsQR` en iOS).
4. La PWA captura en ese instante: `{sitio_id, qr_payload, ventana, ts_cliente, lat, lng, accuracy, request_id (UUIDv7)}`.
5. **Online**: `POST /api/fichadas` inmediato.
6. **Offline (o error de red)**: item a la outbox de IndexedDB; UI "Guardado — se enviará con señal"; badge de pendientes persistente.
7. **Sync**: en `online`, `visibilitychange` o al abrir la app → `POST /api/sync` con toda la cola (tope 60 items). Respuesta por item; solo se borra del outbox con ack explícito.

### 5.3 Validación en el Worker (server-side, nunca en el cliente)

```
POST /api/fichadas  (o item de /api/sync)
 1. Sesión válida (cookie → cache 60 s → D1 fallback). Empleado activo.
 2. zod: tipos/rangos/request_id UUIDv7/sitio existente y activo.
 3. INSERT fichada ... ON CONFLICT(empleado_id,request_id) DO NOTHING RETURNING id
      → si no devuelve fila: es un reintento → leer la existente y devolver su resultado.
 4. Debounce: ¿otra fichada misma empleado+tipo hace ≤90 s? → devolver la previa
      + audit 'fichada.debounce' (ticket de soporte #1 resuelto).
 5. QR: recomputar HMAC para qr_window_ms ±2 ventanas → qr_valido 0/1.
      qr_valido=0 → estado='a_revisar', motivo='qr_invalido' (se registra igual: evidencia).
 6. GPS tri-estado: dentro (dist+acc ≤ radio) / fuera (dist−acc > radio) / indeterminado (solape).
      'fuera'/'sin_datos' → a_revisar motivo gps. NUNCA se rechaza el registro.
 7. Reloj: |ts_cliente − now| > 10 min → a_revisar motivo 'reloj_cliente'.
 8. Roster cruzado: ¿estado 'P' ese día para ese empleado en ese sitio?
      No → a_revisar motivo 'fuera_de_roster' (informativo; lo resuelve un supervisor).
 9. Todo (fichada + audit + conciliación de jornada) en UN db.batch() → atómico.
10. Rate limit: NUNCA bloquea fichadas. Ráfaga >20/min/empleado → flag 'rafaga' + alerta al admin.
```

### 5.4 Conciliación (eventos → jornadas)

| Situación | Regla |
|---|---|
| Ingreso → egreso | Jornada con `ts_ingreso`/`ts_egreso`, `segundos = ts_egreso − ts_ingreso` |
| Turno cruza medianoche | `jornadas.fecha` = fecha ART del **ingreso**; sin split |
| Doble ingreso | 2º evento se guarda; conciliación marca jornada `a_revisar` 'doble_ingreso' |
| Egreso sin ingreso abierto | Evento guardado; jornada `a_revisar` 'egreso_huerfano' |
| Jornada abierta > 24 h | Cron 03:00 ART → `a_revisar` 'sin_cierre' + reporte supervisor |
| Corrección | Evento `ajuste` (corrige_id + motivo) aprobado por supervisor ≠ beneficiario + conformidad del empleado en la app (acepta/impugna con fecha) |
| Import histórico de Drive | `origen='importado'`, `confianza='baja'` — nunca se presenta como evidencia de grado sistema |

---

## PARTE 6 — MÓDULO ROSTER / CRONOGRAMA (reemplazo del Drive)

### 6.1 Modelo de datos → grilla del cronograma real

La planilla "Cronograma San Jorge" mapea 1:1 con `roster_asignaciones`:

- Filas = empleados (rol, DNI, ciudad de origen — columnas exactas del PDF).
- Columnas = días del mes.
- Celdas = `roster_estados` (P/B/EC/… catálogo configurable).
- Totales por rol y por ciudad (pie del PDF) = queries agregadas.

### 6.2 Carga y edición

1. **Import inicial**: parser CSV/XLSX del cronograma actual de Drive (mapeo de columnas configurable) → alta de empleados + asignaciones del período.
2. **Patrones repetibles**: "aplicar 14x14 desde fecha X" o "L-V desde X" autocompleta P/B (el admin ajusta excepciones a mano).
3. **Edición en grilla**: click en celda → cambiar estado/sitio; cada cambio inserta versión nueva (`vigente_desde_ms`) — el historial del roster queda auditable ("¿quién cambió el franco de X?").
4. **Vista móvil del empleado**: "Mi cronograma" — ve sus próximos 30 días (P/B/EC + sitio) → responde el requisito "querían que se pueda ver el roster".

### 6.3 Desvíos (informativo, no sanción automática)

Vista supervisor: fichadas vs roster (trabajó con franco, franco pero fichó, sitio distinto al asignado). Perdona el hallazgo #12 de la revisión: la ausencia nunca se infiere de la falta de datos — se contrasta contra el roster y lo resuelve una persona.

---

## PARTE 7 — FRONTEND PWA

- Base: la UI premium existente (se conserva el trabajo hecho).
- Agregados: lector QR (cámara), banner offline + badge de outbox, "Mi cronograma", pantalla de consentimiento, comprobante por fichada (ID + hora servidor) que el empleado puede ver y guardar (evidencia bilateral).
- Cache: shell precacheado; GET network-first con fallback cacheado y sello "datos de dd/mm hh:mm"; POST nunca cacheado.
- Admin: grilla roster (desktop-first), bandeja `a_revisar` (aprobar/corregir con motivo), empleados (alta/enrol/desactivar/reset dispositivo), sitios (geocercas + regenerar QR secret), export, verificación de cadena de hash.

---

## PARTE 8 — EXPORT (reemplaza el Drive)

1. **Asistencia por período** (CSV/XLSX, UTF-8 BOM): `DNI, Apellido, Nombre, Rol, Convenio, Sitio, Fecha, Ingreso, Egreso, Horas (h:mm), Origen` — solo entrada/salida (R6), sin extras.
2. **Cronograma del período** (XLSX con el mismo layout del PDF actual: grilla + totales por rol/ciudad) — continuidad con lo que RRHH ya usa.
3. **Export = congelamiento**: al descargar un período se guarda `periodos_congelados` con el hash del dataset. Fichadas tardías posteriores NO alteran el número ya enviado; si hay impacto, se genera nota de reversión auditada.
4. Cada export registra en `audit_log`: quién, filtros, timestamp. Solo rol admin.

---

## PARTE 9 — TESTING (Vitest + @cloudflare/vitest-pool-workers, CI en GitHub Actions)

| Módulo | Tests obligatorios |
|---|---|
| Auth | JWT Google válido/inválido/expirado, `aud`, `email_verified`, nonce anti-replay, JWKS rotado, allowlist, cookie robada→revocación |
| Fichadas | idempotencia (mismo request_id N veces = 1 fila), **crash entre pasos** (batch atómico: nunca queda clave sin fichada), debounce 90 s, QR válido/inválido/ventana vencida, GPS tri-estado, reloj cliente ±10 min, fuera de roster |
| Conciliación | turno normal, **cruce medianoche (23:00→05:00 = 6 h, fecha del ingreso)**, doble ingreso, huérfano, sin cierre >24 h, ajuste con conformidad |
| Roster | import fixture del cronograma real, patrón 14x14, conflicto una-asignación-por-día, historial versionado |
| Sync offline | outbox 5 items → ack por item → solo se borra con ack; request_id repetido no duplica; tope 60 items |
| Inmutabilidad | UPDATE/DELETE a fichadas/audit_log → ABORT por trigger; verificación de cadena detecta fila alterada |
| Export | fixture con jornadas conocidas → horas exactas; congelamiento impide alterar período exportado |
| Rate limit | ráfaga 200 fichadas/1 min/1 IP: NINGUNA rechazada por 429 en ruta fichadas; auth sí bloquea |

---

## PARTE 10 — FASES, COSTOS Y CORTE

| Fase | Entrega | Verificación |
|---|---|---|
| **0** | GCP (OAuth client), dominio propio, proyecto Workers+D1, migrations, login real en staging | Login desde 2 teléfonos reales en staging |
| **1** | Fichadas QR + GPS + offline outbox + sync + conciliación + audit + hash chain + modo cartel | Tests §9 en verde; pilotaje 1 semana en 1 proyecto (San Jorge) con 5-10 personas |
| **2** | Roster completo (import + grilla + patrones + vista empleado) + admin panel + export/congelación | **2 semanas en paralelo vs Drive**: acta de comparación, 0 discrepancias de horas |
| **3** | Corte: Drive pasa a histórico; import final; monitoreo (health check + digest diario a RRHH) | Cierre firmado |
| Futuro (si se pide) | Licencias, capacitaciones, extras/nocturnas, WebAuthn, kiosco de portería | — |

**Costos (200 empleados, ~800 fichadas/día por el QR entrada+salida):** Workers Paid USD 5 + D1 incluido + DO incluido + Pages $0 + R2 (2 cuentas) < $1 + dominio ~USD 12/año → **≈ USD 6/mes**.

---

## PARTE 11 — PREGUNTAS PENDIENTES PARA LA EMPRESA (bloquean detalles, no la Fase 0)

1. **¿Qué significa "EC"** en el cronograma (aparece en bloques de 7 días)? ¿Confirmar P = trabajando, B = descanso?
2. **Dominio propio**: ¿pueden comprar/delegar un subdominio (ej. `asistencia.empresa.com`)? Sin esto no hay producción (sí staging).
3. **Cartel QR**: ¿hay tablet/PC + electricidad en portería de cada proyecto para dejar el modo cartel? (En San Jorge y Veladero).
4. **Enrolamiento**: ¿los ~200 operarios tienen Gmail propio, o se cargan primero los DNI del roster y cada uno se enrola al primer login? (Propuesta v2: alta por admin con DNI; email opcional hasta enrolar).
5. **Período de congelación del export**: ¿quincenal o mensual?
