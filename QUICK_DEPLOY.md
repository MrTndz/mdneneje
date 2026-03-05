# Quick Deployment Guide

## Installation

Execute the following commands in your terminal to install dependencies and start the bot.

```bash
npm install
node index.js
```

## Verification

After starting the bot, open Telegram and send any message to verify functionality. The system will automatically select an available AI provider and respond.

## Expected Console Output

Upon successful startup, the console will display initialization messages confirming that the database has been created, credentials have been loaded, and the bot is running. When you send a message, additional log entries will show the AI provider selection process and confirm successful response generation.

## Immediate Next Steps

Test the AI functionality by sending a simple greeting to the bot. Observe the console logs to verify which AI provider responded successfully. If Google Gemini responds, no further configuration is needed. If you observe errors, refer to DOCUMENTATION.md for troubleshooting guidance and instructions for configuring additional AI providers.

---

For comprehensive information, consult DOCUMENTATION.md
