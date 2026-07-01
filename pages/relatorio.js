import { useState, useEffect, useCallback, useRef } from 'react';
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip,
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
  const todayStr = `${y}-${pad(m)}-${pad(d)}`;
  if (preset === 'hoje') return { inicio: todayStr, fim: todayStr };
  if (preset === '7dias') {
    const base = Date.UTC(y, m - 1, d);
    return { inicio: ymdFromUTC(new Date(base - 6 * 86400000)), fim: todayStr };
  }
  if (preset === 'mes') return { inicio: `${y}-${pad(m)}-01`, fim: todayStr };
  if (preset === 'mespassado') {
    const ly = m === 1 ? y - 1 : y;
    const lm = m === 1 ? 12 : m - 1;
    const ultimoDia = new Date(Date.UTC(ly, lm, 0)).getUTCDate();
    return { inicio: `${ly}-${pad(lm)}-01`, fim: `${ly}-${pad(lm)}-${pad(ultimoDia)}` };
  }
  return { inicio: `${y}-${pad(m)}-01`, fim: todayStr };
}

// Desloca um período de data em -1 mês mantendo os mesmos dias
function shiftOneMonthBack(ini, fim) {
  const dIni = new Date(ini + 'T00:00:00Z');
  const dFim = new Date(fim + 'T00:00:00Z');
  const novoFimMs = Date.UTC(
    dFim.getUTCMonth() === 0 ? dFim.getUTCFullYear() - 1 : dFim.getUTCFullYear(),
    dFim.getUTCMonth() === 0 ? 11 : dFim.getUTCMonth() - 1,
    dFim.getUTCDate()
  );
  const novoIniMs = Date.UTC(
    dIni.getUTCMonth() === 0 ? dIni.getUTCFullYear() - 1 : dIni.getUTCFullYear(),
    dIni.getUTCMonth() === 0 ? 11 : dIni.getUTCMonth() - 1,
    dIni.getUTCDate()
  );
  return {
    inicio: new Date(novoIniMs).toISOString().slice(0, 10),
    fim: new Date(novoFimMs).toISOString().slice(0, 10),
  };
}

function buildRange(inicio, fim) {
  const out = [];
  let cur = new Date(inicio + 'T00:00:00Z');
  const end = new Date(fim + 'T00:00:00Z');
  let guard = 0;
  while (cur <= end && guard < 800) {
    out.push(cur.toISOString().slice(0, 10));
    cur = new Date(cur.getTime() + 86400000);
    guard++;
  }
  return out;
}

const labelDia = (key) =>
  new Date(key + 'T00:00:00Z').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });

const diaSemana = (key) =>
  new Date(key + 'T00:00:00Z').toLocaleDateString('pt-BR', { weekday: 'long', timeZone: 'UTC' });

const isWeekendKey = (key) => {
  const day = new Date(key + 'T00:00:00Z').getUTCDay();
  return day === 0 || day === 6;
};

function delta(a, b) {
  if (a === 0 && b === 0) return null;
  if (a === 0) return { pct: null, label: 'novo', up: true };
  const pct = Math.round(((b - a) / a) * 100);
  return { pct, label: `${pct > 0 ? '+' : ''}${pct}%`, up: pct >= 0 };
}

