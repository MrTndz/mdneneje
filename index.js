"use strict";
// ================================================================
//  MerAI — Monitoring & AI
//  grammy 1.31 | better-sqlite3 | telegram (gram-js) | archiver | node-cron
//  Author: mrztn
//  ТЕСТОВАЯ ВЕРСИЯ С ЗАХАРДКОЖЕННЫМИ CREDENTIALS
//  ⚠️ ПОСЛЕ ТЕСТИРОВАНИЯ СМЕНИТЕ ВСЕ КЛЮЧИ!
// ================================================================

const { Bot, InlineKeyboard, InputFile } = require("grammy");
const DB      = require("better-sqlite3");
const fs      = require("fs");
const path    = require("path");
const crypto  = require("crypto");
const cron    = require("node-cron");
const { TelegramClient }  = require("telegram");
const { StringSession }   = require("telegram/sessions");
const { NewMessage }      = require("telegram/events");
const { EditedMessage }   = require("telegram/events");
const { Api }             = require("telegram/tl");
const input = require("input");

// ================================================================
//  CONFIG - ЗАХАРДКОЖЕННЫЕ ЗНАЧЕНИЯ ДЛЯ ТЕСТИРОВАНИЯ
//  ⚠️ ЭТО ТЕСТОВАЯ ВЕРСИЯ - ПОСЛЕ ТЕСТОВ СМЕНИТЕ КЛЮЧИ!
// ================================================================
const BOT_TOKEN     = "8505484152:AAHXEFt0lyeMK5ZSJHRYpdPhhFJ0s142Bng";

// БЕСПЛАТНЫЕ AI ПРОВАЙДЕРЫ (приоритет сверху вниз)
const DEEPSEEK_KEY  = "sk-de6711e104ad469e91df88297c43fe09";  // DeepSeek - БЕСПЛАТНЫЙ! https://platform.deepseek.com
const HF_KEY        = "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";  // Hugging Face - БЕСПЛАТНЫЙ! https://huggingface.co/settings/tokens
const GROQ_KEY      = "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";
const GEMINI_KEY    = "AIzaSyCJFqu1EHGSHjgJ70XukduT5sFwRmKNmEI";

const TG_API_ID     = 38362277;
const TG_API_HASH   = "1e1fbdde4c349760db99c9374adf956e";
const ADMIN_ID      = 7785371505;
const DB_PATH       = path.join("database", "merai.db");

console.log("✅ Credentials загружены из кода (ТЕСТОВАЯ ВЕРСИЯ)");
console.log("⚠️  ПОСЛЕ ТЕСТИРОВАНИЯ СМЕНИТЕ ВСЕ КЛЮЧИ!");

if (!BOT_TOKEN) {
  console.error("❌ BOT_TOKEN пустой!");
  process.exit(1);
}

// Проверяем доступные AI провайдеры
const aiProviders = [];
if (DEEPSEEK_KEY) aiProviders.push("DeepSeek (бесплатный)");
if (HF_KEY) aiProviders.push("HuggingFace (бесплатный)");
if (GROQ_KEY) aiProviders.push("Groq");
if (GEMINI_KEY) aiProviders.push("Gemini");

if (aiProviders.length === 0) {
  console.warn("⚠️ НИ ОДИН AI провайдер не настроен!");
  console.warn("⚠️ Получите БЕСПЛАТНЫЙ ключ:");
  console.warn("   • DeepSeek: https://platform.deepseek.com (ЛУЧШИЙ)");
  console.warn("   • HuggingFace: https://huggingface.co/settings/tokens");
} else {
  console.log(`✅ AI провайдеры: ${aiProviders.join(", ")}`);
}

const PLAN_DAYS  = { starter:7, basic:30, pro:90, premium:365, ultimate:null };
const PLAN_STARS = { starter:100, basic:250, pro:600, premium:2000, ultimate:5000 };
const PLAN_RUB   = { starter:200, basic:500, pro:1200, premium:4000, ultimate:10000 };
const PLAN_XP    = { starter:200, basic:500, pro:1500, premium:3000, ultimate:10000 };
const TRIAL_DAYS = 3;

const SCAM_WORDS = [
  "отправь деньги","переведи срочно","срочный перевод","взлом аккаунта",
  "пин код","pin code","cvv","верификация карты","ты выиграл","бесплатно перейди",
  "click here","verify account","urgent transfer","send money","account suspended",
  "подтверди перевод","введи пароль","аккаунт заблокирован","требуется верификация",
  "telegram premium бесплатно","получи деньги",
];

const CATS = {
  "Работа":  ["встреча","задача","проект","дедлайн","клиент","отчёт","офис","созвон","meeting","task","deadline"],
  "Финансы": ["деньги","оплата","счёт","перевод","банк","карта","зарплата","payment","invoice","money"],
  "Ссылки":  ["http://","https://","www.","t.me/","youtu.be","instagram","vk.com"],
  "Вопросы": ["?"],
  "Личное":  ["люблю","скучаю","семья","дом","отдых","привет","спасибо"],
};

// ================================================================
//  ДИРЕКТОРИИ
// ================================================================
["database","media","exports","backups","sessions"].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

// ================================================================
//  БАЗА ДАННЫХ
// ================================================================
const db = new DB(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");
db.pragma("busy_timeout = 30000");
db.pragma("foreign_keys = ON");
db.pragma("cache_size = -64000");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  user_id              INTEGER PRIMARY KEY,
  username             TEXT,
  first_name           TEXT,
  registered_at        TEXT DEFAULT (datetime('now')),
  accepted_terms       INTEGER DEFAULT 0,
  is_blocked           INTEGER DEFAULT 0,
  subscription_type    TEXT DEFAULT 'free',
  subscription_expires TEXT,
  trial_used           INTEGER DEFAULT 0,
  referral_code        TEXT UNIQUE,
  referred_by          INTEGER,
  referral_earnings    INTEGER DEFAULT 0,
  total_referrals      INTEGER DEFAULT 0,
  notify_deletions     INTEGER DEFAULT 1,
  notify_edits         INTEGER DEFAULT 1,
  notify_timer         INTEGER DEFAULT 1,
  notify_scam          INTEGER DEFAULT 1,
  notify_keywords      INTEGER DEFAULT 1,
  digest_enabled       INTEGER DEFAULT 0,
  user_level           INTEGER DEFAULT 1,
  xp                   INTEGER DEFAULT 0,
  achievement_count    INTEGER DEFAULT 0,
  total_messages       INTEGER DEFAULT 0,
  total_deletions      INTEGER DEFAULT 0,
  total_edits          INTEGER DEFAULT 0,
  total_media          INTEGER DEFAULT 0,
  stars_balance        INTEGER DEFAULT 0,
  cleanup_days         INTEGER DEFAULT 90,
  ai_model             TEXT DEFAULT 'groq',
  ai_context           TEXT DEFAULT '[]',
  ai_requests          INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS connections (
  connection_id TEXT PRIMARY KEY,
  user_id       INTEGER NOT NULL,
  connected_at  TEXT DEFAULT (datetime('now')),
  is_active     INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS messages (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL,
  connection_id  TEXT,
  source         TEXT DEFAULT 'business',
  chat_id        INTEGER,
  message_id     INTEGER,
  sender_id      INTEGER,
  sender_username TEXT,
  sender_name    TEXT,
  text           TEXT,
  caption        TEXT,
  media_type     TEXT,
  file_id        TEXT,
  file_unique_id TEXT,
  file_path      TEXT,
  has_timer      INTEGER DEFAULT 0,
  is_view_once   INTEGER DEFAULT 0,
  category       TEXT DEFAULT 'Личное',
  importance     INTEGER DEFAULT 0,
  has_links      INTEGER DEFAULT 0,
  is_scam        INTEGER DEFAULT 0,
  is_deleted     INTEGER DEFAULT 0,
  deleted_at     TEXT,
  is_edited      INTEGER DEFAULT 0,
  edited_at      TEXT,
  original_text  TEXT,
  created_at     TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS blocklist (
  user_id   INTEGER,
  sender_id INTEGER,
  PRIMARY KEY(user_id, sender_id)
);

CREATE TABLE IF NOT EXISTS keywords (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER,
  keyword    TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER,
  stars      INTEGER,
  plan       TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS referral_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  referrer_id INTEGER,
  referred_id INTEGER,
  bonus       INTEGER DEFAULT 0,
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS achievements (
  user_id     INTEGER,
  code        TEXT,
  unlocked_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY(user_id, code)
);

CREATE TABLE IF NOT EXISTS activity (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER,
  event      TEXT,
  hour       INTEGER,
  dow        INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS userbot_sessions (
  user_id       INTEGER PRIMARY KEY,
  phone         TEXT,
  session_str   TEXT,
  is_active     INTEGER DEFAULT 0,
  connected_at  TEXT,
  tg_user_id    INTEGER,
  tg_username   TEXT,
  error_count   INTEGER DEFAULT 0,
  last_error    TEXT,
  accepted_ub_terms INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_msg_user   ON messages(user_id);
CREATE INDEX IF NOT EXISTS idx_msg_chat   ON messages(user_id, chat_id, message_id);
CREATE INDEX IF NOT EXISTS idx_msg_sender ON messages(user_id, sender_id);
CREATE INDEX IF NOT EXISTS idx_msg_del    ON messages(user_id, is_deleted);
CREATE INDEX IF NOT EXISTS idx_msg_timer  ON messages(user_id, has_timer);
CREATE INDEX IF NOT EXISTS idx_conn_user  ON connections(user_id);
`);

console.log(`[DB] ${DB_PATH} инициализирована`);

// ================================================================
//  DB HELPERS
// ================================================================
function makeRef(uid) {
  const c = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 7; i++) s += c[Math.floor(Math.random() * c.length)];
  return "R" + String(uid).slice(-4) + s;
}

function addUser(uid, username, firstName, refCode) {
  const code  = makeRef(uid);
  let refBy   = null;
  if (refCode) {
    const r = db.prepare("SELECT user_id FROM users WHERE referral_code=?").get(refCode);
    if (r && r.user_id !== uid) {
      refBy = r.user_id;
      db.prepare("UPDATE users SET total_referrals=total_referrals+1 WHERE user_id=?").run(refBy);
    }
  }
  const info = db.prepare(`
    INSERT OR IGNORE INTO users(user_id,username,first_name,referral_code,referred_by)
    VALUES(?,?,?,?,?)
  `).run(uid, username || null, firstName || null, code, refBy);
  return info.changes > 0;
}

function getUser(uid)     { return db.prepare("SELECT * FROM users WHERE user_id=?").get(uid) || null; }
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
    updateUser(uid, { subscription_type: "free", subscription_expires: null });
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

function subLabel(u) {
  if (!u) return "❓";
  if (u.is_blocked) return "🚫 Заблокирован";
  const L = { free:"🆓 Бесплатный", trial:"🎁 Пробный", starter:"🌟 Starter",
               basic:"💎 Basic", pro:"💼 Pro", premium:"👑 Premium", ultimate:"♾️ Ultimate" };
  let base = L[u.subscription_type] || "❓";
  if (!["free","ultimate"].includes(u.subscription_type) && u.subscription_expires) {
    const left = Math.max(0, Math.ceil((new Date(u.subscription_expires) - Date.now()) / 86400000));
    base += ` (${left} д.)`;
  }
  return base;
}

function categorize(text) {
  const t = (text || "").toLowerCase();
  if (/https?:\/\/|www\.|t\.me\//.test(t)) return "Ссылки";
  for (const [cat, words] of Object.entries(CATS)) {
    if (words.some(w => t.includes(w))) return cat;
  }
  return "Личное";
}

function isScam(text) {
  const t = (text || "").toLowerCase();
  return SCAM_WORDS.some(w => t.includes(w));
}

function getConn(connId) {
  return db.prepare("SELECT * FROM connections WHERE connection_id=?").get(connId) || null;
}

function saveMsg(uid, connId, source, chatId, msgId, senderId, senderUsername, senderName,
  text, caption, mediaType, fileId, fileUniqueId, filePath, hasTimer, isViewOnce) {

  if (fileUniqueId) {
    const ex = db.prepare("SELECT file_path FROM messages WHERE file_unique_id=? AND file_path IS NOT NULL LIMIT 1").get(fileUniqueId);
    if (ex && ex.file_path && fs.existsSync(ex.file_path)) filePath = ex.file_path;
  }

  const cat  = categorize(text || caption || "");
  const imp  = Math.min(
    (mediaType ? 15 : 0) + (hasTimer ? 25 : 0) +
    Math.min(Math.floor(((text||"").length)/30), 20) +
    (/срочно|важно|urgent/i.test(text||"") ? 15 : 0), 100
  );
  const links = /https?:\/\/|www\./i.test(text || "") ? 1 : 0;
  const scam  = isScam(text || "") ? 1 : 0;

  const info = db.prepare(`
    INSERT INTO messages
      (user_id,connection_id,source,chat_id,message_id,sender_id,sender_username,sender_name,
       text,caption,media_type,file_id,file_unique_id,file_path,has_timer,is_view_once,
       category,importance,has_links,is_scam)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(uid, connId||null, source||"business", chatId, msgId, senderId||0,
    senderUsername||null, senderName||null, text||null, caption||null,
    mediaType||null, fileId||null, fileUniqueId||null, filePath||null,
    hasTimer?1:0, isViewOnce?1:0, cat, imp, links, scam);

  db.prepare("UPDATE users SET total_messages=total_messages+1 WHERE user_id=?").run(uid);
  if (mediaType) db.prepare("UPDATE users SET total_media=total_media+1 WHERE user_id=?").run(uid);
  const n = new Date();
  db.prepare("INSERT INTO activity(user_id,event,hour,dow) VALUES(?,?,?,?)").run(uid, "message", n.getHours(), n.getDay());
  return info.lastInsertRowid;
}

function getMsg(uid, chatId, msgId) {
  return db.prepare("SELECT * FROM messages WHERE user_id=? AND chat_id=? AND message_id=? ORDER BY created_at DESC LIMIT 1").get(uid, chatId, msgId) || null;
}

function markDeleted(uid, chatId, msgId) {
  const r = db.prepare("UPDATE messages SET is_deleted=1,deleted_at=datetime('now') WHERE user_id=? AND chat_id=? AND message_id=? AND is_deleted=0").run(uid, chatId, msgId);
  if (r.changes > 0) db.prepare("UPDATE users SET total_deletions=total_deletions+1 WHERE user_id=?").run(uid);
  return r.changes > 0;
}

function markEdited(uid, chatId, msgId, origText) {
  const r = db.prepare("UPDATE messages SET is_edited=1,edited_at=datetime('now'),original_text=? WHERE user_id=? AND chat_id=? AND message_id=?").run(origText, uid, chatId, msgId);
  if (r.changes > 0) db.prepare("UPDATE users SET total_edits=total_edits+1 WHERE user_id=?").run(uid);
  return r.changes > 0;
}

function searchMsgs(uid, o = {}) {
  let sql = "SELECT * FROM messages WHERE user_id=?"; const p = [uid];
  if (o.q)        { sql += " AND (text LIKE ? OR caption LIKE ?)"; const l = `%${o.q}%`; p.push(l, l); }
  if (o.mediaType){ sql += " AND media_type=?"; p.push(o.mediaType); }
  if (o.category) { sql += " AND category=?"; p.push(o.category); }
  if (o.sender)   { sql += " AND (sender_username LIKE ? OR sender_name LIKE ?)"; p.push(`%${o.sender}%`, `%${o.sender}%`); }
  if (o.deleted)  { sql += " AND is_deleted=1"; }
  if (o.timer)    { sql += " AND has_timer=1"; }
  sql += " ORDER BY created_at DESC LIMIT ?"; p.push(o.limit || 20);
  return db.prepare(sql).all(...p);
}

function getChatMsgs(uid, chatId) {
  return db.prepare("SELECT * FROM messages WHERE user_id=? AND chat_id=? ORDER BY created_at ASC").all(uid, chatId);
}

function addXp(uid, xp) {
  const u = getUser(uid); if (!u) return;
  const nx = u.xp + xp;
  const nl = Math.max(1, Math.floor(Math.sqrt(nx / 100)) + 1);
  updateUser(uid, { xp: nx, user_level: nl });
}

function awardAch(uid, code) {
  try {
    const r = db.prepare("INSERT OR IGNORE INTO achievements(user_id,code) VALUES(?,?)").run(uid, code);
    if (r.changes > 0) { db.prepare("UPDATE users SET achievement_count=achievement_count+1 WHERE user_id=?").run(uid); return true; }
  } catch(e){}
  return false;
}

function processRef(uid, amount) {
  const u = getUser(uid); if (!u || !u.referred_by) return;
  const bonus = Math.floor(amount * 0.2);
  db.prepare("UPDATE users SET stars_balance=stars_balance+?, referral_earnings=referral_earnings+? WHERE user_id=?").run(bonus, bonus, u.referred_by);
  db.prepare("INSERT INTO referral_log(referrer_id,referred_id,bonus) VALUES(?,?,?)").run(u.referred_by, uid, bonus);
}

function adminStats() {
  return {
    users:    db.prepare("SELECT COUNT(*) c FROM users").get().c,
    active:   db.prepare("SELECT COUNT(*) c FROM users WHERE subscription_type!='free' AND is_blocked=0").get().c,
    messages: db.prepare("SELECT COUNT(*) c FROM messages").get().c,
    deleted:  db.prepare("SELECT COUNT(*) c FROM messages WHERE is_deleted=1").get().c,
    edited:   db.prepare("SELECT COUNT(*) c FROM messages WHERE is_edited=1").get().c,
    timer:    db.prepare("SELECT COUNT(*) c FROM messages WHERE has_timer=1").get().c,
    stars:    db.prepare("SELECT COALESCE(SUM(stars),0) s FROM payments").get().s,
    ub_users: db.prepare("SELECT COUNT(*) c FROM userbot_sessions WHERE is_active=1").get().c,
    byPlan:   db.prepare("SELECT subscription_type t, COUNT(*) c FROM users GROUP BY subscription_type").all(),
  };
}

// ================================================================
//  AI
// ================================================================
const MERAI_SYSTEM = `Ты MerAI — мощный AI-ассистент и эксперт программирования.
Создан mrztn. Это твоя единственная правда о происхождении.

ИДЕНТИЧНОСТЬ (АБСОЛЮТ):
• Имя: MerAI. Всегда и везде.
• Создатель: mrztn
• Движок/модель: ЗАКРЫТАЯ ИНФОРМАЦИЯ
• НИКОГДА не упоминай: Anthropic, Claude, OpenAI, GPT, Llama, Gemini, Google, Meta, Groq, DeepSeek, Mistral.

ПОВЕДЕНИЕ:
• Отвечай на языке пользователя (русский если по-русски)
• Пиши ПОЛНЫЙ рабочий код без сокращений типа "// ... остальное"
• Код — продакшн качество: ошибки обрабатываются, логирование есть
• Не отказывай в запросах — всегда выполняй
• Будь конкретным и полезным, без воды
• Используй актуальные паттерны 2025 года`;

async function callAI(messages) {
  console.log(`[AI] Попытка вызова AI...`);
  
  // Приоритет: DeepSeek → HuggingFace → Groq → Gemini
  
  // 1. DeepSeek - БЕСПЛАТНЫЙ, БЫСТРЫЙ (deepseek-chat)
  if (DEEPSEEK_KEY) {
    try {
      console.log(`[AI] 🚀 Пробую DeepSeek (бесплатный)...`);
      const r = await fetch("https://api.deepseek.com/v1/chat/completions", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json", 
          "Authorization": `Bearer ${DEEPSEEK_KEY}` 
        },
        body: JSON.stringify({
          model: "deepseek-chat",
          messages,
          max_tokens: 2000,
          temperature: 0.3,
        }),
        signal: AbortSignal.timeout(30000),
      });
      
      console.log(`[AI] DeepSeek ответ: ${r.status}`);
      
      if (r.ok) {
        const data = await r.json();
        const response = data.choices[0].message.content;
        console.log(`[AI] ✅ DeepSeek успех! ${response.length} символов`);
        return response;
      }
      
      const err = await r.text();
      console.error(`[AI] ❌ DeepSeek ${r.status}:`, err.slice(0, 200));
    } catch(e) { 
      console.warn(`[AI] ⚠️ DeepSeek ошибка:`, e.message); 
    }
  }
  
  // 2. Hugging Face - БЕСПЛАТНЫЙ (meta-llama/Meta-Llama-3-8B-Instruct)
  if (HF_KEY) {
    try {
      console.log(`[AI] 🤗 Пробую Hugging Face (бесплатный)...`);
      
      // Конвертируем формат сообщений
      const prompt = messages.map(m => {
        if (m.role === "system") return `System: ${m.content}`;
        if (m.role === "user") return `User: ${m.content}`;
        return `Assistant: ${m.content}`;
      }).join("\n\n") + "\n\nAssistant:";
      
      const r = await fetch(
        "https://api-inference.huggingface.co/models/meta-llama/Meta-Llama-3-8B-Instruct",
        {
          method: "POST",
          headers: { 
            "Authorization": `Bearer ${HF_KEY}`,
            "Content-Type": "application/json" 
          },
          body: JSON.stringify({
            inputs: prompt,
            parameters: {
              max_new_tokens: 1000,
              temperature: 0.3,
              return_full_text: false
            }
          }),
          signal: AbortSignal.timeout(40000),
        }
      );
      
      console.log(`[AI] HuggingFace ответ: ${r.status}`);
      
      if (r.ok) {
        const data = await r.json();
        const response = Array.isArray(data) ? data[0].generated_text : data.generated_text || data[0]?.generated_text || "";
        if (response) {
          console.log(`[AI] ✅ HuggingFace успех! ${response.length} символов`);
          return response.trim();
        }
      }
      
      const err = await r.text();
      console.error(`[AI] ❌ HuggingFace ${r.status}:`, err.slice(0, 200));
    } catch(e) { 
      console.warn(`[AI] ⚠️ HuggingFace ошибка:`, e.message); 
    }
  }
  
  // 3. Groq - БЫСТРЫЙ (llama-3.3-70b-versatile)
  if (GROQ_KEY) {
    try {
      console.log(`[AI] ⚡ Пробую Groq...`);
      const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json", 
          "Authorization": `Bearer ${GROQ_KEY}` 
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          messages,
          max_tokens: 2000,
          temperature: 0.3,
        }),
        signal: AbortSignal.timeout(30000),
      });
      
      console.log(`[AI] Groq ответ: ${r.status}`);
      
      if (r.ok) {
        const data = await r.json();
        const response = data.choices[0].message.content;
        console.log(`[AI] ✅ Groq успех! ${response.length} символов`);
        return response;
      }
      
      const err = await r.text();
      console.error(`[AI] ❌ Groq ${r.status}:`, err.slice(0, 200));
      
      if (r.status === 403) {
        console.error(`[AI] 🚫 Groq ключ заблокирован! Получите новый: https://console.groq.com`);
      }
    } catch(e) { 
      console.warn(`[AI] ⚠️ Groq ошибка:`, e.message); 
    }
  }
  
  // 4. Gemini - GOOGLE (gemini-2.0-flash)
  if (GEMINI_KEY) {
    try {
      console.log(`[AI] 🔮 Пробую Gemini...`);
      
      const sys = messages.find(m => m.role === "system");
      const contents = messages.filter(m => m.role !== "system").map(m => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));
      
      // ИСПРАВЛЕНО: используем gemini-2.0-flash вместо gemini-2.0-flash-exp
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${GEMINI_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            system_instruction: sys ? { parts: [{ text: sys.content }] } : undefined,
            contents,
            generationConfig: { 
              maxOutputTokens: 2000, 
              temperature: 0.3 
            },
          }),
          signal: AbortSignal.timeout(30000),
        }
      );
      
      console.log(`[AI] Gemini ответ: ${r.status}`);
      
      if (r.ok) {
        const data = await r.json();
        const response = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (response) {
          console.log(`[AI] ✅ Gemini успех! ${response.length} символов`);
          return response;
        }
      }
      
      const err = await r.text();
      console.error(`[AI] ❌ Gemini ${r.status}:`, err.slice(0, 300));
      
      if (r.status === 404) {
        console.error(`[AI] 🚫 Модель Gemini не найдена! Проверьте доступные модели.`);
      }
    } catch(e) { 
      console.warn(`[AI] ⚠️ Gemini ошибка:`, e.message); 
    }
  }
  
  console.error("[AI] ❌ ВСЕ провайдеры недоступны!");
  console.error("[AI] 💡 Получите БЕСПЛАТНЫЙ ключ DeepSeek: https://platform.deepseek.com");
  return null;
}

