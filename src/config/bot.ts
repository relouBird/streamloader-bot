import fs from "fs";
import path from "path";
import { BotCommand, MenuButton } from "node-telegram-bot-api";

const resolveConfiguredFile = (configuredPath: string | undefined): string => {
  if (!configuredPath) return "";
  if (path.isAbsolute(configuredPath)) return configuredPath;

  const candidates = [
    path.resolve(process.cwd(), configuredPath),
    path.resolve(process.cwd(), "src", configuredPath),
    path.resolve(__dirname, "..", configuredPath),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
};

const isBotCommand = (value: unknown): value is BotCommand =>
  typeof value === "object" &&
  value !== null &&
  "command" in value &&
  typeof value.command === "string" &&
  "description" in value &&
  typeof value.description === "string";

const parseCommands = (): BotCommand[] => {
  const defaultCommands: BotCommand[] = [
    { command: "start", description: "Démarrer le bot" },
    { command: "help", description: "Afficher l'aide" },
    { command: "link", description: "Lier mon compte avec une clé API" },
  ];
  const configured = process.env.TELEGRAM_BOT_COMMANDS;
  if (!configured) return defaultCommands;

  try {
    const commands: unknown = JSON.parse(configured);
    if (!Array.isArray(commands) || !commands.every(isBotCommand)) {
      throw new Error(
        "TELEGRAM_BOT_COMMANDS doit être un tableau de commandes Telegram",
      );
    }
    return commands;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Configuration Telegram invalide: ${detail}`);
  }
};

const menuButton: MenuButton = { type: "commands" };

export const BOT_CONFIG = {
  name: process.env.TELEGRAM_BOT_NAME || "StreamLoaders",
  description:
    process.env.TELEGRAM_BOT_DESCRIPTION ||
    "Télécharge des vidéos rapidement et gratuitement.",
  shortDescription:
    process.env.TELEGRAM_BOT_SHORT_DESCRIPTION ||
    "Téléchargeur de vidéos rapide et gratuit.",
  profilePhotoPath: resolveConfiguredFile(
    process.env.TELEGRAM_BOT_PROFILE_PHOTO,
  ),
  welcomePhotoPath: resolveConfiguredFile(
    process.env.TELEGRAM_BOT_WELCOME_PHOTO,
  ),
  commands: parseCommands(),
  menuButton,
  welcomeTitle: process.env.TELEGRAM_BOT_WELCOME_TITLE || "StreamLoaders",
  welcomeText:
    process.env.TELEGRAM_BOT_WELCOME_TEXT ||
    "Envoie-moi le lien d'une vidéo pour commencer.",
};
