// SQLite 数据库层 —— 持久化会话和消息
// 表结构按 Chatbox 的 Session / Message 模型设计

import * as SQLite from 'expo-sqlite';
import type { Message, Session } from '../types';

// 缓存 Promise 而非结果：并发调用（如 init 里的 Promise.all）只会初始化一次
let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function getDB(): Promise<SQLite.SQLiteDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = openAndInit();
  return dbPromise;
}

async function openAndInit(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync('chatbox.db');
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      settingsOverride TEXT
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY NOT NULL,
      sessionId TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      status TEXT,
      error TEXT,
      FOREIGN KEY (sessionId) REFERENCES sessions(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(sessionId, createdAt);
  `);
  // 迁移：老库的 messages 表没有 attachments 列，补上（已存在会抛错，忽略）
  try {
    await db.execAsync('ALTER TABLE messages ADD COLUMN attachments TEXT');
  } catch {
    // 列已存在
  }
  return db;
}

// ---- 会话 ----

export async function listSessions(): Promise<Session[]> {
  const db = await getDB();
  const rows = await db.getAllAsync<any>(
    'SELECT * FROM sessions ORDER BY updatedAt DESC'
  );
  return rows.map(rowToSession);
}

export async function insertSession(s: Session): Promise<void> {
  const db = await getDB();
  await db.runAsync(
    'INSERT INTO sessions (id, title, createdAt, updatedAt, settingsOverride) VALUES (?, ?, ?, ?, ?)',
    s.id,
    s.title,
    s.createdAt,
    s.updatedAt,
    s.settingsOverride ? JSON.stringify(s.settingsOverride) : null
  );
}

export async function updateSession(
  id: string,
  patch: Partial<Pick<Session, 'title' | 'updatedAt' | 'settingsOverride'>>
): Promise<void> {
  const db = await getDB();
  const fields: string[] = [];
  const values: any[] = [];
  if (patch.title !== undefined) {
    fields.push('title = ?');
    values.push(patch.title);
  }
  if (patch.updatedAt !== undefined) {
    fields.push('updatedAt = ?');
    values.push(patch.updatedAt);
  }
  if (patch.settingsOverride !== undefined) {
    fields.push('settingsOverride = ?');
    values.push(
      patch.settingsOverride ? JSON.stringify(patch.settingsOverride) : null
    );
  }
  if (!fields.length) return;
  values.push(id);
  await db.runAsync(
    `UPDATE sessions SET ${fields.join(', ')} WHERE id = ?`,
    ...values
  );
}

export async function deleteSession(id: string): Promise<void> {
  const db = await getDB();
  await db.runAsync('DELETE FROM sessions WHERE id = ?', id);
}

// ---- 消息 ----

export async function listMessages(sessionId: string): Promise<Message[]> {
  const db = await getDB();
  const rows = await db.getAllAsync<any>(
    'SELECT * FROM messages WHERE sessionId = ? ORDER BY createdAt ASC',
    sessionId
  );
  return rows.map(rowToMessage);
}

export async function insertMessage(m: Message): Promise<void> {
  const db = await getDB();
  await db.runAsync(
    'INSERT INTO messages (id, sessionId, role, content, createdAt, status, error, attachments) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    m.id,
    m.sessionId,
    m.role,
    m.content,
    m.createdAt,
    m.status ?? null,
    m.error ?? null,
    m.attachments && m.attachments.length ? JSON.stringify(m.attachments) : null
  );
}

function rowToMessage(row: any): Message {
  return {
    id: row.id,
    sessionId: row.sessionId,
    role: row.role,
    content: row.content,
    createdAt: row.createdAt,
    status: row.status ?? undefined,
    error: row.error ?? undefined,
    attachments: row.attachments ? safeParse(row.attachments) : undefined,
  };
}

function safeParse(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

export async function updateMessage(
  id: string,
  patch: Partial<Pick<Message, 'content' | 'status' | 'error'>>
): Promise<void> {
  const db = await getDB();
  const fields: string[] = [];
  const values: any[] = [];
  if (patch.content !== undefined) {
    fields.push('content = ?');
    values.push(patch.content);
  }
  if (patch.status !== undefined) {
    fields.push('status = ?');
    values.push(patch.status);
  }
  if (patch.error !== undefined) {
    fields.push('error = ?');
    values.push(patch.error);
  }
  if (!fields.length) return;
  values.push(id);
  await db.runAsync(
    `UPDATE messages SET ${fields.join(', ')} WHERE id = ?`,
    ...values
  );
}

// 删除单条消息
export async function deleteMessage(id: string): Promise<void> {
  const db = await getDB();
  await db.runAsync('DELETE FROM messages WHERE id = ?', id);
}

// 删除某条消息（含）之后的所有消息 —— 用于「重新生成」「编辑重发」
export async function deleteMessagesFrom(
  sessionId: string,
  createdAt: number
): Promise<void> {
  const db = await getDB();
  await db.runAsync(
    'DELETE FROM messages WHERE sessionId = ? AND createdAt >= ?',
    sessionId,
    createdAt
  );
}

function rowToSession(row: any): Session {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    settingsOverride: row.settingsOverride
      ? JSON.parse(row.settingsOverride)
      : undefined,
  };
}
