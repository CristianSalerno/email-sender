# Email Sender App

Bulk email app with attachments, optional category-based contact lists in Supabase, and open tracking via SendGrid.

**Guide to clone and deploy from another computer:** [`GUIA_DESDE_OTRO_EQUIPO.md`](GUIA_DESDE_OTRO_EQUIPO.md).

## Installation

```bash
cd email-sender
npm install
```

## Variables: localhost vs production / staging

| Where | What to use |
| ----- | ----------- |
| **Localhost** | **`.env`** file in the project root (ignored by Git). Fill in `SENDGRID_*` and, if you want to save lists and campaigns, `SUPABASE_*`. Sign in with `APP_LOGIN_PASSWORD`. After editing `.env`, restart `npm start`. |
| **Production (Vercel)** | Same **names** as in `.env.example`, with real environment values: a strong password, a **different** `SESSION_SECRET` (do not reuse your local one), and production SendGrid and Supabase credentials. |
| **Staging (Vercel, separate project)** | All variables again with **test** values: different passwords/secrets, ideally a separate Supabase project (or bucket) and optionally a separate SendGrid API key. The deploy URL can be used for the webhook while testing. |

Each environment uses the **same list of variables**; only the **values** change (local ≠ prod ≠ staging).

## Environment variables

**Local:** create a **`.env`** file in the root (not committed to the repo) or copy [`.env.example`](.env.example) to `.env` and fill it in. Run `npm start`; the server loads `.env` with `dotenv`.

**Vercel:** **Settings → Environment Variables** → same keys as in `.env.example`.

| Variable | Description |
| -------- | ----------- |
| `APP_LOGIN_PASSWORD` | Single password to access the app (use a strong one and store it only on the server). |
| `SESSION_SECRET` | Long random string to sign the session cookie. **Do not** reuse the app password or database password. Generate with `openssl rand -hex 32` or `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. |
| `SENDGRID_API_KEY` | SendGrid API key with send permission. **Vercel:** set only in project **Environment Variables** (no `.env` in the repo). **Local:** copy it to your local `.env` if you want to send from `npm start`. |
| `FROM_EMAIL` | Sender email verified in SendGrid. Same pattern: Vercel → project variables; local → `.env` only when testing on your machine. |
| `SUPABASE_URL` | Project URL: **Project Settings → API → Project URL** (e.g. `https://xxxx.supabase.co`). |
| `SUPABASE_SERVICE_ROLE_KEY` | **service_role** key (secret) in **Project Settings → API**. Required for Storage and server-side inserts. **Do not** use the `anon` or publishable keys for this backend. |
| `SUPABASE_STORAGE_BUCKET` | Private Supabase Storage bucket name (e.g. `contact-uploads`). Must exist and match the name created in the dashboard. |
| `PORT` | Local only; defaults to `3000`. |

### SendGrid Event Webhook (opens)

In SendGrid, configure the HTTP POST webhook to:

`https://YOUR-DOMAIN/api/sendgrid/events`

Include at least **processed**, **delivered**, and **open** events (and optionally **bounce**, **dropped**, **deferred**). Many accounts only allow **one** Event Webhook URL: use staging first, then switch to production, or use a subuser with its own URL.

### Supabase: SQL and Storage

1. In **SQL Editor**, run [`supabase/schema.sql`](supabase/schema.sql).
2. In **Storage**, create a **private** bucket whose name exactly matches `SUPABASE_STORAGE_BUCKET`.

### Supabase: avoid free-tier pause

On the free plan, Supabase **pauses the project after ~7 days of inactivity**. SendGrid does not pause; what breaks is the database (contacts, campaigns, tracking).

- After clicking **Resume** in the Supabase dashboard, wait **1–3 minutes** before using the app; requests fail while the project starts up.
- This project includes a **daily cron** on Vercel (`/api/keepalive`) that queries Supabase to keep the project active. After deploying, add `CRON_SECRET` in Vercel → **Settings → Environment Variables** (generate with `openssl rand -hex 32`).
- For production clients, consider **Supabase Pro** (~$25/month): the project is not paused automatically.

## Usage

```bash
npm start
```

Open http://localhost:3000 and sign in with the password set in `APP_LOGIN_PASSWORD`.

## Supported formats

- **Excel**: `email` column or first column
- **TXT**: One email per line, separated by commas or semicolons
