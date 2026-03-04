# MerAI — Monitoring & AI

Telegram бот для мониторинга сообщений + AI-ассистент.

## Возможности

### Мониторинг (Business API)
- Сохраняет все сообщения через Telegram Business API
- Перехватывает медиа с таймером самоуничтожения ⏱
- При удалении сообщения — отправляет оригинал + файл
- При редактировании — показывает "было / стало"
- При удалении чата — ZIP-архив всей переписки

### UserBot (без Premium!)
- Мониторинг через ваш аккаунт Telegram (как AyuGram)
- Работает в личных чатах и группах
- Для входа нужен номер телефона + код из Telegram
- Требует API_ID и API_HASH от my.telegram.org

### AI-ассистент
- Встроен прямо в бота — просто пишите
- Groq Llama 3.3 70B / Gemini 2.0 Flash
- Контекст разговора (последние 20 сообщений)
- Идентичность: MerAI by mrztn

## Установка (BotHost / любой сервер)

```bash
npm install
```

## Запуск

```bash
# Задайте переменные окружения
BOT_TOKEN=... GROQ_API_KEY=... node index.js

# Или через .env (скопируйте .env.example → .env)
node index.js
```

## Переменные окружения

| Переменная | Обязательно | Описание |
|---|---|---|
| `BOT_TOKEN` | ✅ | Токен бота от @BotFather |
| `GROQ_API_KEY` | ⚠️ | Ключ Groq (для AI) |
| `GEMINI_API_KEY` | ⚠️ | Ключ Gemini (для AI, запасной) |
| `TG_API_ID` | ⚠️ | API ID от my.telegram.org (для UserBot) |
| `TG_API_HASH` | ⚠️ | API Hash от my.telegram.org (для UserBot) |
| `DB_PATH` | ❌ | Путь к БД (по умолчанию database/merai.db) |

> ⚠️ Хотя бы один AI-ключ для работы ассистента.  
> ⚠️ TG_API_ID + TG_API_HASH нужны для UserBot.

## Получение API_ID и API_HASH

1. Перейдите на https://my.telegram.org
2. Войдите со своим аккаунтом
3. Нажмите "API development tools"
4. Создайте приложение
5. Скопируйте `api_id` и `api_hash`

## База данных

БД хранится в файле `database/merai.db` (WAL mode).  
Автоматический бэкап каждую ночь в `backups/`.

## Админ-панель

Доступна пользователю с ID `7785371505` (@mrztn).  
Кнопка «👨‍💼 Админ» появляется в главном меню.

## Структура файлов

```
index.js          — основной код
package.json      — зависимости
database/         — база данных SQLite
media/            — скачанные медиафайлы
exports/          — экспортированные файлы
backups/          — бэкапы БД
sessions/         — (не используется, сессии в БД)
```
