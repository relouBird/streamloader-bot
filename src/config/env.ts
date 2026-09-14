// config/env.ts
import dotenv from "dotenv";
dotenv.config(); // ⚠️ DOIT être appelé avant toute lecture de process.env plus bas

const ENV = {
  PORT: Number(process.env.PORT) || 3000,
  JWT_SECRET: process.env.API_SECRET || "",
  APP_URL: process.env.APP_URL || `http://localhost:3000`,
  API_URL: process.env.API_URL || `http://localhost:5101`,
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || "",
  IS_PROD: process.env.NODE_ENV === "production",
  DB:{
    HOST: process.env.DB_HOST || "localhost",
    PORT: Number(process.env.DB_PORT) || 3306,
    USER: process.env.DB_USER || "root",
    PASSWORD: process.env.DB_PASSWORD || "",
    NAME: process.env.DB_NAME || "streamloader",
  }
};

export default ENV;