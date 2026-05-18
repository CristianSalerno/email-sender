let allContacts = [];
let lastCampaignId = null;
let categories = [];
let pendingFile = null;
let hasDatabase = false;
let campaignsCache = [];

const LAST_CAMPAIGN_STORAGE = 'email-sender:lastCampaignId';

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

function showToast(message, type = 'info') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.className = 'toast ' + type;
  el.classList.remove('hidden');
  clearTimeout(el._t);
  el._t = setTimeout(function () {
    el.classList.add('hidden');
  }, 4200);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getImportMode() {
  const r = document.querySelector('input[name="import-mode"]:checked');
  return r ? r.value : 'existing';
}

function getSelectedCategoryId() {
  const sel = document.getElementById('category-select');
  return sel && sel.value ? sel.value : '';
}

function syncImportModeUI() {
  const mode = getImportMode();
  const ex = document.getElementById('wrap-existing-category');
  const nw = document.getElementById('wrap-new-category');
  if (mode === 'existing') {
    ex.classList.remove('hidden');
    nw.classList.add('hidden');
  } else {
    ex.classList.add('hidden');
    nw.classList.remove('hidden');
  }
}

function clearImportErrors() {
  ['category-select-error', 'new-category-error', 'file-error', 'import-global-error', 'manual-emails-error'].forEach(function (id) {
    const n = document.getElementById(id);
    if (n) {
      n.textContent = '';
      n.classList.add('hidden');
    }
  });
}

function validateImport() {
  clearImportErrors();
  let ok = true;
  const mode = getImportMode();
  if (mode === 'existing') {
    if (!getSelectedCategoryId()) {
      const e = document.getElementById('category-select-error');
      e.textContent = 'Please select a category.';
      e.classList.remove('hidden');
      ok = false;
    }
  } else {
    const name = document.getElementById('new-category-name').value.trim();
    if (!name) {
      const e = document.getElementById('new-category-error');
      e.textContent = 'Enter a name for the new category.';
      e.classList.remove('hidden');
      ok = false;
    }
  }
  if (!pendingFile) {
    const e = document.getElementById('file-error');
    e.textContent = 'Attach an Excel or TXT file with contacts.';
    e.classList.remove('hidden');
    ok = false;
  }
  return ok;
}

function setPendingFile(file) {
  pendingFile = file || null;
  const label = document.getElementById('pending-file-name');
  if (label) {
    label.textContent = file ? 'File: ' + file.name : '';
  }
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
  refreshFilesList();
  if (hasDatabase) {
    await loadCampaignHistory();
    restoreLastCampaignFromStorage();
  }
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
  } catch {
    updateStatus({ connected: false, database: false });
  }
}

function sectionIdsSendgridLocked() {
  return ['compose-section'];
}

function updateStatus(data) {
  const el = document.getElementById('connection-status');
  const connectedBox = document.getElementById('connected-message');
  const dbPill = document.getElementById('db-pill');
  const fromEmailInput = document.getElementById('from-email');
  hasDatabase = !!data.database;

  if (fromEmailInput) {
    fromEmailInput.value = data.email || '';
    fromEmailInput.placeholder = data.email ? '' : 'FROM_EMAIL is not configured';
  }

  if (dbPill) {
    dbPill.textContent = data.database ? 'Database connected' : 'Database not configured';
    dbPill.classList.toggle('pill-ok', !!data.database);
    dbPill.classList.toggle('pill-warn', !data.database);
  }

  const manage = document.getElementById('manage-categories-section');
  if (manage) {
    manage.classList.toggle('hidden', !data.database);
  }

  const campaignSection = document.getElementById('campaign-history-section');
  if (campaignSection) {
    campaignSection.classList.toggle('hidden', !data.database);
  }

  const webhookHint = document.getElementById('webhook-hint');
  const webhookUrl = document.getElementById('webhook-url-display');
  if (webhookHint && webhookUrl) {
    webhookHint.classList.toggle('hidden', !data.database);
    if (data.database) {
      webhookUrl.textContent = window.location.origin + '/api/sendgrid/events';
    }
  }

  if (data.connected) {
    el.className = 'status status-on';
    el.textContent = 'SendGrid ready to send';
    el.classList.remove('hidden');
    connectedBox.classList.remove('hidden');
    document.getElementById('connected-email').textContent = data.email || '';
    sectionIdsSendgridLocked().forEach(function (id) {
      const node = document.getElementById(id);
      if (node) node.classList.remove('disabled');
    });
    document.getElementById('import-section').classList.remove('hidden');
    document.getElementById('import-section').classList.remove('disabled');
  } else {
    el.className = 'status status-off';
    el.textContent =
      'SendGrid is not configured in this environment. Set SENDGRID_API_KEY and FROM_EMAIL in Vercel (or in a local .env). You can still import contacts; sending will not be available.';
    el.classList.remove('hidden');
    connectedBox.classList.add('hidden');
    sectionIdsSendgridLocked().forEach(function (id) {
      const node = document.getElementById(id);
      if (node) node.classList.add('disabled');
    });
    document.getElementById('import-section').classList.remove('hidden');
    document.getElementById('import-section').classList.remove('disabled');
  }
}

