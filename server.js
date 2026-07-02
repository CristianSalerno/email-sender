require('dotenv').config();

const express = require('express');
const xlsx = require('xlsx');
const path = require('path');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const app = express();
app.set('trust proxy', 1);

const COOKIE_NAME = 'auth_session';
const JWT_EXPIRES = '7d';

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pingSupabase(maxAttempts = 3) {
  const supabase = getSupabase();
  if (!supabase) {
    return { ok: false, configured: false, error: 'Supabase not configured' };
  }

  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const { error } = await supabase.from('categories').select('id').limit(1);
    if (!error) {
      return { ok: true, configured: true, attempt };
    }
    lastError = error.message;
    if (attempt < maxAttempts) {
      await sleep(5000 * attempt);
    }
  }

  return { ok: false, configured: true, error: lastError, attempt: maxAttempts };
}

const GEMINI_SYSTEM = `You help write B2B outreach emails for a small business email tool.
Rules:
- Use Markdown for formatting (**bold**, *italic*, lists, short headings if needed).
- Include personalization placeholders where natural: {{name}}, {{company}}, {{email}}.
- Keep emails concise, professional, and easy to scan.
- Do not invent fake statistics or claims.
- Return only valid JSON matching the requested schema.`;

const GEMINI_MODELS = [
  process.env.GEMINI_MODEL,
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.0-flash'
].filter(Boolean);

async function callGeminiOnce(model, userPrompt, jsonSchemaHint) {
  const apiKey = process.env.GEMINI_API_KEY;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: GEMINI_SYSTEM }] },
      contents: [{ parts: [{ text: userPrompt + '\n\n' + jsonSchemaHint }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        maxOutputTokens: 2048,
        temperature: 0.7
      }
    })
  });

  const raw = await response.text();
  if (!response.ok) {
    let message = raw.slice(0, 400);
    try {
      const parsed = JSON.parse(raw);
      message = parsed.error?.message || message;
    } catch {
      /* keep slice */
    }
    const err = new Error(message || `Gemini API error ${response.status}`);
    err.status = response.status;
    err.model = model;
    throw err;
  }

  const data = JSON.parse(raw);
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Empty response from Gemini');
  return JSON.parse(text);
}

async function callGemini(userPrompt, jsonSchemaHint) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    const err = new Error('GEMINI_API_KEY not configured');
    err.code = 'AI_NOT_CONFIGURED';
    throw err;
  }

  const models = [...new Set(GEMINI_MODELS)];
  let lastError = null;

  for (const model of models) {
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        return await callGeminiOnce(model, userPrompt, jsonSchemaHint);
      } catch (err) {
        lastError = err;
        const retryable = err.status === 429 || err.status === 503;
        if (retryable && attempt < 4) {
          await sleep(2000 * Math.pow(2, attempt - 1));
          continue;
        }
        if (err.status === 429 || err.status === 503 || err.status === 404 || err.status === 400) {
          break;
        }
        throw err;
      }
    }
  }

  throw lastError || new Error('Gemini request failed');
}

function toneLabel(tone) {
  const map = {
    professional: 'professional and polished',
    friendly: 'warm and approachable',
    direct: 'short and direct'
  };
  return map[tone] || map.professional;
}

function languageLabel(language) {
  if (language === 'es') return 'Spanish';
  if (language === 'en') return 'English';
  return 'the same language as the brief';
}

function sanitizeFilename(name) {
  const base = String(name || '').split(/[/\\]/).pop();
  return base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180) || 'file';
}

function isValidEmail(email) {
  return /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(String(email || '').trim());
}

