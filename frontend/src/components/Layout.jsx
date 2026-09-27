// frontend/src/components/Layout.jsx
// Shared shell for authenticated pages: a role-aware sidebar (shadcn `sidebar`
// primitive) + a slim top header for page context, wrapping the page content.
// Wrapped around every protected route by the Protected guard in App.jsx.
import { NavLink, useLocation } from 'react-router-dom';
import { LogOut, Stethoscope, Radar, ActivitySquare, HeartHandshake, Building2 } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from './ui/sidebar';
import { Avatar, AvatarFallback } from './ui/avatar';
import { Button } from './ui/button';
import { Separator } from './ui/separator';

// Display-only labels, decoupled from the backend role slug (which stays
// e.g. 'nih_official' to match Module 2/6 RBAC) so the UI can use generic
// wording without a backend contract change.
const ROLE_LABELS = {
  doctor: 'Doctor',
  lab_tech: 'Lab technician',
  nih_official: 'Health official',
  ngo: 'NGO partner',
  admin: 'Administrator',
};

// Sidebar links, each gated by a permission check (or role) so a user only
// ever sees the sections their account can actually use.
const NAV_ITEMS = [
  { to: '/doctor', label: 'Doctor Portal', icon: Stethoscope, show: (can) => can('prediction:create') },
  { to: '/surveillance', label: 'Surveillance', icon: Radar, show: (can) => can('nih:dashboard') },
  { to: '/model-health', label: 'Model Health', icon: ActivitySquare, show: (can) => can('nih:dashboard') },
  { to: '/ngo', label: 'My NGO', icon: Building2, show: (can, role) => role === 'ngo' },
  { to: '/help', label: 'Help Portal', icon: HeartHandshake, show: () => true },
];

// Up to two-letter avatar fallback from a full name (or '?' if none).
function initials(name) {
  if (!name) return '?';
  return name.split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('');
}

// Sidebar + header shell; renders whichever protected page is passed as children.
export default function Layout({ children }) {
  const { user, can, logout } = useAuth();
  const location = useLocation();

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <div className="flex items-center gap-2 px-2 py-1.5">
            <div className="flex size-7 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground font-bold text-sm">
              F
            </div>
            <span className="text-sm font-semibold tracking-tight text-sidebar-foreground group-data-[collapsible=icon]:hidden">
              Fed<span className="text-sidebar-ring">Health</span>
            </span>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Workspace</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {NAV_ITEMS.filter((item) => item.show(can, user?.role)).map((item) => {
                  const active = location.pathname === item.to || location.pathname.startsWith(`${item.to}/`);
                  return (
                    <SidebarMenuItem key={item.to}>
                      <SidebarMenuButton render={<NavLink to={item.to} />} isActive={active} tooltip={item.label}>
                        <item.icon />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        {user && (
          <SidebarFooter>
            <div className="flex items-center gap-2 rounded-md px-2 py-1.5 group-data-[collapsible=icon]:justify-center">
              <Avatar size="sm">
                <AvatarFallback>{initials(user.fullName || user.email)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
                <p className="truncate text-xs font-medium text-sidebar-foreground">{user.fullName || user.email}</p>
                <p className="truncate text-[11px] text-sidebar-foreground/60">
                  {ROLE_LABELS[user.role] || (user.role || '').replace(/_/g, ' ')}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                className="shrink-0 text-sidebar-foreground/70 hover:text-sidebar-foreground group-data-[collapsible=icon]:hidden"
                onClick={logout}
                aria-label="Log out"
              >
                <LogOut />
              </Button>
            </div>
          </SidebarFooter>
        )}
      </Sidebar>
      <SidebarInset>
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
          <SidebarTrigger />
          <Separator orientation="vertical" className="h-4" />
          <span className="text-sm text-muted-foreground">FedHealth federated clinical intelligence</span>
          {import.meta.env.VITE_USE_MOCK === 'true' && (
            <span className="ml-auto rounded-md border border-warning/40 bg-warning/10 px-2 py-0.5 text-xs text-warning"
                  data-testid="mock-banner"
                  title="VITE_USE_MOCK=true: no backend. Model Health shows a snapshot of the real registry and runs; prediction scores are not from the model.">
              Demo mode — mock API
            </span>
          )}
        </header>
        <div className="flex-1 overflow-auto">
          <div className="mx-auto w-full max-w-[1180px] p-6">{children}</div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