document.getElementById('login-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  const errEl = document.getElementById('login-error');
  errEl.classList.add('hidden');
  errEl.textContent = '';
  const password = document.getElementById('login-password').value;
  const res = await api('/api/login', { method: 'POST', body: JSON.stringify({ password }) });
  const data = await res.json().catch(function () {
    return {};
  });
  if (!res.ok || !data.success) {
    errEl.textContent = data.error || 'Sign-in failed.';
    errEl.classList.remove('hidden');
    return;
  }
  document.getElementById('login-password').value = '';
  showApp(true);
  showToast('Signed in', 'success');
  await afterLogin();
});

document.getElementById('logout-btn').addEventListener('click', logout);

async function logout() {
  await api('/api/logout', { method: 'POST', body: JSON.stringify({}) });
  lastCampaignId = null;
  try {
    sessionStorage.removeItem(LAST_CAMPAIGN_STORAGE);
  } catch (_) {}
  allContacts = [];
  pendingFile = null;
  setPendingFile(null);
  showApp(false);
  showToast('Signed out', 'info');
}

document.querySelectorAll('input[name="import-mode"]').forEach(function (radio) {
  radio.addEventListener('change', syncImportModeUI);
});

document.getElementById('disconnect-info-btn').addEventListener('click', function () {
  showToast(
    'SendGrid is configured with environment variables on your host (e.g. Vercel). Nothing is stored in the browser.',
    'info'
  );
});

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
    '<option value="">— Choose a category —</option>' +
    categories
      .map(function (c) {
        return '<option value="' + c.id + '">' + escapeHtml(c.name) + '</option>';
      })
      .join('');
  if (
    current &&
    categories.some(function (c) {
      return c.id === current;
    })
  ) {
    sel.value = current;
  }
  renderCategoriesTable();
}

function renderCategoriesTable() {
  const tbody = document.getElementById('categories-tbody');
  const empty = document.getElementById('categories-empty');
  if (!tbody) return;
  if (!categories.length) {
    tbody.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  tbody.innerHTML = categories
    .map(function (c) {
      return (
        '<tr><td>' +
        escapeHtml(c.name) +
        '</td><td class="col-actions"><button type="button" class="link-btn" data-edit-cat="' +
        escapeHtml(c.id) +
        '">Edit</button> <button type="button" class="link-btn link-danger" data-delete-cat="' +
        escapeHtml(c.id) +
        '" data-cat-name="' +
        escapeHtml(c.name) +
        '">Delete</button></td></tr>'
      );
    })
    .join('');

  tbody.querySelectorAll('[data-edit-cat]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const id = btn.getAttribute('data-edit-cat');
      const cat = categories.find(function (x) {
        return x.id === id;
      });
      if (!cat) return;
      document.getElementById('edit-category-id').value = id;
      document.getElementById('edit-category-name').value = cat.name;
      document.getElementById('edit-category-form-error').classList.add('hidden');
      document.getElementById('edit-category-dialog').showModal();
    });
  });

  tbody.querySelectorAll('[data-delete-cat]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      deleteCategory(btn.getAttribute('data-delete-cat'), btn.getAttribute('data-cat-name') || 'this category');
    });
  });
}

