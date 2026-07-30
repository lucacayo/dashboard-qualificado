import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts';
import Head from 'next/head';
import Layout from '../components/Layout';
import { useTheme } from '../components/ThemeContext';

const COR_INVESTIMENTO = '#378ADD';
const COR_RESULTADO = '#1D9E75';

const pad = (n) => String(n).padStart(2, '0');

function brParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const [y, m, d] = fmt.format(date).split('-');
  return { y: +y, m: +m, d: +d };
}

const ymdFromUTC = (dateObj) => dateObj.toISOString().slice(0, 10);

function presetRange(preset) {
  const { y, m, d } = brParts();
  const hoje = `${y}-${pad(m)}-${pad(d)}`;
  const base = Date.UTC(y, m - 1, d);
  if (preset === 'hoje') return { inicio: hoje, fim: hoje };
  if (preset === 'ontem') {
    const ontem = ymdFromUTC(new Date(base - 86400000));
    return { inicio: ontem, fim: ontem };
  }
  if (preset === '7dias') return { inicio: ymdFromUTC(new Date(base - 6 * 86400000)), fim: hoje };
  if (preset === '30dias') return { inicio: ymdFromUTC(new Date(base - 29 * 86400000)), fim: hoje };
  if (preset === 'mes') return { inicio: `${y}-${pad(m)}-01`, fim: hoje };
  if (preset === 'mespassado') {
    const ly = m === 1 ? y - 1 : y;
    const lm = m === 1 ? 12 : m - 1;
    const ultimoDia = new Date(Date.UTC(ly, lm, 0)).getUTCDate();
    return { inicio: `${ly}-${pad(lm)}-01`, fim: `${ly}-${pad(lm)}-${pad(ultimoDia)}` };
  }
  return { inicio: `${y}-${pad(m)}-01`, fim: hoje };
}

const PRESETS = [
  { k: 'hoje', label: 'Hoje' },
  { k: 'ontem', label: 'Ontem' },
  { k: '7dias', label: '7 dias' },
  { k: '30dias', label: '30 dias' },
  { k: 'mes', label: 'Este mês' },
  { k: 'mespassado', label: 'Mês passado' },
];

const NIVEIS = [
  { k: 'ad', label: 'Anúncio' },
  { k: 'adset', label: 'Conjunto' },
  { k: 'campaign', label: 'Campanha' },
];

const COLUNAS = [
  { k: 'nome', label: 'Nome', tipo: 'texto' },
  { k: 'spend', label: 'Investido', tipo: 'moeda' },
  { k: 'resultados', label: 'Resultados', tipo: 'inteiro' },
  { k: 'custo_por_resultado', label: 'Custo/result.', tipo: 'moeda' },
  { k: 'impressions', label: 'Impressões', tipo: 'inteiro' },
  { k: 'clicks', label: 'Cliques', tipo: 'inteiro' },
  { k: 'ctr', label: 'CTR', tipo: 'pct' },
  { k: 'cpc', label: 'CPC', tipo: 'moeda' },
  { k: 'cpm', label: 'CPM', tipo: 'moeda' },
];

const brl = (v) =>
  (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const inteiro = (v) => (Number(v) || 0).toLocaleString('pt-BR');
const pct = (v) => `${(Number(v) || 0).toFixed(2).replace('.', ',')}%`;
const decimal = (v) => (Number(v) || 0).toFixed(2).replace('.', ',');

function formatar(valor, tipo) {
  if (tipo === 'moeda') return brl(valor);
  if (tipo === 'pct') return pct(valor);
  if (tipo === 'inteiro') return inteiro(valor);
  return valor;
}

const labelDia = (key) =>
  new Date(`${key}T00:00:00Z`).toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', timeZone: 'UTC',
  });

const STATUS_LABEL = {
  ACTIVE: 'Ativo',
  PAUSED: 'Pausado',
  ADSET_PAUSED: 'Conjunto pausado',
  CAMPAIGN_PAUSED: 'Campanha pausada',
  ARCHIVED: 'Arquivado',
  DELETED: 'Excluído',
  DISAPPROVED: 'Reprovado',
  PENDING_REVIEW: 'Em análise',
  IN_PROCESS: 'Processando',
  WITH_ISSUES: 'Com problemas',
};

