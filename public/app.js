let allContacts = [];
let selectedAttachment = null;
let lastCampaignId = null;
let categories = [];

function api(path, options = {}) {
  return fetch(path, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    ...options
  });
}

function getSelectedCategoryId() {
  const sel = document.getElementById('category-select');
  return sel && sel.value ? sel.value : '';
}

function getNewCategoryName() {
  const v = document.getElementById('new-category-name').value.trim();
  return v || '';
}

async function initSession() {
  const res = await api('/api/session');
  const data = await res.json();
  if (data.authenticated) {
    showApp(true);
    await afterLogin();
  } else {
    showApp(false);
  }
}

function showApp(authenticated) {
  document.getElementById('login-section').classList.toggle('hidden', authenticated);
  document.getElementById('app-sections').classList.toggle('hidden', !authenticated);
}

async function afterLogin() {
  await Promise.all([checkStatus(), loadCategories()]);
  await refreshFilesList();
}

async function checkStatus() {
  try {
    const res = await api('/api/status');
    if (res.status === 401) {
      showApp(false);
      return;
    }
    const data = await res.json();
    updateStatus(data);
  } catch (err) {
    updateStatus({ connected: false, database: false });
  }
}

function updateStatus(data) {
  const el = document.getElementById('connection-status');
  const formContainer = document.getElementById('config-form-container');
  const connectedMsg = document.getElementById('connected-message');
  const sections = ['category-section', 'upload-section', 'emails-section', 'compose-section'];
  const dbPill = document.getElementById('db-pill');

  if (dbPill) {
    dbPill.textContent = data.database ? 'Database: connected' : 'Database: not configured';
    dbPill.classList.toggle('pill-ok', !!data.database);
    dbPill.classList.toggle('pill-warn', !data.database);
  }

  if (data.connected) {
    el.className = 'status connected';
    el.textContent = '✅ Connected to SendGrid';
    formContainer.classList.add('hidden');
    connectedMsg.classList.remove('hidden');
    connectedMsg.innerHTML = `<p>📧 Sender: <strong>${data.email}</strong></p>`;
    document.getElementById('from-email').value = data.email || '';
    sections.forEach((id) => {
      const node = document.getElementById(id);
      if (node) node.classList.remove('disabled');
    });
  } else {
    el.className = 'status disconnected';
    el.textContent = '❌ SendGrid not configured';
    formContainer.classList.add('hidden');
    connectedMsg.classList.remove('hidden');
    connectedMsg.innerHTML = `<p>Set <code>SENDGRID_API_KEY</code> and <code>FROM_EMAIL</code> in your host (e.g. Vercel) environment.</p>`;
    sections.forEach((id) => {
      const node = document.getElementById(id);
      if (node) node.classList.add('disabled');
    });
  }
}

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('login-error');
  errEl.classList.add('hidden');
  errEl.textContent = '';
  const password = document.getElementById('login-password').value;
  const res = await api('/api/login', { method: 'POST', body: JSON.stringify({ password }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    errEl.textContent = data.error || 'Login failed';
    errEl.classList.remove('hidden');
    return;
  }
  document.getElementById('login-password').value = '';
  showApp(true);
  await afterLogin();
});

document.getElementById('logout-btn').addEventListener('click', logout);

async function logout() {
  await api('/api/logout', { method: 'POST', body: JSON.stringify({}) });
  lastCampaignId = null;
  allContacts = [];
  showApp(false);
}