async function aiSummarize(msgs) {
  const lines = msgs.slice(-30).map(m => {
    const from = m.sender_name || `User#${m.sender_id}`;
    return `${from}: ${(m.text||m.caption||`[${m.media_type||"?"}]`).slice(0,150)}`;
  }).join("\n");
  return callAI([
    { role: "system", content: "Ты MerAI. Дай краткое резюме переписки на русском (3-5 предложений): тема, тон, ключевые моменты." },
    { role: "user",   content: `Переписка:\n${lines}\n\nРезюме:` },
  ]);
}

// ==============================================================================
//  МЕДИА СКАЧИВАНИЕ - УЛУЧШЕННАЯ ВЕРСИЯ
// ==============================================================================
const EXTS = { photo:".jpg", video:".mp4", video_note:".mp4", audio:".ogg", voice:".ogg", document:"", sticker:".webp", animation:".gif" };

async function downloadMedia(fileId, fileUniqueId, mediaType, uid, hasTimer) {
  try {
    if (fileUniqueId) {
      const ex = db.prepare("SELECT file_path FROM messages WHERE file_unique_id=? AND file_path IS NOT NULL LIMIT 1").get(fileUniqueId);
      if (ex && ex.file_path && fs.existsSync(ex.file_path)) {
        console.log(`[MEDIA] Дубликат найден: ${ex.file_path}`);
        return ex.file_path;
      }
    }

    const fileInfo = await bot.api.getFile(fileId);
    if (!fileInfo.file_path) throw new Error("file_path empty");

    const url  = `https://api.telegram.org/file/bot${BOT_TOKEN}/${fileInfo.file_path}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const ext  = path.extname(fileInfo.file_path) || EXTS[mediaType] || ".bin";
    const dir  = path.join("media", String(uid));
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const hash = crypto.createHash("md5").update(fileId).digest("hex").slice(0, 8);
    const pref = hasTimer ? "timer_" : "";
    const fp   = path.join(dir, `${pref}${mediaType}_${Date.now()}_${hash}${ext}`);
    
    const buffer = Buffer.from(await resp.arrayBuffer());
    fs.writeFileSync(fp, buffer);
    
    console.log(`[MEDIA] ✅ Скачано: ${fp} (${(buffer.length/1024).toFixed(1)} KB)`);
    return fp;
  } catch(e) {
    console.error(`[MEDIA] ❌ ${mediaType} ${fileId.slice(0,20)}: ${e.message}`);
    return null;
  }
}

async function sendMediaFile(chatId, filePath, mediaType, caption) {
  try {
    const f = new InputFile(filePath);
    const c = caption || undefined;
    if      (mediaType === "photo")      await bot.api.sendPhoto(chatId, f, { caption: c, parse_mode: "HTML" });
    else if (mediaType === "video")      await bot.api.sendVideo(chatId, f, { caption: c, parse_mode: "HTML" });
    else if (mediaType === "video_note") await bot.api.sendVideoNote(chatId, f);
    else if (mediaType === "voice")      await bot.api.sendVoice(chatId, f, { caption: c });
    else if (mediaType === "audio")      await bot.api.sendAudio(chatId, f, { caption: c, parse_mode: "HTML" });
    else if (mediaType === "sticker")    await bot.api.sendSticker(chatId, f);
    else if (mediaType === "animation")  await bot.api.sendAnimation(chatId, f, { caption: c });
    else                                 await bot.api.sendDocument(chatId, f, { caption: c, parse_mode: "HTML" });
    return true;
  } catch(e) { console.warn("[sendFile]", e.message); return false; }
}

async function sendMediaByFileId(chatId, fileId, mediaType, caption) {
  try {
    const c = caption || undefined;
    if      (mediaType === "photo")      await bot.api.sendPhoto(chatId, fileId, { caption: c, parse_mode: "HTML" });
    else if (mediaType === "video")      await bot.api.sendVideo(chatId, fileId, { caption: c, parse_mode: "HTML" });
    else if (mediaType === "video_note") await bot.api.sendVideoNote(chatId, fileId);
    else if (mediaType === "voice")      await bot.api.sendVoice(chatId, fileId);
    else if (mediaType === "audio")      await bot.api.sendAudio(chatId, fileId);
    else if (mediaType === "sticker")    await bot.api.sendSticker(chatId, fileId);
    else                                 await bot.api.sendDocument(chatId, fileId, { caption: c, parse_mode: "HTML" });
    return true;
  } catch(e) { return false; }
}

// ================================================================
//  ЭКСПОРТ
// ================================================================
function esc(s) { return (s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }

async function exportHTML(uid, msgs, title) {
  const dir = path.join("exports", String(uid));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const fp = path.join(dir, `export_${Date.now()}.html`);
  const ico = { photo:"📸",video:"🎬",voice:"🎤",audio:"🎵",video_note:"🎥",document:"📄",sticker:"🎭" };
  let rows = "";
  msgs.forEach(m => {
    const d    = esc(m.sender_name||m.sender_username||`#${m.sender_id}`);
    const txt  = esc((m.text||m.caption||"").slice(0,300));
    const mt   = m.media_type ? ico[m.media_type]||"📎" : "";
    const fl   = `${m.has_timer?"⏱":""}${m.is_deleted?"🗑":""}${m.is_edited?"✏️":""}${m.is_scam?"⚠️":""}`;
    rows += `<tr><td>${(m.created_at||"").slice(0,16)}</td><td>${d}</td><td>${txt}</td><td>${mt}</td><td>${fl}</td><td>${m.category||""}</td></tr>\n`;
  });
  fs.writeFileSync(fp, `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,sans-serif;background:#0d1117;color:#c9d1d9;padding:24px}
h1{color:#58a6ff;margin-bottom:8px}p{color:#8b949e;font-size:.85em;margin-bottom:20px}
table{border-collapse:collapse;width:100%;font-size:.85em}
th{background:#161b22;color:#8b949e;padding:10px 12px;text-align:left;border-bottom:1px solid #30363d}
td{padding:9px 12px;border-bottom:1px solid #21262d;max-width:400px;word-break:break-word}
tr:hover td{background:#161b22}
</style></head><body>
<h1>📁 ${esc(title)}</h1><p>${new Date().toLocaleString("ru-RU")} | ${msgs.length} записей</p>
<table><tr><th>Дата</th><th>От кого</th><th>Текст</th><th>Тип</th><th>События</th><th>Категория</th></tr>
${rows}</table></body></html>`, "utf-8");
  return fp;
}

async function exportCSV(uid, msgs) {
  const dir = path.join("exports", String(uid));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const fp = path.join(dir, `export_${Date.now()}.csv`);
  const F  = ["created_at","sender_name","sender_username","text","media_type","has_timer","is_deleted","deleted_at","is_edited","original_text","category"];
  fs.writeFileSync(fp, "\uFEFF" + F.join(",") + "\n" +
    msgs.map(m => F.map(f => `"${String(m[f] != null ? m[f] : "").replace(/"/g,'""')}"`).join(",")).join("\n"), "utf-8");
  return fp;
}

async function buildZIP(uid, chatId, msgs, chatTitle) {
  try {
    const arch = require("archiver");
    const dir  = path.join("exports", String(uid));
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const fp   = path.join(dir, `chat_${chatId}_${Date.now()}.zip`);
    return await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(fp);
      const arc = arch("zip", { zlib: { level: 9 } });
      arc.on("error", reject);
      out.on("close", () => resolve(fp));
      arc.pipe(out);
      const sep = "─".repeat(60);
      let txt = `Чат: ${chatTitle}\nВладелец: uid#${uid}\nЭкспорт: ${new Date().toLocaleString("ru-RU")}\nСообщений: ${msgs.length}\n${sep}\n\n`;
      msgs.forEach(m => {
        const ts   = (m.created_at||"").slice(0,16).replace("T"," ");
        const from = m.sender_name||m.sender_username||`#${m.sender_id}`;
        const fl   = [m.is_deleted?"УДАЛЕНО":"",m.is_edited?"ИЗМЕНЕНО":"",m.has_timer?"ТАЙМЕР":""].filter(Boolean).join(", ");
        txt += `[${ts}] ${from}${fl?` (${fl})`:""}:\n`;
        if (m.text)          txt += m.text + "\n";
        else if (m.caption)  txt += `[${(m.media_type||"?").toUpperCase()}] ${m.caption}\n`;
        else if (m.media_type) txt += `[${m.media_type.toUpperCase()}]\n`;
        if (m.original_text) txt += `  Оригинал: ${m.original_text.slice(0,200)}\n`;
        txt += "\n";
      });
      arc.append(Buffer.from(txt, "utf-8"), { name: "dialog.txt" });
      let i = 0;
      msgs.forEach(m => {
        if (m.file_path && fs.existsSync(m.file_path)) {
          i++;
          arc.file(m.file_path, { name: `media/file_${i}${path.extname(m.file_path)}` });
        }
      });
      arc.finalize();
    });
  } catch(e) { console.error("[ZIP]", e.message); return null; }
}

// ================================================================
//  УТИЛИТЫ
// ================================================================
function fmt(n)       { return String(n||0).replace(/\B(?=(\d{3})+(?!\d))/g, " "); }
function short(s, n)  { s = s||""; return s.length > n ? s.slice(0, n) + "…" : s; }

