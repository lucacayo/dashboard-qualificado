import { classifyCampaign, consolidar, resultadoDoTipo } from '../../lib/segmentos';
import {
  AD_ACCOUNT_ID,
  MetaError,
  fetchAccount,
  fetchAccountTotals,
  fetchAdInsights,
  fetchAdMeta,
  fetchDailyAdSeries,
  withDerived,
} from '../../lib/meta';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DIAS = 400;

function diasEntre(inicio, fim) {
  const ms = new Date(`${fim}T00:00:00Z`) - new Date(`${inicio}T00:00:00Z`);
  return Math.floor(ms / 86400000) + 1;
}

/** Custos por resultado de uma linha, respeitando o tipo da campanha. */
function metricasDeResultado(linha) {
  const resultados = resultadoDoTipo(linha, linha.tipo);
  return {
    resultados,
    custo_por_resultado: resultados > 0 ? linha.spend / resultados : 0,
    // Cada custo só é preenchido para a família de campanha correspondente:
    // o investimento de uma campanha de formulário não divide conversas.
    custo_por_lead:
      linha.tipo === 'leads' && linha.leads > 0 ? linha.spend / linha.leads : 0,
    custo_por_conversa:
      linha.tipo === 'wpp' && linha.mensagens > 0 ? linha.spend / linha.mensagens : 0,
  };
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
      .map((a) => {
        const base = withDerived({
          ...a,
          ...(adMeta[a.ad_id] || {}),
          ...classifyCampaign(a.campaign_name, a.objective),
        });
        return { ...base, ...metricasDeResultado(base) };
      })
      .sort((a, b) => b.spend - a.spend);

    /* Reaproveita classifyCampaign em vez de copiar campo a campo: assim
       uma dimensão nova entra na série sozinha, sem precisar lembrar de
       atualizar dois lugares. */
    const SEM_CLASSIFICACAO = classifyCampaign(null, null);

    const porCampanha = new Map();
    anunciosRaw.forEach((a) => {
      if (a.campaign_id && !porCampanha.has(a.campaign_id)) {
        porCampanha.set(a.campaign_id, classifyCampaign(a.campaign_name, a.objective));
      }
    });

    const serie = diariasRaw
      .map((d) => {
        const linha = { ...d, ...(porCampanha.get(d.campaign_id) || SEM_CLASSIFICACAO) };
        return { ...linha, resultados: resultadoDoTipo(linha, linha.tipo) };
      })
      .sort((a, b) => (a.dia < b.dia ? -1 : 1));

    /* Os totais saem da soma dos anúncios, e não do nível de conta, porque
       só a linha do anúncio carrega o tipo da campanha — sem ele não dá
       para contar o resultado certo. Do nível de conta aproveitamos apenas
       alcance e frequência, que a Meta calcula por pessoas únicas e não
       podem ser somados. */
    const totais = {
      ...consolidar(anuncios),
      reach: totaisConta?.reach || 0,
      frequency: totaisConta?.frequency || 0,
    };

    /* Modo diagnóstico: devolve os tipos de ação crus de uma campanha, para
       conferir contra o que o Gerenciador mostra. Sem ele, o array de ações
       é descartado — não vai para o cliente em nenhuma resposta normal. */
    const diagnostico = req.query.campanha
      ? anuncios
          .filter((a) => a.campaign_id === req.query.campanha)
          .map((a) => ({ ad_name: a.ad_name, spend: a.spend, acoes: a.acoes }))
      : null;

    anuncios.forEach((a) => { delete a.acoes; });

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=900');
    return res.status(200).json({
      success: true,
      conta,
      periodo: { inicio: since, fim: until, dias },
      totais,
      anuncios,
      serie,
      ...(diagnostico ? { diagnostico } : {}),
      atualizado_em: new Date().toISOString(),
    });
  } catch (e) {
    const status = e instanceof MetaError ? e.status : 500;
    return res.status(status).json({ success: false, error: e.message });
  }
}
