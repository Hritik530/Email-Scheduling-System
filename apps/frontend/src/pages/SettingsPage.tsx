import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  CheckCircle2,
  Cpu,
  Hash,
  Loader2,
  MailPlus,
  ShieldCheck,
  Sparkles,
  Trash2,
  Unplug,
} from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { useAuth } from '../contexts/AuthContext';
import {
  extractApiErrorMessage,
  sendersApi,
  slackApi,
  systemApi,
} from '../services/api';

const senderFormSchema = z.object({
  email: z.string().trim().email('Valid email required'),
  smtpHost: z.string().trim().min(1, 'SMTP host required'),
  smtpPort: z.coerce.number().int().min(1).max(65535),
  smtpUsername: z.string().trim().min(1, 'Username required'),
  smtpPassword: z.string().min(1, 'Password required'),
});

type SenderFormValues = z.infer<typeof senderFormSchema>;

export function SettingsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null,
  );

  const slackCallbackState = searchParams.get('slack');
  const slackCallbackMsg = searchParams.get('message');

  const { data: senders = [], isLoading: sendersLoading } = useQuery({
    queryKey: ['senders'],
    queryFn: sendersApi.list,
  });

  const { data: slackStatus, isLoading: slackLoading } = useQuery({
    queryKey: ['slack', 'status'],
    queryFn: slackApi.getStatus,
  });

  const { data: runtimeConfig } = useQuery({
    queryKey: ['system', 'config'],
    queryFn: systemApi.getRuntimeConfig,
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<SenderFormValues>({
    resolver: zodResolver(senderFormSchema),
    defaultValues: {
      email: '',
      smtpHost: 'smtp.ethereal.email',
      smtpPort: 587,
      smtpUsername: '',
      smtpPassword: '',
    },
  });

  const createSenderMutation = useMutation({
    mutationFn: sendersApi.create,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['senders'] });
      reset();
      setFeedback({ type: 'success', text: 'Email sender added and encrypted securely.' });
    },
    onError: (err) => setFeedback({ type: 'error', text: extractApiErrorMessage(err) }),
  });

  const etherealMutation = useMutation({
    mutationFn: sendersApi.provisionEthereal,
    onSuccess: (sender) => {
      void queryClient.invalidateQueries({ queryKey: ['senders'] });
      setFeedback({
        type: 'success',
        text: `Auto-provisioned Ethereal test sender: ${sender.email}`,
      });
    },
    onError: (err) => setFeedback({ type: 'error', text: extractApiErrorMessage(err) }),
  });

  const verifyMutation = useMutation({
    mutationFn: sendersApi.verify,
    onSuccess: () => {
      setFeedback({ type: 'success', text: 'SMTP connection verified successfully!' });
    },
    onError: (err) =>
      setFeedback({ type: 'error', text: `SMTP verification failed: ${extractApiErrorMessage(err)}` }),
  });

  const toggleSenderMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      sendersApi.update(id, { isActive }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['senders'] });
    },
  });

  const deleteSenderMutation = useMutation({
    mutationFn: sendersApi.remove,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['senders'] });
      setFeedback({ type: 'success', text: 'Sender removed or deactivated.' });
    },
    onError: (err) => setFeedback({ type: 'error', text: extractApiErrorMessage(err) }),
  });

  const disconnectSlackMutation = useMutation({
    mutationFn: slackApi.disconnect,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['slack', 'status'] });
      setFeedback({ type: 'success', text: 'Slack workspace disconnected.' });
    },
    onError: (err) => setFeedback({ type: 'error', text: extractApiErrorMessage(err) }),
  });

  return (
    <div className="space-y-6">
      {(feedback || slackCallbackState) && (
        <div
          className={`flex items-center gap-2 rounded-xl border px-4 py-3 text-xs font-medium ${
            feedback?.type === 'error' || slackCallbackState === 'error'
              ? 'border-rose-200 bg-rose-50 text-rose-700'
              : 'border-emerald-200 bg-emerald-50 text-emerald-700'
          }`}
        >
          {feedback?.type === 'error' || slackCallbackState === 'error' ? (
            <AlertCircle className="h-4 w-4 shrink-0" />
          ) : (
            <CheckCircle2 className="h-4 w-4 shrink-0" />
          )}
          <span>
            {feedback?.text ??
              (slackCallbackState === 'connected'
                ? 'Slack workspace connected! Rate-limit notifications are now active.'
                : slackCallbackMsg || 'Slack OAuth failed.')}
          </span>
        </div>
      )}

      {/* User Profile & Slack Integration */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-base font-semibold text-slate-900">User Profile</h2>
          <p className="text-xs text-slate-500">Authenticated via Google OAuth 2.0</p>

          <div className="mt-5 flex items-center gap-4">
            {user?.avatar ? (
              <img
                src={user.avatar}
                alt={user.name}
                className="h-14 w-14 rounded-full object-cover ring-2 ring-indigo-100"
              />
            ) : (
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-indigo-100 text-lg font-bold text-indigo-700">
                {user?.name?.charAt(0).toUpperCase() ?? 'U'}
              </div>
            )}
            <div>
              <p className="text-sm font-semibold text-slate-900">{user?.name}</p>
              <p className="text-xs text-slate-600">{user?.email}</p>
              <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                <ShieldCheck className="h-3 w-3" />
                Verified Google Session
              </span>
            </div>
          </div>
        </div>

        {/* Slack OAuth Card */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
                <Hash className="h-4 w-4 text-indigo-600" />
                Slack Rate-Limit Notifications
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Receive real-time alerts whenever a sender hits its hourly limit
              </p>
            </div>
            {slackStatus?.connected ? (
              <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700">
                Connected
              </span>
            ) : (
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold text-slate-600">
                Not Connected
              </span>
            )}
          </div>

          {slackLoading ? (
            <div className="mt-5 h-16 animate-pulse rounded-lg bg-slate-100" />
          ) : slackStatus?.connected && slackStatus.integration ? (
            <div className="mt-5 space-y-4">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 text-xs">
                <p className="font-semibold text-slate-900">
                  Workspace: {slackStatus.integration.teamName}
                </p>
                {slackStatus.integration.channelName && (
                  <p className="mt-0.5 text-slate-600">
                    Channel: {slackStatus.integration.channelName}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    window.location.href = slackApi.getConnectUrl();
                  }}
                  className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Reconnect Slack
                </button>
                <button
                  type="button"
                  onClick={() => disconnectSlackMutation.mutate()}
                  disabled={disconnectSlackMutation.isPending}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2 text-xs font-medium text-rose-700 hover:bg-rose-100"
                >
                  <Unplug className="h-3.5 w-3.5" />
                  Disconnect Slack
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-5 space-y-3">
              {!slackStatus?.configured && (
                <p className="text-xs text-amber-700">
                  Configure <code className="font-mono">SLACK_CLIENT_ID</code> and{' '}
                  <code className="font-mono">SLACK_CLIENT_SECRET</code> in{' '}
                  <code className="font-mono">.env</code> to enable Slack OAuth.
                </p>
              )}
              <button
                type="button"
                onClick={() => {
                  window.location.href = slackApi.getConnectUrl();
                }}
                className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-slate-800"
              >
                <Hash className="h-4 w-4" />
                Connect Slack
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Email Senders Configuration */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Email Senders (SMTP &amp; Ethereal)
            </h2>
            <p className="text-xs text-slate-500">
              SMTP passwords are encrypted with AES-256-GCM at rest and never returned to the browser.
            </p>
          </div>
          <button
            type="button"
            onClick={() => etherealMutation.mutate()}
            disabled={etherealMutation.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-50 px-3.5 py-2 text-xs font-semibold text-indigo-700 ring-1 ring-indigo-200 transition hover:bg-indigo-100 disabled:opacity-60"
          >
            {etherealMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            Auto-Generate Ethereal Sender
          </button>
        </div>

        {/* Existing Senders List */}
        <div className="mt-5">
          {sendersLoading ? (
            <div className="h-20 animate-pulse rounded-lg bg-slate-100" />
          ) : senders.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-200 p-4 text-center text-xs text-slate-500">
              No SMTP senders yet. Add one manually below or auto-generate an Ethereal account.
            </p>
          ) : (
            <div className="divide-y divide-slate-200 rounded-lg border border-slate-200">
              {senders.map((sender) => (
                <div
                  key={sender.id}
                  className="flex flex-col justify-between gap-3 p-4 sm:flex-row sm:items-center"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-slate-900">
                        {sender.email}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          sender.isActive
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {sender.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {sender.smtpHost}:{sender.smtpPort} • User: {sender.smtpUsername}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => verifyMutation.mutate(sender.id)}
                      disabled={verifyMutation.isPending}
                      className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Verify SMTP
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        toggleSenderMutation.mutate({
                          id: sender.id,
                          isActive: !sender.isActive,
                        })
                      }
                      className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      {sender.isActive ? 'Disable' : 'Enable'}
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteSenderMutation.mutate(sender.id)}
                      className="rounded-lg border border-rose-200 p-1.5 text-rose-600 hover:bg-rose-50"
                      title="Delete or deactivate sender"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Add Sender Form */}
        <form
          onSubmit={handleSubmit((vals) => createSenderMutation.mutate(vals))}
          className="mt-6 grid grid-cols-1 gap-3 border-t border-slate-200 pt-5 sm:grid-cols-5"
        >
          <div>
            <input
              type="email"
              placeholder="Sender email"
              {...register('email')}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-indigo-500 focus:outline-none"
            />
            {errors.email && <p className="mt-1 text-[11px] text-rose-600">{errors.email.message}</p>}
          </div>
          <div>
            <input
              type="text"
              placeholder="SMTP host"
              {...register('smtpHost')}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-indigo-500 focus:outline-none"
            />
            {errors.smtpHost && (
              <p className="mt-1 text-[11px] text-rose-600">{errors.smtpHost.message}</p>
            )}
          </div>
          <div>
            <input
              type="number"
              placeholder="Port (587)"
              {...register('smtpPort')}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-indigo-500 focus:outline-none"
            />
            {errors.smtpPort && (
              <p className="mt-1 text-[11px] text-rose-600">{errors.smtpPort.message}</p>
            )}
          </div>
          <div>
            <input
              type="text"
              placeholder="SMTP username"
              {...register('smtpUsername')}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-indigo-500 focus:outline-none"
            />
            {errors.smtpUsername && (
              <p className="mt-1 text-[11px] text-rose-600">{errors.smtpUsername.message}</p>
            )}
          </div>
          <div className="flex gap-2">
            <input
              type="password"
              placeholder="SMTP password"
              {...register('smtpPassword')}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-indigo-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={createSenderMutation.isPending}
              className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              <MailPlus className="h-3.5 w-3.5" />
              Add
            </button>
          </div>
        </form>
      </div>

      {/* Worker & Scheduler Runtime Configuration */}
      {runtimeConfig && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
            <Cpu className="h-4 w-4 text-indigo-600" />
            Worker &amp; Rate-Limiter Configuration
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Active environment-driven BullMQ &amp; Redis rate-limit parameters
          </p>

          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <ConfigStat label="Worker Concurrency" value={String(runtimeConfig.workerConcurrency)} />
            <ConfigStat label="Min Email Delay" value={`${runtimeConfig.minEmailDelayMs} ms`} />
            <ConfigStat
              label="Hourly Limit / Sender"
              value={`${runtimeConfig.maxEmailsPerHourPerSender}/hr`}
            />
            <ConfigStat label="Max Retries" value={String(runtimeConfig.maxRetryAttempts)} />
            <ConfigStat label="Retry Backoff" value={`${runtimeConfig.retryDelayMs} ms`} />
            <ConfigStat
              label="Default SMTP Host"
              value={`${runtimeConfig.etherealHost}:${runtimeConfig.etherealPort}`}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function ConfigStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="text-[11px] font-medium text-slate-500">{label}</p>
      <p className="mt-1 truncate text-xs font-semibold text-slate-900">{value}</p>
    </div>
  );
}
