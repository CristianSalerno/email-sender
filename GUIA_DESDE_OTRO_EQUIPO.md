# Guía rápida — Email Sender (desde cualquier PC)

Puedes abrir este archivo en tu portátil u otra máquina tras clonar el repo. **No** incluye secretos: solo nombres de variables y pasos.

## 1. Clonar el repositorio

```bash
git clone <URL_DE_TU_REPO_GITHUB>
cd email-sender
git checkout staging    # entorno de prueba en Vercel
# o: git checkout master
```

Sustituye `<URL_DE_TU_REPO_GITHUB>` por la URL HTTPS o SSH que veas en GitHub (**Code**).

## 2. Arranque local

```bash
npm install
cp .env.example .env
```

Edita **`.env`** y rellena al menos:

| Variable | Uso |
| -------- | --- |
| `APP_LOGIN_PASSWORD` | Contraseña para entrar en http://localhost:3000 |
| `SESSION_SECRET` | Genera con: `openssl rand -hex 32` |
| `SENDGRID_API_KEY` / `FROM_EMAIL` | Solo si quieres **enviar** desde tu PC (opcional) |
| `SUPABASE_*` | Solo si quieres guardar listas y tracking en BD en local |

```bash
npm start
```

Abre: http://localhost:3000  

> El archivo **`.env`** no se sube a Git (está en `.gitignore`).

## 3. Vercel (un solo proyecto)

### Ramas

- **`master` (o la rama “Production” del proyecto)** → URL de **producción**.
- **`staging`** → deploy **Preview** (URL distinta, tipo `…-git-staging-….vercel.app`).

### Variables en Vercel

**Project → Settings → Environment Variables**

- Añade las mismas claves que en `.env.example`.
- Marca cada una para **Production** y/o **Preview** según corresponda.
- Si quieres datos de prueba en staging, en **Preview** usa **otros** valores de `SESSION_SECRET` y `APP_LOGIN_PASSWORD` que en **Production**.

Tras cambiar variables: **Deployments → Redeploy** del deploy que quieras probar.

### SendGrid — Webhook de aperturas

En SendGrid, Event Webhook HTTP POST:

`https://<TU_DOMINIO_VERCEL>/api/sendgrid/events`

Usa la URL del **Preview** si pruebas solo `staging`, o la de **Production** cuando toque. Suele poder configurarse **una** URL por cuenta (valida primero en staging y luego cambia a prod si hace falta).

## 4. Supabase (una vez por proyecto)

1. En el SQL Editor de Supabase, ejecuta el archivo: **`supabase/schema.sql`**.
2. **Storage** → crea un bucket **privado** con el nombre de `SUPABASE_STORAGE_BUCKET` (ej. `contact-uploads`).
3. En **Settings → API** copia **Project URL** (`SUPABASE_URL`) y la clave **`service_role`** (`SUPABASE_SERVICE_ROLE_KEY`). No uses la clave `anon` en el servidor.

## 5. Enlaces útiles en el repo

- Variables de ejemplo: `.env.example`
- Documentación general: `README.md`
- Esquema de base de datos: `supabase/schema.sql`

## 6. Recordatorio de seguridad

- No subas **`.env`** ni API keys al repositorio.
- Rota claves si crees que alguien las pudo ver.

---
*Última actualización alineada con la rama `staging` del proyecto Email Sender.*
