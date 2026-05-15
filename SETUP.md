# Guía de Instalación — Control de Acceso de Personal

Esta guía explica cómo configurar y poner en marcha el sistema desde cero.
Tiempo estimado: **30–45 minutos**.

---

## Requisitos previos

- Cuenta de Google (Gmail)
- Cuenta en GitHub (gratuita)
- Cuenta en Netlify (gratuita) → netlify.com

---

## PASO 1 — Crear la Planilla de Google Sheets

1. Ir a [sheets.new](https://sheets.new) para crear una nueva planilla
2. Nombrarla, por ejemplo: **"Control de Acceso Personal"**
3. En el editor de Google Apps Script se crearán las hojas automáticamente (ver Paso 3)
4. **Copiar el ID de la planilla** — es la parte larga de la URL:
   ```
   https://docs.google.com/spreadsheets/d/  [ESTE_ES_EL_ID]  /edit
   ```

---

## PASO 2 — Configurar Google Apps Script (Backend)

### 2.1 Crear el proyecto

1. Ir a [script.google.com](https://script.google.com)
2. Hacer clic en **"Nuevo proyecto"**
3. Renombrarlo a: **"Control de Acceso API"**

### 2.2 Pegar el código

1. Borrar todo el contenido del editor
2. Copiar el contenido completo del archivo **`Code.gs`** de este proyecto
3. Pegarlo en el editor
4. Guardar (`Ctrl+S`)

### 2.3 Configurar el ID de la planilla

1. En el editor, ir a: **Proyecto > Propiedades del proyecto**
2. Seleccionar la pestaña **"Propiedades de secuencia de comandos"**
3. Hacer clic en **"Agregar propiedad"**
4. Completar:
   - **Propiedad:** `SHEET_ID`
   - **Valor:** el ID de la planilla copiado en el Paso 1
5. Guardar

### 2.4 Inicializar las hojas

1. En el editor, seleccionar la función `inicializarHojas` en el menú desplegable
2. Hacer clic en **"Ejecutar"**
3. Aceptar los permisos que Google solicita (es normal)
4. Verificar en la planilla que se crearon las hojas: **Empleados**, **Registros**, **Configuracion**

### 2.5 Desplegar como Web App

1. En el editor, ir a: **Implementar > Nueva implementación**
2. Hacer clic en el ícono de engranaje y seleccionar **"Aplicación web"**
3. Configurar:
   - **Descripción:** Control de Acceso API
   - **Ejecutar como:** Yo (tu cuenta Google)
   - **Quién tiene acceso:** Cualquier persona
4. Hacer clic en **"Implementar"**
5. **Copiar la URL del Web App** — tiene este formato:
   ```
   https://script.google.com/macros/s/XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX/exec
   ```

> ⚠️ **Importante:** Cada vez que modifique el código de `Code.gs`, debe crear una
> **nueva implementación** (no "Administrar implementaciones existentes") para que
> los cambios tomen efecto.

---

## PASO 3 — Configurar Google Cloud Console (OAuth)

### 3.1 Crear el proyecto

1. Ir a [console.cloud.google.com](https://console.cloud.google.com)
2. Hacer clic en el selector de proyectos (arriba a la izquierda) → **"Nuevo proyecto"**
3. Nombre: **"Control Acceso"** → Crear

### 3.2 Configurar pantalla de consentimiento OAuth

1. En el menú lateral: **APIs y servicios > Pantalla de consentimiento de OAuth**
2. Tipo de usuario: **Externo** → Crear
3. Completar:
   - **Nombre de la app:** Control de Acceso
   - **Email de asistencia:** tu email
   - **Email del desarrollador:** tu email
4. Guardar y continuar en todos los pasos (sin agregar permisos extra)

### 3.3 Crear credenciales OAuth

1. En el menú lateral: **APIs y servicios > Credenciales**
2. Hacer clic en **"+ Crear credenciales" > "ID de cliente de OAuth"**
3. Tipo de aplicación: **Aplicación web**
4. Nombre: Control Acceso Web
5. En **"Orígenes de JavaScript autorizados"** agregar:
   ```
   http://localhost
   http://localhost:5500
   https://TU-NOMBRE.netlify.app
   ```
   *(La URL de Netlify se agrega después del Paso 5)*
6. Hacer clic en **"Crear"**
7. **Copiar el Client ID** — tiene este formato:
   ```
   1234567890-abcdefghijklmnopqrstuvwxyz.apps.googleusercontent.com
   ```

---

## PASO 4 — Configurar la App

1. Abrir el archivo **`js/config.js`** de este proyecto
2. Reemplazar los valores de ejemplo por los reales:

```javascript
window.APP_CONFIG = {
  GOOGLE_CLIENT_ID: 'TU_CLIENT_ID_AQUI.apps.googleusercontent.com',  // Del Paso 3
  GAS_URL:          'https://script.google.com/macros/s/TU_ID/exec',  // Del Paso 2
  APP_NAME:         'Mi Empresa',                                       // Nombre visible
  AUTO_CLOSE_DELAY: 5000,                                               // 5 segundos
};
```

> ⚠️ **Importante:** El archivo `js/config.js` ahora tiene validación. Si abre la consola del navegador (F12) y ve el error `[CONFIG] ERROR`, significa que todavía tiene los valores de ejemplo.

---

## PASO 4.5 — Probar localmente (opcional pero recomendado)

Antes de subir a Netlify, puede probar la app en su computadora:

```bash
python start.py
```

Luego abra en el navegador:
- **Vista empleado:** http://localhost:8080
- **Vista admin:** http://localhost:8080/#admin

> Recuerde que el login de Google solo funcionará si agregó `http://localhost:8080` como origen autorizado en Google Cloud Console (Paso 3.3).

---

## PASO 5 — Subir a GitHub y desplegar en Netlify

### 5.1 Subir a GitHub

```bash
cd ruta/al/proyecto/controlpersonal
git init
git add .
git commit -m "Initial commit - Control de Acceso"
```

1. Crear un repositorio nuevo en [github.com/new](https://github.com/new)
   - Nombre: `controlpersonal`
   - Privado o público (recomendado privado)
2. Seguir las instrucciones de GitHub para conectar el repo:
   ```bash
   git remote add origin https://github.com/TU-USUARIO/controlpersonal.git
   git push -u origin main
   ```

### 5.2 Conectar con Netlify

1. Ir a [app.netlify.com](https://app.netlify.com)
2. **"Add new site" > "Import an existing project"**
3. Conectar con GitHub y seleccionar el repositorio `controlpersonal`
4. Configuración de build:
   - **Build command:** *(dejar vacío)*
   - **Publish directory:** `.`
5. Hacer clic en **"Deploy site"**
6. Netlify asignará una URL aleatoria como `https://jolly-fox-1234.netlify.app`

### 5.3 Personalizar el dominio de Netlify (opcional)

1. En Netlify, ir a: **Site settings > Domain management**
2. Hacer clic en **"Options" > "Edit site name"**
3. Cambiar a algo como: `controlacceso-miempresa`
4. La URL quedará: `https://controlacceso-miempresa.netlify.app`

> Esta URL es **permanente**. Cualquier cambio que haga con `git push` actualizará
> la app automáticamente sin cambiar la URL.

### 5.4 Actualizar Google Cloud con la URL de Netlify

1. Volver a **Google Cloud Console > APIs y servicios > Credenciales**
2. Editar el Client ID creado en el Paso 3
3. En **"Orígenes de JavaScript autorizados"** agregar la URL de Netlify:
   ```
   https://controlacceso-miempresa.netlify.app
   ```
4. Guardar

---

## PASO 6 — Cargar los primeros empleados

1. Abrir la planilla de Google Sheets
2. Ir a la hoja **"Empleados"**
3. Agregar filas con los datos:

| Email | Nombre | Apellido | Sector | Turno | Dispositivo_ID | Activo | Es_Admin | Estado |
|---|---|---|---|---|---|---|---|---|
| admin@miempresa.com | Carlos | López | Dirección | | | TRUE | TRUE | Fuera |
| ana@gmail.com | Ana | García | RRHH | Mañana | | TRUE | FALSE | Fuera |
| juan@gmail.com | Juan | Pérez | Ventas | Tarde | | TRUE | FALSE | Fuera |

> - **Dispositivo_ID:** dejar vacío — se llena automáticamente cuando el empleado accede por primera vez
> - **Es_Admin:** TRUE solo para el empleador/administrador
> - El email del administrador debe coincidir con su cuenta Google

---

## PASO 7 — Configurar Geofencing (ubicación GPS)

1. Abrir la app desde el celular en el establecimiento
2. Ir a: **`https://tu-url.netlify.app/#admin`** (con su cuenta admin)
3. En el panel, ir a **Configuración**
4. Hacer clic en **"Usar mi ubicación actual"** (estando físicamente en el establecimiento)
5. Definir el radio permitido (recomendado: 150–250m)
6. Guardar

---

## PASO 8 — Generar e imprimir el código QR

1. Ir a [qrcode-monkey.com](https://www.qrcode-monkey.com) (gratuito)
2. En el campo URL ingresar: `https://tu-url.netlify.app`
3. Personalizar colores si se desea
4. Descargar en alta resolución (mínimo 1000×1000 px)
5. Imprimir y plastificar para colocarlo en la entrada del establecimiento

> El QR **nunca cambiará** porque apunta a la URL de Netlify, que es permanente.

---

## PASO 9 — Crear íconos PWA

Para que la app sea instalable como icono en el celular, se necesitan los íconos.

### Opción A — Generador online (recomendado)
1. Ir a [pwa-image-generator.dev](https://www.pwa-image-generator.dev) o [realfavicongenerator.net](https://realfavicongenerator.net)
2. Subir una imagen (logo de la empresa, mínimo 512×512 px)
3. Descargar y colocar en la carpeta `icons/` del proyecto:
   - `icons/icon-192.png`
   - `icons/icon-512.png`
4. Hacer `git push` para actualizar

### Opción B — Ícono simple generado con Canvas
Abrir una consola del navegador en la app y ejecutar:

```javascript
// Generar ícono simple
const c = document.createElement('canvas');
c.width = c.height = 512;
const ctx = c.getContext('2d');
ctx.fillStyle = '#4F46E5';
ctx.fillRect(0, 0, 512, 512);
ctx.fillStyle = '#fff';
ctx.font = 'bold 200px Arial';
ctx.textAlign = 'center';
ctx.textBaseline = 'middle';
ctx.fillText('CA', 256, 256);
const link = document.createElement('a');
link.download = 'icon-512.png';
link.href = c.toDataURL();
link.click();
```

---

## Cómo usar la app — Guía del empleado

### Al ENTRAR al trabajo:
1. Escanear el código QR en la entrada con la cámara del celular
2. La app se abre automáticamente
3. Si es la primera vez: iniciar sesión con su cuenta Google
4. Confirmar el registro de **ENTRADA** tocando el botón verde
5. La app muestra la hora registrada y se cierra automáticamente en 5 segundos

### Al SALIR del trabajo:
1. Abrir la app nuevamente (del historial del navegador o escaneando el QR)
2. Confirmar el registro de **SALIDA** tocando el botón rojo
3. La app muestra el tiempo trabajado y se cierra automáticamente

### Instalar la app en el celular (recomendado):
- **Android:** Abrir la URL en Chrome → menú (3 puntos) → "Agregar a pantalla de inicio"
- **iPhone:** Abrir en Safari → botón compartir → "Agregar a pantalla de inicio"

---

## Acceso al panel de administrador

Abrir en el navegador: `https://tu-url.netlify.app/#admin`

O acceder desde el celular/computadora con la URL completa con `#admin` al final.

### Funciones disponibles:
- **Vista general:** empleados presentes ahora, registros del día
- **Empleados:** agregar, activar/desactivar, resetear dispositivo
- **Registros:** historial completo con filtros por fecha, sector, empleado
- **Informes:** 1ra quincena, 2da quincena o mensual, por empleado o todos
- **Exportar CSV:** cualquier informe puede descargarse como Excel/CSV
- **Configuración:** geofence, nombre del establecimiento

---

## Cómo actualizar la app

Para hacer cualquier cambio o mejora:

```bash
# Editar los archivos que necesite
git add .
git commit -m "Descripción del cambio"
git push
```

Netlify detecta el push y actualiza automáticamente en ~1 minuto.
**La URL no cambia nunca.**

---

## Resolución de problemas frecuentes

| Problema | Solución |
|---|---|
| "Email no registrado" | Agregar el empleado en la planilla hoja Empleados |
| "Dispositivo no autorizado" | En el panel admin → Empleados → Reset dispositivo |
| "Fuera del área permitida" | Verificar coordenadas en Configuración, o aumentar el radio |
| El botón de Google no aparece | Verificar que el CLIENT_ID en config.js sea correcto |
| Error de conexión | Verificar que el GAS_URL en config.js sea correcto y que el script esté desplegado |
| La app no carga | Verificar que Netlify desplegó correctamente (ver logs en Netlify dashboard) |
| Registros duplicados | Normal: cada escaneo registra un movimiento. Si hay error, eliminar manualmente en Sheets |

---

## Seguridad — Resumen de las 3 capas

1. **Google OAuth:** El email viene directamente de la cuenta Google del celular.
   No se puede ingresar una dirección de email a mano.

2. **Dispositivo vinculado:** La primera vez que un empleado accede, su dispositivo
   queda vinculado a su cuenta. Si intenta registrarse desde otro celular,
   el sistema lo rechaza automáticamente.

3. **Geofencing GPS:** Si está configurado, el sistema verifica que el empleado
   esté físicamente dentro del radio permitido del establecimiento antes de
   registrar el acceso.

> Para que alguien pueda registrarse fraudulentamente por un compañero,
> necesitaría: el celular físico del compañero, su cuenta Google abierta,
> y estar en el establecimiento. Esto es prácticamente imposible en la práctica.
