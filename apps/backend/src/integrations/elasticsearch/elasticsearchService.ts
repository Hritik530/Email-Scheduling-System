import { Client } from '@elastic/elasticsearch';
import { Prisma } from '@prisma/client';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { prisma } from '../../config/prisma';

export interface EmailSearchDocument {
  emailId: string;
  userId: string;
  campaignId: string;
  senderEmail: string;
  recipientEmail: string;
  subject: string;
  body: string;
  status: string;
  scheduledAt: string;
  sentAt: string | null;
  createdAt: string;
}

export interface EmailSearchQuery {
  userId: string;
  q?: string;
  status?: string;
  from?: string;
  to?: string;
  page: number;
  limit: number;
}

export interface EmailSearchResponse {
  items: EmailSearchDocument[];
  total: number;
  page: number;
  limit: number;
  engine: 'elasticsearch' | 'postgres-fallback';
}

let esClient: Client | null = null;
let indexReady = false;

export function getElasticsearchClient(): Client {
  if (!esClient) {
    esClient = new Client({
      node: env.ELASTICSEARCH_URL,
      requestTimeout: 5000,
      maxRetries: 2,
    });
  }
  return esClient;
}

export async function ensureEmailIndex(): Promise<boolean> {
  if (indexReady) return true;
  const client = getElasticsearchClient();

  try {
    const exists = await client.indices.exists({ index: env.ELASTICSEARCH_INDEX });
    if (!exists) {
      await client.indices.create({
        index: env.ELASTICSEARCH_INDEX,
        mappings: {
          properties: {
            emailId: { type: 'keyword' },
            userId: { type: 'keyword' },
            campaignId: { type: 'keyword' },
            senderEmail: {
              type: 'text',
              fields: { keyword: { type: 'keyword' } },
            },
            recipientEmail: {
              type: 'text',
              fields: { keyword: { type: 'keyword' } },
            },
            subject: { type: 'text' },
            body: { type: 'text' },
            status: { type: 'keyword' },
            scheduledAt: { type: 'date' },
            sentAt: { type: 'date' },
            createdAt: { type: 'date' },
          },
        },
      });
      logger.info({ index: env.ELASTICSEARCH_INDEX }, 'Created Elasticsearch email index');
    }
    indexReady = true;
    return true;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'Failed to ensure Elasticsearch index');
    return false;
  }
}

export async function indexEmailDocument(doc: EmailSearchDocument): Promise<void> {
  const ready = await ensureEmailIndex();
  if (!ready) {
    throw new Error('Elasticsearch index is unavailable');
  }

  const client = getElasticsearchClient();
  await client.index({
    index: env.ELASTICSEARCH_INDEX,
    id: doc.emailId,
    document: doc,
    refresh: env.NODE_ENV === 'test' ? 'wait_for' : false,
  });
}

export async function searchEmails(query: EmailSearchQuery): Promise<EmailSearchResponse> {
  const fromOffset = (query.page - 1) * query.limit;

  try {
    const ready = await ensureEmailIndex();
    if (!ready) {
      throw new Error('Elasticsearch unavailable');
    }

    const client = getElasticsearchClient();
    const filter: Record<string, unknown>[] = [{ term: { userId: query.userId } }];

    if (query.status && query.status !== 'all') {
      filter.push({ term: { status: query.status } });
    }

    if (query.from || query.to) {
      const range: Record<string, string> = {};
      if (query.from) range.gte = query.from;
      if (query.to) range.lte = query.to;
      filter.push({ range: { scheduledAt: range } });
    }

    const must: Record<string, unknown>[] = [];
    if (query.q && query.q.trim().length > 0) {
      const term = query.q.trim();
      must.push({
        bool: {
          should: [
            {
              multi_match: {
                query: term,
                fields: ['recipientEmail^3', 'subject^2', 'body', 'senderEmail'],
                fuzziness: 'AUTO',
              },
            },
            {
              wildcard: {
                'recipientEmail.keyword': {
                  value: `*${term.toLowerCase()}*`,
                  case_insensitive: true,
                },
              },
            },
          ],
          minimum_should_match: 1,
        },
      });
    }

    const result = await client.search<EmailSearchDocument>({
      index: env.ELASTICSEARCH_INDEX,
      from: fromOffset,
      size: query.limit,
      query: {
        bool: {
          filter,
          ...(must.length > 0 ? { must } : {}),
        },
      },
      sort: [{ createdAt: { order: 'desc' } }],
    });

    const totalRaw = result.hits.total;
    const total = typeof totalRaw === 'number' ? totalRaw : (totalRaw?.value ?? 0);
    const items = result.hits.hits
      .map((hit) => hit._source)
      .filter((src): src is EmailSearchDocument => Boolean(src));

    return {
      items,
      total,
      page: query.page,
      limit: query.limit,
      engine: 'elasticsearch',
    };
  } catch (err) {
    logger.warn(
      { err: (err as Error).message, userId: query.userId },
      'Elasticsearch search failed, falling back to PostgreSQL',
    );
    return searchEmailsPostgresFallback(query);
  }
}

async function searchEmailsPostgresFallback(
  query: EmailSearchQuery,
): Promise<EmailSearchResponse> {
  const where: Prisma.ScheduledEmailWhereInput = {
    userId: query.userId,
  };

  if (query.status && query.status !== 'all') {
    where.status = query.status as Prisma.EnumEmailStatusFilter;
  }

  if (query.from || query.to) {
    where.scheduledAt = {
      ...(query.from ? { gte: new Date(query.from) } : {}),
      ...(query.to ? { lte: new Date(query.to) } : {}),
    };
  }

  if (query.q && query.q.trim()) {
    const term = query.q.trim();
    where.OR = [
      { recipientEmail: { contains: term, mode: 'insensitive' } },
      { subject: { contains: term, mode: 'insensitive' } },
      { body: { contains: term, mode: 'insensitive' } },
      { sender: { email: { contains: term, mode: 'insensitive' } } },
    ];
  }

  const [total, rows] = await Promise.all([
    prisma.scheduledEmail.count({ where }),
    prisma.scheduledEmail.findMany({
      where,
      include: { sender: { select: { email: true } } },
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
  ]);

  return {
    items: rows.map((row) => ({
      emailId: row.id,
      userId: row.userId,
      campaignId: row.campaignId,
      senderEmail: row.sender.email,
      recipientEmail: row.recipientEmail,
      subject: row.subject,
      body: row.body,
      status: row.status,
      scheduledAt: row.scheduledAt.toISOString(),
      sentAt: row.sentAt ? row.sentAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    })),
    total,
    page: query.page,
    limit: query.limit,
    engine: 'postgres-fallback',
  };
}

export async function pingElasticsearch(): Promise<boolean> {
  try {
    const client = getElasticsearchClient();
    return await client.ping();
  } catch {
    return false;
  }
}
