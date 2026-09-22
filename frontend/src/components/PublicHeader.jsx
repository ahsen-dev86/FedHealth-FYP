// frontend/src/components/PublicHeader.jsx
// Lightweight header for pages reachable without a session (Help Portal
// directory + NGO profiles). Mirrors the app's brand mark without the
// authenticated sidebar shell.
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Button } from './ui/button';

export default function PublicHeader() {
  const { isAuthed } = useAuth();
  return (
    <header className="border-b border-border bg-card">
      <div className="mx-auto flex h-14 max-w-[1180px] items-center gap-4 px-6">
        <Link to="/" className="text-base font-bold tracking-tight text-foreground">
          Fed<span className="text-primary">Health</span>
        </Link>
        <span className="text-sm text-muted-foreground">Help Portal</span>
        <div className="flex-1" />
        <Button variant="outline" size="sm" nativeButton={false} render={<Link to={isAuthed ? '/' : '/login'} />}>
          {isAuthed ? 'Back to app' : 'Log in'}
        </Button>
      </div>
    </header>
  );
}
