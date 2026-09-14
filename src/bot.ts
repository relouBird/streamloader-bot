import axios, { AxiosInstance, AxiosResponse } from "axios";
import fs from "fs";
import path from "path";
import * as readline from "readline";
import crypto from "crypto";
import FormData from "form-data";
import TelegramBot, {
  AnswerCallbackQueryParams,
  Message,
  SendMessageParams,
  Update,
} from "node-telegram-bot-api";

const LOG = "[BOT]";

const PENDING_URL_TTL_MS = 15 * 60 * 1000;

// ⚠️ Porté depuis bot.js : la valeur y avait été réduite à 4 min (240s)
// pour les gratuits, contre 15 min (900s) dans la version précédente de
// ce fichier. Je garde la valeur la plus récente (bot.js), mais vérifie
// que c'est bien la limite que tu veux — les deux fichiers étaient en
// désaccord.
const FREE_MAX_DURATION_SECONDS = 240;
const FREE_DAILY_DOWNLOAD_LIMIT = 30;

const SHAZAM_API_KEY = process.env.SHAZAM_API_KEY || "";
const SHAZAM_API_HOST =
  process.env.SHAZAM_API_HOST || "shazam-api-free.p.rapidapi.com";

interface PendingUrl {
  url: string;
  title: string;
  duration: number;
  createdAt: number;
}

interface DailyQuotaEntry {
  day: string; // "YYYY-MM-DD"
  count: number;
}

export default class Bot {
  readonly token: string;
  readonly apiUrl: string;
  readonly publicUrl: string;
  readonly useWebhook: boolean;

  readonly webhookUrlToken: string;
  readonly webhookSecretToken: string;

  protected bot: TelegramBot | undefined;
  protected api: AxiosInstance | undefined;
  protected cleanupTimer: NodeJS.Timeout | undefined;

  readonly TMP_DIR = path.join(__dirname, "tmp");
  readonly HOURGLASS = "\u23F3";

  protected pendingUrls: Map<string, PendingUrl> = new Map();

  // ── Premium par ID Telegram (porté depuis bot.js) ────────────────
  // Mécanisme volontairement simple : une liste d'IDs Telegram considérés
  // Premium, configurée via l'env `TELEGRAM_PREMIUM_IDS` (CSV). Ça évite au
  // bot d'avoir besoin d'un accès direct à la base de données de l'app web
  // (il reste un simple client HTTP de l'API) — mais ça veut dire que le
  // statut Premium doit être maintenu manuellement ici pour l'instant. Une
  // vraie liaison de compte (web ↔ Telegram) resterait la solution propre
  // à terme.
  protected premiumTelegramIds: Set<string>;

  // ── Quota journalier gratuit (en mémoire, pas de DB côté bot) ────────
  // Contrairement à bot.js (qui utilisait `queries.countDailyDownloads`
  // sur la DB partagée), ce bot n'a pas d'accès DB direct — c'est
  // volontaire (voir doc §9 : le video-service et le bot ne connaissent
  // pas les plans). Le compteur est donc en mémoire, remis à zéro
  // naturellement au changement de jour (clé "chatId:YYYY-MM-DD"), mais
  // NE SURVIT PAS à un redémarrage du bot. Si tu veux une vraie
  // persistance, il faudra exposer un endpoint de quota côté API centrale.
  protected dailyDownloads: Map<string, DailyQuotaEntry> = new Map();

