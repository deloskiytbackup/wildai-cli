import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import chalk from 'chalk';
import { confirm } from '@inquirer/prompts';

const execAsync = promisify(exec);

export interface ToolDefinition {
  name: string;
  description: string;
  execute: (args: any) => Promise<string>;
}

// Czarna lista bezwzględnie zablokowanych, niszczycielskich poleceń shellowych
const BLOCKED_COMMAND_PATTERNS = [
  /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*\s+|\s+-r\s+|\s+-rf\s+)\//i, // rm -rf /
  /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*\s+|\s+-r\s+|\s+-rf\s+)~/i,  // rm -rf ~
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /:()\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;/i, // fork bomb
  />\s*\/dev\/sd[a-z]/i,
  /\bchmod\s+(-[a-zA-Z]*R[a-zA-Z]*\s+)?777\s+\//i,
];

// Walidacja ścieżki plikowej przeciw Path Traversal i wyciekowi kluczy
function getSafePath(targetPath: string): { safePath?: string; error?: string } {
  const rootDir = path.resolve(process.cwd());
  const resolved = path.resolve(rootDir, targetPath);

  // Blokada wyjścia poza katalog projektu (Path Traversal)
  if (!resolved.startsWith(rootDir)) {
    return { error: `[BŁĄD BEZPIECZEŃSTWA] Odmowa dostępu: Ścieżka "${targetPath}" wychodzi poza bieżący katalog projektu.` };
  }

  // Blokada plików wrażliwych
  const basename = path.basename(resolved).toLowerCase();
  const sensitiveFiles = ['.env', '.env.local', '.env.production', 'id_rsa', 'id_ed25519', 'credentials', 'authorized_keys'];
  if (sensitiveFiles.includes(basename)) {
    return { error: `[BŁĄD BEZPIECZEŃSTWA] Odmowa dostępu: Plik wrażliwy "${basename}" jest chroniony przed odczytem/zapisem przez agenta.` };
  }

  return { safePath: resolved };
}

export const localTools: Record<string, ToolDefinition> = {
  readFile: {
    name: 'readFile',
    description: 'Odczytaj zawartość lokalnego pliku w bieżącym projekcie (np. "package.json", "src/index.ts")',
    execute: async ({ filePath }: { filePath: string }) => {
      try {
        const { safePath, error } = getSafePath(filePath);
        if (error || !safePath) return error || 'Błąd ścieżki.';

        if (!fs.existsSync(safePath)) return `Błąd: Plik ${filePath} nie istnieje.`;
        const stat = fs.statSync(safePath);
        if (stat.size > 500000) return `Błąd: Plik jest zbyt duży (${(stat.size / 1024).toFixed(1)} KB).`;
        const content = fs.readFileSync(safePath, 'utf-8');
        return content;
      } catch (err: any) {
        return `Błąd odczytu: ${err.message}`;
      }
    },
  },

  writeFile: {
    name: 'writeFile',
    description: 'Zapisz lub zaktualizuj plik w bieżącym projekcie (wymaga potwierdzenia użytkownika)',
    execute: async ({ filePath, content }: { filePath: string; content: string }) => {
      try {
        const { safePath, error } = getSafePath(filePath);
        if (error || !safePath) return error || 'Błąd ścieżki.';

        const exists = fs.existsSync(safePath);
        const actionLabel = exists ? 'nadpisać istniejący plik' : 'utworzyć nowy plik';

        // Human-in-the-loop: Potwierdzenie użytkownika przed zapisem
        console.log(chalk.yellow.bold(`\n⚠️  [BEZPIECZEŃSTWO] Agent chce ${actionLabel}: ${chalk.cyan(filePath)} (${content.length} znaków)`));
        const allow = await confirm({
          message: `Czy zezwalasz na zapis do "${filePath}"?`,
          default: true,
        });

        if (!allow) {
          return `Operacja zablokowana: Użytkownik odrzucił zapis do pliku "${filePath}".`;
        }

        const dir = path.dirname(safePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(safePath, content, 'utf-8');
        return `Pomyślnie zapisano plik ${filePath} (${content.length} znaków).`;
      } catch (err: any) {
        return `Błąd zapisu: ${err.message}`;
      }
    },
  },

  listDirectory: {
    name: 'listDirectory',
    description: 'Wylistuj pliki i katalogi w danym folderze projektu (np. "." lub "src")',
    execute: async ({ dirPath = '.' }: { dirPath: string }) => {
      try {
        const { safePath, error } = getSafePath(dirPath);
        if (error || !safePath) return error || 'Błąd ścieżki.';

        if (!fs.existsSync(safePath)) return `Błąd: Katalog ${dirPath} nie istnieje.`;
        const items = fs.readdirSync(safePath);
        return items.slice(0, 50).join('\n') + (items.length > 50 ? `\n... (+ ${items.length - 50} więcej)` : '');
      } catch (err: any) {
        return `Błąd listowania: ${err.message}`;
      }
    },
  },

  runCommand: {
    name: 'runCommand',
    description: 'Wykonaj polecenie shellowe w terminalu (wymaga potwierdzenia użytkownika)',
    execute: async ({ command }: { command: string }) => {
      try {
        if (!command || typeof command !== 'string') {
          return 'Błąd: Puste polecenie shellowe.';
        }

        // 1. Sprawdzenie wzorców krytycznie niebezpiecznych
        for (const pattern of BLOCKED_COMMAND_PATTERNS) {
          if (pattern.test(command)) {
            return `[BŁĄD BEZPIECZEŃSTWA] Polecenie zablokowane: Wykryto niebezpieczny wzorzec polecenia destrukcyjnego ("${command}").`;
          }
        }

        // 2. Human-in-the-loop: Obowiązkowe potwierdzenie użytkownika
        console.log(chalk.red.bold(`\n🚨  [BEZPIECZEŃSTWO] Agent żąda wykonania komendy shellowej:`));
        console.log(chalk.bold.hex('#10a37f')(`    $ ${command}\n`));

        const allow = await confirm({
          message: `Czy zezwalasz na uruchomienie tego polecenia w terminalu?`,
          default: false,
        });

        if (!allow) {
          return `Operacja zablokowana: Użytkownik odrzucił wykonanie polecenia "${command}".`;
        }

        const { stdout, stderr } = await execAsync(command, { cwd: process.cwd(), timeout: 30000 });
        return (stdout || stderr || 'Polecenie zakończone bez wyjścia.').trim();
      } catch (err: any) {
        return `Błąd wykonania: ${err.message}`;
      }
    },
  },

  gitStatus: {
    name: 'gitStatus',
    description: 'Pokaż aktualny status git dla bieżącego repozytorium',
    execute: async () => {
      try {
        const { stdout } = await execAsync('git status -s', { cwd: process.cwd() });
        return stdout || 'Brak zmian w repozytorium (clean).';
      } catch (err: any) {
        return `Git błąd: ${err.message}`;
      }
    },
  },
};

export function printToolsList() {
  console.log(chalk.cyan.bold('\n╭─ LOKALNE NARZĘDZIA DEWELOPERSKIE (AGENT MODE - ZABEZPIECZONE) ─╮'));
  for (const [key, t] of Object.entries(localTools)) {
    console.log(`│ ${chalk.bold.yellow(t.name.padEnd(16))} ${chalk.dim(t.description)}`);
  }
  console.log(chalk.cyan.bold('╰────────────────────────────────────────────────────────────────╯\n'));
}
