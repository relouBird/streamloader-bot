// index.ts
import ENV from "./config/env";
import Server from "./server";
import { initializeDatabase } from "./database/initORM";
import Bot from "./bot";

async function bootstrap() {
  const server = new Server(ENV.PORT, ENV.APP_URL, ENV.JWT_SECRET, ENV.IS_PROD);

  console.log(`[BOOTSTRAP] Démarrage du bot Telegram en ${ENV.IS_PROD ? "webhook" : "polling"}...`);
  
  const bot = new Bot(
    ENV.TELEGRAM_BOT_TOKEN,
    ENV.API_URL,
    ENV.APP_URL,
    ENV.IS_PROD,
  );

  await initializeDatabase();

  // ────────────────────────────────────────────────────────────────
  // 1. App + middlewares globaux
  // ────────────────────────────────────────────────────────────────
  server.init();
  server.setBot(bot);

  // ────────────────────────────────────────────────────────────────
  // 2. ⚠️ CORRECTIF : on démarre l'écoute HTTP AVANT d'enregistrer le
  //    webhook auprès de Telegram. Auparavant, bot.start() (qui appelle
  //    Telegram pour lui dire où poster les updates) s'exécutait avant
  // ────────────────────────────────────────────────────────────────
  server.listen();

  // ────────────────────────────────────────────────────────────────
  // 3. Bot : instanciation + enregistrement du webhook + handlers
  //    DOIT être fait avant mountBotWebhook() (besoin de webhookPath)
  // ────────────────────────────────────────────────────────────────
  await bot.start();
  bot.startBot();
  bot.getMessage();
  bot.callbackQuery();

  // ────────────────────────────────────────────────────────────────
  // 4. Routes — TOUTES avant finalize()
  // ────────────────────────────────────────────────────────────────
  server.getHealth();
  server.mountBotWebhook();

  // Ajoute ici tes autres routers :
  // server.use("/api/auth", AuthRouter);
  // server.use("/api/media", MediaRouter);

  // ────────────────────────────────────────────────────────────────
  // 5. 404 + error handler EN DERNIER
  // ────────────────────────────────────────────────────────────────
  server.finalize();

  // ────────────────────────────────────────────────────────────────
  // 6. Handlers de signaux (arrêt propre)
  // ────────────────────────────────────────────────────────────────
  server.close();

  console.log("[BOOTSTRAP] ✅ Application démarrée");
}

bootstrap().catch((err) => {
  console.error("[BOOTSTRAP ERROR]", err);
  process.exit(1);
});