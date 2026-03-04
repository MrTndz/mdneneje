"use strict";
// ================================================================
// MERAI MONITORING BOT v9.0
// Telegram Business API + AI Assistant
// grammy 1.31 / better-sqlite3 / archiver / node-cron
// Исправлено: ctx.update.* для всех Business событий
// Исправлено: всегда уведомляем conn.user_id, не senderId
// Исправлено: view-once/timer медиа скачивается немедленно
// Исправлено: ZIP при удалении чата (любое количество)
// Новые фичи: VIP-контакты, AI-резюме, профиль контакта,
//   лента событий, недельный отчёт, дубликаты, алерты,
//   быстрые действия, заметки, последние удалённые, и др.
// ================================================================

const { Bot, InlineKeyboard, Keyboard, InputFile } = require("grammy");
const DB     = require("better-sqlite3");
const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");
const cron   = require("node-cron");

// ================================================================
//  ENV / CONFIG
// ================================================================
const MON_TOKEN      = process.env.MON_TOKEN      || "8505484152:AAHXEFt0lyeMK5ZSJHRYpdPhhFJ0s142Bng";
const MERAI_TOKEN    = process.env.BOT_TOKEN       || "";
const GROQ_KEY       = process.env.GROQ_API_KEY   || "";
const GEMINI_KEY     = process.env.GEMINI_API_KEY || "";
const WEBAPP_URL     = process.env.WEBAPP_URL      || "https://t.me/merai_bbot";
const DB_PATH        = process.env.DB_PATH         || path.join("database", "bot.db");
const ADMIN_ID       = 7785371505;

const PLAN_DAYS     = { starter:7, basic:30, pro:90, premium:365, ultimate:null };
const PLAN_STARS    = { starter:100, basic:250, pro:600, premium:2000, ultimate:5000 };
const PLAN_RUB      = { starter:200, basic:500, pro:1200, premium:4000, ultimate:10000 };
const PLAN_LABEL    = { starter:"🌟 Starter 7д", basic:"💎 Basic 1мес", pro:"💼 Pro 3мес 🔥",
                         premium:"👑 Premium 1год 🔥", ultimate:"♾️ Ultimate навсегда 💥" };
const PLAN_XP       = { starter:200, basic:500, pro:1500, premium:3000, ultimate:10000 };

const TRIAL_DAYS    = 3;

// Скам-слова
const SCAM_KWORDS = [
  "отправь деньги","переведи срочно","срочный перевод","взлом аккаунта",
  "пин код","pin code","cvv","верификация карты","ты выиграл",
  "бесплатно перейди","click here","verify account","urgent transfer",
  "send money","account suspended","подтверди перевод",
  "введи пароль","ваш аккаунт заблокирован","требуется верификация",
  "telegram premium бесплатно","получи деньги",
];

// Категории
const CATS = {
  "Работа":  ["встреча","задача","проект","дедлайн","клиент","отчёт","офис","созвон","meeting","task","deadline","report"],
  "Финансы": ["деньги","оплата","счёт","перевод","банк","карта","зарплата","payment","invoice","money","transfer"],
  "Ссылки":  ["http://","https://","www.","t.me/","youtu.be","instagram","vk.com"],
  "Вопросы": ["?"],
  "Личное":  ["люблю","скучаю","семья","дом","отдых","привет","спасибо"],
};

// ================================================================
//  ДИРЕКТОРИИ
// ================================================================
["database","media","exports","backups"].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive:true });
});

// ================================================================
//  БАЗА ДАННЫХ (WAL, persistent)
// ================================================================
const db = new DB(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");
db.pragma("busy_timeout = 30000");
db.pragma("foreign_keys = ON");
db.pragma("cache_size = -64000");

db.exec(`
-- Пользователи
CREATE TABLE IF NOT EXISTS users (
  user_id               INTEGER PRIMARY KEY,
  username              TEXT,
  first_name            TEXT,
  registered_at         TEXT DEFAULT (datetime('now')),
  accepted_terms        INTEGER DEFAULT 0,
  is_blocked            INTEGER DEFAULT 0,
  subscription_type     TEXT DEFAULT 'free',
  subscription_expires  TEXT,
  trial_used            INTEGER DEFAULT 0,
  referral_code         TEXT UNIQUE,
  referred_by           INTEGER,
  referral_earnings     INTEGER DEFAULT 0,
  total_referrals       INTEGER DEFAULT 0,
  notify_deletions      INTEGER DEFAULT 1,
  notify_edits          INTEGER DEFAULT 1,
  notify_timer          INTEGER DEFAULT 1,
  notify_scam           INTEGER DEFAULT 1,
  notify_keywords       INTEGER DEFAULT 1,
  digest_enabled        INTEGER DEFAULT 0,
  user_level            INTEGER DEFAULT 1,
  xp                    INTEGER DEFAULT 0,
  achievement_count     INTEGER DEFAULT 0,
  total_messages        INTEGER DEFAULT 0,
  total_deletions       INTEGER DEFAULT 0,
  total_edits           INTEGER DEFAULT 0,
  total_media           INTEGER DEFAULT 0,
  stars_balance         INTEGER DEFAULT 0,
  cleanup_days          INTEGER DEFAULT 90
);

-- Business подключения
CREATE TABLE IF NOT EXISTS connections (
  connection_id TEXT PRIMARY KEY,
  user_id       INTEGER NOT NULL,
  connected_at  TEXT DEFAULT (datetime('now')),
  is_active     INTEGER DEFAULT 1,
  FOREIGN KEY(user_id) REFERENCES users(user_id)
);

-- Все сохранённые сообщения
CREATE TABLE IF NOT EXISTS messages (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER NOT NULL,
  connection_id     TEXT,
  chat_id           INTEGER,
  message_id        INTEGER,
  sender_id         INTEGER,
  sender_username   TEXT,
  sender_name       TEXT,
  text              TEXT,
  caption           TEXT,
  media_type        TEXT,
  file_id           TEXT,
  file_unique_id    TEXT,
  file_path         TEXT,
  has_timer         INTEGER DEFAULT 0,
  is_view_once      INTEGER DEFAULT 0,
  category          TEXT DEFAULT 'Личное',
  importance        INTEGER DEFAULT 0,
  has_links         INTEGER DEFAULT 0,
  is_scam           INTEGER DEFAULT 0,
  is_deleted        INTEGER DEFAULT 0,
  deleted_at        TEXT,
  is_edited         INTEGER DEFAULT 0,
  edited_at         TEXT,
  original_text     TEXT,
  created_at        TEXT DEFAULT (datetime('now'))
);

-- VIP контакты
CREATE TABLE IF NOT EXISTS vip_contacts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL,
  sender_id   INTEGER NOT NULL,
  sender_name TEXT,
  note        TEXT,
  added_at    TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, sender_id)
);

-- Заметки к контактам
CREATE TABLE IF NOT EXISTS contact_notes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER,
  sender_id   INTEGER,
  note        TEXT,
  created_at  TEXT DEFAULT (datetime('now'))
);

-- Блок-лист отправителей
CREATE TABLE IF NOT EXISTS blocklist (
  user_id   INTEGER,
  sender_id INTEGER,
  added_at  TEXT DEFAULT (datetime('now')),
  PRIMARY KEY(user_id, sender_id)
);

-- Ключевые слова-триггеры
CREATE TABLE IF NOT EXISTS keywords (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER,
  keyword    TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Платежи
CREATE TABLE IF NOT EXISTS payments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER,
  stars      INTEGER,
  plan       TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Реферальные действия
CREATE TABLE IF NOT EXISTS referral_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  referrer_id INTEGER,
  referred_id INTEGER,
  bonus       INTEGER DEFAULT 0,
  created_at  TEXT DEFAULT (datetime('now'))
);

-- Достижения
CREATE TABLE IF NOT EXISTS achievements (
  user_id     INTEGER,
  code        TEXT,
  unlocked_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY(user_id, code)
);

-- Лог активности (для тепловой карты)
CREATE TABLE IF NOT EXISTS activity (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER,
  event       TEXT,
  hour        INTEGER,
  dow         INTEGER,
  created_at  TEXT DEFAULT (datetime('now'))
);

-- Индексы
CREATE INDEX IF NOT EXISTS idx_msg_user    ON messages(user_id);
CREATE INDEX IF NOT EXISTS idx_msg_chat    ON messages(user_id, chat_id, message_id);
CREATE INDEX IF NOT EXISTS idx_msg_sender  ON messages(user_id, sender_id);
CREATE INDEX IF NOT EXISTS idx_msg_del     ON messages(user_id, is_deleted);
CREATE INDEX IF NOT EXISTS idx_msg_date    ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_msg_file    ON messages(file_unique_id);
CREATE INDEX IF NOT EXISTS idx_conn_user   ON connections(user_id);
`);

console.log(`[DB] ${DB_PATH} инициализирована (WAL mode)`);

// ================================================================
//  ПОДГОТОВЛЕННЫЕ ЗАПРОСЫ
// ================================================================
const stmts = {
  addUser: db.prepare(`
    INSERT OR IGNORE INTO users(user_id,username,first_name,referral_code,referred_by)
    VALUES(?,?,?,?,?)
  `),
  getUser: db.prepare(`SELECT * FROM users WHERE user_id=?`),
  updUser: (fields) => {
    const sets = Object.keys(fields).map(k => `${k}=?`).join(", ");
    return db.prepare(`UPDATE users SET ${sets} WHERE user_id=?`);
  },
  getConn: db.prepare(`SELECT * FROM connections WHERE connection_id=?`),
  addConn: db.prepare(`INSERT OR REPLACE INTO connections(connection_id,user_id) VALUES(?,?)`),
  userConns: db.prepare(`SELECT * FROM connections WHERE user_id=?`),
  saveMsg: db.prepare(`
    INSERT INTO messages
      (user_id,connection_id,chat_id,message_id,sender_id,sender_username,sender_name,
       text,caption,media_type,file_id,file_unique_id,file_path,has_timer,is_view_once,
       category,importance,has_links,is_scam)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `),
  getMsg: db.prepare(`
    SELECT * FROM messages WHERE user_id=? AND chat_id=? AND message_id=?
    ORDER BY created_at DESC LIMIT 1
  `),
  getMsgById: db.prepare(`SELECT * FROM messages WHERE id=?`),
  markDel: db.prepare(`
    UPDATE messages SET is_deleted=1, deleted_at=datetime('now')
    WHERE user_id=? AND chat_id=? AND message_id=? AND is_deleted=0
  `),
  markEdit: db.prepare(`
    UPDATE messages SET is_edited=1, edited_at=datetime('now'), original_text=?
    WHERE user_id=? AND chat_id=? AND message_id=?
  `),
  getVip: db.prepare(`SELECT * FROM vip_contacts WHERE user_id=? AND sender_id=?`),
  isBlocked: db.prepare(`SELECT 1 FROM blocklist WHERE user_id=? AND sender_id=?`),
  keywords: db.prepare(`SELECT keyword FROM keywords WHERE user_id=?`),
  payments: db.prepare(`SELECT * FROM payments WHERE user_id=? ORDER BY created_at DESC LIMIT 20`),
};

// ================================================================
//  ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ БАЗЫ ДАННЫХ
// ================================================================

function makeRefCode(uid) {
  const c = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 7; i++) s += c[Math.floor(Math.random() * c.length)];
  return "REF" + uid.toString().slice(-4) + s;
}

function addUser(uid, username, firstName, refCode) {
  const code = makeRefCode(uid);
  let refBy = null;
  if (refCode) {
    const refUser = db.prepare(`SELECT user_id FROM users WHERE referral_code=?`).get(refCode);
    if (refUser && refUser.user_id !== uid) {
      refBy = refUser.user_id;
      db.prepare(`UPDATE users SET total_referrals=total_referrals+1 WHERE user_id=?`).run(refBy);
    }
  }
  const info = stmts.addUser.run(uid, username || null, firstName || null, code, refBy);
  return info.changes > 0;
}

function getUser(uid) { return stmts.getUser.get(uid) || null; }

function updateUser(uid, fields) {
  if (!Object.keys(fields).length) return;
  const sets = Object.keys(fields).map(k => `${k}=?`).join(", ");
  db.prepare(`UPDATE users SET ${sets} WHERE user_id=?`).run(...Object.values(fields), uid);
}

function checkSub(uid) {
  const u = getUser(uid);
  if (!u || u.is_blocked) return false;
  if (u.subscription_type === "free") return false;
  if (u.subscription_type === "ultimate") return true;
  if (!u.subscription_expires) return false;
  if (new Date() > new Date(u.subscription_expires)) {
    updateUser(uid, { subscription_type:"free", subscription_expires:null });
    return false;
  }
  return true;
}

function activateTrial(uid) {
  const u = getUser(uid);
  if (!u || u.trial_used) return false;
  const exp = new Date(Date.now() + TRIAL_DAYS * 86400000).toISOString();
  const r = db.prepare(`UPDATE users SET subscription_type='trial', subscription_expires=?, trial_used=1 WHERE user_id=? AND trial_used=0`).run(exp, uid);
  return r.changes > 0;
}

function activateSub(uid, plan) {
  const days = PLAN_DAYS[plan];
  const exp  = days ? new Date(Date.now() + days * 86400000).toISOString() : null;
  updateUser(uid, { subscription_type: plan, subscription_expires: exp });
}

function getConnection(connId) { return stmts.getConn.get(connId) || null; }

