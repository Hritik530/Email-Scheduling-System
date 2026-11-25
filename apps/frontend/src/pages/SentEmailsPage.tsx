import { useQuery } from '@tanstack/react-query';
import { ExternalLink, RefreshCw, Search } from 'lucide-react';
import { useState } from 'react';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { Pagination } from '../components/Pagination';
import { StatusBadge } from '../components/StatusBadge';
import { TableSkeleton } from '../components/TableSkeleton';
import { emailsApi, extractApiErrorMessage } from '../services/api';

const PAGE_SIZE = 15;

export function SentEmailsPage() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['emails', 'sent', page, status, search, fromDate, toDate],
    queryFn: () =>
      emailsApi.getSent({
        page,
        limit: PAGE_SIZE,
        status: status === 'all' ? undefined : status,
        search: search.trim() || undefined,
        from: fromDate ? new Date(`${fromDate}T00:00:00`).toISOString() : undefined,
        to: toDate ? new Date(`${toDate}T23:59:59`).toISOString() : undefined,
      }),
    refetchInterval: 10_000,
  });

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-200 p-4 lg:flex-row lg:items-center lg:justify-between sm:px-6">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Sent &amp; Failed Emails</h2>
          <p className="text-xs text-slate-500">
            Delivery receipts, SMTP message IDs, Ethereal preview links, and failure logs
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search recipient, subject, message ID..."
              className="w-52 rounded-lg border border-slate-300 bg-white py-1.5 pl-8 pr-3 text-xs text-slate-800 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none"
            />
          </div>

          <input
            type="date"
            value={fromDate}
            onChange={(e) => {
              setFromDate(e.target.value);
              setPage(1);
            }}
            aria-label="From date"
            className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-700"
          />

          <input
            type="date"
            value={toDate}
            onChange={(e) => {
              setToDate(e.target.value);
              setPage(1);
            }}
            aria-label="To date"
            className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-700"
          />

          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700"
          >
            <option value="all">Sent &amp; Failed</option>
            <option value="sent">Sent Only</option>
            <option value="failed">Failed Only</option>
          </select>

          <button
            type="button"
            onClick={() => void refetch()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {isLoading ? (
        <TableSkeleton rows={6} columns={6} />
      ) : isError ? (
        <div className="p-6">
          <ErrorState message={extractApiErrorMessage(error)} onRetry={() => void refetch()} />
        </div>
      ) : !data || data.items.length === 0 ? (
        <div className="p-6">
          <EmptyState
            title="No delivered or failed emails yet"
            description="Once the worker processes scheduled jobs through Ethereal SMTP, results appear here."
          />
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
              <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-6 py-3">Recipient</th>
                  <th className="px-6 py-3">Subject</th>
                  <th className="px-6 py-3">Sender</th>
                  <th className="px-6 py-3">Sent / Updated Time</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3">SMTP Message ID / Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {data.items.map((item) => (
                  <tr key={item.id} className="transition hover:bg-slate-50/80">
                    <td className="whitespace-nowrap px-6 py-3.5 font-medium text-slate-900">
                      {item.recipientEmail}
                    </td>
                    <td className="max-w-[200px] truncate px-6 py-3.5 text-slate-700">
                      {item.subject}
                    </td>
                    <td className="whitespace-nowrap px-6 py-3.5 text-slate-600">
                      {item.sender.email}
                    </td>
                    <td className="whitespace-nowrap px-6 py-3.5 text-slate-600">
                      {new Date(item.sentAt ?? item.updatedAt).toLocaleString()}
                    </td>
                    <td className="whitespace-nowrap px-6 py-3.5">
                      <StatusBadge status={item.status} />
                    </td>
                    <td className="px-6 py-3.5">
                      {item.status === 'sent' ? (
                        <div className="flex items-center gap-2">
                          <span className="max-w-[180px] truncate font-mono text-[11px] text-slate-600">
                            {item.smtpMessageId ?? '—'}
                          </span>
                          {item.etherealPreviewUrl && (
                            <a
                              href={item.etherealPreviewUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 rounded bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700 hover:bg-indigo-100"
                            >
                              Preview
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                        </div>
                      ) : (
                        <span className="text-[11px] text-rose-600" title={item.errorMessage ?? ''}>
                          {item.errorMessage ?? 'Delivery failed'}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={data.page}
            limit={data.limit}
            total={data.total}
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  );
}