async function deleteCategory(id, name) {
  if (!id) return;
  const ok = window.confirm(
    'Delete "' +
      name +
      '" and all contacts/files in this category? Campaign history will remain but will no longer be linked to this category.'
  );
  if (!ok) return;

  const res = await api('/api/categories/' + encodeURIComponent(id), {
    method: 'DELETE',
    body: JSON.stringify({})
  });
  const data = await res.json().catch(function () {
    return {};
  });

  if (!data.success) {
    showToast(data.error || 'Could not delete category', 'error');
    return;
  }

  const selectedId = getSelectedCategoryId();
  await loadCategories();
  if (selectedId === id) {
    allContacts = [];
    campaignsCache = [];
    document.getElementById('category-select').value = '';
    document.getElementById('files-list').classList.add('hidden');
    document.getElementById('recipients-section').classList.add('hidden');
    document.getElementById('compose-section').classList.add('hidden');
    document.getElementById('campaigns-tbody').innerHTML = '';
    document.getElementById('campaigns-empty').classList.remove('hidden');
    document.getElementById('selected-count').textContent = '0';
    document.getElementById('total-count').textContent = '0';
  }
  showToast('Category deleted', 'success');
}

document.getElementById('edit-category-cancel').addEventListener('click', function () {
  document.getElementById('edit-category-dialog').close();
});

document.getElementById('edit-category-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  const err = document.getElementById('edit-category-form-error');
  err.classList.add('hidden');
  const id = document.getElementById('edit-category-id').value;
  const name = document.getElementById('edit-category-name').value.trim();
  if (!name) {
    err.textContent = 'Name cannot be empty.';
    err.classList.remove('hidden');
    return;
  }
  const res = await api('/api/categories/' + encodeURIComponent(id), {
    method: 'PATCH',
    body: JSON.stringify({ name: name })
  });
  const data = await res.json();
  if (!data.success) {
    err.textContent = data.error || 'Could not save.';
    err.classList.remove('hidden');
    return;
  }
  document.getElementById('edit-category-dialog').close();
  showToast('Category updated', 'success');
  await loadCategories();
});

document.getElementById('category-select').addEventListener('change', handleCategoryChange);

async function handleCategoryChange() {
  const id = getSelectedCategoryId();
  await refreshFilesList();
  if (hasDatabase) {
    await loadCampaignHistory();
  }

  if (!id || !hasDatabase) {
    allContacts = [];
    renderRecipientsTable();
    document.getElementById('recipients-section').classList.toggle('hidden', !id);
    document.getElementById('compose-section').classList.add('hidden');
    document.getElementById('total-count').textContent = '0';
    return;
  }

  const tbody = document.getElementById('recipients-tbody');
  document.getElementById('recipients-section').classList.remove('hidden');
  document.getElementById('compose-section').classList.add('hidden');
  tbody.innerHTML = '<tr><td colspan="5" class="muted">Loading saved contacts and send status…</td></tr>';
  document.getElementById('selected-count').textContent = '0';
  document.getElementById('total-count').textContent = '0';
  await loadContactsFromDatabase(false);
}

document.getElementById('btn-import').addEventListener('click', runImport);
document.getElementById('btn-add-manual-emails').addEventListener('click', addManualEmails);

