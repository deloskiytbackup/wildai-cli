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

// Biała lista znanych, relatywnie bezpiecznych poleceń deweloperskich (Read-Only / Test / Lint)
const KNOWN_SAFE_DEV_PREFIXES = [
  'git status',
  'git diff',
  'git log',
  'git branch',
  'npm test',
  'npm run test',
  'npm run lint',
  'npm run check',
  'npx tsc --noEmit',
  'cargo check',
  'cargo test',
  'pytest',
  'python3 -m unittest',
  'ls',
  'pwd',
];

// Wzorce wysokiego ryzyka, zaciemniania kodu i eskalacji (Obfuscation & Shell Injection)
const HIGH_RISK_PATTERNS = [
  /\b(rm|rmdir)\b/i,                     // Usuwanie plików/katalogów
  /\b(sudo|su|doas)\b/i,                 // Eskalacja uprawnień
  /\b(sh|bash|zsh|dash|ksh)\b/i,         // Uruchamianie powłok podrzędnych
  /\b(eval|exec)\b/i,                    // Dynamiczne wykonywanie kodu
  /\b(curl|wget)\b.*\|\s*(sh|bash|zsh)/i,// Pobieranie i piping do shella
  /\bbase64\s+(-d|--decode)/i,           // Próby zaciemniania base64
  /\$HOME|\$\{HOME\}|~(?=\/)/i,          // Odwołania do katalogu domowego
  /\$\([^\)]+\)|`[^`]+`/i,               // Command substitution $() lub backticks
  />\s*\/dev\/sd[a-z]/i,                 // Zapis do urządzeń blokowych
  /\bdd\s+if=/i,                         // Nadpisywanie sektorów
  /\bmkfs\b/i,                           // Formatowanie dysków
  /\bchmod\b|\bchown\b/i,                // Zmiana uprawnień
  /\bfind\b.*-delete/i,                  // Masowe usuwanie plików
  /\b(python|python3|perl|ruby|node)\s+(-c|-e)\b/i, // Inline kod skryptowy
];

// Walidacja ścieżki plikowej przeciw Path Traversal i wyciekowi kluczy
function getSafePath(targetPath: string): { safePath?: string; error?: string } {
  const rootDir = path.resolve(process.cwd());
  const resolved = path.resolve(rootDir, targetPath);

  // Blokada wyjścia poza katalog projektu (Path Traversal)
  if (!resolved.startsWith(rootDir)) {
    return { error: `[BŁĄD BEZPIECZEŃSTWA] Odmowa dostępu: Ścieżka "${targetPath}" wychodzi poza bieżący katalog roboczy projektu.` };
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
    description: 'Zapisz lub zaktualizuj plik w bieżącym projekcie (wymaga potwierdzenia użytkownika, domyślnie: NIE)',
    execute: async ({ filePath, content }: { filePath: string; content: string }) => {
      try {
        const { safePath, error } = getSafePath(filePath);
        if (error || !safePath) return error || 'Błąd ścieżki.';

        const exists = fs.existsSync(safePath);
        const actionLabel = exists ? 'nadpisać istniejący plik' : 'utworzyć nowy plik';

        // Human-in-the-loop: Bezpieczne potwierdzenie użytkownika (domyślnie: false)
        console.log(chalk.yellow.bold(`\n⚠️  [BEZPIECZEŃSTWO] Agent chce ${actionLabel}: ${chalk.cyan(filePath)} (${content.length} znaków)`));
        const allow = await confirm({
          message: `Czy zezwalasz na zapis do "${filePath}"? (Domyślnie: NIE)`,
          default: false, // Ściśle false!
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
    description: 'Wykonaj polecenie shellowe w terminalu (podlega analizie ryzyka i zgodzie użytkownika)',
    execute: async ({ command }: { command: string }) => {
      try {
        if (!command || typeof command !== 'string') {
          return 'Błąd: Puste polecenie shellowe.';
        }

        const trimmedCmd = command.trim();

        // 1. Sprawdzenie czy komenda znajduje się na białej liście bezpiecznych narzędzi dev
        const isKnownSafe = KNOWN_SAFE_DEV_PREFIXES.some((prefix) =>
          trimmedCmd === prefix || trimmedCmd.startsWith(prefix + ' ')
        );

        // 2. Sprawdzenie czy komenda zawiera wzorce zaciemniania / podwyższonego ryzyka
        const isHighRisk = HIGH_RISK_PATTERNS.some((pattern) => pattern.test(trimmedCmd));

        // 3. Human-in-the-loop z odpowiednim poziomem ostrzeżenia (zawsze default: false)
        if (!isKnownSafe || isHighRisk) {
          console.log(chalk.red.bold(`\n🚨  [ALERT BEZPIECZEŃSTWA - POLECENIE PODWYŻSZONEGO RYZYKA]`));
          console.log(chalk.red(`Polecenie nie znajduje się na liście bezpiecznych narzędzi lub zawiera ryzykowne wzorce:`));
          console.log(chalk.bold.yellow(`    $ ${trimmedCmd}\n`));
        } else {
          console.log(chalk.cyan.bold(`\n⚙️   [NARZĘDZIE DEWELOPERSKIE] Agent proponuje wykonanie polecenia:`));
          console.log(chalk.bold.hex('#10a37f')(`    $ ${trimmedCmd}\n`));
        }

        const allow = await confirm({
          message: `Czy świadomie zezwalasz na uruchomienie tego polecenia? (Domyślnie: NIE)`,
          default: false, // Zawsze domyślnie false!
        });

        if (!allow) {
          return `Operacja zablokowana: Użytkownik odrzucił wykonanie polecenia "${trimmedCmd}".`;
        }

        const { stdout, stderr } = await execAsync(trimmedCmd, { cwd: process.cwd(), timeout: 30000 });
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
