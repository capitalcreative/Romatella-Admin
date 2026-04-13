export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Prefer');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const SUPA_URL = process.env.SUPABASE_URL;
  const KEY      = process.env.SUPABASE_KEY;
  if (!SUPA_URL || !KEY) return res.status(500).json({ error: 'Supabase no configurado' });

  try {
    const { table, action, data, id, filters } = req.method === 'GET' ? req.query : (req.body || {});

    // ── Autenticación ────────────────────────────────────────
    if (action === 'login') {
      const { email, password } = data || {};
      if (!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos' });

      const authResp = await fetch(`${SUPA_URL}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': KEY },
        body: JSON.stringify({ email, password })
      });
      const authData = await authResp.json();
      if (!authResp.ok || authData.error) {
        return res.status(401).json({ error: authData.error_description || 'Credenciales incorrectas' });
      }
      return res.status(200).json({
        ok: true,
        user: { email: authData.user?.email, id: authData.user?.id }
      });
    }

    // ── Select con paginación automática (sin límite duro) ───
    if (action === 'select') {
      const PAGE = 1000;
      let allRows = [];
      let offset  = 0;
      let keepGoing = true;

      while (keepGoing) {
        let pageUrl = `${SUPA_URL}/rest/v1/${table}?select=*&order=created_at.desc&limit=${PAGE}&offset=${offset}`;
        if (filters) pageUrl += '&' + filters;

        const pageResp = await fetch(pageUrl, {
          headers: {
            'Content-Type': 'application/json',
            'apikey': KEY,
            'Authorization': `Bearer ${KEY}`,
            'Prefer': 'count=exact'
          }
        });

        if (!pageResp.ok) {
          const errText = await pageResp.text();
          return res.status(pageResp.status).json({ error: errText });
        }

        const rows = await pageResp.json();
        if (!Array.isArray(rows) || rows.length === 0) break;
        allRows = allRows.concat(rows);
        if (rows.length < PAGE) keepGoing = false;
        else offset += PAGE;
      }

      return res.status(200).json(allRows);
    }

    // ── Operaciones de escritura ─────────────────────────────
    let url = `${SUPA_URL}/rest/v1/${table}`;
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