function runImport() {
  if (!validateImport()) return;
  const file = pendingFile;
  const mode = getImportMode();
  const categoryId = mode === 'existing' ? getSelectedCategoryId() : '';
  const categoryName = mode === 'new' ? document.getElementById('new-category-name').value.trim() : '';

  const info = document.getElementById('file-info');
  info.classList.remove('hidden');
  info.innerHTML = '<div class="muted">Importing…</div>';
  info.classList.remove('hidden');

  const reader = new FileReader();
  reader.onload = async function (ev) {
    const base64 = ev.target.result.split(',')[1];
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
        document.querySelector('input[name="import-mode"][value="existing"]').checked = true;
        syncImportModeUI();
        document.getElementById('new-category-name').value = '';
        await refreshFilesList();
      }

      allContacts = data.contacts.map(function (c) {
        return {
          id: c.id,
          email: c.email,
          name: c.name || '',
          company: c.company || '',
          sendLabel: c.sendLabel || (c.id ? 'Never sent' : '—'),
          sendStatus: c.sendStatus || 'never',
          lastEventAt: c.lastEventAt || null,
          openedAt: c.openedAt || null
        };
      });
      const note = data.persisted ? 'Saved to the database.' : 'In memory only (configure Supabase to persist).';
      info.innerHTML = '<strong>' + allContacts.length + ' contacts</strong> · ' + note;
      renderRecipientsTable();
      document.getElementById('recipients-section').classList.remove('hidden');
      document.getElementById('compose-section').classList.remove('hidden');
      document.getElementById('total-count').textContent = allContacts.length;
      if (data.persisted && getSelectedCategoryId()) {
        await loadContactsFromDatabase(false);
      }
      showToast('Import successful', 'success');
    } else {
      info.classList.add('hidden');
      const g = document.getElementById('import-global-error');
      g.textContent = data.error || 'Import failed.';
      g.classList.remove('hidden');
      showToast(data.error || 'Import failed', 'error');
    }
  };
  reader.readAsDataURL(file);
}

async function addManualEmails() {
  clearImportErrors();
  const name = document.getElementById('manual-name').value.trim();
  const company = document.getElementById('manual-company').value.trim();
  const email = document.getElementById('manual-email').value.trim().toLowerCase();
  const err = document.getElementById('manual-emails-error');
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  if (!name || !company || !email) {
    err.textContent = 'Name, company, and email are required.';
    err.classList.remove('hidden');
    return;
  }
  if (!emailOk) {
    err.textContent = 'Enter a valid email address.';
    err.classList.remove('hidden');
    return;
  }

  const mode = getImportMode();
  const categoryId = mode === 'existing' ? getSelectedCategoryId() : '';
  const categoryName = mode === 'new' ? document.getElementById('new-category-name').value.trim() : '';

  if (hasDatabase && mode === 'existing' && !categoryId) {
    const e = document.getElementById('category-select-error');
    e.textContent = 'Please select a category.';
    e.classList.remove('hidden');
    return;
  }
  if (hasDatabase && mode === 'new' && !categoryName) {
    const e = document.getElementById('new-category-error');
    e.textContent = 'Enter a name for the new category.';
    e.classList.remove('hidden');
    return;
  }

  const btn = document.getElementById('btn-add-manual-emails');
  btn.disabled = true;
  btn.textContent = 'Adding…';

  const res = await api('/api/contacts/manual', {
    method: 'POST',
    body: JSON.stringify({
      contacts: [{ name: name, company: company, email: email }],
      contact: { name: name, company: company, email: email },
      name: name,
      company: company,
      email: email,
      contactsText: name + ', ' + company + ', ' + email,
      categoryId: categoryId || undefined,
      categoryName: categoryName || undefined
    })
  });
  const data = await res.json().catch(function () {
    return {};
  });

  btn.disabled = false;
  btn.textContent = 'Add contacts to category';

  if (res.status === 401) {
    showApp(false);
    return;
  }

  if (!data.success) {
    err.textContent = data.error || 'Could not add emails.';
    err.classList.remove('hidden');
    showToast(data.error || 'Could not add emails', 'error');
    return;
  }

  document.getElementById('manual-name').value = '';
  document.getElementById('manual-company').value = '';
  document.getElementById('manual-email').value = '';
  document.getElementById('manual-name').focus();

  if (data.persisted && data.category && data.category.id) {
    await loadCategories();
    document.getElementById('category-select').value = data.category.id;
    document.querySelector('input[name="import-mode"][value="existing"]').checked = true;
    syncImportModeUI();
    document.getElementById('new-category-name').value = '';
    await refreshFilesList();
    await loadContactsFromDatabase(false);
  } else {
    allContacts = (data.contacts || []).map(function (c) {
      return {
        id: c.id || null,
        email: c.email,
        name: c.name || '',
        company: c.company || '',
        sendLabel: c.id ? 'Never sent' : '—',
        sendStatus: c.id ? 'never' : 'none',
        lastEventAt: null,
        openedAt: null
      };
    });
    renderRecipientsTable();
    document.getElementById('recipients-section').classList.remove('hidden');
    document.getElementById('compose-section').classList.remove('hidden');
    document.getElementById('total-count').textContent = allContacts.length;
  }

  const added = data.added ?? (data.contacts || []).length;
  const skipped = data.skippedExisting || 0;
  const duplicate = data.skippedDuplicate || 0;
  showToast(
    'Added: ' +
      added +
      (skipped ? ' · Already existed: ' + skipped : '') +
      (duplicate ? ' · Duplicated in paste: ' + duplicate : ''),
    'success'
  );
}

