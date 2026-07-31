/**
 * Cliente da Graph API da Meta (uso exclusivo no servidor).
 *
 * Requer as variáveis de ambiente:
 *   META_ACCESS_TOKEN   — token de acesso com permissão ads_read na conta
 *   META_AD_ACCOUNT_ID  — opcional; padrão é a conta da OC ADV
 *   META_GRAPH_VERSION  — opcional; padrão v21.0
 */

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v21.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

export const AD_ACCOUNT_ID = process.env.META_AD_ACCOUNT_ID || '1585898918220697';

export class MetaError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = 'MetaError';
    this.status = status;
  }
}

function accessToken() {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) {
    throw new MetaError(
      'META_ACCESS_TOKEN não configurado. Defina o token de acesso da Meta nas variáveis de ambiente.',
      503
    );
  }
  return token;
}

function buildUrl(path, params) {
  const url = new URL(`${GRAPH_BASE}/${path}`);
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    url.searchParams.set(key, typeof value === 'string' ? value : JSON.stringify(value));
  });
  url.searchParams.set('access_token', accessToken());
  return url;
}

async function request(url) {
  let res;
  try {
    res = await fetch(url, { headers: { accept: 'application/json' } });
  } catch (e) {
    throw new MetaError(`Falha de rede ao chamar a Graph API: ${e.message}`);
  }
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.error) {
    const msg = json?.error?.error_user_msg || json?.error?.message || `Graph API respondeu ${res.status}`;
    throw new MetaError(msg, res.status === 401 || res.status === 403 ? 403 : 502);
  }
  return json;
}

/** Uma única chamada à Graph API. */
export function graph(path, params) {
  return request(buildUrl(path, params));
}

/** Segue a paginação por cursor e devolve todas as linhas (limitado a maxPages). */
export async function graphAll(path, params, maxPages = 10) {
  const rows = [];
  let json = await request(buildUrl(path, params));
  let pages = 1;
  rows.push(...(json.data || []));
  while (json?.paging?.next && pages < maxPages) {
    json = await request(new URL(json.paging.next));
    rows.push(...(json.data || []));
    pages++;
  }
  return rows;
}

/* ===== Ações / resultados =====
 * A conta trabalha com dois tipos de resultado: leads por formulário
 * (campanhas OUTCOME_LEADS) e conversas iniciadas no WhatsApp
 * (campanhas OUTCOME_ENGAGEMENT). Cada família tem vários action_types
 * equivalentes — usamos o primeiro disponível para não contar em dobro.
 */
const LEAD_TYPES = [
  'lead',
  'onsite_conversion.lead_grouped',
  'leadgen_grouped',
  'offsite_conversion.fb_pixel_lead',
];

const MENSAGEM_TYPES = [
  'onsite_conversion.messaging_conversation_started_7d',
  'onsite_conversion.total_messaging_connection',
  'onsite_conversion.messaging_first_reply',
];

function actionValue(actions, type) {
  const found = (actions || []).find((a) => a.action_type === type);
  return found ? Number(found.value) || 0 : null;
}

function firstAction(actions, types) {
  for (const type of types) {
    const value = actionValue(actions, type);
    if (value !== null) return value;
  }
  return 0;
}

const toNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Converte uma linha de insights da Graph API no formato usado pelo dashboard. */
export function normalizeInsight(row) {
  const leads = firstAction(row.actions, LEAD_TYPES);
  const mensagens = firstAction(row.actions, MENSAGEM_TYPES);
  const linkClicks = actionValue(row.actions, 'link_click') || 0;

  return {
    ad_id: row.ad_id || null,
    ad_name: row.ad_name || null,
    adset_id: row.adset_id || null,
    adset_name: row.adset_name || null,
    campaign_id: row.campaign_id || null,
    campaign_name: row.campaign_name || null,
    objective: row.objective || null,
    dia: row.date_start || null,
    spend: toNum(row.spend),
    impressions: toNum(row.impressions),
    reach: toNum(row.reach),
    clicks: toNum(row.clicks),
    link_clicks: linkClicks,
    frequency: toNum(row.frequency),
    leads,
    mensagens,
    resultados: leads + mensagens,
  };
}

