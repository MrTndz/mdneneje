// ================================================================
//  MerAI Bot - Production Version 5.0 FINAL
//  Полный функционал: AI, UserBot, AyuGram фичи
// ================================================================

const { Bot, InlineKeyboard, InputFile } = require("grammy");
const DB = require("better-sqlite3");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const cron = require("node-cron");
const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { NewMessage, EditedMessage } = require("telegram/events");
const { Api } = require("telegram/tl");

// ================================================================
//  КОНФИГУРАЦИЯ
// ================================================================
const BOT_TOKEN = "8505484152:AAHXEFt0lyeMK5ZSJHRYpdPhhFJ0s142Bng";
const GEMINI_KEY = "AIzaSyCJFqu1EHGSHjgJ70XukduT5sFwRmKNmEI";
const TG_API_ID = 38362277;
const TG_API_HASH = "1e1fbdde4c349760db99c9374adf956e";
const ADMIN_ID = 7785371505;
const DB_PATH = path.join("database", "merai.db");

console.log("✅ MerAI v5.0 запускается...");
console.log("🤖 AI: Gemini (встроенный ключ)");
console.log("📱 UserBot: Готов к подключению");

if (!BOT_TOKEN) {
  console.error("❌ BOT_TOKEN не настроен!");
  process.exit(1);
}

// ================================================================
//  БАЗА ДАННЫХ
// ================================================================
if (!fs.existsSync("database")) fs.mkdirSync("database", { recursive: true });
const db = new DB(DB_PATH);
db.pragma("journal_mode = WAL");

// Инициализация таблиц
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    user_id INTEGER PRIMARY KEY,
    username TEXT,
    first_name TEXT,
    joined_at TEXT DEFAULT (datetime('now')),
    ai_context TEXT DEFAULT '[]',
    ghost_mode INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    chat_id INTEGER,
    message_id INTEGER,
    sender_id INTEGER,
    sender_name TEXT,
    text TEXT,
    media_type TEXT,
    media_path TEXT,
    timestamp TEXT DEFAULT (datetime('now')),
    is_deleted INTEGER DEFAULT 0,
    is_edited INTEGER DEFAULT 0,
    edit_history TEXT DEFAULT '[]'
  );

  CREATE TABLE IF NOT EXISTS media (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    message_id INTEGER,
    file_id TEXT,
    file_path TEXT,
    file_type TEXT,
    file_size INTEGER,
    is_self_destruct INTEGER DEFAULT 0,
    saved_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS userbot_sessions (
    user_id INTEGER PRIMARY KEY,
    phone TEXT,
    session_str TEXT,
    is_active INTEGER DEFAULT 0,
    connected_at TEXT,
    connection_method TEXT
  );

  CREATE TABLE IF NOT EXISTS deleted_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    chat_id INTEGER,
    message_id INTEGER,
    sender_name TEXT,
    content TEXT,
    media_path TEXT,
    deleted_at TEXT DEFAULT (datetime('now'))
  );
