import { createDatabase } from "../../server/src/database.js";
import { resolveDatabasePath } from "../../server/src/index.js";
import { ChatRepository } from "../../server/src/repository.js";

interface RunTelegramPairingCliOptions {
  databasePath?: string;
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
}

export async function runTelegramPairingCli(
  args: string[],
  options: RunTelegramPairingCliOptions = {},
) {
  const pairingCode = args[0]?.trim();
  const stdout = options.stdout ?? console.log;
  const stderr = options.stderr ?? console.error;

  if (!pairingCode) {
    stderr("Usage: npm run pair:telegram -- <pairing-code>");
    return 1;
  }

  const databasePath = options.databasePath ?? (await resolveDatabasePath());
  const database = createDatabase(databasePath);
  const repository = new ChatRepository(database.db);

  try {
    const pairedUser = await repository.authorizeTelegramUserByPairingCode(pairingCode);
    if (!pairedUser) {
      stderr("Pairing code not found or expired.");
      return 1;
    }

    stdout(`Telegram user ${pairedUser.userId} paired.`);
    return 0;
  } finally {
    database.sqlite.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runTelegramPairingCli(process.argv.slice(2))
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