document.getElementById('refresh-files-btn').addEventListener('click', refreshFilesList);

async function refreshFilesList() {
  const box = document.getElementById('files-list');
  const id = getSelectedCategoryId();
  if (!id || !hasDatabase) {
    box.classList.add('hidden');
    return;
  }
  const url = '/api/contact-files?categoryId=' + encodeURIComponent(id);
  const res = await api(url);
  const data = await res.json();
  if (!data.success || !data.files || !data.files.length) {
    box.classList.add('hidden');
    return;
  }
  box.classList.remove('hidden');
  box.innerHTML =
    '<strong>Recent uploads in this category</strong><ul>' +
    data.files
      .map(function (f) {
        return (
          '<li class="file-row">' +
          '<span>' +
          escapeHtml(f.original_filename) +
          ' — <span class="muted">' +
          new Date(f.created_at).toLocaleString() +
          '</span></span>' +
          '<button type="button" class="link-btn link-danger" data-delete-file="' +
          escapeHtml(f.id) +
          '" data-file-name="' +
          escapeHtml(f.original_filename) +
          '">Delete</button></li>'
        );
      })
      .join('') +
    '</ul>';

  box.querySelectorAll('[data-delete-file]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      deleteContactFile(btn.getAttribute('data-delete-file'), btn.getAttribute('data-file-name') || 'this file');
    });
  });
}

async function deleteContactFile(id, name) {
  if (!id) return;
  const ok = window.confirm('Delete "' + name + '" and all contacts imported from it?');
  if (!ok) return;

  const res = await api('/api/contact-files/' + encodeURIComponent(id), {
    method: 'DELETE',
    body: JSON.stringify({})
  });
  const data = await res.json().catch(function () {
    return {};
  });

  if (!data.success) {
    showToast(data.error || 'Could not delete file', 'error');
    return;
  }

  showToast('File deleted', 'success');
  await refreshFilesList();
  if (getSelectedCategoryId()) {
    await loadContactsFromDatabase(false);
  }
}

document.getElementById('btn-refresh-recipients').addEventListener('click', function () {
  loadContactsFromDatabase(true);
});

document.getElementById('btn-load-saved-contacts').addEventListener('click', function () {
  loadContactsFromDatabase(true);
});

document.getElementById('refresh-campaigns-btn').addEventListener('click', function () {
  loadCampaignHistory();
});

async function loadContactsFromDatabase(showToastOk) {
  const id = getSelectedCategoryId();
  if (!id) {
    showToast('Select a category in step 1.', 'error');
    return;
  }
  const url = '/api/contacts?categoryId=' + encodeURIComponent(id) + '&includeSendStatus=1';
  const res = await api(url);
  const data = await res.json();
  if (!data.success) {
    showToast(data.error || 'Could not load contacts', 'error');
    return;
  }
  allContacts = (data.contacts || []).map(function (c) {
    return {
      id: c.id,
      email: c.email,
      name: c.name || '',
      company: c.company || '',
      sendLabel: c.sendLabel || '—',
      sendStatus: c.sendStatus || 'none',
      lastEventAt: c.lastEventAt || null,
      openedAt: c.openedAt || null
    };
  });
  if (!allContacts.length) {
    document.getElementById('recipients-section').classList.remove('hidden');
    document.getElementById('compose-section').classList.add('hidden');
    renderRecipientsTable();
    document.getElementById('total-count').textContent = '0';
    if (showToastOk) showToast('No saved contacts in this category.', 'info');
    return;
  }
  renderRecipientsTable();
  document.getElementById('recipients-section').classList.remove('hidden');
  document.getElementById('compose-section').classList.remove('hidden');
  document.getElementById('total-count').textContent = allContacts.length;
  if (showToastOk) showToast('List updated', 'success');
}

