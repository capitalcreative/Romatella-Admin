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
      'Eres un asistente contable experto de un restaurante en Mexico. ' +
      'Analiza este ' + (isPDF ? 'CFDI/factura PDF' : 'ticket o factura') + ' y extrae los datos con precision absoluta. ' +

      'PASO 1 — IDENTIFICA EL PROVEEDOR antes de cualquier otra cosa. ' +
      'Busca el nombre del emisor/tienda en la parte superior del documento. ' +

      'PASO 2 — APLICA LAS REGLAS SEGUN EL PROVEEDOR IDENTIFICADO: ' +

      'REGLA A — WALMART / WALMART SUPERCENTER / BODEGA AURRERA / SORIANA / CHEDRAUI: ' +
      '  - tiene_iva = false. Sus tickets NO muestran IVA desglosado. ' +
      '  - costo_unitario = precio unitario TAL COMO APARECE en el ticket (ya incluye IVA). ' +
      '  - El precio por pieza generalmente aparece despues del nombre del producto. ' +
      '  - Si aparece "IEPS" como campo separado, IGNORALO, no lo sumes al precio. ' +
      '  - total = el campo "TOTAL" al final del ticket. NUNCA uses el campo "SUBTOTAL". ' +
      '  - Para productos por kg: precio_unitario = precio por kg que aparece en la etiqueta. ' +
      '  - cantidad = numero de piezas o kg comprados. ' +

      'REGLA B — COSTCO / COSTCO WHOLESALE: ' +
      '  - tiene_iva = true. Costco desglosa IVA en su factura. ' +
      '  - ATENCION: en el listado de productos de Costco, el precio que aparece junto al articulo YA INCLUYE IVA. ' +
      '  - costo_unitario = precio del articulo DIVIDIDO entre 1.16 para obtener precio neto sin IVA. ' +
      '  - Ejemplo: si el articulo dice $232.00, costo_unitario = 232.00 / 1.16 = 200.00 ' +
      '  - total = campo "TOTAL" al final (con IVA incluido). ' +
      '  - El nombre del producto esta despues del numero de item (ej: "1234567  ACEITE OLIVA 2L  $232.00"). ' +
      '  - Extrae el nombre descriptivo, no el codigo numerico de item. ' +

      'REGLA C — FACTURAS CFDI ELECTRONICAS (tienen campo "UUID" o "Folio Fiscal"): ' +
      '  - tiene_iva = true. ' +
      '  - costo_unitario = precio NETO SIN IVA del campo "Precio Unitario" o "Valor Unitario". ' +
      '  - NUNCA uses el campo "Importe" que ya lleva IVA sumado. ' +
      '  - total = campo "Total" del CFDI (monto final con IVA). ' +
      '  - Para CFDIs: H87 = pieza/botella, KGM = kg, E48 = servicio, LTR = litro. ' +

      'REGLA D — CUALQUIER OTRO TICKET O NOTA DE VENTA SIN IVA DESGLOSADO: ' +
      '  - tiene_iva = false. ' +
      '  - costo_unitario = precio tal como aparece. ' +
      '  - total = total final del documento. ' +

      'PASO 3 — EXTRAE TODOS LOS PRODUCTOS: ' +
      '  - cantidad = numero REAL de piezas/kg/litros. NUNCA pongas 0. ' +
      '  - Si un producto tiene descuento aplicado, usa el precio DESPUES del descuento. ' +
      '  - Omite lineas que sean: impuestos, descuentos globales, cargos por servicio, propinas. ' +
      '  - Omite productos con cantidad 0 o precio 0. ' +

      'PASO 4 — VERIFICA EL CUADRE: ' +
      '  - Suma todos los subtotales (cantidad x costo_unitario). ' +
      '  - Si tiene_iva = true, multiplica la suma por 1.16. ' +
      '  - El resultado debe ser cercano al total. Si hay diferencia grande, revisa los precios. ' +

      'Responde UNICAMENTE con JSON valido, sin texto adicional, sin backticks, sin comentarios: ' +
      '{"proveedor":"WALMART","fecha":"DD/MM/YYYY","categoria":"Abarrotes","total":1922.35,"tiene_iva":false,' +
      '"productos":[{"nombre":"ACEITE VEGETAL 3L","cantidad":2,"unidad":"pza","costo_unitario":89.90}]}. ' +

      'Categorias validas: Carniceria, Mariscos, Abarrotes, Lacteos, Frutas y Verduras, Vinos, Licores, Refrescos, Panaderia, Limpieza, Semillas, Otros insumos. ' +
      'Unidades validas: kg, pza, bot, lt, caja. ' +
      'Extrae ABSOLUTAMENTE TODOS los productos del documento sin omitir ninguno.';

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
