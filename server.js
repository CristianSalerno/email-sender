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

function sanitizeFilename(name) {
  const base = String(name || '').split(/[/\\]/).pop();
  return base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180) || 'file';
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
      .filter((c) => c.email.includes('@'));
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
      .filter((c) => c.email.includes('@'));
  }
  return contacts;
}

function normalizeSgMessageId(id) {
  if (!id) return null;
  return String(id).replace(/[<>]/g, '').trim();
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

app.post('/api/sendgrid/events', async (req, res) => {
  try {
    const supabase = getSupabase();
    const raw = req.body;
    const events = Array.isArray(raw) ? raw : raw ? [raw] : [];
    if (!supabase) {
      return res.json({ success: true, received: events.length, persisted: false });
    }

    for (const evt of events) {
      await supabase.from('sendgrid_events').insert({ payload: evt });

      const sgId = normalizeSgMessageId(evt.sg_message_id);
      const campaignId = evt.campaign_id || (evt.unique_args && evt.unique_args.campaign_id);
      const recipient = (evt.email || '').toLowerCase().trim();

      let q = supabase.from('email_events').select('id,status,opened_at,delivered_at,sg_message_id');
      if (sgId) {
        q = q.eq('sg_message_id', sgId);
      } else if (campaignId && recipient) {
        q = q.eq('campaign_id', campaignId).eq('recipient_email', recipient);
      } else {
        continue;
      }

      const { data: row, error: findErr } = await q.maybeSingle();
      if (findErr || !row) continue;

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

api.get('/status', (req, res) => {
  const hasConfig = !!(process.env.SENDGRID_API_KEY && process.env.FROM_EMAIL);
  res.json({
    connected: hasConfig,
    email: hasConfig ? process.env.FROM_EMAIL : null,
    database: !!getSupabase()
  });
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

api.get('/contacts', async (req, res) => {
  try {
    const supabase = getSupabase();
    if (!supabase) return res.json({ success: true, contacts: [] });
    const categoryId = req.query.categoryId;
    if (!categoryId) {
      return res.status(400).json({ success: false, error: 'categoryId required' });
    }
    const { data, error } = await supabase
      .from('contacts')
      .select('id,email,name,company,contact_file_id,created_at')
      .eq('category_id', categoryId)
      .order('email');
    if (error) throw error;
    res.json({ success: true, contacts: data || [] });
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

      const msg = {
        personalizations: [
          {
            to: [{ email: contact.email }],
            subject: personalizedSubject,
            custom_args: {
              campaign_id: campaign ? String(campaign.id) : '',
              contact_id: contact.id ? String(contact.id) : '',
              recipient_email: String(contact.email || '').toLowerCase().trim()
            }
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

        const sgMsgId = normalizeSgMessageId(response.headers.get('x-message-id'));

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
