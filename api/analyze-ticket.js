export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
        const { imageBase64, mediaType } = req.body;
        if (!imageBase64) return res.status(400).json({ error: 'No file provided' });

      const isPDF = mediaType === 'application/pdf';

      // Construir bloque correcto: document para PDF, image para imagenes
      const fileBlock = isPDF
          ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: imageBase64 } }
              : { type: 'image',    source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: imageBase64 } };

      const prompt = 'Eres un asistente de administracion de un restaurante italiano en Mexico. ' +
              'Analiza este ' + (isPDF ? 'PDF de factura' : 'ticket o factura') + ' y extrae la informacion. ' +
              'Responde UNICAMENTE con JSON valido sin texto adicional ni backticks. ' +
              'Estructura: {"proveedor":"NOMBRE EN MAYUSCULAS","fecha":"DD/MM/YYYY",' +
              '"categoria":"Carniceria","forma_pago":"Efectivo",' +
              '"productos":[{"nombre":"PRODUCTO","cantidad":1,"unidad":"kg","costo_unitario":100}],"total":100}. ' +
              'Categorias: Carniceria, Mariscos, Abarrotes, Lacteos, Frutas y Verduras, Vinos, Licores, Refrescos, Panaderia, Limpieza, Semillas, Otros insumos. ' +
              'costo_unitario es precio POR UNIDAD, no subtotal. Omite campos que no encuentres.';

      const response = await fetch('https://api.anthropic.com/v1/messages', {
              method: 'POST',
              headers: {
                        'Content-Type': 'application/json',
                        'x-api-key': process.env.ANTHROPIC_API_KEY,
                        'anthropic-version': '2023-06-01'
              },
              body: JSON.stringify({
                        model: 'claude-sonnet-4-20250514',
                        max_tokens: 1500,
                        messages: [{ role: 'user', content: [fileBlock, { type: 'text', text: prompt }] }]
              })
      });

      const data = await response.json();
        if (data.error) return res.status(500).json({ error: data.error.message || 'Claude API error' });

      const text = data.content?.[0]?.text || '{}';
        const cleaned = text.replace(/```json/g, '').replace(/```/g, '').trim();

      let parsed;
        try {
                parsed = JSON.parse(cleaned);
        } catch(e) {
                const match = cleaned.match(/\{[\s\S]*\}/);
                if (match) {
                          parsed = JSON.parse(match[0]);
                } else {
                          return res.status(200).json({ error: 'No se pudo leer el documento', raw: text });
                }
        }

      return res.status(200).json(parsed);

  } catch (error) {
        return res.status(500).json({ error: error.message });
  }
}