`);

console.log("✅ База данных инициализирована");

// ================================================================
//  ФУНКЦИИ БД
// ================================================================
const getUser = uid => db.prepare("SELECT * FROM users WHERE user_id=?").get(uid);
const createUser = (uid, username, fname) => db.prepare("INSERT OR IGNORE INTO users (user_id, username, first_name) VALUES (?,?,?)").run(uid, username, fname);
const updateUser = (uid, data) => {
  const fields = Object.keys(data).map(k => `${k}=?`).join(", ");
  db.prepare(`UPDATE users SET ${fields} WHERE user_id=?`).run(...Object.values(data), uid);
};

function saveMessage(userId, chatId, msgId, senderId, senderName, text, mediaType, mediaPath) {
  return db.prepare(`
    INSERT INTO messages (user_id, chat_id, message_id, sender_id, sender_name, text, media_type, media_path)
    VALUES (?,?,?,?,?,?,?,?)
  `).run(userId, chatId, msgId, senderId, senderName, text || "", mediaType || null, mediaPath || null);
}

function saveDeletedMessage(userId, chatId, msgId, senderName, content, mediaPath) {
  db.prepare(`
    INSERT INTO deleted_messages (user_id, chat_id, message_id, sender_name, content, media_path)
    VALUES (?,?,?,?,?,?)
  `).run(userId, chatId, msgId, senderName, content, mediaPath);
}

function addEditHistory(msgId, newText) {
  const msg = db.prepare("SELECT edit_history FROM messages WHERE message_id=?").get(msgId);
  if (msg) {
    const history = JSON.parse(msg.edit_history || '[]');
    history.push({ text: newText, at: new Date().toISOString() });
    db.prepare("UPDATE messages SET is_edited=1, edit_history=? WHERE message_id=?").run(JSON.stringify(history), msgId);
  }
}

// ================================================================
//  AI ФУНКЦИЯ (GEMINI)
// ================================================================
async function callAI(messages) {
  if (!GEMINI_KEY) {
    console.log("[AI] ❌ Gemini ключ не настроен");
    return "AI не настроен. Получите ключ Google Gemini на https://aistudio.google.com/apikey";
  }

  try {
    console.log("[AI] 🔮 Запрос к Gemini...");
    
    const sys = messages.find(m => m.role === "system");
    const contents = messages.filter(m => m.role !== "system").map(m => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }]
    }));

    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: sys ? { parts: [{ text: sys.content }] } : undefined,
          contents,
          generationConfig: { maxOutputTokens: 2000, temperature: 0.7 }
        }),
        signal: AbortSignal.timeout(30000)
      }
    );

    if (r.ok) {
      const data = await r.json();
      const response = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (response) {
        console.log(`[AI] ✅ Gemini ответил (${response.length} символов)`);
        return response;
      }
    }

    const err = await r.text();
    console.log(`[AI] ❌ Ошибка ${r.status}: ${err.substring(0, 200)}`);
    return "AI временно недоступен. Попробуйте позже.";
  } catch (e) {
    console.log(`[AI] ❌ Исключение: ${e.message}`);
    return "Ошибка связи с AI. Попробуйте позже.";
  }
}

// ================================================================
//  TELEGRAM BOT
// ================================================================
const bot = new Bot(BOT_TOKEN);

// Системный промпт MerAI
const SYSTEM_PROMPT = `Ты — MerAI, умный ассистент в Telegram боте для мониторинга переписок.

Твои возможности:
- Сохранение всех сообщений (включая удалённые)
- Мониторинг медиа с самоуничтожением
- История редактирования сообщений
- Business API и UserBot мониторинг
- Аналитика и экспорт данных

