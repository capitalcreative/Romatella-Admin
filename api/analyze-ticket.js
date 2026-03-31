export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { imageBase64, mediaType } = req.body;
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-opus-4-6', max_tokens: 1024, messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: imageBase64 } }, { type: 'text', text: 'Analiza este ticket de compra de restaurante. Responde SOLO con JSON sin backticks: {"proveedor":"string","fecha":"DD/MM/YYYY","categoria":"Carnicería|Mariscos|Abarrotes|Lácteos|Walmart|Costco|Mercado|Panadería|Vinos|Licores|Refrescos|Materias Primas|Semillas","productos":[{"nombre":"string","cantidad":1,"unidad":"string","costo_unitario":0}],"total":0}' }] }] })
    });
    const data = await response.json();
    const text = data.content?.[0]?.text || '{}';
    res.status(200).json(JSON.parse(text.replace(/```json|```/g, '').trim()));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
