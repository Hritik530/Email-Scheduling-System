import { useQuery } from '@tanstack/react-query';
import { Database, Search as SearchIcon } from 'lucide-react';
import { useState } from 'react';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { Pagination } from '../components/Pagination';
import { StatusBadge } from '../components/StatusBadge';
import { TableSkeleton } from '../components/TableSkeleton';
import { emailsApi, extractApiErrorMessage } from '../services/api';

const PAGE_SIZE = 15;

export function SearchPage() {
  const [queryInput, setQueryInput] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['emails', 'search', submittedQuery, status, fromDate, toDate, page],
    queryFn: () =>
      emailsApi.search({
        q: submittedQuery || undefined,
        status: status === 'all' ? undefined : status,
        from: fromDate ? new Date(`${fromDate}T00:00:00`).toISOString() : undefined,
        to: toDate ? new Date(`${toDate}T23:59:59`).toISOString() : undefined,
        page,
        limit: PAGE_SIZE,
      }),
  });

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittedQuery(queryInput.trim());
    setPage(1);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Full-Text Email Search</h2>
            <p className="text-xs text-slate-500">
              Search across recipient email, subject, and body via Elasticsearch
            </p>
          </div>
          {data && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-medium text-slate-600">
              <Database className="h-3.5 w-3.5 text-indigo-600" />
              Engine: {data.engine === 'elasticsearch' ? 'Elasticsearch' : 'PostgreSQL Fallback'}
            </span>
          )}
        </div>

        <form onSubmit={handleSearchSubmit} className="grid grid-cols-1 gap-3 md:grid-cols-12">
          <div className="relative md:col-span-5">
            <SearchIcon className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={queryInput}
              onChange={(e) => setQueryInput(e.target.value)}
              placeholder="Search by recipient, subject, or body content..."
              className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none"
            />
          </div>

          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 md:col-span-2"
          >
            <option value="all">All Statuses</option>
            <option value="scheduled">Scheduled</option>
            <option value="processing">Processing</option>
            <option value="sent">Sent</option>
            <option value="failed">Failed</option>
            <option value="cancelled">Cancelled</option>
          </select>

          <input
            type="date"
            value={fromDate}
            onChange={(e) => {
              setFromDate(e.target.value);
              setPage(1);
            }}
            aria-label="From date"
            className="rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-700 md:col-span-2"
          />

          <input
            type="date"
            value={toDate}
            onChange={(e) => {
              setToDate(e.target.value);
              setPage(1);
            }}
            aria-label="To date"
            className="rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-700 md:col-span-2"
          />

          <button
            type="submit"
            className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-indigo-700 md:col-span-1"
          >
            Search
          </button>
        </form>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {isLoading ? (
          <TableSkeleton rows={5} columns={6} />
        ) : isError ? (
          <div className="p-6">
            <ErrorState message={extractApiErrorMessage(error)} onRetry={() => void refetch()} />
          </div>
        ) : !data || data.items.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="No matching emails"
              description="Try adjusting your search keywords, status filter, or date range."
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
                    <th className="px-6 py-3">Status</th>
                    <th className="px-6 py-3">Scheduled At</th>
                    <th className="px-6 py-3">Sent At</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {data.items.map((item) => (
                    <tr key={item.emailId} className="hover:bg-slate-50/80">
                      <td className="whitespace-nowrap px-6 py-3.5 font-medium text-slate-900">
                        {item.recipientEmail}
                      </td>
                      <td className="max-w-[260px] px-6 py-3.5">
                        <p className="truncate font-medium text-slate-800">{item.subject}</p>
                        <p className="truncate text-[11px] text-slate-500">{item.body}</p>
                      </td>
                      <td className="whitespace-nowrap px-6 py-3.5 text-slate-600">
                        {item.senderEmail}
                      </td>
                      <td className="whitespace-nowrap px-6 py-3.5">
                        <StatusBadge status={item.status} />
                      </td>
                      <td className="whitespace-nowrap px-6 py-3.5 text-slate-600">
                        {new Date(item.scheduledAt).toLocaleString()}
                      </td>
                      <td className="whitespace-nowrap px-6 py-3.5 text-slate-600">
                        {item.sentAt ? new Date(item.sentAt).toLocaleString() : '—'}
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
    </div>
  );
}
