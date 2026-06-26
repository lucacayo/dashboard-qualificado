import { useState, useEffect, useCallback, useRef } from 'react';
import Head from 'next/head';
import Layout from '../components/Layout';
import { useTheme } from '../components/ThemeContext';

const EDGE_URL = 'https://aomssdkitrcvagvnluki.supabase.co/functions/v1/contador';

const ETAPAS = [
  {
    id: 'novo_lead',
    num: 1,
    label: 'Novo Lead',
    color: '#1D9E75',
    counters: [
      { id: 'novo_lead', label: 'Total' },
    ],
  },
  {
    id: 'atendimento_iniciado',
    num: 2,
    label: 'Atendimento Iniciado',
    color: '#378ADD',
    counters: [
      { id: 'atendimento_previ', label: 'PREVI' },
      { id: 'atendimento_civel', label: 'CÍVEL' },
    ],
  },
  {
    id: 'agendamento',
    num: 3,
    label: 'Agendamento',
    color: '#7F77DD',
    counters: [
      { id: 'qualificado_previ_ae', label: 'PREVI AE' },
      { id: 'qualificado_civel_ae', label: 'CÍVEL AE' },
    ],
  },
  {
    id: 'contratos_fechados',
    num: 4,
    label: 'Contratos Fechados',
    color: '#EF9F27',
    counters: [],
    placeholder: true,
  },
];

const pad = (n) => String(n).padStart(2, '0');

function brParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const [y, m, d] = fmt.format(date).split('-');
  return { y: +y, m: +m, d: +d };
}

function presetRange(preset) {
  const { y, m, d } = brParts();
  const todayStr = `${y}-${pad(m)}-${pad(d)}`;
  if (preset === 'hoje') return { inicio: todayStr, fim: todayStr };
  if (preset === '7dias') {
    const base = Date.UTC(y, m - 1, d);
    const ini = new Date(base - 6 * 86400000);
    return { inicio: ini.toISOString().slice(0, 10), fim: todayStr };
  }
  if (preset === '30dias') {
    const base = Date.UTC(y, m - 1, d);
    const ini = new Date(base - 29 * 86400000);
    return { inicio: ini.toISOString().slice(0, 10), fim: todayStr };
  }
  if (preset === '90dias') {
    const base = Date.UTC(y, m - 1, d);
    const ini = new Date(base - 89 * 86400000);
    return { inicio: ini.toISOString().slice(0, 10), fim: todayStr };
  }
  return { inicio: todayStr, fim: todayStr };
}

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

function delta(a, b) {
  if (a === null || b === null) return null;
  if (b === 0 && a === 0) return { pct: 0, label: '0%', up: null };
  if (b === 0) return { pct: null, label: '—', up: null };
  const pct = Math.round(((a - b) / b) * 100);
  return { pct, label: `${pct >= 0 ? '+' : ''}${pct}%`, up: pct > 0 };
}

const labelDia = (key) =>
  new Date(key + 'T00:00:00Z').toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', timeZone: 'UTC',
  });

const PRESETS = [
  { key: 'hoje',   label: 'Hoje' },
  { key: '7dias',  label: '7 dias' },
  { key: '30dias', label: '30 dias' },
  { key: '90dias', label: '90 dias' },
  { key: 'custom', label: 'Personalizado' },
];

