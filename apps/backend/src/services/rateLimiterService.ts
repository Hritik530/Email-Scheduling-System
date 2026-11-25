import crypto from 'crypto';
import Redis from 'ioredis';
import { getSharedRedisClient } from '../config/redis';

export type SlotReservationResult =
  | {
      status: 'ALLOWED';
      sentCountInWindow: number;
      hourBucket: number;
      grantedAtMs: number;
    }
  | {
      status: 'MIN_DELAY';
      retryAtMs: number;
      sentCountInWindow: number;
      hourBucket: number;
    }
  | {
      status: 'HOURLY_LIMIT_REACHED';
      retryAtMs: number;
      sentCountInWindow: number;
      hourBucket: number;
    };

/**
 * Atomic Redis Lua script combining:
 * 1) Per-sender hourly window capacity check and reservation
 * 2) Per-sender minimum inter-email delay enforcement across all workers
 * 3) Staggered future-hour slot assignment when hourly limit is exhausted
 */
const RESERVE_SLOT_LUA = `
local nextSlotKey = KEYS[1]
local delayCursorKey = KEYS[2]

local nowMs = tonumber(ARGV[1])
local minDelayMs = tonumber(ARGV[2])
local hourlyLimit = tonumber(ARGV[3])
local senderId = ARGV[4]

local hourBucket = math.floor(nowMs / 3600000)
local hourKey = "rl:sender:" .. senderId .. ":hour:" .. tostring(hourBucket)
local currentCount = tonumber(redis.call("GET", hourKey) or "0")

if currentCount >= hourlyLimit then
  local h = hourBucket + 1
  local maxHour = hourBucket + 168
  local targetMs = (h * 3600000)
  local stepMs = math.max(minDelayMs, 50)

  while h <= maxHour do
    local futureActualKey = "rl:sender:" .. senderId .. ":hour:" .. tostring(h)
    local futureReservedKey = "rl:sender:" .. senderId .. ":reserved:" .. tostring(h)
    local futureActual = tonumber(redis.call("GET", futureActualKey) or "0")
    local futureReserved = tonumber(redis.call("GET", futureReservedKey) or "0")

    if (futureActual + futureReserved) < hourlyLimit then
      local slotIdx = redis.call("INCR", futureReservedKey) - 1
      redis.call("EXPIRE", futureReservedKey, 604800)
      targetMs = (h * 3600000) + (slotIdx * stepMs)
      break
    end
    h = h + 1
  end

  return { "HOURLY_LIMIT_REACHED", tostring(targetMs), tostring(currentCount), tostring(hourBucket) }
end

local nextSlot = tonumber(redis.call("GET", nextSlotKey) or "0")
if nowMs < nextSlot then
  local cursor = tonumber(redis.call("GET", delayCursorKey) or "0")
  local candidate = math.max(nextSlot, cursor)
  if candidate <= nowMs then
    candidate = nextSlot
  end
  local stepMs = math.max(minDelayMs, 50)
  local nextCursor = candidate + stepMs
  local cursorTtl = math.max(minDelayMs * 20, 60000)
  redis.call("SET", delayCursorKey, tostring(nextCursor), "PX", cursorTtl)
  return { "MIN_DELAY", tostring(candidate), tostring(currentCount), tostring(hourBucket) }
end

local newCount = redis.call("INCR", hourKey)
if newCount == 1 then
  redis.call("EXPIRE", hourKey, 7200)
end

if minDelayMs > 0 then
  local slotTtl = math.max(minDelayMs * 20, 60000)
  redis.call("SET", nextSlotKey, tostring(nowMs + minDelayMs), "PX", slotTtl)
end

return { "ALLOWED", tostring(nowMs), tostring(newCount), tostring(hourBucket) }
`;

const RELEASE_HOUR_SLOT_LUA = `
local current = tonumber(redis.call("GET", KEYS[1]) or "0")
if current > 0 then
  return redis.call("DECR", KEYS[1])
end
return 0
`;

const RELEASE_LOCK_LUA = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

export async function reserveSendSlot(
  senderId: string,
  minDelayMs: number,
  hourlyLimit: number,
  nowMs = Date.now(),
  redisClient: Redis = getSharedRedisClient(),
): Promise<SlotReservationResult> {
  const nextSlotKey = `rl:sender:${senderId}:next_slot`;
  const delayCursorKey = `rl:sender:${senderId}:delay_cursor`;

  const result = (await redisClient.eval(
    RESERVE_SLOT_LUA,
    2,
    nextSlotKey,
    delayCursorKey,
    String(nowMs),
    String(Math.max(0, minDelayMs)),
    String(Math.max(1, hourlyLimit)),
    senderId,
  )) as [string, string, string, string];

  const [status, val1, val2, val3] = result;

  if (status === 'ALLOWED') {
    return {
      status: 'ALLOWED',
      grantedAtMs: Number(val1),
      sentCountInWindow: Number(val2),
      hourBucket: Number(val3),
    };
  }

  if (status === 'MIN_DELAY') {
    return {
      status: 'MIN_DELAY',
      retryAtMs: Number(val1),
      sentCountInWindow: Number(val2),
      hourBucket: Number(val3),
    };
  }

  return {
    status: 'HOURLY_LIMIT_REACHED',
    retryAtMs: Number(val1),
    sentCountInWindow: Number(val2),
    hourBucket: Number(val3),
  };
}

/**
 * Releases a previously reserved hourly slot if SMTP sending fails,
 * ensuring failed SMTP attempts are not counted against the hourly limit.
 */
export async function releaseHourlySlot(
  senderId: string,
  hourBucket: number,
  redisClient: Redis = getSharedRedisClient(),
): Promise<number> {
  const hourKey = `rl:sender:${senderId}:hour:${hourBucket}`;
  const remaining = await redisClient.eval(RELEASE_HOUR_SLOT_LUA, 1, hourKey);
  return Number(remaining);
}

export async function acquireEmailLock(
  emailId: string,
  ttlMs = 60000,
  redisClient: Redis = getSharedRedisClient(),
): Promise<string | null> {
  const lockKey = `lock:email:${emailId}`;
  const token = crypto.randomUUID();
  const res = await redisClient.set(lockKey, token, 'PX', ttlMs, 'NX');
  return res === 'OK' ? token : null;
}

export async function releaseEmailLock(
  emailId: string,
  token: string,
  redisClient: Redis = getSharedRedisClient(),
): Promise<void> {
  const lockKey = `lock:email:${emailId}`;
  await redisClient.eval(RELEASE_LOCK_LUA, 1, lockKey, token);
}
