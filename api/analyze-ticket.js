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

        const fileBlock = isPDF
            ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: imageBase64 } }
                  : { type: 'image',    source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: imageBase64 } };

        const prompt = 'Eres un asistente contable de un restaurante italiano en Mexico. ' +
                  'Analiza este ' + (isPDF ? 'CFDI/factura PDF' : 'ticket o factura') + ' y extrae los datos exactos. ' +
                  'REGLAS CRITICAS: ' +
                  '1. cantidad = el numero de piezas/botellas/kg comprados (campo "Cant" en la factura). NUNCA pongas 0. ' +
                  '2. costo_unitario = precio NETO por unidad SIN IVA (campo "Pr. Un." en CFDIs). ' +
                  '3. total = el TOTAL FINAL de la factura CON IVA incluido. ' +
                  '4. Para CFDIs mexicanos: la unidad H87 = botella/pieza, KGM = kg. ' +
                  'Responde UNICAMENTE con JSON valido sin texto adicional ni backticks: ' +
                  '{"proveedor":"NOMBRE EN MAYUSCULAS","fecha":"DD/MM/YYYY",' +
                  '"categoria":"Vinos","total":4171.00,' +
                  '"productos":[{"nombre":"NOMBRE COMPLETO EN MAYUSCULAS","cantidad":4,"unidad":"bot","costo_unitario":141.38}]}. ' +
                  'Categorias validas: Carniceria, Mariscos, Abarrotes, Lacteos, Frutas y Verduras, Vinos, Licores, Refrescos, Panaderia, Limpieza, Semillas, Otros insumos. ' +
                  'Unidades validas: kg, pza, bot, lt, caja. ' +
                  'IMPORTANTE: extrae TODOS los productos de la factura con sus cantidades reales.';

        const response = await fetch('https://api.anthropic.com/v1/messages', {
                  method: 'POST',
                  headers: {
                              'Content-Type': 'application/json',
                              'x-api-key': process.env.ANTHROPIC_API_KEY,
                              'anthropic-version': '2023-06-01'
                  },
                  body: JSON.stringify({
                              model: 'claude-sonnet-4-20250514',
                              max_tokens: 2000,
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
