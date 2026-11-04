// config/env.ts
import dotenv from "dotenv";
dotenv.config(); // ⚠️ DOIT être appelé avant toute lecture de process.env plus bas

const ENV = {
  PORT: Number(process.env.PORT) || 3000,
  APP_URL: process.env.APP_URL || `http://localhost:3000`,
  API_URL: process.env.API_URL || `http://localhost:5102/api`,
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || "",
  IS_PROD: process.env.NODE_ENV === "production",
};

export default ENV;