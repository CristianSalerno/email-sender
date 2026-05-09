const express = require('express');
const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const app = express();

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

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
    let contacts = [];
    
    if (filename.endsWith('.txt')) {
      const text = Buffer.from(content, 'base64').toString('utf8');
      const lines = text.split(/[\n,;]/);
      contacts = lines.map(line => {
        const parts = line.split(/[,;]/).map(p => p.trim());
        return { email: parts[0] || '', name: parts[1] || '', company: parts[2] || '' };
      }).filter(c => c.email.includes('@'));
    } else if (filename.match(/\.xlsx?$/)) {
      const buffer = Buffer.from(content, 'base64');
      const workbook = xlsx.read(buffer, { type: 'buffer' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const data = xlsx.utils.sheet_to_json(sheet);
      contacts = data.map(row => ({
        email: row.email || row.Email || row.EMAIL || Object.values(row)[0] || '',
        name: row.name || row.Name || row.NAME || row.nombre || row.Nombre || '',
        company: row.company || row.Company || row.COMPANY || row.empresa || row.Empresa || ''
      })).filter(c => c.email.includes('@'));
    }
    
    res.json({ success: true, contacts });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/send', async (req, res) => {
  try {
    const { contacts, subject, body } = req.body;
    
    if (!process.env.SENDGRID_API_KEY || !process.env.FROM_EMAIL) {
      return res.status(400).json({ 
        success: false, 
        error: 'SendGrid not configured.'
      });
    }

    const contactList = typeof contacts === 'string' ? JSON.parse(contacts) : contacts;
    const results = [];

    for (const contact of contactList) {
      const personalizedBody = body
        .replace(/\{\{email\}\}/gi, contact.email)
        .replace(/\{\{name\}\}/gi, contact.name || '')
        .replace(/\{\{company\}\}/gi, contact.company || '');
      
      const personalizedSubject = subject
        .replace(/\{\{email\}\}/gi, contact.email)
        .replace(/\{\{name\}\}/gi, contact.name || '')
        .replace(/\{\{company\}\}/gi, contact.company || '');

      const msg = {
        personalizations: [{ 
          to: [{ email: contact.email }],
          subject: personalizedSubject
        }],
        from: { email: process.env.FROM_EMAIL },
        subject: personalizedSubject,
        content: [{ type: 'text/plain', value: personalizedBody }]
      };

      if (contact.attachment) {
        msg.attachments = [{
          content: contact.attachment.content,
          filename: contact.attachment.filename,
          type: contact.attachment.type || 'application/pdf',
          disposition: 'attachment'
        }];
      }

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
          results.push({ email: contact.email, name: contact.name, status: 'sent' });
        } else {
          const errorText = await response.text();
          results.push({ email: contact.email, name: contact.name, status: 'failed', error: `Error ${response.status}` });
        }
      } catch (err) {
        results.push({ email: contact.email, name: contact.name, status: 'failed', error: err.message });
      }
    }

    res.json({ success: true, results });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = app;