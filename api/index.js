import fs from 'fs';
import path from 'path';

export default function handler(req, res) {
  const html = fs.readFileSync(path.join(process.cwd(), 'public', 'index.html'), 'utf8');
  res.setHeader('Content-Type', 'text/html');
  return res.send(html);
}