function parseContactsFromBuffer(filename, buffer) {
  let contacts = [];
  if (filename.endsWith('.txt')) {
    const text = buffer.toString('utf8');
    const lines = text.split(/[\n,;]/);
    contacts = lines
      .map((line) => {
        const parts = line.split(/[,;]/).map((p) => p.trim());
        return { email: parts[0] || '', name: parts[1] || '', company: parts[2] || '' };
      })
      .filter((c) => isValidEmail(c.email));
  } else if (filename.match(/\.xlsx?$/)) {
    const workbook = xlsx.read(buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = xlsx.utils.sheet_to_json(sheet);
    contacts = data
      .map((row) => ({
        email: row.email || row.Email || row.EMAIL || Object.values(row)[0] || '',
        name: row.name || row.Name || row.NAME || row.nombre || row.Nombre || '',
        company: row.company || row.Company || row.COMPANY || row.empresa || row.Empresa || ''
      }))
      .filter((c) => isValidEmail(c.email));
  }
  return contacts;
}

function parseManualContacts(input) {
  const lines = String(input || '')
    .split(/\r?\n/)
    .map((line, idx) => ({ raw: line.trim(), line: idx + 1 }))
    .filter((item) => item.raw);
  const errors = [];
  const contacts = [];
  const seen = new Set();
  let header = null;
  let duplicateCount = 0;

  function splitLine(raw) {
    return raw
      .split(/[,\t;]/)
      .map((part) => part.trim())
      .filter(Boolean);
  }

  if (lines.length) {
    const first = splitLine(lines[0].raw).map((part) => part.toLowerCase());
    const hasHeader =
      first.includes('email') &&
      (first.includes('name') || first.includes('nombre')) &&
      (first.includes('company') || first.includes('empresa'));
    if (hasHeader) {
      header = {
        email: first.indexOf('email'),
        name: first.includes('name') ? first.indexOf('name') : first.indexOf('nombre'),
        company: first.includes('company') ? first.indexOf('company') : first.indexOf('empresa')
      };
      lines.shift();
    }
  }

  for (const item of lines) {
    const parts = splitLine(item.raw);
    if (parts.length < 3) {
      errors.push(`Line ${item.line}: use name, company, email`);
      continue;
    }

    let email = '';
    let name = '';
    let company = '';

    if (header) {
      email = parts[header.email] || '';
      name = parts[header.name] || '';
      company = parts[header.company] || '';
    } else {
      const emailIndex = parts.findIndex((part) => isValidEmail(part));
      if (emailIndex === -1) {
        errors.push(`Line ${item.line}: invalid email`);
        continue;
      }
      email = parts[emailIndex];
      if (emailIndex === 0) {
        name = parts[1] || '';
        company = parts.slice(2).join(' ');
      } else if (emailIndex === 1) {
        name = parts[0] || '';
        company = parts.slice(2).join(' ');
      } else {
        name = parts[0] || '';
        company = parts[1] || '';
      }
    }

    email = email.toLowerCase().trim();
    name = String(name || '').trim();
    company = String(company || '').trim();

    if (!name || !company || !email) {
      errors.push(`Line ${item.line}: name, company, and email are required`);
      continue;
    }
    if (!isValidEmail(email)) {
      errors.push(`Line ${item.line}: invalid email`);
      continue;
    }
    if (seen.has(email)) {
      duplicateCount++;
      continue;
    }
    seen.add(email);
    contacts.push({ email, name, company });
  }

  return { contacts, errors, duplicateCount };
}

function parseManualContactObjects(input) {
  const rows = Array.isArray(input) ? input : input ? [input] : [];
  const errors = [];
  const contacts = [];
  const seen = new Set();
  let duplicateCount = 0;

  rows.forEach((row, idx) => {
    const line = idx + 1;
    const name = String((row && row.name) || '').trim();
    const company = String((row && row.company) || '').trim();
    const email = String((row && row.email) || '').toLowerCase().trim();

    if (!name || !company || !email) {
      errors.push(`Contact ${line}: name, company, and email are required`);
      return;
    }
    if (!isValidEmail(email)) {
      errors.push(`Contact ${line}: invalid email`);
      return;
    }
    if (seen.has(email)) {
      duplicateCount++;
      return;
    }
    seen.add(email);
    contacts.push({ name, company, email });
  });

  return { contacts, errors, duplicateCount };
}

function normalizeSgMessageId(id) {
  if (!id) return null;
  return String(id).replace(/[<>]/g, '').trim();
}

function normalizeWebhookPayload(raw) {
  if (raw == null) return [];
  if (typeof raw === 'string') {
    try {
      return normalizeWebhookPayload(JSON.parse(raw));
    } catch {
      return [];
    }
  }
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'object') {
    if (Array.isArray(raw.events)) return raw.events;
    if (typeof raw.events === 'string') {
      try {
        return normalizeWebhookPayload(JSON.parse(raw.events));
      } catch {
        return [];
      }
    }
    if (raw.event != null || raw.sg_message_id != null || raw.email != null) {
      return [raw];
    }
  }
  return [];
}

function webhookCampaignId(evt) {
  const ua =
    evt.unique_args && typeof evt.unique_args === 'object' && !Array.isArray(evt.unique_args)
      ? evt.unique_args
      : {};
  return String(evt.campaign_id || evt['campaign_id'] || ua.campaign_id || '').trim();
}

function readSgMessageIdFromResponse(response) {
  const h =
    response.headers.get('x-message-id') ||
    response.headers.get('X-Message-Id');
  return normalizeSgMessageId(h);
}

async function findEmailEventForWebhook(supabase, evt) {
  const sgId = normalizeSgMessageId(evt.sg_message_id);
  const recipient = (evt.email || evt.recipient_email || '').toLowerCase().trim();
  const campaignId = webhookCampaignId(evt);

  if (sgId) {
    const { data, error } = await supabase
      .from('email_events')
      .select('id,status,opened_at,delivered_at,sg_message_id')
      .eq('sg_message_id', sgId)
      .maybeSingle();
    if (error) throw error;
    if (data) return data;
  }

  if (campaignId && recipient) {
    const { data, error } = await supabase
      .from('email_events')
      .select('id,status,opened_at,delivered_at,sg_message_id')
      .eq('campaign_id', campaignId)
      .eq('recipient_email', recipient)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (data) return data;
  }

  return null;
}

