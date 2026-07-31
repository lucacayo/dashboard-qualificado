/**
 * Segmentação das campanhas da conta.
 *
 * Fica separado de lib/meta.js porque é usado tanto no servidor (para
 * classificar as linhas da API) quanto no cliente (para rótulos e cores
 * dos filtros) — e a página não deve arrastar o cliente da Graph API,
 * com sua leitura de token, para o bundle do navegador.
 *
 * A conta segue uma nomenclatura fixa: toda campanha abre com o tipo de
 * captação ([Leads] = formulário nativo, [WPP] = conversas iniciadas) e
 * em seguida a área ([Previ], [Cível], [Trab]).
 *
 * A etiqueta indica a INTENÇÃO da campanha, não o resultado: campanhas
 * [Leads] também geram conversas e vice-versa. Por isso classificamos a
 * campanha pela etiqueta e mantemos leads e mensagens separados dentro
 * de cada segmento, em vez de deduzir um do outro.
 */

const semAcento = (s) =>
  (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export const AREAS = [
  { id: 'previ', label: 'Previdenciário', curto: 'Previ', color: '#1D9E75' },
  { id: 'civel', label: 'Cível', curto: 'Cível', color: '#7F77DD' },
  { id: 'trab', label: 'Trabalhista', curto: 'Trabalhista', color: '#E2A54B' },
  { id: 'outros', label: 'Outros', curto: 'Outros', color: '#777777' },
];

export const TIPOS = [
  { id: 'leads', label: 'Formulário nativo', curto: 'Formulário', color: '#378ADD' },
  { id: 'wpp', label: 'Conversas no WhatsApp', curto: 'WhatsApp', color: '#1D9E75' },
  { id: 'outros', label: 'Outros', curto: 'Outros', color: '#777777' },
];

/**
 * Destino do lead: campanhas marcadas com [IA] vão para o atendimento
 * automatizado, as marcadas com [Planilha] vão para o time humano.
 *
 * Boa parte das campanhas [WPP] não carrega nenhuma das duas marcas —
 * elas caem em 'indefinido' de propósito. Chutar o destino delas seria
 * pior do que admitir que não dá para saber pelo nome.
 */
export const DESTINOS = [
  { id: 'ia', label: 'Atendimento por IA', curto: 'IA', color: '#378ADD' },
  { id: 'humano', label: 'Atendimento humano', curto: 'Humano', color: '#1D9E75' },
  { id: 'indefinido', label: 'Sem marcação', curto: 'Sem marcação', color: '#777777' },
];

export const areaInfo = (id) => AREAS.find((a) => a.id === id) || AREAS[AREAS.length - 1];
export const tipoInfo = (id) => TIPOS.find((t) => t.id === id) || TIPOS[TIPOS.length - 1];
export const destinoInfo = (id) => DESTINOS.find((d) => d.id === id) || DESTINOS[DESTINOS.length - 1];

export function classifyCampaign(campaignName, objective) {
  const n = semAcento(campaignName);

  let area = 'outros';
  if (/\bcivel\b/.test(n)) area = 'civel';
  else if (/\bprevi\b/.test(n)) area = 'previ';
  else if (/\btrab\b/.test(n)) area = 'trab';

  // A etiqueta do nome manda; o objetivo da campanha é só o plano B
  // para campanhas fora do padrão de nomenclatura.
  let tipo;
  if (/\[\s*wpp\s*\]/.test(n)) tipo = 'wpp';
  else if (/\[\s*leads\s*\]/.test(n)) tipo = 'leads';
  else if (objective === 'OUTCOME_LEADS') tipo = 'leads';
  else if (objective === 'OUTCOME_ENGAGEMENT') tipo = 'wpp';
  else tipo = 'outros';

  /* "ia" precisa casar como palavra inteira: um match solto de substring
     acusaria "perícia" em "[AD sem pericia]". Se as duas marcas
     aparecerem, IA vence — hoje nenhuma campanha tem as duas. */
  let destino = 'indefinido';
  if (/\bia\b/.test(n)) destino = 'ia';
  else if (/\bplanilha\b/.test(n)) destino = 'humano';

  return { area, tipo, destino };
}
