import axios from 'axios';
import type {
  DashboardStats,
  EmailSearchResponse,
  EmailSender,
  PaginatedEmailsResponse,
  RuntimeConfig,
  ScheduleEmailsPayload,
  ScheduleEmailsResult,
  SlackStatus,
  User,
} from '../types';

export const API_BASE_URL = import.meta.env.VITE_API_URL || '';

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export function extractApiErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as ApiEnvelope<unknown> | undefined;
    if (data?.error?.message) {
      return data.error.message;
    }
    return err.message || 'Network request failed';
  }
  if (err instanceof Error) return err.message;
  return 'An unexpected error occurred';
}

export const authApi = {
  getMe: async (): Promise<User> => {
    const res = await apiClient.get<ApiEnvelope<{ user: User }>>('/api/auth/me');
    return res.data.data.user;
  },
  logout: async (): Promise<void> => {
    await apiClient.post('/api/auth/logout');
  },
  getGoogleLoginUrl: (): string => `${API_BASE_URL}/api/auth/google`,
};

export const emailsApi = {
  getStats: async (): Promise<DashboardStats> => {
    const res = await apiClient.get<ApiEnvelope<DashboardStats>>('/api/emails/stats');
    return res.data.data;
  },
  getScheduled: async (params: {
    page: number;
    limit: number;
    status?: string;
    search?: string;
  }): Promise<PaginatedEmailsResponse> => {
    const res = await apiClient.get<ApiEnvelope<PaginatedEmailsResponse>>(
      '/api/emails/scheduled',
      { params },
    );
    return res.data.data;
  },
  getSent: async (params: {
    page: number;
    limit: number;
    status?: string;
    search?: string;
    from?: string;
    to?: string;
  }): Promise<PaginatedEmailsResponse> => {
    const res = await apiClient.get<ApiEnvelope<PaginatedEmailsResponse>>('/api/emails/sent', {
      params,
    });
    return res.data.data;
  },
  search: async (params: {
    q?: string;
    status?: string;
    from?: string;
    to?: string;
    page: number;
    limit: number;
  }): Promise<EmailSearchResponse> => {
    const res = await apiClient.get<ApiEnvelope<EmailSearchResponse>>('/api/emails/search', {
      params,
    });
    return res.data.data;
  },
  schedule: async (payload: ScheduleEmailsPayload): Promise<ScheduleEmailsResult> => {
    const res = await apiClient.post<ApiEnvelope<ScheduleEmailsResult>>(
      '/api/emails/schedule',
      payload,
      {
        headers: payload.idempotencyKey
          ? { 'Idempotency-Key': payload.idempotencyKey }
          : undefined,
      },
    );
    return res.data.data;
  },
  cancel: async (emailId: string): Promise<void> => {
    await apiClient.post(`/api/emails/${emailId}/cancel`);
  },
};

export const sendersApi = {
  list: async (): Promise<EmailSender[]> => {
    const res = await apiClient.get<ApiEnvelope<{ senders: EmailSender[] }>>('/api/senders');
    return res.data.data.senders;
  },
  create: async (payload: {
    email: string;
    smtpHost: string;
    smtpPort: number;
    smtpUsername: string;
    smtpPassword: string;
  }): Promise<EmailSender> => {
    const res = await apiClient.post<ApiEnvelope<{ sender: EmailSender }>>(
      '/api/senders',
      payload,
    );
    return res.data.data.sender;
  },
  provisionEthereal: async (): Promise<EmailSender> => {
    const res = await apiClient.post<ApiEnvelope<{ sender: EmailSender }>>(
      '/api/senders/ethereal',
    );
    return res.data.data.sender;
  },
  verify: async (id: string): Promise<{ verified: boolean }> => {
    const res = await apiClient.post<ApiEnvelope<{ verified: boolean }>>(
      `/api/senders/${id}/verify`,
    );
    return res.data.data;
  },
  update: async (id: string, payload: { isActive?: boolean }): Promise<EmailSender> => {
    const res = await apiClient.put<ApiEnvelope<{ sender: EmailSender }>>(
      `/api/senders/${id}`,
      payload,
    );
    return res.data.data.sender;
  },
  remove: async (id: string): Promise<void> => {
    await apiClient.delete(`/api/senders/${id}`);
  },
};

export const slackApi = {
  getStatus: async (): Promise<SlackStatus> => {
    const res = await apiClient.get<ApiEnvelope<SlackStatus>>('/api/slack/status');
    return res.data.data;
  },
  getConnectUrl: (): string => `${API_BASE_URL}/api/slack/connect`,
  disconnect: async (): Promise<void> => {
    await apiClient.post('/api/slack/disconnect');
  },
};

export const systemApi = {
  getRuntimeConfig: async (): Promise<RuntimeConfig> => {
    const res = await apiClient.get<ApiEnvelope<RuntimeConfig>>('/api/health/config');
    return res.data.data;
  },
};
