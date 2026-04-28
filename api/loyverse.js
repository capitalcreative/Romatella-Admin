export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const TOKEN = process.env.LOYVERSE_TOKEN;
  if (!TOKEN) return res.status(500).json({ error: 'LOYVERSE_TOKEN no configurado' });

  const { endpoint, date_from, date_to, limit } = req.query;

  // ── Cache-Control por tipo de endpoint ──────────────────────
  // Vercel Edge Cache: s-maxage = tiempo que Vercel guarda la respuesta en CDN.
  // stale-while-revalidate = sirve caché viejo mientras revalida en background.
  // Esto elimina cold starts repetidos para el mismo rango de fechas.
  const cacheTTL = {
    summary:       300,   // 5 min  — ventas recientes
    receipts:      300,   // 5 min
    shifts:        600,   // 10 min — cortes de caja cambian poco
    items:         3600,  // 1 hora — catálogo de productos casi estático
    payment_types: 3600,  // 1 hora — tipos de pago estáticos
  };
  const ttl = cacheTTL[endpoint] || 300;
  res.setHeader('Cache-Control', `public, s-maxage=${ttl}, stale-while-revalidate=${ttl * 2}`);

  // ── URLs de Loyverse ────────────────────────────────────────
  const endpointMap = {
    receipts:      `https://api.loyverse.com/v1.0/receipts?limit=${limit||50}${date_from?'&created_at_min='+date_from:''}${date_to?'&created_at_max='+date_to:''}`,
    summary:       `https://api.loyverse.com/v1.0/receipts?limit=250${date_from?'&created_at_min='+date_from:''}${date_to?'&created_at_max='+date_to:''}`,
    items:         'https://api.loyverse.com/v1.0/items?limit=250',
    shifts:        `https://api.loyverse.com/v1.0/shifts?limit=50${date_from?'&opened_at_min='+date_from:''}${date_to?'&opened_at_max='+date_to:''}`,
    payment_types: 'https://api.loyverse.com/v1.0/payment_types',
  };

  const url = endpointMap[endpoint];
  if (!url) return res.status(400).json({ error: 'Endpoint invalido: ' + endpoint });

  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json'
      }
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