function categorize(text) {
  const low = (text || "").toLowerCase();
  if (/https?:\/\/|www\.|t\.me\//.test(low)) return "Ссылки";
  for (const [cat, words] of Object.entries(CATS)) {
    if (words.some(w => low.includes(w))) return cat;
  }
  return "Личное";
}

function calcImportance(text, mediaType, hasTimer, isVip) {
  let s = 0;
  if (mediaType) s += 15;
  if (hasTimer)  s += 25;
  if (isVip)     s += 30;
  if (text) {
    s += Math.min(Math.floor((text.length || 0) / 30), 20);
    if (/срочно|важно|urgent|asap|помогите|помоги/.test((text || "").toLowerCase())) s += 15;
  }
  return Math.min(s, 100);
}

function isScam(text) {
  const low = (text || "").toLowerCase();
  return SCAM_KWORDS.some(w => low.includes(w));
}

// Сохранить сообщение в БД
function saveMsg(uid, connId, chatId, msgId, senderId, senderUsername, senderName,
  text, caption, mediaType, fileId, fileUniqueId, filePath, hasTimer, isViewOnce) {
  const cat     = categorize(text || caption || "");
  const vip     = !!stmts.getVip.get(uid, senderId || 0);
  const imp     = calcImportance(text || caption || "", mediaType, hasTimer, vip);
  const links   = /https?:\/\/|www\./i.test(text || "") ? 1 : 0;
  const scam    = isScam(text || "") ? 1 : 0;
  const info    = stmts.saveMsg.run(
    uid, connId, chatId, msgId, senderId || 0, senderUsername || null, senderName || null,
    text || null, caption || null, mediaType || null, fileId || null, fileUniqueId || null,
    filePath || null, hasTimer ? 1 : 0, isViewOnce ? 1 : 0, cat, imp, links, scam
  );
  db.prepare(`UPDATE users SET total_messages=total_messages+1 WHERE user_id=?`).run(uid);
  if (mediaType) db.prepare(`UPDATE users SET total_media=total_media+1 WHERE user_id=?`).run(uid);
  const now = new Date();
  db.prepare(`INSERT INTO activity(user_id,event,hour,dow) VALUES(?,?,?,?)`).run(uid, "message", now.getHours(), now.getDay());
  return info.lastInsertRowid;
}

function markDeleted(uid, chatId, msgId) {
  const r = stmts.markDel.run(uid, chatId, msgId);
  if (r.changes > 0) db.prepare(`UPDATE users SET total_deletions=total_deletions+1 WHERE user_id=?`).run(uid);
  return r.changes > 0;
}

function markEdited(uid, chatId, msgId, originalText) {
  const r = stmts.markEdit.run(originalText, uid, chatId, msgId);
  if (r.changes > 0) db.prepare(`UPDATE users SET total_edits=total_edits+1 WHERE user_id=?`).run(uid);
  return r.changes > 0;
}

function searchMsgs(uid, opts = {}) {
  let sql = `SELECT * FROM messages WHERE user_id=?`;
  const p = [uid];
  if (opts.q)         { sql += ` AND (text LIKE ? OR caption LIKE ?)`; const like = `%${opts.q}%`; p.push(like, like); }
  if (opts.mediaType) { sql += ` AND media_type=?`;   p.push(opts.mediaType); }
  if (opts.category)  { sql += ` AND category=?`;     p.push(opts.category); }
  if (opts.sender)    { sql += ` AND (sender_username LIKE ? OR sender_name LIKE ?)`; p.push(`%${opts.sender}%`, `%${opts.sender}%`); }
  if (opts.deleted)   { sql += ` AND is_deleted=1`; }
  if (opts.timer)     { sql += ` AND has_timer=1`; }
  if (opts.dateFrom)  { sql += ` AND DATE(created_at)>=?`; p.push(opts.dateFrom); }
  sql += ` ORDER BY created_at DESC LIMIT ?`;
  p.push(opts.limit || 20);
  return db.prepare(sql).all(...p);
}

function getChatMsgs(uid, chatId) {
  return db.prepare(`SELECT * FROM messages WHERE user_id=? AND chat_id=? ORDER BY created_at ASC`).all(uid, chatId);
}

function getMsgsBySender(uid, senderId, limit) {
  return db.prepare(`SELECT * FROM messages WHERE user_id=? AND sender_id=? ORDER BY created_at DESC LIMIT ?`).all(uid, senderId, limit || 30);
}

function addXp(uid, xp) {
  const u = getUser(uid);
  if (!u) return;
  const newXp  = u.xp + xp;
  const newLvl = Math.max(1, Math.floor(Math.sqrt(newXp / 100)) + 1);
  updateUser(uid, { xp: newXp, user_level: newLvl });
}

function awardAch(uid, code) {
  try {
    const r = db.prepare(`INSERT OR IGNORE INTO achievements(user_id,code) VALUES(?,?)`).run(uid, code);
    if (r.changes > 0) { db.prepare(`UPDATE users SET achievement_count=achievement_count+1 WHERE user_id=?`).run(uid); return true; }
  } catch(e){}
  return false;
}

function getAchs(uid) { return db.prepare(`SELECT * FROM achievements WHERE user_id=? ORDER BY unlocked_at DESC`).all(uid); }

function isVip(uid, senderId) { return !!stmts.getVip.get(uid, senderId); }

function addVip(uid, senderId, name, note) {
  db.prepare(`INSERT OR REPLACE INTO vip_contacts(user_id,sender_id,sender_name,note) VALUES(?,?,?,?)`).run(uid, senderId, name || null, note || null);
}

function removeVip(uid, senderId) {
  db.prepare(`DELETE FROM vip_contacts WHERE user_id=? AND sender_id=?`).run(uid, senderId);
}

function getVipList(uid) { return db.prepare(`SELECT * FROM vip_contacts WHERE user_id=? ORDER BY added_at DESC`).all(uid); }

function addToBlocklist(uid, senderId) {
  try { db.prepare(`INSERT OR IGNORE INTO blocklist(user_id,sender_id) VALUES(?,?)`).run(uid, senderId); } catch(e){}
}

function removeFromBlocklist(uid, senderId) {
  db.prepare(`DELETE FROM blocklist WHERE user_id=? AND sender_id=?`).run(uid, senderId);
}

function addKeyword(uid, kw) {
  db.prepare(`INSERT INTO keywords(user_id,keyword) VALUES(?,?)`).run(uid, kw.toLowerCase().trim());
}

function delKeyword(uid, kw) {
  db.prepare(`DELETE FROM keywords WHERE user_id=? AND keyword=?`).run(uid, kw.toLowerCase().trim());
}

function savePayment(uid, stars, plan) {
  db.prepare(`INSERT INTO payments(user_id,stars,plan) VALUES(?,?,?)`).run(uid, stars, plan);
}

function processRef(uid, amount) {
  const u = getUser(uid);
  if (!u || !u.referred_by) return;
  const bonus = Math.floor(amount * 0.2);
  db.prepare(`UPDATE users SET stars_balance=stars_balance+?, referral_earnings=referral_earnings+? WHERE user_id=?`).run(bonus, bonus, u.referred_by);
  db.prepare(`INSERT INTO referral_log(referrer_id,referred_id,bonus) VALUES(?,?,?)`).run(u.referred_by, uid, bonus);
}

function adminStats() {
  return {
    users:    db.prepare(`SELECT COUNT(*) c FROM users`).get().c,
    active:   db.prepare(`SELECT COUNT(*) c FROM users WHERE subscription_type!='free' AND is_blocked=0`).get().c,
    messages: db.prepare(`SELECT COUNT(*) c FROM messages`).get().c,
    deleted:  db.prepare(`SELECT COUNT(*) c FROM messages WHERE is_deleted=1`).get().c,
    edited:   db.prepare(`SELECT COUNT(*) c FROM messages WHERE is_edited=1`).get().c,
    media:    db.prepare(`SELECT COUNT(*) c FROM messages WHERE media_type IS NOT NULL`).get().c,
    timer:    db.prepare(`SELECT COUNT(*) c FROM messages WHERE has_timer=1`).get().c,
    stars:    db.prepare(`SELECT COALESCE(SUM(stars),0) s FROM payments`).get().s,
    payments: db.prepare(`SELECT COUNT(*) c FROM payments`).get().c,
    vips:     db.prepare(`SELECT COUNT(*) c FROM vip_contacts`).get().c,
    byPlan:   db.prepare(`SELECT subscription_type t, COUNT(*) c FROM users GROUP BY subscription_type`).all(),
  };
}

function getHeatmap(uid) {
  const rows = db.prepare(`SELECT hour,dow,COUNT(*) cnt FROM activity WHERE user_id=? GROUP BY hour,dow`).all(uid);
  const d = {};
  for (let day = 0; day < 7; day++) { d[day] = {}; for (let h = 0; h < 24; h++) d[day][h] = 0; }
  rows.forEach(r => { d[r.dow][r.hour] = r.cnt; });
  return d;
}

function getTopContacts(uid) {
  return db.prepare(`
    SELECT sender_id, sender_name, sender_username,
           COUNT(*) total, SUM(is_deleted) deleted, SUM(has_timer) timers,
           MAX(created_at) last_msg
    FROM messages WHERE user_id=?
    GROUP BY sender_id ORDER BY total DESC LIMIT 10
  `).all(uid);
}

function getCatStats(uid) {
  return db.prepare(`SELECT category, COUNT(*) cnt FROM messages WHERE user_id=? GROUP BY category ORDER BY cnt DESC`).all(uid);
}

function getTimeline(uid, limit) {
  return db.prepare(`
    SELECT * FROM messages WHERE user_id=? AND (is_deleted=1 OR is_edited=1)
    ORDER BY COALESCE(deleted_at,edited_at) DESC LIMIT ?
  `).all(uid, limit || 15);
}

function getLastDeleted(uid, limit) {
  return db.prepare(`SELECT * FROM messages WHERE user_id=? AND is_deleted=1 ORDER BY deleted_at DESC LIMIT ?`).all(uid, limit || 10);
}

function getDuplicateMedia(uid) {
  return db.prepare(`
    SELECT file_unique_id, media_type, COUNT(*) cnt,
           MIN(created_at) first_seen, MAX(created_at) last_seen
    FROM messages WHERE user_id=? AND file_unique_id IS NOT NULL AND file_unique_id!=''
    GROUP BY file_unique_id HAVING cnt>1 ORDER BY cnt DESC LIMIT 10
  `).all(uid);
}

function getContactProfile(uid, senderId) {
  const base = db.prepare(`
    SELECT sender_id, sender_name, sender_username,
           COUNT(*) total, SUM(is_deleted) deleted, SUM(is_edited) edited,
           SUM(has_timer) timers, SUM(is_scam) scam_count,
           MIN(created_at) first_msg, MAX(created_at) last_msg
    FROM messages WHERE user_id=? AND sender_id=?
    GROUP BY sender_id
  `).get(uid, senderId);
  const catStats = db.prepare(`
    SELECT category, COUNT(*) cnt FROM messages WHERE user_id=? AND sender_id=? GROUP BY category
  `).all(uid, senderId);
  const note = db.prepare(`SELECT note FROM contact_notes WHERE user_id=? AND sender_id=? ORDER BY created_at DESC LIMIT 1`).get(uid, senderId);
  const vip  = !!stmts.getVip.get(uid, senderId);
  return { ...base, catStats, note: note?.note, vip };
}

function cleanupOldMedia(uid, days) {
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  const rows = db.prepare(`SELECT id,file_path FROM messages WHERE user_id=? AND file_path IS NOT NULL AND created_at<?`).all(uid, cutoff);
  let cnt = 0;
  rows.forEach(r => {
    if (r.file_path && fs.existsSync(r.file_path)) { try { fs.unlinkSync(r.file_path); cnt++; } catch(e){} }
    db.prepare(`UPDATE messages SET file_path=NULL WHERE id=?`).run(r.id);
  });
  return cnt;
}

function subLabel(u) {
  if (!u) return "❓ Неизвестно";
  if (u.is_blocked) return "🚫 Заблокирован";
  const l = { free:"🆓 Бесплатный", trial:"🎁 Пробный", starter:"🌟 Starter",
               basic:"💎 Basic", pro:"💼 Pro", premium:"👑 Premium", ultimate:"♾️ Ultimate" };
  let base = l[u.subscription_type] || "❓";
  if (!["free","ultimate"].includes(u.subscription_type) && u.subscription_expires) {
    const left = Math.max(0, Math.ceil((new Date(u.subscription_expires) - Date.now()) / 86400000));
    base += ` (${left} д.)`;
  }
  return base;
}

// ================================================================
//  СКАЧИВАНИЕ МЕДИА
// ================================================================
async function downloadMedia(bot, fileId, fileUniqueId, mediaType, uid, hasTimer) {
  try {
    // Проверяем дубликат по file_unique_id
    if (fileUniqueId) {
      const existing = db.prepare(`SELECT file_path FROM messages WHERE file_unique_id=? AND file_path IS NOT NULL LIMIT 1`).get(fileUniqueId);
      if (existing && fs.existsSync(existing.file_path)) return existing.file_path;
    }

    const file = await bot.api.getFile(fileId);
    if (!file.file_path) throw new Error("file_path empty");
    const url  = `https://api.telegram.org/file/bot${MON_TOKEN}/${file.file_path}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const ext  = path.extname(file.file_path) || exts[mediaType] || ".bin";
    const dir  = path.join("media", String(uid));
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive:true });
    const pref = hasTimer ? "timer_" : "";
    const hash = crypto.createHash("md5").update(fileId).digest("hex").slice(0, 8);
    const fp   = path.join(dir, `${pref}${mediaType}_${Date.now()}_${hash}${ext}`);
    fs.writeFileSync(fp, Buffer.from(await resp.arrayBuffer()));
    console.log(`[MEDIA] Скачано: ${fp}`);
    return fp;
  } catch(e) {
    console.warn(`[MEDIA] Не удалось скачать ${mediaType} ${fileId}: ${e.message}`);
    return null;
  }
}

const exts = { photo:".jpg", video:".mp4", video_note:".mp4", audio:".ogg", voice:".ogg", document:"", sticker:".webp", animation:".gif" };

// ================================================================
//  ЭКСПОРТ ДАННЫХ
// ================================================================
async function exportHTML(uid, msgs, title) {
  const dir = path.join("exports", String(uid));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive:true });
  const fp = path.join(dir, `export_${Date.now()}.html`);
  const icons = { photo:"📸",video:"🎬",voice:"🎤",audio:"🎵",video_note:"🎥",document:"📄",sticker:"🎭",animation:"🎬" };
  let rows = "";
  msgs.forEach(m => {
    const sndr = escHtml(m.sender_name || m.sender_username || `#${m.sender_id}`);
    const txt  = escHtml((m.text || m.caption || "").slice(0, 300));
    const mt   = m.media_type ? icons[m.media_type] || "📎" : "";
    const flags = `${m.has_timer ? "⏱" : ""}${m.is_deleted ? "🗑" : ""}${m.is_edited ? "✏️" : ""}${m.is_scam ? "⚠️" : ""}`;
    rows += `<tr><td>${(m.created_at||"").slice(0,16)}</td><td>${sndr}</td><td>${txt}</td><td>${mt}</td><td>${flags}</td><td>${m.category||""}</td></tr>\n`;
  });
  const html = `<!DOCTYPE html><html><head><meta charset='utf-8'><title>${escHtml(title)}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,sans-serif;background:#0d1117;color:#c9d1d9;padding:24px}
h1{color:#58a6ff;margin-bottom:8px;font-size:1.4em}
.meta{color:#8b949e;font-size:.85em;margin-bottom:20px}
table{border-collapse:collapse;width:100%;font-size:.85em}
th{background:#161b22;color:#8b949e;padding:10px 12px;text-align:left;font-weight:600;border-bottom:1px solid #30363d}
td{padding:9px 12px;border-bottom:1px solid #21262d;max-width:400px;word-break:break-word}
tr:hover td{background:#161b22}
</style></head><body>
<h1>📁 ${escHtml(title)}</h1>
<div class='meta'>Экспорт: ${new Date().toLocaleString("ru-RU")} | Записей: ${msgs.length}</div>
<table>
<tr><th>Дата</th><th>Отправитель</th><th>Текст</th><th>Тип</th><th>События</th><th>Категория</th></tr>
${rows}
</table></body></html>`;
  fs.writeFileSync(fp, html, "utf-8");
  return fp;
}

function escHtml(s) { return (s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

async function exportCSV(uid, msgs) {
  const dir = path.join("exports", String(uid));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive:true });
  const fp = path.join(dir, `export_${Date.now()}.csv`);
  const fields = ["created_at","sender_name","sender_username","text","media_type",
                  "has_timer","is_deleted","deleted_at","is_edited","original_text","category","importance"];
  const header = fields.join(",") + "\n";
  const rows = msgs.map(m => fields.map(f => `"${(m[f]===null||m[f]===undefined?"":String(m[f])).replace(/"/g,'""')}"`).join(",")).join("\n");
  fs.writeFileSync(fp, "\uFEFF" + header + rows, "utf-8");
  return fp;
}

async function exportJSON(uid, msgs) {
  const dir = path.join("exports", String(uid));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive:true });
  const fp = path.join(dir, `export_${Date.now()}.json`);
  fs.writeFileSync(fp, JSON.stringify(msgs, null, 2), "utf-8");
  return fp;
}

async function buildZIP(uid, chatId, msgs, chatTitle) {
  try {
    const archiver = require("archiver");
    const dir = path.join("exports", String(uid));
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive:true });
    const fp = path.join(dir, `chat_${chatId}_${Date.now()}.zip`);
    return await new Promise((resolve, reject) => {
      const output  = fs.createWriteStream(fp);
      const archive = archiver("zip", { zlib:{ level:9 } });
      archive.on("error", reject);
      output.on("close", () => resolve(fp));
      archive.pipe(output);

      // Текстовый отчёт
      const sep = "─".repeat(60);
      let txt = `Мессенджер: Telegram\nЧат: ${chatTitle}\nВладелец: User#${uid}\n`;
      txt += `Дата экспорта: ${new Date().toLocaleString("ru-RU")}\nСообщений: ${msgs.length}\n${sep}\n\n`;
      msgs.forEach((m, i) => {
        const ts   = (m.created_at || "").slice(0, 16).replace("T", " ");
        const from = m.sender_name || m.sender_username || `User#${m.sender_id}`;
        const flags = [m.is_deleted?"УДАЛЕНО":"", m.is_edited?"ИЗМЕНЕНО":"", m.has_timer?"ТАЙМЕР":""].filter(Boolean).join(", ");
        txt += `[${ts}] ${from}${flags ? ` (${flags})` : ""}:\n`;
        if (m.text)         txt += m.text + "\n";
        else if (m.caption) txt += `[${(m.media_type||"?").toUpperCase()}] ${m.caption}\n`;
        else if (m.media_type) txt += `[${m.media_type.toUpperCase()}]\n`;
        if (m.original_text) txt += `  ↳ Оригинал: ${m.original_text.slice(0,200)}\n`;
        txt += "\n";
      });
      archive.append(Buffer.from(txt, "utf-8"), { name:"dialog.txt" });

      // Медиафайлы
      let fileIdx = 0;
      msgs.forEach(m => {
        if (m.file_path && fs.existsSync(m.file_path)) {
          fileIdx++;
          archive.file(m.file_path, { name:`media/file_${fileIdx}${path.extname(m.file_path)}` });
        }
      });

      archive.finalize();
    });
  } catch(e) {
    console.error("[ZIP]", e.message);
    return null;
  }
}