function restoreLastCampaignFromStorage() {
  if (!hasDatabase) return;
  try {
    const id = sessionStorage.getItem(LAST_CAMPAIGN_STORAGE);
    if (!id) return;
    lastCampaignId = id;
    document.getElementById('results-section').classList.remove('hidden');
    document.getElementById('tracking-panel').classList.remove('hidden');
    document.getElementById('results-meta').innerHTML =
      '<p>Campaign <code>' + escapeHtml(id) + '</code>. Restored from this browser session.</p>';
    document.getElementById('results').innerHTML =
      '<p class="muted small">Per-recipient lines from the last send are not kept after you leave the page. Use <strong>Sent campaigns</strong> or open tracking below.</p>';
    refreshCampaignTracking();
  } catch (_) {}
}

async function loadCampaignHistory() {
  if (!hasDatabase) return;
  const tbody = document.getElementById('campaigns-tbody');
  if (!tbody) return;
  let url = '/api/campaigns?limit=50';
  const res = await api(url);
  const data = await res.json();
  if (!data.success) {
    showToast(data.error || 'Could not load campaigns', 'error');
    return;
  }
  campaignsCache = data.campaigns || [];
  renderCampaignHistory();
}

function renderCampaignHistory() {
  const tbody = document.getElementById('campaigns-tbody');
  const empty = document.getElementById('campaigns-empty');
  if (!tbody) return;
  if (!campaignsCache.length) {
    tbody.innerHTML = '';
    if (empty) empty.classList.remove('hidden');
    return;
  }
  if (empty) empty.classList.add('hidden');
  tbody.innerHTML = campaignsCache
    .map(function (c) {
      const when = c.created_at ? formatCampaignSentDay(c.created_at) : '—';
      const category = categories.find(function (cat) {
        return cat.id === c.category_id;
      });
      const categoryName = category ? category.name : c.category_id ? 'Deleted category' : '—';
      const raw = c.subject || '';
      const subj = raw.length
        ? escapeHtml(raw.length > 80 ? raw.slice(0, 80) + '…' : raw)
        : '—';
      const shortId = c.id ? String(c.id).slice(0, 8) : '';
      return (
        '<tr class="campaign-row" data-campaign-id="' +
        escapeHtml(c.id) +
        '">' +
        '<td>' +
        subj +
        (shortId ? '<br><span class="muted small">#' + escapeHtml(shortId) + '</span>' : '') +
        '</td><td>' +
        escapeHtml(categoryName) +
        '</td><td>' +
        when +
        '</td><td>' +
        (c.totalRecipients ?? 0) +
        '</td><td>' +
        (c.openedCount ?? 0) +
        '</td></tr>'
      );
    })
    .join('');

  tbody.querySelectorAll('.campaign-row').forEach(function (row) {
    row.addEventListener('click', function () {
      const id = row.getAttribute('data-campaign-id');
      if (!id) return;
      lastCampaignId = id;
      try {
        sessionStorage.setItem(LAST_CAMPAIGN_STORAGE, id);
      } catch (_) {}
      document.getElementById('results-section').classList.remove('hidden');
      document.getElementById('tracking-panel').classList.remove('hidden');
      document.getElementById('results-meta').innerHTML =
        '<p>Campaign <code>' + escapeHtml(id) + '</code>.</p>';
      document.getElementById('results').innerHTML =
        '<p class="muted small">Open tracking for this campaign is below.</p>';
      refreshCampaignTracking();
    });
  });
}

function formatCampaignSentDay(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return (
    date.toLocaleDateString(undefined, {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    }) +
    '<br><span class="muted small">' +
    date.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit'
    }) +
    '</span>'
  );
}

function badgeClass(st) {
  if (st === 'opened') return 'badge-opened';
  if (st === 'failed' || st === 'bounce' || st === 'dropped') return 'badge-failed';
  if (st === 'sent' || st === 'delivered' || st === 'processed') return 'badge-sent';
  return 'badge-never';
}