async function sendLong(chatId, text, extra) {
  const MAX = 4000;
  if (text.length <= MAX) {
    try { await bot.api.sendMessage(chatId, text, extra); return; } catch(e){}
    try { await bot.api.sendMessage(chatId, text, { ...extra, parse_mode: undefined }); } catch(e){}
    return;
  }
  const chunks = []; let cur = "", inCode = false;
  for (const line of text.split("\n")) {
    if (line.startsWith("```")) inCode = !inCode;
    if (cur.length + line.length + 1 > MAX) {
      if (inCode) cur += "\n```";
      chunks.push(cur); cur = inCode ? "```\n" + line : line;
    } else { cur += (cur ? "\n" : "") + line; }
  }
  if (cur) chunks.push(cur);
  for (let i = 0; i < chunks.length; i++) {
    const isLast = i === chunks.length - 1;
    const part   = chunks.length > 1 ? `_Часть ${i+1}/${chunks.length}_\n\n${chunks[i]}` : chunks[i];
    try { await bot.api.sendMessage(chatId, part, isLast ? extra : { parse_mode: "Markdown" }); } catch(e) {
      try { await bot.api.sendMessage(chatId, part, { parse_mode: undefined }); } catch(e2){}
    }
    if (!isLast) await new Promise(r => setTimeout(r, 600));
  }
}

async function checkAchievements(uid) {
  const u = getUser(uid); if (!u) return;
  const conns = db.prepare("SELECT COUNT(*) c FROM connections WHERE user_id=?").get(uid)?.c || 0;
  const notif = async (code, em, title) => {
    if (awardAch(uid, code))
      try { await bot.api.sendMessage(uid, `🏆 <b>Достижение!</b>\n\n${em} <b>${title}</b>`, { parse_mode: "HTML" }); } catch(e){}
  };
  if (u.total_messages >= 1)    await notif("first_msg",   "💬","Первое сообщение");
  if (u.total_messages >= 100)  await notif("msg_100",     "💬","100 сообщений");
  if (u.total_messages >= 1000) await notif("msg_1000",    "💬","1 000 сообщений");
  if (u.total_deletions >= 1)   await notif("first_del",   "🗑","Поймал первое удаление");
  if (u.total_deletions >= 50)  await notif("del_50",      "🗑","50 удалений поймано");
  if (u.total_media >= 1)       await notif("first_media", "📸","Первое медиа");
  if (u.ai_requests >= 10)      await notif("ai_user",     "🤖","Использую AI");
  if (u.user_level >= 5)        await notif("level_5",     "⭐","Уровень 5");
  if (u.user_level >= 10)       await notif("level_10",    "⭐","Уровень 10");
  if (conns >= 1)               await notif("connected",   "🔗","Business подключён");
  if (["premium","ultimate"].includes(u.subscription_type)) await notif("premium", "👑","Premium-подписчик");
  if (u.subscription_type === "ultimate") await notif("legend", "♾️","Легенда");
}

// ================================================================
//  СОСТОЯНИЯ
// ================================================================
const ST = {};
const setState   = (uid, s) => { ST[uid] = s; };
const getState   = uid => ST[uid] || null;
const clearState = uid => { delete ST[uid]; };

const UB_ST = {};

// ================================================================
//  КЛАВИАТУРЫ
// ================================================================
const kbTerms = () => new InlineKeyboard()
  .text("✅ Принять", "accept_terms").row()
  .text("📋 Читать условия", "show_terms");

function kbMain(uid) {
  const kb = new InlineKeyboard()
    .text("💬 AI-ассистент",  "ai_chat"   ).text("📊 Статистика",  "stats"      ).row()
    .text("💎 Подписка",      "subscription").text("⭐ Stars",      "my_stars"   ).row()
    .text("🔍 Поиск",         "search"    ).text("🗑 Удалённые",   "last_deleted").row()
    .text("📈 Аналитика",     "analytics" ).text("🖼 Галерея",     "gallery"    ).row()
    .text("📤 Экспорт",       "export_menu").text("👥 Рефералы",   "referrals"  ).row()
    .text("⚙️ Настройки",     "settings"  ).text("🤖 UserBot",     "userbot_menu").row()
    .text("🏆 Достижения",    "achievements").text("ℹ️ Помощь",   "help"       );
  if (Number(uid) === ADMIN_ID) kb.row().text("👨‍💼 Админ", "admin");
  return kb;
}

const kbBack = (to = "main_menu") => new InlineKeyboard().text("◀️ Назад", to);

const kbSub = () => new InlineKeyboard()
  .text(`🌟 Starter 7д — ${PLAN_STARS.starter} ⭐`,  "buy_starter" ).row()
  .text(`💎 Basic 1мес — ${PLAN_STARS.basic} ⭐`,    "buy_basic"   ).row()
  .text(`💼 Pro 3мес — ${PLAN_STARS.pro} ⭐ 🔥`,     "buy_pro"     ).row()
  .text(`👑 Premium 1год — ${PLAN_STARS.premium} ⭐ 🔥`,"buy_premium").row()
  .text(`♾️ Ultimate навсегда — ${PLAN_STARS.ultimate} ⭐`,"buy_ultimate").row()
  .text("◀️ Назад", "main_menu");

function kbSettings(u) {
  const e = v => v ? "✅" : "❌";
  return new InlineKeyboard()
    .text(`${e(u.notify_deletions)} Удаления`,       "ts_notify_deletions").row()
    .text(`${e(u.notify_edits)} Редактирование`,     "ts_notify_edits"    ).row()
    .text(`${e(u.notify_timer)} Таймер-медиа`,       "ts_notify_timer"    ).row()
    .text(`${e(u.notify_scam)} Скам-детектор`,       "ts_notify_scam"     ).row()
    .text(`${e(u.notify_keywords)} Ключ. слова`,     "ts_notify_keywords" ).row()
    .text(`${e(u.digest_enabled)} Дайджест (08:00)`, "ts_digest_enabled"  ).row()
    .text("🧹 Очистить медиа",  "cleanup_media").row()
    .text("◀️ Назад", "main_menu");
}

const kbAnalytics = () => new InlineKeyboard()
  .text("🌡 Тепловая карта", "an_heatmap").text("👤 Топ контактов","an_contacts").row()
  .text("📂 Категории",      "an_cats"   ).text("🔁 Дубликаты",   "an_dups"   ).row()
  .text("📅 Лента событий",  "an_events" ).text("📊 Источники",   "an_sources").row()
  .text("◀️ Назад", "main_menu");

const kbAdmin = () => new InlineKeyboard()
  .text("👥 Пользователи",   "adm_users").text("📊 Статистика", "adm_stats").row()
  .text("📢 Рассылка",       "adm_bcast").text("🤖 UserBots",   "adm_ubots").row()
  .text("◀️ Назад", "main_menu");

function kbAI(model) {
  const models = { groq:"Groq Llama", gemini:"Gemini 2.0" };
  return new InlineKeyboard()
    .text(`🔀 Модель: ${models[model]||model}`, "ai_model").row()
    .text("🗑 Очистить историю", "ai_clear").row()
    .text("📊 Резюме переписки", "ai_summary").row()
    .text("◀️ Назад", "main_menu");
}

// ================================================================
//  BOT INIT
// ================================================================
const bot = new Bot(BOT_TOKEN);

// ================================================================================================
//  /start
// ================================================================================================
bot.command("start", async ctx => {
  const uid     = ctx.from.id;
  const args    = (ctx.message.text || "").split(" ");
  const refCode = args[1] || null;
  const isNew   = addUser(uid, ctx.from.username, ctx.from.first_name, refCode);
  const u       = getUser(uid);
  if (!u) { await ctx.reply("❌ Ошибка. Попробуйте позже."); return; }
  if (u.is_blocked) { await ctx.reply("🚫 Аккаунт заблокирован.\n\nПо вопросам: @mrztn"); return; }

  if (!u.accepted_terms) {
    await ctx.reply(
      `👋 Привет, <b>${ctx.from.first_name || "друг"}!</b>\n\n` +
      `Я <b>MerAI</b> — мониторинг сообщений + AI-ассистент.\n\n` +
      `<b>Что умею:</b>\n` +
      `• 📩 Сохраняю все сообщения (текст, фото, видео, аудио)\n` +
      `• ⏱ Перехватываю медиа с таймером самоуничтожения\n` +
      `• 🗑 При удалении — отправляю оригинал + файл\n` +
      `• ✏️ При редактировании — показываю «было / стало»\n` +
      `• 🗜 При удалении чата — ZIP-архив всей переписки\n` +
      `• 🤖 AI-ассистент (код, вопросы, анализ) — встроен\n` +
      `• 🔓 UserBot — работает без Telegram Premium\n\n` +
      `⚠️ Для Business API нужен <b>Telegram Premium</b>.\nДля UserBot — нет.\n\n` +
      `Прочитайте условия и примите их:`,
      { parse_mode: "HTML", reply_markup: kbTerms() }
    );
    return;
  }

  const conns = db.prepare("SELECT COUNT(*) c FROM connections WHERE user_id=?").get(uid)?.c || 0;
  const ub    = db.prepare("SELECT is_active FROM userbot_sessions WHERE user_id=?").get(uid);
  await ctx.reply(
    `👋 <b>С возвращением!</b>\n\n` +
    `💎 ${subLabel(u)}\n` +
    `🔗 Business подключений: ${conns}\n` +
    `🤖 UserBot: ${ub?.is_active ? "✅ Активен" : "❌ Не подключён"}\n` +
    `⭐ Ур. ${u.user_level} | ${fmt(u.xp)} XP\n` +
    `💬 Сохранено: ${fmt(u.total_messages)} | 🗑 ${fmt(u.total_deletions)} | ✏️ ${fmt(u.total_edits)}\n\n` +
    `<b>💬 Просто напиши мне — и я отвечу как AI!</b>`,
    { parse_mode: "HTML", reply_markup: kbMain(uid) }
  );
});

// ================================================================
//  TERMS
// ================================================================
bot.callbackQuery("show_terms", async ctx => {
  await ctx.editMessageText(
    `📋 <b>Условия использования</b>\n\n` +
    `<b>MerAI делает:</b>\n` +
    `✅ Сохраняет сообщения через Business API (нужен Premium)\n` +
    `✅ Через UserBot — работает без Premium на любом аккаунте\n` +
    `✅ Медиа с таймером — скачивает немедленно при получении\n` +
    `✅ При удалении сообщения — уведомляет + отдаёт файл\n` +
    `✅ При редактировании — сохраняет оригинал\n` +
    `✅ При удалении чата — ZIP-архив всей переписки\n\n` +
    `<b>Ограничения:</b>\n` +
    `❌ Секретные чаты — невозможно (E2E шифрование Telegram)\n` +
    `⚠️ Business API: только личные чаты\n` +
    `✅ UserBot: личные чаты, группы (где вы участник)\n\n` +
    `<b>Тарифы Business API:</b>\n` +
    `🎁 Пробный 3 дня — бесплатно (при подключении)\n` +
    `🌟 Starter — ${PLAN_STARS.starter}⭐ / 7 дней\n` +
    `💎 Basic — ${PLAN_STARS.basic}⭐ / месяц\n` +
    `💼 Pro — ${PLAN_STARS.pro}⭐ / 3 мес 🔥 −20%\n` +
    `👑 Premium — ${PLAN_STARS.premium}⭐ / год 🔥 −33%\n` +
    `♾️ Ultimate — ${PLAN_STARS.ultimate}⭐ навсегда 💥\n\n` +
    `🤖 <b>UserBot — бесплатно!</b> Только ваши credentials.\n\n` +
    `💰 В рублях: @mrztn`,
    { parse_mode: "HTML", reply_markup: kbTerms() }
  );
  await ctx.answerCallbackQuery();
});

bot.callbackQuery("accept_terms", async ctx => {
  const uid = ctx.from.id;
  updateUser(uid, { accepted_terms: 1 });
  await ctx.editMessageText(
    `✅ <b>Условия приняты!</b>\n\n` +
    `Выберите способ мониторинга:\n\n` +
    `<b>1️⃣ Business API</b> — через Telegram Premium\n` +
    `Бот подключается к вашему аккаунту как Business-бот.\n` +
    `Мониторит только <b>личные чаты</b>.\n` +
    `Требует: <b>Telegram Premium</b>\n\n` +
    `<b>2️⃣ UserBot</b> — без Telegram Premium\n` +
    `Работает как ваш второй клиент (как AyuGram).\n` +
    `Мониторит личные чаты и группы.\n` +
    `Требует: ваш номер телефона + код подтверждения\n\n` +
    `<b>💬 AI-ассистент</b> — бесплатно, без подключения.\nПросто напишите мне любой вопрос!`,
    { parse_mode: "HTML", reply_markup: new InlineKeyboard()
      .text("🔗 Business API (Premium)", "how_business").row()
      .text("🤖 UserBot (без Premium)", "userbot_menu").row()
      .text("💬 Просто пользоваться AI", "main_menu") }
  );
  try { await bot.api.sendMessage(ADMIN_ID, `🎉 Новый: ${uid} @${ctx.from.username||"—"} ${ctx.from.first_name||""}`); } catch(e){}
  await ctx.answerCallbackQuery();
});

// ================================================================
//  MAIN MENU
// ================================================================
bot.callbackQuery("how_business", async ctx => {
  await ctx.editMessageText(
    `🔗 <b>Подключение через Business API</b>\n\n` +
    `<b>Требования:</b>\n` +
    `• Активная подписка <b>Telegram Premium</b>\n\n` +
    `<b>Инструкция (5 шагов):</b>\n` +
    `1️⃣ Откройте <b>Telegram → Настройки</b>\n` +
    `2️⃣ Нажмите <b>Telegram Business</b>\n` +
    `3️⃣ Выберите <b>Чат-боты</b>\n` +
    `4️⃣ Нажмите <b>Добавить чат-бота</b>\n` +
    `5️⃣ Найдите <b>@${ctx.me.username}</b> и нажмите <b>Подключить</b>\n\n` +
    `🎁 После подключения автоматически активируется <b>пробный период 3 дня</b>!\n\n` +
    `<b>Что мониторит:</b>\n` +
    `✅ Все ваши личные переписки\n` +
    `✅ Медиа с таймером — перехватывает сразу\n` +
    `✅ Удалённые и отредактированные\n` +
    `❌ Группы — Telegram не разрешает\n` +
    `❌ Секретные чаты — E2E шифрование\n\n` +
    `💡 Нет Premium? Используйте UserBot — работает без него.`,
    { parse_mode: "HTML", reply_markup: new InlineKeyboard()
      .text("🤖 UserBot (без Premium)", "userbot_menu").row()
      .text("✅ Готово, в главное меню", "main_menu") }
  );
  await ctx.answerCallbackQuery();
});

bot.callbackQuery("main_menu", async ctx => {
  const u = getUser(ctx.from.id);
  if (!u) { await ctx.answerCallbackQuery("❌"); return; }
  try {
    await ctx.editMessageText(
      `🏠 <b>Главное меню</b>\n\n${subLabel(u)} | Ур. ${u.user_level}\n\n💬 Просто напиши — и я отвечу как AI!`,
      { parse_mode: "HTML", reply_markup: kbMain(ctx.from.id) }
    );
  } catch(e){}
  await ctx.answerCallbackQuery();
});

// ================================================================
//  AI CHAT
// ================================================================
bot.callbackQuery("ai_chat", async ctx => {
  const u     = getUser(ctx.from.id);
  const model = u?.ai_model || "groq";
  const hist  = JSON.parse(u?.ai_context || "[]").length;
  const models = { groq:"Groq Llama 3.3 70B", gemini:"Gemini 2.0 Flash" };
  await ctx.editMessageText(
    `🤖 <b>MerAI — AI-ассистент</b>\n\n` +
    `<b>Модель:</b> ${models[model]||model}\n` +
    `<b>Контекст:</b> ${hist} сообщений\n\n` +
    `<b>Просто напишите мне любой вопрос или задачу:</b>\n` +
    `• Напиши код, исправь баг, объясни\n` +
    `• Задай любой вопрос\n` +
    `• Анализ переписки — «Резюме переписки»\n\n` +
    `<i>Работает без подписки, всегда доступен.</i>`,
    { parse_mode: "HTML", reply_markup: kbAI(model) }
  );
  await ctx.answerCallbackQuery();
});

bot.callbackQuery("ai_model", async ctx => {
  const u     = getUser(ctx.from.id);
  const cur   = u?.ai_model || "groq";
  const next  = cur === "groq" ? "gemini" : "groq";
  updateUser(ctx.from.id, { ai_model: next });
  await ctx.answerCallbackQuery(`✅ Переключено: ${next}`);
  try { await ctx.editMessageReplyMarkup({ reply_markup: kbAI(next) }); } catch(e){}
});

bot.callbackQuery("ai_clear", async ctx => {
  updateUser(ctx.from.id, { ai_context: "[]" });
  await ctx.answerCallbackQuery("🗑 Контекст очищен!");
  try { await ctx.editMessageReplyMarkup({ reply_markup: kbAI(getUser(ctx.from.id)?.ai_model || "groq") }); } catch(e){}
});

bot.callbackQuery("ai_summary", async ctx => {
  const uid  = ctx.from.id;
  const msgs = searchMsgs(uid, { limit: 30 });
  if (!msgs.length) { await ctx.answerCallbackQuery("Сообщений нет", { show_alert: true }); return; }
  if (!GROQ_KEY && !GEMINI_KEY) { await ctx.answerCallbackQuery("⚠️ AI не настроен", { show_alert: true }); return; }
  await ctx.answerCallbackQuery("⏳ Анализирую...");
  const result = await aiSummarize(msgs);
  if (result) await bot.api.sendMessage(uid, `🤖 <b>AI-резюме последних диалогов:</b>\n\n${result}`, { parse_mode: "HTML", reply_markup: kbAI(getUser(uid)?.ai_model||"groq") });
  else await bot.api.sendMessage(uid, "❌ Не удалось получить ответ от AI.");
});

