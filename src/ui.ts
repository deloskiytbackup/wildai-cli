import { marked } from 'marked';
import TerminalRenderer from 'marked-terminal';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { exec, execSync } from 'child_process';
import { TokenStats, SessionStats } from './tokenTracker';

marked.setOptions({
  renderer: new TerminalRenderer({
    reflowText: true,
    width: Math.min(process.stdout.columns || 80, 100),
    showSectionPrefix: false,
    unescape: true,
  }) as any
});

export function renderMarkdown(text: string): string {
  try {
    return marked(text) as string;
  } catch {
    return text;
  }
}

export function getChalk() {
  return chalk;
}

export function getGitBranch(): string | null {
  try {
    return execSync('git branch --show-current', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    return null;
  }
}

export function getFriendlyWorkspace(): string {
  const cwd = process.cwd();
  const home = os.homedir();
  if (cwd === home) return '~';
  if (cwd.startsWith(home)) return '~' + cwd.slice(home.length);
  return cwd;
}

export function printSystemMessage(msg: string) {
  console.log(chalk.dim('• ') + chalk.dim(msg));
}

export function printSuccess(msg: string) {
  console.log(chalk.green('✓ ') + chalk.white(msg));
}

export function printError(msg: string) {
  console.log(chalk.red('✗ ') + chalk.redBright(msg));
}

export function printWarning(msg: string) {
  console.log(chalk.yellow('⚠ ') + chalk.yellow(msg));
}

export function printPlanUpgradeNotice(modelName: string, reqPlan: string, userPlan: string) {
  const width = Math.min(process.stdout.columns || 70, 70);
  const border = '─'.repeat(width - 2);

  console.log(chalk.amber ? chalk.amber(`\n╭${border}╮`) : chalk.yellow(`\n╭${border}╯`));
  console.log(chalk.yellow(`│ `) + chalk.bold.yellow('🔒 WYMAGANY WYŻSZY PLAN SUBSKRYPCJI') + ' '.repeat(Math.max(1, width - 38)) + chalk.yellow(`│`));
  console.log(chalk.yellow(`│ `) + chalk.white(`Model "${modelName}" wymaga planu: `) + chalk.bold.magenta(reqPlan.toUpperCase()) + ' '.repeat(Math.max(1, width - 38 - modelName.length - reqPlan.length)) + chalk.yellow(`│`));
  console.log(chalk.yellow(`│ `) + chalk.dim(`Twój obecny plan: `) + chalk.bold.cyan(userPlan.toUpperCase()) + ' '.repeat(Math.max(1, width - 21 - userPlan.length)) + chalk.yellow(`│`));
  console.log(chalk.yellow(`│`) + ' '.repeat(width - 2) + chalk.yellow(`│`));
  console.log(chalk.yellow(`│ `) + chalk.white('Aby odblokować ten model, uaktualnij subskrypcję:') + ' '.repeat(Math.max(1, width - 52)) + chalk.yellow(`│`));
  console.log(chalk.yellow(`│ `) + chalk.bold.cyan('🌐 https://chat.wildai.pl/pricing') + ' '.repeat(Math.max(1, width - 35)) + chalk.yellow(`│`));
  console.log(chalk.yellow(`│`) + ' '.repeat(width - 2) + chalk.yellow(`│`));
  console.log(chalk.yellow(`│ `) + chalk.dim('Wskazówka: Użyj komendy ') + chalk.bold.yellow('/model') + chalk.dim(', aby wybrać dostępny model.') + ' '.repeat(Math.max(1, width - 66)) + chalk.yellow(`│`));
  console.log(chalk.yellow(`╰${border}╯\n`));
}

export function printBanner(options: {
  model: string;
  userEmail?: string | null;
  isAdmin?: boolean;
  baseUrl: string;
  agentMode: boolean;
}) {
  const branch = getGitBranch();
  const workspace = getFriendlyWorkspace();
  const branchDisplay = branch ? chalk.dim(` (git: `) + chalk.cyan(branch) + chalk.dim(`)`) : '';
  
  const width = Math.min(process.stdout.columns || 76, 76);
  const border = '─'.repeat(width - 2);

  console.log(chalk.dim(`╭${border}╮`));
  console.log(chalk.dim(`│ `) + chalk.bold.cyan('✦ WildAI CLI') + ' '.repeat(Math.max(1, width - 23)) + chalk.dim(`v1.2.0 │`));
  console.log(chalk.dim(`│ `) + chalk.white('Katalog:   ') + chalk.bold(workspace) + branchDisplay + ' '.repeat(Math.max(1, width - 15 - workspace.length - (branch ? branch.length + 8 : 0))) + chalk.dim(`│`));
  
  console.log(chalk.dim(`│ `) + chalk.white('Model:     ') + chalk.hex('#10a37f').bold(options.model) + ' '.repeat(Math.max(1, width - 13 - options.model.length)) + chalk.dim(`│`));

  const userRole = options.isAdmin ? ' [ADMIN]' : '';
  const userText = options.userEmail ? `${options.userEmail}${userRole}` : 'GOŚĆ (niezalogowany - wpisz /login)';
  console.log(chalk.dim(`│ `) + chalk.white('Konto:     ') + chalk.dim(userText) + ' '.repeat(Math.max(1, width - 13 - userText.length)) + chalk.dim(`│`));

  const modeStr = options.agentMode ? 'agent (pełne narzędzia deweloperskie)' : 'standardowy (czat konwersacyjny)';
  console.log(chalk.dim(`│ `) + chalk.white('Tryb:      ') + (options.agentMode ? chalk.cyan.bold(modeStr) : chalk.dim(modeStr)) + ' '.repeat(Math.max(1, width - 13 - modeStr.length)) + chalk.dim(`│`));
  console.log(chalk.dim(`╰${border}╯`));
  console.log(chalk.dim(`Wpisz `) + chalk.cyan('/help') + chalk.dim(` aby wyświetlić komendy, `) + chalk.cyan('/model') + chalk.dim(` aby zmienić model, `) + chalk.cyan('/exit') + chalk.dim(` aby wyjść.\n`));
}

export function printStreamHeader() {
  process.stdout.write(`\n`);
}

export function printStreamFooter(stats: TokenStats) {
  const speedStr = `${stats.tokensPerSecond} tok/s`;
  const timeStr = `${(stats.durationMs / 1000).toFixed(2)}s`;
  const ttftStr = `${stats.timeToFirstTokenMs}ms`;
  const costStr = stats.estimatedCostUsd > 0 ? `~$${stats.estimatedCostUsd.toFixed(4)}` : 'Darmowy/Lokalny';

  console.log(`\n\n${chalk.dim('─'.repeat(40))}`);
  console.log(chalk.dim(`✦ tokeny: `) + chalk.yellow(`${stats.totalTokens}`) + chalk.dim(` (wejście: ${stats.promptTokens}, wyjście: ${stats.completionTokens}) • `) + chalk.green(speedStr) + chalk.dim(` • `) + chalk.cyan(timeStr) + chalk.dim(` (opóźnienie: ${ttftStr}) • `) + chalk.magenta(costStr) + `\n`);
}

export function printSessionStats(stats: SessionStats) {
  console.log(chalk.dim('\n╭─ Podsumowanie Sesji i Zużycia Tokenów ─────────────────────╮'));
  console.log(chalk.dim(`│ `) + chalk.bold('Zrealizowane zapytania:') + ' '.repeat(7) + chalk.yellow(stats.messageCount.toString()));
  console.log(chalk.dim(`│ `) + chalk.bold('Tokeny promptu (wejście):') + ' '.repeat(5) + chalk.cyan(stats.totalPromptTokens.toString()));
  console.log(chalk.dim(`│ `) + chalk.bold('Tokeny odpowiedzi (wyjście):') + ' '.repeat(2) + chalk.green(stats.totalCompletionTokens.toString()));
  console.log(chalk.dim(`│ `) + chalk.bold('ŁĄCZNIE ZUŻYTE TOKENY:') + ' '.repeat(8) + chalk.bold.yellowBright(stats.totalTokens.toString()));
  console.log(chalk.dim(`│ `) + chalk.bold('Łączny czas generowania:') + ' '.repeat(6) + chalk.dim((stats.totalDurationMs / 1000).toFixed(1) + 's'));
  console.log(chalk.dim(`│ `) + chalk.bold('Szacowany koszt sesji:') + ' '.repeat(8) + chalk.bold.magenta('$' + stats.totalCostUsd.toFixed(4)));
  console.log(chalk.dim('╰────────────────────────────────────────────────────────────╯\n'));
}

export function printHelp() {
  console.log(chalk.dim('\n╭─ Dostępne Polecenia Slash Commands ────────────────────────╮'));
  console.log(chalk.dim(`│ `) + chalk.cyan('/model') + chalk.dim('         ') + chalk.white('Wybierz aktywny model AI'));
  console.log(chalk.dim(`│ `) + chalk.cyan('/mode') + chalk.dim('          ') + chalk.white('Przełącz tryb wykonania (czat ↔ agent kodujący)'));
  console.log(chalk.dim(`│ `) + chalk.cyan('/tokens') + chalk.dim('        ') + chalk.white('Pokaż zużycie tokenów i szacowany koszt sesji'));
  console.log(chalk.dim(`│ `) + chalk.cyan('/tools') + chalk.dim('         ') + chalk.white('Pokaż listę dostępnych narzędzi deweloperskich'));
  console.log(chalk.dim(`│ `) + chalk.cyan('/copy') + chalk.dim('          ') + chalk.white('Skopiuj ostatnią odpowiedź do schowka (macOS)'));
  console.log(chalk.dim(`│ `) + chalk.cyan('/save [plik]') + chalk.dim('   ') + chalk.white('Zapisz całą rozmowę do pliku Markdown'));
  console.log(chalk.dim(`│ `) + chalk.cyan('/whoami') + chalk.dim('        ') + chalk.white('Pokaż profil użytkownika, plan i status konta'));
  console.log(chalk.dim(`│ `) + chalk.cyan('/login') + chalk.dim('         ') + chalk.white('Zaloguj się do swojego konta WildAI'));
  console.log(chalk.dim(`│ `) + chalk.cyan('/logout') + chalk.dim('        ') + chalk.white('Wyloguj się i usuń lokalny token'));
  console.log(chalk.dim(`│ `) + chalk.cyan('/clear') + chalk.dim('         ') + chalk.white('Wyczyść ekran i historię rozmowy'));
  console.log(chalk.dim(`│ `) + chalk.cyan('/exit') + chalk.dim('          ') + chalk.white('Zakończ sesję w terminalu'));
  console.log(chalk.dim('╰────────────────────────────────────────────────────────────╯\n'));
}

export function copyToClipboard(text: string): boolean {
  if (process.platform === 'darwin') {
    try {
      const proc = exec('pbcopy');
      proc.stdin?.write(text);
      proc.stdin?.end();
      printSuccess('Odpowiedź została skopiowana do schowka!');
      return true;
    } catch {
      printError('Nie udało się skopiować do schowka.');
      return false;
    }
  }
  return false;
}

export function exportChatToMarkdown(filename: string | undefined, messages: any[]) {
  try {
    const targetFile = filename || `wildai-rozmowa-${new Date().toISOString().slice(0, 10)}.md`;
    const fullPath = path.resolve(process.cwd(), targetFile);

    let md = `# Eksport Rozmowy WildAI\n\n*Data: ${new Date().toLocaleString('pl-PL')}*\n\n---\n\n`;
    for (const m of messages) {
      if (m.role === 'system') continue;
      const roleTitle = m.role === 'user' ? '### 👤 Użytkownik' : '### ✦ WildAI';
      md += `${roleTitle}\n\n${m.content}\n\n---\n\n`;
    }

    fs.writeFileSync(fullPath, md, 'utf-8');
    printSuccess(`Rozmowa została zapisana do: ${chalk.bold(targetFile)}`);
  } catch (err: any) {
    printError(`Błąd zapisu pliku: ${err.message}`);
  }
}
