import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import chalk from 'chalk';

const execAsync = promisify(exec);

export interface ToolDefinition {
  name: string;
  description: string;
  execute: (args: any) => Promise<string>;
}

export const localTools: Record<string, ToolDefinition> = {
  readFile: {
    name: 'readFile',
    description: 'Odczytaj zawartość lokalnego pliku (np. "package.json", "src/app/page.tsx")',
    execute: async ({ filePath }: { filePath: string }) => {
      try {
        const fullPath = path.resolve(process.cwd(), filePath);
        if (!fs.existsSync(fullPath)) return `Błąd: Plik ${filePath} nie istnieje.`;
        const stat = fs.statSync(fullPath);
        if (stat.size > 500000) return `Błąd: Plik jest zbyt duży (${(stat.size / 1024).toFixed(1)} KB).`;
        const content = fs.readFileSync(fullPath, 'utf-8');
        return content;
      } catch (err: any) {
        return `Błąd odczytu: ${err.message}`;
      }
    },
  },

  writeFile: {
    name: 'writeFile',
    description: 'Zapisz lub zaktualizuj plik na dysku',
    execute: async ({ filePath, content }: { filePath: string; content: string }) => {
      try {
        const fullPath = path.resolve(process.cwd(), filePath);
        const dir = path.dirname(fullPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(fullPath, content, 'utf-8');
        return `Pomyślnie zapisano plik ${filePath} (${content.length} znaków).`;
      } catch (err: any) {
        return `Błąd zapisu: ${err.message}`;
      }
    },
  },

  listDirectory: {
    name: 'listDirectory',
    description: 'Wylistuj pliki i katalogi w danym folderze (np. "." lub "src")',
    execute: async ({ dirPath = '.' }: { dirPath: string }) => {
      try {
        const fullPath = path.resolve(process.cwd(), dirPath);
        if (!fs.existsSync(fullPath)) return `Błąd: Katalog ${dirPath} nie istnieje.`;
        const items = fs.readdirSync(fullPath);
        return items.slice(0, 50).join('\n') + (items.length > 50 ? `\n... (+ ${items.length - 50} więcej)` : '');
      } catch (err: any) {
        return `Błąd listowania: ${err.message}`;
      }
    },
  },

  runCommand: {
    name: 'runCommand',
    description: 'Wykonaj polecenie shellowe w terminalu (np. "npm test", "git status")',
    execute: async ({ command }: { command: string }) => {
      try {
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
  console.log(chalk.cyan.bold('\n╭─ LOKALNE NARZĘDZIA DEWELOPERSKIE (AGENT MODE) ───────────────╮'));
  for (const [key, t] of Object.entries(localTools)) {
    console.log(`│ ${chalk.bold.yellow(t.name.padEnd(16))} ${chalk.dim(t.description)}`);
  }
  console.log(chalk.cyan.bold('╰──────────────────────────────────────────────────────────────╯\n'));
}
