import assert from 'node:assert/strict';
import test from 'node:test';
import type { Env, GiveawayRow, ParticipantRow, UserRow, WinnerRow } from '../src/types';
import type { ChatMember, TelegramUser } from '../src/telegram/types';
import { joinGiveaway } from '../src/services/participant';
import {
  auditWinnerMemberships,
  drawGiveaway,
  rerollWinnerGuarded,
} from '../src/services/draw';
import { checkChannelMembership } from '../src/services/membership';
import { winnersManageKeyboard } from '../src/telegram/keyboards';

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
  readonly users: UserRow[];
  readonly winners: WinnerRow[];
  participantInsertAttempts = 0;
  winnerUpdateAttempts = 0;
  beforeWinnerUpdate?: () => void;

  constructor(
    readonly user: UserRow,
    readonly participants: ParticipantRow[],
    readonly drawPool: Array<{ userId: number; telegramId: string; entries: number }> = [],
    options: { users?: UserRow[]; winners?: WinnerRow[] } = {},
  ) {
    this.users = options.users ?? [user];
    this.winners = options.winners ?? [];
  }

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
      this.winners.length = 0;
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith('INSERT INTO winners')) {
      this.insertedWinners.push({ userId: Number(params[1]), position: Number(params[2]) });
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith('UPDATE winners SET user_id')) {
      this.winnerUpdateAttempts++;
      this.beforeWinnerUpdate?.();
      const [, , giveawayId, position, expectedUserId] = params.map(Number);
      const winner = this.winners.find((w) =>
        w.giveaway_id === giveawayId &&
        w.position === position &&
        w.user_id === expectedUserId,
      );
      if (!winner) return { meta: { changes: 0 } };
      winner.user_id = Number(params[0]);
      winner.selected_at = String(params[1]);
      return { meta: { changes: 1 } };
    }
    throw new Error(`Unexpected run query: ${sql}`);
  }

  first(sql: string, params: unknown[]): unknown {
    if (sql.startsWith('SELECT * FROM users WHERE telegram_id')) return this.user;
    if (sql.startsWith('SELECT * FROM users WHERE id')) {
      return this.users.find((candidate) => candidate.id === Number(params[0])) ?? null;
    }
    if (sql.startsWith('SELECT * FROM participants WHERE giveaway_id')) {
      return this.participants.find((p) => p.giveaway_id === Number(params[0]) && p.user_id === Number(params[1])) ?? null;
    }
    if (sql.startsWith('SELECT * FROM winners WHERE giveaway_id')) {
      return this.winners.find((winner) =>
        winner.giveaway_id === Number(params[0]) && winner.position === Number(params[1]),
      ) ?? null;
    }
    throw new Error(`Unexpected first query: ${sql}`);
  }

  all(sql: string, params: unknown[]): unknown[] {
    if (sql.includes('FROM participants p JOIN users u')) return this.drawPool;
    if (sql.startsWith('SELECT user_id AS uid, COUNT(*) AS c FROM winners')) return [];
    if (sql.startsWith('SELECT user_id FROM winners WHERE giveaway_id')) {
      return this.winners
        .filter((winner) => winner.giveaway_id === Number(params[0]))
        .map((winner) => ({ user_id: winner.user_id }));
    }
    if (sql.startsWith('SELECT * FROM winners WHERE giveaway_id')) {
      return this.winners
        .filter((winner) => winner.giveaway_id === Number(params[0]))
        .sort((a, b) => a.position - b.position);
    }
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

type MembershipReply =
  | ChatMember['status']
  | { status: 'restricted'; is_member?: boolean }
  | 'api_error'
  | 'missing_result';

async function withMembershipReplies<T>(
  replies: MembershipReply[],
  fn: () => Promise<T>,
): Promise<T> {
  const originalFetch = globalThis.fetch;
  let call = 0;
  globalThis.fetch = async () => {
    const reply = replies[call++];
    assert.ok(reply, 'Unexpected extra getChatMember call');
    const body = reply === 'api_error'
      ? { ok: false, description: 'temporary Telegram failure' }
      : reply === 'missing_result'
        ? { ok: true }
        : {
            ok: true,
            result: {
              ...(typeof reply === 'string' ? { status: reply } : reply),
              user: telegramUser,
            },
          };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    const result = await fn();
    assert.equal(call, replies.length, 'Not every mocked membership reply was used');
    return result;
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function withMembershipStatuses<T>(
  statuses: Array<'member' | 'left' | 'kicked'>,
  fn: () => Promise<T>,
): Promise<T> {
  return withMembershipReplies(statuses, fn);
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

test('membership statuses are classified without treating API failures as departure', { concurrency: false }, async () => {
  const replies: MembershipReply[] = [
    'member',
    'administrator',
    'creator',
    { status: 'restricted', is_member: true },
    { status: 'restricted', is_member: false },
    { status: 'restricted' },
    'left',
    'kicked',
    'api_error',
    'missing_result',
  ];
  const expected = [
    'member',
    'member',
    'member',
    'member',
    'not_member',
    'not_member',
    'not_member',
    'not_member',
    'unknown',
    'unknown',
  ];

  const actual = await withMembershipReplies(replies, async () => {
    const statuses = [];
    for (let index = 0; index < replies.length; index++) {
      statuses.push(await checkChannelMembership(envWith(new FakeDb(user, [])), giveaway, user.telegram_id));
    }
    return statuses;
  });

  assert.deepEqual(actual, expected);
});

test('unknown membership remains fail-closed for JOIN and draw', { concurrency: false }, async () => {
  const joinDb = new FakeDb(user, []);
  const joinResult = await withMembershipReplies(['api_error'], () =>
    joinGiveaway(envWith(joinDb), giveaway, telegramUser),
  );
  assert.equal(joinResult.status, 'not_member');
  assert.equal(joinDb.participantInsertAttempts, 0);

  const drawDb = new FakeDb(user, [participant], [
    { userId: 1, telegramId: '111', entries: 1 },
  ]);
  const winners = await withMembershipReplies(['missing_result'], () =>
    drawGiveaway(envWith(drawDb), giveaway),
  );
  assert.deepEqual(winners, []);
  assert.deepEqual(drawDb.insertedWinners, []);
});

test('winner keyboard shows check always and reroll only for audited non-members', () => {
  const initial = winnersManageKeyboard(giveaway.id);
  assert.deepEqual(initial.inline_keyboard.map((row) => row[0]?.callback_data), [
    `wcheck:${giveaway.id}`,
    `rrall:${giveaway.id}`,
    'menu:drawlist',
  ]);

  const audited = winnersManageKeyboard(giveaway.id, [
    { position: 2, userId: 44 },
  ]);
  assert.deepEqual(audited.inline_keyboard.map((row) => row[0]?.callback_data), [
    `wcheck:${giveaway.id}`,
    `rrpos:${giveaway.id}:2:44`,
    `rrall:${giveaway.id}`,
    'menu:drawlist',
  ]);
});

test('winner audit preserves positions, identity, and tri-state results sequentially', { concurrency: false }, async () => {
  const secondUser: UserRow = {
    ...user,
    id: 2,
    telegram_id: '222',
    username: 'second',
    first_name: 'Second',
  };
  const thirdUser: UserRow = {
    ...user,
    id: 3,
    telegram_id: '333',
    username: null,
    first_name: 'Third',
  };
  const winners: WinnerRow[] = [
    { id: 12, giveaway_id: giveaway.id, user_id: 2, position: 2, selected_at: giveaway.created_at },
    { id: 11, giveaway_id: giveaway.id, user_id: 1, position: 1, selected_at: giveaway.created_at },
    { id: 13, giveaway_id: giveaway.id, user_id: 3, position: 3, selected_at: giveaway.created_at },
    { id: 14, giveaway_id: giveaway.id, user_id: 999, position: 4, selected_at: giveaway.created_at },
  ];
  const db = new FakeDb(user, [], [], {
    users: [user, secondUser, thirdUser],
    winners,
  });

  const audits = await withMembershipReplies(['member', 'left', 'api_error'], () =>
    auditWinnerMemberships(envWith(db), giveaway),
  );

  assert.deepEqual(audits.map((audit) => ({
    position: audit.position,
    userId: audit.userId,
    telegramId: audit.telegramId,
    username: audit.username,
    status: audit.status,
  })), [
    { position: 1, userId: 1, telegramId: '111', username: 'tester', status: 'member' },
    { position: 2, userId: 2, telegramId: '222', username: 'second', status: 'not_member' },
    { position: 3, userId: 3, telegramId: '333', username: null, status: 'unknown' },
    { position: 4, userId: 999, telegramId: null, username: null, status: 'unknown' },
  ]);
});

test('guarded reroll rejects missing and stale positions without mutation', async () => {
  const replacementPool = [{ userId: 2, telegramId: '222', entries: 1 }];
  const missingDb = new FakeDb(user, [], replacementPool);
  const missing = await rerollWinnerGuarded(envWith(missingDb), giveaway, 1, user.id);
  assert.equal(missing.status, 'missing');
  assert.equal(missingDb.winnerUpdateAttempts, 0);

  const staleDb = new FakeDb(user, [], replacementPool, {
    winners: [{ id: 1, giveaway_id: giveaway.id, user_id: 9, position: 1, selected_at: giveaway.created_at }],
  });
  const stale = await rerollWinnerGuarded(envWith(staleDb), giveaway, 1, user.id);
  assert.equal(stale.status, 'stale');
  assert.equal(staleDb.winnerUpdateAttempts, 0);
});

test('guarded reroll replaces only with an eligible non-winner candidate', { concurrency: false }, async () => {
  const winners: WinnerRow[] = [
    { id: 1, giveaway_id: giveaway.id, user_id: 1, position: 1, selected_at: giveaway.created_at },
    { id: 2, giveaway_id: giveaway.id, user_id: 8, position: 2, selected_at: giveaway.created_at },
  ];
  const db = new FakeDb(user, [], [
    { userId: 8, telegramId: '888', entries: 1 },
    { userId: 2, telegramId: '222', entries: 1 },
    { userId: 3, telegramId: '333', entries: 1 },
  ], { winners });

  const result = await withMembershipReplies(['left', 'member'], () =>
    rerollWinnerGuarded(envWith(db), giveaway, 1, user.id),
  );

  assert.equal(result.status, 'replaced');
  if (result.status === 'replaced') {
    assert.equal(result.replacement.userId, 3);
    assert.equal(result.replacement.position, 1);
  }
  assert.equal(winners[0]?.user_id, 3);
  assert.equal(winners[1]?.user_id, 8);
  assert.equal(db.winnerUpdateAttempts, 1);
});

test('guarded reroll detects a winner change racing the conditional update', { concurrency: false }, async () => {
  const winners: WinnerRow[] = [
    { id: 1, giveaway_id: giveaway.id, user_id: 1, position: 1, selected_at: giveaway.created_at },
  ];
  const db = new FakeDb(user, [], [
    { userId: 2, telegramId: '222', entries: 1 },
  ], { winners });
  db.beforeWinnerUpdate = () => {
    winners[0]!.user_id = 9;
  };

  const result = await withMembershipReplies(['member'], () =>
    rerollWinnerGuarded(envWith(db), giveaway, 1, user.id),
  );

  assert.equal(result.status, 'stale');
  assert.equal(winners[0]?.user_id, 9);
  assert.equal(db.winnerUpdateAttempts, 1);
});
