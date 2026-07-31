import { classifyCampaign } from '../../lib/segmentos';
import {
  AD_ACCOUNT_ID,
  MetaError,
  fetchAccount,
  fetchAccountTotals,
  fetchAdInsights,
  fetchAdMeta,
  fetchDailyAdSeries,
  sumRows,
  withDerived,
} from '../../lib/meta';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DIAS = 400;

function diasEntre(inicio, fim) {
  const ms = new Date(`${fim}T00:00:00Z`) - new Date(`${inicio}T00:00:00Z`);
  return Math.floor(ms / 86400000) + 1;
}

export default async function handler(req, res) {
  const { inicio, fim } = req.query;

  if (!DATE_RE.test(inicio || '') || !DATE_RE.test(fim || '')) {
    return res.status(400).json({
      success: false,
      error: 'Parâmetros "inicio" e "fim" são obrigatórios no formato YYYY-MM-DD.',
    });
  }

  const [since, until] = inicio <= fim ? [inicio, fim] : [fim, inicio];
  const dias = diasEntre(since, until);

  if (dias > MAX_DIAS) {
    return res.status(400).json({
      success: false,
      error: `Período muito longo (${dias} dias). O máximo é ${MAX_DIAS} dias.`,
    });
  }

  const timeRange = { since, until };

  try {
    const [conta, anunciosRaw, totaisConta, diariasRaw] = await Promise.all([
      fetchAccount(AD_ACCOUNT_ID),
      fetchAdInsights(AD_ACCOUNT_ID, timeRange),
      fetchAccountTotals(AD_ACCOUNT_ID, timeRange),
      fetchDailyAdSeries(AD_ACCOUNT_ID, timeRange),
    ]);

    // Enriquece cada anúncio com status e miniatura
    const adIds = anunciosRaw.map((a) => a.ad_id).filter(Boolean);
    let adMeta = {};
    try {
      adMeta = await fetchAdMeta(adIds);
    } catch {
      // Status/miniatura são acessórios — sem eles a tabela ainda funciona.
      adMeta = {};
    }

    const anuncios = anunciosRaw
      .map((a) => withDerived({
        ...a,
        ...(adMeta[a.ad_id] || {}),
        ...classifyCampaign(a.campaign_name, a.objective),
      }))
      .sort((a, b) => b.spend - a.spend);

    // Cada linha diária herda a classificação da sua campanha, para que o
    // gráfico possa ser recortado pelos mesmos filtros da tabela.
    const porCampanha = new Map();
    anuncios.forEach((a) => {
      if (a.campaign_id && !porCampanha.has(a.campaign_id)) {
        porCampanha.set(a.campaign_id, { area: a.area, tipo: a.tipo });
      }
    });

    const serie = diariasRaw
      .map((d) => ({
        ...d,
        ...(porCampanha.get(d.campaign_id) || { area: 'outros', tipo: 'outros' }),
      }))
      .sort((a, b) => (a.dia < b.dia ? -1 : 1));

    // Totais: usa o nível de conta (alcance e frequência não são somáveis)
    const totais = totaisConta
      ? withDerived(totaisConta)
      : withDerived(sumRows(anuncios));

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=900');
    return res.status(200).json({
      success: true,
      conta,
      periodo: { inicio: since, fim: until, dias },
      totais: { ...totais, reach: totaisConta?.reach || 0, frequency: totaisConta?.frequency || 0 },
      anuncios,
      serie,
      atualizado_em: new Date().toISOString(),
    });
  } catch (e) {
    const status = e instanceof MetaError ? e.status : 500;
    return res.status(status).json({ success: false, error: e.message });
  }
}