const statusClasse = (s) => {
  if (s === 'ACTIVE') return 'ok';
  if (s === 'DISAPPROVED' || s === 'WITH_ISSUES') return 'erro';
  return 'neutro';
};

/** Reagrupa as linhas de anúncio por conjunto ou campanha, recalculando as métricas. */
function agrupar(anuncios, nivel) {
  if (nivel === 'ad') {
    return anuncios.map((a) => ({
      ...a,
      chave: a.ad_id,
      nome: a.ad_name || '(sem nome)',
      contexto: a.campaign_name || '',
    }));
  }
  const idKey = nivel === 'adset' ? 'adset_id' : 'campaign_id';
  const nomeKey = nivel === 'adset' ? 'adset_name' : 'campaign_name';
  const mapa = new Map();

  anuncios.forEach((a) => {
    const id = a[idKey] || '—';
    const atual = mapa.get(id) || {
      chave: id,
      nome: a[nomeKey] || '(sem nome)',
      contexto: nivel === 'adset' ? (a.campaign_name || '') : '',
      objective: a.objective,
      spend: 0, impressions: 0, clicks: 0, link_clicks: 0,
      leads: 0, mensagens: 0, resultados: 0, anuncios: 0,
      ativos: 0,
    };
    atual.spend += a.spend;
    atual.impressions += a.impressions;
    atual.clicks += a.clicks;
    atual.link_clicks += a.link_clicks;
    atual.leads += a.leads;
    atual.mensagens += a.mensagens;
    atual.resultados += a.resultados;
    atual.anuncios += 1;
    if (a.effective_status === 'ACTIVE') atual.ativos += 1;
    mapa.set(id, atual);
  });

  return [...mapa.values()].map((g) => ({
    ...g,
    effective_status: g.ativos > 0 ? 'ACTIVE' : 'PAUSED',
    ctr: g.impressions > 0 ? (g.clicks / g.impressions) * 100 : 0,
    cpc: g.clicks > 0 ? g.spend / g.clicks : 0,
    cpm: g.impressions > 0 ? (g.spend / g.impressions) * 1000 : 0,
    custo_por_resultado: g.resultados > 0 ? g.spend / g.resultados : 0,
  }));
}

