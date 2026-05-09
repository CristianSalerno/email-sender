const express = require('express');
const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  const htmlPath = path.join(__dirname, 'public', 'index.html');
  res.sendFile(htmlPath);
});

app.get('/api/status', (req, res) => {
  const hasConfig = !!(process.env.SENDGRID_API_KEY && process.env.FROM_EMAIL);
  res.json({
    connected: hasConfig,
    email: hasConfig ? process.env.FROM_EMAIL : null
  });
});

app.post('/api/configure', (req, res) => {
  const hasConfig = !!(process.env.SENDGRID_API_KEY && process.env.FROM_EMAIL);
  res.json({ success: hasConfig, fromEmail: process.env.FROM_EMAIL || null });
});

app.post('/api/disconnect', (req, res) => {
  res.json({ success: true });
});

app.post('/api/contacts', (req, res) => {
  try {
    const { content, filename } = req.body;
    let emails = [];
    
    if (filename.endsWith('.txt')) {
      const text = Buffer.from(content, 'base64').toString('utf8');
      emails = text.split(/[\n,;]/).map(e => e.trim()).filter(e => e.includes('@'));
    } else if (filename.match(/\.xlsx?$/)) {
      const buffer = Buffer.from(content, 'base64');
      const workbook = xlsx.read(buffer, { type: 'buffer' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const data = xlsx.utils.sheet_to_json(sheet);
      emails = data.map(row => row.email || row.Email || row.EMAIL || Object.values(row)[0]).filter(Boolean);
    }
    
    res.json({ success: true, emails });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/send', async (req, res) => {
  try {
    const { emails, subject, body } = req.body;
    
    if (!process.env.SENDGRID_API_KEY || !process.env.FROM_EMAIL) {
      return res.status(400).json({ 
        success: false, 
        error: 'SendGrid not configured. Set SENDGRID_API_KEY and FROM_EMAIL in Vercel.'
      });
    }

    const emailList = typeof emails === 'string' ? JSON.parse(emails) : emails;
    const results = [];

    for (const email of emailList) {
      const msg = {
        personalizations: [{ to: [{ email: email }] }],
        from: { email: process.env.FROM_EMAIL },
        subject: subject,
        content: [{ type: 'text/plain', value: body }]
      };

      try {
        const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.SENDGRID_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(msg)
        });

        if (response.ok || response.status === 202) {
          results.push({ email, status: 'sent' });
        } else {
          const errorText = await response.text();
          results.push({ email, status: 'failed', error: `Error ${response.status}: ${errorText}` });
        }
      } catch (err) {
        results.push({ email, status: 'failed', error: err.message });
      }
    }

    res.json({ success: true, results });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = app;