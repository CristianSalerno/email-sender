# Email Sender App

App para enviar emails masivos con adjuntos, con opción de guardar listas por categoría en Supabase y seguimiento de aperturas vía SendGrid.

**Guía para clonar y desplegar desde otro ordenador:** [`GUIA_DESDE_OTRO_EQUIPO.md`](GUIA_DESDE_OTRO_EQUIPO.md).

## Installation

```bash
cd email-sender
npm install
```

## Variables: localhost vs producción / staging

| Dónde | Qué usar |
| ----- | -------- |
| **Localhost** | Archivo **`.env`** en la raíz (ignorado por Git). Rellena `SENDGRID_*` y, si quieres guardar listas y campañas, `SUPABASE_*`. Inicia sesión con `APP_LOGIN_PASSWORD`. Tras editar `.env`, reinicia `npm start`. |
| **Producción (Vercel)** | Mismos **nombres** que en `.env.example`, valores del entorno real: contraseña fuerte, **otro** `SESSION_SECRET` (no reutilices el de tu Mac), SendGrid y Supabase de producción. |
| **Staging (Vercel, otro proyecto)** | Todas las variables otra vez con valores de **prueba**: otras contraseñas/secretos, idealmente otro Supabase (u otro bucket) y opcionalmente otra API SendGrid. La URL del deploy sirve para el webhook mientras pruebas. |

En cada sitio usas el **mismo listado de variables**; lo que cambia son los **valores** (local ≠ prod ≠ staging).

## Environment variables

**Local:** existe un **`.env`** en la raíz (no se sube al repo) o copia [`.env.example`](.env.example) a `.env` y rellénalo. Ejecuta `npm start`; el servidor carga `.env` con `dotenv`.

**Vercel:** **Settings → Environment Variables** → mismas claves que en `.env.example`.

| Variable | Description |
| -------- | ----------- |
| `APP_LOGIN_PASSWORD` | Password única para entrar a la app (cámbiala por una fuerte y guárdala solo en el servidor). |
| `SESSION_SECRET` | Cadena aleatoria larga para firmar la cookie de sesión. **No** uses la misma que la contraseña de la app ni la de la base de datos. Genera una con `openssl rand -hex 32` o `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. |
| `SENDGRID_API_KEY` | API key de SendGrid con permiso de envío. **Vercel:** solo en **Environment Variables** del proyecto (no hace falta `.env` en el repo). **Local:** si quieres enviar desde `npm start`, cópiala también en tu `.env` local. |
| `FROM_EMAIL` | Email remitente verificado en SendGrid. Igual: Vercel → variables del proyecto; local → `.env` solo si pruebas en tu máquina. |
| `SUPABASE_URL` | URL del proyecto: **Project Settings → API → Project URL** (ej. `https://xxxx.supabase.co`). |
| `SUPABASE_SERVICE_ROLE_KEY` | Clave **service_role** (secreta) en **Project Settings → API**. Necesaria para Storage e inserts desde el servidor. **No** uses la clave `anon` ni claves “publishable” en el cliente público para este backend. |
| `SUPABASE_STORAGE_BUCKET` | Nombre del bucket privado en Supabase Storage (ej. `contact-uploads`). Debe existir y coincidir con el nombre que creaste en el dashboard. |
| `PORT` | Solo local; por defecto `3000`. |

### SendGrid Event Webhook (aperturas)

En SendGrid, configura el webhook HTTP POST apuntando a:

`https://TU-DOMINIO/api/sendgrid/events`

Incluye al menos eventos **processed**, **delivered**, **open** (y opcionalmente **bounce**, **dropped**, **deferred**). En muchas cuentas solo hay **una** URL de Event Webhook: suele usarse primero en staging y luego se cambia a producción, o un subuser con su propia URL.

### Supabase: SQL y Storage

1. En **SQL Editor**, ejecuta [`supabase/schema.sql`](supabase/schema.sql).
2. En **Storage**, crea un bucket **privado** cuyo nombre sea exactamente `SUPABASE_STORAGE_BUCKET`.

## Usage

```bash
npm start
```

Abre http://localhost:3000 e inicia sesión con la contraseña configurada en `APP_LOGIN_PASSWORD`.

## Formatos aceptados

- **Excel**: Columna `email` o primera columna
- **TXT**: Un email por línea, separado por comas o punto y coma