export default function Captacao() {
  const inicial = presetRange('30dias');
  const { y: maxY, m: maxM, d: maxD } = brParts();
  const hojeStr = `${maxY}-${pad(maxM)}-${pad(maxD)}`;

  const [inicio, setInicio] = useState(inicial.inicio);
  const [fim, setFim] = useState(inicial.fim);
  const [activePreset, setActivePreset] = useState('30dias');
  const [nivel, setNivel] = useState('ad');
  const [somenteAtivos, setSomenteAtivos] = useState(false);
  const [ordenacao, setOrdenacao] = useState({ coluna: 'spend', desc: true });

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState('');
  const reqSeq = useRef(0);
  const { theme } = useTheme();

  const carregar = useCallback(async (ini, end) => {
    const myReq = ++reqSeq.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/captacao?inicio=${ini}&fim=${end}`);
      const json = await res.json();
      if (myReq !== reqSeq.current) return;
      if (!json.success) throw new Error(json.error || 'Erro desconhecido');
      setData(json);
      setLastUpdated(new Date().toLocaleTimeString('pt-BR', {
        timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit',
      }));
    } catch (e) {
      if (myReq !== reqSeq.current) return;
      setError(e.message);
      setData(null);
    } finally {
      if (myReq === reqSeq.current) setLoading(false);
    }
  }, []);

  useEffect(() => { carregar(inicial.inicio, inicial.fim); }, []); // eslint-disable-line

  const aplicarPreset = (preset) => {
    const r = presetRange(preset);
    setInicio(r.inicio);
    setFim(r.fim);
    setActivePreset(preset);
    carregar(r.inicio, r.fim);
  };

  const aplicarManual = () => {
    setActivePreset(null);
    carregar(inicio, fim);
  };

  const totais = data?.totais;
  const dias = data?.periodo?.dias || 1;

  const linhas = useMemo(() => {
    if (!data?.anuncios) return [];
    const base = agrupar(data.anuncios, nivel);
    const filtradas = somenteAtivos
      ? base.filter((l) => l.effective_status === 'ACTIVE')
      : base;
    const { coluna, desc } = ordenacao;
    return [...filtradas].sort((a, b) => {
      if (coluna === 'nome') {
        return desc ? b.nome.localeCompare(a.nome) : a.nome.localeCompare(b.nome);
      }
      const va = Number(a[coluna]) || 0;
      const vb = Number(b[coluna]) || 0;
      return desc ? vb - va : va - vb;
    });
  }, [data, nivel, somenteAtivos, ordenacao]);

  const chartData = useMemo(() => {
    if (!data?.serie) return [];
    return data.serie.map((d) => ({
      label: labelDia(d.dia),
      _key: d.dia,
      investimento: Number(d.spend.toFixed(2)),
      resultados: d.resultados,
    }));
  }, [data]);

  const temDados = chartData.some((d) => d.investimento > 0 || d.resultados > 0);

  const isDark = theme === 'dark';
  const tooltipStyle = {
    background: isDark ? '#1a1a1a' : '#ffffff',
    border: `1px solid ${isDark ? '#333' : '#e5e5e5'}`,
    borderRadius: 8, fontFamily: 'DM Mono', fontSize: 12,
  };
  const tooltipLabelStyle = { color: isDark ? '#aaa' : '#666', marginBottom: 4 };
  const tooltipItemStyle = { color: isDark ? '#fff' : '#1a1a1a' };
  const gridStroke = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  const tickFill = isDark ? '#888' : '#999';

  const ordenarPor = (coluna) => {
    setOrdenacao((prev) =>
      prev.coluna === coluna
        ? { coluna, desc: !prev.desc }
        : { coluna, desc: coluna !== 'nome' }
    );
  };

  const sidebarExtra = (
    <>
      <div className="nav-label" style={{ marginTop: 8 }}>Período</div>
      {PRESETS.map((p) => (
        <button
          key={p.k}
          className={`period-btn ${activePreset === p.k ? 'active' : ''}`}
          onClick={() => aplicarPreset(p.k)}
        >
          {p.label}
        </button>
      ))}

      <div className="nav-label" style={{ marginTop: 16 }}>Agrupar por</div>
      {NIVEIS.map((n) => (
        <button
          key={n.k}
          className={`period-btn ${nivel === n.k ? 'active' : ''}`}
          onClick={() => setNivel(n.k)}
        >
          {n.label}
        </button>
      ))}

      <div className="nav-label" style={{ marginTop: 16 }}>Filtro</div>
      <button
        className={`period-btn ${somenteAtivos ? 'active' : ''}`}
        onClick={() => setSomenteAtivos((v) => !v)}
      >
        {somenteAtivos ? '✓ Somente ativos' : 'Somente ativos'}
      </button>
    </>
  );

  return (
    <>
      <Head><title>Captação — Meta Ads OC ADV</title></Head>

      <Layout activePage="captacao" sidebarExtra={sidebarExtra}>

        <header className="page-header">
          <div>
            <h1 className="page-title">Captação</h1>
            <p className="page-subtitle">
              {data?.conta?.name ? `${data.conta.name} · ` : ''}Conta 1585898918220697
              {lastUpdated && ` · atualizado às ${lastUpdated}`}
            </p>
          </div>
          <button className="refresh-btn" onClick={() => carregar(inicio, fim)} disabled={loading}>
            <span className={loading ? 'spinning' : ''}>↻</span>
            Atualizar
          </button>
        </header>

        {/* Seletor de datas */}
        <div className="filtro-box">
          <div className="date-row">
            <div className="date-field">
              <label>Início</label>
              <input
                type="date" value={inicio} max={hojeStr}
                onChange={(e) => { setInicio(e.target.value); setActivePreset(null); }}
              />
            </div>
            <div className="date-field">
              <label>Fim</label>
              <input
                type="date" value={fim} max={hojeStr}
                onChange={(e) => { setFim(e.target.value); setActivePreset(null); }}
              />
            </div>
            <button className="aplicar-btn" onClick={aplicarManual} disabled={loading}>
              {loading ? '...' : 'Aplicar'}
            </button>
          </div>
        </div>

        {error && (
          <div className="erro-box">
            <div className="erro-titulo">Não foi possível carregar os dados da Meta</div>
            <div className="erro-msg">{error}</div>
            {error.includes('META_ACCESS_TOKEN') && (
              <div className="erro-dica">
                Configure a variável de ambiente <code>META_ACCESS_TOKEN</code> (token com
                permissão <code>ads_read</code> na conta) no projeto da Vercel e refaça o deploy.
              </div>
            )}
          </div>
        )}

        {/* Cards de resumo */}
        <div className="cards-grid">
          <div className="card card-highlight">
            <div className="card-label">Investimento</div>
            <div className="card-value accent">{loading ? '—' : brl(totais?.spend)}</div>
            <div className="card-sub">{brl((totais?.spend || 0) / dias)}/dia · {dias} dias</div>
          </div>
          <div className="card card-highlight">
            <div className="card-label">Resultados</div>
            <div className="card-value accent">{loading ? '—' : inteiro(totais?.resultados)}</div>
            <div className="card-sub">
              {inteiro(totais?.leads)} leads · {inteiro(totais?.mensagens)} conversas
            </div>
          </div>
          <div className="card card-highlight">
            <div className="card-label">Custo por resultado</div>
            <div className="card-value accent">{loading ? '—' : brl(totais?.custo_por_resultado)}</div>
            <div className="card-sub">
              {inteiro(Math.round((totais?.resultados || 0) / dias))} resultados/dia em média
            </div>
          </div>
          <div className="card">
            <div className="card-label">Impressões</div>
            <div className="card-value">{loading ? '—' : inteiro(totais?.impressions)}</div>
            <div className="card-sub">alcance {inteiro(totais?.reach)}</div>
          </div>
          <div className="card">
            <div className="card-label">Cliques</div>
            <div className="card-value">{loading ? '—' : inteiro(totais?.clicks)}</div>
            <div className="card-sub">CTR {pct(totais?.ctr)} · CPC {brl(totais?.cpc)}</div>
          </div>
        </div>

        <div className="mini-grid">
          <div className="mini">
            <span className="mini-label">CPM</span>
            <span className="mini-val">{loading ? '—' : brl(totais?.cpm)}</span>
          </div>
          <div className="mini">
            <span className="mini-label">Frequência</span>
            <span className="mini-val">{loading ? '—' : decimal(totais?.frequency)}</span>
          </div>
          <div className="mini">
            <span className="mini-label">Cliques no link</span>
            <span className="mini-val">{loading ? '—' : inteiro(totais?.link_clicks)}</span>
          </div>
          <div className="mini">
            <span className="mini-label">Anúncios veiculados</span>
            <span className="mini-val">{loading ? '—' : inteiro(data?.anuncios?.length)}</span>
          </div>
        </div>

        {/* Gráfico */}
        <div className="chart-box">
          <div className="chart-title">
            Investimento e resultados
            <span className="chart-sub"> — por dia</span>
          </div>

          {loading && <div className="msg-loading">Carregando...</div>}
          {!loading && !error && !temDados && (
            <div className="msg-empty">Nenhuma veiculação neste período.</div>
          )}
          {!loading && !error && temDados && (
            <div className="chart-scroll">
              <div style={{ minWidth: chartData.length > 31 ? chartData.length * 22 : '100%', height: 300 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fill: tickFill, fontSize: 11, fontFamily: 'DM Mono' }}
                      axisLine={false} tickLine={false}
                      interval={chartData.length > 20 ? Math.floor(chartData.length / 15) : 0}
                    />
                    <YAxis
                      yAxisId="left"
                      tick={{ fill: tickFill, fontSize: 11, fontFamily: 'DM Mono' }}
                      axisLine={false} tickLine={false} width={52}
                      tickFormatter={(v) => `R$${inteiro(Math.round(v))}`}
                    />
                    <YAxis
                      yAxisId="right" orientation="right"
                      tick={{ fill: tickFill, fontSize: 11, fontFamily: 'DM Mono' }}
                      axisLine={false} tickLine={false} width={36} allowDecimals={false}
                    />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      labelStyle={tooltipLabelStyle}
                      itemStyle={tooltipItemStyle}
                      formatter={(value, name) =>
                        name === 'Investimento' ? brl(value) : inteiro(value)
                      }
                    />
                    <Legend wrapperStyle={{ fontSize: 11, fontFamily: 'DM Mono', paddingTop: 12 }} />
                    <Bar
                      yAxisId="left" dataKey="investimento" name="Investimento"
                      fill={COR_INVESTIMENTO} radius={[3, 3, 0, 0]} maxBarSize={28}
                    />
                    <Line
                      yAxisId="right" type="monotone" dataKey="resultados" name="Resultados"
                      stroke={COR_RESULTADO} strokeWidth={2}
                      dot={chartData.length <= 31} activeDot={{ r: 4 }}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>

        {/* Tabela */}
        <div className="chart-box">
          <div className="chart-title">
            Desempenho por {NIVEIS.find((n) => n.k === nivel)?.label.toLowerCase()}
            <span className="chart-sub"> — {linhas.length} {linhas.length === 1 ? 'linha' : 'linhas'}</span>
          </div>

          {loading && <div className="msg-loading">Carregando...</div>}
          {!loading && !error && linhas.length === 0 && (
            <div className="msg-empty">Nenhum registro com os filtros atuais.</div>
          )}
          {!loading && !error && linhas.length > 0 && (
            <div className="tabela-scroll">
              <table className="tabela">
                <thead>
                  <tr>
                    <th className="col-status">Status</th>
                    {COLUNAS.map((c) => (
                      <th
                        key={c.k}
                        className={`${c.tipo === 'texto' ? 'th-esq' : 'th-dir'} th-click`}
                        onClick={() => ordenarPor(c.k)}
                      >
                        {c.label}
                        {ordenacao.coluna === c.k && (
                          <span className="th-seta">{ordenacao.desc ? '↓' : '↑'}</span>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {linhas.map((l) => (
                    <tr key={l.chave}>
                      <td className="col-status">
                        <span className={`badge ${statusClasse(l.effective_status)}`}>
                          {STATUS_LABEL[l.effective_status] || l.effective_status || '—'}
                        </span>
                      </td>
                      <td className="td-nome">
                        <div className="nome-linha">
                          {nivel === 'ad' && l.thumbnail_url && (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img className="thumb" src={l.thumbnail_url} alt="" loading="lazy" />
                          )}
                          <div className="nome-texto">
                            <div className="nome-principal" title={l.nome}>{l.nome}</div>
                            {l.contexto && <div className="nome-contexto" title={l.contexto}>{l.contexto}</div>}
                            {nivel !== 'ad' && (
                              <div className="nome-contexto">
                                {l.anuncios} {l.anuncios === 1 ? 'anúncio' : 'anúncios'}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      {COLUNAS.filter((c) => c.k !== 'nome').map((c) => (
                        <td key={c.k} className="td-num">{formatar(l[c.k], c.tipo)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <style jsx>{`
          .filtro-box {
            background: var(--card-bg);
            border: 1px solid var(--border);
            border-radius: 12px;
            padding: 16px 18px;
            margin-bottom: 20px;
            box-shadow: var(--shadow);
          }
          .date-row { display: flex; align-items: flex-end; gap: 12px; flex-wrap: wrap; }
          .date-field { display: flex; flex-direction: column; gap: 5px; }
          .date-field label {
            font-size: 10px;
            letter-spacing: 0.1em;
            text-transform: uppercase;
            color: var(--text-dim);
            font-family: 'DM Mono', monospace;
          }
          .date-field input {
            background: var(--input-bg);
            border: 1px solid var(--border-strong);
            border-radius: 8px;
            padding: 7px 10px;
            color: var(--text);
            font-size: 12px;
            font-family: 'DM Mono', monospace;
            color-scheme: ${isDark ? 'dark' : 'light'};
          }
          .aplicar-btn {
            padding: 8px 18px;
            border-radius: 8px;
            border: 1px solid var(--accent-border);
            background: var(--accent-bg);
            color: var(--accent);
            font-size: 12px;
            font-family: 'DM Mono', monospace;
            transition: all 0.15s;
          }
          .aplicar-btn:hover:not(:disabled) { border-color: var(--accent); }
          .aplicar-btn:disabled { opacity: 0.5; cursor: not-allowed; }

          .erro-box {
            background: var(--danger-bg);
            border: 1px solid var(--danger-border);
            border-radius: 12px;
            padding: 16px 18px;
            margin-bottom: 20px;
          }
          .erro-titulo { color: var(--danger); font-size: 13px; font-weight: 700; margin-bottom: 6px; }
          .erro-msg { color: var(--text-sub); font-size: 12px; font-family: 'DM Mono', monospace; }
          .erro-dica { color: var(--text-muted); font-size: 11px; margin-top: 10px; line-height: 1.5; }
          .erro-dica code {
            background: var(--card-bg);
            border: 1px solid var(--border);
            border-radius: 4px;
            padding: 1px 5px;
            font-family: 'DM Mono', monospace;
          }

          .cards-grid {
            display: grid;
            grid-template-columns: repeat(5, minmax(0, 1fr));
            gap: 12px;
            margin-bottom: 12px;
          }
          .card-highlight { border-color: var(--accent-border); }
          .card-value.accent { color: var(--accent); }
          .card-value { font-size: 24px; }

          .mini-grid {
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 10px;
            margin-bottom: 28px;
          }
          .mini {
            display: flex;
            align-items: baseline;
            justify-content: space-between;
            gap: 8px;
            background: var(--card-bg);
            border: 1px solid var(--border);
            border-radius: 10px;
            padding: 10px 14px;
            box-shadow: var(--shadow);
          }
          .mini-label { font-size: 11px; color: var(--text-muted); font-family: 'DM Mono', monospace; }
          .mini-val { font-size: 15px; font-weight: 700; color: var(--text); }

          .tabela-scroll { width: 100%; overflow-x: auto; }
          .tabela { width: 100%; border-collapse: collapse; min-width: 900px; }
          .tabela th {
            font-size: 10px;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            color: var(--text-dim);
            font-family: 'DM Mono', monospace;
            font-weight: 500;
            padding: 8px 10px;
            border-bottom: 1px solid var(--border);
            white-space: nowrap;
          }
          .th-esq { text-align: left; }
          .th-dir { text-align: right; }
          .th-click { cursor: pointer; user-select: none; }
          .th-click:hover { color: var(--text-sub); }
          .th-seta { margin-left: 4px; color: var(--accent); }
          .col-status { width: 1%; text-align: left; }

          .tabela td {
            padding: 10px;
            border-bottom: 1px solid var(--border);
            font-size: 12px;
            color: var(--text-sub);
            vertical-align: middle;
          }
          .tabela tbody tr:hover { background: var(--card-hover); }
          .td-num { text-align: right; font-family: 'DM Mono', monospace; white-space: nowrap; }
          .td-nome { max-width: 340px; }

          .nome-linha { display: flex; align-items: center; gap: 10px; }
          .thumb {
            width: 34px;
            height: 34px;
            border-radius: 6px;
            object-fit: cover;
            border: 1px solid var(--border);
            flex-shrink: 0;
            background: var(--card-hover);
          }
          .nome-texto { min-width: 0; }
          .nome-principal {
            color: var(--text);
            font-size: 12px;
            font-weight: 500;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          .nome-contexto {
            color: var(--text-dim);
            font-size: 10px;
            font-family: 'DM Mono', monospace;
            margin-top: 2px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }

          .badge {
            display: inline-block;
            padding: 3px 8px;
            border-radius: 20px;
            font-size: 10px;
            font-family: 'DM Mono', monospace;
            white-space: nowrap;
            border: 1px solid transparent;
          }
          .badge.ok { color: var(--accent); background: var(--accent-bg); border-color: var(--accent-border); }
          .badge.neutro { color: var(--text-muted); background: var(--card-hover); border-color: var(--border); }
          .badge.erro { color: var(--danger); background: var(--danger-bg); border-color: var(--danger-border); }

          @media (max-width: 1100px) and (min-width: 769px) {
            .cards-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
          }
          @media (max-width: 768px) {
            .cards-grid { grid-template-columns: repeat(2, 1fr); }
            .mini-grid { grid-template-columns: repeat(2, 1fr); }
            .date-row { gap: 8px; }
          }
        `}</style>
      </Layout>
    </>
  );
}
