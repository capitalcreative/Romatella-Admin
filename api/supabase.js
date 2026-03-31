export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    const { table, action, data } = req.body || {};
    const URL = process.env.SUPABASE_URL;
    const KEY = process.env.SUPABASE_KEY;
    let url = `${URL}/rest/v1/${table}`;
    let method = 'GET';
    let body = null;
    if (action === 'insert') { method = 'POST'; body = JSON.stringify(data); }
    else if (action === 'select') { url += '?select=*&order=created_at.desc&limit=100'; }
    const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json', 'apikey': KEY, 'Authorization': `Bearer ${KEY}`, 'Prefer': action === 'insert' ? 'return=representation' : '' }, body });
    res.status(200).json(await response.json());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
