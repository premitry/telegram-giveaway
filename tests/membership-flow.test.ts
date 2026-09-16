import assert from 'node:assert/strict';
import test from 'node:test';
import type { Env, GiveawayRow, ParticipantRow, UserRow } from '../src/types';
import type { TelegramUser } from '../src/telegram/types';
import { joinGiveaway } from '../src/services/participant';
import { drawGiveaway } from '../src/services/draw';

type QueryResult = { results?: unknown[]; meta?: { changes?: number } };

class FakeStatement {
  private params: unknown[] = [];

  constructor(
    private readonly db: FakeDb,
    private readonly sql: string,
  ) {}

  bind(...params: unknown[]): this {
    this.params = params;
    return this;
  }

  async run(): Promise<QueryResult> {
    return this.db.run(this.sql, this.params);
  }

  async first<T>(): Promise<T | null> {
    return this.db.first(this.sql, this.params) as T | null;
  }

  async all<T>(): Promise<{ results: T[] }> {
    return { results: this.db.all(this.sql, this.params) as T[] };
  }
}

class FakeDb {
  readonly insertedWinners: Array<{ userId: number; position: number }> = [];
  participantInsertAttempts = 0;

  constructor(
    readonly user: UserRow,
    readonly participants: ParticipantRow[],
    readonly drawPool: Array<{ userId: number; telegramId: string; entries: number }> = [],
  ) {}

  prepare(sql: string): FakeStatement {
    return new FakeStatement(this, sql.replace(/\s+/g, ' ').trim());
  }

  run(sql: string, params: unknown[]): QueryResult {
    if (sql.startsWith('INSERT INTO users')) return { meta: { changes: 1 } };
    if (sql.startsWith('INSERT OR IGNORE INTO participants')) {
      this.participantInsertAttempts++;
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith('DELETE FROM winners')) {
      this.insertedWinners.length = 0;
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith('INSERT INTO winners')) {
      this.insertedWinners.push({ userId: Number(params[1]), position: Number(params[2]) });
      return { meta: { changes: 1 } };
    }
    throw new Error(`Unexpected run query: ${sql}`);
  }

  first(sql: string, params: unknown[]): unknown {
    if (sql.startsWith('SELECT * FROM users WHERE telegram_id')) return this.user;
    if (sql.startsWith('SELECT * FROM participants WHERE giveaway_id')) {
      return this.participants.find((p) => p.giveaway_id === Number(params[0]) && p.user_id === Number(params[1])) ?? null;
    }
    throw new Error(`Unexpected first query: ${sql}`);
  }

  all(sql: string, _params: unknown[]): unknown[] {
    if (sql.includes('FROM participants p JOIN users u')) return this.drawPool;
    if (sql.startsWith('SELECT user_id AS uid, COUNT(*) AS c FROM winners')) return [];
    throw new Error(`Unexpected all query: ${sql}`);
  }
}

const giveaway: GiveawayRow = {
  id: 7,
  title: 'Membership test',
  description: null,
  prize: 'Hadiah',
  winners_count: 1,
  required_channel: '@syarat',
  required_channel_id: '-100123',
  deadline: '2099-01-01T00:00:00.000Z',
  max_referral_bonus: 0,
  image_file_id: null,
  publish_chat_id: null,
  publish_message_id: null,
  status: 'active',
  auto_draw: 0,
  created_at: '2026-01-01T00:00:00.000Z',
  prizes_json: null,
};

const telegramUser: TelegramUser = {
  id: 111,
  is_bot: false,
  first_name: 'Tester',
  username: 'tester',
};

const user: UserRow = {
  id: 1,
  telegram_id: '111',
  username: 'tester',
  first_name: 'Tester',
  created_at: '2026-01-01T00:00:00.000Z',
};

const participant: ParticipantRow = {
  id: 1,
  giveaway_id: giveaway.id,
  user_id: user.id,
  base_entries: 1,
  referral_entries: 0,
  joined_at: '2026-01-01T00:00:00.000Z',
  is_valid: 1,
};

function envWith(db: FakeDb): Env {
  return {
    DB: db as unknown as D1Database,
    BOT_TOKEN: 'test-token',
    TELEGRAM_WEBHOOK_SECRET: 'test-secret',
    ADMIN_IDS: '999',
  };
}

async function withMembershipStatuses<T>(
  statuses: Array<'member' | 'left' | 'kicked'>,
  fn: () => Promise<T>,
): Promise<T> {
  const originalFetch = globalThis.fetch;
  let call = 0;
  globalThis.fetch = async () => {
    const status = statuses[call++];
    assert.ok(status, 'Unexpected extra getChatMember call');
    return new Response(JSON.stringify({
      ok: true,
      result: { status, user: telegramUser },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    return await fn();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('fresh non-member cannot enter the participant table', { concurrency: false }, async () => {
  const db = new FakeDb(user, []);
  const result = await withMembershipStatuses(['left'], () =>
    joinGiveaway(envWith(db), giveaway, telegramUser),
  );

  assert.equal(result.status, 'not_member');
  assert.equal(db.participantInsertAttempts, 0);
});

test('existing participant who left is no longer reported as eligible', { concurrency: false }, async () => {
  const db = new FakeDb(user, [participant]);
  const result = await withMembershipStatuses(['left'], () =>
    joinGiveaway(envWith(db), giveaway, telegramUser),
  );

  assert.equal(result.status, 'not_member');
  assert.equal(db.participantInsertAttempts, 0);
});

test('participant who left before draw can never be selected', { concurrency: false }, async () => {
  const db = new FakeDb(user, [participant], [
    { userId: 1, telegramId: '111', entries: 1 },
    { userId: 2, telegramId: '222', entries: 1 },
  ]);

  const winners = await withMembershipStatuses(['left', 'member'], () =>
    drawGiveaway(envWith(db), giveaway),
  );

  assert.deepEqual(winners.map((winner) => winner.userId), [2]);
  assert.deepEqual(db.insertedWinners, [{ userId: 2, position: 1 }]);
});