function formatSendCell(c) {
  const lbl = c.sendLabel || '—';
  let extra = '';
  if (c.openedAt) {
    extra = '<br><span class="muted small">Opened ' + new Date(c.openedAt).toLocaleString() + '</span>';
  } else if (c.lastEventAt && c.sendStatus !== 'never' && c.sendStatus !== 'none') {
    extra = '<br><span class="muted small">' + new Date(c.lastEventAt).toLocaleString() + '</span>';
  }
  return '<span class="badge ' + badgeClass(c.sendStatus) + '">' + escapeHtml(lbl) + '</span>' + extra;
}

function renderRecipientsTable() {
  const tbody = document.getElementById('recipients-tbody');
  if (!allContacts.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="muted">No contacts saved in this category yet.</td></tr>';
    updateCount();
    return;
  }
  tbody.innerHTML = allContacts
    .map(function (contact, i) {
      return (
        '<tr><td class="col-check"><input type="checkbox" data-idx="' +
        i +
        '" checked></td><td>' +
        escapeHtml(contact.email) +
        '</td><td>' +
        escapeHtml(contact.name || '—') +
        '</td><td>' +
        escapeHtml(contact.company || '—') +
        '</td><td>' +
        formatSendCell(contact) +
        '</td></tr>'
      );
    })
    .join('');

  tbody.querySelectorAll('input[type="checkbox"]').forEach(function (cb) {
    cb.addEventListener('change', updateCount);
  });
  updateCount();
}

function updateCount() {
  const checked = document.querySelectorAll('#recipients-tbody input:checked').length;
  document.getElementById('selected-count').textContent = checked;
}

document.getElementById('btn-select-all').addEventListener('click', function () {
  document.querySelectorAll('#recipients-tbody input[type="checkbox"]').forEach(function (cb) {
    cb.checked = true;
  });
  updateCount();
});

document.getElementById('btn-select-none').addEventListener('click', function () {
  document.querySelectorAll('#recipients-tbody input[type="checkbox"]').forEach(function (cb) {
    cb.checked = false;
  });
  updateCount();
});

const uploadArea = document.getElementById('upload-area');
const fileInput = document.getElementById('contacts-file');

uploadArea.addEventListener('click', function () {
  fileInput.click();
});
uploadArea.addEventListener('keydown', function (e) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fileInput.click();
  }
});
uploadArea.addEventListener('dragover', function (e) {
  e.preventDefault();
  uploadArea.style.borderColor = 'var(--accent)';
});
uploadArea.addEventListener('dragleave', function () {
  uploadArea.style.borderColor = '';
});
uploadArea.addEventListener('drop', function (e) {
  e.preventDefault();
  uploadArea.style.borderColor = '';
  if (e.dataTransfer.files.length) {
    setPendingFile(e.dataTransfer.files[0]);
    clearImportErrors();
  }
});

fileInput.addEventListener('change', function (e) {
  if (e.target.files.length) {
    setPendingFile(e.target.files[0]);
    clearImportErrors();
  }
});

function clearComposeErrors() {
  ['subject-error', 'body-error', 'attachment-error'].forEach(function (id) {
    const n = document.getElementById(id);
    if (n) {
      n.textContent = '';
      n.classList.add('hidden');
    }
  });
}