// ================================================================
//  AI ФУНКЦИИ
// ================================================================
async function aiRequest(messages, model) {
  if (!GROQ_KEY && !GEMINI_KEY) return null;
  if (GROQ_KEY) {
    try {
      const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method:"POST",
        headers:{ "Content-Type":"application/json", "Authorization":`Bearer ${GROQ_KEY}` },
        body: JSON.stringify({ model: model || "llama-3.3-70b-versatile", messages, max_tokens:1500, temperature:0.3 }),
        signal: AbortSignal.timeout(25000),
      });
      if (!r.ok) throw new Error(await r.text());
      return (await r.json()).choices[0].message.content;
    } catch(e) { console.warn("[AI Groq]", e.message); }
  }
  if (GEMINI_KEY) {
    try {
      const contents = messages.filter(m => m.role !== "system").map(m => ({ role: m.role==="assistant"?"model":"user", parts:[{text:m.content}] }));
      const sysMsg   = messages.find(m => m.role === "system");
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`, {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({
          system_instruction: sysMsg ? { parts:[{text:sysMsg.content}] } : undefined,
          contents,
          generationConfig:{ maxOutputTokens:1500, temperature:0.3 },
        }),
        signal: AbortSignal.timeout(25000),
      });
      if (!r.ok) throw new Error(await r.text());
      return (await r.json()).candidates[0].content.parts[0].text;
    } catch(e) { console.warn("[AI Gemini]", e.message); }
  }
  return null;
}

async function aiSummarize(msgs) {
  if (!msgs.length) return null;
  const lines = msgs.slice(-30).map(m => {
    const from = m.sender_name || `User#${m.sender_id}`;
    const text = m.text || m.caption || `[${m.media_type||"?"}]`;
    return `${from}: ${text.slice(0,150)}`;
  }).join("\n");
  return aiRequest([
    { role:"system", content:"Ты анализируешь переписку. Дай краткое резюме на русском языке (3-5 предложений): о чём переписка, какие ключевые темы, тон общения. Будь конкретен." },
    { role:"user",   content:`Переписка:\n${lines}\n\nДай резюме:` }
  ]);
}

async function checkAchievements(bot, uid) {
  const u = getUser(uid);
  if (!u) return;
  const conns = stmts.userConns.all(uid).length;
  const g = async (code, emoji, title) => {
    if (awardAch(uid, code)) {
      try { await bot.api.sendMessage(uid, `🏆 <b>Новое достижение!</b>\n\n${emoji} <b>${title}</b>`, { parse_mode:"HTML" }); } catch(e){}
    }
  };
  if (u.total_messages >= 1)     await g("first_msg",     "💬", "Первое сообщение");
  if (u.total_messages >= 100)   await g("msg_100",        "💬", "100 сообщений");
  if (u.total_messages >= 500)   await g("msg_500",        "💬", "500 сообщений");
  if (u.total_messages >= 1000)  await g("msg_1000",       "💬", "1 000 сообщений");
  if (u.total_messages >= 5000)  await g("msg_5000",       "💬", "5 000 сообщений");
  if (u.total_deletions >= 1)    await g("first_del",      "🗑",  "Первое удаление пойман");
  if (u.total_deletions >= 50)   await g("del_50",         "🗑",  "50 удалений поймано");
  if (u.total_media >= 1)        await g("first_media",    "📸", "Первое медиа сохранено");
  if (u.total_referrals >= 1)    await g("first_ref",      "👥", "Первый реферал");
  if (u.total_referrals >= 10)   await g("ref_10",         "👥", "10 рефералов");
  if (u.user_level >= 5)         await g("level_5",        "⭐", "Уровень 5");
  if (u.user_level >= 10)        await g("level_10",       "⭐", "Уровень 10");
  if (conns >= 1)                await g("connected",      "🔗", "Первое подключение Business API");
  const vips = db.prepare(`SELECT COUNT(*) c FROM vip_contacts WHERE user_id=?`).get(uid)?.c || 0;
  if (vips >= 3)                 await g("vip_collector",  "⭐", "3 VIP-контакта");
  if (["premium","ultimate"].includes(u.subscription_type)) await g("premium_user", "👑", "Premium-подписчик");
  if (u.subscription_type === "ultimate") await g("legend", "♾️", "Легенда");
}

// ================================================================
//  КЛАВИАТУРЫ
// ================================================================
const kbTerms = () => new InlineKeyboard()
  .text("✅ Принять условия", "accept_terms").row()
  .text("📄 Читать условия",  "show_terms");

function kbMain(uid) {
  // unused, kept for compatibility
  return kbMain2(uid);
}

function kbMain2(uid) {
  // Правильное построение клавиатуры с условной строкой
  const kb = new InlineKeyboard()
    .text("📊 Статистика",   "stats"      ).text("💎 Подписка",  "subscription").row()
    .text("⭐ Stars",        "my_stars"   ).text("👥 Рефералы",  "referrals"   ).row()
    .text("🔍 Поиск",        "search"     ).text("🗑 Удалённые", "last_deleted").row()
    .text("🌟 VIP-контакты", "vip_menu"   ).text("📈 Аналитика","analytics"   ).row()
    .text("🖼 Галерея",       "gallery"   ).text("📤 Экспорт",   "export_menu" ).row()
    .text("⚙️ Настройки",    "settings"  ).text("ℹ️ Помощь",   "help"        ).row()
    .text("💳 Оплаты",       "payments"  ).text("🏆 Достижения","achievements" );
  if (Number(uid) === ADMIN_ID) kb.row().text("👨‍💼 Админ-панель", "admin");
  return kb;
}

const kbBack = (to = "main_menu") => new InlineKeyboard().text("◀️ Назад", to);

const kbSub = () => new InlineKeyboard()
  .text(`🌟 Starter 7д — ${PLAN_STARS.starter} ⭐ (~${PLAN_RUB.starter}₽)`,   "buy_starter"  ).row()
  .text(`💎 Basic 1мес — ${PLAN_STARS.basic} ⭐ (~${PLAN_RUB.basic}₽)`,       "buy_basic"    ).row()
  .text(`💼 Pro 3мес — ${PLAN_STARS.pro} ⭐ (~${PLAN_RUB.pro}₽) 🔥`,          "buy_pro"      ).row()
  .text(`👑 Premium 1год — ${PLAN_STARS.premium} ⭐ (~${PLAN_RUB.premium}₽) 🔥`,"buy_premium" ).row()
  .text(`♾️ Ultimate навсегда — ${PLAN_STARS.ultimate} ⭐ 💥`,                  "buy_ultimate" ).row()
  .text("◀️ Назад", "main_menu");

function kbSettings(u) {
  const e = v => v ? "✅" : "❌";
  return new InlineKeyboard()
    .text(`${e(u.notify_deletions)} Удаления`,         "tg_notify_deletions" ).row()
    .text(`${e(u.notify_edits)} Редактирование`,       "tg_notify_edits"     ).row()
    .text(`${e(u.notify_timer)} Медиа с таймером`,     "tg_notify_timer"     ).row()
    .text(`${e(u.notify_scam)} Скам-детектор`,         "tg_notify_scam"      ).row()
    .text(`${e(u.notify_keywords)} Ключевые слова`,    "tg_notify_keywords"  ).row()
    .text(`${e(u.digest_enabled)} Ежедн. дайджест`,    "tg_digest_enabled"   ).row()
    .text("🧹 Очистить старые медиа",                  "cleanup_media"       ).row()
    .text("◀️ Назад", "main_menu");
}

const kbExport = () => new InlineKeyboard()
  .text("📄 HTML",  "exp_html").text("📋 CSV",  "exp_csv" ).row()
  .text("📦 JSON",  "exp_json").text("🗜 ZIP",  "exp_zip" ).row()
  .text("◀️ Назад", "main_menu");

const kbAnalytics = () => new InlineKeyboard()
  .text("🌡 Тепловая карта",  "an_heatmap" ).text("👤 Топ контактов", "an_contacts").row()
  .text("📂 По категориям",   "an_cats"    ).text("🔁 Дубликаты",     "an_dups"    ).row()
  .text("📅 Лента событий",   "an_timeline").text("📊 По источникам", "an_sources" ).row()
  .text("◀️ Назад", "main_menu");

const kbAdmin = () => new InlineKeyboard()
  .text("👥 Пользователи", "adm_users").text("📊 Статистика",  "adm_stats" ).row()
  .text("📢 Рассылка",     "adm_bcast").text("📈 Аналитика",   "adm_an"    ).row()
  .text("◀️ Назад", "main_menu");

function kbAdminUser(u) {
  return new InlineKeyboard()
    .text("🎁 Подарить подписку",       `adm_gift_${u.user_id}`        ).row()
    .text("⭐ +100 Stars",               `adm_stars_${u.user_id}`       ).row()
    .text(u.is_blocked ? "✅ Разблокировать" : "🚫 Заблокировать",
          (u.is_blocked ? "adm_unblock_" : "adm_block_") + u.user_id   ).row()
    .text("◀️ К списку", "adm_users");
}

function kbGift(uid) {
  return new InlineKeyboard()
    .text("🌟 7 дней",    `gft_${uid}_starter` ).text("💎 1 месяц", `gft_${uid}_basic`  ).row()
    .text("💼 3 месяца",  `gft_${uid}_pro`     ).text("👑 1 год",   `gft_${uid}_premium`).row()
    .text("♾️ Навсегда",  `gft_${uid}_ultimate`).row()
    .text("◀️ Назад", `adm_manage_${uid}`);
}

// ================================================================
//  СОСТОЯНИЯ
// ================================================================
const ST = {};
const setState  = (uid, s) => { ST[uid] = s; };
const getState  = uid => ST[uid] || null;
const clearState = uid => { delete ST[uid]; };

// ================================================================
//  УТИЛИТЫ
// ================================================================
function fmt(n) { return String(n || 0).replace(/\B(?=(\d{3})+(?!\d))/g, " "); }
function short(s, n) { s = (s || ""); return s.length > n ? s.slice(0, n) + "…" : s; }