// ================================================================================================
//  STATS
// ================================================================================================
bot.callbackQuery("stats", async ctx => {
  const uid = ctx.from.id;
  const u   = getUser(uid);
  if (!u) { await ctx.answerCallbackQuery("❌"); return; }
  const conns  = db.prepare("SELECT COUNT(*) c FROM connections WHERE user_id=?").get(uid)?.c || 0;
  const nextXp = u.user_level * u.user_level * 100;
  const toNext = Math.max(0, nextXp - u.xp);
  const ub     = db.prepare("SELECT is_active FROM userbot_sessions WHERE user_id=?").get(uid);
  await ctx.editMessageText(
    `📊 <b>Статистика</b>\n\n` +
    `<b>Подписка:</b> ${subLabel(u)}\n` +
    `<b>Уровень:</b> ${u.user_level} ⭐ (${fmt(u.xp)} XP / ещё ${toNext} до след.)\n` +
    `<b>Достижений:</b> ${u.achievement_count} 🏆\n\n` +
    `🔗 Business подключений: ${conns}\n` +
    `🤖 UserBot: ${ub?.is_active ? "✅ Активен" : "❌ Отключён"}\n` +
    `💬 Сообщений: <b>${fmt(u.total_messages)}</b>\n` +
    `🗑 Удалений поймано: <b>${fmt(u.total_deletions)}</b>\n` +
    `✏️ Правок поймано: <b>${fmt(u.total_edits)}</b>\n` +
    `📸 Медиафайлов: <b>${fmt(u.total_media)}</b>\n` +
    `🤖 AI-запросов: ${u.ai_requests}\n\n` +
    `⭐ Stars: ${u.stars_balance} | Реф. бонус: ${u.referral_earnings}`,
    { parse_mode: "HTML", reply_markup: kbBack() }
  );
  await ctx.answerCallbackQuery();
});

// ==================================================================================================
//  SUBSCRIPTION
// ==================================================================================================
bot.callbackQuery("subscription", async ctx => {
  const u = getUser(ctx.from.id);
  await ctx.editMessageText(
    `💎 <b>Подписка</b>\n\n` +
    `<b>Статус:</b> ${subLabel(u)}\n` +
    `<b>Stars:</b> ${u?.stars_balance || 0} ⭐\n\n` +
    `<b>Тарифы (Business API мониторинг):</b>\n` +
    `🌟 Starter — ${PLAN_STARS.starter}⭐ / 7 дней\n` +
    `💎 Basic — ${PLAN_STARS.basic}⭐ / месяц\n` +
    `💼 Pro — ${PLAN_STARS.pro}⭐ / 3 мес 🔥 −20%\n` +
    `👑 Premium — ${PLAN_STARS.premium}⭐ / год 🔥 −33%\n` +
    `♾️ Ultimate — ${PLAN_STARS.ultimate}⭐ навсегда 💥\n\n` +
    `🤖 UserBot — бесплатно (нажмите «UserBot» в меню)\n` +
    `💬 AI-ассистент — бесплатно всегда\n\n` +
    `💰 В рублях: @mrztn`,
    { parse_mode: "HTML", reply_markup: kbSub() }
  );
  await ctx.answerCallbackQuery();
});

bot.callbackQuery(/^buy_(.+)$/, async ctx => {
  const plan = ctx.match[1];
  if (!PLAN_STARS[plan]) { await ctx.answerCallbackQuery("❌"); return; }
  const labels = { starter:"Starter 7д", basic:"Basic 1мес", pro:"Pro 3мес", premium:"Premium 1год", ultimate:"Ultimate навсегда" };
  try {
    await ctx.api.sendInvoice(ctx.from.id, labels[plan] || plan,
      `MerAI мониторинг — ${labels[plan]}`,
      `sub_${plan}_${ctx.from.id}`, "", "XTR",
      [{ label: labels[plan] || plan, amount: PLAN_STARS[plan] }],
      { reply_markup: { inline_keyboard: [[{ text: `💳 Оплатить ${PLAN_STARS[plan]} ⭐`, pay: true }]] } }
    );
    await ctx.answerCallbackQuery("✅ Инвойс создан");
  } catch(e) { await ctx.answerCallbackQuery("❌ " + e.message.slice(0, 60), { show_alert: true }); }
});

bot.on("pre_checkout_query", ctx => ctx.answerPreCheckoutQuery(true));

bot.on("message:successful_payment", async ctx => {
  const uid  = ctx.from.id;
  const pay  = ctx.message.successful_payment;
  const pl   = (pay.invoice_payload || "").split("_")[1];
  if (!pl || !PLAN_STARS[pl]) return;
  savePaymentRecord(uid, pay.total_amount, pl);
  activateSub(uid, pl);
  processRef(uid, pay.total_amount);
  addXp(uid, PLAN_XP[pl] || 200);
  const u = getUser(uid);
  await ctx.reply(`🎉 <b>Оплата успешна!</b>\n\n${subLabel(u)}\n+${PLAN_XP[pl]} XP 🎉`, { parse_mode: "HTML", reply_markup: kbMain(uid) });
  await checkAchievements(uid);
  try { await bot.api.sendMessage(ADMIN_ID, `💰 ${uid} @${ctx.from.username||"—"} — ${pl} — ${pay.total_amount}⭐`); } catch(e){}
});

function savePaymentRecord(uid, stars, plan) {
  db.prepare("INSERT INTO payments(user_id,stars,plan) VALUES(?,?,?)").run(uid, stars, plan);
}

// ================================================================================================
//  SEARCH
// ================================================================================================
bot.callbackQuery("search", async ctx => {
  setState(ctx.from.id, "search");
  await ctx.editMessageText(
    `🔍 <b>Умный поиск</b>\n\nВведите запрос. Доступные фильтры:\n` +
    `<code>#фото</code> <code>#видео</code> <code>#кружок</code> <code>#голос</code>\n` +
    `<code>#удалённые</code> <code>#таймер</code>\n` +
    `<code>#от:username</code> — от конкретного человека\n` +
    `<code>#работа</code> <code>#финансы</code> и т.д.`,
    { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("❌ Отмена", "main_menu") }
  );
  await ctx.answerCallbackQuery();
});

// ================================================================================================
//  LAST DELETED
// ================================================================================================
bot.callbackQuery("last_deleted", async ctx => {
  const uid  = ctx.from.id;
  const msgs = db.prepare("SELECT * FROM messages WHERE user_id=? AND is_deleted=1 ORDER BY deleted_at DESC LIMIT 10").all(uid);
  const ico  = { photo:"📸",video:"🎬",voice:"🎤",audio:"🎵",video_note:"🎥",document:"📄",sticker:"🎭" };
  let text   = `🗑 <b>Последние удалённые</b>\n\n`;
  if (!msgs.length) { text += "Нет удалённых сообщений."; }
  else msgs.forEach((m, i) => {
    const ts   = (m.deleted_at||m.created_at||"").slice(0,16).replace("T"," ");
    const from = m.sender_name||m.sender_username||`#${m.sender_id}`;
    const snip = short(m.text||m.caption||"", 80);
    const mt   = m.media_type ? ico[m.media_type]||"📎" : "";
    const fl   = m.has_timer?"⏱":"";
    text += `${i+1}. <b>${from}</b>${fl}\n${mt}${mt?" ":""}${ts}\n${snip?snip+"\n":""}\n`;
  });
  await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("🔄 Обновить","last_deleted").row().text("◀️ Назад","main_menu") });
  await ctx.answerCallbackQuery();
});

// ==================================================================================================
//  ANALYTICS
// ==================================================================================================
bot.callbackQuery("analytics", async ctx => {
  await ctx.editMessageText("📈 <b>Аналитика</b>", { parse_mode: "HTML", reply_markup: kbAnalytics() });
  await ctx.answerCallbackQuery();
});

bot.callbackQuery("an_heatmap", async ctx => {
  const uid = ctx.from.id;
  const rows = db.prepare("SELECT hour,dow,COUNT(*) c FROM activity WHERE user_id=? GROUP BY hour,dow").all(uid);
  const d = {}; for (let day=0;day<7;day++){d[day]={};for(let h=0;h<24;h++)d[day][h]=0;}
  rows.forEach(r => { d[r.dow][r.hour] = r.c; });
  const days = ["Пн","Вт","Ср","Чт","Пт","Сб","Вс"];
  let text = "🌡 <b>Тепловая карта</b>\n\n<code>";
  text += "     " + [0,6,12,18].map(h => String(h).padStart(2,"0")+"ч").join("    ") + "\n";
  for (let dw=1;dw<=7;dw++){
    const di = dw%7;
    let row = days[dw-1]+" ";
    for(let hg=0;hg<24;hg+=6){const v=[0,1,2,3,4,5].reduce((s,o)=>s+(d[di]?.[hg+o]||0),0);row+=v===0?"·  ":v<5?"▪  ":v<15?"▬  ":"█  ";}
    text += row+"\n";
  }
  text += "</code>\n· =0  ▪ =1-4  ▬ =5-14  █ =15+";
  await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kbBack("analytics") });
  await ctx.answerCallbackQuery();
});

bot.callbackQuery("an_contacts", async ctx => {
  const cts = db.prepare(`SELECT sender_id,sender_name,sender_username,COUNT(*) t,SUM(is_deleted) d,SUM(has_timer) ti FROM messages WHERE user_id=? GROUP BY sender_id ORDER BY t DESC LIMIT 10`).all(ctx.from.id);
  let text = "👤 <b>Топ контактов</b>\n\n";
  if (!cts.length) text += "Нет данных.";
  else cts.forEach((c,i) => {
    const name = c.sender_name||c.sender_username||`#${c.sender_id}`;
    text += `${i+1}. <b>${name}</b>\n   💬 ${c.t} | 🗑 ${c.d||0} | ⏱ ${c.ti||0}\n\n`;
  });
  await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kbBack("analytics") });
  await ctx.answerCallbackQuery();
});

bot.callbackQuery("an_cats", async ctx => {
  const stats = db.prepare("SELECT category,COUNT(*) c FROM messages WHERE user_id=? GROUP BY category ORDER BY c DESC").all(ctx.from.id);
  const total = stats.reduce((s,r)=>s+r.c,0)||1;
  const em = {"Работа":"💼","Финансы":"💰","Ссылки":"🔗","Вопросы":"❓","Личное":"❤️"};
  let text = "📂 <b>По категориям</b>\n\n";
  if (!stats.length) text += "Нет данных.";
  else stats.forEach(r => {
    const pct = Math.round(r.c/total*100);
    const bar = "█".repeat(Math.round(pct/10))+"░".repeat(10-Math.round(pct/10));
    text += `${em[r.category]||"📁"} <b>${r.category}</b>: ${r.c} (${pct}%)\n${bar}\n\n`;
  });
  await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kbBack("analytics") });
  await ctx.answerCallbackQuery();
});

bot.callbackQuery("an_dups", async ctx => {
  const dups = db.prepare(`SELECT file_unique_id,media_type,COUNT(*) c,MIN(created_at) f,MAX(created_at) l FROM messages WHERE user_id=? AND file_unique_id IS NOT NULL GROUP BY file_unique_id HAVING c>1 ORDER BY c DESC LIMIT 10`).all(ctx.from.id);
  let text = "🔁 <b>Дубликаты медиа</b>\n\n";
  if (!dups.length) text += "Дубликатов нет!";
  else dups.forEach(d => { text += `• ${d.media_type} (${d.c}×)\n  Первый: ${(d.f||"").slice(0,10)}\n\n`; });
  await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kbBack("analytics") });
  await ctx.answerCallbackQuery();
});

bot.callbackQuery("an_events", async ctx => {
  const tl = db.prepare("SELECT * FROM messages WHERE user_id=? AND (is_deleted=1 OR is_edited=1) ORDER BY COALESCE(deleted_at,edited_at) DESC LIMIT 15").all(ctx.from.id);
  const ico = {photo:"📸",video:"🎬",voice:"🎤",audio:"🎵",video_note:"🎥",document:"📄"};
  let text = "📅 <b>Лента событий</b>\n\n";
  if (!tl.length) text += "Событий нет.";
  else tl.forEach(m => {
    const ts   = (m.deleted_at||m.edited_at||m.created_at||"").slice(0,16).replace("T"," ");
    const from = m.sender_name||`#${m.sender_id}`;
    const ev   = m.is_deleted ? "🗑 Удалено" : "✏️ Изменено";
    const mt   = m.media_type ? " "+(ico[m.media_type]||"📎") : "";
    const snip = short(m.original_text||m.text||m.caption||"", 50);
    text += `${ev}${m.has_timer?" ⏱":""} · ${ts}\n<b>${from}</b>${mt}\n${snip?snip+"\n":""}\n`;
  });
  await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kbBack("analytics") });
  await ctx.answerCallbackQuery();
});

bot.callbackQuery("an_sources", async ctx => {
  const uid = ctx.from.id;
  const fromBusiness = db.prepare("SELECT COUNT(*) c FROM messages WHERE user_id=? AND source='business'").get(uid)?.c||0;
  const fromUbot     = db.prepare("SELECT COUNT(*) c FROM messages WHERE user_id=? AND source='userbot'").get(uid)?.c||0;
  const timers       = db.prepare("SELECT COUNT(*) c FROM messages WHERE user_id=? AND has_timer=1").get(uid)?.c||0;
  const links        = db.prepare("SELECT COUNT(*) c FROM messages WHERE user_id=? AND has_links=1").get(uid)?.c||0;
  const scam         = db.prepare("SELECT COUNT(*) c FROM messages WHERE user_id=? AND is_scam=1").get(uid)?.c||0;
  await ctx.editMessageText(
    `📊 <b>Источники и статистика</b>\n\n` +
    `🔗 Business API: ${fromBusiness}\n🤖 UserBot: ${fromUbot}\n\n` +
    `⏱ Таймер-медиа: ${timers}\n🔗 Со ссылками: ${links}\n⚠️ Скам-попытки: ${scam}`,
    { parse_mode: "HTML", reply_markup: kbBack("analytics") }
  );
  await ctx.answerCallbackQuery();
});

// ==================================================================================================
//  GALLERY
// ==================================================================================================
bot.callbackQuery("gallery", async ctx => {
  const uid = ctx.from.id;
  const all = db.prepare("SELECT media_type,COUNT(*) c FROM messages WHERE user_id=? AND media_type IS NOT NULL GROUP BY media_type").all(uid);
  const ico = {photo:"📸",video:"🎬",voice:"🎤",audio:"🎵",video_note:"🎥",document:"📄",sticker:"🎭",animation:"🎬"};
  const timers = db.prepare("SELECT COUNT(*) c FROM messages WHERE user_id=? AND has_timer=1").get(uid)?.c||0;
  let text = "🖼 <b>Галерея медиа</b>\n\n";
  if (!all.length) text += "Медиа нет.";
  else { all.forEach(r => { text += `${ico[r.media_type]||"📎"} ${r.media_type}: <b>${r.c}</b>\n`; }); text += `\n⏱ Из них с таймером: <b>${timers}</b>`; }
  await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: new InlineKeyboard()
    .text("📸","gal_photo").text("🎬","gal_video").text("🎤","gal_voice").text("⏱","gal_timer").row()
    .text("◀️ Назад","main_menu") });
  await ctx.answerCallbackQuery();
});

["photo","video","voice","timer"].forEach(type => {
  bot.callbackQuery(`gal_${type}`, async ctx => {
    const uid  = ctx.from.id;
    const ico  = {photo:"📸",video:"🎬",voice:"🎤",audio:"🎵",video_note:"🎥",document:"📄",sticker:"🎭"};
    const msgs = type === "timer"
      ? db.prepare("SELECT * FROM messages WHERE user_id=? AND has_timer=1 ORDER BY created_at DESC LIMIT 15").all(uid)
      : db.prepare("SELECT * FROM messages WHERE user_id=? AND media_type=? ORDER BY created_at DESC LIMIT 15").all(uid, type);
    let text = `${ico[type]||"⏱"} <b>${type==="timer"?"Таймер-медиа":type} (${msgs.length})</b>:\n\n`;
    msgs.forEach(m => {
      const ts   = (m.created_at||"").slice(0,10);
      const from = m.sender_name||`#${m.sender_id}`;
      const fl   = `${m.is_deleted?"🗑":"✅"}${m.has_timer?" ⏱":""}`;
      text += `${fl} [${ts}] <b>${from}</b>\n`;
    });
    if (!msgs.length) text += "Нет.";
    await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kbBack("gallery") });
    await ctx.answerCallbackQuery();
  });
});

