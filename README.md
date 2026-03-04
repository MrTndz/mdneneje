# 🤖 AI Coding Agent Bot

Telegram бот который пишет огромные коды. Бесплатные API!

## 📦 Установка на BotHost

### Шаг 1 — Получи бесплатные API ключи

**Groq API (Llama 3.3 70B + DeepSeek R1) — БЕСПЛАТНО:**
1. Зайди на https://console.groq.com
2. Зарегистрируйся (можно через Google)
3. API Keys → Create API Key
4. Скопируй ключ (начинается с `gsk_...`)

**Google Gemini API — БЕСПЛАТНО:**
1. Зайди на https://aistudio.google.com/apikey
2. Create API Key
3. Скопируй ключ (начинается с `AIza...`)

**Telegram Bot Token:**
1. Напиши @BotFather в Telegram
2. /newbot → придумай имя → скопируй токен

---

### Шаг 2 — Залей на BotHost

1. Создай новый Node.js нод на BotHost
2. Загрузи файлы: `index.js` и `package.json`
3. В разделе **Environment Variables** добавь:

```
BOT_TOKEN=твой_токен_от_botfather
GROQ_API_KEY=твой_groq_ключ
GEMINI_API_KEY=твой_gemini_ключ
```

4. Нажми **Install** (установит grammy)
5. Нажми **Start**

---

## 🎮 Команды бота

| Команда | Описание |
|---------|----------|
| `/start` | Приветствие и инструкция |
| `/model` | Переключить AI модель |
| `/clear` | Очистить контекст диалога |
| `/status` | Текущая модель и статистика |

## 🔀 Доступные модели

- 🦙 **Llama 3.3 70B** (Groq) — быстрый, отличный для кода
- 🧠 **DeepSeek R1** (Groq) — думает глубже, для сложных задач  
- 💎 **Gemini 2.0 Flash** (Google) — огромный контекст

## 💡 Примеры запросов

```
Напиши Telegram бот на Python с aiogram 3 с регистрацией и БД SQLite

Создай REST API на Express.js с JWT авторизацией и PostgreSQL

Напиши парсер сайтов на Python с Selenium и сохранением в Excel

Сделай Discord бот с музыкой, модерацией и экономикой
```
