let allContacts = [];
let lastCampaignId = null;
let categories = [];
let pendingFile = null;
let hasDatabase = false;
let hasAi = false;
let campaignsCache = [];

const LAST_CAMPAIGN_STORAGE = 'email-sender:lastCampaignId';

let activeAppTab = 'send';
let sendWizardStep = 1;
let audienceLoading = false;

const AI_ACTION_LABELS = {
  draft: { loading: 'Generating email…', button: 'Generate email' },
  subjects: { loading: 'Suggesting subjects…', button: 'Suggest subjects' },
  improve: { loading: 'Improving message…', button: 'Improve message' }
};

function getSendCategoryId() {
  const sel = document.getElementById('send-category-select');
  return sel && sel.value ? sel.value : '';
}

function goToSendStep(step) {
  if (step === 2) {
    const checked = document.querySelectorAll('#recipients-tbody input:checked').length;
    if (!checked) {
      showToast('Select at least one recipient.', 'error');
      return;
    }
  }
  sendWizardStep = step;
  const audiencePanel = document.getElementById('send-step-audience');
  const messagePanel = document.getElementById('send-step-message');
  if (audiencePanel) audiencePanel.classList.toggle('hidden', step !== 1);
  if (messagePanel) messagePanel.classList.toggle('hidden', step !== 2);
  document.querySelectorAll('.wizard-step').forEach(function (btn) {
    const stepNum = parseInt(btn.getAttribute('data-send-step'), 10);
    btn.classList.toggle('active', stepNum === step);
    btn.classList.toggle('done', stepNum < step);
  });
  updateAudienceSummary();
  if (step === 2) updateCount();
}

function updateAudienceSummary() {
  const categoryId = getSendCategoryId();
  const cat = categories.find(function (c) {
    return c.id === categoryId;
  });
  const name = cat ? cat.name : '—';
  const nameEl = document.getElementById('audience-category-name');
  const chipCat = document.getElementById('chip-category');
  if (nameEl) nameEl.textContent = name;
  if (chipCat) chipCat.textContent = name;
}

function syncAudienceUI() {
  if (audienceLoading) return;

  const categoryId = getSendCategoryId();
  const hasContacts = allContacts.length > 0;
  const empty = document.getElementById('audience-empty');
  const content = document.getElementById('audience-content');

  if (!categoryId) {
    if (empty) {
      empty.textContent = 'Select a category to load contacts, or import a new list first.';
      empty.classList.remove('hidden');
    }
    if (content) content.classList.add('hidden');
    return;
  }

  if (!hasContacts) {
    if (empty) {
      empty.textContent =
        'No contacts in this category yet. Import a list or add contacts in the Lists tab.';
      empty.classList.remove('hidden');
    }
    if (content) content.classList.add('hidden');
    return;
  }

  if (empty) empty.classList.add('hidden');
  if (content) content.classList.remove('hidden');
  updateAudienceSummary();
  updateCount();
}

function setAudienceLoading(loading) {
  audienceLoading = loading;
  const loadingEl = document.getElementById('audience-loading');
  const empty = document.getElementById('audience-empty');
  const content = document.getElementById('audience-content');
  const select = document.getElementById('send-category-select');
  const reloadBtn = document.getElementById('btn-load-saved-contacts');
  const refreshBtn = document.getElementById('btn-refresh-recipients');

  if (loadingEl) loadingEl.classList.toggle('hidden', !loading);
  if (select) select.disabled = loading;
  if (reloadBtn) {
    reloadBtn.disabled = loading;
    if (!reloadBtn.dataset.defaultLabel) reloadBtn.dataset.defaultLabel = reloadBtn.textContent;
    reloadBtn.textContent = loading ? 'Loading…' : reloadBtn.dataset.defaultLabel;
  }
  if (refreshBtn) {
    refreshBtn.disabled = loading;
    if (!refreshBtn.dataset.defaultLabel) refreshBtn.dataset.defaultLabel = refreshBtn.textContent;
    refreshBtn.textContent = loading ? 'Loading…' : refreshBtn.dataset.defaultLabel;
  }

  if (loading) {
    if (empty) empty.classList.add('hidden');
    if (content) content.classList.add('hidden');
    return;
  }

  syncAudienceUI();
}

