import { useState, useEffect, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, ReferenceArea
} from 'recharts';
import Head from 'next/head';
import Layout from '../components/Layout';
import { useTheme } from '../components/ThemeContext';

const EDGE_URL = 'https://aomssdkitrcvagvnluki.supabase.co/functions/v1/contador';

const COUNTERS = [
  { id: 'qualificado_previ_ae', label: 'PREVI AE', color: '#1D9E75' },
  { id: 'qualificado_previ_sp', label: 'PREVI SP', color: '#378ADD' },
  { id: 'qualificado_civel_ae', label: 'CÍVEL AE', color: '#7F77DD' },
  { id: 'erro',                 label: 'Erros',    color: '#E24B4A' },
];

function isWeekendKey(key) {
  const day = new Date(key + 'T00:00:00Z').getUTCDay();
  return day === 0 || day === 6;
}

function buildDayRange(days) {
  const result = [];
  const todayBR = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(todayBR + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - i);
    const weekday = d.toLocaleDateString('pt-BR', { weekday: 'short', timeZone: 'UTC' }).replace('.', '');
    const date = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
    result.push({
      key: d.toISOString().slice(0, 10),
      label: `${weekday} ${date}`,
    });
  }
  return result;
}

export default function Dashboard() {
  const [days, setDays] = useState(7);
  const [chartMode, setChartMode] = useState('all');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState('');
  const { theme } = useTheme();

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${EDGE_URL}/dashboard-multi?days=${days}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Erro desconhecido');
      setData(json);
      setLastUpdated(new Date().toLocaleTimeString('pt-BR', {
        timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit'
      }));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { loadData(); }, [loadData]);

  const chartData = (() => {
    if (!data?.series) return [];
    const dayRange = buildDayRange(days);
    return dayRange.map(({ key, label }) => {
      const row = { label, _key: key, _weekend: isWeekendKey(key) };
      COUNTERS.forEach(c => {
        const found = data.series.find(s => s.counter_id === c.id && s.dia === key);
        row[c.id] = found ? Number(found.total) : 0;
      });
      return row;
    });
  })();

  const activeCounters = chartMode === 'all'
    ? COUNTERS
    : COUNTERS.filter(c => c.id === chartMode);

  const totalHoje = COUNTERS
    .filter(c => c.id !== 'erro')
    .reduce((sum, c) => sum + (data?.totais_hoje?.[c.id] || 0), 0);

  const totalPeriodo = COUNTERS
    .filter(c => c.id !== 'erro')
    .reduce((sum, c) => sum + (data?.totais_periodo?.[c.id] || 0), 0);

  const mediaDiaria = loading ? '—' : (totalPeriodo / days).toFixed(1);

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
  const weekendFill = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.045)';

  const sidebarExtra = (
    <>
      <div className="nav-label" style={{ marginTop: 8 }}>Visualização</div>
      {[
        { key: 'all', label: 'Todos', color: null },
        ...COUNTERS.map(c => ({ key: c.id, label: c.label, color: c.color })),
      ].map(item => (
        <button
          key={item.key}
          className={`nav-item ${chartMode === item.key ? 'active' : ''}`}
          onClick={() => setChartMode(item.key)}
        >
          {item.color && <span className="nav-dot" style={{ background: item.color }} />}
          {item.label}
        </button>
      ))}

      <div className="nav-label" style={{ marginTop: 16 }}>Período</div>
      {[7, 30, 90].map(d => (
        <button
          key={d}
          className={`period-btn ${days === d ? 'active' : ''}`}
          onClick={() => setDays(d)}
        >
          {d} dias
        </button>
      ))}
    </>
  );

  return (
    <>
      <Head><title>Dashboard — Contadores OC ADV</title></Head>

      <Layout activePage="painel" sidebarExtra={sidebarExtra}>

        <header className="page-header">
          <div>
            <h1 className="page-title">Painel de qualificados</h1>
            {lastUpdated && <p className="page-subtitle">Atualizado às {lastUpdated}</p>}
          </div>
          <button className="refresh-btn" onClick={loadData} disabled={loading}>
            <span className={loading ? 'spinning' : ''}>↻</span>
            Atualizar
          </button>
        </header>

        {/* Cards de resumo */}
        <div className="cards-grid">
          <div className="card card-highlight">
            <div className="card-label">Total qualificados hoje</div>
            <div className="card-value accent">{loading ? '—' : totalHoje}</div>
          </div>
          <div className="card card-highlight">
            <div className="card-label">Total no período</div>
            <div className="card-value accent">{loading ? '—' : totalPeriodo}</div>
            <div className="card-sub">últimos {days} dias</div>
          </div>
          <div className="card card-highlight">
            <div className="card-label">Média diária no período</div>
            <div className="card-value accent">{mediaDiaria}</div>
            <div className="card-sub">por dia — últimos {days} dias</div>
          </div>
          <div className="card card-danger">
            <div className="card-label">Erros hoje</div>
            <div className="card-value danger">{loading ? '—' : (data?.totais_hoje?.erro || 0)}</div>
          </div>
          <div className="card card-danger">
            <div className="card-label">Erros no período</div>
            <div className="card-value danger">{loading ? '—' : (data?.totais_periodo?.erro || 0)}</div>
            <div className="card-sub">últimos {days} dias</div>
          </div>
        </div>

        {/* Cards por tipo */}
        <div className="section-label">Por tipo — hoje</div>
        <div className="type-cards">
          {COUNTERS.filter(c => c.id !== 'erro').map(c => (
            <div
              key={c.id}
              className={`type-card ${chartMode === c.id ? 'active' : ''}`}
              style={{ '--c': c.color }}
              onClick={() => setChartMode(c.id)}
            >
              <div className="type-label">{c.label}</div>
              <div className="type-value">{loading ? '—' : (data?.totais_hoje?.[c.id] || 0)}</div>
              <div className="type-period">{data?.totais_periodo?.[c.id] || 0} no período</div>
            </div>
          ))}
        </div>

        {/* Gráfico */}
        <div className="chart-box">
          <div className="chart-title">
            {chartMode === 'all' ? 'Todos os contadores' : COUNTERS.find(c => c.id === chartMode)?.label}
            <span className="chart-sub"> — por dia</span>
          </div>

          {error && <div className="msg-error">Erro: {error}</div>}
          {loading && <div className="msg-loading">Carregando...</div>}

          {!error && !loading && chartData.length > 0 && (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={chartData} barCategoryGap="30%" barGap={2}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
                {chartData.filter(d => d._weekend).map(d => (
                  <ReferenceArea key={d._key} x1={d.label} x2={d.label} fill={weekendFill} stroke="none" ifOverflow="visible" />
                ))}
                <XAxis
                  dataKey="label"
                  tick={{ fill: tickFill, fontSize: 11, fontFamily: 'DM Mono' }}
                  axisLine={false} tickLine={false}
                />
                <YAxis
                  tick={{ fill: tickFill, fontSize: 11, fontFamily: 'DM Mono' }}
                  axisLine={false} tickLine={false} allowDecimals={false} width={28}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelStyle={tooltipLabelStyle}
                  itemStyle={tooltipItemStyle}
                />
                {chartMode === 'all' && (
                  <Legend wrapperStyle={{ fontSize: 11, fontFamily: 'DM Mono', paddingTop: 12 }} />
                )}
                {activeCounters.map(c => (
                  <Bar key={c.id} dataKey={c.id} name={c.label} fill={c.color} radius={[3, 3, 0, 0]} maxBarSize={40} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          )}

          {!error && !loading && chartData.every(d => activeCounters.every(c => d[c.id] === 0)) && (
            <div className="msg-empty">Nenhuma execução neste período.</div>
          )}
        </div>

        <style jsx>{`
          .cards-grid {
            display: grid;
            grid-template-columns: repeat(5, minmax(0, 1fr));
            gap: 12px;
            margin-bottom: 28px;
          }
          .card-highlight { border-color: var(--accent-border); }
          .card-danger { border-color: var(--danger-border); }
          .card-value.accent { color: var(--accent); }
          .card-value.danger { color: var(--danger); }

          .type-cards {
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 10px;
            margin-bottom: 28px;
          }
          .type-card {
            background: var(--card-bg);
            border: 1px solid var(--border);
            border-left: 3px solid var(--c);
            border-radius: 12px;
            padding: 14px;
            cursor: pointer;
            transition: background 0.15s;
            box-shadow: var(--shadow);
          }
          .type-card:hover { background: var(--card-hover); }
          .type-card.active { background: var(--card-hover); border-color: var(--border-strong); border-left-color: var(--c); }
          .type-label { font-size: 11px; color: var(--text-muted); font-family: 'DM Mono', monospace; margin-bottom: 4px; }
          .type-value { font-size: 28px; font-weight: 700; color: var(--text); line-height: 1; }
          .type-period { font-size: 10px; color: var(--text-dim); font-family: 'DM Mono', monospace; margin-top: 4px; }

          @media (max-width: 1100px) and (min-width: 769px) {
            .cards-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
          }
          @media (max-width: 768px) {
            .cards-grid { grid-template-columns: repeat(2, 1fr); }
            .type-cards { grid-template-columns: repeat(2, 1fr); }
          }
        `}</style>
      </Layout>
    </>
  );
}
