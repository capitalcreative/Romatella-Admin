export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Prefer');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const URL = process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_KEY;
  if (!URL || !KEY) return res.status(500).json({ error: 'Supabase no configurado' });

  try {
    const { table, action, data, id, filters } = req.method === 'GET' ? req.query : (req.body || {});

    let url = `${URL}/rest/v1/${table}`;
    let method = 'GET';
    let body = null;
    let prefer = '';

    if (action === 'insert') {
      method = 'POST';
      body = JSON.stringify(data);
      prefer = 'return=representation';
    } else if (action === 'update') {
      method = 'PATCH';
      url += `?id=eq.${id}`;
      body = JSON.stringify(data);
      prefer = 'return=representation';
    } else if (action === 'delete') {
      method = 'DELETE';
      url += `?id=eq.${id}`;
    } else if (action === 'select') {
      url += '?select=*&order=created_at.desc&limit=500';
      if (filters) url += '&' + filters;
    } else if (action === 'upsert') {
      method = 'POST';
      body = JSON.stringify(data);
      prefer = 'return=representation,resolution=merge-duplicates';
    } else if (action === 'delete_by_compra') {
      method = 'DELETE';
      url += `?compra_id=eq.${id}`;
    }

    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'apikey': KEY,
        'Authorization': `Bearer ${KEY}`,
        'Prefer': prefer
      },
      body
    });

    const text = await response.text();
    const result = text ? JSON.parse(text) : {};
    res.status(response.ok ? 200 : response.status).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
