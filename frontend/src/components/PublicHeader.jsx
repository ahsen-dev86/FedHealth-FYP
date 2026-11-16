// frontend/src/components/PublicHeader.jsx
// Lightweight header for pages reachable without a session (Help Portal
// directory + NGO profiles). Mirrors the app's brand mark without the
// authenticated sidebar shell.
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { Button } from './ui/button';

export default function PublicHeader() {
  const { isAuthed } = useAuth();
  return (
    <header className="border-b border-border bg-card">
      <div className="mx-auto flex h-14 max-w-[1180px] items-center gap-3 px-4 sm:gap-4 sm:px-6">
        <Link to="/" className="text-base font-bold tracking-tight text-foreground" aria-label="FedHealth home">
          Fed<span className="text-primary">Health</span>
        </Link>
        <span className="hidden text-sm text-muted-foreground sm:inline">Help Portal</span>
        <div className="flex-1" />
        {/* Visitors arrive here from the landing page; give them an obvious way back. */}
        <Button variant="ghost" size="sm" nativeButton={false} render={<Link to="/" data-testid="help-home" />}>
          <ArrowLeft /> Home
        </Button>
        <Button variant="outline" size="sm" nativeButton={false} render={<Link to={isAuthed ? '/app' : '/login'} />}>
          {isAuthed ? 'Back to app' : 'Log in'}
        </Button>
      </div>
    </header>
  );
}