function authMiddleware(req, res, next) {
  const token = req.cookies[COOKIE_NAME];
  if (!token) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  if (!process.env.SESSION_SECRET) {
    return res.status(500).json({ success: false, error: 'Server session not configured' });
  }
  try {
    req.auth = jwt.verify(token, process.env.SESSION_SECRET);
    next();
  } catch {
    return res.status(401).json({ success: false, error: 'Invalid session' });
  }
}

async function ensureCategory(supabase, { categoryId, categoryName }) {
  if (categoryId) {
    const { data, error } = await supabase.from('categories').select('id,name').eq('id', categoryId).maybeSingle();
    if (error) throw error;
    if (data) return data;
  }
  const name = categoryName && String(categoryName).trim();
  if (name) {
    const { data: existing } = await supabase.from('categories').select('id,name').eq('name', name).maybeSingle();
    if (existing) return existing;
    const { data, error } = await supabase.from('categories').insert({ name }).select('id,name').single();
    if (error) throw error;
    return data;
  }
  return null;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/api/login', (req, res) => {
  const password = (req.body && req.body.password) || '';
  if (!process.env.APP_LOGIN_PASSWORD || !process.env.SESSION_SECRET) {
    return res.status(500).json({
      success: false,
      error: 'APP_LOGIN_PASSWORD and SESSION_SECRET must be set on the server.'
    });
  }
  if (password !== process.env.APP_LOGIN_PASSWORD) {
    return res.status(401).json({ success: false, error: 'Invalid password' });
  }
  const token = jwt.sign({ sub: 'client' }, process.env.SESSION_SECRET, { expiresIn: JWT_EXPIRES });
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/'
  });
  res.json({ success: true });
});

app.get('/api/session', (req, res) => {
  const token = req.cookies[COOKIE_NAME];
  if (!token || !process.env.SESSION_SECRET) {
    return res.json({ authenticated: false });
  }
  try {
    jwt.verify(token, process.env.SESSION_SECRET);
    return res.json({ authenticated: true });
  } catch {
    return res.json({ authenticated: false });
  }
});

app.get('/api/sendgrid/events', (req, res) => {
  res
    .status(200)
    .type('text/plain')
    .send(
      'SendGrid Event Webhook endpoint: configure POST to this URL. Browser GET is only for a quick check; SendGrid uses HTTP POST with a JSON body.'
    );
});

app.get('/api/keepalive', async (req, res) => {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.authorization;
    if (auth !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
  }

  const result = await pingSupabase();
  res.status(result.ok ? 200 : 503).json({
    ...result,
    timestamp: new Date().toISOString()
  });
});

app.post('/api/sendgrid/events', async (req, res) => {
  try {
    const supabase = getSupabase();
    const events = normalizeWebhookPayload(req.body);
    if (!supabase) {
      return res.json({ success: true, received: events.length, persisted: false });
    }

    for (const evt of events) {
      await supabase.from('sendgrid_events').insert({ payload: evt });

      const row = await findEmailEventForWebhook(supabase, evt);
      if (!row) continue;

      const sgId = normalizeSgMessageId(evt.sg_message_id);
      const ts = evt.timestamp ? new Date(Number(evt.timestamp) * 1000).toISOString() : new Date().toISOString();
      const patch = { updated_at: new Date().toISOString() };

      if (sgId && !row.sg_message_id) {
        patch.sg_message_id = sgId;
      }

      const type = String(evt.event || '').toLowerCase();
      if (type === 'delivered') {
        patch.delivered_at = ts;
        if (row.status !== 'opened') patch.status = 'delivered';
      } else if (type === 'open') {
        patch.opened_at = ts;
        patch.status = 'opened';
      } else if (type === 'processed') {
        if (!['delivered', 'opened', 'sent'].includes(row.status)) patch.status = 'processed';
      } else if (type === 'bounce' || type === 'dropped' || type === 'deferred') {
        patch.status = type;
        patch.last_error = evt.reason || evt.type || evt.response || null;
      } else if (type === 'click') {
        if (row.status !== 'opened') patch.status = 'click';
      }

      if (Object.keys(patch).length > 1) {
        await supabase.from('email_events').update(patch).eq('id', row.id);
      }
    }

    return res.json({ success: true, received: events.length });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

const api = express.Router();
api.use(authMiddleware);

api.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME, {
    path: '/',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax'
  });
  res.json({ success: true });
});

