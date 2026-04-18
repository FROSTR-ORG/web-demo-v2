import type { ReactNode } from "react";
import { BookOpen, Github, Globe } from "lucide-react";
import logoUrl from "../assets/igloo-logo.png";

interface AppShellProps {
  children: ReactNode;
  headerMeta?: ReactNode;
  headerActions?: ReactNode;
  headerSettingsAction?: ReactNode;
  mainVariant?: "center" | "flow" | "dashboard";
}

export function AppShell({ children, headerMeta, headerActions, headerSettingsAction, mainVariant = "center" }: AppShellProps) {
  const hasHeaderRight = Boolean(headerMeta || headerActions || headerSettingsAction);

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <img className="brand-logo" src={logoUrl} alt="" />
          <div className="brand-name">Igloo</div>
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
        <Globe size={16} />
        <BookOpen size={16} />
        <Github size={16} />
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