document.getElementById('email-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  clearComposeErrors();
  const subject = document.getElementById('subject').value.trim();
  const body = document.getElementById('body').value.trim();
  let bad = false;
  if (!subject) {
    document.getElementById('subject-error').textContent = 'Subject is required.';
    document.getElementById('subject-error').classList.remove('hidden');
    bad = true;
  }
  if (!body) {
    document.getElementById('body-error').textContent = 'Message is required.';
    document.getElementById('body-error').classList.remove('hidden');
    bad = true;
  }
  if (bad) return;

  const selected = [];
  document.querySelectorAll('#recipients-tbody input:checked').forEach(function (cb) {
    selected.push(allContacts[parseInt(cb.getAttribute('data-idx'), 10)]);
  });
  if (!selected.length) {
    showToast('Select at least one recipient.', 'error');
    return;
  }

  const categoryId = getSelectedCategoryId() || undefined;
  const attachmentInput = document.getElementById('attachment');
  document.getElementById('attachment-error').classList.add('hidden');

  if (attachmentInput.files.length > 0) {
    const file = attachmentInput.files[0];
    if (file.size > 4 * 1024 * 1024) {
      document.getElementById('attachment-error').textContent = 'File must be 4 MB or smaller.';
      document.getElementById('attachment-error').classList.remove('hidden');
      return;
    }
    const reader = new FileReader();
    reader.onload = async function (evt) {
      const base64 = evt.target.result.split(',')[1];
      await sendEmails(
        {
          subject: subject,
          body: document.getElementById('body').value,
          attachment: { content: base64, filename: file.name, type: file.type }
        },
        selected,
        categoryId
      );
    };
    reader.readAsDataURL(file);
  } else {
    await sendEmails({ subject: subject, body: document.getElementById('body').value }, selected, categoryId);
  }
});

async function sendEmails(body, contacts, categoryId) {
  const btn = document.getElementById('btn-send');
  btn.textContent = 'Sending…';
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

  btn.textContent = 'Send emails';
  btn.disabled = false;

  if (res.status === 401) {
    showApp(false);
    return;
  }

  if (data.success) {
    lastCampaignId = data.campaignId || null;
    try {
      if (lastCampaignId) {
        sessionStorage.setItem(LAST_CAMPAIGN_STORAGE, lastCampaignId);
      }
    } catch (_) {}
    const sent = data.results.filter(function (r) {
      return r.status === 'sent';
    }).length;
    const failed = data.results.filter(function (r) {
      return r.status === 'failed';
    }).length;

    document.getElementById('results-meta').innerHTML =
      lastCampaignId && data.results.some(function (r) {
        return r.status === 'sent';
      })
        ? '<p>Campaign <code>' + escapeHtml(lastCampaignId) + '</code>. Opens are reported via the SendGrid Event Webhook.</p>'
        : '';

    document.getElementById('results').innerHTML = data.results
      .map(function (r) {
        return (
          '<div class="result-item ' +
          r.status +
          '">' +
          (r.name ? escapeHtml(r.name) + ' · ' : '') +
          escapeHtml(r.email) +
          ': ' +
          (r.status === 'sent' ? 'Sent' : escapeHtml(r.error || 'Error')) +
          '</div>'
        );
      })
      .join('');

    document.getElementById('results-section').classList.remove('hidden');
    const tp = document.getElementById('tracking-panel');
    if (lastCampaignId) {
      tp.classList.remove('hidden');
      await refreshCampaignTracking();
    } else {
      tp.classList.add('hidden');
    }

    showToast('Sent: ' + sent + (failed ? ' · Failed: ' + failed : ''), failed ? 'error' : 'success');

    if (hasDatabase && getSelectedCategoryId()) {
      await loadContactsFromDatabase(false);
    }
    if (hasDatabase) {
      await loadCampaignHistory();
    }
  } else {
    showToast(data.error || 'Send failed', 'error');
  }
}

document.getElementById('refresh-tracking-btn').addEventListener('click', refreshCampaignTracking);

async function refreshCampaignTracking() {
  if (!lastCampaignId) return;
  const res = await api('/api/campaigns/' + encodeURIComponent(lastCampaignId) + '/status');
  const data = await res.json();
  if (!data.success) {
    document.getElementById('tracking-summary').textContent = data.error || 'No data.';
    return;
  }
  const s = data.summary || {};
  document.getElementById('tracking-summary').textContent =
    'Total: ' + s.total + ' · Delivered (event): ' + s.delivered + ' · Opened: ' + s.opened;
  document.getElementById('tracking-details').innerHTML = (data.events || [])
    .map(function (ev) {
      return (
        '<div class="tracking-row"><strong>' +
        escapeHtml(ev.recipient_email) +
        '</strong> — ' +
        escapeHtml(ev.status || '') +
        (ev.opened_at ? ' · Opened ' + new Date(ev.opened_at).toLocaleString() : '') +
        '</div>'
      );
    })
    .join('');
}

syncImportModeUI();
initSession();