function syncCategorySelects(value) {
  const listsSel = document.getElementById('category-select');
  const sendSel = document.getElementById('send-category-select');
  if (listsSel && value) listsSel.value = value;
  if (sendSel && value) sendSel.value = value;
}

function switchAppTab(tabId, options) {
  if (tabId === 'campaigns' && !hasDatabase) {
    showToast('Campaigns require a connected database.', 'info');
    return;
  }
  activeAppTab = tabId;
  const panelId = 'tab-panel-' + tabId;
  document.querySelectorAll('.app-nav-btn').forEach(function (btn) {
    const isActive = btn.getAttribute('data-app-tab') === tabId;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
  document.querySelectorAll('.tab-panel').forEach(function (panel) {
    const isActive = panel.id === panelId;
    panel.classList.toggle('hidden', !isActive);
    panel.classList.toggle('active', isActive);
  });
  if (tabId === 'campaigns') {
    if (!options || !options.keepDetail) {
      hideCampaignDetail();
    }
    loadCampaignHistory();
  }
}

function syncSendTabUI() {
  syncAudienceUI();
}

function formatOpenRate(opened, total) {
  if (!total) return '—';
  return Math.round((opened / total) * 100) + '%';
}

function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

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
  document.body.classList.toggle('auth-layout', !authenticated);
  document.body.classList.toggle('app-layout', authenticated);
  if (authenticated) {
    syncAudienceUI();
    goToSendStep(1);
  }
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
  hasAi = !!data.ai;

  const aiPanel = document.getElementById('ai-panel');
  const aiNotConfigured = document.getElementById('ai-not-configured');
  if (aiPanel) aiPanel.classList.toggle('hidden', !hasAi);
  if (aiNotConfigured) aiNotConfigured.classList.toggle('hidden', hasAi);

  if (fromEmailInput) {
    fromEmailInput.value = data.email || '';
    fromEmailInput.placeholder = data.email ? '' : 'FROM_EMAIL is not configured';
  }

  if (dbPill) {
    if (data.database) {
      dbPill.textContent = 'Database connected';
      dbPill.classList.add('pill-ok');
      dbPill.classList.remove('pill-warn');
    } else if (data.databaseConfigured && data.databaseError) {
      dbPill.textContent = 'Database waking up — retry in 1–2 min';
      dbPill.classList.remove('pill-ok');
      dbPill.classList.add('pill-warn');
    } else {
      dbPill.textContent = 'Database not configured';
      dbPill.classList.remove('pill-ok');
      dbPill.classList.add('pill-warn');
    }
  }

  const manage = document.getElementById('manage-categories-section');
  if (manage) {
    manage.classList.toggle('hidden', !data.database);
  }

  const navCampaigns = document.getElementById('nav-campaigns');
  if (navCampaigns) {
    navCampaigns.classList.toggle('hidden', !data.database);
  }
  if (!data.database && activeAppTab === 'campaigns') {
    switchAppTab('send');
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
  const options =
    '<option value="">— Choose a category —</option>' +
    categories
      .map(function (c) {
        return '<option value="' + c.id + '">' + escapeHtml(c.name) + '</option>';
      })
      .join('');

  const listsSel = document.getElementById('category-select');
  const sendSel = document.getElementById('send-category-select');
  const listsCurrent = listsSel ? listsSel.value : '';
  const sendCurrent = sendSel ? sendSel.value : '';

  if (listsSel) listsSel.innerHTML = options;
  if (sendSel) sendSel.innerHTML = options;

  if (
    listsCurrent &&
    categories.some(function (c) {
      return c.id === listsCurrent;
    }) &&
    listsSel
  ) {
    listsSel.value = listsCurrent;
  }
  if (
    sendCurrent &&
    categories.some(function (c) {
      return c.id === sendCurrent;
    }) &&
    sendSel
  ) {
    sendSel.value = sendCurrent;
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
  const sendSelectedId = getSendCategoryId();
  await loadCategories();
  if (selectedId === id || sendSelectedId === id) {
    allContacts = [];
    campaignsCache = [];
    if (document.getElementById('category-select')) document.getElementById('category-select').value = '';
    if (document.getElementById('send-category-select')) document.getElementById('send-category-select').value = '';
    document.getElementById('files-list').classList.add('hidden');
    document.getElementById('selected-count').textContent = '0';
    document.getElementById('total-count').textContent = '0';
    syncAudienceUI();
    goToSendStep(1);
    document.getElementById('campaigns-tbody').innerHTML = '';
    document.getElementById('campaigns-empty').classList.remove('hidden');
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
document.getElementById('send-category-select').addEventListener('change', handleSendCategoryChange);

async function handleCategoryChange() {
  const id = getSelectedCategoryId();
  const sendSel = document.getElementById('send-category-select');
  if (sendSel && id) sendSel.value = id;
  await refreshFilesList();
}

async function handleSendCategoryChange() {
  const id = getSendCategoryId();
  const listsSel = document.getElementById('category-select');
  if (listsSel && id) listsSel.value = id;
  await refreshFilesList();

  if (!id || !hasDatabase) {
    allContacts = [];
    renderRecipientsTable();
    document.getElementById('selected-count').textContent = '0';
    document.getElementById('total-count').textContent = '0';
    syncAudienceUI();
    goToSendStep(1);
    return;
  }

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
        syncCategorySelects(data.category.id);
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
      const importedCategoryId = data.category?.id || getSelectedCategoryId();
      if (importedCategoryId) syncCategorySelects(importedCategoryId);
      renderRecipientsTable();
      document.getElementById('total-count').textContent = allContacts.length;
      syncAudienceUI();
      if (data.persisted && getSendCategoryId()) {
        await loadContactsFromDatabase(false);
      }
      switchAppTab('send');
      goToSendStep(1);
      showToast('Import successful — choose recipients and continue', 'success');
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
    syncCategorySelects(data.category.id);
    document.querySelector('input[name="import-mode"][value="existing"]').checked = true;
    syncImportModeUI();
    document.getElementById('new-category-name').value = '';
    await refreshFilesList();
    await loadContactsFromDatabase(false);
    switchAppTab('send');
    goToSendStep(1);
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
    syncAudienceUI();
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
  const id = getSendCategoryId();
  if (!id) {
    showToast('Select a category first.', 'error');
    return;
  }

  setAudienceLoading(true);
  try {
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
    renderRecipientsTable();
    document.getElementById('total-count').textContent = allContacts.length;
    if (!allContacts.length && showToastOk) {
      showToast('No saved contacts in this category.', 'info');
    } else if (showToastOk) {
      showToast('List updated', 'success');
    }
  } finally {
    setAudienceLoading(false);
  }
}

function restoreLastCampaignFromStorage() {
  if (!hasDatabase) return;
  try {
    const id = sessionStorage.getItem(LAST_CAMPAIGN_STORAGE);
    if (!id) return;
    lastCampaignId = id;
    switchAppTab('campaigns', { keepDetail: true });
    showCampaignDetail(id);
  } catch (_) {}
}

function updateCampaignStats() {
  const totalCampaigns = campaignsCache.length;
  let totalRecipients = 0;
  let totalOpens = 0;
  campaignsCache.forEach(function (c) {
    totalRecipients += c.totalRecipients ?? 0;
    totalOpens += c.openedCount ?? 0;
  });
  const statCampaigns = document.getElementById('stat-total-campaigns');
  const statRecipients = document.getElementById('stat-total-recipients');
  const statOpens = document.getElementById('stat-total-opens');
  const statRate = document.getElementById('stat-open-rate');
  if (statCampaigns) statCampaigns.textContent = String(totalCampaigns);
  if (statRecipients) statRecipients.textContent = String(totalRecipients);
  if (statOpens) statOpens.textContent = String(totalOpens);
  if (statRate) statRate.textContent = formatOpenRate(totalOpens, totalRecipients);
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
  updateCampaignStats();
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
      const recipients = c.totalRecipients ?? 0;
      const opened = c.openedCount ?? 0;
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
        '</td><td class="col-num">' +
        recipients +
        '</td><td class="col-num">' +
        opened +
        '</td><td class="col-num">' +
        formatOpenRate(opened, recipients) +
        '</td><td class="col-actions">' +
        '<button type="button" class="link-btn" data-view-campaign="' +
        escapeHtml(c.id) +
        '">View</button> ' +
        '<button type="button" class="link-btn link-danger" data-delete-campaign="' +
        escapeHtml(c.id) +
        '" data-campaign-subject="' +
        escapeHtml(raw || 'Untitled campaign') +
        '">Delete</button>' +
        '</td></tr>'
      );
    })
    .join('');

  tbody.querySelectorAll('[data-delete-campaign]').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      deleteCampaign(
        btn.getAttribute('data-delete-campaign'),
        btn.getAttribute('data-campaign-subject') || 'this campaign'
      );
    });
  });

  tbody.querySelectorAll('[data-view-campaign]').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      const id = btn.getAttribute('data-view-campaign');
      if (id) showCampaignDetail(id);
    });
  });

  tbody.querySelectorAll('.campaign-row').forEach(function (row) {
    row.addEventListener('click', function () {
      const id = row.getAttribute('data-campaign-id');
      if (id) showCampaignDetail(id);
    });
  });
}

