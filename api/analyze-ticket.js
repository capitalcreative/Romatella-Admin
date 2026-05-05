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
      'NUNCA uses "SUBTOTAL" como total. El SUBTOTAL es antes de descuentos e IVA, no es el total real. ' +
      'Ejemplo correcto: Subtotal $6349.70, Descuento -$460.83, IVA $176.59 → total = $6065.46. ' +

      'PASO 2 — IDENTIFICA EL EMISOR: ' +
      'Lee el campo "EMISOR" o nombre de la empresa en la parte superior del documento. ' +

      'PASO 3 — APLICA LAS REGLAS SEGUN EL EMISOR: ' +

      'REGLA A — COSTCO DE MEXICO / COSTCO WHOLESALE: ' +
      '  - tiene_iva = true. ' +
      '  - costo_unitario = campo "VALOR UNITARIO" de cada producto. Ese valor ya es precio NETO SIN IVA. ' +
      '  - NUNCA dividas el Valor Unitario entre 1.16. Ya esta en neto. ' +
      '  - NUNCA uses el campo "IMPORTE" como costo_unitario (IMPORTE = Valor Unitario x Cantidad). ' +
      '  - cantidad = columna "CANTIDAD" (puede ser decimal para KGM/kilogramos). ' +
      '  - Unidades: H87 = pza, KGM = kg, LTR = lt, XBX = caja. ' +
      '  - Omite el producto "DIFUSOR" o articulos de hogar que no sean insumos del restaurante. ' +
      '  - total = campo "Total" del resumen final (NUNCA el Subtotal). ' +

      'REGLA B — NUEVA WAL MART DE MEXICO / WALMART / BODEGA AURRERA: ' +
      '  - Identifica si es CFDI (tiene UUID/Folio Fiscal) o ticket de caja simple. ' +
      '  - Si es CFDI con UUID: tiene_iva = true. ' +
      '    costo_unitario = campo "VALOR UNITARIO" (precio neto sin IVA). ' +
      '    Algunos productos tienen descuento individual en columna DESCUENTO — usa el Valor Unitario tal como aparece. ' +
      '  - Si es ticket simple sin UUID: tiene_iva = false. ' +
      '    costo_unitario = precio por pieza tal como aparece. ' +
      '  - En ambos casos: total = campo "TOTAL" del resumen. NUNCA el "SUBTOTAL". ' +
      '  - Si aparece campo "IEPS" separado, IGNORALO completamente. ' +

      'REGLA C — SORIANA / CHEDRAUI / LA COMER (tickets de caja): ' +
      '  - tiene_iva = false. ' +
      '  - costo_unitario = precio por pieza tal como aparece. ' +
      '  - total = campo "TOTAL" al final. NUNCA el "SUBTOTAL". ' +

      'REGLA D — CUALQUIER OTRO CFDI CON UUID (proveedores, carniceria, mariscos, etc): ' +
      '  - tiene_iva = true. ' +
      '  - costo_unitario = campo "Precio Unitario" o "Valor Unitario" (precio neto sin IVA). ' +
      '  - total = campo "Total" del CFDI. ' +

      'REGLA E — NOTAS DE VENTA / TICKETS SIN IVA DESGLOSADO: ' +
      '  - tiene_iva = false. ' +
      '  - costo_unitario = precio tal como aparece. ' +
      '  - total = total final del documento. ' +

      'PASO 4 — EXTRAE TODOS LOS PRODUCTOS DEL DOCUMENTO: ' +
      '  - Incluye TODOS los productos, incluso los que tienen descuento individual. ' +
      '  - Omite estas lineas: impuestos globales, descuentos globales, servicios de facturacion. ' +
      '  - Omite articulos de hogar o limpieza personal que claramente no son insumos de restaurante ' +
      '    (ejemplo: difusores electricos, ropa, electrodomesticos). ' +
      '  - Si cantidad = 0 o precio = 0, omite el producto. ' +
      '  - Nombres: usa la descripcion legible, no el codigo de barras ni numero de item. ' +
      '  - Para Costco: el nombre viene en columna "Descripcion", usalo completo pero sin el codigo numerico inicial. ' +

      'PASO 5 — ASIGNA UNA SOLA CATEGORIA para toda la compra (la de mayor valor): ' +
      '  - Carnes/aves -> Carniceria. ' +
      '  - Mariscos/pescados/anchoas -> Mariscos. ' +
      '  - Quesos, leche, crema, mantequilla -> Lacteos. ' +
      '  - Pastas, arroz, aceite, conservas, pure de tomate -> Abarrotes. ' +
      '  - Lechuga, arugula, blueberries, frutas, verduras -> Frutas y Verduras. ' +
      '  - Cervezas, vinos, prosecco, licores -> Licores o Vinos. ' +
      '  - Limpiadores, papel, lavatrastes -> Limpieza. ' +
      '  - Si hay mezcla, usa la categoria del producto de mayor subtotal. ' +

      'Responde UNICAMENTE con JSON valido, sin texto, sin backticks, sin comentarios: ' +
      '{"proveedor":"COSTCO DE MEXICO","fecha":"04/05/2026","categoria":"Abarrotes","total":6065.46,"tiene_iva":true,' +
      '"productos":[' +
      '{"nombre":"ACEITE PURO DE OLIVA 3L KIRKLAND","cantidad":1,"unidad":"pza","costo_unitario":357.02},' +
      '{"nombre":"PECHUGA DE POLLO SIN PIEL","cantidad":3.214,"unidad":"kg","costo_unitario":138.10}' +
      ']}. ' +
      'Categorias validas: Carniceria, Mariscos, Abarrotes, Lacteos, Frutas y Verduras, Vinos, Licores, Refrescos, Panaderia, Limpieza, Semillas, Otros insumos. ' +
      'Extrae ABSOLUTAMENTE TODOS los productos insumos del documento sin omitir ninguno.';

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
