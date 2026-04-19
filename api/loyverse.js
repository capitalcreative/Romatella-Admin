export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const TOKEN = process.env.LOYVERSE_TOKEN;
  if (!TOKEN) return res.status(500).json({ error: 'LOYVERSE_TOKEN no configurado' });

  const { endpoint, date_from, date_to, limit, cursor } = req.query;

  const HEADERS = {
    'Authorization': `Bearer ${TOKEN}`,
    'Content-Type': 'application/json'
  };

  // ─── Función auxiliar: paginación completa con cursor ──────────────────────
  // Loyverse usa cursor-based pagination: el campo `cursor` en la respuesta
  // indica que hay más páginas. Se itera hasta que no haya cursor.
  async function fetchAllPages(baseUrl, dataKey) {
    let allItems = [];
    let nextCursor = cursor || null; // permite pasar cursor externo si se quiere
    let url = baseUrl + (nextCursor ? '&cursor=' + encodeURIComponent(nextCursor) : '');
    let pages = 0;
    const MAX_PAGES = 20; // safety cap: 20 × 250 = 5,000 recibos

    do {
      const resp = await fetch(url, { headers: HEADERS });
      if (!resp.ok) {
        const err = await resp.text();
        throw new Error('Loyverse ' + resp.status + ': ' + err);
      }
      const data = await resp.json();
      const items = data[dataKey] || [];
      allItems = allItems.concat(items);
      nextCursor = data.cursor || null;
      url = baseUrl + (nextCursor ? '&cursor=' + encodeURIComponent(nextCursor) : '');
      pages++;
    } while (nextCursor && pages < MAX_PAGES);

    return { [dataKey]: allItems, total_pages: pages, total_items: allItems.length };
  }

  try {
    // ─── ENDPOINT: receipts (simple, 1 página, legacy) ────────────────────
    if (endpoint === 'receipts') {
      const url = `https://api.loyverse.com/v1.0/receipts?limit=${limit||50}`
        + (date_from ? '&created_at_min=' + date_from : '')
        + (date_to   ? '&created_at_max=' + date_to   : '');
      const resp = await fetch(url, { headers: HEADERS });
      if (!resp.ok) { const e = await resp.text(); return res.status(resp.status).json({ error: e }); }
      return res.status(200).json(await resp.json());
    }

    // ─── ENDPOINT: summary — TODOS los recibos del período con paginación ──
    if (endpoint === 'summary') {
      const baseUrl = 'https://api.loyverse.com/v1.0/receipts?limit=250'
        + (date_from ? '&created_at_min=' + encodeURIComponent(date_from) : '')
        + (date_to   ? '&created_at_max=' + encodeURIComponent(date_to)   : '');
      const result = await fetchAllPages(baseUrl, 'receipts');
      return res.status(200).json(result);
    }

    // ─── ENDPOINT: shifts — turnos con PAY_OUT ────────────────────────────
    if (endpoint === 'shifts') {
      const baseUrl = 'https://api.loyverse.com/v1.0/shifts?limit=50'
        + (date_from ? '&opened_at_min=' + encodeURIComponent(date_from) : '')
        + (date_to   ? '&opened_at_max=' + encodeURIComponent(date_to)   : '');
      const result = await fetchAllPages(baseUrl, 'shifts');
      return res.status(200).json(result);
    }

    // ─── ENDPOINT: items — catálogo de productos ──────────────────────────
    if (endpoint === 'items') {
      const result = await fetchAllPages('https://api.loyverse.com/v1.0/items?limit=250', 'items');
      return res.status(200).json(result);
    }

    // ─── ENDPOINT: payment_types ──────────────────────────────────────────
    if (endpoint === 'payment_types') {
      const resp = await fetch('https://api.loyverse.com/v1.0/payment_types', { headers: HEADERS });
      if (!resp.ok) { const e = await resp.text(); return res.status(resp.status).json({ error: e }); }
      return res.status(200).json(await resp.json());
    }

    // ─── ENDPOINT: diagnostico — analiza modificadores reales en recibos ──
    // Devuelve un resumen de todos los modifier option_names encontrados
    // en el período, agrupados por frecuencia. Útil para calibrar el mapeo.
    if (endpoint === 'diagnostico') {
      const baseUrl = 'https://api.loyverse.com/v1.0/receipts?limit=250'
        + (date_from ? '&created_at_min=' + encodeURIComponent(date_from) : '')
        + (date_to   ? '&created_at_max=' + encodeURIComponent(date_to)   : '');
      const { receipts } = await fetchAllPages(baseUrl, 'receipts');

      // Analizar estructura de modificadores
      const modifMap  = {}; // { option_name: { count, price_set, en_platillos: {} } }
      const platillos = {}; // { item_name: count }
      let   totalRecibos = receipts.length;
      let   recibosConMods = 0;

      receipts.forEach(r => {
        (r.line_items || []).forEach(li => {
          const base = (li.item_name || '').trim();
          platillos[base] = (platillos[base] || 0) + (li.quantity || 1);

          if (li.modifiers && li.modifiers.length > 0) {
            recibosConMods++;
            li.modifiers.forEach(mod => {
              const optName      = (mod.option_name || mod.modifier_name || '').trim();
              const modifGrp     = (mod.modifier_name || '').trim();
              if (!optName) return;

              if (!modifMap[optName]) {
                modifMap[optName] = {
                  count: 0,
                  modifier_group: modifGrp,
                  price: mod.price || 0,
                  en_platillos: {}
                };
              }
              modifMap[optName].count++;
              modifMap[optName].en_platillos[base] = (modifMap[optName].en_platillos[base] || 0) + 1;
            });
          }
        });
      });

      // Ordenar por frecuencia
      const modifSorted = Object.entries(modifMap)
        .sort((a, b) => b[1].count - a[1].count)
        .map(([name, d]) => ({
          option_name:    name,
          modifier_group: d.modifier_group,
          count:          d.count,
          price:          d.price,
          en_platillos:   d.en_platillos
        }));

      const platSorted = Object.entries(platillos)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 30)
        .map(([name, count]) => ({ name, count }));

      return res.status(200).json({
        periodo:           { from: date_from, to: date_to },
        total_recibos:     totalRecibos,
        recibos_con_mods:  recibosConMods,
        modificadores:     modifSorted,
        top_platillos:     platSorted,
        _hint: 'Usa option_name de modificadores para actualizar receta[] en INV_INSUMOS con prefijo MOD:'
      });
    }

    return res.status(400).json({ error: 'Endpoint invalido: ' + endpoint });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
