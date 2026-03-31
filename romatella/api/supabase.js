export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { table, action, data, id } = req.body || req.query;
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_KEY;

    let url = `${SUPABASE_URL}/rest/v1/${table}`;
    let method = 'GET';
    let body = null;

    if (action === 'insert') { method = 'POST'; body = JSON.stringify(data); }
    else if (action === 'update') { method = 'PATCH'; url += `?id=eq.${id}`; body = JSON.stringify(data); }
    else if (action === 'delete') { method = 'DELETE'; url += `?id=eq.${id}`; }
    else if (action === 'select') { url += '?select=*&order=created_at.desc&limit=100'; }

    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Prefer': action === 'insert' ? 'return=representation' : ''
      },
      body
    });

    const result = await response.json();
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