function showCampaignDetail(campaignId) {
  if (!campaignId) return;
  const campaign = campaignsCache.find(function (c) {
    return c.id === campaignId;
  });
  lastCampaignId = campaignId;
  try {
    sessionStorage.setItem(LAST_CAMPAIGN_STORAGE, campaignId);
  } catch (_) {}

  const listView = document.getElementById('campaigns-list-view');
  const detailView = document.getElementById('campaign-detail-view');
  if (listView) listView.classList.add('hidden');
  if (detailView) detailView.classList.remove('hidden');

  const subjectEl = document.getElementById('campaign-detail-subject');
  const metaEl = document.getElementById('campaign-detail-meta');
  const rawSubject = campaign?.subject || 'Untitled campaign';
  if (subjectEl) subjectEl.textContent = rawSubject;

  if (metaEl) {
    const category = categories.find(function (cat) {
      return cat.id === campaign?.category_id;
    });
    const categoryName = category ? category.name : campaign?.category_id ? 'Deleted category' : '—';
    const sentAt = campaign?.created_at ? formatDateTime(campaign.created_at) : '—';
    metaEl.textContent = categoryName + ' · Sent ' + sentAt;
  }

  refreshCampaignTracking();
}

function hideCampaignDetail() {
  const listView = document.getElementById('campaigns-list-view');
  const detailView = document.getElementById('campaign-detail-view');
  if (listView) listView.classList.remove('hidden');
  if (detailView) detailView.classList.add('hidden');
}

