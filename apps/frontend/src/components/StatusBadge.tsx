import type { EmailStatus } from '../types';

const STATUS_STYLES: Record<EmailStatus, { bg: string; text: string; dot: string; label: string }> = {
  scheduled: {
    bg: 'bg-indigo-50 border-indigo-200',
    text: 'text-indigo-700',
    dot: 'bg-indigo-500',
    label: 'Scheduled',
  },
  processing: {
    bg: 'bg-amber-50 border-amber-200',
    text: 'text-amber-700',
    dot: 'bg-amber-500',
    label: 'Processing',
  },
  sent: {
    bg: 'bg-emerald-50 border-emerald-200',
    text: 'text-emerald-700',
    dot: 'bg-emerald-500',
    label: 'Sent',
  },
  failed: {
    bg: 'bg-rose-50 border-rose-200',
    text: 'text-rose-700',
    dot: 'bg-rose-500',
    label: 'Failed',
  },
  cancelled: {
    bg: 'bg-slate-100 border-slate-200',
    text: 'text-slate-600',
    dot: 'bg-slate-400',
    label: 'Cancelled',
  },
};

export function StatusBadge({ status }: { status: EmailStatus }) {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.scheduled;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${style.bg} ${style.text}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
      {style.label}
    </span>
  );
}
