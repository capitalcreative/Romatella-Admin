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

      'PASO 1 — LEE EL RESUMEN FINAL PRIMERO (ultima pagina o seccion de totales): ' +
      'Busca el bloque con campos: SUBTOTAL / DESCUENTO / IVA / TOTAL. ' +
      'El campo "total" de tu respuesta JSON es SIEMPRE el campo "TOTAL" de ese resumen. ' +
      'NUNCA uses "SUBTOTAL" como total. El SUBTOTAL es antes de descuentos e IVA. ' +

      'PASO 2 — IDENTIFICA EL EMISOR: ' +
      'Lee el campo "EMISOR" o nombre de la empresa en la parte superior. ' +

      'PASO 3 — APLICA LAS REGLAS SEGUN EL EMISOR: ' +

      'REGLA A — COSTCO DE MEXICO / COSTCO WHOLESALE: ' +
      '  - tiene_iva = true. ' +
      '  - costo_unitario = campo "VALOR UNITARIO" exacto. Ese valor es precio NETO sin IVA. ' +
      '  - NUNCA dividas entre 1.16. NUNCA uses el campo "IMPORTE". ' +
      '  - cantidad = columna "CANTIDAD" (decimal para KGM). ' +
      '  - Unidades: H87 = pza, KGM = kg, LTR = lt, XBX = caja. ' +
      '  - total = campo "Total" del resumen final. ' +

      'REGLA B — NUEVA WAL MART DE MEXICO / WALMART / BODEGA AURRERA (CFDI con UUID): ' +
      '  - tiene_iva = false. ' +
      '  - RAZON: Walmart CFDI tiene descuentos individuales por producto. Para que la suma de partidas ' +
      '    cuadre con el TOTAL, debes devolver el precio final real por pieza ya con IVA y descuento aplicados. ' +
      '  - Para cada producto CALCULA el costo_unitario asi: ' +
      '    a) Si el producto tiene tasa IVA 16% Y tiene DESCUENTO: ' +
      '       costo_unitario = ((IMPORTE - DESCUENTO) / CANTIDAD) * 1.16, redondeado a 2 decimales. ' +
      '    b) Si el producto tiene tasa IVA 16% SIN descuento: ' +
      '       costo_unitario = VALOR_UNITARIO * 1.16, redondeado a 2 decimales. ' +
      '    c) Si el producto tiene tasa IVA 0% (alimentos basicos: pasta, arroz, pan, verduras, anchoas): ' +
      '       Si tiene DESCUENTO: costo_unitario = (IMPORTE - DESCUENTO) / CANTIDAD. ' +
      '       Sin descuento: costo_unitario = VALOR_UNITARIO tal cual. ' +
      '    d) Si el producto es EXENTO de IVA (campo "Exento"): ' +
      '       costo_unitario = VALOR_UNITARIO tal cual. ' +
      '  - cantidad = columna CANTIDAD. ' +
      '  - total = campo TOTAL del resumen (con descuentos e IVA ya aplicados). ' +

      'REGLA C — WALMART TICKET SIMPLE (sin UUID, sin Folio Fiscal): ' +
      '  - tiene_iva = false. ' +
      '  - costo_unitario = precio por pieza tal como aparece en el ticket. ' +
      '  - total = campo TOTAL al fondo. NUNCA el SUBTOTAL. ' +

      'REGLA D — SORIANA / CHEDRAUI / LA COMER (tickets de caja): ' +
      '  - tiene_iva = false. ' +
      '  - costo_unitario = precio por pieza tal como aparece. ' +
      '  - total = campo TOTAL al final. ' +

      'REGLA E — CUALQUIER OTRO CFDI CON UUID (carniceria, mariscos, vinos, otros proveedores): ' +
      '  - tiene_iva = true. ' +
      '  - costo_unitario = campo "Precio Unitario" o "Valor Unitario" neto sin IVA. ' +
      '  - total = campo Total del CFDI. ' +

      'REGLA F — NOTAS DE VENTA / TICKETS SIN IVA DESGLOSADO: ' +
      '  - tiene_iva = false. ' +
      '  - costo_unitario = precio tal como aparece. ' +

      'PASO 4 — EXTRAE TODOS LOS PRODUCTOS Y CARGOS DEL DOCUMENTO: ' +
      '  - Incluye TODOS los renglones de la factura, incluso los que tienen descuento individual. ' +
      '  - Incluye servicios de facturacion (ej. REVISTA de membresia de Walmart) como "Otros insumos". ' +
      '  - SOLO omite: lineas de totales, lineas de impuestos globales, lineas de descuento global. ' +
      '  - Omite articulos de hogar que no son insumos (difusores electricos, ropa, electrodomesticos). ' +
      '  - Si cantidad = 0 o precio = 0, omite el producto. ' +
      '  - Nombres: descripcion legible, sin codigos de barras. ' +

      'PASO 5 — CATEGORIA general de la compra (la de mayor valor total): ' +
      '  - Carnes/aves → Carniceria. Mariscos/pescados → Mariscos. ' +
      '  - Quesos/leche/crema → Lacteos. Pastas/arroz/aceite/conservas → Abarrotes. ' +
      '  - Frutas/verduras → Frutas y Verduras. Vinos/prosecco → Vinos. ' +
      '  - Cervezas/licores → Licores. Limpiadores → Limpieza. ' +
      '  - Si hay mezcla, usa la categoria del producto de mayor subtotal. ' +

      'Responde UNICAMENTE con JSON valido, sin texto, sin backticks: ' +
      '{"proveedor":"NUEVA WAL MART DE MEXICO","fecha":"04/05/2026","categoria":"Licores","total":4891.50,"tiene_iva":false,' +
      '"productos":[' +
      '{"nombre":"STELLA 6","cantidad":2,"unidad":"pza","costo_unitario":104.50},' +
      '{"nombre":"VP CHIV 12","cantidad":1,"unidad":"pza","costo_unitario":659.00}' +
      ']}. ' +
      'Categorias validas: Carniceria, Mariscos, Abarrotes, Lacteos, Frutas y Verduras, Vinos, Licores, Refrescos, Panaderia, Limpieza, Semillas, Otros insumos. ' +
      'Extrae ABSOLUTAMENTE TODOS los renglones del documento incluyendo servicios y membresías.';

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