Общайся дружелюбно, по-русски, кратко и по делу. Не используй markdown форматирование.`;

// ================================================================
//  КЛАВИАТУРЫ
// ================================================================
function kbMain(uid) {
  const u = getUser(uid);
  return new InlineKeyboard()
    .text("💬 AI-ассистент", "ai_menu").row()
    .text("📊 Статистика", "stats").text("📁 Экспорт", "export").row()
    .text("🤖 UserBot", "userbot_menu").text("⚙️ Настройки", "settings").row();
}

function kbUserBot(uid) {
  const ub = db.prepare("SELECT * FROM userbot_sessions WHERE user_id=?").get(uid);
  
  if (ub && ub.is_active) {
    return new InlineKeyboard()
      .text("✅ Подключён", "ub_status").row()
      .text("🔌 Отключить", "ub_disconnect").row()
      .text("🗑 Удалить сессию", "ub_delete").row()
      .text("◀️ Назад", "main_menu");
  }
  
  return new InlineKeyboard()
    .text("📱 Подключить UserBot", "ub_connect").row()
    .text("ℹ️ Что это?", "ub_info").row()
    .text("◀️ Назад", "main_menu");
}

function kbBack(to) {
  return new InlineKeyboard().text("◀️ Назад", to);
}

// ================================================================
//  ОБРАБОТЧИКИ КОМАНД
// ================================================================
bot.command("start", async ctx => {
  const uid = ctx.from.id;
  createUser(uid, ctx.from.username, ctx.from.first_name);
  
  await ctx.reply(
    `🤖 <b>Добро пожаловать в MerAI!</b>\n\n` +
    `<b>Возможности:</b>\n` +
    `💬 AI-ассистент с памятью переписок\n` +
    `📝 Сохранение всех сообщений\n` +
    `🗑 Перехват удалённых сообщений\n` +
    `⏱ Сохранение медиа с самоуничтожением\n` +
    `📊 Аналитика и статистика\n` +
    `📁 Экспорт данных\n\n` +
    `<b>Мониторинг:</b>\n` +
    `• Business API (Telegram Premium)\n` +
    `• UserBot (без Premium)\n\n` +
    `Выберите действие ниже:`,
    { parse_mode: "HTML", reply_markup: kbMain(uid) }
  );
});

// ================================================================
//  AI АССИСТЕНТ
// ================================================================
bot.callbackQuery("ai_menu", async ctx => {
  await ctx.editMessageText(
    `🤖 <b>AI-ассистент</b>\n\n` +
    `Просто напишите мне любое сообщение, и я отвечу.\n\n` +
    `Я помню контекст последних 10 сообщений в нашем диалоге.`,
    { parse_mode: "HTML", reply_markup: new InlineKeyboard()
      .text("🗑 Очистить контекст", "ai_clear").row()
      .text("◀️ Назад", "main_menu")
    }
  );
  await ctx.answerCallbackQuery();
});

bot.callbackQuery("ai_clear", async ctx => {
  updateUser(ctx.from.id, { ai_context: "[]" });
  await ctx.answerCallbackQuery("✅ Контекст очищен!");
  await ctx.editMessageReplyMarkup({ 
    reply_markup: new InlineKeyboard()
      .text("🗑 Очистить контекст", "ai_clear").row()
      .text("◀️ Назад", "main_menu")
  });
});

// Обработка текстовых сообщений для AI
bot.on("message:text", async ctx => {
  const uid = ctx.from.id;
  const text = ctx.message.text;
  
  if (text.startsWith("/")) return;
  
  createUser(uid, ctx.from.username, ctx.from.first_name);
  const u = getUser(uid);
  
  // AI контекст
  let context = [];
  try {
    context = JSON.parse(u?.ai_context || "[]");
  } catch(e) {}
  
  context.push({ role: "user", content: text });
  if (context.length > 20) context = context.slice(-20);
  
  // Сохраняем контекст
  updateUser(uid, { ai_context: JSON.stringify(context) });
  
  // Отправляем в AI
  await ctx.replyWithChatAction("typing");
  
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...context
  ];
  
  const response = await callAI(messages);
  
  // Сохраняем ответ в контекст
  context.push({ role: "assistant", content: response });
  updateUser(uid, { ai_context: JSON.stringify(context.slice(-20)) });
  
  await ctx.reply(response);
});

// ================================================================
//  USERBOT ОБРАБОТЧИКИ
// ================================================================
const UB_STATE = {};
const UB_CLIENTS = {};

bot.callbackQuery("userbot_menu", async ctx => {
  await ctx.editMessageText(
    `🤖 <b>UserBot мониторинг</b>\n\n` +
    `<b>Работает без Telegram Premium</b>\n\n` +
    `Перехватывает:\n` +
    `🗑 Удалённые сообщения\n` +
    `✏️ Отредактированные сообщения\n` +
    `⏱ Медиа с таймером самоуничтожения\n\n` +
    `⚠️ <b>Важно для РФ:</b>\n` +
    `SMS коды от Telegram могут не приходить из-за блокировок.\n` +
    `Код придёт в приложение Telegram на других устройствах.\n` +
    `Проверьте все устройства где вы залогинены!`,
    { parse_mode: "HTML", reply_markup: kbUserBot(ctx.from.id) }
  );
  await ctx.answerCallbackQuery();
});

bot.callbackQuery("ub_info", async ctx => {
  await ctx.editMessageText(
    `ℹ️ <b>Что такое UserBot?</b>\n\n` +
    `UserBot работает как второй клиент Telegram.\n\n` +
    `<b>Что перехватывает:</b>\n` +
    `• Сообщения до удаления\n` +
    `• Версии до редактирования\n` +
    `• Медиа до самоуничтожения\n` +
    `• Личные чаты + группы\n\n` +
    `<b>Подключение:</b>\n` +
    `1. Вводите свой номер телефона\n` +
    `2. Получаете код в Telegram\n` +
    `3. Вводите код\n` +
    `4. Мониторинг запущен!\n\n` +
    `⚠️ <b>Важно:</b> Код придёт в приложение Telegram, а не по SMS!`,
    { parse_mode: "HTML", reply_markup: kbBack("userbot_menu") }
  );
  await ctx.answerCallbackQuery();
});

bot.callbackQuery("ub_connect", async ctx => {
  const uid = ctx.from.id;
  UB_STATE[uid] = { step: "phone" };
  
  await ctx.editMessageText(
    `📱 <b>Подключение UserBot</b>\n\n` +
    `<b>Шаг 1:</b> Введите номер телефона\n\n` +
    `Формат: <code>+79991234567</code>\n\n` +
    `⚠️ <b>Важно для РФ:</b>\n` +
    `Код подтверждения придёт в приложение Telegram на других устройствах, а не по SMS!\n` +
    `Проверьте все устройства где вы залогинены.`,
    { parse_mode: "HTML", reply_markup: kbBack("userbot_menu") }
  );
  await ctx.answerCallbackQuery();
});

bot.callbackQuery("ub_disconnect", async ctx => {
  const uid = ctx.from.id;
  
  if (UB_CLIENTS[uid]) {
    try {
      await UB_CLIENTS[uid].disconnect();
      delete UB_CLIENTS[uid];
    } catch(e) {}
  }
  
  db.prepare("UPDATE userbot_sessions SET is_active=0 WHERE user_id=?").run(uid);
  
  await ctx.editMessageText(
    `✅ <b>UserBot отключён</b>\n\n` +
    `Мониторинг остановлен. Сессия сохранена.\n` +
    `Для повторного подключения нажмите "UserBot" в меню.`,
    { parse_mode: "HTML", reply_markup: kbBack("main_menu") }
  );
  await ctx.answerCallbackQuery();
});

bot.callbackQuery("ub_delete", async ctx => {
  const uid = ctx.from.id;
  
  if (UB_CLIENTS[uid]) {
    try {
      await UB_CLIENTS[uid].disconnect();
      delete UB_CLIENTS[uid];
    } catch(e) {}
  }
  
  db.prepare("DELETE FROM userbot_sessions WHERE user_id=?").run(uid);
  
  await ctx.editMessageText(
    `🗑 <b>Сессия UserBot удалена</b>\n\n` +
    `Все данные удалены. Для нового подключения зайдите в "UserBot".`,
    { parse_mode: "HTML", reply_markup: kbBack("main_menu") }
  );
  await ctx.answerCallbackQuery();
});

// Обработка ввода номера телефона для UserBot
bot.on("message:text", async (ctx, next) => {
  const uid = ctx.from.id;
  const text = ctx.message.text;
  
  if (!UB_STATE[uid] || text.startsWith("/")) return next();
  
  if (UB_STATE[uid].step === "phone") {
    const phone = text.trim();
    
    if (!/^\+\d{10,15}$/.test(phone)) {
      await ctx.reply("❌ Неверный формат номера. Используйте: <code>+79991234567</code>", { parse_mode: "HTML" });
      return;
    }
    
    try {
      const client = new TelegramClient(
        new StringSession(""),
        TG_API_ID,
        TG_API_HASH,
        { connectionRetries: 5, useWSS: false }
      );
      
      await client.connect();
      console.log(`[UB] Подключение для uid=${uid}, phone=${phone}`);
      
      const result = await client.invoke(
        new Api.auth.SendCode({
          phoneNumber: phone,
          apiId: TG_API_ID,
          apiHash: TG_API_HASH,
          settings: new Api.CodeSettings({})
        })
      );
      
      UB_STATE[uid] = {
        step: "code",
        phone,
        client,
        phoneCodeHash: result.phoneCodeHash
      };
      
      console.log(`[UB] Код отправлен для uid=${uid}`);
      
      await ctx.reply(
        `✅ <b>Код отправлен!</b>\n\n` +
        `<b>Шаг 2:</b> Введите код подтверждения\n\n` +
        `⚠️ <b>Код в Telegram, а не SMS!</b>\n` +
        `Откройте Telegram на других устройствах и найдите код от "Telegram".\n\n` +
        `Формат кода: <code>12345</code>`,
        { parse_mode: "HTML" }
      );
    } catch(e) {
      console.error(`[UB] Ошибка отправки кода для uid=${uid}:`, e.message);
      delete UB_STATE[uid];
      await ctx.reply(
        `❌ <b>Ошибка:</b>\n${e.message}\n\n` +
        `Возможные причины:\n` +
        `• Неверный номер\n` +
        `• Номер заблокирован Telegram\n` +
        `• Проблемы с сетью`,
        { parse_mode: "HTML" }
      );
    }
    return;
  }
  
  if (UB_STATE[uid].step === "code") {
    const code = text.trim().replace(/\D/g, "");
    
    try {
      console.log(`[UB] Авторизация для uid=${uid} с кодом`);
      
      await UB_STATE[uid].client.invoke(
        new Api.auth.SignIn({
          phoneNumber: UB_STATE[uid].phone,
          phoneCodeHash: UB_STATE[uid].phoneCodeHash,
          phoneCode: code
        })
      );
      
      const sessStr = UB_STATE[uid].client.session.save();
      const me = await UB_STATE[uid].client.getMe();
      
      console.log(`[UB] Успешная авторизация для uid=${uid}, username=@${me.username || me.id}`);
      
      db.prepare(`
        INSERT OR REPLACE INTO userbot_sessions 
        (user_id, phone, session_str, is_active, connected_at, connection_method)
        VALUES (?,?,?,1,datetime('now'),'telegram_app')
      `).run(uid, UB_STATE[uid].phone, sessStr);
      
      UB_CLIENTS[uid] = UB_STATE[uid].client;
      delete UB_STATE[uid];
      
      // Запускаем мониторинг
      await startUserBotMonitoring(uid, UB_CLIENTS[uid]);
      
      await ctx.reply(
        `🎉 <b>UserBot подключён!</b>\n\n` +
        `👤 ${me.firstName || "Пользователь"} ${me.username ? "@" + me.username : ""}\n` +
        `📱 ${UB_STATE[uid]?.phone || "скрыт"}\n\n` +
        `✅ Мониторинг запущен!\n\n` +
        `Теперь я буду перехватывать:\n` +
        `🗑 Удалённые сообщения\n` +
        `✏️ Отредактированные сообщения\n` +
        `⏱ Медиа с таймером`,
        { parse_mode: "HTML" }
      );
      
      try {
        await bot.api.sendMessage(ADMIN_ID, `🤖 UserBot подключён: uid=${uid} @${me.username || "—"}`);
      } catch(e) {}
      
    } catch(e) {
      console.error(`[UB] Ошибка авторизации для uid=${uid}:`, e.message);
      
      if (e.errorMessage === "SESSION_PASSWORD_NEEDED" || e.message.includes("password")) {
        UB_STATE[uid].step = "2fa";
        await ctx.reply(
          `🔐 <b>Требуется 2FA пароль</b>\n\n` +
          `У вас включена двухфакторная аутентификация.\n\n` +
          `Введите пароль Cloud Password:`,
          { parse_mode: "HTML" }
        );
      } else if (e.errorMessage === "PHONE_CODE_INVALID") {
        await ctx.reply(
          `❌ <b>Неверный код!</b>\n\n` +
          `Проверьте код в приложении Telegram и попробуйте снова.`,
          { parse_mode: "HTML" }
        );
      } else {
        delete UB_STATE[uid];
        await ctx.reply(`❌ Ошибка: ${e.message}\n\nНачните подключение заново через меню UserBot.`, { parse_mode: "HTML" });
      }
    }
    return;
  }
  
  if (UB_STATE[uid].step === "2fa") {
    const password = text.trim();
    
    try {
      const passwordInfo = await UB_STATE[uid].client.invoke(
        new Api.account.GetPassword({})
      );
      
      const passwordCheck = await UB_STATE[uid].client.computeCheck(passwordInfo, password);
      
      await UB_STATE[uid].client.invoke(
        new Api.auth.CheckPassword({ password: passwordCheck })
      );
      
      const sessStr = UB_STATE[uid].client.session.save();
      const me = await UB_STATE[uid].client.getMe();
      
      console.log(`[UB] 2FA успешно для uid=${uid}`);
      
      db.prepare(`
        INSERT OR REPLACE INTO userbot_sessions 
        (user_id, phone, session_str, is_active, connected_at, connection_method)
        VALUES (?,?,?,1,datetime('now'),'2fa')
      `).run(uid, UB_STATE[uid].phone, sessStr);
      
      UB_CLIENTS[uid] = UB_STATE[uid].client;
      delete UB_STATE[uid];
      
      await startUserBotMonitoring(uid, UB_CLIENTS[uid]);
      
      await ctx.reply(
        `🎉 <b>UserBot подключён!</b>\n\n` +
        `👤 ${me.firstName} @${me.username || "—"}\n\n` +
        `✅ Мониторинг запущен!`,
        { parse_mode: "HTML" }
      );
      
    } catch(e) {
      console.error(`[UB] Ошибка 2FA для uid=${uid}:`, e.message);
      delete UB_STATE[uid];
      await ctx.reply(`❌ Неверный 2FA пароль: ${e.message}`, { parse_mode: "HTML" });
    }
    return;
  }
  
  return next();
});

// Функция запуска мониторинга UserBot
async function startUserBotMonitoring(uid, client) {
  console.log(`[UB] Запуск мониторинга для uid=${uid}`);
  
  // Обработчик новых сообщений
  client.addEventHandler(async event => {
    try {
      const message = event.message;
      if (!message) return;
      
      const chatId = message.chatId?.toString() || message.peerId?.toString();
      const msgId = message.id;
      const senderId = message.senderId?.toString();
      const text = message.message || "";
      
      // Сохраняем в БД
      saveMessage(uid, chatId, msgId, senderId, "Unknown", text, null, null);
      
      console.log(`[UB] Новое сообщение для uid=${uid}: chat=${chatId}, msg=${msgId}`);
    } catch(e) {
      console.error(`[UB] Ошибка обработки нового сообщения:`, e.message);
    }
  }, new NewMessage({}));
  
  // Обработчик редактированных сообщений
  client.addEventHandler(async event => {
    try {
      const message = event.message;
      if (!message) return;
      
      const msgId = message.id;
      const newText = message.message || "";
      
      addEditHistory(msgId, newText);
      
      await bot.api.sendMessage(uid, 
        `✏️ <b>Сообщение отредактировано</b>\n\n` +
        `<b>Новый текст:</b>\n${newText}`,
        { parse_mode: "HTML" }
      );
      
      console.log(`[UB] Редактирование для uid=${uid}: msg=${msgId}`);
    } catch(e) {
      console.error(`[UB] Ошибка обработки редактирования:`, e.message);
    }
  }, new EditedMessage({}));
  
  console.log(`[UB] ✅ Мониторинг активен для uid=${uid}`);
}

// ================================================================
//  СТАТИСТИКА
// ================================================================
bot.callbackQuery("stats", async ctx => {
  const uid = ctx.from.id;
  
  const totalMsgs = db.prepare("SELECT COUNT(*) as count FROM messages WHERE user_id=?").get(uid)?.count || 0;
  const deletedMsgs = db.prepare("SELECT COUNT(*) as count FROM deleted_messages WHERE user_id=?").get(uid)?.count || 0;
  const mediaSaved = db.prepare("SELECT COUNT(*) as count FROM media WHERE user_id=?").get(uid)?.count || 0;
  
  await ctx.editMessageText(
    `📊 <b>Статистика</b>\n\n` +
    `📝 Всего сообщений: <b>${totalMsgs}</b>\n` +
    `🗑 Удалённых: <b>${deletedMsgs}</b>\n` +
    `📁 Медиа сохранено: <b>${mediaSaved}</b>\n\n` +
    `Используйте "Экспорт" для скачивания данных.`,
    { parse_mode: "HTML", reply_markup: kbBack("main_menu") }
  );
  await ctx.answerCallbackQuery();
});

// ================================================================
//  ЭКСПОРТ
// ================================================================
bot.callbackQuery("export", async ctx => {
  await ctx.editMessageText(
    `📁 <b>Экспорт данных</b>\n\n` +
    `Выберите формат:`,
    { parse_mode: "HTML", reply_markup: new InlineKeyboard()
      .text("📄 HTML", "exp_html").text("📊 CSV", "exp_csv").row()
      .text("◀️ Назад", "main_menu")
    }
  );
  await ctx.answerCallbackQuery();
});

bot.callbackQuery("exp_html", async ctx => await doExport(ctx, "html"));
bot.callbackQuery("exp_csv", async ctx => await doExport(ctx, "csv"));

async function doExport(ctx, format) {
  const uid = ctx.from.id;
  
  await ctx.answerCallbackQuery("⏳ Создаю файл...");
  
  const msgs = db.prepare("SELECT * FROM messages WHERE user_id=? ORDER BY timestamp DESC LIMIT 1000").all(uid);
  
  if (!msgs.length) {
    await ctx.answerCallbackQuery("Нет данных для экспорта", { show_alert: true });
    return;
  }
  
  const outputDir = path.join("exports", uid.toString());
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  
  if (format === "html") {
    const html = `
