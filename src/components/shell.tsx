import type { ReactNode } from "react";
import { Bird, BookOpen, Github, Globe } from "lucide-react";
import logoUrl from "../assets/igloo-logo.png";

interface AppShellProps {
  children: ReactNode;
  brandSubtitle?: ReactNode;
  headerMeta?: ReactNode;
  headerActions?: ReactNode;
  headerSettingsAction?: ReactNode;
  mainVariant?: "center" | "flow" | "dashboard";
}

export function AppShell({ children, brandSubtitle, headerMeta, headerActions, headerSettingsAction, mainVariant = "center" }: AppShellProps) {
  const hasHeaderRight = Boolean(headerMeta || headerActions || headerSettingsAction);

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <img className="brand-logo" src={logoUrl} alt="" />
          <div className="brand-title-stack">
            <div className="brand-name">Igloo</div>
            {brandSubtitle ? <div className="brand-subtitle">{brandSubtitle}</div> : null}
          </div>
        </div>
        {hasHeaderRight ? (
          <div className="header-right">
            {headerMeta ? <div className="header-meta">{headerMeta}</div> : null}
            {headerActions ? <div className="header-actions">{headerActions}</div> : null}
            {headerSettingsAction ? (
              <>
                <div className="header-divider" />
                <div className="header-settings">{headerSettingsAction}</div>
              </>
            ) : null}
          </div>
        ) : null}
      </header>
      <main className={`app-main ${mainVariant}`}>{children}</main>
      <footer className="app-footer" aria-label="Igloo resources">
        <a href="https://frostr.org" target="_blank" rel="noopener noreferrer" title="frostr.org" aria-label="frostr.org" className="footer-link">
          <Globe size={16} />
        </a>
        <a href="https://frostr.org" target="_blank" rel="noopener noreferrer" title="Documentation" aria-label="Documentation" className="footer-link">
          <BookOpen size={16} />
        </a>
        <a href="https://github.com/frostr-org" target="_blank" rel="noopener noreferrer" title="GitHub" aria-label="GitHub" className="footer-link">
          <Github size={16} />
        </a>
        <a href="https://frostr.org" target="_blank" rel="noopener noreferrer" title="Bird" aria-label="FROSTR social" className="footer-link">
          <Bird size={16} />
        </a>
      </footer>
    </div>
  );
}

export function PageHeading({ title, copy }: { title: string; copy: string }) {
  return (
    <div className="screen-heading">
      <h1 className="page-title">{title}</h1>
      <p className="page-copy">{copy}</p>
    </div>
  );
}
