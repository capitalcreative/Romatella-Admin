export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  try {
    const { imageBase64, mediaType } = req.body;
    if (!imageBase64) return res.status(400).json({ error: 'No image provided' });

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-opus-4-6',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: imageBase64 }
            },
            {
              type: 'text',
              text: 'Eres un asistente de administración de un restaurante italiano en México. Analiza esta imagen de ticket o factura y extrae toda la información disponible. Responde ÚNICAMENTE con un JSON con esta estructura exacta, sin texto adicional, sin markdown, sin backticks: {"proveedor": "string", "fecha": "DD/MM/YYYY", "categoria": "una de: Carnicería, Mariscos, Abarrotes, Lácteos, Walmart, Costco, Mercado, Panadería, Vinos, Licores, Refrescos, Materias Primas, Semillas", "productos": [{"nombre": "string", "cantidad": 1, "unidad": "string", "costo_unitario": 0}], "total": 0}'
            }
          ]
        }]
      })
    });

    const data = await response.json();
    const text = data.content?.[0]?.text || '';
    
    let parsed;
    try {
      parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    } catch {
      parsed = { error: 'No se pudo leer el ticket', raw: text };
    }

    res.status(200).json(parsed);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
