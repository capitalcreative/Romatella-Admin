export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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
        model: 'claude-haiku-4-5-20251001',
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
              text: 'Eres un asistente de administración de un restaurante italiano en México. Analiza esta imagen de ticket o factura y extrae toda la información. Responde ÚNICAMENTE con un JSON válido sin texto adicional ni backticks ni markdown. Usa esta estructura exacta: {"proveedor":"nombre del proveedor","fecha":"DD/MM/YYYY","categoria":"Carnicería","productos":[{"nombre":"producto","cantidad":1,"unidad":"kg","costo_unitario":100}],"total":100}'
            }
          ]
        }]
      })
    });

    const data = await response.json();
    
    if (data.error) {
      return res.status(500).json({ error: data.error.message || 'Claude API error' });
    }

    const text = data.content?.[0]?.text || '{}';
    
    // Clean and parse the JSON
    const cleaned = text.replace(/```json/g, '').replace(/```/g, '').trim();
    
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch(e) {
      // Try to extract JSON from text
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (match) {
        parsed = JSON.parse(match[0]);
      } else {
        return res.status(200).json({ error: 'No se pudo leer el ticket', raw: text });
      }
    }

    return res.status(200).json(parsed);
    
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
