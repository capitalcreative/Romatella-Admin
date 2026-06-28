// Cron: revisa insumos monitoreados vs ventas de Loyverse y avisa por Telegram
// Programado en vercel.json. Lee config de Supabase (tabla insumos_monitor).

const SUP_URL   = process.env.SUPABASE_URL;
const SUP_KEY   = process.env.SUPABASE_KEY;
const LOY_TOKEN = process.env.LOYVERSE_TOKEN;
const TG_TOKEN  = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT   = process.env.TELEGRAM_CHAT_ID;

function num(v) { const n = parseFloat(String(v).replace(',', '.')); return isNaN(n) ? 0 : n; }
function modTexto(m) { return [m.option, m.name, m.modifier_option, m.modifier_name].filter(Boolean).join(' '); }

async function supSelect(table) {
  const r = await fetch(`${SUP_URL}/rest/v1/${table}?select=*&limit=500`, {
    headers: { apikey: SUP_KEY, Authorization: `Bearer ${SUP_KEY}` }
  });
  const t = await r.text();
  return t ? JSON.parse(t) : [];
}
async function supPatch(table, id, data) {
  await fetch(`${SUP_URL}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { apikey: SUP_KEY, Authorization: `Bearer ${SUP_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(data)
  });
}

// Trae recibos de Loyverse paginando (hasta 6 páginas = 1500 tickets)
async function loyReceipts(desdeISO) {
  let receipts = [], cursor = null, pages = 0;
  do {
    let url = `https://api.loyverse.com/v1.0/receipts?limit=250&created_at_min=${encodeURIComponent(desdeISO)}`;
    if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${LOY_TOKEN}` } });
    if (!r.ok) break;
    const d = await r.json();
    receipts = receipts.concat(d.receipts || []);
    cursor = d.cursor || null;
    pages++;
  } while (cursor && pages < 6);
  return receipts;
}

function fechaTs(f) {
  if (!f) return 0;
  return new Date(/[T ]\d/.test(f) ? f : (f + 'T00:00:00')).getTime();
}
function calcConsumo(insumo, receipts) {
  const desdeTs = fechaTs(insumo.fecha);
  const reglas = Array.isArray(insumo.reglas) ? insumo.reglas
    : (() => { try { return JSON.parse(insumo.reglas || '[]'); } catch { return []; } })();
  const platilloRules = reglas.filter(r => r.tipo === 'platillo' && (r.match || '').trim());
  const modRules      = reglas.filter(r => r.tipo === 'modificador' && (r.match || '').trim());
  // Regla más específica (match más largo) → evita doble-conteo (ej. "Doble Tocino" vs "Tocino")
  const mejorConsumo = (texto, rules) => {
    const t = (texto || '').toLowerCase();
    let bestLen = -1, bestCons = 0;
    rules.forEach(r => {
      const m = (r.match || '').toLowerCase().trim();
      if (t.includes(m) && m.length > bestLen) { bestLen = m.length; bestCons = num(r.consumo); }
    });
    return bestCons;
  };
  let consumido = 0;
  receipts.forEach(r => {
    const ts = new Date(r.receipt_date || r.created_at || 0).getTime();
    if (ts < desdeTs) return;
    (r.line_items || []).forEach(li => {
      const qty = parseFloat(li.quantity) || 0;
      const cp = mejorConsumo(li.item_name, platilloRules);
      if (cp > 0) consumido += qty * cp;
      (li.line_modifiers || []).forEach(m => {
        const cm = mejorConsumo(modTexto(m), modRules);
        if (cm > 0) consumido += qty * cm;
      });
    });
  });
  return Math.round(consumido * 1000) / 1000;
}

async function sendTelegram(text) {
  const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TG_CHAT, text, parse_mode: 'Markdown', disable_web_page_preview: true })
  });
  return r.ok;
}

export default async function handler(req, res) {
  // Seguridad opcional: si hay CRON_SECRET, exigir el header de Vercel
  if (process.env.CRON_SECRET) {
    const auth = req.headers['authorization'] || '';
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) return res.status(401).json({ error: 'no autorizado' });
  }
  if (!SUP_URL || !SUP_KEY) return res.status(500).json({ error: 'Supabase no configurado' });
  if (!LOY_TOKEN)           return res.status(500).json({ error: 'Loyverse no configurado' });
  if (!TG_TOKEN || !TG_CHAT) {
    return res.status(500).json({
      error: 'Telegram no configurado',
      detalle: {
        TELEGRAM_BOT_TOKEN: TG_TOKEN ? 'presente' : 'FALTA',
        TELEGRAM_CHAT_ID:   TG_CHAT  ? 'presente' : 'FALTA'
      },
      vars_telegram_detectadas: Object.keys(process.env).filter(k => k.toUpperCase().includes('TELEGRAM'))
    });
  }

  try {
    const insumos = await supSelect('insumos_monitor');
    if (!Array.isArray(insumos) || !insumos.length) return res.status(200).json({ ok: true, msg: 'sin insumos' });

    // Fecha base más antigua para una sola llamada a Loyverse
    let desde = new Date().toISOString().split('T')[0];
    insumos.forEach(i => { const f = (i.fecha || '').slice(0,10); if (f && f < desde) desde = f; });
    const receipts = await loyReceipts(desde + 'T00:00:00.000Z');

    const hoy = new Date().toISOString().split('T')[0];
    const bajos = [];
    const updates = [];

    for (const ins of insumos) {
      const consumido = calcConsumo(ins, receipts);
      const est = Math.round((num(ins.base) - consumido) * 1000) / 1000;
      const umbral = num(ins.umbral);
      const estaBajo = est <= umbral;

      if (estaBajo) {
        bajos.push({ ...ins, est, consumido });
        // Avisar solo si no se avisó hoy
        if (ins.alertado_fecha !== hoy) updates.push({ id: ins.id, data: { alertado_fecha: hoy } });
      } else if (ins.alertado_fecha) {
        // Se reabasteció: limpiar para poder volver a avisar
        updates.push({ id: ins.id, data: { alertado_fecha: null } });
      }
    }

    // ¿Hay algún bajo que aún no se haya avisado hoy?
    const nuevos = bajos.filter(b => b.alertado_fecha !== hoy);
    let enviado = false;
    if (nuevos.length) {
      let msg = '⚠️ *Romatella — Insumos por reabastecer*\n';
      bajos.forEach(b => {
        msg += `\n• *${b.nombre}*: ${b.est} ${b.unidad || ''} (alerta bajo ${num(b.umbral)})`;
      });
      msg += `\n\nConsumo calculado desde el conteo base. Actualiza el conteo físico cuando reabastezcas.`;
      enviado = await sendTelegram(msg);
    }

    // Persistir cambios de estado
    for (const u of updates) { try { await supPatch('insumos_monitor', u.id, u.data); } catch {} }

    return res.status(200).json({ ok: true, insumos: insumos.length, bajos: bajos.length, enviado });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
