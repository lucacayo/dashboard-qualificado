import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts';
import Head from 'next/head';
import Layout from '../components/Layout';
import { useTheme } from '../components/ThemeContext';
import {
  AREAS, TIPOS, DESTINOS, areaInfo, tipoInfo, destinoInfo, consolidar,
} from '../lib/segmentos';

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
  { k: 'leads', label: 'Leads', tipo: 'inteiro' },
  { k: 'custo_por_lead', label: 'Custo/lead', tipo: 'moeda', tracoSeZero: true },
  { k: 'mensagens', label: 'Conversas', tipo: 'inteiro' },
  { k: 'custo_por_conversa', label: 'Custo/conversa', tipo: 'moeda', tracoSeZero: true },
  { k: 'resultados', label: 'Resultados', tipo: 'inteiro' },
  { k: 'impressions', label: 'Impressões', tipo: 'inteiro' },
  { k: 'clicks', label: 'Cliques', tipo: 'inteiro' },
  { k: 'ctr', label: 'CTR', tipo: 'pct' },
  { k: 'cpm', label: 'CPM', tipo: 'moeda' },
];

const brl = (v) =>
  (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const inteiro = (v) => (Number(v) || 0).toLocaleString('pt-BR');
const pct = (v) => `${(Number(v) || 0).toFixed(2).replace('.', ',')}%`;
const decimal = (v) => (Number(v) || 0).toFixed(2).replace('.', ',');

function formatar(valor, coluna) {
  // Custo que não se aplica àquela família de campanha vira traço, não R$ 0,00.
  if (coluna.tracoSeZero && !valor) return '—';
  if (coluna.tipo === 'moeda') return brl(valor);
  if (coluna.tipo === 'pct') return pct(valor);
  if (coluna.tipo === 'inteiro') return inteiro(valor);
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

/** Quebra os anúncios por uma dimensão ('area', 'tipo' ou 'destino'), na ordem do catálogo. */
function segmentar(anuncios, dimensao, catalogo) {
  return catalogo
    .map((seg) => {
      const linhas = anuncios.filter((a) => a[dimensao] === seg.id);
      if (linhas.length === 0) return null;
      return { ...seg, ...consolidar(linhas), campanhas: new Set(linhas.map((l) => l.campaign_id)).size };
    })
    .filter(Boolean);
}

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
    if (!mapa.has(id)) {
      mapa.set(id, {
        chave: id,
        nome: a[nomeKey] || '(sem nome)',
        contexto: nivel === 'adset' ? (a.campaign_name || '') : '',
        objective: a.objective,
        area: a.area,
        tipo: a.tipo,
        destino: a.destino,
        linhas: [],
      });
    }
    mapa.get(id).linhas.push(a);
  });

  // consolidar cuida de contar o resultado pelo tipo da campanha e de
  // casar cada custo com o investimento da sua própria família.
  return [...mapa.values()].map(({ linhas, ...g }) => ({
    ...g,
    ...consolidar(linhas),
    anuncios: linhas.length,
    effective_status: linhas.some((l) => l.effective_status === 'ACTIVE') ? 'ACTIVE' : 'PAUSED',
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
  const [filtroArea, setFiltroArea] = useState('todas');
  const [filtroTipo, setFiltroTipo] = useState('todos');
  const [filtroDestino, setFiltroDestino] = useState('todos');

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

  const dias = data?.periodo?.dias || 1;
  const filtrando =
    filtroArea !== 'todas' || filtroTipo !== 'todos' || filtroDestino !== 'todos';

  const casaComFiltro = useCallback(
    (r) =>
      (filtroArea === 'todas' || r.area === filtroArea) &&
      (filtroTipo === 'todos' || r.tipo === filtroTipo) &&
      (filtroDestino === 'todos' || r.destino === filtroDestino),
    [filtroArea, filtroTipo, filtroDestino]
  );

  const anunciosFiltrados = useMemo(
    () => (data?.anuncios || []).filter(casaComFiltro),
    [data, casaComFiltro]
  );

  /* Sem filtro usamos os totais do nível de conta, que trazem o alcance
     real. Com filtro é preciso somar os anúncios — e aí o alcance fica de
     fora de propósito: somar alcance conta a mesma pessoa várias vezes. */
  const totais = useMemo(() => {
    if (!data) return null;
    if (!filtrando) return data.totais;
    return { ...consolidar(anunciosFiltrados), reach: null, frequency: null };
  }, [data, filtrando, anunciosFiltrados]);

  const segmentosArea = useMemo(
    () => segmentar(data?.anuncios || [], 'area', AREAS),
    [data]
  );
  const segmentosTipo = useMemo(
    () => segmentar(data?.anuncios || [], 'tipo', TIPOS),
    [data]
  );
  const segmentosDestino = useMemo(
    () => segmentar(data?.anuncios || [], 'destino', DESTINOS),
    [data]
  );

  const linhas = useMemo(() => {
    const base = agrupar(anunciosFiltrados, nivel);
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
  }, [anunciosFiltrados, nivel, somenteAtivos, ordenacao]);

  // A série vem por anúncio e por dia, então o gráfico acompanha os filtros.
  const chartData = useMemo(() => {
    if (!data?.serie) return [];
    const porDia = new Map();
    data.serie.filter(casaComFiltro).forEach((d) => {
      const atual = porDia.get(d.dia) || { spend: 0, resultados: 0 };
      atual.spend += d.spend;
      atual.resultados += d.resultados;
      porDia.set(d.dia, atual);
    });
    return [...porDia.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([dia, v]) => ({
        label: labelDia(dia),
        _key: dia,
        investimento: Number(v.spend.toFixed(2)),
        resultados: v.resultados,
      }));
  }, [data, casaComFiltro]);

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

  const rotuloFiltro = [
    filtroArea !== 'todas' ? areaInfo(filtroArea).label : null,
    filtroTipo !== 'todos' ? tipoInfo(filtroTipo).label : null,
    filtroDestino !== 'todos' ? destinoInfo(filtroDestino).label : null,
  ].filter(Boolean).join(' · ');

  const limparFiltros = () => {
    setFiltroArea('todas');
    setFiltroTipo('todos');
    setFiltroDestino('todos');
  };

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

      <div className="nav-label" style={{ marginTop: 16 }}>Área</div>
      <button
        className={`nav-item ${filtroArea === 'todas' ? 'active' : ''}`}
        onClick={() => setFiltroArea('todas')}
      >
        Todas
      </button>
      {AREAS.filter((a) => segmentosArea.some((s) => s.id === a.id)).map((a) => (
        <button
          key={a.id}
          className={`nav-item ${filtroArea === a.id ? 'active' : ''}`}
          onClick={() => setFiltroArea((v) => (v === a.id ? 'todas' : a.id))}
        >
          <span className="nav-dot" style={{ background: a.color }} />
          {a.curto}
        </button>
      ))}

      <div className="nav-label" style={{ marginTop: 16 }}>Captação</div>
      <button
        className={`nav-item ${filtroTipo === 'todos' ? 'active' : ''}`}
        onClick={() => setFiltroTipo('todos')}
      >
        Todas
      </button>
      {TIPOS.filter((t) => segmentosTipo.some((s) => s.id === t.id)).map((t) => (
        <button
          key={t.id}
          className={`nav-item ${filtroTipo === t.id ? 'active' : ''}`}
          onClick={() => setFiltroTipo((v) => (v === t.id ? 'todos' : t.id))}
        >
          <span className="nav-dot" style={{ background: t.color }} />
          {t.curto}
        </button>
      ))}

      <div className="nav-label" style={{ marginTop: 16 }}>Destino</div>
      <button
        className={`nav-item ${filtroDestino === 'todos' ? 'active' : ''}`}
        onClick={() => setFiltroDestino('todos')}
      >
        Todos
      </button>
      {DESTINOS.filter((d) => segmentosDestino.some((s) => s.id === d.id)).map((d) => (
        <button
          key={d.id}
          className={`nav-item ${filtroDestino === d.id ? 'active' : ''}`}
          onClick={() => setFiltroDestino((v) => (v === d.id ? 'todos' : d.id))}
        >
          <span className="nav-dot" style={{ background: d.color }} />
          {d.curto}
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

        {/* Filtros ativos */}
        {filtrando && (
          <div className="filtros-ativos">
            <span className="fa-label">Filtrando por</span>
            {filtroArea !== 'todas' && (
              <button className="chip" onClick={() => setFiltroArea('todas')}>
                <span className="nav-dot" style={{ background: areaInfo(filtroArea).color }} />
                {areaInfo(filtroArea).label}
                <span className="chip-x">×</span>
              </button>
            )}
            {filtroTipo !== 'todos' && (
              <button className="chip" onClick={() => setFiltroTipo('todos')}>
                <span className="nav-dot" style={{ background: tipoInfo(filtroTipo).color }} />
                {tipoInfo(filtroTipo).label}
                <span className="chip-x">×</span>
              </button>
            )}
            {filtroDestino !== 'todos' && (
              <button className="chip" onClick={() => setFiltroDestino('todos')}>
                <span className="nav-dot" style={{ background: destinoInfo(filtroDestino).color }} />
                {destinoInfo(filtroDestino).label}
                <span className="chip-x">×</span>
              </button>
            )}
            <button className="chip chip-limpar" onClick={limparFiltros}>
              limpar tudo
            </button>
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
              {inteiro(totais?.leads_form)} leads · {inteiro(totais?.conversas_wpp)} conversas
            </div>
          </div>
          <div className="card card-highlight">
            <div className="card-label">Custo por lead</div>
            <div className="card-value accent">
              {loading || !totais?.leads_form ? '—' : brl(totais.custo_por_lead)}
            </div>
            <div className="card-sub">
              {totais?.leads_form
                ? `${inteiro(totais.leads_form)} leads · campanhas [Leads]`
                : 'sem campanhas de formulário no recorte'}
            </div>
          </div>
          <div className="card card-highlight">
            <div className="card-label">Custo por conversa</div>
            <div className="card-value accent">
              {loading || !totais?.conversas_wpp ? '—' : brl(totais.custo_por_conversa)}
            </div>
            <div className="card-sub">
              {totais?.conversas_wpp
                ? `${inteiro(totais.conversas_wpp)} conversas · campanhas [WPP]`
                : 'sem campanhas de WhatsApp no recorte'}
            </div>
          </div>
          <div className="card">
            <div className="card-label">Impressões</div>
            <div className="card-value">{loading ? '—' : inteiro(totais?.impressions)}</div>
            <div className="card-sub">
              {totais?.reach == null ? 'alcance indisponível no recorte' : `alcance ${inteiro(totais.reach)}`}
            </div>
          </div>
          <div className="card">
            <div className="card-label">Cliques</div>
            <div className="card-value">{loading ? '—' : inteiro(totais?.clicks)}</div>
            <div className="card-sub">CTR {pct(totais?.ctr)} · CPC {brl(totais?.cpc)}</div>
          </div>
        </div>

        <div className="mini-grid">
          <div className="mini">
            <span className="mini-label">Custo por resultado</span>
            <span className="mini-val">{loading ? '—' : brl(totais?.custo_por_resultado)}</span>
          </div>
          <div className="mini">
            <span className="mini-label">CPM</span>
            <span className="mini-val">{loading ? '—' : brl(totais?.cpm)}</span>
          </div>
          <div className="mini">
            <span className="mini-label">Frequência</span>
            <span className="mini-val">
              {loading || totais?.frequency == null ? '—' : decimal(totais.frequency)}
            </span>
          </div>
          <div className="mini">
            <span className="mini-label">Cliques no link</span>
            <span className="mini-val">{loading ? '—' : inteiro(totais?.link_clicks)}</span>
          </div>
          <div className="mini">
            <span className="mini-label">Anúncios veiculados</span>
            <span className="mini-val">{loading ? '—' : inteiro(anunciosFiltrados.length)}</span>
          </div>
        </div>

        {filtrando && (
          <div className="nota-alcance">
            Alcance e frequência só aparecem sem filtro: a Meta os calcula por
            pessoas únicas, e somar os anúncios contaria a mesma pessoa mais de uma vez.
          </div>
        )}

        {/* Quebras por área, tipo de captação e destino */}
        {!loading && !error && segmentosArea.length > 0 && (
          <>
            {[
              { titulo: 'Por área', segs: segmentosArea, ativo: filtroArea, set: setFiltroArea, vazio: 'todas' },
              { titulo: 'Por tipo de captação', segs: segmentosTipo, ativo: filtroTipo, set: setFiltroTipo, vazio: 'todos' },
              { titulo: 'Por destino do lead', segs: segmentosDestino, ativo: filtroDestino, set: setFiltroDestino, vazio: 'todos' },
            ].map(({ titulo, segs, ativo, set, vazio }) => (
              <div key={titulo}>
                <div className="section-label">{titulo}</div>
                <div className="seg-grid">
                  {segs.map((s) => (
                    <button
                      key={s.id}
                      className={`seg-card ${ativo === s.id ? 'active' : ''}`}
                      style={{ '--c': s.color }}
                      onClick={() => set((v) => (v === s.id ? vazio : s.id))}
                    >
                      <div className="seg-nome">{s.label}</div>
                      <div className="seg-valor">{brl(s.spend)}</div>
                      <div className="seg-custos">
                        <div className="seg-custo">
                          <span className="sc-label">{inteiro(s.leads_form)} leads</span>
                          <span className="sc-val">
                            {s.leads_form > 0 ? `${brl(s.custo_por_lead)}/lead` : '—'}
                          </span>
                        </div>
                        <div className="seg-custo">
                          <span className="sc-label">{inteiro(s.conversas_wpp)} conversas</span>
                          <span className="sc-val">
                            {s.conversas_wpp > 0 ? `${brl(s.custo_por_conversa)}/conversa` : '—'}
                          </span>
                        </div>
                      </div>
                      <div className="seg-detalhe">
                        {inteiro(s.resultados)} resultados · {brl(s.custo_por_resultado)}/result. ·{' '}
                        {s.campanhas} {s.campanhas === 1 ? 'campanha' : 'campanhas'}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ))}

            <div className="nota-custos">
              O resultado de cada campanha é a métrica que ela otimiza: campanhas
              [Leads] contam leads do formulário nativo, campanhas [WPP] contam
              conversas iniciadas. Uma campanha de formulário pode registrar
              conversas também — elas aparecem na tabela, mas não entram no
              resultado dela, do mesmo jeito que no Gerenciador de Anúncios.
            </div>
          </>
        )}

        {/* Gráfico */}
        <div className="chart-box">
          <div className="chart-title">
            Investimento e resultados
            <span className="chart-sub"> — por dia{rotuloFiltro && ` · ${rotuloFiltro}`}</span>
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
                        <td key={c.k} className="td-num">{formatar(l[c.k], c)}</td>
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

          .filtros-ativos {
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 8px;
            margin-bottom: 16px;
          }
          .fa-label {
            font-size: 10px;
            letter-spacing: 0.12em;
            text-transform: uppercase;
            color: var(--text-dim);
            font-family: 'DM Mono', monospace;
          }
          .chip {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 5px 10px;
            border-radius: 20px;
            border: 1px solid var(--border-strong);
            background: var(--card-bg);
            color: var(--text-sub);
            font-size: 11px;
            font-family: 'DM Mono', monospace;
            transition: all 0.15s;
          }
          .chip:hover { border-color: var(--accent); color: var(--text); }
          .chip-x { color: var(--text-dim); font-size: 13px; line-height: 1; }
          .chip-limpar { border-style: dashed; color: var(--text-dim); }

          .nota-alcance {
            font-size: 11px;
            color: var(--text-dim);
            font-family: 'DM Mono', monospace;
            line-height: 1.5;
            margin: -16px 0 24px;
          }

          .seg-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(215px, 1fr));
            gap: 10px;
            margin-bottom: 26px;
          }
          .seg-card {
            text-align: left;
            background: var(--card-bg);
            border: 1px solid var(--border);
            border-left: 3px solid var(--c);
            border-radius: 12px;
            padding: 14px;
            box-shadow: var(--shadow);
            transition: background 0.15s, border-color 0.15s;
          }
          .seg-card:hover { background: var(--card-hover); }
          .seg-card.active { background: var(--card-hover); border-color: var(--border-strong); border-left-color: var(--c); }
          .seg-nome {
            font-size: 11px;
            color: var(--text-muted);
            font-family: 'DM Mono', monospace;
            margin-bottom: 6px;
          }
          .seg-valor { font-size: 22px; font-weight: 700; color: var(--text); line-height: 1; }
          .seg-custos {
            display: flex;
            flex-direction: column;
            gap: 3px;
            margin-top: 9px;
            padding-top: 8px;
            border-top: 1px solid var(--border);
          }
          .seg-custo {
            display: flex;
            justify-content: space-between;
            gap: 8px;
            font-size: 11px;
            font-family: 'DM Mono', monospace;
          }
          .sc-label { color: var(--text-sub); }
          .sc-val { color: var(--c); white-space: nowrap; }
          .seg-detalhe {
            font-size: 10px;
            color: var(--text-dim);
            font-family: 'DM Mono', monospace;
            margin-top: 7px;
          }

          .nota-custos {
            font-size: 11px;
            color: var(--text-dim);
            font-family: 'DM Mono', monospace;
            line-height: 1.55;
            margin: -12px 0 26px;
            max-width: 760px;
          }

          .cards-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(178px, 1fr));
            gap: 12px;
            margin-bottom: 12px;
          }
          .card-highlight { border-color: var(--accent-border); }
          .card-value.accent { color: var(--accent); }
          .card-value { font-size: 24px; }

          .mini-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
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
          .tabela { width: 100%; border-collapse: collapse; min-width: 1180px; }
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

          @media (max-width: 768px) {
            .cards-grid { grid-template-columns: repeat(2, 1fr); }
            .mini-grid { grid-template-columns: repeat(2, 1fr); }
            .seg-grid { grid-template-columns: 1fr; }
            .date-row { gap: 8px; }
          }
        `}</style>
      </Layout>
    </>
  );
}
