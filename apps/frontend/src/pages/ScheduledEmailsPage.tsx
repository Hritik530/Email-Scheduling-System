import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, RefreshCw, Search } from 'lucide-react';
import { useState } from 'react';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { Pagination } from '../components/Pagination';
import { StatusBadge } from '../components/StatusBadge';
import { TableSkeleton } from '../components/TableSkeleton';
import { emailsApi, extractApiErrorMessage } from '../services/api';

const PAGE_SIZE = 15;

export function ScheduledEmailsPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['emails', 'scheduled', page, status, search],
    queryFn: () =>
      emailsApi.getScheduled({
        page,
        limit: PAGE_SIZE,
        status: status === 'all' ? undefined : status,
        search: search.trim() || undefined,
      }),
    refetchInterval: 8000,
  });

  const cancelMutation = useMutation({
    mutationFn: emailsApi.cancel,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['emails'] });
    },
  });

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Scheduled Emails</h2>
          <p className="text-xs text-slate-500">
            Upcoming, in-flight, and cancelled jobs backed by PostgreSQL &amp; BullMQ
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Filter recipient, subject, campaign..."
              className="w-56 rounded-lg border border-slate-300 bg-white py-1.5 pl-8 pr-3 text-xs text-slate-800 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none"
            />
          </div>

          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 focus:border-indigo-500 focus:outline-none"
          >
            <option value="all">All Pending / Active</option>
            <option value="scheduled">Scheduled</option>
            <option value="processing">Processing</option>
            <option value="cancelled">Cancelled</option>
            <option value="failed">Failed</option>
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
            title="No scheduled emails found"
            description="Click 'Compose New Email' to upload recipients and schedule your next outbound campaign."
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
                  <th className="px-6 py-3">Scheduled Time</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3">Campaign ID</th>
                  <th className="px-6 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {data.items.map((item) => (
                  <tr key={item.id} className="transition hover:bg-slate-50/80">
                    <td className="whitespace-nowrap px-6 py-3.5 font-medium text-slate-900">
                      {item.recipientEmail}
                    </td>
                    <td className="max-w-[220px] truncate px-6 py-3.5 text-slate-700">
                      {item.subject}
                    </td>
                    <td className="whitespace-nowrap px-6 py-3.5 text-slate-600">
                      {item.sender.email}
                    </td>
                    <td className="whitespace-nowrap px-6 py-3.5 text-slate-600">
                      {new Date(item.scheduledAt).toLocaleString()}
                    </td>
                    <td className="whitespace-nowrap px-6 py-3.5">
                      <StatusBadge status={item.status} />
                    </td>
                    <td className="whitespace-nowrap px-6 py-3.5 font-mono text-[11px] text-slate-500">
                      {item.campaignId}
                    </td>
                    <td className="whitespace-nowrap px-6 py-3.5 text-right">
                      {item.status === 'scheduled' ? (
                        <button
                          type="button"
                          onClick={() => cancelMutation.mutate(item.id)}
                          disabled={cancelMutation.isPending}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 text-[11px] font-medium text-slate-600 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700"
                        >
                          <Ban className="h-3 w-3" />
                          Cancel
                        </button>
                      ) : (
                        <span className="text-slate-400">—</span>
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
