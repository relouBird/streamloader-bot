import express, { NextFunction, Router } from "express";
import cors from "cors";
import { Request, Response, Express } from "express";
import path from "path";
import rateLimit from "express-rate-limit";
import { db } from "./database/index";
import Bot from "./bot";

export type GetterFunction = (req: Request, res: Response) => void;

export default class Server {
  readonly port: number;
  readonly url: string;
  readonly secret: string;
  readonly prod: boolean;

  protected app: Express | undefined;
  protected bot: Bot | undefined;
  protected server: any;
  protected shuttingDown = false;

  constructor(port: number, url: string, secret: string, prod: boolean) {
    if (!secret) throw new Error("JWT_SECRET manquant dans .env");
    this.port = Number(port);
    this.url = url;
    this.secret = secret;
    this.prod = prod;
  }

  // ─────────────────────────────────────────────────────────────────
  //  INIT
  // ─────────────────────────────────────────────────────────────────
  init() {
    const corsOptions = {
      origin: this.prod ? [this.url] : "*",
      methods: ["GET", "POST", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
      credentials: true,
    };

    this.app = express();

    // Derrière Apache/Passenger : nécessaire pour que req.ip et
    // express-rate-limit voient la vraie IP client
    this.app.set("trust proxy", 1);

    this.app.use(cors(corsOptions));
    this.app.options("*", cors(corsOptions));

    this.app.use(express.json({ limit: "10kb" }));
    this.app.use(express.urlencoded({ extended: true, limit: "10kb" }));
    this.app.use(express.static(path.join(__dirname, "public")));

    this.app.use((_req, res, next) => {
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("X-Frame-Options", "DENY");
      next();
    });

    const globalLimiter = rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 200,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: "Trop de requêtes. Réessaie dans 15 minutes." },
    });
    this.app.use("/api/", globalLimiter);

    this.app.get("/", (_req: Request, res: Response) => {
      res.sendFile(path.join(__dirname, "public", "index.html"));
    });
  }

  setBot(bot: Bot) {
    this.bot = bot;
  }

  // ─────────────────────────────────────────────────────────────────
  //  WEBHOOK TELEGRAM
  //  À monter APRÈS init() et APRÈS bot.start(), mais AVANT finalize()
  // ─────────────────────────────────────────────────────────────────
  mountBotWebhook() {
    if (!this.bot) {
      console.warn("[SERVER] mountBotWebhook appelé sans bot — ignoré");
      return;
    }

    const route = this.bot.webhookPath;

    this.app?.post(route, (req: Request, res: Response) => {
      const headerSecret = req.get("X-Telegram-Bot-Api-Secret-Token");

      if (!this.bot!.verifySecret(headerSecret)) {
        console.warn("[SERVER] ⚠️ Webhook : secret invalide, requête rejetée");
        return res.sendStatus(403);
      }

      // Répondre 200 IMMÉDIATEMENT : Telegram considère l'update
      // délivré et n'attend pas la fin du traitement (qui peut durer
      // plusieurs minutes pour un téléchargement).
      res.sendStatus(200);

      try {
        this.bot!.handleUpdate(req.body);
      } catch (e) {
        console.error(
          "[SERVER] ❌ Erreur handleUpdate :",
          (e as Error).message,
        );
      }
    });

    console.log(`[SERVER] 🌐 Route webhook Telegram montée : POST ${route}`);
  }

  // ─────────────────────────────────────────────────────────────────
  //  HEALTH — à monter AVANT finalize()
  // ─────────────────────────────────────────────────────────────────
  getHealth() {
    this.app?.get("/api/health", (_req, res) => {
      res.json({
        status: "ok",
        version: "1.0.0",
        uptime: Math.round(process.uptime()),
        timestamp: new Date().toISOString(),
      });
    });
  }

  get(endpoint: string, getter: GetterFunction) {
    this.app?.get(endpoint, getter);
  }

  use(endpoint: string, router: Router) {
    this.app?.use(endpoint, router);
  }

  // ─────────────────────────────────────────────────────────────────
  //  FINALIZE — TOUJOURS en dernier, après tous les routers
  // ─────────────────────────────────────────────────────────────────
  finalize() {
    // 404 JSON pour les routes API inconnues
    this.app?.use("/api/*", (req: Request, res: Response) => {
      res.status(404).json({
        success: false,
        message: `Route introuvable : ${req.method} ${req.originalUrl}`,
      });
    });

    // Error handler global — DOIT être le tout dernier middleware
    this.app?.use(
      (err: any, req: Request, res: Response, next: NextFunction) => {
        console.error("[ERROR]", {
          message: err.message,
          stack: err.stack,
          path: req.originalUrl,
          method: req.method,
        });

        if (res.headersSent) return next(err);

        const status = err.statusCode ?? 500;
        return res.status(status).json({
          success: false,
          message: err.message ?? "Internal server error",
        });
      },
    );
  }

  // ─────────────────────────────────────────────────────────────────
  //  LISTEN
  // ─────────────────────────────────────────────────────────────────
  listen() {
    this.server = this.app?.listen(this.port, () => {
      console.log(`
╔══════════════════════════════════════════════════════════════╗
║  StreamBot v1.0 — ${this.prod ? "PRODUCTION " : "DÉVELOPPEMENT"}                             ║
║  Port : ${String(this.port).padEnd(52)}║
╠══════════════════════════════════════════════════════════════╣
║  ✅ Rate limiting                                            ║
║  ✅ CORS (${(this.prod ? "strict" : "dev : *").padEnd(51)}║
║  ✅ Graceful shutdown (SIGINT / SIGTERM)                     ║
╚══════════════════════════════════════════════════════════════╝`);
    });

    // Timeouts généreux : les téléchargements SSE sont longs
    if (this.server) {
      this.server.keepAliveTimeout = 120_000;
      this.server.headersTimeout = 125_000;
    }
  }

  // ─────────────────────────────────────────────────────────────────
  //  ARRÊT PROPRE
  // ─────────────────────────────────────────────────────────────────
  async gracefulShutdown(signal: string) {
    if (this.shuttingDown) return;
    this.shuttingDown = true;

    console.log(`\n[${signal}] Arrêt propre en cours...`);

    // Forcer l'exit si quelque chose bloque
    const killTimer = setTimeout(() => {
      console.error("[SERVER] Timeout — arrêt forcé.");
      process.exit(1);
    }, 10_000);
    killTimer.unref();

    // 1. Fermer le serveur HTTP (arrête d'accepter de nouvelles connexions)
    await new Promise<void>((resolve) => {
      if (!this.server) return resolve();
      this.server.close(() => {
        console.log("[SERVER] HTTP fermé.");
        resolve();
      });
    });

    // 2. Arrêter le bot
    try {
      await this.bot?.stop();
    } catch (err) {
      console.error("[BOT] Erreur lors de l'arrêt :", err);
    }

    // 3. Fermer le pool MySQL
    try {
      await db.end();
      console.log("[DB] MySQL pool fermé.");
    } catch (err) {
      console.error("[DB] Échec fermeture pool :", err);
    }

    clearTimeout(killTimer);
    console.log("[SERVER] ✅ Arrêt propre terminé.");
    process.exit(0);
  }

  close() {
    process.on("SIGINT", () => this.gracefulShutdown("SIGINT"));
    process.on("SIGTERM", () => this.gracefulShutdown("SIGTERM"));

    process.on("uncaughtException", (err) => {
      console.error("[UNCAUGHT EXCEPTION]", err.stack);
      // En prod, on tente un arrêt propre plutôt que de rester
      // dans un état incohérent — Passenger relancera le process.
      if (this.prod) this.gracefulShutdown("uncaughtException");
    });

    process.on("unhandledRejection", (reason) => {
      console.error("[UNHANDLED REJECTION]", reason);
    });
  }
}