export default function Relatorio() {
  const inicial = presetRange('mes');
  const { y: maxY, m: maxM, d: maxD } = brParts();
  const hojeStr = `${maxY}-${pad(maxM)}-${pad(maxD)}`;

  // Período A
  const [inicio, setInicio] = useState(inicial.inicio);
  const [fim, setFim] = useState(inicial.fim);
  const [activePreset, setActivePreset] = useState('mes');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);

  // Período B (comparação)
  const [compareMode, setCompareMode] = useState(false);
  const iniB0 = shiftOneMonthBack(inicial.inicio, inicial.fim);
  const [inicioB, setInicioB] = useState(iniB0.inicio);
  const [fimB, setFimB] = useState(iniB0.fim);
  const [dataB, setDataB] = useState(null);
  const [loadingB, setLoadingB] = useState(false);
  const [errorB, setErrorB] = useState(null);

  const [selected, setSelected] = useState(null);
  const reqSeq = useRef(0);
  const reqSeqB = useRef(0);
  const { theme } = useTheme();

  const carregar = useCallback(async (ini, end) => {
    const myReq = ++reqSeq.current;
    setLoading(true); setError(null); setAviso(null);
    let qIni = ini, qFim = end;
    if (qIni > qFim) { [qIni, qFim] = [qFim, qIni]; setAviso('Datas do Período A invertidas — ajustamos.'); }
    try {
      const res = await fetch(`${EDGE_URL}/dashboard-periodo?inicio=${qIni}&fim=${qFim}`);
      const json = await res.json();
      if (myReq !== reqSeq.current) return;
      if (!json.success) throw new Error(json.error || 'Erro desconhecido');
      setData(json);
    } catch (e) {
      if (myReq !== reqSeq.current) return;
      setError(e.message); setData(null);
    } finally {
      if (myReq === reqSeq.current) setLoading(false);
    }
  }, []);

  const carregarB = useCallback(async (ini, end) => {
    const myReq = ++reqSeqB.current;
    setLoadingB(true); setErrorB(null);
    try {
      const res = await fetch(`${EDGE_URL}/dashboard-periodo?inicio=${ini}&fim=${end}`);
      const json = await res.json();
      if (myReq !== reqSeqB.current) return;
      if (!json.success) throw new Error(json.error || 'Erro desconhecido');
      setDataB(json);
    } catch (e) {
      if (myReq !== reqSeqB.current) return;
      setErrorB(e.message); setDataB(null);
    } finally {
      if (myReq === reqSeqB.current) setLoadingB(false);
    }
  }, []);

  useEffect(() => { carregar(inicial.inicio, inicial.fim); }, []); // eslint-disable-line

  const aplicarPreset = (preset) => {
    const r = presetRange(preset);
    setInicio(r.inicio); setFim(r.fim); setActivePreset(preset);
    carregar(r.inicio, r.fim);
    if (compareMode) {
      const b = shiftOneMonthBack(r.inicio, r.fim);
      setInicioB(b.inicio); setFimB(b.fim);
      carregarB(b.inicio, b.fim);
    }
  };

  const aplicarManual = () => {
    setActivePreset(null);
    carregar(inicio, fim);
    if (compareMode) carregarB(inicioB, fimB);
  };

  const toggleCompare = () => {
    if (!compareMode) {
      // Ao ativar, carrega o período B (mês anterior do período A atual)
      const b = shiftOneMonthBack(inicio, fim);
      setInicioB(b.inicio); setFimB(b.fim);
      carregarB(b.inicio, b.fim);
    }
    setCompareMode(v => !v);
  };

  // Dados período A
  const range = data ? buildRange(data.inicio, data.fim) : [];
  const chartData = range.map((key) => {
    const row = { label: labelDia(key), labelSemana: `${labelDia(key)} ${diaSemana(key)}`, _key: key, _weekend: isWeekendKey(key) };
    COUNTERS.forEach((c) => {
      const found = data?.series?.find((s) => s.counter_id === c.id && s.dia === key);
      row[c.id] = found ? Number(found.total) : 0;
    });
    row._total = COUNTERS.reduce((s, c) => s + (row[c.id] || 0), 0);
    return row;
  });
  const totalGeral = COUNTERS.reduce((s, c) => s + (data?.totais?.[c.id] || 0), 0);
  const temDados = range.length > 0 && totalGeral > 0;
  const xInterval = chartData.length > 20 ? Math.ceil(chartData.length / 12) : 0;

  const visibleCounters = selected ? COUNTERS.filter(c => c.id === selected) : COUNTERS;
  const selectedCounter = selected ? COUNTERS.find(c => c.id === selected) : null;

  // Dados comparação: gráfico de barras agrupadas por counter
  const compareChartData = COUNTERS.map(c => ({
    name: c.label,
    color: c.color,
    A: data?.totais?.[c.id] || 0,
    B: dataB?.totais?.[c.id] || 0,
  }));

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

  const labelA = data ? `${labelDia(data.inicio)} – ${labelDia(data.fim)}` : 'Período A';
  const labelB = dataB ? `${labelDia(dataB.inicio)} – ${labelDia(dataB.fim)}` : 'Período B';

  return (
    <>
      <Head><title>Relatório por período — OC ADV</title></Head>

      <Layout activePage="relatorio">

        <header className="page-header">
          <div>
            <h1 className="page-title">Relatório por período</h1>
            <p className="page-subtitle">
              {data
                ? `${labelDia(data.inicio)} a ${labelDia(data.fim)} · ${data.dias_intervalo} dia(s)`
                : 'Selecione um período'}
            </p>
          </div>
          <button
            className={`compare-toggle ${compareMode ? 'active' : ''}`}
            onClick={toggleCompare}
          >
            ⇄ {compareMode ? 'Comparando' : 'Comparar períodos'}
          </button>
        </header>

        {/* Filtros */}
        <div className="filtros">
          {/* Presets + período A */}
          <div className={compareMode ? 'periodo-label' : ''}>
            {compareMode && <span className="periodo-tag a">Período A</span>}
            <div className="presets">
              {[
                { k: 'hoje',       label: 'Hoje' },
                { k: '7dias',      label: '7 dias' },
                { k: 'mes',        label: 'Este mês' },
                { k: 'mespassado', label: 'Mês passado' },
              ].map((p) => (
                <button
                  key={p.k}
                  className={`preset-btn ${activePreset === p.k ? 'active' : ''}`}
                  onClick={() => aplicarPreset(p.k)}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="date-row">
              <div className="date-field">
                <label>Início</label>
                <input type="date" value={inicio} max={hojeStr}
                  onChange={(e) => { setInicio(e.target.value); setActivePreset(null); }} />
              </div>
              <div className="date-field">
                <label>Fim</label>
                <input type="date" value={fim} max={hojeStr}
                  onChange={(e) => { setFim(e.target.value); setActivePreset(null); }} />
              </div>
              {!compareMode && (
                <button className="aplicar-btn" onClick={aplicarManual} disabled={loading}>
                  {loading ? '...' : 'Aplicar'}
                </button>
              )}
            </div>
          </div>

          {/* Período B */}
          {compareMode && (
            <>
              <div className="compare-divider" />
              <div className="periodo-label">
                <span className="periodo-tag b">Período B</span>
                <div className="date-row">
                  <div className="date-field">
                    <label>Início</label>
                    <input type="date" value={inicioB} max={hojeStr}
                      onChange={(e) => setInicioB(e.target.value)} />
                  </div>
                  <div className="date-field">
                    <label>Fim</label>
                    <input type="date" value={fimB} max={hojeStr}
                      onChange={(e) => setFimB(e.target.value)} />
                  </div>
                </div>
              </div>
              <div style={{ marginTop: 14 }}>
                <button className="aplicar-btn" onClick={aplicarManual} disabled={loading || loadingB}>
                  {(loading || loadingB) ? '...' : 'Aplicar comparação'}
                </button>
              </div>
            </>
          )}

          {aviso && <div className="aviso">{aviso}</div>}
        </div>

        {/* ── MODO COMPARAÇÃO ── */}
        {compareMode ? (
          <>
            {/* Cards de comparação */}
            <div className="section-label">Comparação — total por contador</div>
            <div className="cards-compare">
              {COUNTERS.map((c) => {
                const vA = data?.totais?.[c.id] || 0;
                const vB = dataB?.totais?.[c.id] || 0;
                const d = delta(vA, vB);
                const diasA = data?.dias_intervalo || 1;
                const diasB = dataB?.dias_intervalo || 1;
                return (
                  <div key={c.id} className="card-cmp" style={{ '--c': c.color }}>
                    <div className="cmp-label">{c.label}</div>
                    <div className="cmp-row">
                      <div className="cmp-col">
                        <div className="cmp-tag a">A</div>
                        <div className="cmp-val" style={{ color: c.color }}>{loading ? '—' : vA}</div>
                        {!loading && <div className="cmp-media">{(vA / diasA).toFixed(1)}/dia</div>}
                        <div className="cmp-period">{labelA}</div>
                      </div>
                      <div className={`cmp-delta ${d ? (d.up ? 'up' : 'down') : 'neutral'}`}>
                        {d ? (d.pct !== null ? d.label : d.label) : '—'}
                      </div>
                      <div className="cmp-col">
                        <div className="cmp-tag b">B</div>
                        <div className="cmp-val" style={{ color: c.color }}>{loadingB ? '—' : vB}</div>
                        {!loadingB && <div className="cmp-media">{(vB / diasB).toFixed(1)}/dia</div>}
                        <div className="cmp-period">{labelB}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Gráfico de barras comparando totais */}
            {!loading && !loadingB && (
              <div className="chart-box">
                <div className="chart-title">
                  Comparação por contador
                  <span className="chart-sub"> — total no período</span>
                </div>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={compareChartData} barCategoryGap="30%" barGap={4}>
                    <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
                    <XAxis dataKey="name" tick={{ fill: tickFill, fontSize: 11, fontFamily: 'DM Mono' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: tickFill, fontSize: 11, fontFamily: 'DM Mono' }} axisLine={false} tickLine={false} allowDecimals={false} width={28} />
                    <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle} />
                    <Legend wrapperStyle={{ fontSize: 11, fontFamily: 'DM Mono', paddingTop: 12 }} />
                    <Bar dataKey="A" name={`A: ${labelA}`} fill={isDark ? '#4a9e80' : '#1D9E75'} radius={[3,3,0,0]} maxBarSize={32} />
                    <Bar dataKey="B" name={`B: ${labelB}`} fill={isDark ? '#555' : '#bbb'} radius={[3,3,0,0]} maxBarSize={32} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {(errorB || error) && (
              <div className="msg-error">Erro: {error || errorB}</div>
            )}
          </>
        ) : (
          <>
            {/* ── MODO NORMAL ── */}
            <div className="cards-rel">
              <div
                className={`card card-total ${!selected ? 'card-active' : ''}`}
                onClick={() => setSelected(null)}
              >
                <div className="card-label">Total no período</div>
                <div className="card-value accent">{loading ? '—' : totalGeral}</div>
                {!selected && <div className="card-hint">todos</div>}
              </div>
              {COUNTERS.map((c) => (
                <div
                  key={c.id}
                  className={`card card-counter ${selected === c.id ? 'card-active' : ''}`}
                  style={{ '--c': c.color }}
                  onClick={() => setSelected(prev => prev === c.id ? null : c.id)}
                >
                  <div className="card-label">{c.label}</div>
                  <div className="card-value" style={{ color: c.color }}>
                    {loading ? '—' : (data?.totais?.[c.id] || 0)}
                  </div>
                  {!loading && data?.dias_intervalo > 0 && (
                    <div className="card-media">
                      {((data?.totais?.[c.id] || 0) / data.dias_intervalo).toFixed(1)}/dia
                    </div>
                  )}
                  {selected === c.id && <div className="card-hint">selecionado</div>}
                </div>
              ))}
            </div>

            {/* Gráfico de linha */}
            <div className="chart-box">
              <div className="chart-title">
                {selectedCounter ? selectedCounter.label : 'Todos os contadores'}
                <span className="chart-sub"> — evolução diária</span>
              </div>
              {error && <div className="msg-error">Erro ao carregar: {error}</div>}
              {loading && <div className="msg-loading">Carregando...</div>}
              {!loading && !error && !temDados && (
                <div className="msg-empty">Nenhuma execução registrada neste período.</div>
              )}
              {!loading && !error && temDados && (
                <div className="chart-scroll">
                  <div style={{ minWidth: chartData.length > 31 ? chartData.length * 22 : '100%', height: 300 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
                        {chartData.filter(d => d._weekend).map(d => (
                          <ReferenceArea key={d._key} x1={d.labelSemana} x2={d.labelSemana} fill={weekendFill} stroke="none" ifOverflow="visible" />
                        ))}
                        <XAxis dataKey="labelSemana" scale="band" tick={{ fill: tickFill, fontSize: 11, fontFamily: 'DM Mono' }} axisLine={false} tickLine={false} interval={xInterval} />
                        <YAxis tick={{ fill: tickFill, fontSize: 11, fontFamily: 'DM Mono' }} axisLine={false} tickLine={false} allowDecimals={false} width={30} />
                        <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle} />
                        {!selected && <Legend wrapperStyle={{ fontSize: 11, fontFamily: 'DM Mono', paddingTop: 12 }} />}
                        {visibleCounters.map((c) => (
                          <Line key={c.id} type="monotone" dataKey={c.id} name={c.label} stroke={c.color}
                            strokeWidth={selected ? 2.5 : 2} dot={chartData.length <= 31} activeDot={{ r: 4 }} />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </div>

            {/* Tabela */}
            {!loading && !error && temDados && (
              <div className="chart-box">
                <div className="chart-title">
                  Detalhamento por dia
                  {selectedCounter && <span className="chart-sub"> — {selectedCounter.label}</span>}
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Dia</th>
                        {visibleCounters.map((c) => <th key={c.id} style={{ color: c.color }}>{c.label}</th>)}
                        {!selected && <th>Total</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {chartData
                        .filter((r) => selected ? r[selected] > 0 : r._total > 0)
                        .map((r) => (
                          <tr key={r._key} className={r._weekend ? 'tr-weekend' : ''}>
                            <td className="td-dia">
                              {r.label}
                              <span className="td-weekday">{diaSemana(r._key)}</span>
                            </td>
                            {visibleCounters.map((c) => <td key={c.id}>{r[c.id] || '·'}</td>)}
                            {!selected && <td className="td-total">{r._total}</td>}
                          </tr>
                        ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td className="td-dia">Total</td>
                        {visibleCounters.map((c) => (
                          <td key={c.id} className="td-total">{data?.totais?.[c.id] || 0}</td>
                        ))}
                        {!selected && <td className="td-total">{totalGeral}</td>}
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}
          </>
        )}

        <style jsx>{`
          /* ── Header toggle ── */
          .compare-toggle {
            padding: 8px 16px;
            border-radius: 8px;
            border: 1px solid var(--border-strong);
            background: transparent;
            color: var(--text-muted);
            font-size: 12px;
            font-family: 'DM Mono', monospace;
            transition: all 0.15s;
            white-space: nowrap;
          }
          .compare-toggle:hover { color: var(--text); border-color: var(--accent); }
          .compare-toggle.active { color: var(--accent); background: var(--accent-bg); border-color: var(--accent-border); }

          /* ── Filtros ── */
          .filtros {
            background: var(--card-bg);
            border: 1px solid var(--border);
            border-radius: 12px;
            padding: 16px 18px;
            margin-bottom: 24px;
            box-shadow: var(--shadow);
          }
          .presets { display: flex; gap: 6px; margin-bottom: 14px; flex-wrap: wrap; }
          .preset-btn {
            padding: 6px 14px; border-radius: 6px; border: 1px solid var(--border-strong);
            background: transparent; color: var(--text-muted); font-size: 12px;
            font-family: 'DM Mono', monospace; transition: all 0.15s;
          }
          .preset-btn:hover { color: var(--text); border-color: var(--accent); }
          .preset-btn.active { color: var(--accent); background: var(--accent-bg); border-color: var(--accent-border); }

          .date-row { display: flex; align-items: flex-end; gap: 12px; flex-wrap: wrap; }
          .date-field { display: flex; flex-direction: column; gap: 4px; }
          .date-field label { font-size: 10px; color: var(--text-dim); font-family: 'DM Mono', monospace; text-transform: uppercase; letter-spacing: 0.08em; }
          .date-field input {
            background: var(--input-bg); border: 1px solid var(--border-strong);
            border-radius: 8px; color: var(--text); padding: 8px 12px;
            font-size: 13px; font-family: 'DM Mono', monospace; color-scheme: dark;
          }
          .date-field input:focus { outline: none; border-color: var(--accent); }
          .aplicar-btn {
            padding: 9px 22px; border-radius: 8px; border: none;
            background: var(--accent); color: #fff; font-size: 13px;
            font-weight: 700; transition: opacity 0.15s;
          }
          .aplicar-btn:hover { opacity: 0.85; }
          .aplicar-btn:disabled { opacity: 0.5; }
          .aviso { margin-top: 12px; font-size: 12px; color: #EF9F27; font-family: 'DM Mono', monospace; }

          .compare-divider { border: none; border-top: 1px dashed var(--border-strong); margin: 16px 0; }
          .periodo-label { display: flex; flex-direction: column; gap: 12px; }
          .periodo-tag {
            display: inline-block; padding: 2px 10px; border-radius: 4px;
            font-size: 10px; font-family: 'DM Mono', monospace;
            font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;
            margin-bottom: 4px;
          }
          .periodo-tag.a { background: var(--accent-bg); color: var(--accent); border: 1px solid var(--accent-border); }
          .periodo-tag.b { background: rgba(150,150,150,0.1); color: var(--text-muted); border: 1px solid var(--border-strong); }

          /* ── Cards modo normal ── */
          .cards-rel {
            display: grid; grid-template-columns: repeat(6, minmax(0, 1fr));
            gap: 10px; margin-bottom: 24px;
          }
          .card-total { border-left: 3px solid var(--accent); cursor: pointer; transition: background 0.15s; }
          .card-total:hover { background: var(--card-hover); }
          .card-counter { border-left: 3px solid var(--c); cursor: pointer; transition: background 0.15s; }
          .card-counter:hover { background: var(--card-hover); }
          .card-active { background: var(--card-hover); box-shadow: 0 0 0 1px var(--border-strong); }
          .card-media { font-size: 10px; font-family: 'DM Mono', monospace; color: var(--text-dim); margin-top: 4px; }
          .card-hint { font-size: 9px; font-family: 'DM Mono', monospace; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.08em; margin-top: 4px; }
          .card-value.accent { color: var(--accent); }

          /* ── Cards modo comparação ── */
          .cards-compare {
            display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 12px; margin-bottom: 24px;
          }
          .card-cmp {
            background: var(--card-bg); border: 1px solid var(--border);
            border-left: 3px solid var(--c); border-radius: 12px;
            padding: 16px 18px; box-shadow: var(--shadow);
          }
          .cmp-label { font-size: 11px; color: var(--text-muted); font-family: 'DM Mono', monospace; margin-bottom: 12px; letter-spacing: 0.04em; }
          .cmp-row { display: flex; align-items: center; gap: 12px; }
          .cmp-col { flex: 1; display: flex; flex-direction: column; gap: 2px; }
          .cmp-tag {
            font-size: 9px; font-family: 'DM Mono', monospace; font-weight: 700;
            padding: 1px 6px; border-radius: 3px; display: inline-block;
            margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.08em;
            width: fit-content;
          }
          .cmp-tag.a { background: var(--accent-bg); color: var(--accent); }
          .cmp-tag.b { background: rgba(150,150,150,0.1); color: var(--text-muted); }
          .cmp-val { font-size: 26px; font-weight: 700; line-height: 1; }
          .cmp-media { font-size: 10px; font-family: 'DM Mono', monospace; color: var(--text-dim); margin-top: 2px; }
          .cmp-period { font-size: 10px; font-family: 'DM Mono', monospace; color: var(--text-dim); margin-top: 4px; }
          .cmp-delta {
            font-size: 13px; font-weight: 700; font-family: 'DM Mono', monospace;
            text-align: center; min-width: 52px; padding: 6px 8px;
            border-radius: 6px; flex-shrink: 0;
          }
          .cmp-delta.up { color: #1D9E75; background: rgba(29,158,117,0.1); }
          .cmp-delta.down { color: #E24B4A; background: rgba(226,75,74,0.1); }
          .cmp-delta.neutral { color: var(--text-dim); }

          /* ── Tabela ── */
          .table-scroll { overflow-x: auto; }
          table { width: 100%; border-collapse: collapse; font-family: 'DM Mono', monospace; font-size: 12px; }
          th { text-align: right; padding: 8px 10px; color: var(--text-muted); font-weight: 500; border-bottom: 1px solid var(--border-strong); white-space: nowrap; }
          th:first-child { text-align: left; }
          td { text-align: right; padding: 7px 10px; color: var(--text-sub); border-bottom: 1px solid var(--border); }
          .td-dia { text-align: left; color: var(--text-muted); white-space: nowrap; }
          .td-weekday { margin-left: 8px; color: var(--text-dim); font-size: 11px; }
          .td-total { color: var(--text); font-weight: 700; }
          tfoot td { border-top: 1px solid var(--border-strong); border-bottom: none; color: var(--text); font-weight: 700; padding-top: 10px; }
          .tr-weekend td { background: var(--weekend-bg); }

          @media (max-width: 768px) {
            .cards-rel { grid-template-columns: repeat(2, 1fr); }
            .cards-compare { grid-template-columns: 1fr; }
            .date-row { flex-direction: column; align-items: stretch; }
            .date-field input { width: 100%; }
            .aplicar-btn { width: 100%; padding: 11px; }
          }
        `}</style>
      </Layout>
    </>
  );
}
