import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
  Send,
  Upload,
  X,
} from 'lucide-react';
import React, { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { emailsApi, extractApiErrorMessage, sendersApi } from '../services/api';
import { parseRecipientsContent, ParsedRecipientResult } from '../utils/csvParser';

const composeSchema = z.object({
  subject: z.string().trim().min(1, 'Subject is required').max(300),
  body: z.string().trim().min(1, 'Email body is required'),
  senderId: z.string().min(1, 'Please select a sender'),
  startTime: z.string().min(1, 'Start time is required'),
  delayBetweenEmails: z.coerce.number().int().min(0).max(3_600_000),
  hourlyLimit: z.coerce.number().int().min(1).max(100_000),
});

type ComposeFormValues = z.infer<typeof composeSchema>;

interface ComposeEmailModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (message: string) => void;
}

function defaultDateTimeLocal(): string {
  const date = new Date(Date.now() + 60_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function ComposeEmailModal({ isOpen, onClose, onSuccess }: ComposeEmailModalProps) {
  const queryClient = useQueryClient();
  const [uploadName, setUploadName] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [manualText, setManualText] = useState('');
  const [parsedResult, setParsedResult] = useState<ParsedRecipientResult | null>(null);
  const [showInvalid, setShowInvalid] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  const { data: senders = [], isLoading: sendersLoading } = useQuery({
    queryKey: ['senders'],
    queryFn: sendersApi.list,
    enabled: isOpen,
  });

  const activeSenders = useMemo(() => senders.filter((s) => s.isActive), [senders]);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ComposeFormValues>({
    resolver: zodResolver(composeSchema),
    defaultValues: {
      subject: '',
      body: '',
      senderId: '',
      startTime: defaultDateTimeLocal(),
      delayBetweenEmails: 2000,
      hourlyLimit: 100,
    },
  });

  const scheduleMutation = useMutation({
    mutationFn: emailsApi.schedule,
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['emails'] });
      void queryClient.invalidateQueries({ queryKey: ['emails', 'stats'] });
      onSuccess?.(
        data.duplicate
          ? `Campaign already scheduled (${data.scheduledCount} emails). Duplicate avoided.`
          : `Scheduled ${data.scheduledCount} email(s) under campaign ${data.campaignId}.`,
      );
      reset({
        subject: '',
        body: '',
        senderId: activeSenders[0]?.id ?? '',
        startTime: defaultDateTimeLocal(),
        delayBetweenEmails: 2000,
        hourlyLimit: 100,
      });
      setParsedResult(null);
      setUploadName(null);
      setManualText('');
      setSubmitError(null);
      setIdempotencyKey(crypto.randomUUID());
      onClose();
    },
    onError: (err) => {
      setSubmitError(extractApiErrorMessage(err));
    },
  });

  if (!isOpen) return null;

  const handleFileUpload = async (file: File) => {
    setUploadError(null);
    const lower = file.name.toLowerCase();
    if (!lower.endsWith('.csv') && !lower.endsWith('.txt')) {
      setUploadError('Unsupported file format. Please upload a .csv or .txt file.');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setUploadError('File exceeds 5MB limit.');
      return;
    }

    try {
      const text = await file.text();
      const parsed = parseRecipientsContent(text, file.name);
      if (parsed.totalDetected === 0) {
        setUploadError('No email entries were detected in the uploaded file.');
        setParsedResult(null);
        return;
      }
      setUploadName(file.name);
      setParsedResult(parsed);
      setManualText('');
    } catch {
      setUploadError('Failed to read the uploaded file.');
    }
  };

  const handleManualParse = (value: string) => {
    setManualText(value);
    setUploadName(null);
    setUploadError(null);
    if (!value.trim()) {
      setParsedResult(null);
      return;
    }
    setParsedResult(parseRecipientsContent(value, 'manual.txt'));
  };

  const onSubmit = (values: ComposeFormValues) => {
    setSubmitError(null);
    if (!parsedResult || parsedResult.validEmails.length === 0) {
      setSubmitError('Please upload a CSV/TXT or enter at least one valid recipient email.');
      return;
    }

    scheduleMutation.mutate({
      subject: values.subject,
      body: values.body,
      recipients: parsedResult.validEmails,
      startTime: new Date(values.startTime).toISOString(),
      delayBetweenEmails: values.delayBetweenEmails,
      hourlyLimit: values.hourlyLimit,
      senderId: values.senderId,
      idempotencyKey,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Compose Email Campaign</h2>
            <p className="text-xs text-slate-500">
              Schedule persistent BullMQ jobs with per-sender rate limits
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5 p-6">
          {submitError && (
            <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{submitError}</span>
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-600">
              Sender Account
            </label>
            {sendersLoading ? (
              <div className="h-10 animate-pulse rounded-lg bg-slate-100" />
            ) : activeSenders.length === 0 ? (
              <div className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800">
                <span>No active SMTP senders configured. Add one in Settings first.</span>
                <Link
                  to="/settings"
                  onClick={onClose}
                  className="font-semibold text-indigo-600 underline"
                >
                  Go to Settings
                </Link>
              </div>
            ) : (
              <select
                {...register('senderId')}
                defaultValue={activeSenders[0]?.id ?? ''}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              >
                <option value="">Select a sender...</option>
                {activeSenders.map((sender) => (
                  <option key={sender.id} value={sender.id}>
                    {sender.email} ({sender.smtpHost}:{sender.smtpPort})
                  </option>
                ))}
              </select>
            )}
            {errors.senderId && (
              <p className="mt-1 text-xs text-rose-600">{errors.senderId.message}</p>
            )}
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-600">
              Subject
            </label>
            <input
              type="text"
              placeholder="e.g. Welcome to ReachInbox!"
              {...register('subject')}
              className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            />
            {errors.subject && (
              <p className="mt-1 text-xs text-rose-600">{errors.subject.message}</p>
            )}
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-600">
              Email Body
            </label>
            <textarea
              rows={5}
              placeholder="Write your plain text or HTML email body..."
              {...register('body')}
              className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            />
            {errors.body && (
              <p className="mt-1 text-xs text-rose-600">{errors.body.message}</p>
            )}
          </div>

          {/* Recipients CSV / TXT Upload */}
          <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-700">
                Recipients (CSV / TXT Upload or Paste)
              </label>
              {uploadName && (
                <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-700">
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  {uploadName}
                </span>
              )}
            </div>

            <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-300 bg-white px-4 py-5 text-center transition hover:border-indigo-400 hover:bg-indigo-50/30">
              <Upload className="mb-2 h-6 w-6 text-indigo-500" />
              <span className="text-xs font-medium text-slate-700">
                Click to upload <code className="font-semibold">.csv</code> or{' '}
                <code className="font-semibold">.txt</code> file
              </span>
              <span className="mt-0.5 text-[11px] text-slate-500">
                Automatically deduplicates and validates email addresses
              </span>
              <input
                type="file"
                accept=".csv,.txt,text/csv,text/plain"
                className="hidden"
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  const file = e.target.files?.[0];
                  if (file) void handleFileUpload(file);
                }}
              />
            </label>

            <textarea
              rows={2}
              value={manualText}
              onChange={(e) => handleManualParse(e.target.value)}
              placeholder="Or paste recipient emails separated by commas or newlines..."
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none"
            />

            {uploadError && (
              <p className="text-xs font-medium text-rose-600">{uploadError}</p>
            )}

            {parsedResult && (
              <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3 text-xs">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div>
                    <span className="text-slate-500">Recipients detected:</span>{' '}
                    <span className="font-semibold text-slate-900">
                      {parsedResult.totalDetected}
                    </span>
                  </div>
                  <div className="text-emerald-700">
                    Valid emails:{' '}
                    <span className="font-semibold">{parsedResult.validEmails.length}</span>
                  </div>
                  <div className="text-rose-700">
                    Invalid entries:{' '}
                    <span className="font-semibold">{parsedResult.invalidEntries.length}</span>
                  </div>
                  <div className="text-amber-700">
                    Duplicates removed:{' '}
                    <span className="font-semibold">{parsedResult.duplicateCount}</span>
                  </div>
                </div>

                {parsedResult.validEmails.length > 0 && (
                  <div className="flex items-center gap-1.5 text-emerald-700">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">
                      Preview: {parsedResult.validEmails.slice(0, 4).join(', ')}
                      {parsedResult.validEmails.length > 4
                        ? ` (+${parsedResult.validEmails.length - 4} more)`
                        : ''}
                    </span>
                  </div>
                )}

                {parsedResult.invalidEntries.length > 0 && (
                  <div>
                    <button
                      type="button"
                      onClick={() => setShowInvalid((v) => !v)}
                      className="font-medium text-rose-600 underline"
                    >
                      {showInvalid ? 'Hide' : 'Inspect'} {parsedResult.invalidEntries.length}{' '}
                      invalid entry(ies)
                    </button>
                    {showInvalid && (
                      <div className="mt-1.5 max-h-24 overflow-y-auto rounded bg-rose-50 p-2 font-mono text-[11px] text-rose-800">
                        {parsedResult.invalidEntries.join(', ')}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                Start Date & Time
              </label>
              <input
                type="datetime-local"
                {...register('startTime')}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none"
              />
              {errors.startTime && (
                <p className="mt-1 text-xs text-rose-600">{errors.startTime.message}</p>
              )}
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                Delay Between Emails (ms)
              </label>
              <input
                type="number"
                min={0}
                step={500}
                {...register('delayBetweenEmails')}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none"
              />
              {errors.delayBetweenEmails && (
                <p className="mt-1 text-xs text-rose-600">
                  {errors.delayBetweenEmails.message}
                </p>
              )}
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                Hourly Limit / Sender
              </label>
              <input
                type="number"
                min={1}
                {...register('hourlyLimit')}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none"
              />
              {errors.hourlyLimit && (
                <p className="mt-1 text-xs text-rose-600">{errors.hourlyLimit.message}</p>
              )}
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-slate-200 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={scheduleMutation.isPending || activeSenders.length === 0}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {scheduleMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Scheduling...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" />
                  Schedule Campaign
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