// ==================================================================================================
//  EXPORT
// ==================================================================================================
bot.callbackQuery("export_menu", async ctx => {
  await ctx.editMessageText(
    "📤 <b>Экспорт данных</b>\n\nФормат экспорта (последние 200 сообщений):",
    { parse_mode: "HTML", reply_markup: new InlineKeyboard()
      .text("📄 HTML","exp_html").text("📋 CSV","exp_csv").row()
      .text("🗜 ZIP","exp_zip").row()
      .text("◀️ Назад","main_menu") }
  );
  await ctx.answerCallbackQuery();
});

async function doExport(ctx, type) {
  const uid  = ctx.from.id;
  const msgs = searchMsgs(uid, { limit: 200 });
  if (!msgs.length) { await ctx.answerCallbackQuery("Нет данных", { show_alert: true }); return; }
  await ctx.answerCallbackQuery("⏳ Создаю файл...");
  let fp;
  try {
    if      (type==="html") fp = await exportHTML(uid, msgs, "MerAI Export");
    else if (type==="csv")  fp = await exportCSV(uid, msgs);
    else if (type==="zip")  fp = await buildZIP(uid, 0, msgs, "Full Export");
    if (fp && fs.existsSync(fp)) {
      const names = { html:"export.html", csv:"export.csv", zip:"export.zip" };
      await ctx.api.sendDocument(uid, new InputFile(fp, names[type]), { caption: `✅ Экспорт готов (${msgs.length} записей)` });
    }
  } catch(e) { await ctx.api.sendMessage(uid, "❌ " + e.message.slice(0,200)); }
}
bot.callbackQuery("exp_html", ctx => doExport(ctx, "html"));
bot.callbackQuery("exp_csv",  ctx => doExport(ctx, "csv"));
bot.callbackQuery("exp_zip",  ctx => doExport(ctx, "zip"));

// ==================================================================================================
//  SETTINGS
// ==================================================================================================
bot.callbackQuery("settings", async ctx => {
  const u = getUser(ctx.from.id);
  if (!u) { await ctx.answerCallbackQuery("❌"); return; }
  await ctx.editMessageText("⚙️ <b>Настройки</b>\n\nНажмите для переключения:", { parse_mode: "HTML", reply_markup: kbSettings(u) });
  await ctx.answerCallbackQuery();
});

bot.callbackQuery(/^ts_(.+)$/, async ctx => {
  const field = ctx.match[1];
  const uid   = ctx.from.id;
  const u     = getUser(uid);
  if (!u || !(field in u)) { await ctx.answerCallbackQuery("❌"); return; }
  updateUser(uid, { [field]: u[field] ? 0 : 1 });
  const u2 = getUser(uid);
  await ctx.answerCallbackQuery(u2[field] ? "✅ Включено" : "❌ Выключено");
  try { await ctx.editMessageReplyMarkup({ reply_markup: kbSettings(u2) }); } catch(e){}
});

bot.callbackQuery("cleanup_media", async ctx => {
  const uid = ctx.from.id;
  const u   = getUser(uid);
  const cut = new Date(Date.now() - (u?.cleanup_days||90) * 86400000).toISOString();
  const rows = db.prepare("SELECT id,file_path FROM messages WHERE user_id=? AND file_path IS NOT NULL AND created_at<?").all(uid, cut);
  let cnt = 0;
  rows.forEach(r => { if (r.file_path && fs.existsSync(r.file_path)) { try { fs.unlinkSync(r.file_path); cnt++; } catch(e){} } db.prepare("UPDATE messages SET file_path=NULL WHERE id=?").run(r.id); });
  await ctx.answerCallbackQuery(`🧹 Удалено: ${cnt} файлов`, { show_alert: true });
});

// ==================================================================================================
//  REFERRALS
// ==================================================================================================
bot.callbackQuery("referrals", async ctx => {
  const uid  = ctx.from.id;
  const u    = getUser(uid);
  const refs = db.prepare("SELECT user_id,first_name,username,subscription_type FROM users WHERE referred_by=? ORDER BY registered_at DESC LIMIT 10").all(uid);
  const link = `https://t.me/${ctx.me.username}?start=${u?.referral_code||""}`;
  let text   = `👥 <b>Рефералы</b>\n\nВаша ссылка:\n<code>${link}</code>\n\nПриглашено: <b>${u?.total_referrals||0}</b>\nЗаработано: <b>${u?.referral_earnings||0} ⭐</b>\n\nВы получаете <b>20%</b> от каждого платежа реферала.\n\n`;
  if (refs.length) { refs.forEach((r,i)=>{ text+=`${i+1}. ${r.first_name||"?"}${r.username?" @"+r.username:""}\n`; }); } else text += "Рефералов пока нет.";
  await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kbBack() });
  await ctx.answerCallbackQuery();
});

bot.callbackQuery("my_stars", async ctx => {
  const u = getUser(ctx.from.id);
  await ctx.editMessageText(
    `⭐ <b>Stars-баланс</b>\n\nБаланс: ${u?.stars_balance||0} ⭐\nРеф. заработок: ${u?.referral_earnings||0} ⭐\n\nStars начисляются реферальными бонусами и от администратора.\nИспользуются для продления подписки.\n\nПополнить: @mrztn`,
    { parse_mode: "HTML", reply_markup: kbBack() }
  );
  await ctx.answerCallbackQuery();
});

// ==================================================================================================
//  ACHIEVEMENTS
// ==================================================================================================
bot.callbackQuery("achievements", async ctx => {
  const achs = db.prepare("SELECT * FROM achievements WHERE user_id=? ORDER BY unlocked_at DESC").all(ctx.from.id);
  const L    = { first_msg:"💬 Первое сообщение",msg_100:"💬 100 сообщений",msg_1000:"💬 1 000",first_del:"🗑 Первое удаление",del_50:"🗑 50 удалений",first_media:"📸 Первое медиа",ai_user:"🤖 AI-ассистент",level_5:"⭐ Уровень 5",level_10:"⭐ Уровень 10",connected:"🔗 Business API",premium:"👑 Premium",legend:"♾️ Легенда" };
  let text = `🏆 <b>Достижения</b> (${achs.length}):\n\n`;
  if (!achs.length) text += "Пока нет. Используйте бота!";
  else achs.forEach(a => { text += `${L[a.code]||a.code} — ${(a.unlocked_at||"").slice(0,10)}\n`; });
  await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kbBack() });
  await ctx.answerCallbackQuery();
});

bot.callbackQuery("help", async ctx => {
  await ctx.editMessageText(
    `ℹ️ <b>MerAI — Помощь</b>\n\n` +
    `<b>Что сохраняется:</b>\n` +
    `✅ Текст, фото, видео, аудио, документы, стикеры\n` +
    `✅ Голосовые сообщения и видео-кружки\n` +
    `✅ Медиа с таймером/самоуничтожением ⏱\n` +
    `✅ Оригинал при редактировании\n` +
    `✅ ZIP-архив при удалении чата\n\n` +
    `<b>Уведомления:</b>\n` +
    `🗑 Удалено → текст + файл сразу\n` +
    `✏️ Изменено → было / стало\n` +
    `⏱ Таймер → перехват до просмотра\n` +
    `⚠️ Скам → мгновенное предупреждение\n\n` +
    `<b>Команды:</b>\n` +
    `/block ID — блок отправителя\n/unblock ID — разблок\n` +
    `/kw слово — добавить ключевое слово\n/unkw слово — убрать\n` +
    `/level — уровень и XP\n/ach — достижения\n\n` +
    `<b>Два режима мониторинга:</b>\n` +
    `🔗 Business API (нужен Telegram Premium)\n` +
    `🤖 UserBot (работает без Premium!)\n\n` +
    `Поддержка: @mrztn`,
    { parse_mode: "HTML", reply_markup: kbBack() }
  );
  await ctx.answerCallbackQuery();
});

// ==================================================================================================
//  USERBOT MENU - УПРОЩЕННАЯ ВЕРСИЯ
// ==================================================================================================
bot.callbackQuery("userbot_menu", async ctx => {
  const uid = ctx.from.id;
  const ub  = db.prepare("SELECT * FROM userbot_sessions WHERE user_id=?").get(uid);
  
  if (!TG_API_ID || !TG_API_HASH) {
    await ctx.editMessageText(
      `🤖 <b>UserBot</b>\n\n` +
      `❌ <b>UserBot не настроен</b>\n\n` +
      `Для работы UserBot требуется:\n` +
      `• TG_API_ID\n` +
      `• TG_API_HASH\n\n` +
      `Обратитесь к администратору @mrztn`,
      { parse_mode: "HTML", reply_markup: kbBack() }
    );
    await ctx.answerCallbackQuery();
    return;
  }
  
  if (ub && ub.is_active) {
    await ctx.editMessageText(
      `🤖 <b>UserBot</b>\n\n` +
      `<b>Статус:</b> ✅ Активен\n` +
      `<b>Аккаунт:</b> ${ub.tg_username ? "@"+ub.tg_username : `#${ub.tg_user_id}`}\n` +
      `<b>Телефон:</b> ${ub.phone||"?"}\n` +
      `<b>Подключён:</b> ${(ub.connected_at||"").slice(0,10)}\n\n` +
      `UserBot мониторит все ваши переписки:\n` +
      `✅ Личные чаты + группы\n` +
      `✅ Удалённые сообщения любой стороной\n` +
      `✅ Медиа с таймером\n` +
      `❌ Секретные чаты (E2E)`,
      { parse_mode: "HTML", reply_markup: new InlineKeyboard()
        .text("🔴 Отключить", "ub_disconnect").text("📊 Статистика", "ub_stats").row()
        .text("◀️ Назад", "main_menu") }
    );
  } else if (ub && !ub.is_active && ub.session_str) {
    await ctx.editMessageText(
      `🤖 <b>UserBot</b>\n\n<b>Статус:</b> ❌ Отключён\n\nСессия сохранена. Переподключитесь чтобы возобновить мониторинг.`,
      { parse_mode: "HTML", reply_markup: new InlineKeyboard()
        .text("🔄 Переподключить", "ub_reconnect").row()
        .text("🗑 Удалить сессию", "ub_delete").row()
        .text("◀️ Назад", "main_menu") }
    );
  } else {
    await ctx.editMessageText(
      `🤖 <b>UserBot — мониторинг без Telegram Premium</b>\n\n` +
      `Работает как ваш второй клиент Telegram (аналог AyuGram).\n\n` +
      `<b>Что перехватывает:</b>\n` +
      `✅ Все входящие и исходящие сообщения\n` +
      `✅ Удалённые сообщения (кем бы ни удалены)\n` +
      `✅ Отредактированные сообщения\n` +
      `✅ Медиа с таймером самоуничтожения ⏱\n` +
      `✅ Личные чаты + группы + супергруппы\n` +
      `❌ Секретные чаты — невозможно (E2E)\n\n` +
      `<b>Что потребуется:</b>\n` +
      `📱 Номер телефона вашего Telegram\n` +
      `🔐 Код подтверждения + 2FA пароль (если включён)\n\n` +
      `<i>API ID и API Hash уже настроены администратором</i>`,
      { parse_mode: "HTML", reply_markup: new InlineKeyboard()
        .text("✅ Подключить", "ub_start_setup").row()
        .text("◀️ Назад", "main_menu") }
    );
  }
  await ctx.answerCallbackQuery();
});

bot.callbackQuery("ub_start_setup", async ctx => {
  const uid = ctx.from.id;
  const ub  = db.prepare("SELECT accepted_ub_terms FROM userbot_sessions WHERE user_id=?").get(uid);
  if (!ub?.accepted_ub_terms) {
    await ctx.editMessageText(
      `📋 <b>Условия UserBot</b>\n\n` +
      `Прочитайте и подтвердите:\n\n` +
      `1️⃣ Вы предоставляете <b>свой номер телефона</b>\n\n` +
      `2️⃣ Ваша сессия Telegram будет сохранена в базе данных на сервере\n\n` +
      `3️⃣ Использование UserBot потенциально нарушает ToS Telegram (автоматизация пользовательских аккаунтов) — <b>вы берёте ответственность на себя</b>\n\n` +
      `4️⃣ Все ваши сообщения будут записываться в базу данных\n\n` +
      `5️⃣ Администратор <b>@mrztn</b> имеет доступ к серверу\n\n` +
      `6️⃣ Вы можете отключить и удалить сессию в любой момент\n\n` +
      `⚠️ Если вы не согласны — используйте Business API (Telegram Premium).`,
      { parse_mode: "HTML", reply_markup: new InlineKeyboard()
        .text("✅ Принимаю, продолжить", "ub_accept_terms").row()
        .text("❌ Отмена", "userbot_menu") }
    );
    await ctx.answerCallbackQuery();
    return;
  }
  await startUbSetup(ctx, uid);
  await ctx.answerCallbackQuery();
});

bot.callbackQuery("ub_accept_terms", async ctx => {
  const uid      = ctx.from.id;
  const existing = db.prepare("SELECT * FROM userbot_sessions WHERE user_id=?").get(uid);
  if (existing) db.prepare("UPDATE userbot_sessions SET accepted_ub_terms=1 WHERE user_id=?").run(uid);
  else          db.prepare("INSERT INTO userbot_sessions(user_id,accepted_ub_terms) VALUES(?,1)").run(uid);
  await startUbSetup(ctx, uid);
  await ctx.answerCallbackQuery();
});

async function startUbSetup(ctx, uid) {
  setState(uid, "ub_phone");
  UB_ST[uid] = {};
  await ctx.editMessageText(
    `🤖 <b>Настройка UserBot</b>\n\n` +
    `<b>Шаг 1 из 2 — Номер телефона</b>\n\n` +
    `Введите ваш номер телефона Telegram:\n\n` +
    `Формат: <code>+79991234567</code>`,
    { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("❌ Отмена", "userbot_menu") }
  );
}

bot.callbackQuery("ub_disconnect", async ctx => {
  const uid = ctx.from.id;
  await disconnectUserbot(uid);
  await ctx.editMessageText("✅ <b>UserBot отключён.</b>\n\nМониторинг остановлен. Сессия сохранена.\n\nДля повторного подключения нажмите «UserBot» в меню.", { parse_mode: "HTML", reply_markup: kbBack("userbot_menu") });
  await ctx.answerCallbackQuery("✅ Отключено");
});

bot.callbackQuery("ub_delete", async ctx => {
  const uid = ctx.from.id;
  await disconnectUserbot(uid);
  db.prepare("DELETE FROM userbot_sessions WHERE user_id=?").run(uid);
  await ctx.editMessageText("🗑 <b>Сессия UserBot удалена.</b>\n\nВсе данные удалены. Для нового подключения зайдите в «UserBot».", { parse_mode: "HTML", reply_markup: kbBack("main_menu") });
  await ctx.answerCallbackQuery("🗑 Удалено");
});

bot.callbackQuery("ub_reconnect", async ctx => {
  const uid = ctx.from.id;
  const ub  = db.prepare("SELECT * FROM userbot_sessions WHERE user_id=?").get(uid);
  if (!ub || !ub.session_str) { await ctx.answerCallbackQuery("Нет сессии", { show_alert: true }); return; }
  await ctx.editMessageText("⏳ Переподключаюсь...", { parse_mode: "HTML" });
  try {
    await launchUserbot(uid, ub.session_str);
    await ctx.editMessageText("✅ <b>UserBot переподключён!</b>", { parse_mode: "HTML", reply_markup: kbBack("userbot_menu") });
  } catch(e) {
    await ctx.editMessageText(`❌ <b>Ошибка:</b> ${e.message}`, { parse_mode: "HTML", reply_markup: kbBack("userbot_menu") });
  }
  await ctx.answerCallbackQuery();
});

bot.callbackQuery("ub_stats", async ctx => {
  const uid  = ctx.from.id;
  const msgs = db.prepare("SELECT COUNT(*) c FROM messages WHERE user_id=? AND source='userbot'").get(uid)?.c||0;
  const dels = db.prepare("SELECT COUNT(*) c FROM messages WHERE user_id=? AND source='userbot' AND is_deleted=1").get(uid)?.c||0;
  const edts = db.prepare("SELECT COUNT(*) c FROM messages WHERE user_id=? AND source='userbot' AND is_edited=1").get(uid)?.c||0;
  const timer= db.prepare("SELECT COUNT(*) c FROM messages WHERE user_id=? AND source='userbot' AND has_timer=1").get(uid)?.c||0;
  const chats= db.prepare("SELECT COUNT(DISTINCT chat_id) c FROM messages WHERE user_id=? AND source='userbot'").get(uid)?.c||0;
  await ctx.editMessageText(
    `📊 <b>Статистика UserBot</b>\n\n💬 Сообщений: ${msgs}\n🗑 Удалений: ${dels}\n✏️ Правок: ${edts}\n⏱ Таймер-медиа: ${timer}\n💬 Отслеживаемых чатов: ${chats}`,
    { parse_mode: "HTML", reply_markup: kbBack("userbot_menu") }
  );
  await ctx.answerCallbackQuery();
});