api.get('/status', async (req, res) => {
  const hasConfig = !!(process.env.SENDGRID_API_KEY && process.env.FROM_EMAIL);
  const dbPing = await pingSupabase(2);
  res.json({
    connected: hasConfig,
    email: hasConfig ? process.env.FROM_EMAIL : null,
    database: dbPing.ok,
    databaseConfigured: dbPing.configured,
    databaseError: dbPing.ok ? null : dbPing.error || null,
    ai: !!process.env.GEMINI_API_KEY
  });
});

api.post('/ai/compose', async (req, res) => {
  try {
    const { action, brief, tone, language, subject, body } = req.body || {};
    const validActions = ['draft', 'subjects', 'improve'];
    if (!validActions.includes(action)) {
      return res.status(400).json({ success: false, error: 'Invalid action' });
    }

    const briefText = String(brief || '').trim();
    const toneText = toneLabel(tone);
    const langText = languageLabel(language);

    if (action === 'draft' && !briefText) {
      return res.status(400).json({ success: false, error: 'Describe what the email should say.' });
    }
    if (action === 'improve' && !String(body || '').trim()) {
      return res.status(400).json({ success: false, error: 'Write a message first to improve it.' });
    }

    if (action === 'draft') {
      const result = await callGemini(
        `Write a complete B2B outreach email.
Brief: ${briefText}
Tone: ${toneText}
Language: ${langText}`,
        'Return JSON: {"subject":"string","body":"string"}'
      );
      return res.json({ success: true, subject: result.subject || '', body: result.body || '' });
    }

    if (action === 'subjects') {
      const context = [
        briefText ? `Brief: ${briefText}` : '',
        String(body || '').trim() ? `Current message:\n${String(body).trim()}` : '',
        `Tone: ${toneText}`,
        `Language: ${langText}`
      ]
        .filter(Boolean)
        .join('\n');

      if (!context.trim()) {
        return res.status(400).json({ success: false, error: 'Add a brief or message to suggest subjects.' });
      }

      const result = await callGemini(
        `Suggest 5 compelling email subject lines for this B2B outreach.\n${context}`,
        'Return JSON: {"subjects":["string","string","string","string","string"]}'
      );
      const subjects = Array.isArray(result.subjects) ? result.subjects.filter(Boolean).slice(0, 5) : [];
      return res.json({ success: true, subjects });
    }

    const result = await callGemini(
      `Improve this B2B outreach email. Keep placeholders {{name}}, {{company}}, {{email}} if present.
Tone: ${toneText}
Language: ${langText}
Current subject: ${String(subject || '').trim() || '(none)'}
Current message:
${String(body).trim()}`,
      'Return JSON: {"subject":"string","body":"string"}'
    );
    return res.json({ success: true, subject: result.subject || subject || '', body: result.body || '' });
  } catch (err) {
    if (err.code === 'AI_NOT_CONFIGURED') {
      return res.status(503).json({
        success: false,
        error: 'AI not configured. Add GEMINI_API_KEY in Vercel environment variables.'
      });
    }
    if (err.status === 429) {
      return res.status(429).json({
        success: false,
        error:
          'Gemini quota exceeded. Create a new API key at aistudio.google.com/apikey, verify it has free-tier quota, and set GEMINI_API_KEY in Vercel. Details: ' +
          (err.message || 'rate limit')
      });
    }
    if (err.status === 503) {
      return res.status(503).json({
        success: false,
        error:
          'Gemini is under high demand right now. Wait 30 seconds and try again — the app already retried automatically. Details: ' +
          (err.message || 'service unavailable')
      });
    }
    if (err.status === 400 || err.status === 403 || err.status === 404) {
      return res.status(502).json({
        success: false,
        error: 'Gemini API rejected the request. Check your API key and model. Details: ' + (err.message || 'invalid request')
      });
    }
    return res.status(500).json({ success: false, error: err.message });
  }
});

api.post('/configure', (req, res) => {
  const hasConfig = !!(process.env.SENDGRID_API_KEY && process.env.FROM_EMAIL);
  res.json({ success: hasConfig, fromEmail: process.env.FROM_EMAIL || null });
});

api.post('/disconnect', (req, res) => {
  res.json({ success: true });
});

