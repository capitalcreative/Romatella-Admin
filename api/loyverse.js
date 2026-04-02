export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const TOKEN = process.env.LOYVERSE_TOKEN;
  if (!TOKEN) return res.status(500).json({ error: 'LOYVERSE_TOKEN no configurado' });

  const { endpoint, date_from, date_to, limit } = req.query;

  const endpoints = {
    receipts: `https://api.loyverse.com/v1.0/receipts?limit=${limit||50}${date_from?'&created_at_min='+date_from:''}${date_to?'&created_at_max='+date_to:''}`,
    items: 'https://api.loyverse.com/v1.0/items?limit=250',
    categories: 'https://api.loyverse.com/v1.0/categories',
    summary: `https://api.loyverse.com/v1.0/receipts?limit=250${date_from?'&created_at_min='+date_from:''}${date_to?'&created_at_max='+date_to:''}`,
    cash: `https://api.loyverse.com/v1.0/cash_operations?limit=250${date_from?'&created_at_min='+date_from:''}${date_to?'&created_at_max='+date_to:''}`,
    shifts: `https://api.loyverse.com/v1.0/shifts?limit=50${date_from?'&opened_at_min='+date_from:''}${date_to?'&opened_at_max='+date_to:''}`,
  };

  const url = endpoints[endpoint];
  if (!url) return res.status(400).json({ error: 'Endpoint inválido: ' + endpoint });

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