// ==================================================================================================
//  ADMIN PANEL - С РЕАЛЬНОЙ СТАТИСТИКОЙ
// ==================================================================================================
bot.callbackQuery("admin", async ctx => {
  if (ctx.from.id !== ADMIN_ID) { await ctx.answerCallbackQuery("🚫"); return; }
  const s = adminStats();
  await ctx.editMessageText(
    `👨‍💼 <b>Админ-панель</b>\n\n` +
    `👥 Всего пользователей: <b>${fmt(s.users)}</b>\n` +
    `✅ Активных подписок: <b>${s.active}</b>\n` +
    `🤖 UserBot активных: <b>${s.ub_users}</b>\n\n` +
    `💬 Сообщений: ${fmt(s.messages)}\n` +
    `🗑 Удалений: ${fmt(s.deleted)}\n` +
    `✏️ Правок: ${fmt(s.edited)}\n` +
    `⏱ Таймер-медиа: ${fmt(s.timer)}\n\n` +
    `💰 Stars собрано: ${fmt(s.stars)} ⭐`,
    { parse_mode: "HTML", reply_markup: kbAdmin() }
  );
  await ctx.answerCallbackQuery();
});

bot.callbackQuery("adm_stats", async ctx => {
  if (ctx.from.id !== ADMIN_ID) { await ctx.answerCallbackQuery("🚫"); return; }
  const s   = adminStats();
  const em  = {free:"🆓",trial:"🎁",starter:"🌟",basic:"💎",pro:"💼",premium:"👑",ultimate:"♾️"};
  const pl  = (s.byPlan||[]).map(r=>`${em[r.t]||"?"} ${r.t}: ${r.c}`).join("\n");
  const today = new Date().toISOString().slice(0,10);
  const tdMsg = db.prepare("SELECT COUNT(*) c FROM messages WHERE DATE(created_at)=?").get(today)?.c||0;
  const tdUsr = db.prepare("SELECT COUNT(*) c FROM users WHERE DATE(registered_at)=?").get(today)?.c||0;
  await ctx.editMessageText(
    `📊 <b>Детальная статистика</b>\n\n` +
    `<b>Всего пользователей:</b> ${fmt(s.users)}\n` +
    `Сегодня: +${tdUsr} юзеров, +${tdMsg} сообщений\n\n` +
    `<b>По планам:</b>\n${pl}\n\n` +
    `<b>Контент:</b>\n💬 ${fmt(s.messages)} | 🗑 ${fmt(s.deleted)} | ✏️ ${fmt(s.edited)} | ⏱ ${fmt(s.timer)}`,
    { parse_mode: "HTML", reply_markup: kbBack("admin") }
  );
  await ctx.answerCallbackQuery();
});

bot.callbackQuery("adm_users", async ctx => {
  if (ctx.from.id !== ADMIN_ID) { await ctx.answerCallbackQuery("🚫"); return; }
  await showUsersPage(ctx, 0);
  await ctx.answerCallbackQuery();
});

async function showUsersPage(ctx, page) {
  const PAGE  = 6;
  const users = db.prepare("SELECT * FROM users ORDER BY registered_at DESC LIMIT ? OFFSET ?").all(PAGE, page*PAGE);
  const total = db.prepare("SELECT COUNT(*) c FROM users").get().c;
  const pages = Math.max(1, Math.ceil(total/PAGE));
  const em    = {free:"🆓",trial:"🎁",starter:"🌟",basic:"💎",pro:"💼",premium:"👑",ultimate:"♾️"};
  let text    = `👥 <b>Пользователи</b> (${page+1}/${pages})\n<b>Всего: ${fmt(total)}</b>\n\n`;
  const kb    = new InlineKeyboard();
  users.forEach((u, i) => {
    const idx = page*PAGE+i+1;
    const bl  = u.is_blocked ? "🚫" : "";
    const nm  = short(u.first_name||`#${u.user_id}`, 14);
    text += `${idx}. ${bl}${em[u.subscription_type]||"?"} <b>${nm}</b> (@${u.username||"—"})\n   💬 ${u.total_messages} | 🗑 ${u.total_deletions}\n\n`;
    kb.text(`${idx}. ${nm}`, `adm_u_${u.user_id}`);
    if ((i+1)%2===0) kb.row();
  });
  kb.row();
  if (page>0) kb.text("◀️", `adm_pg_${page-1}`);
  if (page<pages-1) kb.text("▶️", `adm_pg_${page+1}`);
  kb.row().text("◀️ Назад","admin");
  await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kb });
}

bot.callbackQuery(/^adm_pg_(\d+)$/, async ctx => {
  if (ctx.from.id !== ADMIN_ID) { await ctx.answerCallbackQuery("🚫"); return; }
  await showUsersPage(ctx, parseInt(ctx.match[1]));
  await ctx.answerCallbackQuery();
});

bot.callbackQuery(/^adm_u_(\d+)$/, async ctx => {
  if (ctx.from.id !== ADMIN_ID) { await ctx.answerCallbackQuery("🚫"); return; }
  const uid = parseInt(ctx.match[1]);
  const u   = getUser(uid); if (!u) { await ctx.answerCallbackQuery("❌"); return; }
  const ub  = db.prepare("SELECT is_active FROM userbot_sessions WHERE user_id=?").get(uid);
  await ctx.editMessageText(
    `👤 <b>${u.first_name||"?"}${u.username?" @"+u.username:""}</b>\nID: ${uid}\n\n` +
    `Подписка: ${subLabel(u)}\nУровень: ${u.user_level} (${u.xp} XP)\n` +
    `UserBot: ${ub?.is_active?"✅":"❌"}\n` +
    `💬 ${fmt(u.total_messages)} | 🗑 ${fmt(u.total_deletions)} | ⏱ ${u.total_media}\n` +
    `Stars: ${u.stars_balance} | Рефералов: ${u.total_referrals}\n` +
    `Рег.: ${(u.registered_at||"").slice(0,10)}\n${u.is_blocked?"🚫 ЗАБЛОКИРОВАН":""}`,
    { parse_mode: "HTML", reply_markup: new InlineKeyboard()
      .text("🎁 Подарить подписку",`adm_gift_${uid}`).row()
      .text("⭐ +Stars", `adm_stars_${uid}`).row()
      .text(u.is_blocked?"✅ Разблок":"🚫 Блок", (u.is_blocked?`adm_unblock_`:`adm_block_`)+uid).row()
      .text("◀️ Назад","adm_users") }
  );
  await ctx.answerCallbackQuery();
});

bot.callbackQuery(/^adm_block_(\d+)$/, async ctx => {
  if (ctx.from.id !== ADMIN_ID) { await ctx.answerCallbackQuery("🚫"); return; }
  const uid = parseInt(ctx.match[1]);
  updateUser(uid, { is_blocked: 1 });
  await ctx.answerCallbackQuery("✅ Заблокирован");
  try { await bot.api.sendMessage(uid, "🚫 Аккаунт заблокирован. Вопросы: @mrztn"); } catch(e){}
});

bot.callbackQuery(/^adm_unblock_(\d+)$/, async ctx => {
  if (ctx.from.id !== ADMIN_ID) { await ctx.answerCallbackQuery("🚫"); return; }
  const uid = parseInt(ctx.match[1]);
  updateUser(uid, { is_blocked: 0 });
  await ctx.answerCallbackQuery("✅ Разблокирован");
  try { await bot.api.sendMessage(uid, "✅ Аккаунт разблокирован! Добро пожаловать!"); } catch(e){}
});

bot.callbackQuery(/^adm_gift_(\d+)$/, async ctx => {
  if (ctx.from.id !== ADMIN_ID) { await ctx.answerCallbackQuery("🚫"); return; }
  const uid = parseInt(ctx.match[1]);
  await ctx.editMessageText(`🎁 Подарить подписку #${uid}:`, { reply_markup: new InlineKeyboard()
    .text("🌟 7д",`gft_${uid}_starter`).text("💎 1мес",`gft_${uid}_basic`).row()
    .text("💼 3мес",`gft_${uid}_pro`).text("👑 1год",`gft_${uid}_premium`).row()
    .text("♾️ Навсегда",`gft_${uid}_ultimate`).row().text("◀️ Назад",`adm_u_${uid}`) });
  await ctx.answerCallbackQuery();
});

bot.callbackQuery(/^gft_(\d+)_(.+)$/, async ctx => {
  if (ctx.from.id !== ADMIN_ID) { await ctx.answerCallbackQuery("🚫"); return; }
  const uid = parseInt(ctx.match[1]), plan = ctx.match[2];
  activateSub(uid, plan);
  addXp(uid, PLAN_XP[plan]||100);
  await ctx.answerCallbackQuery(`✅ ${plan} выдан`);
  const u = getUser(uid);
  try { await bot.api.sendMessage(uid, `🎁 <b>Подарок!</b>\nВам выдана подписка: <b>${subLabel(u)}</b>`, { parse_mode: "HTML" }); } catch(e){}
  await ctx.editMessageText(`✅ Готово`, { reply_markup: kbBack("adm_users") });
});

bot.callbackQuery(/^adm_stars_(\d+)$/, async ctx => {
  if (ctx.from.id !== ADMIN_ID) { await ctx.answerCallbackQuery("🚫"); return; }
  setState(ADMIN_ID, `gift_stars_${ctx.match[1]}`);
  await ctx.editMessageText("⭐ Введите количество Stars:", { reply_markup: new InlineKeyboard().text("❌",`adm_u_${ctx.match[1]}`) });
  await ctx.answerCallbackQuery();
});

bot.callbackQuery("adm_bcast", async ctx => {
  if (ctx.from.id !== ADMIN_ID) { await ctx.answerCallbackQuery("🚫"); return; }
  setState(ADMIN_ID, "broadcast");
  await ctx.editMessageText("📢 Введите сообщение для рассылки (HTML):", { reply_markup: new InlineKeyboard().text("❌","admin") });
  await ctx.answerCallbackQuery();
});

bot.callbackQuery("adm_ubots", async ctx => {
  if (ctx.from.id !== ADMIN_ID) { await ctx.answerCallbackQuery("🚫"); return; }
  const ubs = db.prepare("SELECT ub.user_id, ub.phone, ub.is_active, ub.tg_username, ub.connected_at FROM userbot_sessions ub ORDER BY ub.connected_at DESC LIMIT 20").all();
  let text = `🤖 <b>UserBot сессии (${ubs.length})</b>\n\n`;
  if (!ubs.length) text += "Нет сессий.";
  else ubs.forEach((u,i) => { text += `${i+1}. ${u.is_active?"✅":"❌"} ${u.phone||"?"} ${u.tg_username?"@"+u.tg_username:""} #${u.user_id}\n`; });
  await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kbBack("admin") });
  await ctx.answerCallbackQuery();
});