export default function Funil() {
  const inicial = presetRange('hoje');
  const { y: maxY, m: maxM, d: maxD } = brParts();
  const hojeStr = `${maxY}-${pad(maxM)}-${pad(maxD)}`;

  // Período normal
  const [activePreset, setActivePreset] = useState('hoje');
  const [inicio, setInicio] = useState(inicial.inicio);
  const [fim, setFim] = useState(inicial.fim);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState('');
  const reqSeq = useRef(0);

  // Modo comparação
  const [compareMode, setCompareMode] = useState(false);
  const [inicioB, setInicioB] = useState('');
  const [fimB, setFimB] = useState('');
  const [dataB, setDataB] = useState(null);
  const [loadingB, setLoadingB] = useState(false);
  const [errorB, setErrorB] = useState(null);
  const reqSeqB = useRef(0);

  const { theme } = useTheme();

  const carregar = useCallback(async (ini, end) => {
    const myReq = ++reqSeq.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${EDGE_URL}/dashboard-periodo?inicio=${ini}&fim=${end}`);
      const json = await res.json();
      if (myReq !== reqSeq.current) return;
      if (!json.success) throw new Error(json.error || 'Erro desconhecido');
      setData(json);
      setLastUpdated(
        new Date().toLocaleTimeString('pt-BR', {
          timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit',
        })
      );
    } catch (e) {
      if (myReq !== reqSeq.current) return;
      setError(e.message);
    } finally {
      if (myReq === reqSeq.current) setLoading(false);
    }
  }, []);

  const carregarB = useCallback(async (ini, end) => {
    const myReq = ++reqSeqB.current;
    setLoadingB(true);
    setErrorB(null);
    try {
      const res = await fetch(`${EDGE_URL}/dashboard-periodo?inicio=${ini}&fim=${end}`);
      const json = await res.json();
      if (myReq !== reqSeqB.current) return;
      if (!json.success) throw new Error(json.error || 'Erro desconhecido');
      setDataB(json);
    } catch (e) {
      if (myReq !== reqSeqB.current) return;
      setErrorB(e.message);
    } finally {
      if (myReq === reqSeqB.current) setLoadingB(false);
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

  const aplicarCustom = () => {
    carregar(inicio, fim);
  };

  const toggleCompare = () => {
    if (!compareMode) {
      const shifted = shiftOneMonthBack(inicio, fim);
      setInicioB(shifted.inicio);
      setFimB(shifted.fim);
      carregarB(shifted.inicio, shifted.fim);
    }
    setCompareMode(c => !c);
  };

  const aplicarComparacao = () => {
    carregar(inicio, fim);
    carregarB(inicioB, fimB);
  };

  const totaisObj  = data?.totais;
  const totaisObjB = dataB?.totais;

  const totalEtapa = (etapa, obj) =>
    etapa.counters.reduce((sum, c) => sum + (obj?.[c.id] || 0), 0);

  const totais  = ETAPAS.map(e => ({ id: e.id, total: e.placeholder ? null : totalEtapa(e, totaisObj) }));
  const totaisB = ETAPAS.map(e => ({ id: e.id, total: e.placeholder ? null : totalEtapa(e, totaisObjB) }));
  const maxTotal = Math.max(...totais.map(t => t.total ?? 0), 1);

  const subtitulo = data
    ? inicio === fim
      ? labelDia(data.inicio)
      : `${labelDia(data.inicio)} a ${labelDia(data.fim)} · ${data.dias_intervalo} dia(s)`
    : null;

  const isDark = theme === 'dark';

  return (
    <>
      <Head><title>Funil — OC ADV</title></Head>

      <Layout activePage="funil">

        <header className="page-header">
          <div>
            <h1 className="page-title">Funil de conversão</h1>
            <p className="page-subtitle">
              {subtitulo || (lastUpdated ? `Atualizado às ${lastUpdated}` : 'Carregando...')}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              className={`compare-toggle ${compareMode ? 'active' : ''}`}
              onClick={toggleCompare}
            >
              ⇄ {compareMode ? 'Comparando' : 'Comparar períodos'}
            </button>
            <button className="refresh-btn" onClick={() => { carregar(inicio, fim); if (compareMode) carregarB(inicioB, fimB); }} disabled={loading}>
              <span className={loading ? 'spinning' : ''}>↻</span>
              Atualizar
            </button>
          </div>
        </header>

        {/* Modo normal: presets */}
        {!compareMode && (
          <>
            <div className="tabs-row">
              {PRESETS.map(p => (
                <button
                  key={p.key}
                  className={`funil-tab ${activePreset === p.key ? 'active' : ''}`}
                  onClick={() => p.key === 'custom' ? setActivePreset('custom') : aplicarPreset(p.key)}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {activePreset === 'custom' && (
              <div className="custom-row">
                <div className="date-field">
                  <label>Início</label>
                  <input type="date" value={inicio} max={hojeStr} onChange={e => setInicio(e.target.value)} />
                </div>
                <div className="date-field">
                  <label>Fim</label>
                  <input type="date" value={fim} max={hojeStr} onChange={e => setFim(e.target.value)} />
                </div>
                <button className="aplicar-btn" onClick={aplicarCustom} disabled={loading}>
                  {loading ? '...' : 'Aplicar'}
                </button>
              </div>
            )}
          </>
        )}

        {/* Modo comparação: dois seletores de data */}
        {compareMode && (
          <div className="compare-row">
            <div className="compare-period">
              <span className="period-tag tag-a">A</span>
              <div className="date-field">
                <label>Início</label>
                <input type="date" value={inicio} max={hojeStr} onChange={e => setInicio(e.target.value)} />
              </div>
              <div className="date-field">
                <label>Fim</label>
                <input type="date" value={fim} max={hojeStr} onChange={e => setFim(e.target.value)} />
              </div>
            </div>
            <div className="compare-period">
              <span className="period-tag tag-b">B</span>
              <div className="date-field">
                <label>Início</label>
                <input type="date" value={inicioB} max={hojeStr} onChange={e => setInicioB(e.target.value)} />
              </div>
              <div className="date-field">
                <label>Fim</label>
                <input type="date" value={fimB} max={hojeStr} onChange={e => setFimB(e.target.value)} />
              </div>
            </div>
            <button className="aplicar-btn" onClick={aplicarComparacao} disabled={loading || loadingB}>
              {loading || loadingB ? '...' : 'Aplicar'}
            </button>
          </div>
        )}

        {error && <div className="msg-error">Erro A: {error}</div>}
        {compareMode && errorB && <div className="msg-error">Erro B: {errorB}</div>}

        {/* Visualização em funil — modo normal */}
        {!compareMode && (
          <div className="chart-box fv-box">
            <div className="chart-title">Visão do funil<span className="chart-sub"> — proporção por etapa</span></div>
            <div className="fv-wrap">
              {ETAPAS.map((etapa, idx) => {
                const total = totais[idx].total;
                const prevTotal = idx > 0 ? totais[idx - 1].total : null;
                const conversion =
                  prevTotal !== null && prevTotal > 0 && total !== null
                    ? Math.round((total / prevTotal) * 100)
                    : null;
                const pct = etapa.placeholder
                  ? 6
                  : Math.max(6, Math.round(((total || 0) / maxTotal) * 100));

                return (
                  <div key={etapa.id} className="fv-stage">
                    {idx > 0 && (
                      <div className="fv-arrow">
                        {conversion !== null
                          ? <span className="fv-conv">{conversion}% conversão</span>
                          : <span className="fv-conv dim">—</span>}
                        <span className="fv-chevron">▼</span>
                      </div>
                    )}
                    <div className="fv-bar-wrap">
                      <div
                        className={`fv-bar ${etapa.placeholder ? 'fv-bar-placeholder' : ''}`}
                        style={{ width: loading ? '6%' : `${pct}%`, '--c': etapa.color }}
                      >
                        <span className="fv-name">{etapa.label}</span>
                        <span className="fv-count">
                          {etapa.placeholder ? 'em breve' : (loading ? '—' : total)}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Modo normal: etapas detalhadas */}
        {!compareMode && (
          <div className="funil-col">
            {ETAPAS.map((etapa, idx) => {
              const total = totais[idx].total;
              const prevTotal = idx > 0 ? totais[idx - 1].total : null;
              const conversion =
                prevTotal !== null && prevTotal > 0 && total !== null
                  ? Math.round((total / prevTotal) * 100)
                  : null;
              const barPct =
                total !== null && !loading ? Math.round((total / maxTotal) * 100) : 0;

              return (
                <div key={etapa.id} className="etapa-wrapper">
                  {idx > 0 && (
                    <div className="conv-row">
                      <span className={`conv-pct ${conversion === null ? 'dim' : ''}`}>
                        {conversion !== null ? `${conversion}% conversão` : '—'}
                      </span>
                      <span className="conv-arrow">↓</span>
                    </div>
                  )}
                  <div className="etapa-card" style={{ '--c': etapa.color }}>
                    <div className="etapa-num">Etapa {etapa.num}</div>
                    <div className="etapa-label">{etapa.label}</div>
                    {etapa.placeholder ? (
                      <div className="etapa-placeholder">Em breve</div>
                    ) : (
                      <>
                        <div className="etapa-total">{loading ? '—' : total}</div>
                        <div className="bar-bg">
                          <div className="bar-fill" style={{ width: `${barPct}%`, background: etapa.color }} />
                        </div>
                        <div className="breakdown-row">
                          {etapa.counters.map(c => (
                            <div key={c.id} className="breakdown-item">
                              <span className="breakdown-name">{c.label}</span>
                              <span className="breakdown-val">
                                {loading ? '—' : (totaisObj?.[c.id] || 0)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Modo comparação: cards lado a lado por etapa */}
        {compareMode && (
          <div className="compare-section">
            {/* Cabeçalho dos períodos */}
            <div className="compare-header-row">
              <div className="compare-col-a">
                <span className="period-tag tag-a">A</span>
                <span className="period-label-text">
                  {data ? `${labelDia(data.inicio)}${data.inicio !== data.fim ? ` → ${labelDia(data.fim)}` : ''}` : '—'}
                </span>
              </div>
              <div className="compare-col-delta" />
              <div className="compare-col-b">
                <span className="period-tag tag-b">B</span>
                <span className="period-label-text">
                  {dataB ? `${labelDia(dataB.inicio)}${dataB.inicio !== dataB.fim ? ` → ${labelDia(dataB.fim)}` : ''}` : '—'}
                </span>
              </div>
            </div>

            {ETAPAS.filter(e => !e.placeholder).map((etapa, idx) => {
              const totalA = totais[idx].total;
              const totalB = totaisB[idx].total;
              const d = delta(totalA, totalB);

              // Conversão etapa anterior
              const prevIdxReal = ETAPAS.slice(0, idx).filter(e => !e.placeholder).length > 0
                ? idx - 1 : null;
              const prevA = prevIdxReal !== null ? totais[prevIdxReal].total : null;
              const prevB = prevIdxReal !== null ? totaisB[prevIdxReal].total : null;
              const convA = prevA !== null && prevA > 0 && totalA !== null ? Math.round((totalA / prevA) * 100) : null;
              const convB = prevB !== null && prevB > 0 && totalB !== null ? Math.round((totalB / prevB) * 100) : null;

              return (
                <div key={etapa.id} className="compare-etapa">
                  <div className="compare-etapa-title" style={{ '--c': etapa.color }}>
                    <span className="etapa-num-inline">Etapa {etapa.num}</span>
                    {etapa.label}
                  </div>

                  <div className="compare-card-row">
                    {/* Coluna A */}
                    <div className="compare-val-box box-a">
                      <div className="cval-main">{loading ? '—' : totalA}</div>
                      {convA !== null && <div className="cval-conv">{convA}% conv.</div>}
                      {etapa.counters.length > 1 && (
                        <div className="cval-breakdown">
                          {etapa.counters.map(c => (
                            <span key={c.id} className="cval-sub">
                              {c.label}: {loading ? '—' : (totaisObj?.[c.id] || 0)}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Delta */}
                    <div className="compare-delta-col">
                      {d ? (
                        <span className={`delta-badge ${d.up === true ? 'up' : d.up === false ? 'down' : 'neutral'}`}>
                          {d.label}
                        </span>
                      ) : <span className="delta-badge neutral">—</span>}
                    </div>

                    {/* Coluna B */}
                    <div className="compare-val-box box-b">
                      <div className="cval-main">{loadingB ? '—' : totalB}</div>
                      {convB !== null && <div className="cval-conv">{convB}% conv.</div>}
                      {etapa.counters.length > 1 && (
                        <div className="cval-breakdown">
                          {etapa.counters.map(c => (
                            <span key={c.id} className="cval-sub">
                              {c.label}: {loadingB ? '—' : (totaisObjB?.[c.id] || 0)}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <style jsx>{`
          .compare-toggle {
            padding: 8px 16px;
            border-radius: 8px;
            border: 1px solid var(--border-strong);
            background: transparent;
            color: var(--text-muted);
            font-size: 12px;
            font-family: 'DM Mono', monospace;
            cursor: pointer;
            transition: all 0.15s;
            white-space: nowrap;
          }
          .compare-toggle:hover { color: var(--text); border-color: var(--accent); }
          .compare-toggle.active {
            color: var(--accent);
            background: var(--accent-bg);
            border-color: var(--accent-border);
          }

          .compare-row {
            display: flex;
            align-items: flex-end;
            gap: 20px;
            flex-wrap: wrap;
            background: var(--card-bg);
            border: 1px solid var(--border);
            border-radius: 12px;
            padding: 16px 20px;
            margin-bottom: 24px;
            box-shadow: var(--shadow);
          }
          .compare-period {
            display: flex;
            align-items: flex-end;
            gap: 10px;
          }
          .period-tag {
            font-size: 10px;
            font-weight: 700;
            font-family: 'DM Mono', monospace;
            padding: 3px 8px;
            border-radius: 5px;
            margin-bottom: 1px;
            align-self: flex-end;
            padding-bottom: 10px;
          }
          .tag-a { background: rgba(29,158,117,0.15); color: #1D9E75; }
          .tag-b { background: rgba(150,150,150,0.15); color: var(--text-muted); }

          .tabs-row {
            display: flex;
            gap: 6px;
            margin-bottom: 16px;
            flex-wrap: wrap;
          }
          .funil-tab {
            padding: 7px 16px;
            border-radius: 8px;
            border: 1px solid var(--border-strong);
            background: transparent;
            color: var(--text-muted);
            font-size: 12px;
            font-family: 'DM Mono', monospace;
            cursor: pointer;
            transition: all 0.15s;
          }
          .funil-tab:hover { color: var(--text); border-color: var(--accent); }
          .funil-tab.active {
            color: var(--accent);
            background: var(--accent-bg);
            border-color: var(--accent-border);
          }

          .custom-row {
            display: flex;
            align-items: flex-end;
            gap: 12px;
            flex-wrap: wrap;
            background: var(--card-bg);
            border: 1px solid var(--border);
            border-radius: 12px;
            padding: 14px 16px;
            margin-bottom: 24px;
            box-shadow: var(--shadow);
          }
          .date-field { display: flex; flex-direction: column; gap: 4px; }
          .date-field label {
            font-size: 10px; color: var(--text-dim); font-family: 'DM Mono', monospace;
            text-transform: uppercase; letter-spacing: 0.08em;
          }
          .date-field input {
            background: var(--input-bg);
            border: 1px solid var(--border-strong);
            border-radius: 8px;
            color: var(--text);
            padding: 8px 12px;
            font-size: 13px;
            font-family: 'DM Mono', monospace;
            color-scheme: dark;
          }
          .date-field input:focus { outline: none; border-color: var(--accent); }
          .aplicar-btn {
            padding: 9px 22px;
            border-radius: 8px;
            border: none;
            background: var(--accent);
            color: #fff;
            font-size: 13px;
            font-weight: 700;
            cursor: pointer;
            transition: opacity 0.15s;
            align-self: flex-end;
          }
          .aplicar-btn:hover { opacity: 0.85; }
          .aplicar-btn:disabled { opacity: 0.5; cursor: not-allowed; }

          /* Funil normal */
          .funil-col {
            display: flex;
            flex-direction: column;
            gap: 0;
            max-width: 580px;
            margin-top: 12px;
          }
          .etapa-wrapper { display: flex; flex-direction: column; align-items: stretch; }
          .conv-row {
            display: flex; flex-direction: column; align-items: center; padding: 8px 0; gap: 2px;
          }
          .conv-pct { font-size: 11px; font-family: 'DM Mono', monospace; color: var(--text-muted); }
          .conv-pct.dim { color: var(--text-dim); }
          .conv-arrow { font-size: 18px; color: var(--text-dim); line-height: 1; }

          .etapa-card {
            background: var(--card-bg);
            border: 1px solid var(--border);
            border-left: 4px solid var(--c);
            border-radius: 12px;
            padding: 20px 22px;
            box-shadow: var(--shadow);
          }
          .etapa-num {
            font-size: 10px; font-family: 'DM Mono', monospace;
            color: var(--text-dim); text-transform: uppercase;
            letter-spacing: 0.1em; margin-bottom: 4px;
          }
          .etapa-label {
            font-size: 15px; font-weight: 600; color: var(--text);
            font-family: 'Syne', sans-serif; margin-bottom: 14px;
          }
          .etapa-placeholder { font-size: 13px; color: var(--text-dim); font-family: 'DM Mono', monospace; }
          .etapa-total {
            font-size: 42px; font-weight: 700; color: var(--c);
            line-height: 1; margin-bottom: 12px; font-family: 'Syne', sans-serif;
          }
          .bar-bg {
            height: 5px; background: var(--border-strong);
            border-radius: 3px; overflow: hidden; margin-bottom: 14px;
          }
          .bar-fill { height: 100%; border-radius: 3px; transition: width 0.5s ease; }
          .breakdown-row { display: flex; gap: 24px; flex-wrap: wrap; }
          .breakdown-item { display: flex; flex-direction: column; gap: 2px; }
          .breakdown-name {
            font-size: 10px; font-family: 'DM Mono', monospace;
            color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.08em;
          }
          .breakdown-val {
            font-size: 20px; font-weight: 600;
            color: var(--text-sub); font-family: 'DM Mono', monospace;
          }

          /* Funil visual */
          .fv-box { margin-bottom: 28px; }
          .fv-wrap { display: flex; flex-direction: column; gap: 0; padding: 4px 0; }
          .fv-stage { display: flex; flex-direction: column; align-items: center; }
          .fv-arrow { display: flex; flex-direction: column; align-items: center; padding: 6px 0; gap: 1px; }
          .fv-conv { font-size: 10px; font-family: 'DM Mono', monospace; color: var(--text-muted); }
          .fv-conv.dim { color: var(--text-dim); }
          .fv-chevron { font-size: 9px; color: var(--text-dim); }
          .fv-bar-wrap { width: 100%; display: flex; justify-content: center; }
          .fv-bar {
            display: flex; align-items: center; justify-content: space-between;
            gap: 12px; padding: 10px 16px; border-radius: 8px;
            border: 1px solid var(--c);
            background: color-mix(in srgb, var(--c) 12%, transparent);
            min-width: 120px; transition: width 0.6s ease; overflow: hidden;
          }
          .fv-bar-placeholder { border-style: dashed; opacity: 0.4; --c: var(--text-dim); }
          .fv-name {
            font-size: 12px; font-family: 'Syne', sans-serif; font-weight: 600;
            color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
          }
          .fv-count {
            font-size: 16px; font-weight: 700; color: var(--c);
            font-family: 'DM Mono', monospace; white-space: nowrap; flex-shrink: 0;
          }

          /* Comparação */
          .compare-section {
            display: flex;
            flex-direction: column;
            gap: 20px;
            margin-top: 4px;
          }
          .compare-header-row {
            display: grid;
            grid-template-columns: 1fr 80px 1fr;
            gap: 12px;
            padding: 0 4px;
          }
          .compare-col-a { display: flex; align-items: center; gap: 8px; }
          .compare-col-b { display: flex; align-items: center; gap: 8px; justify-content: flex-end; }
          .compare-col-delta {}
          .period-label-text {
            font-size: 11px;
            font-family: 'DM Mono', monospace;
            color: var(--text-muted);
          }

          .compare-etapa {
            background: var(--card-bg);
            border: 1px solid var(--border);
            border-radius: 12px;
            padding: 16px 20px;
            box-shadow: var(--shadow);
          }
          .compare-etapa-title {
            font-size: 14px;
            font-weight: 600;
            font-family: 'Syne', sans-serif;
            color: var(--text);
            border-left: 3px solid var(--c);
            padding-left: 10px;
            margin-bottom: 14px;
            display: flex;
            align-items: center;
            gap: 8px;
          }
          .etapa-num-inline {
            font-size: 9px;
            font-family: 'DM Mono', monospace;
            color: var(--text-dim);
            text-transform: uppercase;
            letter-spacing: 0.1em;
          }

          .compare-card-row {
            display: grid;
            grid-template-columns: 1fr 80px 1fr;
            gap: 12px;
            align-items: center;
          }
          .compare-val-box {
            background: var(--card-hover);
            border: 1px solid var(--border);
            border-radius: 10px;
            padding: 14px 16px;
          }
          .box-a { border-top: 2px solid #1D9E75; }
          .box-b { border-top: 2px solid var(--border-strong); }
          .cval-main {
            font-size: 32px;
            font-weight: 700;
            font-family: 'Syne', sans-serif;
            color: var(--text);
            line-height: 1;
            margin-bottom: 4px;
          }
          .cval-conv {
            font-size: 11px;
            font-family: 'DM Mono', monospace;
            color: var(--text-muted);
            margin-bottom: 8px;
          }
          .cval-breakdown {
            display: flex;
            flex-direction: column;
            gap: 2px;
            margin-top: 6px;
            padding-top: 6px;
            border-top: 1px solid var(--border);
          }
          .cval-sub {
            font-size: 11px;
            font-family: 'DM Mono', monospace;
            color: var(--text-muted);
          }
          .compare-delta-col {
            display: flex;
            justify-content: center;
            align-items: center;
          }
          .delta-badge {
            display: inline-block;
            padding: 5px 10px;
            border-radius: 6px;
            font-size: 12px;
            font-weight: 700;
            font-family: 'DM Mono', monospace;
            text-align: center;
          }
          .delta-badge.up { background: rgba(29,158,117,0.15); color: #1D9E75; }
          .delta-badge.down { background: rgba(226,75,74,0.15); color: #E24B4A; }
          .delta-badge.neutral { background: var(--border); color: var(--text-dim); }

          @media (max-width: 768px) {
            .funil-col { max-width: 100%; }
            .custom-row { flex-direction: column; align-items: stretch; }
            .compare-row { flex-direction: column; }
            .compare-period { flex-wrap: wrap; }
            .date-field input { width: 100%; }
            .aplicar-btn { width: 100%; padding: 11px; }
            .compare-card-row { grid-template-columns: 1fr 60px 1fr; gap: 8px; }
            .compare-header-row { grid-template-columns: 1fr 60px 1fr; gap: 8px; }
            .cval-main { font-size: 24px; }
          }
        `}</style>
      </Layout>
    </>
  );
}
