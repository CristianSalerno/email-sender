import xlsx from 'xlsx';
import fetch from 'node-fetch';

function getConfig() {
  const apiKey = process.env.SENDGRID_API_KEY;
  const fromEmail = process.env.FROM_EMAIL;
  
  if (!apiKey || !fromEmail) {
    return null;
  }
  
  return { apiKey, fromEmail };
}

export default async function handler(req, res) {
  if (req.method === 'POST') {
    const config = getConfig();
    
    if (!config) {
      return res.status(400).json({ 
        success: false, 
        error: 'SendGrid not configured. Set SENDGRID_API_KEY and FROM_EMAIL environment variables in Vercel.'
      });
    }

    const { emails, subject, body } = req.body;
    const emailList = typeof emails === 'string' ? JSON.parse(emails) : emails;
    const results = [];

    for (const email of emailList) {
      const msg = {
        personalizations: [{ to: [{ email: email }] }],
        from: { email: config.fromEmail },
        subject: subject,
        content: [{ type: 'text/plain', value: body }]
      };

      try {
        const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${config.apiKey}`,
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

    return res.status(200).json({ success: true, results });
  }
  return res.status(405).json({ error: 'Method not allowed' });
}