async function deleteCampaign(id, subject) {
  if (!id) return;
  const ok = window.confirm('Delete campaign "' + subject + '" and its tracking events?');
  if (!ok) return;

  const res = await api('/api/campaigns/' + encodeURIComponent(id), {
    method: 'DELETE',
    body: JSON.stringify({})
  });
  const data = await res.json().catch(function () {
    return {};
  });

  if (!data.success) {
    showToast(data.error || 'Could not delete campaign', 'error');
    return;
  }

  if (lastCampaignId === id) {
    lastCampaignId = null;
    try {
      sessionStorage.removeItem(LAST_CAMPAIGN_STORAGE);
    } catch (_) {}
    hideCampaignDetail();
    document.getElementById('results-meta').innerHTML = '';
    document.getElementById('results').innerHTML = '';
    document.getElementById('results-section').classList.add('hidden');
  }

  campaignsCache = campaignsCache.filter(function (campaign) {
    return campaign.id !== id;
  });
  renderCampaignHistory();
  showToast('Campaign deleted', 'success');
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
  const total = allContacts.length;
  const selectedEl = document.getElementById('selected-count');
  const totalEl = document.getElementById('total-count');
  if (selectedEl) selectedEl.textContent = checked;
  if (totalEl) totalEl.textContent = total;
  const chip = document.getElementById('chip-recipients');
  if (chip) {
    chip.textContent = checked + (checked === 1 ? ' recipient' : ' recipients');
  }
  const continueBtn = document.getElementById('btn-continue-to-message');
  if (continueBtn) continueBtn.disabled = checked === 0;
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
  ['subject-error', 'body-error', 'attachment-error', 'ai-error'].forEach(function (id) {
    const n = document.getElementById(id);
    if (n) {
      n.textContent = '';
      n.classList.add('hidden');
    }
  });
}

