let allEmails = [];

async function checkStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    updateStatus(data);
  } catch (err) {
    updateStatus({ connected: false });
  }
}

checkStatus();

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
    connectedMsg.innerHTML = `<p>📧 Sender: <strong>${data.email}</strong></p>`;
    document.getElementById('from-email').value = data.email || '';
    sections.forEach(id => document.getElementById(id).classList.remove('disabled'));
  } else {
    el.className = 'status disconnected';
    el.textContent = '❌ Not configured - Set SENDGRID_API_KEY and FROM_EMAIL in Vercel';
    formContainer.classList.add('hidden');
    connectedMsg.classList.remove('hidden');
    connectedMsg.innerHTML = `
      <p>Configure environment variables in Vercel:</p>
      <ul>
        <li><strong>SENDGRID_API_KEY</strong>: Your SendGrid API key</li>
        <li><strong>FROM_EMAIL</strong>: Verified sender email</li>
      </ul>
      <p><a href="https://vercel.com/docs/environment-variables" target="_blank">Vercel Docs: Environment Variables</a></p>
    `;
    sections.forEach(id => document.getElementById(id).classList.add('disabled'));
  }
}

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
  document.getElementById('file-info').innerHTML = '<div class="loading">Loading...</div>';
  document.getElementById('file-info').classList.remove('hidden');

  const reader = new FileReader();
  reader.onload = async function(e) {
    const base64 = e.target.result.split(',')[1];
    
    const res = await fetch('/api/contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: base64, filename: file.name })
    });
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
  };
  reader.readAsDataURL(file);
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
  if (selected.length === 0) return alert('Select at least one recipient');

  const body = {
    emails: JSON.stringify(selected),
    subject: document.getElementById('subject').value,
    body: document.getElementById('body').value
  };

  const attachmentInput = document.getElementById('attachment');
  if (attachmentInput.files.length > 0) {
    const file = attachmentInput.files[0];
    if (file.size > 4 * 1024 * 1024) {
      return alert('El archivo es muy grande. Máximo 4MB.');
    }
    const reader = new FileReader();
    reader.onload = async function(evt) {
      const base64 = evt.target.result.split(',')[1];
      body.attachment = {
        content: base64,
        filename: file.name,
        type: file.type
      };
      await sendEmails(body);
    };
    reader.readAsDataURL(file);
  } else {
    await sendEmails(body);
  }
});

async function sendEmails(body) {
  document.querySelector('.btn-large').textContent = 'Sending...';
  document.querySelector('.btn-large').disabled = true;

  const res = await fetch('/api/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
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
}