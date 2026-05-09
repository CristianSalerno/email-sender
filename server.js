const express = require('express');
const multer = require('multer');
const nodemailer = require('nodemailer');
const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(express.json());
app.use(express.static('public'));

let connectedEmail = null;

let sendGridConfig = null;
let savedFromEmail = null;

app.post('/api/configure', async (req, res) => {
  const { apiKey, fromEmail } = req.body;
  
  sendGridConfig = { apiKey };
  savedFromEmail = fromEmail;
  connectedEmail = 'SendGrid';
  
  res.json({ success: true, message: '✅ Configurado', fromEmail });
});

app.post('/api/disconnect', (req, res) => {
  sendGridConfig = null;
  savedFromEmail = null;
  connectedEmail = null;
  res.json({ success: true });
});

app.get('/api/status', (req, res) => {
  res.json({ 
    connected: !!sendGridConfig, 
    email: savedFromEmail || null
  });
});

app.post('/api/upload-contacts', upload.single('file'), (req, res) => {
  try {
    const file = req.file;
    let emails = [];

    const isExcel = file.mimetype.includes('spreadsheet') || file.originalname.match(/\.xlsx?$/);
    const isTxt = file.mimetype.includes('text') || file.originalname.endsWith('.txt');

    if (isExcel) {
      const workbook = xlsx.readFile(file.path);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const data = xlsx.utils.sheet_to_json(sheet);
      emails = data.map(row => row.email || row.Email || row.EMAIL || Object.values(row)[0]).filter(Boolean);
    } else if (isTxt) {
      const content = fs.readFileSync(file.path, 'utf8');
      emails = content.split(/[\n,;]/).map(e => e.trim()).filter(e => e.includes('@'));
    }

    fs.unlinkSync(file.path);
    res.json({ success: true, emails });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/send-emails', upload.single('attachment'), async (req, res) => {
  try {
    const { emails, subject, body, fromEmail } = req.body;
    const attachment = req.file;

    if (!sendGridConfig) {
      return res.status(400).json({ success: false, error: 'Configura SendGrid primero' });
    }

    if (fromEmail !== savedFromEmail) {
      return res.status(400).json({ success: false, error: 'Remitente no autorizado. Usa el email que configuraste al conectar.' });
    }

    const emailList = JSON.parse(emails);
    const results = [];

    for (const email of emailList) {
      let attachments = [];
      if (attachment) {
        const fileData = fs.readFileSync(attachment.path);
        const base64 = fileData.toString('base64');
        attachments = [{
          content: base64,
          filename: attachment.originalname,
          type: attachment.mimetype,
          disposition: 'attachment'
        }];
      }

      const msg = {
        personalizations: [{ to: [{ email: email }] }],
        from: { email: fromEmail },
        subject: subject,
        content: [{ type: 'text/plain', value: body }],
        attachments: attachments.length > 0 ? attachments : undefined
      };

      try {
        const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${sendGridConfig.apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(msg)
        });

        if (response.status === 202 || response.ok) {
          results.push({ email, status: 'sent' });
        } else {
          results.push({ email, status: 'failed', error: `Error ${response.status}` });
        }
      } catch (err) {
        results.push({ email, status: 'failed', error: err.message });
      }
    }

    if (attachment) fs.unlinkSync(attachment.path);
    res.json({ success: true, results });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.listen(3000, () => console.log('App corriendo en http://localhost:3000'));