function setAiLoading(loading, action) {
  const panel = document.getElementById('ai-panel');
  const loadingEl = document.getElementById('ai-loading');
  const loadingText = document.getElementById('ai-loading-text');
  const labels = action ? AI_ACTION_LABELS[action] : null;

  if (panel) panel.classList.toggle('ai-panel-busy', loading);
  if (loadingEl) loadingEl.classList.toggle('hidden', !loading);
  if (loadingText && labels) loadingText.textContent = labels.loading;

  ['ai-draft-btn', 'ai-subjects-btn', 'ai-improve-btn'].forEach(function (id) {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.disabled = loading;
    const key = id.replace('ai-', '').replace('-btn', '');
    const label = AI_ACTION_LABELS[key];
    if (label && loading && action === key) {
      btn.textContent = label.loading;
    } else if (label) {
      btn.textContent = label.button;
    }
  });
}

function getAiOptions() {
  return {
    brief: (document.getElementById('ai-brief') && document.getElementById('ai-brief').value.trim()) || '',
    tone: (document.getElementById('ai-tone') && document.getElementById('ai-tone').value) || 'professional',
    language: (document.getElementById('ai-language') && document.getElementById('ai-language').value) || 'auto'
  };
}

async function runAiCompose(action) {
  const errEl = document.getElementById('ai-error');
  const subjectsEl = document.getElementById('ai-subjects-list');
  if (errEl) {
    errEl.textContent = '';
    errEl.classList.add('hidden');
  }
  if (subjectsEl) {
    subjectsEl.innerHTML = '';
    subjectsEl.classList.add('hidden');
  }

  const opts = getAiOptions();
  const subject = document.getElementById('subject').value.trim();
  const body = document.getElementById('body').value.trim();

  setAiLoading(true, action);
  try {
    const res = await api('/api/ai/compose', {
      method: 'POST',
      body: JSON.stringify({
        action: action,
        brief: opts.brief,
        tone: opts.tone,
        language: opts.language,
        subject: subject,
        body: body
      })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'AI request failed');
    }

    if (action === 'subjects' && data.subjects && data.subjects.length) {
      subjectsEl.classList.remove('hidden');
      data.subjects.forEach(function (s) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ai-subject-btn';
        btn.textContent = s;
        btn.addEventListener('click', function () {
          document.getElementById('subject').value = s;
          showToast('Subject applied', 'success');
        });
        subjectsEl.appendChild(btn);
      });
      showToast('Subject suggestions ready — click one to use it', 'success');
      return;
    }

    if (data.subject) document.getElementById('subject').value = data.subject;
    if (data.body) {
      document.getElementById('body').value = data.body;
      const preview = document.getElementById('preview');
      if (preview && !preview.classList.contains('hidden') && window.marked) {
        preview.innerHTML = marked.parse(data.body);
      }
    }
    showToast(action === 'improve' ? 'Message improved' : 'Email drafted', 'success');
  } catch (err) {
    if (errEl) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    }
    showToast(err.message, 'error');
  } finally {
    setAiLoading(false, action);
  }
}