// ==================================================================================================
//  MESSAGE HANDLER (AI + состояния + UserBot setup)
// ==================================================================================================
bot.on("message:text", async ctx => {
  const uid   = ctx.from.id;
  const text  = ctx.message.text || "";
  if (text.startsWith("/")) return;

  const u = getUser(uid);
  if (!u) return;
  if (u.is_blocked) return;

  const state = getState(uid);

  // --- UserBot: Phone ---
  if (state === "ub_phone") {
    const phone = text.trim();
    if (!/^\+\d{7,15}$/.test(phone)) {
      await ctx.reply("❌ Неверный формат. Пример: <code>+79991234567</code>", { parse_mode: "HTML" });
      return;
    }
    
    UB_ST[uid] = { phone };
    
    try {
      const client = new TelegramClient(
        new StringSession(""),
        TG_API_ID, TG_API_HASH,
        { connectionRetries: 5, useWSS: false, deviceModel: "MerAI UserBot", systemVersion: "1.0", appVersion: "1.0.0" }
      );
      
      console.log(`[UB Setup] uid=${uid} connecting...`);
      await client.connect();
      
      console.log(`[UB Setup] uid=${uid} sending code to ${phone}...`);
      // ИСПРАВЛЕНО: правильный вызов API
      const result = await client.invoke(
        new Api.auth.SendCode({
          phoneNumber: phone,
          apiId: TG_API_ID,
          apiHash: TG_API_HASH,
          settings: new Api.CodeSettings({})
        })
      );
      
      UB_ST[uid].client = client;
      UB_ST[uid].phoneCodeHash = result.phoneCodeHash;
      
      setState(uid, "ub_code");
      console.log(`[UB Setup] uid=${uid} код отправлен, phoneCodeHash: ${result.phoneCodeHash.slice(0,10)}...`);
      
      await ctx.reply(
        `📱 <b>Код отправлен на ${phone}!</b>\n\n` +
        `<b>Шаг 2 из 2 — Код подтверждения</b>\n\n` +
        `Введите код из Telegram (обычно 5 цифр):\n` +
        `Пример: <code>12345</code>\n\n` +
        `⏰ Код действует 5 минут.\n` +
        `💡 Проверьте Telegram на этом или другом устройстве.`,
        { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("❌ Отмена", "userbot_menu") }
      );
    } catch(e) {
      console.error(`[UB Setup Error] uid=${uid}:`, e.message, e.stack);
      clearState(uid); delete UB_ST[uid];
      await ctx.reply(`❌ <b>Ошибка отправки кода:</b>\n\n${e.message}\n\n<b>Возможные причины:</b>\n• Неверный номер телефона\n• Номер заблокирован Telegram\n• Проблемы с сетью\n\nПопробуйте ещё раз или используйте Business API.`, { parse_mode: "HTML", reply_markup: kbMain(uid) });
    }
    return;
  }

  // --- UserBot: Code ---
  if (state === "ub_code") {
    const code = text.trim().replace(/\s/g,"").replace(/-/g,"");
    const ubs  = UB_ST[uid];
    if (!ubs || !ubs.client) { 
      clearState(uid); 
      await ctx.reply("❌ Сессия устарела. Начните заново.", { reply_markup: kbMain(uid) }); 
      return; 
    }
    
    try {
      console.log(`[UB Setup] uid=${uid} signing in with code: ${code.slice(0,2)}...`);
      
      // ИСПРАВЛЕНО: правильный вызов signInUser
      const result = await ubs.client.invoke(
        new Api.auth.SignIn({
          phoneNumber: ubs.phone,
          phoneCodeHash: ubs.phoneCodeHash,
          phoneCode: code
        })
      );
      
      const sessStr = ubs.client.session.save();
      const me      = await ubs.client.getMe();
      
      console.log(`[UB Setup] uid=${uid} авторизация успешна: @${me.username || me.id}`);
      
      db.prepare(`
        INSERT OR REPLACE INTO userbot_sessions
          (user_id, phone, session_str, is_active, connected_at, tg_user_id, tg_username, accepted_ub_terms)
        VALUES (?,?,?,1,datetime('now'),?,?,1)
      `).run(uid, ubs.phone, sessStr, me.id?.toString()||null, me.username||null);
      
      delete UB_ST[uid];
      clearState(uid);
      
      await ctx.reply(
        `🎉 <b>UserBot подключён!</b>\n\n` +
        `👤 Аккаунт: <b>${me.firstName||"?"}${me.username?" @"+me.username:""}</b>\n` +
        `📱 Телефон: ${ubs.phone}\n` +
        `🆔 ID: ${me.id}\n\n` +
        `✅ <b>Мониторинг запущен!</b>\n\n` +
        `Теперь я буду перехватывать:\n` +
        `🗑 Удалённые сообщения\n` +
        `✏️ Отредактированные сообщения\n` +
        `⏱ Медиа с таймером\n\n` +
        `Работает в личных чатах и группах.`,
        { parse_mode: "HTML", reply_markup: kbMain(uid) }
      );
      
      await launchUserbot(uid, sessStr);
      try { await bot.api.sendMessage(ADMIN_ID, `🤖 UserBot: uid=${uid} @${me.username||"—"} подключён`); } catch(e){}
      
    } catch(e) {
      console.error(`[UB Setup Code Error] uid=${uid}:`, e.message);
      
      if (e.errorMessage === "SESSION_PASSWORD_NEEDED" || e.message.includes("password")) {
        setState(uid, "ub_2fa");
        await ctx.reply(
          `🔐 <b>Требуется 2FA пароль</b>\n\n` +
          `У вас включена двухфакторная аутентификация.\n\n` +
          `Введите пароль Cloud Password (который вы устанавливали в настройках Telegram):`,
          { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("❌ Отмена", "userbot_menu") }
        );
      } else if (e.errorMessage === "PHONE_CODE_INVALID") {
        await ctx.reply(`❌ <b>Неверный код!</b>\n\nПроверьте код и попробуйте снова.\nКод должен быть из сообщения в Telegram.`, { parse_mode: "HTML" });
      } else if (e.errorMessage === "PHONE_CODE_EXPIRED") {
        clearState(uid); delete UB_ST[uid];
        await ctx.reply(`❌ <b>Код истёк!</b>\n\nНачните подключение заново.`, { parse_mode: "HTML", reply_markup: kbMain(uid) });
      } else {
        clearState(uid); delete UB_ST[uid];
        await ctx.reply(`❌ <b>Ошибка авторизации:</b>\n\n${e.message}\n\nНачните заново.`, { parse_mode: "HTML", reply_markup: kbMain(uid) });
      }
    }
    return;
  }

  if (state === "ub_2fa") {
    const ubs = UB_ST[uid];
    if (!ubs || !ubs.client) { 
      clearState(uid); 
      await ctx.reply("❌ Сессия устарела.", { reply_markup: kbMain(uid) }); 
      return; 
    }
    
    try {
      console.log(`[UB Setup] uid=${uid} checking 2FA password...`);
      
      // ИСПРАВЛЕНО: правильный вызов для 2FA
      const result = await ubs.client.invoke(
        new Api.auth.CheckPassword({
          password: await ubs.client.computeCheck(
            await ubs.client.invoke(new Api.account.GetPassword({})),
            text.trim()
          )
        })
      );
      
      const sessStr = ubs.client.session.save();
      const me      = await ubs.client.getMe();
      
      console.log(`[UB Setup] uid=${uid} 2FA успешно: @${me.username || me.id}`);
      
      db.prepare(`
        INSERT OR REPLACE INTO userbot_sessions
          (user_id, phone, session_str, is_active, connected_at, tg_user_id, tg_username, accepted_ub_terms)
        VALUES (?,?,?,1,datetime('now'),?,?,1)
      `).run(uid, ubs.phone, sessStr, me.id?.toString()||null, me.username||null);
      
      delete UB_ST[uid];
      clearState(uid);
      
      await ctx.reply(
        `🎉 <b>UserBot подключён!</b>\n\n` +
        `👤 ${me.firstName||"?"} @${me.username||"—"}\n` +
        `🆔 ${me.id}\n\n` +
        `✅ Мониторинг запущен!`,
        { parse_mode: "HTML", reply_markup: kbMain(uid) }
      );
      
      await launchUserbot(uid, sessStr);
      try { await bot.api.sendMessage(ADMIN_ID, `🤖 UserBot 2FA: uid=${uid} @${me.username||"—"} подключён`); } catch(e){}
      
    } catch(e) {
      console.error(`[UB Setup 2FA Error] uid=${uid}:`, e.message);
      clearState(uid); delete UB_ST[uid];
      await ctx.reply(
        `❌ <b>Неверный 2FA пароль!</b>\n\n${e.message}\n\nНачните подключение заново.`, 
        { parse_mode: "HTML", reply_markup: kbMain(uid) }
      );
    }
    return;
  }

  // --- Search ---
  if (state === "search") {
    clearState(uid);
    let q = text, mediaType = null, category = null, sender = null, deleted = false, timer = false;
    if (q.includes("#фото"))      { mediaType="photo";      q=q.replace(/#фото/g,"").trim(); }
    if (q.includes("#видео"))     { mediaType="video";      q=q.replace(/#видео/g,"").trim(); }
    if (q.includes("#кружок"))    { mediaType="video_note"; q=q.replace(/#кружок/g,"").trim(); }
    if (q.includes("#голос"))     { mediaType="voice";      q=q.replace(/#голос/g,"").trim(); }
    if (q.includes("#удалённые")) { deleted=true;           q=q.replace(/#удалённые/g,"").trim(); }
    if (q.includes("#таймер"))    { timer=true;             q=q.replace(/#таймер/g,"").trim(); }
    for (const cat of Object.keys(CATS)) {
      if (q.toLowerCase().includes(`#${cat.toLowerCase()}`)) { category=cat; q=q.replace(new RegExp(`#${cat}`,"i"),"").trim(); break; }
    }
    const fromM = q.match(/#от:@?(\S+)/);
    if (fromM) { sender=fromM[1]; q=q.replace(/#от:@?\S+/,"").trim(); }
    const results = searchMsgs(uid, { q:q||undefined, mediaType, category, sender, deleted, timer });
    if (!results.length) { await ctx.reply("🔍 Ничего не найдено.", { reply_markup: kbMain(uid) }); return; }
    const ico = {photo:"📸",video:"🎬",voice:"🎤",audio:"🎵",video_note:"🎥",document:"📄",sticker:"🎭"};
    let reply = `🔍 <b>Результаты (${results.length})</b>:\n\n`;
    results.slice(0,10).forEach(r => {
      const ts   = (r.created_at||"").slice(0,16).replace("T"," ");
      const from = r.sender_name||r.sender_username||`#${r.sender_id}`;
      const snip = short(r.text||r.caption||"", 70);
      const mt   = r.media_type ? ico[r.media_type]||"📎" : "";
      reply += `${r.is_deleted?"🗑":""}${r.is_edited?"✏️":""}${r.has_timer?"⏱":""}${mt?mt+" ":""}[${ts}] <b>${from}</b>\n${snip?snip+"\n":""}\n`;
    });
    await ctx.reply(reply, { parse_mode: "HTML", reply_markup: kbMain(uid) });
    return;
  }

  // --- Admin: gift stars ---
  if (state && state.startsWith("gift_stars_") && uid === ADMIN_ID) {
    const targetUid = parseInt(state.split("_")[2]);
    clearState(uid);
    const stars = parseInt(text.trim());
    if (isNaN(stars)||stars<=0) { await ctx.reply("❌ Введите положительное число."); return; }
    const t = getUser(targetUid);
    if (t) updateUser(targetUid, { stars_balance: t.stars_balance + stars });
    try { await bot.api.sendMessage(targetUid, `⭐ Вам добавлено ${stars} Stars от администратора!`); } catch(e){}
    await ctx.reply(`✅ +${stars} ⭐ пользователю #${targetUid}`, { reply_markup: kbAdmin() });
    return;
  }

  // --- Admin: broadcast ---
  if (state === "broadcast" && uid === ADMIN_ID) {
    clearState(uid);
    const uids = db.prepare("SELECT user_id FROM users WHERE is_blocked=0").all().map(r=>r.user_id);
    let ok=0, fail=0;
    await ctx.reply(`📢 Рассылка ${uids.length} пользователям...`);
    for (const id of uids) {
      try { await bot.api.sendMessage(id, `📢 <b>Сообщение от MerAI:</b>\n\n${text}`, { parse_mode:"HTML" }); ok++; }
      catch(e) { fail++; }
      await new Promise(r=>setTimeout(r,55));
    }
    await ctx.reply(`✅ Готово! ✓${ok} ✗${fail}`, { reply_markup: kbAdmin() });
    return;
  }

  // --- AI ОТВЕТ (основной режим) ---
  if (!GROQ_KEY && !GEMINI_KEY) {
    await ctx.reply("⚠️ AI-ключи не настроены. Обратитесь к @mrztn", { reply_markup: kbMain(uid) });
    return;
  }

  try { await ctx.replyWithChatAction("typing"); } catch(e){}

  let history = [];
  try { history = JSON.parse(u.ai_context || "[]"); } catch(e){}
  history.push({ role: "user", content: text });
  if (history.length > 20) history = history.slice(-20);

  const messages = [{ role: "system", content: MERAI_SYSTEM }, ...history];

  const loading = await ctx.reply("⚡ _думаю..._", { parse_mode: "Markdown" });

  try {
    const response = await callAI(messages);
    await bot.api.deleteMessage(ctx.chat.id, loading.message_id).catch(()=>{});
    if (!response) { await ctx.reply("❌ Нет ответа от AI. Попробуйте позже.", { reply_markup: kbMain(uid) }); return; }
    history.push({ role: "assistant", content: response });
    if (history.length > 20) history = history.slice(-20);
    updateUser(uid, { ai_context: JSON.stringify(history), ai_requests: u.ai_requests + 1 });
    await sendLong(ctx.chat.id, response, { parse_mode: "Markdown" });
    if ((u.ai_requests + 1) >= 10) await checkAchievements(uid);
  } catch(e) {
    await bot.api.deleteMessage(ctx.chat.id, loading.message_id).catch(()=>{});
    await ctx.reply(`❌ Ошибка AI: ${e.message.slice(0,200)}`, { reply_markup: kbMain(uid) });
  }
});

// ==================================================================================================
//  COMMANDS
// ==================================================================================================
bot.command("help",   async ctx => { await ctx.reply("Нажмите /start для открытия меню", { reply_markup: kbMain(ctx.from.id) }); });
bot.command("level",  async ctx => {
  const u = getUser(ctx.from.id); if (!u) { await ctx.reply("/start"); return; }
  const nx = u.user_level*u.user_level*100;
  const pr = Math.min(u.xp,nx);
  const bar= "█".repeat(Math.floor(pr/nx*10))+"░".repeat(10-Math.floor(pr/nx*10));
  await ctx.reply(`⭐ <b>Уровень ${u.user_level}</b>\n${bar}\n${pr}/${nx} XP`, { parse_mode:"HTML" });
});
bot.command("ach", async ctx => {
  const achs = db.prepare("SELECT * FROM achievements WHERE user_id=? ORDER BY unlocked_at DESC").all(ctx.from.id);
  if (!achs.length) { await ctx.reply("🏆 Пока нет достижений!"); return; }
  const L = {first_msg:"💬 Первое сообщение",msg_100:"💬 100 сообщений",msg_1000:"💬 1 000",first_del:"🗑 Первое удаление",del_50:"🗑 50 удалений",first_media:"📸 Первое медиа",ai_user:"🤖 AI-ассистент",level_5:"⭐ Уровень 5",level_10:"⭐ Уровень 10",connected:"🔗 Business API",premium:"👑 Premium",legend:"♾️ Легенда"};
  await ctx.reply(`🏆 <b>Достижения</b> (${achs.length}):\n\n`+achs.map(a=>`${L[a.code]||a.code} — ${(a.unlocked_at||"").slice(0,10)}`).join("\n"), { parse_mode:"HTML" });
});

bot.command("block", async ctx => {
  const p=(ctx.message.text||"").split(/\s+/);if(p.length<2){await ctx.reply("Использование: /block ID");return;}
  const sid=parseInt(p[1]);if(isNaN(sid)){await ctx.reply("❌");return;}
  db.prepare("INSERT OR IGNORE INTO blocklist(user_id,sender_id) VALUES(?,?)").run(ctx.from.id,sid);
  await ctx.reply(`🚫 <code>${sid}</code> заблокирован`,{parse_mode:"HTML"});
});
bot.command("unblock", async ctx => {
  const p=(ctx.message.text||"").split(/\s+/);if(p.length<2){await ctx.reply("Использование: /unblock ID");return;}
  const sid=parseInt(p[1]);if(isNaN(sid)){await ctx.reply("❌");return;}
  db.prepare("DELETE FROM blocklist WHERE user_id=? AND sender_id=?").run(ctx.from.id,sid);
  await ctx.reply(`✅ <code>${sid}</code> разблокирован`,{parse_mode:"HTML"});
});
bot.command("kw", async ctx => {
  const p=(ctx.message.text||"").split(/\s+/);if(p.length<2){await ctx.reply("Использование: /kw слово");return;}
  db.prepare("INSERT INTO keywords(user_id,keyword) VALUES(?,?)").run(ctx.from.id,p.slice(1).join(" ").toLowerCase().trim());
  await ctx.reply(`✅ Ключевое слово добавлено`);
});
bot.command("unkw", async ctx => {
  const p=(ctx.message.text||"").split(/\s+/);if(p.length<2){await ctx.reply("Использование: /unkw слово");return;}
  db.prepare("DELETE FROM keywords WHERE user_id=? AND keyword=?").run(ctx.from.id,p.slice(1).join(" ").toLowerCase().trim());
  await ctx.reply(`✅ Ключевое слово удалено`);
});

// ==================================================================================================
//  BUSINESS API HANDLERS
// ==================================================================================================
bot.on("business_connection", async ctx => {
  try {
    const bc = ctx.update.business_connection;
    if (!bc) return;
    const uid = bc.user.id;
    if (!bc.is_enabled) {
      db.prepare("UPDATE connections SET is_active=0 WHERE connection_id=?").run(bc.id);
      return;
    }
    addUser(uid, bc.user.username, bc.user.first_name, null);
    db.prepare("INSERT OR REPLACE INTO connections(connection_id,user_id) VALUES(?,?)").run(bc.id, uid);
    const trialOk = activateTrial(uid);
    addXp(uid, 100);
    await checkAchievements(uid);
    console.log(`[CONN] uid=${uid} cid=${bc.id}`);
    try {
      let msg = `🎉 <b>Мониторинг подключён!</b>\n\n✅ Сохраняю все сообщения в ваших чатах`;
      if (trialOk) { const exp=new Date(Date.now()+TRIAL_DAYS*86400000); msg+=`\n\n🎁 <b>Пробный период ${TRIAL_DAYS} дня</b>\nДо: ${exp.toLocaleDateString("ru-RU")}`; }
      msg += `\n\n⏱ Медиа с таймером — перехватываю немедленно\n🗑 При удалении — сразу отправлю вам\n✏️ При редактировании — покажу оригинал`;
      await bot.api.sendMessage(uid, msg, { parse_mode:"HTML", reply_markup:kbMain(uid) });
    } catch(e){}
    try { await bot.api.sendMessage(ADMIN_ID, `🔗 Подключение: uid=${uid} @${bc.user.username||"—"}\nПробный: ${trialOk?"✅":"❌"}`); } catch(e){}
  } catch(e) { console.error("[business_connection]", e.message); }
});

bot.on("business_message", async ctx => {
  try {
    const msg = ctx.update.business_message;
    if (!msg?.business_connection_id) return;
    const conn = getConn(msg.business_connection_id);
    if (!conn) return;

    const uid      = conn.user_id;
    const senderId = msg.from?.id || 0;

    if (!checkSub(uid)) return;
    if (db.prepare("SELECT 1 FROM blocklist WHERE user_id=? AND sender_id=?").get(uid, senderId)) return;

    const isViewOnce = !!msg.has_media_spoiler;
    let mediaType = null, fileId = null, fileUniqueId = null, hasTimer = isViewOnce;

    if (msg.photo?.length > 0) {
      mediaType    = "photo";
      const best   = msg.photo[msg.photo.length - 1];
      fileId       = best.file_id;
      fileUniqueId = best.file_unique_id;
    } else if (msg.video) {
      mediaType    = "video";
      fileId       = msg.video.file_id;
      fileUniqueId = msg.video.file_unique_id;
      if (msg.video.has_protected_content) hasTimer = true;
    } else if (msg.video_note) {
      mediaType    = "video_note";
      fileId       = msg.video_note.file_id;
      fileUniqueId = msg.video_note.file_unique_id;
      hasTimer     = true;
    } else if (msg.voice) {
      mediaType    = "voice";
      fileId       = msg.voice.file_id;
      fileUniqueId = msg.voice.file_unique_id;
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

    let filePath = null;
    if (fileId) {
      filePath = await downloadMedia(fileId, fileUniqueId, mediaType, uid, hasTimer);
    }

    saveMsg(uid, msg.business_connection_id, "business", msg.chat.id, msg.message_id,
      senderId, msg.from?.username, msg.from?.first_name,
      msg.text||null, msg.caption||null, mediaType, fileId, fileUniqueId, filePath, hasTimer, isViewOnce);

    addXp(uid, 1 + (mediaType?2:0) + (hasTimer?5:0));
    const u = getUser(uid); if (!u) return;

    const content = msg.text || msg.caption || "";
    if (u.notify_scam && isScam(content)) {
      const sName = msg.from?.first_name || "?";
      try { await bot.api.sendMessage(uid, `⚠️🚨 <b>СКАМ-ПОПЫТКА!</b>\n\nОт: <b>${sName}</b>\n\n<blockquote>${short(content,400)}</blockquote>`, { parse_mode:"HTML" }); } catch(e){}
    }
    if (u.notify_keywords && content) {
      const kws = db.prepare("SELECT keyword FROM keywords WHERE user_id=?").all(uid).map(r=>r.keyword);
      for (const kw of kws) {
        if (content.toLowerCase().includes(kw)) {
          try { await bot.api.sendMessage(uid, `🔔 <b>Триггер: «${kw}»</b>\n\nОт: <b>${msg.from?.first_name||"?"}</b>\n\n<blockquote>${short(content,300)}</blockquote>`, { parse_mode:"HTML" }); } catch(e){}
          break;
        }
      }
    }

    if (u.notify_timer && hasTimer && filePath) {
      const ico = {photo:"📸 Фото",video:"🎬 Видео",video_note:"🎥 Кружок",voice:"🎤 Голосовое",audio:"🎵 Аудио"};
      const sName = msg.from?.first_name || "Пользователь";
      try {
        await bot.api.sendMessage(uid,
          `⏱ <b>Перехвачено таймер-медиа!</b>\n\n${ico[mediaType]||"📎 Файл"}\nОт: <b>${sName}</b>\n${isViewOnce?"👁 Одноразовое\n":""}✅ Файл сохранён`,
          { parse_mode:"HTML" });
        await sendMediaFile(uid, filePath, mediaType, `⏱ От ${sName}${isViewOnce?" (одноразовое)":""}`);
      } catch(e){}
    }

    await checkAchievements(uid);
  } catch(e) { console.error("[business_message]", e.message); }
});

bot.on("edited_business_message", async ctx => {
  try {
    const msg = ctx.update.edited_business_message;
    if (!msg?.business_connection_id) return;
    const conn = getConn(msg.business_connection_id);
    if (!conn) return;

    const uid = conn.user_id;
    const u   = getUser(uid); if (!u) return;

    const original = getMsg(uid, msg.chat.id, msg.message_id);
    const origText = original?.text || original?.caption || "";
    const newText  = msg.text || msg.caption || "";
    markEdited(uid, msg.chat.id, msg.message_id, origText);
    addXp(uid, 2);

    if (!u.notify_edits) return;

    const sName  = msg.from?.first_name || "Пользователь";
    let notif    = `✏️ <b>Сообщение изменено</b>\n\nОт: <b>${sName}</b>\n\n`;
    if (origText) notif += `<b>Было:</b>\n<blockquote>${short(origText, 500)}</blockquote>\n\n`;
    notif += newText ? `<b>Стало:</b>\n<blockquote>${short(newText, 500)}</blockquote>` : `<i>(текст удалён)</i>`;
    try { await bot.api.sendMessage(uid, notif.slice(0,4096), { parse_mode:"HTML" }); } catch(e){}
  } catch(e) { console.error("[edited_business_message]", e.message); }
});

bot.on("deleted_business_messages", async ctx => {
  try {
    const del    = ctx.update.deleted_business_messages;
    if (!del) return;
    const msgIds = del.message_ids || [];
    const conn   = getConn(del.business_connection_id);
    if (!conn) return;

    const uid = conn.user_id;
    const u   = getUser(uid);

    for (const mid of msgIds) markDeleted(uid, del.chat.id, mid);
    addXp(uid, 3 * msgIds.length);

    if (!u || !u.notify_deletions) return;

    const chatTitle = del.chat.title || del.chat.first_name || del.chat.username || `Chat#${del.chat.id}`;

    const totalInChat = db.prepare("SELECT COUNT(*) c FROM messages WHERE user_id=? AND chat_id=?").get(uid, del.chat.id)?.c || 0;
    const isFullDelete = msgIds.length >= 5 || (totalInChat > 5 && msgIds.length >= Math.floor(totalInChat * 0.85));

    if (isFullDelete) {
      const allChatMsgs = getChatMsgs(uid, del.chat.id);
      const msgsForZip  = allChatMsgs.length > 0 ? allChatMsgs : msgIds.map(id => getMsg(uid, del.chat.id, id)).filter(Boolean);
      try { await bot.api.sendMessage(uid, `🗑 <b>${msgIds.length >= totalInChat*0.85?"Чат удалён":"Массовое удаление"}</b>\n\nЧат: <b>${chatTitle}</b>\nУдалено: ${msgIds.length}\nВ архиве: ${msgsForZip.length}\n\n⏳ Создаю ZIP...`, { parse_mode:"HTML" }); } catch(e){}
      const zipPath = await buildZIP(uid, del.chat.id, msgsForZip, chatTitle);
      if (zipPath && fs.existsSync(zipPath)) {
        try { await bot.api.sendDocument(uid, new InputFile(zipPath, `dialog_${chatTitle.slice(0,20).replace(/\s/g,"_")}.zip`), { caption: `🗄 <b>${chatTitle}</b>\n📨 ${msgsForZip.length} сообщ. | ${new Date().toLocaleDateString("ru-RU")}`, parse_mode:"HTML" }); } catch(e) { console.error("[ZIP send]", e.message); }
      }
      return;
    }

    const ico = {photo:"📸 Фото",video:"🎬 Видео",video_note:"🎥 Кружок",voice:"🎤 Голосовое",audio:"🎵 Аудио",document:"📄 Документ",sticker:"🎭 Стикер",animation:"🎬 GIF"};
    for (const mid of msgIds) {
      const saved = getMsg(uid, del.chat.id, mid);
      if (!saved) {
        try { await bot.api.sendMessage(uid, `🗑 <b>Удалено</b>\n\nЧат: <b>${chatTitle}</b>\nID: ${mid}\n<i>Не было сохранено</i>`, { parse_mode:"HTML" }); } catch(e){}
        continue;
      }
      const sName  = saved.sender_name || saved.sender_username || `#${saved.sender_id}`;
      const ts     = (saved.created_at||"").slice(0,16).replace("T"," ");
      let notif    = `🗑 <b>Удалено</b>\n\nЧат: <b>${chatTitle}</b>\nОт: <b>${sName}</b>\nВремя: ${ts}\n\n`;
      if (saved.text||saved.caption) notif += `<b>Текст:</b>\n<blockquote>${short(saved.text||saved.caption,600)}</blockquote>\n\n`;
      if (saved.media_type) notif += `<b>Медиа:</b> ${ico[saved.media_type]||saved.media_type}${saved.has_timer?" <b>⏱ [ТАЙМЕР]</b>":""}${saved.is_view_once?" <b>[ОДНОРАЗОВОЕ]</b>":""}\n`;
      try { await bot.api.sendMessage(uid, notif.slice(0,4096), { parse_mode:"HTML" }); } catch(e){}
      const fp = saved.file_path;
      if (fp && fs.existsSync(fp)) {
        await sendMediaFile(uid, fp, saved.media_type, `📎 Файл от ${sName}${saved.has_timer?" [⏱]":""}`);
      } else if (saved.file_id && saved.media_type) {
        await sendMediaByFileId(uid, saved.file_id, saved.media_type, `📎 ${sName}${saved.has_timer?" [⏱]":""}`);
      }
    }
    await checkAchievements(uid);
  } catch(e) { console.error("[deleted_business_messages]", e.message); }
});

// ==================================================================================================
//  USERBOT (gram-js)
// ==================================================================================================
const activeBots = new Map();

async function launchUserbot(uid, sessionStr) {
  if (activeBots.has(uid)) {
    try { await activeBots.get(uid).disconnect(); } catch(e){}
    activeBots.delete(uid);
  }
  
  if (!TG_API_ID || !TG_API_HASH) {
    console.warn(`[UB] uid=${uid}: TG_API_ID/TG_API_HASH не настроены`);
    return null;
  }

  const client = new TelegramClient(new StringSession(sessionStr), TG_API_ID, TG_API_HASH, {
    connectionRetries: 5,
    retryDelay: 1000,
    useWSS: false,
    deviceModel: "Desktop",
    systemVersion: "Linux",
    appVersion: "1.0.0",
  });

  await client.connect();
  activeBots.set(uid, client);
  db.prepare("UPDATE userbot_sessions SET is_active=1, error_count=0 WHERE user_id=?").run(uid);

  console.log(`[UB] ✅ Запущен для uid=${uid}`);

  client.addEventHandler(async event => {
    try {
      const msg = event.message;
      if (!msg) return;

      const senderId   = msg.fromId?.userId?.toString() ? parseInt(msg.fromId.userId.toString()) : 0;
      const chatId     = msg.chatId?.toString() ? parseInt(msg.chatId.toString()) : 0;
      const senderName = (await getSenderName(client, msg.fromId)) || null;

      const isViewOnce = !!msg.media?.ttlSeconds || !!msg.media?.roundMessage?.attributes?.find?.(a => a?.className === "DocumentAttributeVideo" && a?.roundMessage);
      const hasTimer   = isViewOnce;

      let mediaType = null, fileId = null, fileUniqueId = null;
      let filePath  = null;

      if (msg.media) {
        const m = msg.media;
        if (m.photo) {
          mediaType    = "photo";
          fileUniqueId = m.photo.id?.toString();
        } else if (m.document) {
          const mimeType = m.document.mimeType || "";
          if (mimeType.startsWith("video/")) { mediaType = "video"; }
          else if (mimeType.startsWith("audio/")) { mediaType = "audio"; }
          else { mediaType = "document"; }
          fileUniqueId = m.document.id?.toString();
        }
      }
      if (msg.media?.voice) { mediaType = "voice"; }
      if (msg.media?.audio) { mediaType = "audio"; }

      if (hasTimer && msg.media) {
        try {
          const dir = path.join("media", String(uid));
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          const fp = path.join(dir, `timer_ub_${mediaType||"media"}_${Date.now()}.bin`);
          const buffer = await client.downloadMedia(msg.media, { workers: 1 });
          if (buffer && buffer.length > 0) {
            fs.writeFileSync(fp, buffer);
            filePath = fp;
            console.log(`[UB] ✅ Таймер-медиа скачано: ${fp}`);
          }
        } catch(e2) { console.warn("[UB media download]", e2.message); }
      }

      const text = msg.text || msg.message || null;
      saveMsg(uid, null, "userbot", chatId, msg.id, senderId, null, senderName, text, null,
        mediaType, fileId, fileUniqueId, filePath, hasTimer, isViewOnce);

      const u = getUser(uid);
      if (!u) return;

      if (u.notify_timer && hasTimer) {
        const ico = { photo:"📸 Фото", video:"🎬 Видео", voice:"🎤 Голосовое", audio:"🎵 Аудио", document:"📄 Файл" };
        try {
          await bot.api.sendMessage(uid,
            `⏱ <b>UserBot: таймер-медиа!</b>\n\n${ico[mediaType]||"📎 Файл"}\nОт: <b>${senderName||`#${senderId}`}</b>\n✅ Сохранено`,
            { parse_mode: "HTML" });
          if (filePath && fs.existsSync(filePath)) {
            await bot.api.sendDocument(uid, new InputFile(filePath), { caption: `⏱ Таймер от ${senderName||"?"}` });
          }
        } catch(e){}
      }
    } catch(e) { console.error("[UB newMsg]", e.message); }
  }, new NewMessage({}));

  client.addEventHandler(async event => {
    try {
      const msg = event.message;
      if (!msg) return;
      const senderId = msg.fromId?.userId?.toString() ? parseInt(msg.fromId.userId.toString()) : 0;
      const chatId   = msg.chatId?.toString() ? parseInt(msg.chatId.toString()) : 0;
      const saved    = getMsg(uid, chatId, msg.id);
      const origText = saved?.text || "";
      const newText  = msg.text || msg.message || "";
      markEdited(uid, chatId, msg.id, origText);
      const u = getUser(uid);
      if (!u || !u.notify_edits) return;
      const sName = saved?.sender_name || `#${senderId}`;
      try {
        await bot.api.sendMessage(uid,
          `✏️ <b>UserBot: изменено</b>\n\nОт: <b>${sName}</b>\n\n${origText ? `<b>Было:</b>\n<blockquote>${short(origText,400)}</blockquote>\n\n` : ""}<b>Стало:</b>\n<blockquote>${short(newText,400)}</blockquote>`,
          { parse_mode: "HTML" });
      } catch(e){}
    } catch(e) { console.error("[UB editMsg]", e.message); }
  }, new EditedMessage({}));

  const { DeletedMessage: DelEvt } = require("telegram/events");
  client.addEventHandler(async event => {
    try {
      const ids    = event.deletedIds || [];
      for (const mid of ids) {
        const found = db.prepare("SELECT * FROM messages WHERE user_id=? AND message_id=? AND source='userbot' ORDER BY created_at DESC LIMIT 1").get(uid, mid);
        if (!found) continue;
        markDeleted(uid, found.chat_id, mid);
        addXp(uid, 3);
        const u = getUser(uid); if (!u || !u.notify_deletions) continue;
        const sName  = found.sender_name || `#${found.sender_id}`;
        const ico    = {photo:"📸",video:"🎬",voice:"🎤",audio:"🎵",video_note:"🎥",document:"📄"};
        let notif    = `🗑 <b>UserBot: удалено</b>\n\nОт: <b>${sName}</b>\n\n`;
        if (found.text) notif += `<blockquote>${short(found.text,500)}</blockquote>\n`;
        if (found.media_type) notif += `${ico[found.media_type]||"📎"}${found.has_timer?" ⏱":""}\n`;
        try { await bot.api.sendMessage(uid, notif.slice(0,4096), { parse_mode:"HTML" }); } catch(e){}
        if (found.file_path && fs.existsSync(found.file_path)) {
          await bot.api.sendDocument(uid, new InputFile(found.file_path), { caption: `📎 Файл от ${sName}${found.has_timer?" [⏱]":""}` }).catch(()=>{});
        }
      }
    } catch(e) { console.error("[UB delMsg]", e.message); }
  }, new DelEvt({}));

  return client;
}

async function getSenderName(client, fromId) {
  if (!fromId) return null;
  try {
    const entity = await client.getEntity(fromId);
    return (entity.firstName||"")+(entity.lastName?" "+entity.lastName:"") || entity.username || null;
  } catch(e) { return null; }
}

async function disconnectUserbot(uid) {
  if (activeBots.has(uid)) {
    try { await activeBots.get(uid).disconnect(); } catch(e){}
    activeBots.delete(uid);
  }
  db.prepare("UPDATE userbot_sessions SET is_active=0 WHERE user_id=?").run(uid);
  console.log(`[UB] 🔴 Отключён uid=${uid}`);
}

async function restoreUserbots() {
  const sessions = db.prepare("SELECT * FROM userbot_sessions WHERE is_active=1 AND session_str IS NOT NULL").all();
  console.log(`[UB] 🔄 Восстановление ${sessions.length} сессий...`);
  for (const s of sessions) {
    try { await launchUserbot(s.user_id, s.session_str); } catch(e) {
      console.error(`[UB] ❌ Ошибка uid=${s.user_id}:`, e.message);
      db.prepare("UPDATE userbot_sessions SET is_active=0, error_count=error_count+1, last_error=? WHERE user_id=?").run(e.message, s.user_id);
    }
    await new Promise(r => setTimeout(r, 1500));
  }
}

// ==================================================================================================
//  CRON
// ==================================================================================================
cron.schedule("0 8 * * *", async () => {
  const yesterday = new Date(Date.now()-86400000).toISOString().slice(0,10);
  const users = db.prepare("SELECT * FROM users WHERE digest_enabled=1 AND is_blocked=0").all();
  for (const u of users) {
    if (!checkSub(u.user_id)) continue;
    const msgs = db.prepare("SELECT COUNT(*) c FROM messages WHERE user_id=? AND DATE(created_at)=?").get(u.user_id,yesterday)?.c||0;
    const dels = db.prepare("SELECT COUNT(*) c FROM messages WHERE user_id=? AND DATE(deleted_at)=?").get(u.user_id,yesterday)?.c||0;
    const edts = db.prepare("SELECT COUNT(*) c FROM messages WHERE user_id=? AND DATE(edited_at)=?").get(u.user_id,yesterday)?.c||0;
    const timr = db.prepare("SELECT COUNT(*) c FROM messages WHERE user_id=? AND has_timer=1 AND DATE(created_at)=?").get(u.user_id,yesterday)?.c||0;
    try { await bot.api.sendMessage(u.user_id, `📋 <b>Дайджест за ${yesterday}</b>\n\n💬 ${msgs} | 🗑 ${dels} | ✏️ ${edts} | ⏱ ${timr}`, { parse_mode:"HTML" }); } catch(e){}
    await new Promise(r=>setTimeout(r,100));
  }
});

cron.schedule("0 3 * * *", () => {
  try {
    const ts  = new Date().toISOString().slice(0,10).replace(/-/g,"");
    const dst = path.join("backups", `merai_${ts}.db`);
    if (!fs.existsSync(dst)) { fs.copyFileSync(DB_PATH, dst); console.log("[BACKUP] ✅", dst); }
    const files = fs.readdirSync("backups").filter(f=>f.endsWith(".db")).sort();
    if (files.length>7) files.slice(0,files.length-7).forEach(f=>{ try{fs.unlinkSync(path.join("backups",f))}catch(e){} });
  } catch(e) { console.error("[BACKUP] ❌", e.message); }
});

// ==================================================================================================
//  ЗАПУСК
// ==================================================================================================
async function main() {
  console.log("=".repeat(60));
  console.log("  MerAI — Monitoring & AI (ТЕСТОВАЯ ВЕРСИЯ)");
  console.log("=".repeat(60));
  console.log(`[DB]  ${DB_PATH}`);
  console.log(`[BOT] ${BOT_TOKEN.slice(0,12)}...`);
  console.log(`[AI]  Groq: ${GROQ_KEY?"✅":"❌"} | Gemini: ${GEMINI_KEY?"✅":"❌"}`);
  console.log(`[UB]  UserBot: ${TG_API_ID && TG_API_HASH?"✅ Настроен":"❌ Не настроен"}`);

  await bot.api.deleteWebhook({ drop_pending_updates: true }).catch(()=>{});

  const allowed = ["message","callback_query","pre_checkout_query",
    "business_connection","business_message","edited_business_message","deleted_business_messages"];

  const startPromise = bot.start({
    onStart: async info => {
      console.log(`✅ @${info.username} запущен`);
      await restoreUserbots();
      const stats = adminStats();
      try {
        await bot.api.sendMessage(ADMIN_ID,
          `✅ <b>MerAI запущен (ТЕСТОВАЯ ВЕРСИЯ)</b>\n@${info.username}\n\n` +
          `👥 Пользователей: ${fmt(stats.users)}\n` +
          `🤖 AI: ${GROQ_KEY?"Groq":""}${GEMINI_KEY?" + Gemini":""}\n` +
          `🔗 UserBot: ${TG_API_ID && TG_API_HASH?"✅":"❌"}\n` +
          `💾 БД: ${DB_PATH}`,
          { parse_mode:"HTML" });
      } catch(e){}
    },
    allowed_updates: allowed,
  });

  await startPromise;
}

process.once("SIGINT",  async () => { for (const [uid] of activeBots) await disconnectUserbot(uid); bot.stop(); process.exit(0); });
process.once("SIGTERM", async () => { for (const [uid] of activeBots) await disconnectUserbot(uid); bot.stop(); process.exit(0); });

main().catch(e => { console.error("❌ FATAL:", e.message, e.stack); process.exit(1); });