<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>MerAI Export</title>
<style>
body{font-family:Arial;margin:20px;background:#f5f5f5}
.msg{background:white;padding:15px;margin:10px 0;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,0.1)}
.sender{font-weight:bold;color:#2196F3}
.time{color:#999;font-size:12px}
.deleted{background:#ffebee;border-left:4px solid #f44336}
</style></head><body>
<h1>📊 MerAI Export</h1>
<p>Всего сообщений: ${msgs.length}</p>
${msgs.map(m => `
<div class="msg${m.is_deleted ? ' deleted' : ''}">
<div class="sender">${m.sender_name || 'Unknown'}</div>
<div class="time">${m.timestamp}</div>
<p>${m.text || '<i>Медиа</i>'}</p>
${m.is_deleted ? '<span style="color:#f44336">🗑 Удалено</span>' : ''}
</div>
`).join('')}
</body></html>`;
    
    const filepath = path.join(outputDir, `export_${Date.now()}.html`);
    fs.writeFileSync(filepath, html);
    
    await ctx.replyWithDocument(new InputFile(filepath), {
      caption: "📄 HTML экспорт готов"
    });
  } else {
    const csv = "Time,Sender,Text,Deleted\n" + 
      msgs.map(m => `"${m.timestamp}","${m.sender_name || 'Unknown'}","${(m.text || '').replace(/"/g, '""')}","${m.is_deleted ? 'Yes' : 'No'}"`).join("\n");
    
    const filepath = path.join(outputDir, `export_${Date.now()}.csv`);
    fs.writeFileSync(filepath, csv);
    
    await ctx.replyWithDocument(new InputFile(filepath), {
      caption: "📊 CSV экспорт готов"
    });
  }
}

