import xlsx from 'xlsx';

export default function handler(req, res) {
  if (req.method === 'POST') {
    const { content, filename } = req.body;
    
    try {
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
      
      return res.status(200).json({ success: true, emails });
    } catch (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
  }
  return res.status(405).json({ error: 'Method not allowed' });
}