['ai-draft-btn', 'ai-subjects-btn', 'ai-improve-btn'].forEach(function (id, idx) {
  const btn = document.getElementById(id);
  const actions = ['draft', 'subjects', 'improve'];
  if (btn) btn.addEventListener('click', function () { runAiCompose(actions[idx]); });
});

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

  const categoryId = getSendCategoryId() || undefined;
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
        ? '<p>Send completed. Tracking is available in the <strong>Campaigns</strong> tab.</p>'
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
    if (hasDatabase && lastCampaignId) {
      await loadCampaignHistory();
      switchAppTab('campaigns', { keepDetail: true });
      showCampaignDetail(lastCampaignId);
    }

    showToast('Sent: ' + sent + (failed ? ' · Failed: ' + failed : ''), failed ? 'error' : 'success');

    if (hasDatabase && getSendCategoryId()) {
      await loadContactsFromDatabase(false);
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
    showToast(data.error || 'Could not load tracking data.', 'error');
    return;
  }
  const s = data.summary || {};
  const events = data.events || [];

  const totalEl = document.getElementById('detail-stat-total');
  const deliveredEl = document.getElementById('detail-stat-delivered');
  const openedEl = document.getElementById('detail-stat-opened');
  const rateEl = document.getElementById('detail-stat-rate');
  if (totalEl) totalEl.textContent = String(s.total ?? 0);
  if (deliveredEl) deliveredEl.textContent = String(s.delivered ?? 0);
  if (openedEl) openedEl.textContent = String(s.opened ?? 0);
  if (rateEl) rateEl.textContent = formatOpenRate(s.opened ?? 0, s.total ?? 0);

  const openedEvents = events.filter(function (ev) {
    return ev.opened_at;
  });
  const opensTbody = document.getElementById('opens-tbody');
  const opensEmpty = document.getElementById('opens-empty');
  if (opensTbody) {
    if (!openedEvents.length) {
      opensTbody.innerHTML = '';
      if (opensEmpty) opensEmpty.classList.remove('hidden');
    } else {
      if (opensEmpty) opensEmpty.classList.add('hidden');
      opensTbody.innerHTML = openedEvents
        .map(function (ev) {
          return (
            '<tr><td>' +
            escapeHtml(ev.recipient_email) +
            '</td><td><span class="badge ' +
            badgeClass(ev.status) +
            '">' +
            escapeHtml(ev.status || 'opened') +
            '</span></td><td>' +
            formatDateTime(ev.opened_at) +
            '</td><td>' +
            formatDateTime(ev.delivered_at) +
            '</td></tr>'
          );
        })
        .join('');
    }
  }

  const recipientsTbody = document.getElementById('recipients-status-tbody');
  if (recipientsTbody) {
    if (!events.length) {
      recipientsTbody.innerHTML =
        '<tr><td colspan="4" class="muted">No delivery data yet. Tracking updates when SendGrid reports events.</td></tr>';
    } else {
      recipientsTbody.innerHTML = events
        .map(function (ev) {
          return (
            '<tr><td>' +
            escapeHtml(ev.recipient_email) +
            '</td><td><span class="badge ' +
            badgeClass(ev.status) +
            '">' +
            escapeHtml(ev.status || '—') +
            '</span></td><td>' +
            formatDateTime(ev.delivered_at) +
            '</td><td>' +
            (ev.opened_at ? formatDateTime(ev.opened_at) : '—') +
            '</td></tr>'
          );
        })
        .join('');
    }
  }

  const trackingSummary = document.getElementById('tracking-summary');
  if (trackingSummary) {
    trackingSummary.textContent =
      'Total: ' + s.total + ' · Delivered: ' + s.delivered + ' · Opened: ' + s.opened;
  }
}

document.querySelectorAll('.app-nav-btn').forEach(function (btn) {
  btn.addEventListener('click', function () {
    switchAppTab(btn.getAttribute('data-app-tab'));
  });
});

document.getElementById('go-to-lists-btn').addEventListener('click', function () {
  switchAppTab('lists');
});

document.getElementById('go-to-send-btn').addEventListener('click', function () {
  switchAppTab('send');
});

document.getElementById('btn-continue-to-message').addEventListener('click', function () {
  goToSendStep(2);
});

document.getElementById('btn-back-to-audience').addEventListener('click', function () {
  goToSendStep(1);
});

document.getElementById('btn-edit-audience').addEventListener('click', function () {
  goToSendStep(1);
});

document.querySelectorAll('.wizard-step').forEach(function (btn) {
  btn.addEventListener('click', function () {
    const step = parseInt(btn.getAttribute('data-send-step'), 10);
    if (step === 1) {
      goToSendStep(1);
    } else if (step === 2) {
      goToSendStep(2);
    }
  });
});

document.getElementById('campaign-detail-back').addEventListener('click', hideCampaignDetail);

syncImportModeUI();
initSession();