api.get('/categories', async (req, res) => {
  try {
    const supabase = getSupabase();
    if (!supabase) return res.json({ success: true, categories: [] });
    const { data, error } = await supabase.from('categories').select('id,name,created_at').order('name');
    if (error) throw error;
    res.json({ success: true, categories: data || [] });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

api.post('/categories', async (req, res) => {
  try {
    const supabase = getSupabase();
    if (!supabase) return res.status(503).json({ success: false, error: 'Database not configured' });
    const name = String((req.body && req.body.name) || '').trim();
    if (!name) return res.status(400).json({ success: false, error: 'Name required' });
    const { data: existing } = await supabase.from('categories').select('id,name').eq('name', name).maybeSingle();
    if (existing) return res.json({ success: true, category: existing });
    const { data, error } = await supabase.from('categories').insert({ name }).select('id,name').single();
    if (error) throw error;
    res.json({ success: true, category: data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

api.get('/contact-files', async (req, res) => {
  try {
    const supabase = getSupabase();
    if (!supabase) return res.json({ success: true, files: [] });
    const categoryId = req.query.categoryId;
    let q = supabase
      .from('contact_files')
      .select('id,original_filename,created_at,category_id')
      .order('created_at', { ascending: false })
      .limit(100);
    if (categoryId) q = q.eq('category_id', categoryId);
    const { data, error } = await q;
    if (error) throw error;
    res.json({ success: true, files: data || [] });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

api.delete('/contact-files/:id', async (req, res) => {
  try {
    const supabase = getSupabase();
    if (!supabase) return res.status(503).json({ success: false, error: 'Database not configured' });

    const { id } = req.params;
    const { data: fileRow, error: findErr } = await supabase
      .from('contact_files')
      .select('id,storage_path,original_filename')
      .eq('id', id)
      .maybeSingle();
    if (findErr) throw findErr;
    if (!fileRow) return res.status(404).json({ success: false, error: 'File not found' });

    const bucket = process.env.SUPABASE_STORAGE_BUCKET;
    if (bucket && fileRow.storage_path && !fileRow.storage_path.includes('/manual_')) {
      const { error: storageErr } = await supabase.storage.from(bucket).remove([fileRow.storage_path]);
      if (storageErr) {
        return res.status(500).json({ success: false, error: storageErr.message });
      }
    }

    const { error: delErr } = await supabase.from('contact_files').delete().eq('id', id);
    if (delErr) throw delErr;

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

api.patch('/categories/:id', async (req, res) => {
  try {
    const supabase = getSupabase();
    if (!supabase) return res.status(503).json({ success: false, error: 'Database not configured' });
    const name = String((req.body && req.body.name) || '').trim();
    if (!name) return res.status(400).json({ success: false, error: 'Name required' });
    const { id } = req.params;
    const { data: taken } = await supabase.from('categories').select('id').eq('name', name).neq('id', id).maybeSingle();
    if (taken) {
      return res.status(400).json({ success: false, error: 'A category with this name already exists' });
    }
    const { data, error } = await supabase.from('categories').update({ name }).eq('id', id).select('id,name').single();
    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, error: 'Category not found' });
    res.json({ success: true, category: data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

api.delete('/categories/:id', async (req, res) => {
  try {
    const supabase = getSupabase();
    if (!supabase) return res.status(503).json({ success: false, error: 'Database not configured' });

    const { id } = req.params;
    const { data: category, error: catErr } = await supabase.from('categories').select('id,name').eq('id', id).maybeSingle();
    if (catErr) throw catErr;
    if (!category) return res.status(404).json({ success: false, error: 'Category not found' });

    const { data: files, error: filesErr } = await supabase
      .from('contact_files')
      .select('id,storage_path')
      .eq('category_id', id);
    if (filesErr) throw filesErr;

    const bucket = process.env.SUPABASE_STORAGE_BUCKET;
    const storagePaths = (files || [])
      .map((file) => file.storage_path)
      .filter((storagePath) => storagePath && !storagePath.includes('/manual_'));
    if (bucket && storagePaths.length) {
      const { error: storageErr } = await supabase.storage.from(bucket).remove(storagePaths);
      if (storageErr) {
        return res.status(500).json({ success: false, error: storageErr.message });
      }
    }

    const fileIds = (files || []).map((file) => file.id);
    if (fileIds.length) {
      const { error: fileDelErr } = await supabase.from('contact_files').delete().in('id', fileIds);
      if (fileDelErr) throw fileDelErr;
    }

    const { error: catDelErr } = await supabase.from('categories').delete().eq('id', id);
    if (catDelErr) throw catDelErr;

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

api.get('/contacts', async (req, res) => {
  try {
    const supabase = getSupabase();
    if (!supabase) return res.json({ success: true, contacts: [] });
    const categoryId = req.query.categoryId;
    if (!categoryId) {
      return res.status(400).json({ success: false, error: 'categoryId required' });
    }
    const includeSendStatus =
      req.query.includeSendStatus === '1' || req.query.includeSendStatus === 'true';
    const { data, error } = await supabase
      .from('contacts')
      .select('id,email,name,company,contact_file_id,created_at')
      .eq('category_id', categoryId)
      .order('email');
    if (error) throw error;
    const rows = data || [];
    if (!includeSendStatus) {
      return res.json({ success: true, contacts: rows });
    }
    const ids = rows.map((c) => c.id).filter(Boolean);
    if (!ids.length) {
      return res.json({
        success: true,
        contacts: rows.map((c) => ({ ...c, sendLabel: '—', sendStatus: 'none' }))
      });
    }
    const { data: evs, error: evErr } = await supabase
      .from('email_events')
      .select('contact_id,status,updated_at,opened_at')
      .in('contact_id', ids)
      .order('updated_at', { ascending: false });
    if (evErr) throw evErr;
    const latest = {};
    for (const ev of evs || []) {
      if (!ev.contact_id) continue;
      if (!latest[ev.contact_id]) latest[ev.contact_id] = ev;
    }
    const contacts = rows.map((c) => {
      const ev = latest[c.id];
      if (!ev) {
        return { ...c, sendLabel: 'Never sent', sendStatus: 'never' };
      }
      let sendLabel = 'Sent';
      let sendStatus = 'sent';
      if (ev.opened_at) {
        sendLabel = 'Opened';
        sendStatus = 'opened';
      } else if (['failed', 'bounce', 'dropped', 'deferred'].includes(ev.status)) {
        sendLabel = 'Failed';
        sendStatus = 'failed';
      } else if (ev.status === 'sent' || ev.status === 'delivered' || ev.status === 'processed') {
        sendLabel = 'Sent';
        sendStatus = 'sent';
      } else {
        sendLabel = ev.status || 'Sent';
        sendStatus = ev.status || 'sent';
      }
      return {
        ...c,
        sendLabel,
        sendStatus,
        lastEventAt: ev.updated_at,
        openedAt: ev.opened_at || null
      };
    });
    res.json({ success: true, contacts });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

api.get('/campaigns', async (req, res) => {
  try {
    const supabase = getSupabase();
    if (!supabase) return res.json({ success: true, campaigns: [] });
    const limit = Math.min(parseInt(req.query.limit || '40', 10) || 40, 100);
    let q = supabase
      .from('campaigns')
      .select('id,subject,category_id,created_at')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (req.query.categoryId) {
      q = q.eq('category_id', req.query.categoryId);
    }
    const { data: campaigns, error } = await q;
    if (error) throw error;
    const rows = campaigns || [];
    if (!rows.length) {
      return res.json({ success: true, campaigns: [] });
    }
    const ids = rows.map((c) => c.id);
    const { data: evs, error: evErr } = await supabase
      .from('email_events')
      .select('campaign_id,opened_at')
      .in('campaign_id', ids);
    if (evErr) throw evErr;
    const agg = {};
    for (const ev of evs || []) {
      if (!agg[ev.campaign_id]) agg[ev.campaign_id] = { total: 0, opened: 0 };
      agg[ev.campaign_id].total++;
      if (ev.opened_at) agg[ev.campaign_id].opened++;
    }
    const out = rows.map((c) => ({
      ...c,
      totalRecipients: agg[c.id]?.total ?? 0,
      openedCount: agg[c.id]?.opened ?? 0
    }));
    res.json({ success: true, campaigns: out });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

api.delete('/campaigns/:id', async (req, res) => {
  try {
    const supabase = getSupabase();
    if (!supabase) return res.status(503).json({ success: false, error: 'Database not configured' });
    const { id } = req.params;

    const { data: campaign, error: findErr } = await supabase
      .from('campaigns')
      .select('id,subject')
      .eq('id', id)
      .maybeSingle();
    if (findErr) throw findErr;
    if (!campaign) return res.status(404).json({ success: false, error: 'Campaign not found' });

    const { error: delErr } = await supabase.from('campaigns').delete().eq('id', id);
    if (delErr) throw delErr;

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

api.get('/campaigns/:id/status', async (req, res) => {
  try {
    const supabase = getSupabase();
    if (!supabase) return res.status(503).json({ success: false, error: 'Database not configured' });
    const { id } = req.params;
    const { data: campaign, error: cErr } = await supabase.from('campaigns').select('*').eq('id', id).maybeSingle();
    if (cErr) throw cErr;
    if (!campaign) return res.status(404).json({ success: false, error: 'Campaign not found' });
    const { data: events, error: eErr } = await supabase
      .from('email_events')
      .select('recipient_email,status,sg_message_id,delivered_at,opened_at,last_error')
      .eq('campaign_id', id)
      .order('recipient_email');
    if (eErr) throw eErr;
    const opened = (events || []).filter((e) => e.opened_at).length;
    const delivered = (events || []).filter((e) => e.delivered_at).length;
    res.json({ success: true, campaign, events: events || [], summary: { total: events?.length || 0, opened, delivered } });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

api.post('/contacts/manual', async (req, res) => {
  try {
    const body = req.body || {};
    const objectInput =
      body.contacts ||
      body.contact ||
      (body.name || body.company || body.email
        ? { name: body.name, company: body.company, email: body.email }
        : null);
    const parsed = objectInput
      ? parseManualContactObjects(objectInput)
      : parseManualContacts(body.contactsText || body.emails);
    const { contacts } = parsed;
    if (parsed.errors.length) {
      return res.status(400).json({
        success: false,
        error: parsed.errors.slice(0, 5).join('; ')
      });
    }
    if (!contacts.length) {
      return res.status(400).json({ success: false, error: 'Enter at least one complete contact' });
    }

    const supabase = getSupabase();
    if (!supabase) {
      return res.json({ success: true, contacts, persisted: false, skippedExisting: 0, skippedDuplicate: parsed.duplicateCount });
    }

    const category = await ensureCategory(supabase, {
      categoryId: req.body.categoryId,
      categoryName: req.body.categoryName
    });
    if (!category) {
      return res.status(400).json({ success: false, error: 'Select or create a category for these contacts' });
    }

    const emails = contacts.map((c) => c.email);
    const { data: existingRows, error: existingErr } = await supabase
      .from('contacts')
      .select('email')
      .eq('category_id', category.id)
      .in('email', emails);
    if (existingErr) throw existingErr;

    const existing = new Set((existingRows || []).map((row) => String(row.email || '').toLowerCase()));
    const newContacts = contacts.filter((c) => !existing.has(c.email));

    let fileRow = null;
    if (newContacts.length) {
      const { data, error } = await supabase
        .from('contact_files')
        .insert({
          category_id: category.id,
          storage_path: `${category.id}/manual_${Date.now()}.txt`,
          original_filename: `Manual entry ${new Date().toISOString().slice(0, 10)}`
        })
        .select('id,category_id,original_filename,created_at')
        .single();
      if (error) throw error;
      fileRow = data;
    }

    const rowsToInsert = newContacts.map((c) => ({
        category_id: category.id,
        contact_file_id: fileRow.id,
        email: c.email,
        name: c.name || '',
        company: c.company || ''
      }));

    if (rowsToInsert.length) {
      const { error: insErr } = await supabase.from('contacts').insert(rowsToInsert);
      if (insErr) throw insErr;
    }

    const { data: savedContacts, error: fetchErr } = await supabase
      .from('contacts')
      .select('id,email,name,company,contact_file_id')
      .eq('category_id', category.id)
      .in('email', emails)
      .order('email');
    if (fetchErr) throw fetchErr;

    res.json({
      success: true,
      contacts: savedContacts || [],
      category,
      persisted: true,
      added: rowsToInsert.length,
      skippedExisting: existing.size,
      skippedDuplicate: parsed.duplicateCount
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

api.post('/contacts', async (req, res) => {
  try {
    const { content, filename } = req.body;
    if (!content || !filename) {
      return res.status(400).json({ success: false, error: 'content and filename required' });
    }

    const buffer = Buffer.from(content, 'base64');
    const contacts = parseContactsFromBuffer(filename, buffer);

    const supabase = getSupabase();
    if (!supabase) {
      return res.json({ success: true, contacts, persisted: false });
    }

    const category = await ensureCategory(supabase, {
      categoryId: req.body.categoryId,
      categoryName: req.body.categoryName
    });
    if (!category) {
      return res.status(400).json({ success: false, error: 'Select or create a category for this upload' });
    }

    const bucket = process.env.SUPABASE_STORAGE_BUCKET;
    if (!bucket) {
      return res.status(500).json({ success: false, error: 'SUPABASE_STORAGE_BUCKET not set' });
    }

    const safeName = sanitizeFilename(filename);
    const storagePath = `${category.id}/${Date.now()}_${safeName}`;
    const uploadRes = await supabase.storage.from(bucket).upload(storagePath, buffer, {
      contentType: 'application/octet-stream',
      upsert: false
    });
    if (uploadRes.error) {
      return res.status(500).json({ success: false, error: uploadRes.error.message });
    }

    const { data: fileRow, error: fileErr } = await supabase
      .from('contact_files')
      .insert({
        category_id: category.id,
        storage_path: storagePath,
        original_filename: filename
      })
      .select('id,category_id,original_filename,created_at')
      .single();
    if (fileErr) throw fileErr;

    const uniqueRows = [];
    const seen = new Set();
    for (const c of contacts) {
      const key = String(c.email || '').toLowerCase().trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      uniqueRows.push({
        category_id: category.id,
        contact_file_id: fileRow.id,
        email: c.email,
        name: c.name || '',
        company: c.company || ''
      });
    }

    for (const part of chunk(uniqueRows, 200)) {
      const { error: insErr } = await supabase.from('contacts').insert(part);
      if (insErr) throw insErr;
    }

    const { data: savedContacts } = await supabase
      .from('contacts')
      .select('id,email,name,company,contact_file_id')
      .eq('contact_file_id', fileRow.id)
      .order('email');

    res.json({
      success: true,
      contacts: savedContacts && savedContacts.length ? savedContacts : contacts.map((c) => ({ ...c, id: null })),
      category,
      contactFile: fileRow,
      persisted: true
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

api.post('/send', async (req, res) => {
  try {
    const { contacts, subject, body, attachment, categoryId } = req.body;

    if (!process.env.SENDGRID_API_KEY || !process.env.FROM_EMAIL) {
      return res.status(400).json({
        success: false,
        error: 'SendGrid not configured.'
      });
    }

    const contactList = typeof contacts === 'string' ? JSON.parse(contacts) : contacts;
    const validContacts = (Array.isArray(contactList) ? contactList : []).filter((c) =>
      String(c.email || '')
        .trim()
        .includes('@')
    );
    if (!validContacts.length) {
      return res.status(400).json({ success: false, error: 'No valid recipients' });
    }

    const results = [];
    const supabase = getSupabase();

    let campaign = null;
    const campaignRows = [];

    if (supabase) {
      const { data: cRow, error: cErr } = await supabase
        .from('campaigns')
        .insert({
          category_id: categoryId || null,
          subject,
          body
        })
        .select('id,category_id,created_at')
        .single();
      if (cErr) throw cErr;
      campaign = cRow;

      for (const contact of validContacts) {
        const email = String(contact.email || '').trim();
        const recipientEmail = email.toLowerCase();
        campaignRows.push({
          campaign_id: campaign.id,
          contact_id: contact.id || null,
          recipient_email: recipientEmail,
          status: 'queued'
        });
      }

      for (const part of chunk(campaignRows, 200)) {
        const { error: evErr } = await supabase.from('email_events').insert(part);
        if (evErr) throw evErr;
      }
    }

    for (const contact of validContacts) {
      const personalizedBody = body
        .replace(/\{\{email\}\}/gi, contact.email)
        .replace(/\{\{name\}\}/gi, contact.name || '')
        .replace(/\{\{company\}\}/gi, contact.company || '');

      const personalizedSubject = subject
        .replace(/\{\{email\}\}/gi, contact.email)
        .replace(/\{\{name\}\}/gi, contact.name || '')
        .replace(/\{\{company\}\}/gi, contact.company || '');

      const customArgs = {
        recipient_email: String(contact.email || '').toLowerCase().trim()
      };
      if (campaign) customArgs.campaign_id = String(campaign.id);
      if (contact.id) customArgs.contact_id = String(contact.id);

      const msg = {
        personalizations: [
          {
            to: [{ email: contact.email }],
            subject: personalizedSubject,
            custom_args: customArgs
          }
        ],
        from: { email: process.env.FROM_EMAIL },
        subject: personalizedSubject,
        tracking_settings: {
          click_tracking: { enable: true, enable_text: false },
          open_tracking: { enable: true },
          subscription_tracking: { enable: false }
        },
        content: [
          { type: 'text/plain', value: personalizedBody },
          {
            type: 'text/html',
            value: personalizedBody
              .replace(/\n/g, '<br>')
              .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
              .replace(/\*(.*?)\*/g, '<em>$1</em>')
          }
        ]
      };

      if (attachment) {
        msg.attachments = [
          {
            content: attachment.content,
            filename: attachment.filename,
            type: attachment.type || 'application/pdf',
            disposition: 'attachment'
          }
        ];
      }

      try {
        const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(msg)
        });

        const sgMsgId = readSgMessageIdFromResponse(response);

        if (response.ok || response.status === 202) {
          results.push({ email: contact.email, name: contact.name, status: 'sent' });

          if (supabase && campaign) {
            const patch = {
              status: 'sent',
              sg_message_id: sgMsgId,
              updated_at: new Date().toISOString()
            };
            await supabase
              .from('email_events')
              .update(patch)
              .eq('campaign_id', campaign.id)
              .eq('recipient_email', String(contact.email || '').toLowerCase().trim());
          }
        } else {
          const errorText = await response.text();
          results.push({
            email: contact.email,
            name: contact.name,
            status: 'failed',
            error: `Error ${response.status}`
          });

          if (supabase && campaign) {
            await supabase
              .from('email_events')
              .update({
                status: 'failed',
                last_error: errorText.slice(0, 2000),
                updated_at: new Date().toISOString()
              })
              .eq('campaign_id', campaign.id)
              .eq('recipient_email', String(contact.email || '').toLowerCase().trim());
          }
        }
      } catch (err) {
        results.push({ email: contact.email, name: contact.name, status: 'failed', error: err.message });
        if (supabase && campaign) {
          await supabase
            .from('email_events')
            .update({
              status: 'failed',
              last_error: err.message,
              updated_at: new Date().toISOString()
            })
            .eq('campaign_id', campaign.id)
            .eq('recipient_email', String(contact.email || '').toLowerCase().trim());
        }
      }
    }

    res.json({ success: true, results, campaignId: campaign ? campaign.id : null });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.use('/api', api);

if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`Listening on http://localhost:${port}`);
  });
}

module.exports = app;
