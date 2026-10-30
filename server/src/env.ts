import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const file = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(file)) {
  try {
    process.loadEnvFile(file);
  } catch (err) {
    console.warn("Couldn't read server/.env:", (err as Error).message);
  }
}
