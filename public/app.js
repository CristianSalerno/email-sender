let allContacts = [];
let lastCampaignId = null;
let categories = [];
let pendingFile = null;
let hasDatabase = false;

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
  ['category-select-error', 'new-category-error', 'file-error', 'import-global-error'].forEach(function (id) {
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
      e.textContent = 'Selecciona una categoría.';
      e.classList.remove('hidden');
      ok = false;
    }
  } else {
    const name = document.getElementById('new-category-name').value.trim();
    if (!name) {
      const e = document.getElementById('new-category-error');
      e.textContent = 'Escribe el nombre de la nueva categoría.';
      e.classList.remove('hidden');
      ok = false;
    }
  }
  if (!pendingFile) {
    const e = document.getElementById('file-error');
    e.textContent = 'Adjunta un archivo Excel o TXT con los contactos.';
    e.classList.remove('hidden');
    ok = false;
  }
  return ok;
}

function setPendingFile(file) {
  pendingFile = file || null;
  const label = document.getElementById('pending-file-name');
  if (label) {
    label.textContent = file ? 'Archivo: ' + file.name : '';
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
  hasDatabase = !!data.database;

  if (dbPill) {
    dbPill.textContent = data.database ? 'Base de datos conectada' : 'Base de datos no configurada';
    dbPill.classList.toggle('pill-ok', !!data.database);
    dbPill.classList.toggle('pill-warn', !data.database);
  }

  const manage = document.getElementById('manage-categories-section');
  if (manage) {
    manage.classList.toggle('hidden', !data.database);
  }

  if (data.connected) {
    el.className = 'status status-on';
    el.textContent = 'SendGrid listo para enviar';
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
      'SendGrid no está configurado en este entorno. Define SENDGRID_API_KEY y FROM_EMAIL en Vercel (o en .env local). Puedes seguir importando contactos; el envío no estará disponible.';
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
    errEl.textContent = data.error || 'No se pudo iniciar sesión.';
    errEl.classList.remove('hidden');
    return;
  }
  document.getElementById('login-password').value = '';
  showApp(true);
  showToast('Sesión iniciada', 'success');
  await afterLogin();
});

document.getElementById('logout-btn').addEventListener('click', logout);

async function logout() {
  await api('/api/logout', { method: 'POST', body: JSON.stringify({}) });
  lastCampaignId = null;
  allContacts = [];
  pendingFile = null;
  setPendingFile(null);
  showApp(false);
  showToast('Sesión cerrada', 'info');
}

document.querySelectorAll('input[name="import-mode"]').forEach(function (radio) {
  radio.addEventListener('change', syncImportModeUI);
});

document.getElementById('disconnect-info-btn').addEventListener('click', function () {
  showToast(
    'SendGrid se configura con variables de entorno en tu proveedor (Vercel). No se guarda en el navegador.',
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
    '<option value="">— Elige una categoría —</option>' +
    categories
      .map(function (c) {
        return '<option value="' + c.id + '">' + escapeHtml(c.name) + '</option>';
      })
      .join('');
  if (current && categories.some(function (c) {
    return c.id === current;
  })) {
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
        '">Editar</button></td></tr>'
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
    err.textContent = 'El nombre no puede estar vacío.';
    err.classList.remove('hidden');
    return;
  }
  const res = await api('/api/categories/' + encodeURIComponent(id), {
    method: 'PATCH',
    body: JSON.stringify({ name: name })
  });
  const data = await res.json();
  if (!data.success) {
    err.textContent = data.error || 'No se pudo guardar.';
    err.classList.remove('hidden');
    return;
  }
  document.getElementById('edit-category-dialog').close();
  showToast('Categoría actualizada', 'success');
  await loadCategories();
});

document.getElementById('category-select').addEventListener('change', refreshFilesList);

document.getElementById('btn-import').addEventListener('click', runImport);

function runImport() {
  if (!validateImport()) return;
  const file = pendingFile;
  const mode = getImportMode();
  const categoryId = mode === 'existing' ? getSelectedCategoryId() : '';
  const categoryName = mode === 'new' ? document.getElementById('new-category-name').value.trim() : '';

  const info = document.getElementById('file-info');
  info.classList.remove('hidden');
  info.innerHTML = '<div class="muted">Importando…</div>';
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
      const note = data.persisted ? 'Guardado en la base de datos.' : 'Solo en memoria (configura Supabase para guardar).';
      info.innerHTML = '<strong>' + allContacts.length + ' contactos</strong> · ' + note;
      renderRecipientsTable();
      document.getElementById('recipients-section').classList.remove('hidden');
      document.getElementById('compose-section').classList.remove('hidden');
      document.getElementById('total-count').textContent = allContacts.length;
      if (data.persisted && getSelectedCategoryId()) {
        await loadContactsFromDatabase(false);
      }
      showToast('Importación correcta', 'success');
    } else {
      info.classList.add('hidden');
      const g = document.getElementById('import-global-error');
      g.textContent = data.error || 'Error al importar.';
      g.classList.remove('hidden');
      showToast(data.error || 'Error al importar', 'error');
    }
  };
  reader.readAsDataURL(file);
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
    '<strong>Archivos recientes en esta categoría</strong><ul>' +
    data.files
      .map(function (f) {
        return (
          '<li>' +
          escapeHtml(f.original_filename) +
          ' — <span class="muted">' +
          new Date(f.created_at).toLocaleString() +
          '</span></li>'
        );
      })
      .join('') +
    '</ul>';
}