  constructor(
    token: string,
    apiUrl: string,
    publicUrl: string = "",
    useWebhook: boolean = false,
    premiumTelegramIds: string[] = (process.env.TELEGRAM_PREMIUM_IDS || "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  ) {
    if (!token) throw new Error("TELEGRAM_BOT_TOKEN manquant dans .env");
    if (!apiUrl) throw new Error("API_URL manquant dans .env");
    if (useWebhook && !publicUrl) {
      throw new Error("APP_URL manquant : requis en mode webhook");
    }
    if (useWebhook && !publicUrl.startsWith("https://")) {
      throw new Error("APP_URL doit être en HTTPS pour un webhook Telegram");
    }

    this.token = token;
    this.apiUrl = apiUrl;
    this.publicUrl = publicUrl.replace(/\/+$/, "");
    this.useWebhook = useWebhook;
    this.premiumTelegramIds = new Set(premiumTelegramIds);

    this.webhookUrlToken = crypto
      .createHash("sha256")
      .update(`${token}:path`)
      .digest("hex")
      .slice(0, 32);
    this.webhookSecretToken = crypto
      .createHash("sha256")
      .update(`${token}:secret`)
      .digest("hex")
      .slice(0, 32);
  }

  get webhookPath(): string {
    return `/telegram/webhook/${this.webhookUrlToken}`;
  }

  isPremium(fromId: number | string | undefined): boolean {
    return this.premiumTelegramIds.has(String(fromId));
  }

  /**
   * Vérifie et incrémente le quota journalier gratuit. Retourne `true` si
   * la requête est autorisée (et compte pour le quota), `false` si le
   * quota du jour est déjà atteint.
   */
  private consumeDailyQuota(chatId: number): boolean {
    const today = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
    const key = String(chatId);
    const entry = this.dailyDownloads.get(key);

    if (!entry || entry.day !== today) {
      this.dailyDownloads.set(key, { day: today, count: 1 });
      return true;
    }
    if (entry.count >= FREE_DAILY_DOWNLOAD_LIMIT) {
      return false;
    }
    entry.count++;
    return true;
  }

  // ─────────────────────────────────────────────────────────────────
  //  DÉMARRAGE
  // ─────────────────────────────────────────────────────────────────
  async start() {
    this.bot = this.useWebhook
      ? new TelegramBot(this.token)
      : new TelegramBot(this.token, { polling: true });

    this.api = axios.create({ baseURL: this.apiUrl, timeout: 60_000 });
    this.setupInterceptors();
    this.setupErrorHandlers();
    this.ensureTmpDir();
    this.startCleanupTimer();

    if (this.useWebhook) {
      await this.registerWebhook();
    } else {
      console.log(`${LOG} 🔄 Mode POLLING (développement)`);
    }

    console.log(LOG + " API URL : " + this.apiUrl);
    console.log(
      `${LOG} 👑 IDs Premium configurés : ${this.premiumTelegramIds.size}`,
    );
    console.log(LOG + " 🤖 Bot Telegram StreamLoader démarré — mode API");
  }

  private async registerWebhook() {
    const url = `${this.publicUrl}${this.webhookPath}`;
    try {
      await this.bot?.deleteWebHook({ drop_pending_updates: false });
    } catch (e) {
      console.warn(`${LOG} ⚠️ deleteWebHook :`, (e as Error).message);
    }
    await this.bot?.setWebHook(url, {
      secret_token: this.webhookSecretToken,
      allowed_updates: ["message", "callback_query"],
      max_connections: 40,
    });
    const info = await this.bot?.getWebHookInfo();
    console.log(`${LOG} 🌐 Mode WEBHOOK actif`);
    console.log(`${LOG}    URL              : ${info?.url}`);
    console.log(`${LOG}    Pending updates  : ${info?.pending_update_count}`);
    if (info?.last_error_message) {
      console.warn(`${LOG}    ⚠️ Dernière erreur : ${info.last_error_message}`);
    }
  }

  handleUpdate(update: Update) {
    if (!this.bot) {
      console.error(`${LOG} ❌ handleUpdate appelé avant start()`);
      return;
    }
    this.bot.processUpdate(update);
  }

  verifySecret(headerValue: string | undefined): boolean {
    if (!headerValue) return false;
    const a = Buffer.from(headerValue);
    const b = Buffer.from(this.webhookSecretToken);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }

  // ─────────────────────────────────────────────────────────────────
  //  SETUP INTERNE
  // ─────────────────────────────────────────────────────────────────
  private setupInterceptors() {
    this.api!.interceptors.request.use((config) => {
      console.log(
        `${LOG} → ${config.method?.toUpperCase()} ${config.baseURL}${config.url}`,
        config.params ? { params: config.params } : "",
      );
      return config;
    });
    this.api!.interceptors.response.use(
      (response) => {
        console.log(
          `${LOG} ← ${response.status} ${response.config.url} — ${response.headers["content-type"]}`,
        );
        return response;
      },
      (error) => {
        console.error(
          `${LOG} ❌ ${error.config?.method?.toUpperCase()} ${error.config?.url} → ${error.response?.status ?? "NO RESPONSE"}`,
          error.response?.data ?? error.message,
        );
        return Promise.reject(error);
      },
    );
  }

  private setupErrorHandlers() {
    this.bot?.on("polling_error", (err) =>
      console.error(`${LOG} ❌ polling_error:`, err.message),
    );
    this.bot?.on("webhook_error", (err) =>
      console.error(`${LOG} ❌ webhook_error:`, err.message),
    );
    this.bot?.on("error", (err) =>
      console.error(`${LOG} ❌ error:`, err.message),
    );
  }

  private ensureTmpDir() {
    if (!fs.existsSync(this.TMP_DIR)) {
      fs.mkdirSync(this.TMP_DIR, { recursive: true });
      console.log(`${LOG} 📁 TMP_DIR créé : ${this.TMP_DIR}`);
    }
  }

  private startCleanupTimer() {
    this.cleanupTimer = setInterval(
      () => {
        const now = Date.now();
        let cleaned = 0;
        for (const [id, entry] of this.pendingUrls) {
          if (now - entry.createdAt > PENDING_URL_TTL_MS) {
            this.pendingUrls.delete(id);
            cleaned++;
          }
        }
        // Purge aussi les entrées de quota d'un jour révolu.
        const today = new Date().toISOString().slice(0, 10);
        for (const [key, entry] of this.dailyDownloads) {
          if (entry.day !== today) this.dailyDownloads.delete(key);
        }
        if (cleaned > 0)
          console.log(`${LOG} 🗑️ ${cleaned} URL(s) expirée(s) nettoyée(s)`);
      },
      5 * 60 * 1000,
    );
    this.cleanupTimer.unref();
  }

  private generateShortId(): string {
    let id: string;
    do {
      id = crypto.randomBytes(6).toString("hex");
    } while (this.pendingUrls.has(id));
    return id;
  }

  // ─────────────────────────────────────────────────────────────────
  //  WRAPPERS DÉFENSIFS TELEGRAM
  // ─────────────────────────────────────────────────────────────────
  private async safeSend(
    chatId: number,
    text: string,
    options?: Omit<SendMessageParams, "chat_id" | "text">,
  ): Promise<Message | undefined> {
    try {
      return await this.bot?.sendMessage(chatId, text, options);
    } catch (e) {
      console.error(
        `${LOG} ❌ safeSend échoué (chatId=${chatId}):`,
        (e as Error).message,
      );
      return undefined;
    }
  }

  private async safeEdit(
    chatId: number,
    messageId: number | undefined,
    text: string,
  ): Promise<void> {
    if (!messageId) {
      console.warn(
        `${LOG} ⚠️ safeEdit appelé sans messageId (chatId=${chatId}) — ignoré`,
      );
      return;
    }
    try {
      await this.bot?.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: "Markdown",
      });
    } catch (e) {
      console.warn(
        `${LOG} ⚠️ safeEdit échoué (chatId=${chatId}, messageId=${messageId}):`,
        (e as Error).message,
      );
    }
  }

  private async safeAnswerCallback(
    queryId: string,
    options?: Omit<AnswerCallbackQueryParams, "callback_query_id">,
  ): Promise<void> {
    try {
      await this.bot?.answerCallbackQuery(queryId, options);
    } catch (e) {
      console.warn(`${LOG} ⚠️ answerCallbackQuery :`, (e as Error).message);
    }
  }

  private async safeDelete(
    chatId: number,
    messageId: number | undefined,
  ): Promise<void> {
    if (!messageId) return;
    try {
      await this.bot?.deleteMessage(chatId, messageId);
    } catch (e) {
      console.warn(
        `${LOG} ⚠️ safeDelete échoué (chatId=${chatId}, messageId=${messageId}):`,
        (e as Error).message,
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────
  //  Repli d'identification musicale par le titre — porté depuis bot.js
  //  (pure logique JS, aucun yt-dlp requis)
  // ─────────────────────────────────────────────────────────────────
  private parseArtistTrackFromTitle(
    title: string | undefined,
  ): { artist: string; track: string } | null {
    if (!title) return null;
    let clean = title;
    let prev: string;
    do {
      prev = clean;
      clean = clean.replace(/\s*[\[(][^[\]()]*[\])]\s*$/, "").trim();
    } while (clean !== prev);

    const match = clean.match(/^(.+?)\s+[-–—]\s+(.+)$/);
    if (match && match[1].trim() && match[2].trim()) {
      return { artist: match[1].trim(), track: match[2].trim() };
    }
    return null;
  }

  /**
   * Reconnaissance audio par empreinte sonore (Shazam via RapidAPI) — porté
   * depuis bot.js. Nécessite un extrait audio local (voir `music` dans
   * callbackQuery, récupéré via l'API vidéo avec trim).
   */
  private async shazamRecognize(snippetPath: string): Promise<{
    title: string;
    artist: string | null;
    cover: string | null;
  } | null> {
    if (!SHAZAM_API_KEY) return null;
    const form = new FormData();
    form.append("upload_file", fs.createReadStream(snippetPath));

    const res = await axios.post(
      `https://${SHAZAM_API_HOST}/shazam/recognize/`,
      form,
      {
        headers: {
          ...form.getHeaders(),
          "x-rapidapi-key": SHAZAM_API_KEY,
          "x-rapidapi-host": SHAZAM_API_HOST,
        },
        maxBodyLength: Infinity,
        timeout: 15_000,
      },
    );

    const track = res.data?.result?.track;
    if (!track?.title) return null;
    return {
      title: track.title,
      artist: track.subtitle || null,
      cover: track.images?.coverarthq || track.images?.coverart || null,
    };
  }

  // ─────────────────────────────────────────────────────────────────
  //  HANDLERS
  // ─────────────────────────────────────────────────────────────────
  startBot() {
    this.bot?.onText(/\/start/, (msg) => {
      console.log("Nouveau /start de " + msg.chat.username);
      this.safeSend(
        msg.chat.id,
        `👋 Salut ! Bienvenue sur *StreamLoader Bot* 🚀\n\n` +
          `Envoie-moi le lien d'une vidéo (YouTube, TikTok, Instagram...) et télécharge-la instantanément.\n\n` +
          `💡 Les membres Premium du site profitent de téléchargements illimités et sans restriction de durée !`,
        { parse_mode: "Markdown" },
      );
    });

    this.bot?.onText(/^\/help/, (msg) => {
      this.safeSend(
        msg.chat.id,
        `ℹ️ *Aide*\n\n` +
          `1️⃣ Envoie-moi un lien de vidéo\n` +
          `2️⃣ Choisis le format (Vidéo HD, Audio MP3, ou Musique Officielle)\n` +
          `3️⃣ Attends la fin du téléchargement\n\n` +
          `⚠️ Limite gratuite : ${Math.round(FREE_MAX_DURATION_SECONDS / 60)} minutes par vidéo, ${FREE_DAILY_DOWNLOAD_LIMIT} téléchargements/jour.`,
        { parse_mode: "Markdown" },
      );
    });
  }

  getMessage() {
    this.bot?.on("message", async (msg) => {
      const chatId = msg.chat.id;
      const text = msg.text;
      if (!text || text.startsWith("/")) return;

      try {
        const parsed = new URL(text);
        if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
      } catch {
        return void this.safeSend(
          chatId,
          "❌ Envoie-moi un lien valide (URL commençant par http ou https).",
        );
      }

      const analyzingMsg = await this.safeSend(chatId, this.HOURGLASS);
      if (!analyzingMsg) return;

      let data: any;
      try {
        const res = await this.api?.get("/media/analyze", {
          params: { url: text },
        });
        data = res?.data?.data;
        if (!data) throw new Error("Réponse API sans données exploitables.");
      } catch (e) {
        const message =
          (e as any).response?.data?.error ||
          "Impossible d'analyser cette vidéo. Vérifie le lien.";
        return this.safeEdit(chatId, analyzingMsg.message_id, `❌ ${message}`);
      }

      const duration = data.duration || 0;
      const isPremium = this.isPremium(msg.from?.id);

      if (!isPremium && duration > FREE_MAX_DURATION_SECONDS) {
        const minutes = Math.ceil(duration / 60);
        await this.safeDelete(chatId, analyzingMsg.message_id);
        return void this.safeSend(
          chatId,
          `⚠️ *Vidéo trop longue (${minutes} min)*\n\n` +
            `Le plan gratuit limite les téléchargements à ${Math.round(FREE_MAX_DURATION_SECONDS / 60)} minutes maximum.\n` +
            `Passe au plan *Premium* sur notre site pour débloquer les vidéos illimitées ! ⚡`,
          { parse_mode: "Markdown" },
        );
      }

      const shortId = this.generateShortId();
      this.pendingUrls.set(shortId, {
        url: text,
        title: data.title || "video",
        duration,
        createdAt: Date.now(),
      });
      console.log(`${LOG} 🔑 URL mappée : id=${shortId}`);

      await this.safeDelete(chatId, analyzingMsg.message_id);
      await this.safeSend(
        chatId,
        `📹 *${data.title}*\n\nQue veux-tu télécharger ?`,
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "🎵 Musique Officielle (Complète)",
                  callback_data: `dl|music|${shortId}`,
                },
              ],
              [
                {
                  text: "🎬 Vidéo HD (MP4)",
                  callback_data: `dl|vid|${shortId}`,
                },
              ],
              [
                {
                  text: "🔊 Audio de la vidéo (MP3)",
                  callback_data: `dl|aud|${shortId}`,
                },
              ],
            ],
          },
        },
      );
    });
  }

  callbackQuery() {
    this.bot?.on("callback_query", async (query) => {
      const chatId = query.message?.chat.id;
      if (!chatId) return;

      const [action, type, shortId] = query.data?.split("|") ?? ["", "", ""];
      if (action !== "dl") return;

      const pending = this.pendingUrls.get(shortId);
      if (!pending) {
        console.warn(`${LOG} ⚠️ shortId inconnu/expiré : ${shortId}`);
        return this.safeAnswerCallback(query.id, {
          text: "Ce lien a expiré, renvoie-le pour recommencer.",
          show_alert: true,
        });
      }
      this.pendingUrls.delete(shortId);

      const isPremium = this.isPremium(query.from?.id);
      if (!isPremium && !this.consumeDailyQuota(chatId)) {
        return this.safeAnswerCallback(query.id, {
          text: `Limite gratuite de ${FREE_DAILY_DOWNLOAD_LIMIT} téléchargements atteinte aujourd'hui.`,
          show_alert: true,
        });
      }

      const { url, title: videoTitle, duration } = pending;
      const isAudio = type === "aud" || type === "music";

      await this.safeAnswerCallback(query.id, {
        text:
          type === "music"
            ? "Identification en cours..."
            : "Téléchargement en cours...",
      });

      const statusMsg = await this.safeSend(
        chatId,
        type === "music"
          ? "🎧 Identification de la musique par empreinte audio..."
          : this.HOURGLASS,
      );
      if (!statusMsg) return;

      // ── Flux "Musique Officielle" : identification puis recherche dédiée ──
      let musicTags: {
        title: string;
        artist: string | null;
        coverUrl: string | null;
      } | null = null;

      if (type === "music") {
        const identified = await this.identifyMusic(
          url,
          videoTitle,
          duration,
          statusMsg.message_id,
          chatId,
        );
        if (!identified) return; // message d'erreur déjà envoyé par identifyMusic
        musicTags = identified;
        await this.safeEdit(
          chatId,
          statusMsg.message_id,
          `🎵 Musique identifiée : *${musicTags.artist ? musicTags.artist + " - " : ""}${musicTags.title}*\n\n⏳ Téléchargement en cours...`,
        );
      }

      let jobId: string;
      try {
        if (type === "music" && musicTags) {
          // Endpoint dédié — pas besoin de faire transiter une recherche
          // ytsearch1:... par le champ `url` générique de /download/start.
          const res: AxiosResponse = (await this.api?.post(
            "/media/music/start",
            {
              query: `${musicTags.artist ? musicTags.artist + " " : ""}${musicTags.title} official audio`,
              title: musicTags.title,
              artist: musicTags.artist,
              coverUrl: musicTags.coverUrl,
            },
          )) as AxiosResponse;
          jobId = res.data.jobId;
        } else {
          const res: AxiosResponse = (await this.api?.post(
            "/media/download/start",
            {
              url,
              quality: isAudio ? "audio" : "1080p",
              title: "video",
            },
          )) as AxiosResponse;
          jobId = res.data.jobId;
        }
      } catch (e) {
        const message =
          (e as any).response?.data?.error ||
          "Erreur lors du démarrage du téléchargement.";
        return this.safeEdit(chatId, statusMsg.message_id, `❌ ${message}`);
      }

      let editing = false;
      let lastPercentShown = -1;

      try {
        await this.followProgress(jobId, (percent) => {
          const rounded = Math.round(percent);
          if (editing || rounded === lastPercentShown) return;
          editing = true;
          lastPercentShown = rounded;
          this.safeEdit(
            chatId,
            statusMsg.message_id,
            `⏳ Téléchargement en cours... ${rounded}%`,
          ).finally(() => {
            editing = false;
          });
        });
      } catch (e) {
        return this.safeEdit(
          chatId,
          statusMsg.message_id,
          `❌ ${(e as Error).message}`,
        );
      }

      await this.safeEdit(
        chatId,
        statusMsg.message_id,
        "📤 Envoi du fichier sur Telegram...",
      );

      const ext = isAudio ? "mp3" : "mp4";
      try {
        const fileRes = await this.api?.get(`/media/file/${jobId}`, {
          responseType: "stream",
        });
        const filename = `${jobId}.${ext}`;

        if (isAudio) {
          await this.bot?.sendAudio(chatId, fileRes!.data, {}, { filename });
        } else {
          await this.bot?.sendVideo(
            chatId,
            fileRes!.data,
            { supports_streaming: true },
            { filename },
          );
        }
        await this.safeDelete(chatId, statusMsg.message_id);
      } catch (e) {
        console.error(
          `${LOG} ❌ envoi fichier jobId=${jobId} :`,
          (e as Error).message,
        );
        await this.safeSend(
          chatId,
          "❌ Erreur : le fichier est peut-être trop lourd pour Telegram (max 50 Mo en natif), ou une erreur réseau est survenue.",
        );
      }
    });
  }

  /**
   * Extrait un court échantillon audio via l'API (réutilise /download/start
   * avec trim + quality:"audio" — pas de nouvel endpoint nécessaire pour
   * cette étape), l'envoie à Shazam pour identification, avec repli sur le
   * titre de la vidéo si Shazam échoue/est indisponible.
   *
   * Retourne { title, artist, coverUrl } ou `null` (message d'erreur déjà
   * envoyé à l'utilisateur dans ce cas).
   */
  private async identifyMusic(
    url: string,
    videoTitle: string,
    duration: number,
    statusMessageId: number,
    chatId: number,
  ): Promise<{
    title: string;
    artist: string | null;
    coverUrl: string | null;
  } | null> {
    const snippetStart = duration > 30 ? 10 : 0;
    const snippetEnd =
      duration > 0 ? Math.min(duration, snippetStart + 20) : snippetStart + 20;
    const toTimestamp = (s: number) =>
      new Date(s * 1000).toISOString().substring(11, 19).replace(/^00:/, "");

    let track: string | null = null;
    let artist: string | null = null;
    let coverUrl: string | null = null;

    try {
      const startRes = await this.api?.post("/media/download/start", {
        url,
        quality: "audio",
        trim: true,
        startTime: toTimestamp(snippetStart),
        endTime: toTimestamp(snippetEnd),
        title: "snippet",
      });
      const snippetJobId = startRes?.data?.jobId;

      await this.followProgress(snippetJobId, () => {}); // pas de suivi visuel pour ce job jetable

      const snippetPath = path.join(
        this.TMP_DIR,
        `${snippetJobId}_snippet.mp3`,
      );
      const fileRes = await this.api?.get(`/media/file/${snippetJobId}`, {
        responseType: "stream",
      });
      await new Promise<void>((resolve, reject) => {
        const writer = fs.createWriteStream(snippetPath);
        fileRes!.data.pipe(writer);
        writer.on("finish", () => resolve());
        writer.on("error", reject);
      });

      try {
        const shazamResult = await this.shazamRecognize(snippetPath);
        if (shazamResult) {
          track = shazamResult.title;
          artist = shazamResult.artist;
          coverUrl = shazamResult.cover;
        }
      } catch (e) {
        console.error(
          `${LOG} ❌ shazam :`,
          (e as any).response?.data || (e as Error).message,
        );
      } finally {
        try {
          fs.unlinkSync(snippetPath);
        } catch {}
      }
    } catch (e) {
      // L'extraction d'échantillon a échoué (réseau, job en erreur...) — on
      // continue quand même avec le repli par titre plutôt que d'abandonner.
      console.warn(
        `${LOG} ⚠️ extraction d'échantillon échouée, repli sur le titre :`,
        (e as Error).message,
      );
    }

    if (!track) {
      const parsed = this.parseArtistTrackFromTitle(videoTitle);
      if (parsed) {
        track = parsed.track;
        artist = parsed.artist;
      }
    }

    if (!track) {
      await this.safeEdit(
        chatId,
        statusMessageId,
        `❌ Aucune musique officielle n'a pu être identifiée dans cette vidéo. Utilise plutôt l'option "Audio de la vidéo".`,
      );
      return null;
    }

    return { title: track, artist, coverUrl };
  }

  followProgress(jobId: string, onProgress: (percent: number) => void) {
    return new Promise((resolve, reject) => {
      this.api
        ?.get(`/media/progress/${jobId}`, {
          responseType: "stream",
          headers: { Accept: "text/event-stream" },
        })
        .then((res) => {
          const rl = readline.createInterface({ input: res.data });
          rl.on("line", (line) => {
            if (!line.startsWith("data: ")) return;
            let payload: any;
            try {
              payload = JSON.parse(line.slice(6));
            } catch {
              return;
            }
            if (payload.type === "progress" || payload.type === "processing") {
              onProgress(payload.percent || 0);
            } else if (payload.type === "done") {
              rl.close();
              resolve(1);
            } else if (payload.type === "error") {
              rl.close();
              reject(
                new Error(
                  payload.message || "Erreur pendant le téléchargement.",
                ),
              );
            }
          });
          res.data.on("error", (err: Error) => reject(err));
        })
        .catch((err) => reject(err));
    });
  }

  // ─────────────────────────────────────────────────────────────────
  //  ARRÊT
  // ─────────────────────────────────────────────────────────────────
  async stop() {
    console.log(`${LOG} 🛑 Arrêt du bot...`);
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    try {
      if (this.useWebhook) {
        console.log(`${LOG} ✅ Webhook conservé (redémarrage attendu).`);
      } else {
        await this.bot?.stopPolling();
        console.log(`${LOG} ✅ Polling arrêté proprement.`);
      }
    } catch (e) {
      console.error(`${LOG} ❌ Erreur pendant l'arrêt :`, (e as Error).message);
    }
  }
}