async function loadCategories() {
  const res = await api('/api/categories');
  if (res.status === 401) {
    showApp(false);
    return;
  }
  const data = await res.json();
  categories = data.categories || [];
  const sel = document.getElementById('category-select');
  const current = sel.value;
  sel.innerHTML =
    '<option value="">— Select category —</option>' +
    categories
      .map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`)
      .join('');
  if (current && categories.some((c) => c.id === current)) {
    sel.value = current;
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

document.getElementById('save-category-btn').addEventListener('click', async () => {
  const name = getNewCategoryName();
  if (!name) {
    alert('Enter a name for the new category.');
    return;
  }
  const res = await api('/api/categories', { method: 'POST', body: JSON.stringify({ name }) });
  const data = await res.json();
  if (!data.success) {
    alert(data.error || 'Could not save category');
    return;
  }
  document.getElementById('new-category-name').value = '';
  await loadCategories();
  if (data.category && data.category.id) {
    document.getElementById('category-select').value = data.category.id;
  }
});

document.getElementById('load-db-contacts-btn').addEventListener('click', loadContactsFromDatabase);

async function loadContactsFromDatabase() {
  const id = getSelectedCategoryId();
  if (!id) {
    alert('Select a category first.');
    return;
  }
  const res = await api(`/api/contacts?categoryId=${encodeURIComponent(id)}`);
  const data = await res.json();
  if (!data.success) {
    alert(data.error || 'Could not load contacts');
    return;
  }
  allContacts = (data.contacts || []).map((c) => ({
    id: c.id,
    email: c.email,
    name: c.name,
    company: c.company
  }));
  if (!allContacts.length) {
    document.getElementById('file-info').classList.remove('hidden');
    document.getElementById('file-info').innerHTML = '<div class="muted">No saved contacts for this category yet.</div>';
    document.getElementById('emails-section').classList.add('hidden');
    document.getElementById('compose-section').classList.add('hidden');
    return;
  }
  document.getElementById('file-info').innerHTML = `<div class="muted">Loaded ${allContacts.length} contacts from database.</div>`;
  document.getElementById('file-info').classList.remove('hidden');
  renderContacts();
  document.getElementById('emails-section').classList.remove('hidden');
  document.getElementById('compose-section').classList.remove('hidden');
  document.getElementById('total-count').textContent = allContacts.length;
}

document.getElementById('refresh-files-btn').addEventListener('click', refreshFilesList);

async function refreshFilesList() {
  const box = document.getElementById('files-list');
  const id = getSelectedCategoryId();
  const url = id ? `/api/contact-files?categoryId=${encodeURIComponent(id)}` : '/api/contact-files';
  const res = await api(url);
  const data = await res.json();
  if (!data.success || !data.files || !data.files.length) {
    box.classList.add('hidden');
    box.innerHTML = '';
    return;
  }
  box.classList.remove('hidden');
  box.innerHTML =
    '<strong>Recent uploads</strong><ul>' +
    data.files
      .map(
        (f) =>
          `<li>${escapeHtml(f.original_filename)} — <span class="muted">${new Date(f.created_at).toLocaleString()}</span></li>`
      )
      .join('') +
    '</ul>';
}

document.getElementById('category-select').addEventListener('change', () => {
  refreshFilesList();
});

initSession();

const uploadArea = document.getElementById('upload-area');
const fileInput = document.getElementById('contacts-file');

uploadArea.addEventListener('click', () => fileInput.click());
uploadArea.addEventListener('dragover', (e) => {
  e.preventDefault();
  uploadArea.style.borderColor = '#667eea';
});
uploadArea.addEventListener('dragleave', () => {
  uploadArea.style.borderColor = '#ccc';
});
uploadArea.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadArea.style.borderColor = '#ccc';
  if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
});

fileInput.addEventListener('change', (e) => {
  if (e.target.files.length) handleFile(e.target.files[0]);
});

async function handleFile(file) {
  const categoryId = getSelectedCategoryId();
  const categoryName = getNewCategoryName();
  if (!categoryId && !categoryName) {
    alert('Select a category or type a new category name before uploading.');
    return;
  }

  document.getElementById('file-info').innerHTML = '<div class="loading">Loading...</div>';
  document.getElementById('file-info').classList.remove('hidden');

  const reader = new FileReader();
  reader.onload = async function (e) {
    const base64 = e.target.result.split(',')[1];

    const res = await api('/api/contacts', {
      method: 'POST',
      body: JSON.stringify({
        content: base64,
        filename: file.name,
        categoryId: categoryId || undefined,
        categoryName: categoryName || undefined
      })
    });
    const data = await res.json();

    if (res.status === 401) {
      showApp(false);
      return;
    }

    if (data.success) {
      if (data.persisted && data.category && data.category.id) {
        await loadCategories();
        document.getElementById('category-select').value = data.category.id;
        document.getElementById('new-category-name').value = '';
        await refreshFilesList();
      }

      allContacts = data.contacts.map((c) => ({
        id: c.id,
        email: c.email,
        name: c.name || '',
        company: c.company || ''
      }));
      const tag = data.persisted ? 'Saved to database' : 'Parsed locally (configure Supabase to save uploads)';
      document.getElementById('file-info').innerHTML = `✅ ${allContacts.length} contacts — ${tag}`;
      renderContacts();
      document.getElementById('emails-section').classList.remove('hidden');
      document.getElementById('compose-section').classList.remove('hidden');
      document.getElementById('total-count').textContent = allContacts.length;
    } else {
      alert('Error: ' + data.error);
      document.getElementById('file-info').classList.add('hidden');
    }
  };
  reader.readAsDataURL(file);
}

function renderContacts() {
  const list = document.getElementById('emails-list');
  list.innerHTML = allContacts
    .map(
      (contact, i) => `
    <div class="email-item">
      <input type="checkbox" id="contact-${i}" value="${i}" checked onchange="updateCount()">
      <div class="contact-info">
        <strong>${escapeHtml(contact.email)}</strong>
        ${contact.name ? `<span class="contact-name">${escapeHtml(contact.name)}</span>` : ''}
        ${contact.company ? `<span class="contact-company">${escapeHtml(contact.company)}</span>` : ''}
      </div>
    </div>
  `
    )
    .join('');
  updateCount();
}

function updateCount() {
  const checked = document.querySelectorAll('#emails-list input:checked').length;
  document.getElementById('selected-count').textContent = checked;
}

function selectAll() {
  document.querySelectorAll('#emails-list input').forEach((cb) => (cb.checked = true));
  updateCount();
}

function deselectAll() {
  document.querySelectorAll('#emails-list input').forEach((cb) => (cb.checked = false));
  updateCount();
}

document.getElementById('email-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const selected = Array.from(document.querySelectorAll('#emails-list input:checked')).map(
    (cb) => allContacts[parseInt(cb.value, 10)]
  );

  if (selected.length === 0) return alert('Select at least one recipient');

  const categoryId = getSelectedCategoryId() || undefined;

  const attachmentInput = document.getElementById('attachment');
  if (attachmentInput.files.length > 0) {
    const file = attachmentInput.files[0];
    if (file.size > 4 * 1024 * 1024) {
      return alert('El archivo es muy grande. Máximo 4MB.');
    }
    const reader = new FileReader();
    reader.onload = async function (evt) {
      const base64 = evt.target.result.split(',')[1];
      const attachment = {
        content: base64,
        filename: file.name,
        type: file.type
      };
      await sendEmails(
        {
          subject: document.getElementById('subject').value,
          body: document.getElementById('body').value,
          attachment
        },
        selected,
        categoryId
      );
    };
    reader.readAsDataURL(file);
  } else {
    await sendEmails(
      {
        subject: document.getElementById('subject').value,
        body: document.getElementById('body').value
      },
      selected,
      categoryId
    );
  }
});

async function sendEmails(body, contacts, categoryId) {
  const btn = document.querySelector('.btn-large');
  btn.textContent = 'Sending...';
  btn.disabled = true;

  const payload = {
    contacts: JSON.stringify(contacts),
    subject: body.subject,
    body: body.body
  };
  if (categoryId) payload.categoryId = categoryId;
  if (body.attachment) payload.attachment = body.attachment;

  const res = await api('/api/send', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  const data = await res.json();

  btn.textContent = '📤 Send Emails';
  btn.disabled = false;

  if (res.status === 401) {
    showApp(false);
    return;
  }

  if (data.success) {
    lastCampaignId = data.campaignId || null;
    const resultsDiv = document.getElementById('results');
    const sent = data.results.filter((r) => r.status === 'sent').length;
    const failed = data.results.filter((r) => r.status === 'failed').length;

    document.getElementById('results-meta').innerHTML =
      lastCampaignId && data.results.some((r) => r.status === 'sent')
        ? `<p>Campaign id: <code>${escapeHtml(lastCampaignId)}</code>. Opens are updated via the SendGrid Event Webhook.</p>`
        : '';

    resultsDiv.innerHTML = data.results
      .map(
        (r) => `
      <div class="result-item ${r.status}">
        ${r.name ? escapeHtml(r.name) + ' - ' : ''}${escapeHtml(r.email)}: ${
          r.status === 'sent' ? '✓ Sent' : '✗ Error: ' + escapeHtml(r.error || '')
        }
      </div>
    `
      )
      .join('');

    document.getElementById('results-section').classList.remove('hidden');
    const tp = document.getElementById('tracking-panel');
    if (lastCampaignId) {
      tp.classList.remove('hidden');
      await refreshCampaignTracking();
    } else {
      tp.classList.add('hidden');
    }

    alert(`✅ Sent: ${sent}, Failed: ${failed}`);
  } else {
    alert('Error: ' + data.error);
  }
}

document.getElementById('refresh-tracking-btn').addEventListener('click', refreshCampaignTracking);

async function refreshCampaignTracking() {
  if (!lastCampaignId) return;
  const res = await api(`/api/campaigns/${encodeURIComponent(lastCampaignId)}/status`);
  const data = await res.json();
  if (!data.success) {
    document.getElementById('tracking-summary').textContent = data.error || 'Could not load tracking.';
    return;
  }
  const s = data.summary || {};
  document.getElementById('tracking-summary').textContent = `Total: ${s.total}, delivered (events): ${s.delivered}, opened: ${s.opened}`;
  const lines = (data.events || []).map((ev) => {
    const opened = ev.opened_at ? `opened ${new Date(ev.opened_at).toLocaleString()}` : 'not opened yet';
    const st = ev.status || '';
    return `<div class="tracking-row"><strong>${escapeHtml(ev.recipient_email)}</strong> — ${escapeHtml(
      st
    )} — ${opened}</div>`;
  });
  document.getElementById('tracking-details').innerHTML = lines.join('') || '<p class="muted">No rows yet.</p>';
}

async function disconnect() {
  alert(
    'SendGrid is bound to server environment variables (e.g. on Vercel). To stop sending from this deployment, remove or rotate SENDGRID_API_KEY and FROM_EMAIL there.'
  );
}