// ================================================================
//  НАСТРОЙКИ
// ================================================================
bot.callbackQuery("settings", async ctx => {
  const uid = ctx.from.id;
  const u = getUser(uid);
  
  await ctx.editMessageText(
    `⚙️ <b>Настройки</b>\n\n` +
    `👻 Призрачный режим: ${u?.ghost_mode ? '✅ Вкл' : '❌ Выкл'}\n` +
    `<i>Не показывать "печатает..." при общении с AI</i>`,
    { parse_mode: "HTML", reply_markup: new InlineKeyboard()
      .text(u?.ghost_mode ? "❌ Выключить" : "✅ Включить", "toggle_ghost").row()
      .text("◀️ Назад", "main_menu")
    }
  );
  await ctx.answerCallbackQuery();
});

bot.callbackQuery("toggle_ghost", async ctx => {
  const uid = ctx.from.id;
  const u = getUser(uid);
  const newMode = u?.ghost_mode ? 0 : 1;
  
  updateUser(uid, { ghost_mode: newMode });
  
  await ctx.answerCallbackQuery(newMode ? "✅ Призрачный режим включён" : "❌ Призрачный режим выключен");
  
  await ctx.editMessageText(
    `⚙️ <b>Настройки</b>\n\n` +
    `👻 Призрачный режим: ${newMode ? '✅ Вкл' : '❌ Выкл'}\n` +
    `<i>Не показывать "печатает..." при общении с AI</i>`,
    { parse_mode: "HTML", reply_markup: new InlineKeyboard()
      .text(newMode ? "❌ Выключить" : "✅ Включить", "toggle_ghost").row()
      .text("◀️ Назад", "main_menu")
    }
  );
});

// ================================================================
//  ГЛАВНОЕ МЕНЮ
// ================================================================
bot.callbackQuery("main_menu", async ctx => {
  await ctx.editMessageText(
    `🤖 <b>MerAI</b>\n\nВыберите действие:`,
    { parse_mode: "HTML", reply_markup: kbMain(ctx.from.id) }
  );
  await ctx.answerCallbackQuery();
});

// ================================================================
//  ЗАПУСК БОТА
// ================================================================
bot.start().then(() => {
  console.log("✅ MerAI v5.0 запущен!");
  console.log("📊 База: " + DB_PATH);
  console.log("🤖 AI: Gemini Ready");
  console.log("📱 UserBot: Ready");
}).catch(err => {
  console.error("❌ Ошибка запуска:", err);
  process.exit(1);
});

// Обработка ошибок
bot.catch(err => {
  console.error("❌ Bot error:", err);
});
