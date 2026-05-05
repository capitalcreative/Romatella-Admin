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
      'Analiza este ' + (isPDF ? 'CFDI/factura PDF' : 'ticket o factura') + ' y extrae los datos EXACTOS como aparecen. ' +

      'PASO 1 — LEE EL RESUMEN FINAL PRIMERO: ' +
      'Busca el bloque SUBTOTAL / DESCUENTO / IVA / TOTAL al final del documento. ' +
      'El campo "total" del JSON = campo TOTAL de ese resumen. NUNCA el SUBTOTAL. ' +

      'PASO 2 — IDENTIFICA EL EMISOR y TIPO DE DOCUMENTO: ' +
      'Lee el nombre del emisor. Determina si es CFDI (tiene UUID/Folio Fiscal) o ticket simple. ' +

      'PASO 3 — MODO DE EXTRACCION SEGUN EMISOR: ' +

      'MODO 1 — WALMART CFDI / BODEGA AURRERA CFDI (con UUID): ' +
      '  tiene_iva = "cfdi_walmart" ' +
      '  Para cada producto extrae: ' +
      '    - nombre: descripcion legible ' +
      '    - cantidad: columna CANTIDAD ' +
      '    - unidad: H87=pza, KGM=kg, LTR=lt, XBX=caja ' +
      '    - valor_unitario: columna VALOR UNITARIO exacto ' +
      '    - importe: columna IMPORTE exacto ' +
      '    - descuento: columna DESCUENTO (0 si no tiene) ' +
      '    - tasa_iva: numero de la tasa (16, 0, o -1 si es Exento) ' +
      '    - costo_unitario: pon 0, el sistema lo calculara ' +

      'MODO 2 — COSTCO DE MEXICO / COSTCO WHOLESALE: ' +
      '  tiene_iva = true ' +
      '  costo_unitario = campo VALOR UNITARIO exacto (ya es neto sin IVA, NO dividas entre 1.16) ' +
      '  importe, descuento, tasa_iva: no necesarios, puedes omitirlos ' +

      'MODO 3 — TICKET SIMPLE SIN UUID (Walmart ticket, Soriana, Chedraui, La Comer): ' +
      '  tiene_iva = false ' +
      '  costo_unitario = precio por pieza tal como aparece ' +

      'MODO 4 — CUALQUIER OTRO CFDI CON UUID (carniceria, mariscos, vinos, otros): ' +
      '  tiene_iva = true ' +
      '  costo_unitario = campo Valor Unitario o Precio Unitario neto sin IVA ' +

      'PASO 4 — EXTRAE TODOS LOS RENGLONES: ' +
      '  - Incluye todos los productos Y servicios (membresias, servicios de facturacion como REVISTA). ' +
      '  - Solo omite: lineas de totales globales, lineas de IVA global, lineas de descuento global. ' +
      '  - Omite articulos de hogar que no son insumos (difusores electricos, ropa). ' +
      '  - Si cantidad=0 o todos los precios=0, omite el renglon. ' +

      'PASO 5 — CATEGORIA de la compra (la de mayor valor): ' +
      '  Carnes/aves=Carniceria, Mariscos=Mariscos, Quesos/leche=Lacteos, ' +
      '  Pastas/arroz/aceite=Abarrotes, Frutas/verduras=Frutas y Verduras, ' +
      '  Vinos=Vinos, Cervezas/licores=Licores, Limpiadores=Limpieza. ' +
      '  Si hay mezcla usa la categoria del producto de mayor subtotal. ' +

      'Responde UNICAMENTE con JSON valido sin texto ni backticks. ' +
      'Para MODO 1 (Walmart CFDI) usa este formato: ' +
      '{"proveedor":"NUEVA WAL MART DE MEXICO","fecha":"04/05/2026","categoria":"Licores","total":4891.50,"tiene_iva":"cfdi_walmart",' +
      '"productos":[' +
      '{"nombre":"STELLA 6","cantidad":2,"unidad":"pza","valor_unitario":129.31,"importe":258.62,"descuento":78.45,"tasa_iva":16,"costo_unitario":0},' +
      '{"nombre":"SM ARBORIO","cantidad":1,"unidad":"pza","valor_unitario":72.00,"importe":72.00,"descuento":0,"tasa_iva":0,"costo_unitario":0},' +
      '{"nombre":"REVISTA","cantidad":1,"unidad":"pza","valor_unitario":111.00,"importe":111.00,"descuento":0,"tasa_iva":-1,"costo_unitario":0}' +
      ']}. ' +
      'Para otros modos usa: ' +
      '{"proveedor":"COSTCO DE MEXICO","fecha":"04/05/2026","categoria":"Abarrotes","total":6065.46,"tiene_iva":true,' +
      '"productos":[{"nombre":"ACEITE OLIVA 3L KIRKLAND","cantidad":1,"unidad":"pza","costo_unitario":357.02}]}. ' +
      'Categorias: Carniceria, Mariscos, Abarrotes, Lacteos, Frutas y Verduras, Vinos, Licores, Refrescos, Panaderia, Limpieza, Semillas, Otros insumos. ' +
      'Extrae ABSOLUTAMENTE TODOS los renglones del documento.';

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

    // POST-PROCESS: calcular costo_unitario para Walmart CFDI en el backend
    // Asi el frontend recibe siempre el mismo formato simple
    if (parsed.tiene_iva === 'cfdi_walmart' && parsed.productos?.length) {
      parsed.tiene_iva = false; // el frontend no multiplica
      parsed.productos = parsed.productos.map(p => {
        const importe    = parseFloat(p.importe)         || 0;
        const descuento  = parseFloat(p.descuento)       || 0;
        const cantidad   = parseFloat(p.cantidad)         || 1;
        const tasa       = parseFloat(p.tasa_iva)         ?? 16;
        const baseNeta   = importe - descuento;
        let subtotalFinal;
        if (tasa === -1) {
          subtotalFinal = baseNeta; // exento
        } else {
          subtotalFinal = baseNeta * (1 + tasa / 100);
        }
        const costoUnitario = Math.round((subtotalFinal / cantidad) * 10000) / 10000;
        return {
          nombre:         p.nombre,
          cantidad:       p.cantidad,
          unidad:         p.unidad,
          costo_unitario: costoUnitario
        };
      });
    }

    return res.status(200).json(parsed);

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
