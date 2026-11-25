export type EmailStatus = 'scheduled' | 'processing' | 'sent' | 'failed' | 'cancelled';

export interface User {
  id: string;
  email: string;
  name: string;
  avatar: string | null;
}

export interface EmailSender {
  id: string;
  userId: string;
  email: string;
  smtpHost: string;
  smtpPort: number;
  smtpUsername: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduledEmailItem {
  id: string;
  campaignId: string;
  userId: string;
  senderId: string;
  recipientEmail: string;
  subject: string;
  body: string;
  scheduledAt: string;
  sentAt: string | null;
  status: EmailStatus;
  attempts: number;
  errorMessage: string | null;
  smtpMessageId: string | null;
  etherealPreviewUrl: string | null;
  createdAt: string;
  updatedAt: string;
  sender: {
    id: string;
    email: string;
  };
}

export interface PaginatedEmailsResponse {
  items: ScheduledEmailItem[];
  total: number;
  page: number;
  limit: number;
}

export interface EmailSearchDocument {
  emailId: string;
  userId: string;
  campaignId: string;
  senderEmail: string;
  recipientEmail: string;
  subject: string;
  body: string;
  status: EmailStatus;
  scheduledAt: string;
  sentAt: string | null;
  createdAt: string;
}

export interface EmailSearchResponse {
  items: EmailSearchDocument[];
  total: number;
  page: number;
  limit: number;
  engine: 'elasticsearch' | 'postgres-fallback';
}

export interface DashboardStats {
  total: number;
  sent: number;
  failed: number;
  pending: number;
  cancelled: number;
  breakdown: Record<EmailStatus, number>;
}

export interface SlackStatus {
  configured: boolean;
  connected: boolean;
  integration: {
    id: string;
    teamId: string;
    teamName: string;
    channelId: string | null;
    channelName: string | null;
    isConnected: boolean;
    createdAt: string;
    updatedAt: string;
  } | null;
}

export interface RuntimeConfig {
  workerConcurrency: number;
  maxRetryAttempts: number;
  retryDelayMs: number;
  defaultEmailDelayMs: number;
  minEmailDelayMs: number;
  maxEmailsPerHourPerSender: number;
  etherealHost: string;
  etherealPort: number;
}

export interface ScheduleEmailsPayload {
  subject: string;
  body: string;
  recipients: string[];
  startTime: string;
  delayBetweenEmails: number;
  hourlyLimit: number;
  senderId: string;
  idempotencyKey?: string;
}

export interface ScheduleEmailsResult {
  campaignId: string;
  status: string;
  startTime: string;
  delayBetweenEmails: number;
  hourlyLimit: number;
  scheduledCount: number;
  duplicate: boolean;
}