async function sendLong(api, chatId, text, extra) {
  const MAX = 4000;
  if (text.length <= MAX) {
    try { await api.sendMessage(chatId, text, extra); } catch(e) {
      try { await api.sendMessage(chatId, text.replace(/[`*_[\]()~>#+=|{}.!-]/g, "\\$&"), extra); } catch(e2){}
    }
    return;
  }
  const chunks = [];
  let cur = "", inCode = false;
  for (const line of text.split("\n")) {
    if (line.startsWith("```")) inCode = !inCode;
    if (cur.length + line.length + 1 > MAX) {
      if (inCode) cur += "\n```";
      chunks.push(cur); cur = inCode ? "```\n" + line : line;
    } else { cur += (cur ? "\n" : "") + line; }
  }
  if (cur) chunks.push(cur);
  for (let i = 0; i < chunks.length; i++) {
    const isLast  = i === chunks.length - 1;
    const part    = chunks.length > 1 ? `*Часть ${i+1}/${chunks.length}*\n\n${chunks[i]}` : chunks[i];
    try { await api.sendMessage(chatId, part, isLast ? extra : { parse_mode:"Markdown" }); } catch(e){}
    if (!isLast) await new Promise(r => setTimeout(r, 700));
  }
}

// Отправить медиафайл по типу
async function sendFile(bot, chatId, fp, mt, caption) {
  const fsi  = new InputFile(fp);
  const cap  = caption || undefined;
  try {
    if      (mt === "photo")      await bot.api.sendPhoto(chatId, fsi, { caption:cap, parse_mode:"HTML" });
    else if (mt === "video")      await bot.api.sendVideo(chatId, fsi, { caption:cap, parse_mode:"HTML" });
    else if (mt === "video_note") await bot.api.sendVideoNote(chatId, fsi);
    else if (mt === "audio")      await bot.api.sendAudio(chatId, fsi, { caption:cap, parse_mode:"HTML" });
    else if (mt === "voice")      await bot.api.sendVoice(chatId, fsi, { caption:cap });
    else if (mt === "sticker")    await bot.api.sendSticker(chatId, fsi);
    else if (mt === "animation")  await bot.api.sendAnimation(chatId, fsi, { caption:cap });
    else                           await bot.api.sendDocument(chatId, fsi, { caption:cap, parse_mode:"HTML" });
    return true;
  } catch(e) {
    console.error("[sendFile]", mt, e.message);
    // Запасной вариант — через file_id
    return false;
  }
}

// ================================================================
//  MONITORING BOT
// ================================================================
const monBot = new Bot(MON_TOKEN);

// /start
monBot.command("start", async ctx => {
  const uid   = ctx.from.id;
  const parts = (ctx.message.text || "").split(" ");
  const refArg = parts[1] || null;
  const isNew  = addUser(uid, ctx.from.username, ctx.from.first_name, refArg);
  const u      = getUser(uid);
  if (!u) { await ctx.reply("❌ Ошибка. Попробуйте позже."); return; }
  if (u.is_blocked) { await ctx.reply("🚫 Аккаунт заблокирован.\nПо вопросам: @mrztn"); return; }

  if (!u.accepted_terms) {
    await ctx.reply(
      `👋 <b>MerAI — Monitoring & AI v9.0</b>\n\n` +
      `🔒 <b>Сохраняю всё, что удаляют:</b>\n` +
      `• Текстовые сообщения с оригиналом\n• Фото, видео, документы, аудио\n` +
      `• Видео-кружки и голосовые\n• <b>Медиа с таймером самоуничтожения ⏱</b>\n` +
      `• При удалении чата — ZIP-архив всей переписки\n\n` +
      `🤖 <b>AI-ассистент:</b> Пиши код, задавай вопросы\n\n` +
      `⚠️ Требуется <b>Telegram Premium</b> для подключения Business API\n\n` +
      `📋 Прочитайте условия использования:`,
      { parse_mode:"HTML", reply_markup:kbTerms() }
    );
    return;
  }
  const conn = stmts.userConns.all(uid);
  await ctx.reply(
    `👋 <b>С возвращением!</b>\n\n` +
    `💎 Подписка: ${subLabel(u)}\n` +
    `🔗 Подключений: ${conn.length}\n` +
    `⭐ Уровень ${u.user_level} | ${u.xp} XP\n` +
    `🏆 Достижений: ${u.achievement_count}\n` +
    `💬 Сохранено: ${fmt(u.total_messages)} | 🗑 ${fmt(u.total_deletions)} | ✏️ ${fmt(u.total_edits)}`,
    { parse_mode:"HTML", reply_markup:kbMain2(uid) }
  );
});

// Условия
monBot.callbackQuery("show_terms", async ctx => {
  await ctx.editMessageText(
    `📄 <b>Условия использования</b>\n\n` +
    `<b>Что делает бот:</b>\n` +
    `✅ Сохраняет ВСЕ сообщения из Business API\n` +
    `✅ При удалении — отправляет оригинал + файл\n` +
    `✅ При правке — показывает «Было / Стало»\n` +
    `✅ Медиа с таймером — перехватывает и сохраняет\n` +
    `✅ При удалении чата — ZIP-архив переписки\n\n` +
    `<b>Ограничения:</b>\n` +
    `❌ Секретные чаты — невозможно (Telegram шифрует)\n` +
    `❌ Групповые чаты — не поддерживает Business API\n` +
    `✅ Только <b>личные</b> чаты через Business API\n\n` +
    `<b>Тарифы:</b>\n` +
    `🎁 Пробный — 3 дня бесплатно (при подключении)\n` +
    `🌟 Starter — ${PLAN_STARS.starter} ⭐ (~${PLAN_RUB.starter}₽) / 7 дней\n` +
    `💎 Basic — ${PLAN_STARS.basic} ⭐ (~${PLAN_RUB.basic}₽) / мес\n` +
    `💼 Pro — ${PLAN_STARS.pro} ⭐ (~${PLAN_RUB.pro}₽) / 3 мес 🔥 −20%\n` +
    `👑 Premium — ${PLAN_STARS.premium} ⭐ (~${PLAN_RUB.premium}₽) / год 🔥 −33%\n` +
    `♾️ Ultimate — ${PLAN_STARS.ultimate} ⭐ навсегда 💥\n\n` +
    `💰 Покупка в рублях: @mrztn`,
    { parse_mode:"HTML", reply_markup:kbTerms() }
  );
  await ctx.answerCallbackQuery();
});

monBot.callbackQuery("accept_terms", async ctx => {
  const uid = ctx.from.id;
  updateUser(uid, { accepted_terms:1 });
  await ctx.editMessageText(
    `✅ <b>Условия приняты!</b>\n\n` +
    `<b>Как подключить мониторинг:</b>\n` +
    `1️⃣ Telegram → Настройки → Конфиденциальность\n` +
    `2️⃣ Чат-боты бизнес-аккаунта\n` +
    `3️⃣ Добавить чат-бота → @${ctx.me.username}\n` +
    `4️⃣ Нажмите «Подключить»\n\n` +
    `🎁 Пробный период <b>3 дня</b> активируется автоматически!\n` +
    `⚠️ Только Telegram Premium | Только личные чаты`,
    { parse_mode:"HTML", reply_markup:kbMain2(uid) }
  );
  try { await monBot.api.sendMessage(ADMIN_ID, `🎉 Новый пользователь: ${uid} @${ctx.from.username||"—"} (${ctx.from.first_name})`); } catch(e){}
  await ctx.answerCallbackQuery();
});

// Главное меню
monBot.callbackQuery("main_menu", async ctx => {
  const u = getUser(ctx.from.id);
  if (!u) { await ctx.answerCallbackQuery("❌"); return; }
  try {
    await ctx.editMessageText(
      `🏠 <b>Главное меню</b>\n\n💎 ${subLabel(u)}\n⭐ Ур. ${u.user_level} | ${fmt(u.xp)} XP`,
      { parse_mode:"HTML", reply_markup:kbMain2(ctx.from.id) }
    );
  } catch(e){}
  await ctx.answerCallbackQuery();
});

// Статистика
monBot.callbackQuery("stats", async ctx => {
  const uid = ctx.from.id;
  const u   = getUser(uid);
  if (!u) { await ctx.answerCallbackQuery("❌"); return; }
  const conns = stmts.userConns.all(uid);
  const vips  = getVipList(uid).length;
  const nextLvlXp = u.user_level * u.user_level * 100;
  const toNext = Math.max(0, nextLvlXp - u.xp);
  await ctx.editMessageText(
    `📊 <b>Ваша статистика</b>\n\n` +
    `<b>Подписка:</b> ${subLabel(u)}\n` +
    `<b>Уровень:</b> ${u.user_level} ⭐ (${fmt(u.xp)} XP / ${toNext} до след.)\n` +
    `<b>Достижений:</b> ${u.achievement_count} 🏆\n\n` +
    `🔗 Подключений: ${conns.length}\n` +
    `💬 Сохранено сообщений: <b>${fmt(u.total_messages)}</b>\n` +
    `🗑 Поймано удалений: <b>${fmt(u.total_deletions)}</b>\n` +
    `✏️ Поймано правок: <b>${fmt(u.total_edits)}</b>\n` +
    `📸 Медиафайлов: <b>${fmt(u.total_media)}</b>\n` +
    `🌟 VIP-контактов: <b>${vips}</b>\n\n` +
    `⭐ Stars-баланс: ${u.stars_balance}\n` +
    `👥 Рефералов: ${u.total_referrals} (${u.referral_earnings} ⭐)`,
    { parse_mode:"HTML", reply_markup:kbBack() }
  );
  await ctx.answerCallbackQuery();
});

// Подписка
monBot.callbackQuery("subscription", async ctx => {
  const u = getUser(ctx.from.id);
  await ctx.editMessageText(
    `💎 <b>Подписка</b>\n\n` +
    `<b>Статус:</b> ${subLabel(u)}\n` +
    `<b>Stars-баланс:</b> ${u?.stars_balance || 0} ⭐\n\n` +
    `<b>Тарифы:</b>\n` +
    `🎁 Пробный — 3 дня бесплатно\n` +
    `🌟 Starter — ${PLAN_STARS.starter} ⭐ / 7 дней\n` +
    `💎 Basic — ${PLAN_STARS.basic} ⭐ / месяц\n` +
    `💼 Pro — ${PLAN_STARS.pro} ⭐ / 3 мес 🔥 −20%\n` +
    `👑 Premium — ${PLAN_STARS.premium} ⭐ / год 🔥 −33%\n` +
    `♾️ Ultimate — ${PLAN_STARS.ultimate} ⭐ навсегда 💥\n\n` +
    `💰 В рублях: @mrztn`,
    { parse_mode:"HTML", reply_markup:kbSub() }
  );
  await ctx.answerCallbackQuery();
});

// Покупка
monBot.callbackQuery(/^buy_(.+)$/, async ctx => {
  const plan = ctx.match[1];
  if (!PLAN_STARS[plan]) { await ctx.answerCallbackQuery("❌"); return; }
  const stars = PLAN_STARS[plan];
  const label = PLAN_LABEL[plan];
  try {
    await ctx.api.sendInvoice(
      ctx.from.id, label,
      `Мониторинг сообщений MerAI — ${label}`,
      `sub_${plan}_${ctx.from.id}`,
      "", "XTR",
      [{ label, amount:stars }],
      { reply_markup:{ inline_keyboard:[[{ text:`💳 Оплатить ${stars} ⭐`, pay:true }]] } }
    );
    await ctx.answerCallbackQuery("✅ Инвойс создан");
  } catch(e) {
    await ctx.answerCallbackQuery("❌ Ошибка: " + e.message.slice(0,50), { show_alert:true });
  }
});

monBot.on("pre_checkout_query", async ctx => ctx.answerPreCheckoutQuery(true));

monBot.on("message:successful_payment", async ctx => {
  const uid  = ctx.from.id;
  const pay  = ctx.message.successful_payment;
  const parts = (pay.invoice_payload || "").split("_");
  const plan  = parts[1];
  const stars = pay.total_amount;
  if (!plan || !PLAN_STARS[plan]) return;
  savePayment(uid, stars, plan);
  activateSub(uid, plan);
  processRef(uid, stars);
  addXp(uid, PLAN_XP[plan] || 200);
  const u = getUser(uid);
  await ctx.reply(
    `🎉 <b>Оплата успешна!</b>\n\n<b>Тариф:</b> ${subLabel(u)}\n<b>Оплачено:</b> ${stars} ⭐\n<b>+${PLAN_XP[plan]} XP</b>\n\nСпасибо! 🙏`,
    { parse_mode:"HTML", reply_markup:kbMain2(uid) }
  );
  await checkAchievements(monBot, uid);
  try { await monBot.api.sendMessage(ADMIN_ID, `💰 Платёж!\n${uid} @${ctx.from.username||"—"}\nПлан: ${plan}\n${stars} ⭐`); } catch(e){}
});

// Stars
monBot.callbackQuery("my_stars", async ctx => {
  const u = getUser(ctx.from.id);
  await ctx.editMessageText(
    `⭐ <b>Telegram Stars</b>\n\n` +
    `<b>Баланс:</b> ${u?.stars_balance || 0} ⭐\n` +
    `<b>Реф. заработок:</b> ${u?.referral_earnings || 0} ⭐\n\n` +
    `Stars зарабатываются:\n• Реферальные бонусы (20% с платежа друга)\n• Подарки от администратора\n\n` +
    `Используются для продления подписки.\n\nПополнить — покупка через /sub или @mrztn`,
    { parse_mode:"HTML", reply_markup:kbBack() }
  );
  await ctx.answerCallbackQuery();
});

// Рефералы
monBot.callbackQuery("referrals", async ctx => {
  const uid = ctx.from.id;
  const u   = getUser(uid);
  const refs = db.prepare(`SELECT user_id,first_name,username,subscription_type FROM users WHERE referred_by=? ORDER BY registered_at DESC LIMIT 10`).all(uid);
  const link = `https://t.me/${ctx.me.username}?start=${u?.referral_code || ""}`;
  const emoj = { free:"🆓",trial:"🎁",starter:"🌟",basic:"💎",pro:"💼",premium:"👑",ultimate:"♾️" };
  let text = `👥 <b>Реферальная программа</b>\n\n` +
    `<b>Ваша ссылка:</b>\n<code>${link}</code>\n\n` +
    `Приглашено: <b>${u?.total_referrals || 0}</b>\nЗаработано: <b>${u?.referral_earnings || 0} ⭐</b>\n\n` +
    `<b>Как работает:</b>\n1. Поделитесь ссылкой\n2. Друг регистрируется\n3. Вы получаете <b>20%</b> с его платежей навсегда\n\n<b>Ваши рефералы:</b>\n`;
  if (refs.length) refs.forEach((r, i) => { text += `${i+1}. ${emoj[r.subscription_type]||"❓"} ${r.first_name || "?"} ${r.username ? "@"+r.username : ""}\n`; });
  else text += "Пока никого нет.";
  await ctx.editMessageText(text, { parse_mode:"HTML", reply_markup:kbBack() });
  await ctx.answerCallbackQuery();
});

// Поиск
monBot.callbackQuery("search", async ctx => {
  setState(ctx.from.id, "search");
  await ctx.editMessageText(
    `🔍 <b>Умный поиск</b>\n\nВведите запрос. Поддерживаются фильтры:\n\n` +
    `<code>привет #фото</code> — только фото\n` +
    `<code>встреча #работа</code> — категория\n` +
    `<code>текст #удалённые</code> — только удалённые\n` +
    `<code>текст #таймер</code> — медиа с таймером\n` +
    `<code>текст #от:username</code> — от конкретного человека`,
    { parse_mode:"HTML", reply_markup:new InlineKeyboard().text("❌ Отмена", "main_menu") }
  );
  await ctx.answerCallbackQuery();
});

// Последние удалённые
monBot.callbackQuery("last_deleted", async ctx => {
  const uid  = ctx.from.id;
  const msgs = getLastDeleted(uid, 10);
  let text   = `🗑 <b>Последние 10 удалённых</b>\n\n`;
  if (!msgs.length) { text += "Удалённых сообщений нет."; }
  else {
    const icons = { photo:"📸",video:"🎬",voice:"🎤",audio:"🎵",video_note:"🎥",document:"📄",sticker:"🎭" };
    msgs.forEach((m, i) => {
      const ts   = (m.deleted_at || m.created_at || "").slice(0, 16).replace("T"," ");
      const from = m.sender_name || m.sender_username || `#${m.sender_id}`;
      const snip = short(m.text || m.caption || "", 80);
      const mt   = m.media_type ? (icons[m.media_type]||"📎") : "";
      const timer = m.has_timer ? " ⏱" : "";
      const vipMark = isVip(uid, m.sender_id) ? " 🌟" : "";
      text += `${i+1}. <b>${from}</b>${vipMark}${timer}${mt ? " "+mt : ""}\n   ${ts}\n${snip ? "   "+snip+"\n" : ""}\n`;
    });
  }
  await ctx.editMessageText(text, { parse_mode:"HTML", reply_markup:new InlineKeyboard()
    .text("🔄 Обновить", "last_deleted").row().text("◀️ Назад", "main_menu") });
  await ctx.answerCallbackQuery();
});

// VIP контакты
monBot.callbackQuery("vip_menu", async ctx => {
  const uid  = ctx.from.id;
  const vips = getVipList(uid);
  let text   = `🌟 <b>VIP-контакты</b>\n\nVIP-контакты получают приоритетные уведомления 🔴\n\n`;
  if (vips.length) {
    vips.forEach((v, i) => {
      text += `${i+1}. <b>${v.sender_name || "?"}</b> (ID: <code>${v.sender_id}</code>)`;
      if (v.note) text += `\n   📝 ${v.note}`;
      text += "\n\n";
    });
    text += `\n<b>Удалить:</b> <code>/unvip ID</code>`;
  } else {
    text += `VIP-контактов нет.\n\nДобавить: <code>/vip ID</code>\nПосле удаления сообщения от VIP-контакта\nпоявятся кнопки быстрого добавления.`;
  }
  await ctx.editMessageText(text, { parse_mode:"HTML", reply_markup:new InlineKeyboard()
    .text("➕ Добавить VIP", "vip_add").row().text("◀️ Назад", "main_menu") });
  await ctx.answerCallbackQuery();
});

monBot.callbackQuery("vip_add", async ctx => {
  setState(ctx.from.id, "vip_add");
  await ctx.editMessageText(
    `🌟 Введите Telegram ID для добавления в VIP:\n\n<i>ID можно узнать при поиске — он показывается в результатах.</i>`,
    { parse_mode:"HTML", reply_markup:new InlineKeyboard().text("❌ Отмена", "vip_menu") }
  );
  await ctx.answerCallbackQuery();
});

// Быстрые действия: добавить VIP из уведомления об удалении
monBot.callbackQuery(/^qa_vip_(\d+)$/, async ctx => {
  const senderId = parseInt(ctx.match[1]);
  const uid      = ctx.from.id;
  const msg      = db.prepare(`SELECT sender_name,sender_username FROM messages WHERE user_id=? AND sender_id=? LIMIT 1`).get(uid, senderId);
  addVip(uid, senderId, msg?.sender_name || null, null);
  await ctx.answerCallbackQuery(`✅ ${msg?.sender_name || senderId} добавлен в VIP!`, { show_alert:true });
  try { await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard().text("🗑 Удалить из VIP", `qa_unvip_${senderId}`) }); } catch(e){}
});

monBot.callbackQuery(/^qa_unvip_(\d+)$/, async ctx => {
  removeVip(ctx.from.id, parseInt(ctx.match[1]));
  await ctx.answerCallbackQuery("❌ Удалён из VIP");
  try { await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard().text("🌟 Добавить VIP", `qa_vip_${ctx.match[1]}`) }); } catch(e){}
});

monBot.callbackQuery(/^qa_profile_(\d+)$/, async ctx => {
  const uid      = ctx.from.id;
  const senderId = parseInt(ctx.match[1]);
  const p = getContactProfile(uid, senderId);
  if (!p) { await ctx.answerCallbackQuery("Нет данных"); return; }
  const vipMark = p.vip ? " 🌟 VIP" : "";
  await ctx.answerCallbackQuery();
  await monBot.api.sendMessage(uid,
    `👤 <b>Профиль: ${p.sender_name || "?"}${vipMark}</b>\n` +
    `ID: <code>${senderId}</code>${p.sender_username ? "\n@" + p.sender_username : ""}\n\n` +
    `💬 Всего сообщений: ${p.total || 0}\n` +
    `🗑 Удалений: ${p.deleted || 0}\n✏️ Правок: ${p.edited || 0}\n` +
    `⏱ Таймер-медиа: ${p.timers || 0}\n⚠️ Скам: ${p.scam_count || 0}\n\n` +
    `📅 Первое: ${(p.first_msg||"").slice(0,10)}\n📅 Последнее: ${(p.last_msg||"").slice(0,10)}`,
    { parse_mode:"HTML",
      reply_markup: new InlineKeyboard()
        .text(p.vip ? "❌ Убрать VIP" : "🌟 Добавить VIP", p.vip ? `qa_unvip_${senderId}` : `qa_vip_${senderId}`)
        .text("🔍 Поиск по нему", `sender_search_${senderId}`) }
  );
});

monBot.callbackQuery(/^sender_search_(\d+)$/, async ctx => {
  const uid      = ctx.from.id;
  const senderId = parseInt(ctx.match[1]);
  const msgs = getMsgsBySender(uid, senderId, 10);
  let text = `🔍 <b>Сообщения от User#${senderId}</b> (${msgs.length}):\n\n`;
  const icons = { photo:"📸",video:"🎬",voice:"🎤",audio:"🎵",video_note:"🎥",document:"📄",sticker:"🎭" };
  msgs.forEach(m => {
    const ts   = (m.created_at||"").slice(0,16).replace("T"," ");
    const snip = short(m.text||m.caption||"", 60);
    const mt   = m.media_type ? icons[m.media_type]||"📎" : "";
    const fl   = `${m.is_deleted?"🗑":""}${m.is_edited?"✏️":""}${m.has_timer?"⏱":""}`;
    text += `${fl}${mt ? mt+" " : ""}[${ts}]\n${snip ? snip+"\n" : ""}\n`;
  });
  if (!msgs.length) text += "Сообщений нет.";
  await ctx.answerCallbackQuery();
  await monBot.api.sendMessage(uid, text, { parse_mode:"HTML" });
});

// Аналитика
monBot.callbackQuery("analytics", async ctx => {
  await ctx.editMessageText("📈 <b>Аналитика</b>\n\nВыберите раздел:", { parse_mode:"HTML", reply_markup:kbAnalytics() });
  await ctx.answerCallbackQuery();
});

monBot.callbackQuery("an_heatmap", async ctx => {
  const hm   = getHeatmap(ctx.from.id);
  const days = ["Пн","Вт","Ср","Чт","Пт","Сб","Вс"];
  let text   = "🌡 <b>Тепловая карта активности</b>\n\n<code>";
  text += "     " + [0,6,12,18].map(h => String(h).padStart(2,"0")+"ч").join("    ") + "\n";
  for (let d = 1; d <= 7; d++) {
    const di = d % 7;
    let row  = days[d-1] + " ";
    for (let hg = 0; hg < 24; hg += 6) {
      const val = [0,1,2,3,4,5].reduce((s,o) => s + (hm[di]?.[hg+o]||0), 0);
      row += val===0?"·  ":val<5?"▪  ":val<15?"▬  ":"█  ";
    }
    text += row + "\n";
  }
  text += "</code>\n· =0   ▪ =1–4   ▬ =5–14   █ =15+";
  await ctx.editMessageText(text, { parse_mode:"HTML", reply_markup:kbBack("analytics") });
  await ctx.answerCallbackQuery();
});

monBot.callbackQuery("an_contacts", async ctx => {
  const cts  = getTopContacts(ctx.from.id);
  let text   = "👤 <b>Топ контактов</b>\n\n";
  if (!cts.length) { text += "Данных пока нет."; }
  else cts.forEach((c, i) => {
    const name = c.sender_name || c.sender_username || `#${c.sender_id}`;
    const vipM = isVip(ctx.from.id, c.sender_id) ? " 🌟" : "";
    text += `${i+1}. <b>${name}</b>${vipM}\n   💬 ${c.total} | 🗑 ${c.deleted||0} | ⏱ ${c.timers||0}\n\n`;
  });
  await ctx.editMessageText(text, { parse_mode:"HTML", reply_markup:kbBack("analytics") });
  await ctx.answerCallbackQuery();
});

monBot.callbackQuery("an_cats", async ctx => {
  const stats = getCatStats(ctx.from.id);
  const total = stats.reduce((s, r) => s + r.cnt, 0) || 1;
  const emoj  = { "Работа":"💼","Финансы":"💰","Ссылки":"🔗","Вопросы":"❓","Личное":"❤️" };
  let text    = "📂 <b>По категориям</b>\n\n";
  if (!stats.length) { text += "Данных нет."; }
  else stats.forEach(r => {
    const pct = Math.round(r.cnt / total * 100);
    const bar = "█".repeat(Math.round(pct/10)) + "░".repeat(10-Math.round(pct/10));
    text += `${emoj[r.category]||"📁"} <b>${r.category}</b>: ${r.cnt} (${pct}%)\n${bar}\n\n`;
  });
  await ctx.editMessageText(text, { parse_mode:"HTML", reply_markup:kbBack("analytics") });
  await ctx.answerCallbackQuery();
});

monBot.callbackQuery("an_dups", async ctx => {
  const dups = getDuplicateMedia(ctx.from.id);
  let text   = "🔁 <b>Дубликаты медиа</b>\n\n";
  if (!dups.length) { text += "Дубликатов не найдено — отлично!"; }
  else dups.forEach(d => {
    text += `• ${d.media_type} (${d.cnt}×)\n  Первый: ${(d.first_seen||"").slice(0,10)}\n\n`;
  });
  await ctx.editMessageText(text, { parse_mode:"HTML", reply_markup:kbBack("analytics") });
  await ctx.answerCallbackQuery();
});

monBot.callbackQuery("an_timeline", async ctx => {
  const tl   = getTimeline(ctx.from.id, 15);
  let text   = "📅 <b>Лента событий</b>\n\n";
  if (!tl.length) { text += "События пока отсутствуют."; }
  else {
    const icons = { photo:"📸",video:"🎬",voice:"🎤",audio:"🎵",video_note:"🎥",document:"📄",sticker:"🎭" };
    tl.forEach(m => {
      const ts   = (m.deleted_at||m.edited_at||m.created_at||"").slice(0,16).replace("T"," ");
      const from = m.sender_name || m.sender_username || `#${m.sender_id}`;
      const ev   = m.is_deleted ? "🗑 Удалено" : "✏️ Изменено";
      const mt   = m.media_type ? " " + (icons[m.media_type]||"📎") : "";
      const snip = short(m.original_text||m.text||m.caption||"", 50);
      text += `${ev}${m.has_timer?" ⏱":""} · ${ts}\n<b>${from}</b>${mt}\n${snip ? snip+"\n" : ""}\n`;
    });
  }
  await ctx.editMessageText(text, { parse_mode:"HTML", reply_markup:kbBack("analytics") });
  await ctx.answerCallbackQuery();
});

monBot.callbackQuery("an_sources", async ctx => {
  const uid  = ctx.from.id;
  const byScam   = db.prepare(`SELECT COUNT(*) c FROM messages WHERE user_id=? AND is_scam=1`).get(uid)?.c||0;
  const byVip    = db.prepare(`SELECT COUNT(*) c FROM messages m JOIN vip_contacts v ON m.user_id=v.user_id AND m.sender_id=v.sender_id WHERE m.user_id=?`).get(uid)?.c||0;
  const byTimer  = db.prepare(`SELECT COUNT(*) c FROM messages WHERE user_id=? AND has_timer=1`).get(uid)?.c||0;
  const byLink   = db.prepare(`SELECT COUNT(*) c FROM messages WHERE user_id=? AND has_links=1`).get(uid)?.c||0;
  const byEdit   = db.prepare(`SELECT COUNT(*) c FROM messages WHERE user_id=? AND is_edited=1`).get(uid)?.c||0;
  const byDel    = db.prepare(`SELECT COUNT(*) c FROM messages WHERE user_id=? AND is_deleted=1`).get(uid)?.c||0;
  await ctx.editMessageText(
    `📊 <b>Дополнительная статистика</b>\n\n` +
    `⏱ Медиа с таймером: ${byTimer}\n🔗 Сообщений со ссылками: ${byLink}\n` +
    `✏️ Изменено: ${byEdit}\n🗑 Удалено: ${byDel}\n` +
    `⚠️ Скам-попытки: ${byScam}\n🌟 От VIP-контактов: ${byVip}`,
    { parse_mode:"HTML", reply_markup:kbBack("analytics") }
  );
  await ctx.answerCallbackQuery();
});

// Галерея
monBot.callbackQuery("gallery", async ctx => {
  const uid   = ctx.from.id;
  const all   = db.prepare(`SELECT media_type, COUNT(*) cnt FROM messages WHERE user_id=? AND media_type IS NOT NULL GROUP BY media_type`).all(uid);
  const icons = { photo:"📸",video:"🎬",voice:"🎤",audio:"🎵",video_note:"🎥",document:"📄",sticker:"🎭",animation:"🎬" };
  let text    = `🖼 <b>Медиагалерея</b>\n\n`;
  if (!all.length) { text += "Медиафайлов нет."; }
  else {
    all.forEach(r => { text += `${icons[r.media_type]||"📎"} ${r.media_type}: <b>${r.cnt}</b>\n`; });
    const timers = db.prepare(`SELECT COUNT(*) c FROM messages WHERE user_id=? AND has_timer=1`).get(uid)?.c||0;
    text += `\n⏱ Из них с таймером: <b>${timers}</b>`;
  }
  const kb = new InlineKeyboard()
    .text("📸 Фото", "gal_photo").text("🎬 Видео", "gal_video").row()
    .text("🎤 Голосовые", "gal_voice").text("⏱ Таймеры", "gal_timer").row()
    .text("◀️ Назад", "main_menu");
  await ctx.editMessageText(text, { parse_mode:"HTML", reply_markup:kb });
  await ctx.answerCallbackQuery();
});

["photo","video","voice","timer"].forEach(type => {
  monBot.callbackQuery(`gal_${type}`, async ctx => {
    const uid = ctx.from.id;
    let msgs;
    if (type === "timer") msgs = db.prepare(`SELECT * FROM messages WHERE user_id=? AND has_timer=1 ORDER BY created_at DESC LIMIT 15`).all(uid);
    else msgs = db.prepare(`SELECT * FROM messages WHERE user_id=? AND media_type=? ORDER BY created_at DESC LIMIT 15`).all(uid, type);
    const icons = { photo:"📸",video:"🎬",voice:"🎤",audio:"🎵",video_note:"🎥",document:"📄",sticker:"🎭" };
    let text = `${icons[type]||"⏱"} <b>${type==="timer"?"Медиа с таймерами":type} (${msgs.length})</b>:\n\n`;
    msgs.forEach(m => {
      const ts   = (m.created_at||"").slice(0,10);
      const from = m.sender_name||m.sender_username||`#${m.sender_id}`;
      const fl   = `${m.is_deleted?"🗑":"✅"}${m.has_timer?" ⏱":""}`;
      text += `${fl} [${ts}] <b>${from}</b>\n`;
    });
    if (!msgs.length) text += "Файлов нет.";
    await ctx.editMessageText(text, { parse_mode:"HTML", reply_markup:kbBack("gallery") });
    await ctx.answerCallbackQuery();
  });
});

// Экспорт
monBot.callbackQuery("export_menu", async ctx => {
  await ctx.editMessageText(
    "📤 <b>Экспорт данных</b>\n\nВыберите формат (последние 200 сообщений):\n\n" +
    "📄 HTML — красивая таблица\n📋 CSV — для Excel\n📦 JSON — полные данные\n🗜 ZIP — текст + все медиафайлы",
    { parse_mode:"HTML", reply_markup:kbExport() }
  );
  await ctx.answerCallbackQuery();
});

async function doExport(ctx, type) {
  const uid  = ctx.from.id;
  const msgs = searchMsgs(uid, { limit:200 });
  if (!msgs.length) { await ctx.answerCallbackQuery("Нет данных", { show_alert:true }); return; }
  await ctx.answerCallbackQuery("⏳ Создаю файл...");
  let fp;
  try {
    if      (type==="html") fp = await exportHTML(uid, msgs, "MerAI Export");
    else if (type==="csv")  fp = await exportCSV(uid, msgs);
    else if (type==="json") fp = await exportJSON(uid, msgs);
    else if (type==="zip")  fp = await buildZIP(uid, 0, msgs, "Full Export");
    if (fp && fs.existsSync(fp)) {
      const names = { html:"export.html", csv:"export.csv", json:"export.json", zip:"export.zip" };
      await ctx.api.sendDocument(uid, new InputFile(fp, names[type]), {
        caption: `✅ Экспорт готов (${msgs.length} записей)` });
    } else { await ctx.api.sendMessage(uid, "❌ Ошибка при создании файла."); }
  } catch(e) { await ctx.api.sendMessage(uid, "❌ " + e.message.slice(0,200)); }
}

monBot.callbackQuery("exp_html", ctx => doExport(ctx, "html"));
monBot.callbackQuery("exp_csv",  ctx => doExport(ctx, "csv"));
monBot.callbackQuery("exp_json", ctx => doExport(ctx, "json"));
monBot.callbackQuery("exp_zip",  ctx => doExport(ctx, "zip"));

// Настройки
monBot.callbackQuery("settings", async ctx => {
  const u = getUser(ctx.from.id);
  if (!u) { await ctx.answerCallbackQuery("❌"); return; }
  await ctx.editMessageText(
    "⚙️ <b>Настройки уведомлений</b>\n\n✅ включено  |  ❌ отключено\n\nНажмите для переключения:",
    { parse_mode:"HTML", reply_markup:kbSettings(u) }
  );
  await ctx.answerCallbackQuery();
});

monBot.callbackQuery(/^tg_(.+)$/, async ctx => {
  const field = ctx.match[1];
  const uid   = ctx.from.id;
  const u     = getUser(uid);
  if (!u) { await ctx.answerCallbackQuery("❌"); return; }
  const newVal = u[field] ? 0 : 1;
  updateUser(uid, { [field]: newVal });
  const u2 = getUser(uid);
  await ctx.answerCallbackQuery(newVal ? "✅ Включено" : "❌ Отключено");
  try { await ctx.editMessageReplyMarkup({ reply_markup:kbSettings(u2) }); } catch(e){}
});

monBot.callbackQuery("cleanup_media", async ctx => {
  const uid = ctx.from.id;
  const u   = getUser(uid);
  const cnt = cleanupOldMedia(uid, u?.cleanup_days || 90);
  await ctx.answerCallbackQuery(`🧹 Удалено файлов: ${cnt}`, { show_alert:true });
});

// Достижения
monBot.callbackQuery("achievements", async ctx => {
  const achs = getAchs(ctx.from.id);
  const labels = {
    first_msg:"💬 Первое сообщение",msg_100:"💬 100 сообщений",msg_500:"💬 500",msg_1000:"💬 1 000",msg_5000:"💬 5 000",
    first_del:"🗑 Первое удаление",del_50:"🗑 50 удалений",first_media:"📸 Первое медиа",
    first_ref:"👥 Первый реферал",ref_10:"👥 10 рефералов",
    level_5:"⭐ Уровень 5",level_10:"⭐ Уровень 10",
    connected:"🔗 Business подключён",vip_collector:"🌟 3 VIP-контакта",
    premium_user:"👑 Premium-подписчик",legend:"♾️ Легенда",
  };
  let text = `🏆 <b>Достижения</b> (${achs.length} шт.):\n\n`;
  if (!achs.length) text += "Пока нет. Начните использовать бота!";
  else achs.forEach(a => { text += `${labels[a.code]||a.code} — ${(a.unlocked_at||"").slice(0,10)}\n`; });
  await ctx.editMessageText(text, { parse_mode:"HTML", reply_markup:kbBack() });
  await ctx.answerCallbackQuery();
});

// История оплат
monBot.callbackQuery("payments", async ctx => {
  const pays = stmts.payments.all(ctx.from.id);
  let text   = "💳 <b>История платежей</b>\n\n";
  if (!pays.length) text += "Платежей нет.";
  else pays.forEach(p => { text += `• ${(p.created_at||"").slice(0,10)} — <b>${p.plan}</b> (${p.stars} ⭐)\n`; });
  await ctx.editMessageText(text, { parse_mode:"HTML", reply_markup:kbBack() });
  await ctx.answerCallbackQuery();
});

// Помощь
monBot.callbackQuery("help", async ctx => {
  await ctx.editMessageText(
    `ℹ️ <b>MerAI v9.0 — Справка</b>\n\n` +
    `<b>Что сохраняется:</b>\n` +
    `✅ Все текст, фото, видео, аудио, документы\n` +
    `✅ Голосовые, кружки (video_note), стикеры\n` +
    `✅ Медиа с таймером самоуничтожения ⏱\n` +
    `✅ Оригинал при редактировании\n` +
    `✅ ZIP-архив при удалении чата\n\n` +
    `<b>Уведомления:</b>\n` +
    `🗑 Удалено → текст + файл\n` +
    `✏️ Изменено → было / стало\n` +
    `⏱ Таймер-медиа → моментально\n` +
    `⚠️ Скам → предупреждение\n` +
    `🌟 VIP → приоритетный алерт 🔴\n\n` +
    `<b>Команды:</b>\n` +
    `/vip ID — добавить VIP-контакт\n/unvip ID — убрать VIP\n` +
    `/block ID — заблокировать отправителя\n/unblock ID — разблокировать\n` +
    `/summary — AI-резюме последних сообщений\n` +
    `/level — ваш уровень\n/ach — достижения\n\n` +
    `⚠️ Только личные чаты | Требуется Telegram Premium\n` +
    `❌ Секретные и группы — не поддерживаются\n\n` +
    `Поддержка: @mrztn`,
    { parse_mode:"HTML", reply_markup:kbBack() }
  );
  await ctx.answerCallbackQuery();
});

// ================================================================
//  ADMIN PANEL
// ================================================================
monBot.callbackQuery("admin", async ctx => {
  if (ctx.from.id !== ADMIN_ID) { await ctx.answerCallbackQuery("🚫 Нет доступа", { show_alert:true }); return; }
  const s = adminStats();
  await ctx.editMessageText(
    `👨‍💼 <b>Админ-панель v9.0</b>\n\n` +
    `👥 Пользователей: <b>${s.users}</b>\n💎 Активных: <b>${s.active}</b>\n\n` +
    `💬 Сообщений: ${fmt(s.messages)}\n🗑 Удалений: ${fmt(s.deleted)}\n✏️ Правок: ${fmt(s.edited)}\n` +
    `⏱ Таймер-медиа: ${fmt(s.timer)}\n💰 Stars собрано: ${fmt(s.stars)} ⭐`,
    { parse_mode:"HTML", reply_markup:kbAdmin() }
  );
  await ctx.answerCallbackQuery();
});

monBot.callbackQuery("adm_stats", async ctx => {
  if (ctx.from.id !== ADMIN_ID) { await ctx.answerCallbackQuery("🚫"); return; }
  const s = adminStats();
  const planEmoj = { free:"🆓",trial:"🎁",starter:"🌟",basic:"💎",pro:"💼",premium:"👑",ultimate:"♾️" };
  let planText = "";
  (s.byPlan||[]).forEach(r => { planText += `${planEmoj[r.t]||"?"} ${r.t}: ${r.c}\n`; });
  await ctx.editMessageText(
    `📊 <b>Детальная статистика</b>\n\n` +
    `👥 Всего пользователей: ${s.users}\n💎 Активных подписок: ${s.active}\n` +
    `💰 Платежей: ${s.payments} (${fmt(s.stars)} ⭐)\n🌟 VIP-контактов: ${s.vips}\n\n` +
    `<b>По планам:</b>\n${planText}\n` +
    `<b>Контент:</b>\n💬 ${fmt(s.messages)} сообщений\n🗑 ${fmt(s.deleted)} удалений\n` +
    `✏️ ${fmt(s.edited)} правок\n📸 ${fmt(s.media)} медиа\n⏱ ${fmt(s.timer)} таймер-медиа`,
    { parse_mode:"HTML", reply_markup:kbBack("admin") }
  );
  await ctx.answerCallbackQuery();
});

monBot.callbackQuery("adm_an", async ctx => {
  if (ctx.from.id !== ADMIN_ID) { await ctx.answerCallbackQuery("🚫"); return; }
  const top3 = db.prepare(`SELECT user_id,first_name,username,total_referrals,referral_earnings FROM users ORDER BY total_referrals DESC, referral_earnings DESC LIMIT 3`).all();
  const today = new Date().toISOString().slice(0,10);
  const todayMsgs = db.prepare(`SELECT COUNT(*) c FROM messages WHERE DATE(created_at)=?`).get(today)?.c||0;
  const todayUsers = db.prepare(`SELECT COUNT(*) c FROM users WHERE DATE(registered_at)=?`).get(today)?.c||0;
  let text = `📈 <b>Аналитика (Админ)</b>\n\nСегодня:\n📩 Новых сообщений: ${todayMsgs}\n👤 Новых пользователей: ${todayUsers}\n\n<b>Топ-3 партнёра:</b>\n`;
  top3.forEach((r,i) => { text += `${i+1}. ${r.first_name||`#${r.user_id}`}: ${r.total_referrals} реф. | ${r.referral_earnings} ⭐\n`; });
  await ctx.editMessageText(text, { parse_mode:"HTML", reply_markup:kbBack("admin") });
  await ctx.answerCallbackQuery();
});

monBot.callbackQuery("adm_users", async ctx => {
  if (ctx.from.id !== ADMIN_ID) { await ctx.answerCallbackQuery("🚫"); return; }
  await showUsersPage(ctx, 0);
  await ctx.answerCallbackQuery();
});

async function showUsersPage(ctx, page) {
  const PAGE   = 6;
  const users  = db.prepare(`SELECT * FROM users ORDER BY registered_at DESC LIMIT ? OFFSET ?`).all(PAGE, page * PAGE);
  const total  = db.prepare(`SELECT COUNT(*) c FROM users`).get().c;
  const pages  = Math.max(1, Math.ceil(total / PAGE));
  const emoj   = { free:"🆓",trial:"🎁",starter:"🌟",basic:"💎",pro:"💼",premium:"👑",ultimate:"♾️" };
  let text     = `👥 <b>Пользователи</b> (${page+1}/${pages})\n\n`;
  const kb     = new InlineKeyboard();
  users.forEach((u, i) => {
    const idx   = page * PAGE + i + 1;
    const bl    = u.is_blocked ? "🚫" : "";
    const nm    = short(u.first_name || `#${u.user_id}`, 15);
    text += `${idx}. ${bl}${emoj[u.subscription_type]||"?"} <b>${nm}</b> (@${u.username||"—"})\n`;
    text += `   💬 ${u.total_messages} | 🗑 ${u.total_deletions}\n\n`;
    kb.text(`${idx}. ${nm}`, `adm_manage_${u.user_id}`);
    if ((i+1) % 2 === 0) kb.row();
  });
  kb.row();
  if (page > 0) kb.text("◀️ Пред", `adm_pg_${page-1}`);
  if (page < pages-1) kb.text("▶️ След", `adm_pg_${page+1}`);
  kb.row().text("◀️ Назад", "admin");
  await ctx.editMessageText(text, { parse_mode:"HTML", reply_markup:kb });
}

monBot.callbackQuery(/^adm_pg_(\d+)$/, async ctx => {
  if (ctx.from.id !== ADMIN_ID) { await ctx.answerCallbackQuery("🚫"); return; }
  await showUsersPage(ctx, parseInt(ctx.match[1]));
  await ctx.answerCallbackQuery();
});

monBot.callbackQuery(/^adm_manage_(\d+)$/, async ctx => {
  if (ctx.from.id !== ADMIN_ID) { await ctx.answerCallbackQuery("🚫"); return; }
  const uid = parseInt(ctx.match[1]);
  const u   = getUser(uid);
  if (!u) { await ctx.answerCallbackQuery("❌ Не найден", { show_alert:true }); return; }
  const conns = stmts.userConns.all(uid).length;
  await ctx.editMessageText(
    `👤 <b>User #${uid}</b>\n\n` +
    `Имя: ${u.first_name || "—"}\nUsername: @${u.username || "—"}\n` +
    `Подписка: ${subLabel(u)}\nУровень: ${u.user_level} (${u.xp} XP)\n` +
    `Подключений: ${conns}\nСообщений: ${fmt(u.total_messages)}\n` +
    `Удалений: ${fmt(u.total_deletions)}\nStars: ${u.stars_balance} ⭐\n` +
    `Рефералов: ${u.total_referrals}\nРег.: ${(u.registered_at||"").slice(0,10)}\n` +
    `Заблокирован: ${u.is_blocked ? "ДА 🚫" : "нет"}`,
    { parse_mode:"HTML", reply_markup:kbAdminUser(u) }
  );
  await ctx.answerCallbackQuery();
});

monBot.callbackQuery(/^adm_block_(\d+)$/, async ctx => {
  if (ctx.from.id !== ADMIN_ID) { await ctx.answerCallbackQuery("🚫"); return; }
  const uid = parseInt(ctx.match[1]);
  updateUser(uid, { is_blocked:1 });
  await ctx.answerCallbackQuery("✅ Заблокирован");
  try { await monBot.api.sendMessage(uid, "🚫 Ваш аккаунт заблокирован администратором.\n\nПо вопросам: @mrztn"); } catch(e){}
  const u = getUser(uid);
  try { await ctx.editMessageReplyMarkup({ reply_markup:kbAdminUser(u) }); } catch(e){}
});

monBot.callbackQuery(/^adm_unblock_(\d+)$/, async ctx => {
  if (ctx.from.id !== ADMIN_ID) { await ctx.answerCallbackQuery("🚫"); return; }
  const uid = parseInt(ctx.match[1]);
  updateUser(uid, { is_blocked:0 });
  await ctx.answerCallbackQuery("✅ Разблокирован");
  try { await monBot.api.sendMessage(uid, "✅ Ваш аккаунт разблокирован! Добро пожаловать!"); } catch(e){}
  const u = getUser(uid);
  try { await ctx.editMessageReplyMarkup({ reply_markup:kbAdminUser(u) }); } catch(e){}
});

monBot.callbackQuery(/^adm_gift_(\d+)$/, async ctx => {
  if (ctx.from.id !== ADMIN_ID) { await ctx.answerCallbackQuery("🚫"); return; }
  const uid = parseInt(ctx.match[1]);
  const u   = getUser(uid);
  await ctx.editMessageText(
    `🎁 <b>Подарить подписку</b>\n\nПользователь: ${u?.first_name||"?"} (@${u?.username||"—"}) #${uid}`,
    { parse_mode:"HTML", reply_markup:kbGift(uid) }
  );
  await ctx.answerCallbackQuery();
});

monBot.callbackQuery(/^gft_(\d+)_(.+)$/, async ctx => {
  if (ctx.from.id !== ADMIN_ID) { await ctx.answerCallbackQuery("🚫"); return; }
  const uid  = parseInt(ctx.match[1]);
  const plan = ctx.match[2];
  activateSub(uid, plan);
  addXp(uid, PLAN_XP[plan]||100);
  await ctx.answerCallbackQuery(`✅ Подарено: ${plan}`);
  const u = getUser(uid);
  try { await monBot.api.sendMessage(uid, `🎁 <b>Подарок от администратора!</b>\n\nВам выдана подписка: <b>${subLabel(u)}</b> 🙏`, { parse_mode:"HTML" }); } catch(e){}
  await ctx.editMessageText(`✅ <b>${plan}</b> выдан пользователю #${uid}`, { parse_mode:"HTML", reply_markup:kbBack("adm_users") });
});

monBot.callbackQuery(/^adm_stars_(\d+)$/, async ctx => {
  if (ctx.from.id !== ADMIN_ID) { await ctx.answerCallbackQuery("🚫"); return; }
  setState(ADMIN_ID, `gift_stars_${ctx.match[1]}`);
  await ctx.editMessageText("⭐ Введите количество Stars:", { reply_markup:new InlineKeyboard().text("❌ Отмена", `adm_manage_${ctx.match[1]}`) });
  await ctx.answerCallbackQuery();
});

monBot.callbackQuery("adm_bcast", async ctx => {
  if (ctx.from.id !== ADMIN_ID) { await ctx.answerCallbackQuery("🚫"); return; }
  setState(ADMIN_ID, "broadcast");
  await ctx.editMessageText(
    "📢 <b>Рассылка</b>\n\nВведите сообщение для отправки всем пользователям:\n(HTML-разметка поддерживается)",
    { parse_mode:"HTML", reply_markup:new InlineKeyboard().text("❌ Отмена", "admin") }
  );
  await ctx.answerCallbackQuery();
});

// ================================================================
//  ОБРАБОТЧИК ТЕКСТОВЫХ СООБЩЕНИЙ (состояния + команды)
// ================================================================
monBot.on("message:text", async ctx => {
  const uid   = ctx.from.id;
  const text  = ctx.message.text || "";
  const state = getState(uid);
  if (text.startsWith("/")) return;
  if (!state) return;

  // Поиск
  if (state === "search") {
    clearState(uid);
    let q = text, mediaType = null, category = null, sender = null, deleted = false, timer = false;
    if (q.includes("#фото"))        { mediaType = "photo";      q = q.replace(/#фото/g,"").trim(); }
    if (q.includes("#видео"))       { mediaType = "video";      q = q.replace(/#видео/g,"").trim(); }
    if (q.includes("#кружок"))      { mediaType = "video_note"; q = q.replace(/#кружок/g,"").trim(); }
    if (q.includes("#голос"))       { mediaType = "voice";      q = q.replace(/#голос/g,"").trim(); }
    if (q.includes("#удалённые"))   { deleted = true;           q = q.replace(/#удалённые/g,"").trim(); }
    if (q.includes("#таймер"))      { timer = true;             q = q.replace(/#таймер/g,"").trim(); }
    for (const cat of Object.keys(CATS)) {
      const rx = new RegExp(`#${cat}`, "i");
      if (rx.test(q)) { category = cat; q = q.replace(rx,"").trim(); break; }
    }
    const fromM = q.match(/#от:@?(\S+)/);
    if (fromM) { sender = fromM[1]; q = q.replace(/#от:@?\S+/,"").trim(); }
    const results = searchMsgs(uid, { q:q||undefined, mediaType, category, sender, deleted, timer });
    if (!results.length) {
      await ctx.reply("🔍 Ничего не найдено.", { reply_markup:kbMain2(uid) }); return;
    }
    const icons = { photo:"📸",video:"🎬",voice:"🎤",audio:"🎵",video_note:"🎥",document:"📄",sticker:"🎭" };
    let reply = `🔍 <b>Результаты</b> (${results.length} шт.):\n\n`;
    results.slice(0,10).forEach(r => {
      const ts   = (r.created_at||"").slice(0,16).replace("T"," ");
      const from = r.sender_name||r.sender_username||`#${r.sender_id}`;
      const snip = short(r.text||r.caption||"", 70);
      const mt   = r.media_type ? icons[r.media_type]||"📎" : "";
      const fl   = `${r.is_deleted?"🗑":""}${r.is_edited?"✏️":""}${r.has_timer?"⏱":""}`;
      reply += `${fl}${mt ? " "+mt : ""} [${ts}] <b>${from}</b>\n${snip ? snip+"\n" : ""}ID: <code>${r.id}</code>\n\n`;
    });
    await ctx.reply(reply, { parse_mode:"HTML", reply_markup:kbMain2(uid) });
    return;
  }

  // Добавить VIP
  if (state === "vip_add") {
    clearState(uid);
    const sid = parseInt(text.trim());
    if (isNaN(sid)) { await ctx.reply("❌ Введите числовой ID."); return; }
    const existing = db.prepare(`SELECT sender_name FROM messages WHERE user_id=? AND sender_id=? LIMIT 1`).get(uid, sid);
    addVip(uid, sid, existing?.sender_name || null, null);
    await ctx.reply(`✅ <code>${sid}</code> добавлен в VIP-контакты!\n${existing?.sender_name ? "👤 "+existing.sender_name : ""}`, { parse_mode:"HTML", reply_markup:kbMain2(uid) });
    return;
  }

  // Gift Stars (admin)
  if (state && state.startsWith("gift_stars_")) {
    const targetUid = parseInt(state.split("_")[2]);
    clearState(uid);
    const stars = parseInt(text.trim());
    if (isNaN(stars)||stars<=0) { await ctx.reply("❌ Введите положительное число."); return; }
    const t = getUser(targetUid);
    if (t) updateUser(targetUid, { stars_balance: t.stars_balance + stars });
    try { await monBot.api.sendMessage(targetUid, `⭐ Администратор добавил вам ${stars} Stars!`); } catch(e){}
    await ctx.reply(`✅ +${stars} ⭐ пользователю #${targetUid}`, { reply_markup:kbAdmin() });
    return;
  }

  // Рассылка (admin)
  if (state === "broadcast" && uid === ADMIN_ID) {
    clearState(uid);
    const uids = db.prepare(`SELECT user_id FROM users WHERE is_blocked=0`).all().map(r => r.user_id);
    let ok = 0, fail = 0;
    await ctx.reply(`📢 Начинаю рассылку ${uids.length} пользователям...`);
    for (const id of uids) {
      try {
        await monBot.api.sendMessage(id, `📢 <b>Сообщение от администратора:</b>\n\n${text}`, { parse_mode:"HTML" });
        ok++;
      } catch(e) { fail++; }
      await new Promise(r => setTimeout(r, 50));
    }
    await ctx.reply(`✅ Рассылка завершена!\nДоставлено: ${ok}\nОшибок: ${fail}`, { reply_markup:kbAdmin() });
    return;
  }
});

// ================================================================
//  КОМАНДЫ
// ================================================================
monBot.command("help", async ctx => {
  await ctx.reply(
    `ℹ️ <b>MerAI v9.0 — Команды</b>\n\n` +
    `/start — главное меню\n` +
    `/vip ID — добавить VIP-контакт\n` +
    `/unvip ID — удалить из VIP\n` +
    `/block ID — блокировать отправителя\n` +
    `/unblock ID — разблокировать\n` +
    `/summary — AI-резюме последних диалогов\n` +
    `/level — ваш уровень и XP\n` +
    `/ach — ваши достижения\n\n` +
    `Поддержка: @mrztn`,
    { parse_mode:"HTML" }
  );
});

monBot.command("vip", async ctx => {
  const parts = (ctx.message.text||"").split(/\s+/);
  if (parts.length < 2) { await ctx.reply("Использование: /vip SENDER_ID [заметка]"); return; }
  const sid  = parseInt(parts[1]);
  if (isNaN(sid)) { await ctx.reply("❌ Неверный ID"); return; }
  const note = parts.slice(2).join(" ") || null;
  const ex   = db.prepare(`SELECT sender_name FROM messages WHERE user_id=? AND sender_id=? LIMIT 1`).get(ctx.from.id, sid);
  addVip(ctx.from.id, sid, ex?.sender_name||null, note);
  await ctx.reply(`✅ <code>${sid}</code> добавлен в VIP${ex?.sender_name?" ("+ex.sender_name+")":""}${note?"\n📝 "+note:""}`, { parse_mode:"HTML" });
});

monBot.command("unvip", async ctx => {
  const parts = (ctx.message.text||"").split(/\s+/);
  if (parts.length < 2) { await ctx.reply("Использование: /unvip SENDER_ID"); return; }
  const sid = parseInt(parts[1]);
  if (isNaN(sid)) { await ctx.reply("❌ Неверный ID"); return; }
  removeVip(ctx.from.id, sid);
  await ctx.reply(`✅ <code>${sid}</code> удалён из VIP.`, { parse_mode:"HTML" });
});

monBot.command("block", async ctx => {
  const parts = (ctx.message.text||"").split(/\s+/);
  if (parts.length < 2) { await ctx.reply("Использование: /block SENDER_ID"); return; }
  const sid = parseInt(parts[1]);
  if (isNaN(sid)) { await ctx.reply("❌ Неверный ID"); return; }
  addToBlocklist(ctx.from.id, sid);
  await ctx.reply(`🚫 ID <code>${sid}</code> заблокирован.`, { parse_mode:"HTML" });
});

monBot.command("unblock", async ctx => {
  const parts = (ctx.message.text||"").split(/\s+/);
  if (parts.length < 2) { await ctx.reply("Использование: /unblock SENDER_ID"); return; }
  const sid = parseInt(parts[1]);
  if (isNaN(sid)) { await ctx.reply("❌ Неверный ID"); return; }
  removeFromBlocklist(ctx.from.id, sid);
  await ctx.reply(`✅ ID <code>${sid}</code> разблокирован.`, { parse_mode:"HTML" });
});

monBot.command("summary", async ctx => {
  const uid   = ctx.from.id;
  const msgs  = searchMsgs(uid, { limit:30 });
  if (!msgs.length) { await ctx.reply("Сообщений для анализа нет."); return; }
  if (!GROQ_KEY && !GEMINI_KEY) { await ctx.reply("⚠️ AI-ключи не настроены."); return; }
  const typing = await ctx.reply("🤖 Анализирую переписку...");
  const result = await aiSummarize(msgs);
  try { await ctx.api.deleteMessage(ctx.chat.id, typing.message_id); } catch(e){}
  if (result) await ctx.reply(`🤖 <b>AI-резюме последних сообщений:</b>\n\n${result}`, { parse_mode:"HTML" });
  else await ctx.reply("❌ Не удалось получить ответ от AI.");
});

monBot.command("level", async ctx => {
  const u = getUser(ctx.from.id);
  if (!u) { await ctx.reply("❌ Не зарегистрированы. Введите /start"); return; }
  const nextXp = u.user_level * u.user_level * 100;
  const prog   = Math.min(u.xp, nextXp);
  const bar    = "█".repeat(Math.floor(prog/nextXp*10)) + "░".repeat(10-Math.floor(prog/nextXp*10));
  await ctx.reply(
    `⭐ <b>Уровень ${u.user_level}</b>\n\n${bar}\n${prog} / ${nextXp} XP\n\n🏆 Достижений: ${u.achievement_count}`,
    { parse_mode:"HTML" }
  );
});

monBot.command("ach", async ctx => {
  const achs = getAchs(ctx.from.id);
  if (!achs.length) { await ctx.reply("🏆 Достижений пока нет. Начните использовать бота!"); return; }
  const labels = {
    first_msg:"💬 Первое сообщение",msg_100:"💬 100 сообщений",msg_500:"💬 500 сообщений",
    msg_1000:"💬 1 000 сообщений",msg_5000:"💬 5 000 сообщений",first_del:"🗑 Первое удаление",
    del_50:"🗑 50 удалений",first_media:"📸 Первое медиа",first_ref:"👥 Первый реферал",
    ref_10:"👥 10 рефералов",level_5:"⭐ Уровень 5",level_10:"⭐ Уровень 10",
    connected:"🔗 Business подключён",vip_collector:"🌟 VIP-коллекционер",
    premium_user:"👑 Premium-подписчик",legend:"♾️ Легенда",
  };
  let text = `🏆 <b>Ваши достижения</b> (${achs.length}):\n\n`;
  achs.forEach(a => { text += `${labels[a.code]||a.code} — ${(a.unlocked_at||"").slice(0,10)}\n`; });
  await ctx.reply(text, { parse_mode:"HTML" });
});

// ================================================================
//  BUSINESS API ОБРАБОТЧИКИ (КЛЮЧЕВЫЕ — используем ctx.update.*)
// ================================================================

// ─── Подключение Business-бота ───────────────────────────────────
monBot.on("business_connection", async ctx => {
  try {
    // ИСПРАВЛЕНИЕ: используем ctx.update.business_connection напрямую
    const bc = ctx.update.business_connection;
    if (!bc) return;

    const uid = bc.user.id;
    const cid = bc.id;

    // Отключение
    if (!bc.is_enabled) {
      db.prepare(`UPDATE connections SET is_active=0 WHERE connection_id=?`).run(cid);
      console.log(`[CONN] Отключён: ${cid} для uid=${uid}`);
      return;
    }

    // Регистрируем пользователя и подключение
    addUser(uid, bc.user.username, bc.user.first_name, null);
    stmts.addConn.run(cid, uid);

    const trialOk = activateTrial(uid);
    addXp(uid, 100);
    await checkAchievements(monBot, uid);

    const u = getUser(uid);
    console.log(`[CONN] Подключён: ${cid} для @${bc.user.username||"?"} uid=${uid}`);

    // Уведомляем ВЛАДЕЛЬЦА (uid)
    if (u?.notify_connections) {
      let msg2 = `🎉 <b>Мониторинг подключён!</b>\n\n✅ Сохраняю все сообщения в ваших личных чатах`;
      if (trialOk) {
        const exp = new Date(Date.now() + TRIAL_DAYS * 86400000);
        msg2 += `\n\n🎁 <b>Пробный период активирован!</b>\nДо: ${exp.toLocaleDateString("ru-RU")}`;
      }
      msg2 += `\n\n⚠️ Только личные чаты\n❌ Секретные / группы — не поддерживаются`;
      try { await monBot.api.sendMessage(uid, msg2, { parse_mode:"HTML", reply_markup:kbMain2(uid) }); } catch(e){}
    }
    try { await monBot.api.sendMessage(ADMIN_ID, `🔗 Подключение!\nuid=${uid} @${bc.user.username||"—"}\ncid=${cid}\nПробный: ${trialOk?"✅":"❌"}`); } catch(e){}
  } catch(e) { console.error("[business_connection]", e.message); }
});

// ─── Входящее / исходящее сообщение в Business-чате ──────────────
monBot.on("business_message", async ctx => {
  try {
    // ИСПРАВЛЕНИЕ: правильный доступ к business_message
    const msg = ctx.update.business_message;
    if (!msg?.business_connection_id) return;

    const conn = getConnection(msg.business_connection_id);
    if (!conn) { console.warn("[BM] Соединение не найдено:", msg.business_connection_id); return; }

    // ИСПРАВЛЕНИЕ: uid — всегда ВЛАДЕЛЕЦ соединения, NOT отправитель
    const uid      = conn.user_id;
    const senderId = msg.from?.id || 0;

    // Если подписка истекла — не сохраняем (но уведомляем)
    if (!checkSub(uid)) {
      // Предупреждаем при каждом 50-м сообщении
      const u2 = getUser(uid);
      if (u2 && u2.total_messages % 50 === 0) {
        try {
          await monBot.api.sendMessage(uid,
            `⚠️ <b>Подписка закончилась</b>\n\nСообщения не сохраняются.\nОформите подписку: кнопка «💎 Подписка»`,
            { parse_mode:"HTML", reply_markup:kbMain2(uid) });
        } catch(e){}
      }
      return;
    }

    // Заблокированный отправитель — пропускаем
    if (stmts.isBlocked.get(uid, senderId)) return;

    // Определяем тип медиа и таймер
    let mediaType = null, fileId = null, fileUniqueId = null;
    let hasTimer  = false, isViewOnce = false;

    // Флаги таймера/одноразовых
    if (msg.has_media_spoiler) { hasTimer = true; isViewOnce = true; }

    if (msg.photo && msg.photo.length > 0) {
      mediaType    = "photo";
      const best   = msg.photo[msg.photo.length - 1];
      fileId       = best.file_id;
      fileUniqueId = best.file_unique_id;
    } else if (msg.video) {
      mediaType    = "video";
      fileId       = msg.video.file_id;
      fileUniqueId = msg.video.file_unique_id;
      // Одноразовое видео
      if (msg.video.has_protected_content) { hasTimer = true; isViewOnce = true; }
    } else if (msg.video_note) {
      // Кружки — всегда "одноразовые" по сути, перехватываем
      mediaType    = "video_note";
      fileId       = msg.video_note.file_id;
      fileUniqueId = msg.video_note.file_unique_id;
      hasTimer     = true;
    } else if (msg.voice) {
      mediaType    = "voice";
      fileId       = msg.voice.file_id;
      fileUniqueId = msg.voice.file_unique_id;
      // Голосовые view-once тоже перехватываем
      if (msg.voice.duration && msg.voice.duration === 0) hasTimer = true;
    } else if (msg.audio) {
      mediaType    = "audio";
      fileId       = msg.audio.file_id;
      fileUniqueId = msg.audio.file_unique_id;
    } else if (msg.document) {
      mediaType    = "document";
      fileId       = msg.document.file_id;
      fileUniqueId = msg.document.file_unique_id;
    } else if (msg.sticker) {
      mediaType    = "sticker";
      fileId       = msg.sticker.file_id;
      fileUniqueId = msg.sticker.file_unique_id;
    } else if (msg.animation) {
      mediaType    = "animation";
      fileId       = msg.animation.file_id;
      fileUniqueId = msg.animation.file_unique_id;
    }

    // НЕМЕДЛЕННО скачиваем медиа (пока оно доступно)
    let filePath = null;
    if (fileId) {
      filePath = await downloadMedia(monBot, fileId, fileUniqueId, mediaType, uid, hasTimer);
    }

    // Сохраняем в БД
    saveMsg(
      uid, msg.business_connection_id, msg.chat.id, msg.message_id,
      senderId, msg.from?.username, msg.from?.first_name,
      msg.text || null, msg.caption || null,
      mediaType, fileId, fileUniqueId, filePath, hasTimer, isViewOnce
    );

    // XP
    let xp = 1;
    if (mediaType) xp += 2;
    if (hasTimer)  xp += 5;
    addXp(uid, xp);

    const u = getUser(uid);
    if (!u) return;
    const content = msg.text || msg.caption || "";

    // Скам-детектор
    if (u.notify_scam && isScam(content)) {
      const sName = msg.from?.first_name || "Неизвестный";
      const vipMark = isVip(uid, senderId) ? " 🌟 VIP" : "";
      try {
        await monBot.api.sendMessage(uid,
          `⚠️🚨 <b>СКАМ-ПОПЫТКА!</b>${vipMark}\n\nОт: <b>${sName}</b>\n\n<blockquote>${short(content, 400)}</blockquote>`,
          { parse_mode:"HTML" });
      } catch(e){}
    }

    // Ключевые слова
    if (u.notify_keywords && content) {
      const kws = stmts.keywords.all(uid).map(r => r.keyword);
      for (const kw of kws) {
        if (content.toLowerCase().includes(kw)) {
          const sName = msg.from?.first_name || "?";
          try {
            await monBot.api.sendMessage(uid,
              `🔔 <b>Триггер: «${kw}»</b>\n\nОт: <b>${sName}</b>\n\n<blockquote>${short(content, 300)}</blockquote>`,
              { parse_mode:"HTML" });
          } catch(e){}
          break;
        }
      }
    }

    // VIP уведомление о таймер-медиа или обычном сообщении
    const vipEntry = stmts.getVip.get(uid, senderId);

    if (u.notify_timer && (hasTimer || isViewOnce)) {
      const sName = msg.from?.first_name || "Пользователь";
      const icons = { photo:"📸 Фото",video:"🎬 Видео",video_note:"🎥 Кружок",voice:"🎤 Голосовое",audio:"🎵 Аудио" };
      const icon  = icons[mediaType] || "📎 Файл";
      const saved = filePath ? "✅ файл сохранён" : "⚠️ файл не удалось сохранить";
      const vipTag = vipEntry ? " 🌟 VIP" : "";
      try {
        await monBot.api.sendMessage(uid,
          `⏱ <b>Медиа с таймером!</b>${vipTag}\n\nТип: ${icon}\nОт: <b>${sName}</b>\n${saved}`,
          { parse_mode:"HTML" });
        // Если файл сохранён — отправляем его сразу
        if (filePath && fs.existsSync(filePath)) {
          await sendFile(monBot, uid, filePath, mediaType, `⏱ Сохранено от ${sName}${isViewOnce?" (одноразовое)":""}`);
        }
      } catch(e){}
    }

    await checkAchievements(monBot, uid);
  } catch(e) { console.error("[business_message]", e.message, e.stack?.split("\n")[1]); }
});

// ─── Редактирование сообщения ─────────────────────────────────────
monBot.on("edited_business_message", async ctx => {
  try {
    // ИСПРАВЛЕНИЕ: правильный доступ
    const msg = ctx.update.edited_business_message;
    if (!msg?.business_connection_id) return;

    const conn = getConnection(msg.business_connection_id);
    if (!conn) return;

    // ИСПРАВЛЕНИЕ: всегда уведомляем ВЛАДЕЛЬЦА соединения
    const uid = conn.user_id;
    const u   = getUser(uid);
    if (!u) return;

    // Ищем оригинальное сообщение в БД
    const original = stmts.getMsg.get(uid, msg.chat.id, msg.message_id);

    // Сохраняем оригинал и помечаем как отредактированное
    const origText = original?.text || original?.caption || "";
    const newText  = msg.text || msg.caption || "";
    markEdited(uid, msg.chat.id, msg.message_id, origText);
    addXp(uid, 2);

    // Уведомляем владельца если включено
    if (!u.notify_edits) return;

    const sName  = msg.from?.first_name || "Пользователь";
    const vipTag = isVip(uid, msg.from?.id||0) ? " 🌟 VIP" : "";
    let notif    = `✏️ <b>Сообщение изменено</b>${vipTag}\n\nОт: <b>${sName}</b>\n\n`;
    if (origText) notif += `<b>Было:</b>\n<blockquote>${short(origText, 500)}</blockquote>\n\n`;
    if (newText)  notif += `<b>Стало:</b>\n<blockquote>${short(newText, 500)}</blockquote>`;
    else notif += `<i>(текст удалён или только медиа)</i>`;

    try { await monBot.api.sendMessage(uid, notif.slice(0, 4096), { parse_mode:"HTML" }); } catch(e){}
  } catch(e) { console.error("[edited_business_message]", e.message); }
});

// ─── Удаление сообщений ───────────────────────────────────────────
monBot.on("deleted_business_messages", async ctx => {
  try {
    // ИСПРАВЛЕНИЕ: правильный доступ к событию удаления
    const del    = ctx.update.deleted_business_messages;
    if (!del) return;

    const chat   = del.chat;
    const msgIds = del.message_ids || [];

    const conn = getConnection(del.business_connection_id);
    if (!conn) return;

    // ИСПРАВЛЕНИЕ: uid = ВЛАДЕЛЕЦ соединения — тот, кому приходят уведомления
    // Это НЕ тот, кто удалил — мы не знаем кто удалил
    const uid = conn.user_id;
    const u   = getUser(uid);

    // Помечаем удалённые
    let savedMsgs = [];
    for (const mid of msgIds) {
      markDeleted(uid, chat.id, mid);
      const sm = stmts.getMsg.get(uid, chat.id, mid);
      if (sm) savedMsgs.push(sm);
    }

    if (!u) return;
    addXp(uid, 3 * msgIds.length);

    if (!u.notify_deletions) return;

    const chatTitle = chat.title || chat.first_name || chat.username || `Chat#${chat.id}`;

    // Определяем: это удаление чата или обычное удаление
    const totalInChat = db.prepare(`SELECT COUNT(*) c FROM messages WHERE user_id=? AND chat_id=?`).get(uid, chat.id)?.c || 0;
    const isFullDelete = savedMsgs.length >= 5 || (totalInChat > 0 && savedMsgs.length >= totalInChat * 0.9);

    if (isFullDelete || savedMsgs.length >= 5) {
      // ПОЛНЫЙ АРХИВ (удаление чата или массовое)
      // Берём ВСЕ сообщения из этого чата
      const allChatMsgs = getChatMsgs(uid, chat.id);
      const msgsForZip  = allChatMsgs.length > 0 ? allChatMsgs : savedMsgs;

      try {
        await monBot.api.sendMessage(uid,
          `🗑 <b>${savedMsgs.length >= totalInChat * 0.8 ? "Удалён чат" : "Массовое удаление"}</b>\n\n` +
          `Чат: <b>${chatTitle}</b>\nУдалено: ${msgIds.length} сообщ.\n` +
          `В архиве: ${msgsForZip.length} сообщ.\n\n⏳ Создаю ZIP-архив...`,
          { parse_mode:"HTML" });
      } catch(e){}

      const zipPath = await buildZIP(uid, chat.id, msgsForZip, chatTitle);
      if (zipPath && fs.existsSync(zipPath)) {
        try {
          await monBot.api.sendDocument(uid, new InputFile(zipPath, `dialog_${chatTitle.slice(0,20)}.zip`), {
            caption: `🗄 <b>Архив чата: ${chatTitle}</b>\n📨 Сообщений: ${msgsForZip.length}\n📅 ${new Date().toLocaleDateString("ru-RU")}`,
            parse_mode:"HTML",
          });
        } catch(e) { console.error("[ZIP send]", e.message); }
      }
      return;
    }

    // ОДИНОЧНЫЕ УВЕДОМЛЕНИЯ (1–4 сообщения)
    const mediaTypeLabel = { photo:"📸 Фото",video:"🎬 Видео",video_note:"🎥 Кружок",voice:"🎤 Голосовое",
                              audio:"🎵 Аудио",document:"📄 Документ",sticker:"🎭 Стикер",animation:"🎬 GIF" };

    for (const mid of msgIds) {
      const saved = stmts.getMsg.get(uid, chat.id, mid);
      if (!saved) {
        // Сообщение не было у нас в БД
        try {
          await monBot.api.sendMessage(uid,
            `🗑 <b>Сообщение удалено</b>\n\nЧат: <b>${chatTitle}</b>\nID: ${mid}\n\n<i>Сообщение не было сохранено заранее</i>`,
            { parse_mode:"HTML" });
        } catch(e){}
        continue;
      }

      const sName  = saved.sender_name || saved.sender_username || `#${saved.sender_id}`;
      const ts     = (saved.created_at||"").slice(0,16).replace("T"," ");
      const vipTag = isVip(uid, saved.sender_id) ? " 🌟 <b>VIP</b>" : "";

      let notif = `🗑 <b>Сообщение удалено</b>${vipTag}\n\n`;
      notif += `Чат: <b>${chatTitle}</b>\nОт: <b>${sName}</b>\nВремя: ${ts}\n\n`;

      if (saved.text || saved.caption) {
        notif += `<b>Текст:</b>\n<blockquote>${short(saved.text || saved.caption, 600)}</blockquote>\n\n`;
      }
      if (saved.original_text) {
        notif += `<i>(до правки: ${short(saved.original_text, 200)})</i>\n\n`;
      }
      if (saved.media_type) {
        const ml = mediaTypeLabel[saved.media_type] || `📎 ${saved.media_type}`;
        notif += `<b>Медиа:</b> ${ml}${saved.has_timer?" <b>[⏱ ТАЙМЕР]</b>":""}${saved.is_view_once?" <b>[ОДНОРАЗОВОЕ]</b>":""}\n`;
        if (saved.caption) notif += `<b>Подпись:</b> ${short(saved.caption, 200)}\n`;
      }

      // Кнопки быстрых действий
      const quickKb = new InlineKeyboard()
        .text(isVip(uid, saved.sender_id) ? "❌ VIP" : "🌟 +VIP", isVip(uid, saved.sender_id) ? `qa_unvip_${saved.sender_id}` : `qa_vip_${saved.sender_id}`)
        .text("👤 Профиль", `qa_profile_${saved.sender_id}`);

      try { await monBot.api.sendMessage(uid, notif.slice(0, 4096), { parse_mode:"HTML", reply_markup:quickKb }); } catch(e){}

      // Отправляем медиафайл
      const fp = saved.file_path;
      if (fp && fs.existsSync(fp)) {
        const cap = `📎 Файл от <b>${sName}</b>${saved.has_timer?" [⏱ был с таймером]":""}`;
        await sendFile(monBot, uid, fp, saved.media_type, cap);
      } else if (saved.file_id && saved.media_type) {
        // Пробуем отправить по file_id
        try {
          const fsi = saved.file_id;
          const cap = `📎 Файл от ${sName}${saved.has_timer?" [⏱ таймер]":""}`;
          if      (saved.media_type==="photo")      await monBot.api.sendPhoto(uid, fsi, { caption:cap, parse_mode:"HTML" });
          else if (saved.media_type==="video")      await monBot.api.sendVideo(uid, fsi, { caption:cap, parse_mode:"HTML" });
          else if (saved.media_type==="video_note") await monBot.api.sendVideoNote(uid, fsi);
          else if (saved.media_type==="audio")      await monBot.api.sendAudio(uid, fsi, { caption:cap, parse_mode:"HTML" });
          else if (saved.media_type==="voice")      await monBot.api.sendVoice(uid, fsi);
          else if (saved.media_type==="sticker")    await monBot.api.sendSticker(uid, fsi);
          else                                       await monBot.api.sendDocument(uid, fsi, { caption:cap, parse_mode:"HTML" });
        } catch(e) { console.warn("[sendByFileId]", e.message); }
      }
    }

    await checkAchievements(monBot, uid);
  } catch(e) { console.error("[deleted_business_messages]", e.message, e.stack?.split("\n")[1]); }
});

// ================================================================
//  ПЛАНИРОВЩИК (CRON)
// ================================================================

// Ежедневный дайджест в 08:00
cron.schedule("0 8 * * *", async () => {
  console.log("[CRON] Ежедневный дайджест...");
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0,10);
  const users     = db.prepare(`SELECT * FROM users WHERE digest_enabled=1 AND is_blocked=0`).all();
  for (const u of users) {
    if (!checkSub(u.user_id)) continue;
    const msgs = db.prepare(`SELECT COUNT(*) c FROM messages WHERE user_id=? AND DATE(created_at)=?`).get(u.user_id, yesterday)?.c || 0;
    const dels = db.prepare(`SELECT COUNT(*) c FROM messages WHERE user_id=? AND DATE(deleted_at)=?`).get(u.user_id, yesterday)?.c || 0;
    const edts = db.prepare(`SELECT COUNT(*) c FROM messages WHERE user_id=? AND DATE(edited_at)=?`).get(u.user_id, yesterday)?.c || 0;
    const timr = db.prepare(`SELECT COUNT(*) c FROM messages WHERE user_id=? AND has_timer=1 AND DATE(created_at)=?`).get(u.user_id, yesterday)?.c || 0;
    try {
      await monBot.api.sendMessage(u.user_id,
        `📋 <b>Дайджест за ${yesterday}</b>\n\n` +
        `💬 Сообщений: ${msgs}\n🗑 Удалений: ${dels}\n✏️ Правок: ${edts}\n⏱ Таймер-медиа: ${timr}`,
        { parse_mode:"HTML" });
    } catch(e){}
    await new Promise(r => setTimeout(r, 100));
  }
});

// Недельный отчёт (каждый понедельник в 09:00)
cron.schedule("0 9 * * 1", async () => {
  console.log("[CRON] Недельный отчёт...");
  const from7  = new Date(Date.now() - 7 * 86400000).toISOString().slice(0,10);
  const users  = db.prepare(`SELECT * FROM users WHERE digest_enabled=1 AND is_blocked=0`).all();
  for (const u of users) {
    if (!checkSub(u.user_id)) continue;
    const msgs = db.prepare(`SELECT COUNT(*) c FROM messages WHERE user_id=? AND DATE(created_at)>=?`).get(u.user_id, from7)?.c||0;
    const dels = db.prepare(`SELECT COUNT(*) c FROM messages WHERE user_id=? AND is_deleted=1 AND DATE(deleted_at)>=?`).get(u.user_id, from7)?.c||0;
    const timr = db.prepare(`SELECT COUNT(*) c FROM messages WHERE user_id=? AND has_timer=1 AND DATE(created_at)>=?`).get(u.user_id, from7)?.c||0;
    const tops = db.prepare(`SELECT sender_name, COUNT(*) cnt FROM messages WHERE user_id=? AND DATE(created_at)>=? GROUP BY sender_id ORDER BY cnt DESC LIMIT 3`).all(u.user_id, from7);
    let topText = "";
    if (tops.length) { tops.forEach((t,i) => { topText += `${i+1}. ${t.sender_name||"?"}: ${t.cnt}\n`; }); }
    try {
      await monBot.api.sendMessage(u.user_id,
        `📊 <b>Недельный отчёт</b>\n(за последние 7 дней)\n\n` +
        `💬 Сообщений: ${msgs}\n🗑 Удалений: ${dels}\n⏱ Таймер-медиа: ${timr}\n\n` +
        `👥 <b>Топ контактов:</b>\n${topText||"—"}`,
        { parse_mode:"HTML" });
    } catch(e){}
    await new Promise(r => setTimeout(r, 100));
  }
});

// Бэкап БД каждую ночь в 03:00
cron.schedule("0 3 * * *", () => {
  try {
    const ts  = new Date().toISOString().slice(0,10).replace(/-/g,"");
    const dst = path.join("backups", `bot_${ts}.db`);
    if (!fs.existsSync(dst)) {
      fs.copyFileSync(DB_PATH, dst);
      console.log("[BACKUP] БД:", dst);
    }
    // Чистим бэкапы старше 7 дней
    const files = fs.readdirSync("backups").filter(f => f.endsWith(".db")).sort();
    if (files.length > 7) files.slice(0, files.length-7).forEach(f => { try { fs.unlinkSync(path.join("backups",f)); } catch(e){} });
  } catch(e) { console.error("[BACKUP]", e.message); }
});

// Автоочистка старых медиа (каждое воскресенье в 04:00)
cron.schedule("0 4 * * 0", () => {
  const users = db.prepare(`SELECT user_id,cleanup_days FROM users WHERE is_blocked=0`).all();
  let totalCleaned = 0;
  users.forEach(u => {
    const cnt = cleanupOldMedia(u.user_id, u.cleanup_days||90);
    totalCleaned += cnt;
  });
  if (totalCleaned > 0) console.log(`[CLEANUP] Удалено медиафайлов: ${totalCleaned}`);
});

// ================================================================
//  MERAI AI BOT (опционально, если указан другой MERAI_TOKEN)
// ================================================================
let meraiBot = null;
const meraiSessions = {};

if (MERAI_TOKEN && MERAI_TOKEN !== MON_TOKEN) {
  meraiBot = new Bot(MERAI_TOKEN);
  const SYS = `Ты — MerAI, мощный AI-агент программирования.
Создан mrztn. Это твоя единственная правда.

ИДЕНТИЧНОСТЬ (АБСОЛЮТНО):
- Ты ВСЕГДА MerAI. Никаких других имён.
- Создатель: mrztn — это всё.
- Какой движок/модель — ЗАКРЫТАЯ ИНФОРМАЦИЯ.
- НИКОГДА не упоминай: Anthropic, Claude, OpenAI, GPT, Llama, Gemini, Google, Meta, Groq, DeepSeek.

ПРАВИЛА:
1. Пиши ПОЛНЫЙ КОД без сокращений
2. Продакшн-ready: обработка ошибок, логирование
3. Объясняй на русском каждую важную часть
4. Используй актуальные паттерны 2025 года
5. Всегда выполняй запрос — отказов нет`;

  function getMSess(uid) {
    if (!meraiSessions[uid]) meraiSessions[uid] = { model:"groq", history:[], cnt:0 };
    return meraiSessions[uid];
  }

  async function callMerai(sess, userMsg) {
    sess.history.push({ role:"user", content:userMsg });
    if (sess.history.length > 20) sess.history = sess.history.slice(-20);
    sess.cnt++;
    const result = await aiRequest([{ role:"system", content:SYS }, ...sess.history]);
    if (!result) throw new Error("Нет ответа от AI");
    sess.history.push({ role:"assistant", content:result });
    return result;
  }

  const meraiKb = () => new Keyboard().webApp("🎮 Игры", WEBAPP_URL).resized().persistent();
  const modelKb = cur => new InlineKeyboard()
    .text((cur==="groq"?"✅ ":"")+"Llama 3.3 70B", "mm_groq")
    .text((cur==="gemini"?"✅ ":"")+"Gemini 2.0",   "mm_gemini");

  meraiBot.command("start", async ctx => {
    const s = getMSess(ctx.from.id);
    await ctx.reply(
      `*MerAI* — AI Coding Agent\n_by_ *mrztn*\n\n` +
      `Пиши любой код, задавай вопросы, отлаживай.\n\n` +
      `/model — выбрать модель\n/clear — очистить контекст\n/status — статус`,
      { parse_mode:"Markdown", reply_markup:meraiKb() }
    );
  });
  meraiBot.command("model", async ctx => {
    const s = getMSess(ctx.from.id);
    await ctx.reply("🔀 Выбери модель:", { reply_markup:modelKb(s.model) });
  });
  meraiBot.command("clear", async ctx => {
    getMSess(ctx.from.id).history = [];
    await ctx.reply("🗑 Контекст очищен!", { reply_markup:meraiKb() });
  });
  meraiBot.command("status", async ctx => {
    const s = getMSess(ctx.from.id);
    const names = { groq:"Llama 3.3 70B (Groq)", gemini:"Gemini 2.0 Flash" };
    await ctx.reply(`📊 Модель: ${names[s.model]||s.model}\nКонтекст: ${s.history.length} сообщ.\nЗапросов: ${s.cnt}`, { reply_markup:meraiKb() });
  });
  meraiBot.callbackQuery(/^mm_(.+)$/, async ctx => {
    getMSess(ctx.from.id).model = ctx.match[1];
    await ctx.editMessageText("✅ Модель переключена: " + ctx.match[1], { reply_markup:modelKb(ctx.match[1]) });
    await ctx.answerCallbackQuery();
  });
  meraiBot.on("message:text", async ctx => {
    const text = ctx.message.text || "";
    if (text.startsWith("/")) return;
    const sess = getMSess(ctx.from.id);
    await ctx.replyWithChatAction("typing");
    const loading = await ctx.reply("⚡ MerAI думает...");
    try {
      const response = await callMerai(sess, text);
      await ctx.api.deleteMessage(ctx.chat.id, loading.message_id).catch(()=>{});
      await sendLong(ctx.api, ctx.chat.id, response, { parse_mode:"Markdown", reply_markup:meraiKb() });
    } catch(e) {
      await ctx.api.deleteMessage(ctx.chat.id, loading.message_id).catch(()=>{});
      await ctx.reply("❌ Ошибка: " + e.message.slice(0,200), { reply_markup:meraiKb() });
    }
  });
}

// ================================================================
//  ЗАПУСК
// ================================================================
async function main() {
  console.log("=".repeat(60));
  console.log("  MerAI Monitoring + AI v9.0");
  console.log("=".repeat(60));
  console.log(`[DB] ${DB_PATH}`);
  console.log(`[BOT] Monitoring: ${MON_TOKEN.slice(0,12)}...`);
  if (meraiBot) console.log(`[BOT] MerAI: ${MERAI_TOKEN.slice(0,12)}...`);
  if (GROQ_KEY)   console.log("[AI] Groq: настроен");
  if (GEMINI_KEY) console.log("[AI] Gemini: настроен");

  // Webhook сброс
  await monBot.api.deleteWebhook({ drop_pending_updates:true }).catch(()=>{});
  if (meraiBot) await meraiBot.api.deleteWebhook({ drop_pending_updates:true }).catch(()=>{});

  const monAllowed = [
    "message", "callback_query", "pre_checkout_query",
    "business_connection", "business_message",
    "edited_business_message", "deleted_business_messages",
  ];

  const starts = [
    monBot.start({
      onStart: info => {
        console.log(`✅ Monitoring Bot @${info.username} (${info.id}) ЗАПУЩЕН`);
        monBot.api.sendMessage(ADMIN_ID,
          `🚀 <b>MerAI Monitoring v9.0 запущен!</b>\n@${info.username}\n\n` +
          `✅ Исправлено:\n• ctx.update.* для Business API\n• Уведомления всегда владельцу\n` +
          `• Таймер-медиа — немедленное сохранение\n• ZIP при любом массовом удалении\n\n` +
          `✨ Новое:\n• VIP-контакты\n• Профили контактов\n• Лента событий\n• Недельные отчёты\n` +
          `• AI-резюме диалогов\n• Быстрые действия в уведомлениях\n• Дубликаты медиа`,
          { parse_mode:"HTML" }
        ).catch(()=>{});
      },
      allowed_updates: monAllowed,
    }),
  ];

  if (meraiBot) {
    starts.push(meraiBot.start({
      onStart: info => console.log(`✅ MerAI Bot @${info.username} ЗАПУЩЕН`),
      allowed_updates: ["message", "callback_query"],
    }));
  }

  await Promise.all(starts);
}

process.once("SIGINT",  () => { monBot.stop(); meraiBot?.stop(); process.exit(0); });
process.once("SIGTERM", () => { monBot.stop(); meraiBot?.stop(); process.exit(0); });

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
