export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const TOKEN = process.env.LOYVERSE_TOKEN;
  if (!TOKEN) return res.status(500).json({ error: 'LOYVERSE_TOKEN no configurado' });

  const { endpoint, date_from, date_to, limit } = req.query;

  try {

    // ── Endpoints que requieren paginación ───────────────────
    if (endpoint === 'summary' || endpoint === 'receipts') {
      const PAGE = 250; // máximo permitido por Loyverse
      let allReceipts = [];
      let cursor = null;
      let keepGoing = true;

      while (keepGoing) {
        let url = `https://api.loyverse.com/v1.0/receipts?limit=${PAGE}`;
        if (date_from) url += `&created_at_min=${date_from}`;
        if (date_to)   url += `&created_at_max=${date_to}`;
        if (cursor)    url += `&cursor=${cursor}`;

        const resp = await fetch(url, {
          headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }
        });

        if (!resp.ok) {
          const err = await resp.text();
          return res.status(resp.status).json({ error: err });
        }

        const data = await resp.json();
        const batch = data.receipts || [];
        allReceipts = allReceipts.concat(batch);

        if (data.cursor && batch.length === PAGE) {
          cursor = data.cursor;
        } else {
          keepGoing = false;
        }
      }

      return res.status(200).json({ receipts: allReceipts });
    }

    if (endpoint === 'shifts') {
      const PAGE = 50;
      let allShifts = [];
      let cursor = null;
      let keepGoing = true;

      while (keepGoing) {
        let url = `https://api.loyverse.com/v1.0/shifts?limit=${PAGE}`;
        if (date_from) url += `&opened_at_min=${date_from}`;
        if (date_to)   url += `&opened_at_max=${date_to}`;
        if (cursor)    url += `&cursor=${cursor}`;

        const resp = await fetch(url, {
          headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }
        });

        if (!resp.ok) {
          const err = await resp.text();
          return res.status(resp.status).json({ error: err });
        }

        const data = await resp.json();
        const batch = data.shifts || [];
        allShifts = allShifts.concat(batch);

        if (data.cursor && batch.length === PAGE) {
          cursor = data.cursor;
        } else {
          keepGoing = false;
        }
      }

      return res.status(200).json({ shifts: allShifts });
    }

    // ── Endpoints simples (sin paginación necesaria) ─────────
    const endpoints = {
      receipts_single: `https://api.loyverse.com/v1.0/receipts?limit=${limit||50}${date_from?'&created_at_min='+date_from:''}${date_to?'&created_at_max='+date_to:''}`,
      items:           'https://api.loyverse.com/v1.0/items?limit=250',
      payment_types:   'https://api.loyverse.com/v1.0/payment_types',
    };

    const url = endpoints[endpoint];
    if (!url) return res.status(400).json({ error: 'Endpoint invalido: ' + endpoint });

    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(response.status).json({ error: err });
    }

    const data = await response.json();
    res.status(200).json(data);

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
