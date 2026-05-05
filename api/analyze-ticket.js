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

    const prompt =
      'Eres un asistente contable experto en CFDIs mexicanos para un restaurante. ' +
      'Analiza este ' + (isPDF ? 'CFDI/factura PDF' : 'ticket o factura') + ' con precision absoluta. ' +

      'PASO 1 — LEE EL RESUMEN FINAL PRIMERO (ultima pagina o al final del documento): ' +
      'Busca el bloque que dice: SUBTOTAL / DESCUENTO / IVA / TOTAL. ' +
      'El valor correcto para el campo "total" en tu respuesta es SIEMPRE el campo "TOTAL" de ese resumen final. ' +
      'NUNCA uses el campo "SUBTOTAL" como total. El SUBTOTAL es antes de descuentos e IVA. ' +

      'PASO 2 — IDENTIFICA EL PROVEEDOR: ' +
      'Busca "DATOS EMISOR" o el nombre de la empresa en la parte superior. ' +

      'PASO 3 — REGLAS POR TIPO DE DOCUMENTO: ' +

      'REGLA A — CFDI ELECTRONICO (tiene campo UUID o Folio Fiscal): ' +
      '  - tiene_iva = true. ' +
      '  - costo_unitario = campo "VALOR UNITARIO" de cada producto (precio neto SIN IVA). ' +
      '  - NUNCA uses el campo "IMPORTE" como costo_unitario (ese ya es subtotal por cantidad). ' +
      '  - CRITICO: algunos productos tienen DESCUENTO individual en la columna "DESCUENTO". ' +
      '    En ese caso, el precio real del producto ya tiene el descuento reflejado en la base gravable. ' +
      '    Usa el VALOR UNITARIO tal como aparece — el sistema aplicara IVA automaticamente. ' +
      '  - El "IMPORTE" de cada linea = VALOR UNITARIO x CANTIDAD (sin descuento aplicado todavia). ' +
      '  - cantidad = numero en columna "CANTIDAD". ' +
      '  - WALMART CFDI especificamente: el VALOR UNITARIO ya es el precio neto correcto por pieza. ' +

      'REGLA B — WALMART / SORIANA TICKET DE CAJA (sin UUID, sin Folio Fiscal): ' +
      '  - tiene_iva = false. ' +
      '  - costo_unitario = precio por pieza TAL COMO APARECE en el ticket. ' +
      '  - total = campo "TOTAL" al fondo. NUNCA el campo "SUBTOTAL". ' +
      '  - Si aparece "IEPS" como linea separada, IGNORALO. ' +

      'REGLA C — COSTCO WHOLESALE: ' +
      '  - tiene_iva = true. ' +
      '  - Los precios en el listado de productos de Costco YA incluyen IVA. ' +
      '  - costo_unitario = precio del articulo DIVIDIDO entre 1.16. ' +
      '  - Ejemplo: articulo en $232.00 -> costo_unitario = 200.00. ' +
      '  - total = campo "TOTAL" final. ' +

      'REGLA D — OTRAS FACTURAS O NOTAS SIN IVA DESGLOSADO: ' +
      '  - tiene_iva = false. ' +
      '  - costo_unitario = precio tal como aparece. ' +

      'PASO 4 — EXTRAE TODOS LOS PRODUCTOS: ' +
      '  - Incluye TODOS los productos, incluso los que tienen descuento. ' +
      '  - Omite lineas que sean: impuestos globales, descuentos globales, servicios de facturacion, revistas de membresia. ' +
      '  - Si un producto tiene cantidad 0 o precio 0, omitelo. ' +
      '  - Para nombres: usa la descripcion corta del producto, no el codigo de barras. ' +
      '  - Unidades: usa "pza" para H87-Pieza, "kg" para KGM, "lt" para LTR. ' +

      'PASO 5 — ASIGNA CATEGORIA CORRECTA segun los productos: ' +
      '  - Cervezas, vinos, licores, aperitivos (Aperol, Frangelico, Controy) -> Licores o Vinos segun corresponda. ' +
      '  - Pastas, arroz, condimentos -> Abarrotes. ' +
      '  - Limpieza, papel -> Limpieza. ' +
      '  - Si hay mezcla de categorias, usa la de mayor valor. ' +

      'Responde UNICAMENTE con JSON valido, sin texto adicional, sin backticks, sin comentarios: ' +
      '{"proveedor":"NUEVA WAL MART DE MEXICO","fecha":"DD/MM/YYYY","categoria":"Abarrotes","total":4891.50,"tiene_iva":true,' +
      '"productos":[{"nombre":"STELLA 6","cantidad":2,"unidad":"pza","costo_unitario":129.31}]}. ' +

      'Categorias validas: Carniceria, Mariscos, Abarrotes, Lacteos, Frutas y Verduras, Vinos, Licores, Refrescos, Panaderia, Limpieza, Semillas, Otros insumos. ' +
      'Extrae ABSOLUTAMENTE TODOS los productos del documento.';

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
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
