import Link from 'next/link';
import Head from 'next/head';
import { useTheme } from './ThemeContext';

export default function Layout({ activePage, sidebarExtra, children }) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="true" />
        <link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Syne:wght@400;500;700&display=swap" rel="stylesheet" />
      </Head>

      {/* Topbar mobile */}
      <div className="mobile-topbar">
        <div className="mobile-logo">
          <span className="logo-dot" /> OC ADV
        </div>
        <div className="mobile-right">
          <div className="mobile-tabs">
            <Link href="/" className={`mtab ${activePage === 'painel' ? 'active' : ''}`}>Painel</Link>
            <Link href="/relatorio" className={`mtab ${activePage === 'relatorio' ? 'active' : ''}`}>Relatório</Link>
            <Link href="/funil" className={`mtab ${activePage === 'funil' ? 'active' : ''}`}>Funil</Link>
          </div>
          <button className="theme-btn" onClick={toggleTheme} aria-label="Alternar tema">
            {isDark ? '☀' : '☾'}
          </button>
        </div>
      </div>

      <div className="layout-root">
        {/* Sidebar */}
        <aside className="sidebar">
          <div className="logo">
            <span className="logo-dot" />
            <span>OC ADV</span>
          </div>

          <nav className="sidebar-nav">
            <div className="nav-label">Páginas</div>
            <Link href="/" className={`nav-item page-link ${activePage === 'painel' ? 'active' : ''}`}>
              Painel diário
            </Link>
            <Link href="/relatorio" className={`nav-item page-link ${activePage === 'relatorio' ? 'active' : ''}`}>
              Relatório por período
            </Link>
            <Link href="/funil" className={`nav-item page-link ${activePage === 'funil' ? 'active' : ''}`}>
              Funil de conversão
            </Link>
          </nav>

          {sidebarExtra && (
            <div className="sidebar-extra">{sidebarExtra}</div>
          )}

          <div className="sidebar-footer">
            <button className="theme-toggle" onClick={toggleTheme}>
              <span>{isDark ? '☀' : '☾'}</span>
              {isDark ? 'Modo claro' : 'Modo escuro'}
            </button>
          </div>
        </aside>

        {/* Conteúdo principal */}
        <main className="layout-main">{children}</main>
      </div>
    </>
  );
}
