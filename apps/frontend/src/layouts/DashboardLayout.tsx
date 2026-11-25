import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Clock,
  LogOut,
  Mail,
  Menu,
  Plus,
  Search,
  Send,
  Settings,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { ComposeEmailModal } from '../components/ComposeEmailModal';
import { useAuth } from '../contexts/AuthContext';
import { API_BASE_URL, emailsApi } from '../services/api';

const NAV_ITEMS = [
  { to: '/scheduled', label: 'Scheduled Emails', icon: Clock },
  { to: '/sent', label: 'Sent Emails', icon: Send },
  { to: '/search', label: 'Search', icon: Search },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export function DashboardLayout() {
  const { user, logout, isLoggingOut } = useAuth();
  const [composeOpen, setComposeOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['emails', 'stats'],
    queryFn: emailsApi.getStats,
    refetchInterval: 10_000,
  });

  const bullBoardUrl = `${API_BASE_URL || ''}/admin/queues`;

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Mobile Sidebar Backdrop */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/40 lg:hidden"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-slate-200 bg-white transition-transform lg:translate-x-0 ${
          mobileNavOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-16 items-center justify-between border-b border-slate-200 px-5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm">
              <Mail className="h-5 w-5" />
            </div>
            <div>
              <span className="block text-sm font-bold tracking-tight text-slate-900">
                ReachInbox
              </span>
              <span className="block text-[11px] font-medium text-slate-500">
                Email Job Scheduler
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setMobileNavOpen(false)}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-4">
          <button
            type="button"
            onClick={() => {
              setComposeOpen(true);
              setMobileNavOpen(false);
            }}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700"
          >
            <Plus className="h-4 w-4" />
            Compose New Email
          </button>
        </div>

        <nav className="flex-1 space-y-1 px-3">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              onClick={() => setMobileNavOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                  isActive
                    ? 'bg-indigo-50 text-indigo-700'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}

          <div className="pt-4">
            <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Operations
            </p>
            <a
              href={bullBoardUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
            >
              <Activity className="h-4 w-4" />
              Bull Board Queues
            </a>
          </div>
        </nav>

        <div className="border-t border-slate-200 p-4">
          <div className="flex items-center gap-3">
            {user?.avatar ? (
              <img
                src={user.avatar}
                alt={user.name}
                className="h-9 w-9 rounded-full object-cover ring-1 ring-slate-200"
              />
            ) : (
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-700">
                {user?.name?.charAt(0).toUpperCase() ?? 'U'}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-slate-900">{user?.name}</p>
              <p className="truncate text-[11px] text-slate-500">{user?.email}</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-slate-200 bg-white/90 px-4 backdrop-blur sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>
            <h1 className="text-sm font-semibold text-slate-800 sm:text-base">
              Outbound Campaign Control Center
            </h1>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setComposeOpen(true)}
              className="hidden items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-700 sm:inline-flex"
            >
              <Plus className="h-3.5 w-3.5" />
              Compose New Email
            </button>

            <button
              type="button"
              onClick={() => void logout()}
              disabled={isLoggingOut}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span>{isLoggingOut ? 'Signing out...' : 'Logout'}</span>
            </button>
          </div>
        </header>

        <main className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
          {bannerMessage && (
            <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                <span>{bannerMessage}</span>
              </div>
              <button
                type="button"
                onClick={() => setBannerMessage(null)}
                className="text-emerald-600 hover:text-emerald-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* Summary Cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryCard
              title="Total Scheduled Emails"
              value={stats?.total ?? 0}
              loading={statsLoading}
              icon={<Mail className="h-5 w-5 text-indigo-600" />}
              accent="bg-indigo-50"
            />
            <SummaryCard
              title="Successfully Sent"
              value={stats?.sent ?? 0}
              loading={statsLoading}
              icon={<CheckCircle2 className="h-5 w-5 text-emerald-600" />}
              accent="bg-emerald-50"
            />
            <SummaryCard
              title="Failed Emails"
              value={stats?.failed ?? 0}
              loading={statsLoading}
              icon={<AlertCircle className="h-5 w-5 text-rose-600" />}
              accent="bg-rose-50"
            />
            <SummaryCard
              title="Pending Emails"
              value={stats?.pending ?? 0}
              loading={statsLoading}
              icon={<Clock className="h-5 w-5 text-amber-600" />}
              accent="bg-amber-50"
            />
          </div>

          <Outlet />
        </main>
      </div>

      <ComposeEmailModal
        isOpen={composeOpen}
        onClose={() => setComposeOpen(false)}
        onSuccess={(msg) => setBannerMessage(msg)}
      />
    </div>
  );
}

function SummaryCard({
  title,
  value,
  loading,
  icon,
  accent,
}: {
  title: string;
  value: number;
  loading: boolean;
  icon: React.ReactNode;
  accent: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-slate-500">{title}</p>
        <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${accent}`}>
          {icon}
        </div>
      </div>
      {loading ? (
        <div className="mt-3 h-7 w-16 animate-pulse rounded bg-slate-200" />
      ) : (
        <p className="mt-2 text-2xl font-bold tracking-tight text-slate-900">
          {value.toLocaleString()}
        </p>
      )}
    </div>
  );
}
