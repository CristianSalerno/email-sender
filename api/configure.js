export default function handler(req, res) {
  if (req.method === 'POST') {
    const apiKey = process.env.SENDGRID_API_KEY;
    const fromEmail = process.env.FROM_EMAIL;
    
    if (!apiKey || !fromEmail) {
      return res.status(400).json({ 
        success: false, 
        error: 'Configure SENDGRID_API_KEY and FROM_EMAIL in Vercel environment variables' 
      });
    }
    
    return res.status(200).json({ success: true, fromEmail });
  }
  return res.status(405).json({ error: 'Method not allowed' });
}