/**
 * Métricas derivadas de uma linha — sempre recalculadas, nunca somadas.
 *
 * As métricas que dependem do tipo da campanha (resultado, custo por
 * lead, custo por conversa) ficam em lib/segmentos.js, porque exigem a
 * classificação que só existe depois de ler o nome da campanha.
 */
export function withDerived(base) {
  const { spend, impressions, clicks, link_clicks: linkClicks } = base;
  return {
    ...base,
    ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
    cpc: clicks > 0 ? spend / clicks : 0,
    cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
    custo_por_link_click: linkClicks > 0 ? spend / linkClicks : 0,
  };
}

const INSIGHT_FIELDS_AD = [
  'ad_id', 'ad_name', 'adset_id', 'adset_name', 'campaign_id', 'campaign_name',
  'objective', 'spend', 'impressions', 'reach', 'clicks', 'frequency', 'actions',
].join(',');

const INSIGHT_FIELDS_CONTA = [
  'spend', 'impressions', 'reach', 'clicks', 'frequency', 'actions',
].join(',');

/** Insights por anúncio no período. */
export async function fetchAdInsights(accountId, timeRange) {
  const rows = await graphAll(`act_${accountId}/insights`, {
    level: 'ad',
    fields: INSIGHT_FIELDS_AD,
    time_range: timeRange,
    use_unified_attribution_setting: 'true',
    limit: 200,
  });
  return rows.map(normalizeInsight);
}

/** Totais consolidados da conta (reach e frequency não podem ser somados). */
export async function fetchAccountTotals(accountId, timeRange) {
  const json = await graph(`act_${accountId}/insights`, {
    level: 'account',
    fields: INSIGHT_FIELDS_CONTA,
    time_range: timeRange,
    use_unified_attribution_setting: 'true',
  });
  const row = json?.data?.[0];
  return row ? normalizeInsight(row) : null;
}

const INSIGHT_FIELDS_DIA = [
  'ad_id', 'campaign_id', 'spend', 'impressions', 'clicks', 'actions',
].join(',');

/**
 * Série diária por anúncio. É o que permite ao gráfico responder aos
 * filtros de área e tipo — uma série no nível de conta não poderia ser
 * recortada. Campos enxutos de propósito: nomes e miniaturas vêm das
 * linhas agregadas e são cruzados por id no cliente.
 */
export async function fetchDailyAdSeries(accountId, timeRange) {
  const rows = await graphAll(`act_${accountId}/insights`, {
    level: 'ad',
    fields: INSIGHT_FIELDS_DIA,
    time_range: timeRange,
    use_unified_attribution_setting: 'true',
    time_increment: '1',
    limit: 500,
  }, 20);
  return rows.map((row) => {
    const n = normalizeInsight(row);
    return {
      dia: n.dia,
      ad_id: n.ad_id,
      campaign_id: n.campaign_id,
      spend: n.spend,
      impressions: n.impressions,
      clicks: n.clicks,
      link_clicks: n.link_clicks,
      leads: n.leads,
      mensagens: n.mensagens,
      resultados: n.resultados,
    };
  });
}

/** Status e miniatura dos anúncios, em lotes de 50 ids. */
export async function fetchAdMeta(adIds) {
  const meta = {};
  for (let i = 0; i < adIds.length; i += 50) {
    const chunk = adIds.slice(i, i + 50);
    const json = await graph('', {
      ids: chunk.join(','),
      fields: 'effective_status,status,created_time,creative{thumbnail_url}',
    });
    Object.entries(json || {}).forEach(([id, ad]) => {
      meta[id] = {
        effective_status: ad?.effective_status || null,
        status: ad?.status || null,
        created_time: ad?.created_time || null,
        thumbnail_url: ad?.creative?.thumbnail_url || null,
      };
    });
  }
  return meta;
}

/** Nome e moeda da conta. */
export async function fetchAccount(accountId) {
  const json = await graph(`act_${accountId}`, {
    fields: 'name,currency,timezone_name,account_status',
  });
  return {
    id: accountId,
    name: json?.name || null,
    currency: json?.currency || 'BRL',
    timezone: json?.timezone_name || null,
    status: json?.account_status ?? null,
  };
}
