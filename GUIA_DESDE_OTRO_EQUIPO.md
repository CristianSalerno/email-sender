# Quick guide — Email Sender (from any computer)

Open this file on your laptop or another machine after cloning the repo. It does **not** include secrets—only variable names and steps.

## 1. Clone the repository

```bash
git clone <YOUR_GITHUB_REPO_URL>
cd email-sender
git checkout staging    # test environment on Vercel
# or: git checkout master
```

Replace `<YOUR_GITHUB_REPO_URL>` with the HTTPS or SSH URL from GitHub (**Code**).

## 2. Local setup

```bash
npm install
cp .env.example .env
```

Edit **`.env`** and fill in at least:

| Variable | Purpose |
| -------- | ------- |
| `APP_LOGIN_PASSWORD` | Password to sign in at http://localhost:3000 |
| `SESSION_SECRET` | Generate with: `openssl rand -hex 32` |
| `SENDGRID_API_KEY` / `FROM_EMAIL` | Only if you want to **send** from your PC (optional) |
| `SUPABASE_*` | Only if you want to save lists and tracking locally |

```bash
npm start
```

Open: http://localhost:3000

> The **`.env`** file is not committed to Git (it is in `.gitignore`).

## 3. Vercel (single project)

### Branches

- **`master` (or the project “Production” branch)** → **production** URL.
- **`staging`** → **Preview** deploy (different URL, e.g. `…-git-staging-….vercel.app`).

### Variables in Vercel

**Project → Settings → Environment Variables**

- Add the same keys as in `.env.example`.
- Mark each for **Production** and/or **Preview** as needed.
- For test data on staging, use **different** `SESSION_SECRET` and `APP_LOGIN_PASSWORD` values in **Preview** than in **Production**.

After changing variables: **Deployments → Redeploy** the deploy you want to test.

### SendGrid — open tracking webhook

In SendGrid, Event Webhook HTTP POST:

`https://<YOUR_VERCEL_DOMAIN>/api/sendgrid/events`

Use the **Preview** URL if you only test `staging`, or **Production** when ready. Many accounts allow only **one** webhook URL (validate on staging first, then switch to prod if needed).

## 4. Supabase (once per project)

1. In the Supabase SQL Editor, run: **`supabase/schema.sql`**.
2. **Storage** → create a **private** bucket named after `SUPABASE_STORAGE_BUCKET` (e.g. `contact-uploads`).
3. In **Settings → API**, copy **Project URL** (`SUPABASE_URL`) and the **`service_role`** key (`SUPABASE_SERVICE_ROLE_KEY`). Do not use the `anon` key on the server.

## 5. Useful links in the repo

- Example variables: `.env.example`
- General documentation: `README.md`
- Database schema: `supabase/schema.sql`

## 6. Security reminder

- Do not commit **`.env`** or API keys to the repository.
- Rotate keys if you think someone may have seen them.

---
*Last updated for the Email Sender project `staging` branch.*