document.getElementById('btn-refresh-recipients').addEventListener('click', function () {
  loadContactsFromDatabase(true);
});

async function loadContactsFromDatabase(showToastOk) {
  const id = getSelectedCategoryId();
  if (!id) {
    showToast('Selecciona una categoría en el paso 1.', 'error');
    return;
  }
  const url =
    '/api/contacts?categoryId=' + encodeURIComponent(id) + '&includeSendStatus=1';
  const res = await api(url);
  const data = await res.json();
  if (!data.success) {
    showToast(data.error || 'No se pudieron cargar los contactos', 'error');
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
    showToast('No hay contactos guardados en esta categoría.', 'info');
    return;
  }
  renderRecipientsTable();
  document.getElementById('recipients-section').classList.remove('hidden');
  document.getElementById('compose-section').classList.remove('hidden');
  document.getElementById('total-count').textContent = allContacts.length;
  if (showToastOk) showToast('Lista actualizada', 'success');
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
    extra = '<br><span class="muted small">Abierto ' + new Date(c.openedAt).toLocaleString() + '</span>';
  } else if (c.lastEventAt && c.sendStatus !== 'never' && c.sendStatus !== 'none') {
    extra = '<br><span class="muted small">' + new Date(c.lastEventAt).toLocaleString() + '</span>';
  }
  return '<span class="badge ' + badgeClass(c.sendStatus) + '">' + escapeHtml(lbl) + '</span>' + extra;
}

function renderRecipientsTable() {
  const tbody = document.getElementById('recipients-tbody');
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
    document.getElementById('subject-error').textContent = 'El asunto es obligatorio.';
    document.getElementById('subject-error').classList.remove('hidden');
    bad = true;
  }
  if (!body) {
    document.getElementById('body-error').textContent = 'El mensaje es obligatorio.';
    document.getElementById('body-error').classList.remove('hidden');
    bad = true;
  }
  if (bad) return;

  const selected = [];
  document.querySelectorAll('#recipients-tbody input:checked').forEach(function (cb) {
    selected.push(allContacts[parseInt(cb.getAttribute('data-idx'), 10)]);
  });
  if (!selected.length) {
    showToast('Selecciona al menos un destinatario.', 'error');
    return;
  }

  const categoryId = getSelectedCategoryId() || undefined;
  const attachmentInput = document.getElementById('attachment');
  document.getElementById('attachment-error').classList.add('hidden');

  if (attachmentInput.files.length > 0) {
    const file = attachmentInput.files[0];
    if (file.size > 4 * 1024 * 1024) {
      document.getElementById('attachment-error').textContent = 'El archivo supera 4 MB.';
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
  btn.textContent = 'Enviando…';
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

  btn.textContent = 'Enviar correos';
  btn.disabled = false;

  if (res.status === 401) {
    showApp(false);
    return;
  }

  if (data.success) {
    lastCampaignId = data.campaignId || null;
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
        ? '<p>Campaña <code>' + escapeHtml(lastCampaignId) + '</code>. Las aperturas llegan vía webhook de SendGrid.</p>'
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
          (r.status === 'sent' ? 'Enviado' : escapeHtml(r.error || 'Error')) +
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

    showToast('Enviados: ' + sent + (failed ? ' · Fallidos: ' + failed : ''), failed ? 'error' : 'success');

    if (hasDatabase && getSelectedCategoryId()) {
      await loadContactsFromDatabase(false);
    }
  } else {
    showToast(data.error || 'Error al enviar', 'error');
  }
}

document.getElementById('refresh-tracking-btn').addEventListener('click', refreshCampaignTracking);

async function refreshCampaignTracking() {
  if (!lastCampaignId) return;
  const res = await api('/api/campaigns/' + encodeURIComponent(lastCampaignId) + '/status');
  const data = await res.json();
  if (!data.success) {
    document.getElementById('tracking-summary').textContent = data.error || 'Sin datos.';
    return;
  }
  const s = data.summary || {};
  document.getElementById('tracking-summary').textContent =
    'Total: ' + s.total + ' · Entregados (evento): ' + s.delivered + ' · Abiertos: ' + s.opened;
  document.getElementById('tracking-details').innerHTML = (data.events || [])
    .map(function (ev) {
      return (
        '<div class="tracking-row"><strong>' +
        escapeHtml(ev.recipient_email) +
        '</strong> — ' +
        escapeHtml(ev.status || '') +
        (ev.opened_at ? ' · Abierto ' + new Date(ev.opened_at).toLocaleString() : '') +
        '</div>'
      );
    })
    .join('');
}

syncImportModeUI();
initSession();
