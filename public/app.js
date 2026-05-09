let allEmails = [];

async function checkStatus() {
  const res = await fetch('/api/status');
  const data = await res.json();
  
  const stored = sessionStorage.getItem('emailSenderConfig');
  if (stored && data.connected) {
    const config = JSON.parse(stored);
    document.getElementById('from-email').value = config.fromEmail;
  }
  
  updateStatus(data);
}

checkStatus();

function disconnect() {
  sessionStorage.removeItem('emailSenderConfig');
  fetch('/api/disconnect', { method: 'POST' });
  updateStatus({ connected: false });
}

function updateStatus(data) {
  const el = document.getElementById('connection-status');
  const formContainer = document.getElementById('config-form-container');
  const connectedMsg = document.getElementById('connected-message');
  const sections = ['emails-section', 'compose-section'];
  
  if (data.connected) {
    el.className = 'status connected';
    el.textContent = '✅ Connected to SendGrid';
    formContainer.classList.add('hidden');
    connectedMsg.classList.remove('hidden');
    sections.forEach(id => document.getElementById(id).classList.remove('disabled'));
  } else {
    el.className = 'status disconnected';
    el.textContent = '❌ Not connected';
    formContainer.classList.remove('hidden');
    connectedMsg.classList.add('hidden');
    sections.forEach(id => document.getElementById(id).classList.add('disabled'));
  }
}

document.getElementById('config-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const apiKey = document.getElementById('api-key').value;
  const fromEmail = document.getElementById('sender-email').value;

  const res = await fetch('/api/configure', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey, fromEmail })
  });
  const data = await res.json();
  if (data.success) {
    sessionStorage.setItem('emailSenderConfig', JSON.stringify({ apiKey, fromEmail }));
    updateStatus({ connected: true, email: fromEmail });
    document.getElementById('from-email').value = fromEmail;
  } else {
    alert('❌ Error: ' + data.error);
    updateStatus({ connected: false });
  }
});

const uploadArea = document.getElementById('upload-area');
const fileInput = document.getElementById('contacts-file');

uploadArea.addEventListener('click', () => fileInput.click());
uploadArea.addEventListener('dragover', (e) => { e.preventDefault(); uploadArea.style.borderColor = '#667eea'; });
uploadArea.addEventListener('dragleave', () => { uploadArea.style.borderColor = '#ccc'; });
uploadArea.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadArea.style.borderColor = '#ccc';
  if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
});

fileInput.addEventListener('change', (e) => {
  if (e.target.files.length) handleFile(e.target.files[0]);
});

async function handleFile(file) {
  const formData = new FormData();
  formData.append('file', file);

  document.getElementById('file-info').innerHTML = '<div class="loading">Loading...</div>';
  document.getElementById('file-info').classList.remove('hidden');

  const res = await fetch('/api/upload-contacts', { method: 'POST', body: formData });
  const data = await res.json();

  if (data.success) {
    allEmails = data.emails;
    document.getElementById('file-info').innerHTML = `✅ ${data.emails.length} emails found`;
    renderEmails();
    document.getElementById('emails-section').classList.remove('hidden');
    document.getElementById('compose-section').classList.remove('hidden');
    document.getElementById('total-count').textContent = data.emails.length;
  } else {
    alert('Error: ' + data.error);
  }
}

function renderEmails() {
  const list = document.getElementById('emails-list');
  list.innerHTML = allEmails.map((email, i) => `
    <div class="email-item">
      <input type="checkbox" id="email-${i}" value="${email}" checked onchange="updateCount()">
      <span>${email}</span>
    </div>
  `).join('');
  updateCount();
}

function updateCount() {
  const checked = document.querySelectorAll('#emails-list input:checked').length;
  document.getElementById('selected-count').textContent = checked;
}

function selectAll() {
  document.querySelectorAll('#emails-list input').forEach(cb => cb.checked = true);
  updateCount();
}

function deselectAll() {
  document.querySelectorAll('#emails-list input').forEach(cb => cb.checked = false);
  updateCount();
}

document.getElementById('email-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const selected = Array.from(document.querySelectorAll('#emails-list input:checked')).map(cb => cb.value);
  if (selected.length === 0) return alert('Selecciona al menos un destinatario');

  const formData = new FormData();
  formData.append('emails', JSON.stringify(selected));
  formData.append('subject', document.getElementById('subject').value);
  formData.append('body', document.getElementById('body').value);
  formData.append('fromEmail', document.getElementById('from-email').value);

  const attachmentInput = document.getElementById('attachment');
  if (attachmentInput.files.length > 0) {
    formData.append('attachment', attachmentInput.files[0]);
  }

  document.querySelector('.btn-large').textContent = 'Sending...';
  document.querySelector('.btn-large').disabled = true;

  const res = await fetch('/api/send-emails', { method: 'POST', body: formData });
  const data = await res.json();

  document.querySelector('.btn-large').textContent = '📤 Send Emails';
  document.querySelector('.btn-large').disabled = false;

  if (data.success) {
    const resultsDiv = document.getElementById('results');
    const sent = data.results.filter(r => r.status === 'sent').length;
    const failed = data.results.filter(r => r.status === 'failed').length;

    resultsDiv.innerHTML = data.results.map(r => `
      <div class="result-item ${r.status}">
        ${r.email}: ${r.status === 'sent' ? '✓ Sent' : '✗ Error: ' + r.error}
      </div>
    `).join('');

    document.getElementById('results-section').classList.remove('hidden');
    alert(`✅ Sent: ${sent}, Failed: ${failed}`);
  } else {
    alert('Error: ' + data.error);
  }
});