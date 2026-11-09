import fs from "fs";
import path from "path";

export interface TelegramUser {
  userId: number;
  firstName: string;
  username?: string;
  joinedAt: string;
}

const isTelegramUser = (value: unknown): value is TelegramUser =>
  typeof value === "object" &&
  value !== null &&
  "userId" in value &&
  typeof value.userId === "number" &&
  "firstName" in value &&
  typeof value.firstName === "string" &&
  "joinedAt" in value &&
  typeof value.joinedAt === "string" &&
  (!("username" in value) || typeof value.username === "string");

export default class UserStore {
  private readonly filePath = path.join(
    process.cwd(),
    "data",
    "bot-users.json",
  );
  private readonly users = new Map<number, TelegramUser>();
  private writeQueue: Promise<void> = Promise.resolve();

  constructor() {
    this.load();
  }

  add(user: TelegramUser): number {
    if (!this.users.has(user.userId)) {
      this.users.set(user.userId, user);
      this.persist();
    }
    return this.users.size;
  }

  count(): number {
    return this.users.size;
  }

  private load(): void {
    try {
      if (!fs.existsSync(this.filePath)) return;
      const data: unknown = JSON.parse(
        fs.readFileSync(this.filePath, "utf8"),
      );
      if (!Array.isArray(data)) {
        throw new Error("le fichier doit contenir un tableau");
      }
      for (const user of data) {
        if (isTelegramUser(user)) this.users.set(user.userId, user);
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Impossible de charger le registre des utilisateurs: ${detail}`,
      );
    }
  }

  private persist(): void {
    const data = JSON.stringify([...this.users.values()], null, 2);
    this.writeQueue = this.writeQueue
      .then(async () => {
        await fs.promises.mkdir(path.dirname(this.filePath), {
          recursive: true,
        });
        await fs.promises.writeFile(this.filePath, data, "utf8");
      })
      .catch((error: unknown) => {
        console.error("[USER_STORE] Échec de sauvegarde:", error);
      });
  }
}
