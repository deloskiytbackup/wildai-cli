#!/usr/bin/env node
import { Command } from 'commander';
import { startChat, fetchModels, selectModel } from './chat';
import { loadConfig, saveConfig, DEFAULT_CONFIG } from './config';
import { login, logout } from './auth';
import { printSystemMessage, printSuccess, printError, printPlanUpgradeNotice, getChalk, printStreamHeader, printStreamFooter } from './ui';
import { estimateTokens, estimateCost, TokenStats } from './tokenTracker';
import ora from 'ora';

const program = new Command();

program
  .name('wildai')
  .description('Oficjalne, nowoczesne CLI dla ekosystemu WildAI z obsługą tokenów i narzędzi')
  .version('1.2.0');

// Główna komenda lub pojedynczy prompt
program
  .argument('[prompt...]', 'Opcjonalne bezpośrednie pytanie do AI (tryb one-shot)')
  .action(async (promptParts: string[]) => {
    if (promptParts && promptParts.length > 0) {
      const userPrompt = promptParts.join(' ');
      const config = loadConfig();
      const chalk = getChalk();

      const startTime = Date.now();
      const promptTokens = estimateTokens(userPrompt);

      const spinner = ora({
        text: chalk.dim('WildAI generuje odpowiedź...'),
        color: 'cyan',
      }).start();

      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (config.accessToken) headers['Authorization'] = `Bearer ${config.accessToken}`;

        const res = await fetch(config.baseUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            messages: [{ role: 'user', content: userPrompt }],
            model: config.model,
            chatId: null,
          }),
        });

        if (!res.ok) {
          spinner.stop();
          const errText = await res.text();
          let errorMsg = errText;
          try {
            const errJson = JSON.parse(errText);
            errorMsg = errJson.error || errText;
          } catch {}

          if (res.status === 403 && (errorMsg.includes('wymaga planu') || errorMsg.includes('Twój obecny plan to'))) {
            const reqMatch = errorMsg.match(/wymaga planu\s+([A-Za-z0-9_-]+)/i);
            const userMatch = errorMsg.match(/Twój obecny plan to:\s*([A-Za-z0-9_-]+)/i);
            const reqPlan = reqMatch ? reqMatch[1] : 'BUSINESS';
            const userPlan = userMatch ? userMatch[1] : 'GO';
            printPlanUpgradeNotice(config.model, reqPlan, userPlan);
            return;
          }

          printError(`Błąd API (${res.status}): ${errorMsg}`);
          return;
        }

        const reader = res.body?.getReader();
        const decoder = new TextDecoder();
        if (!reader) throw new Error('Błąd strumienia.');

        spinner.stop();
        printStreamHeader(config.model);

        let isFirstLine = true;
        let fullText = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          let chunk = decoder.decode(value, { stream: true });
          if (isFirstLine && chunk.includes('chatId')) {
            const lines = chunk.split('\n');
            chunk = lines.slice(1).join('\n');
            isFirstLine = false;
          }

          process.stdout.write(chunk);
          fullText += chunk;
        }

        const durationMs = Math.max(Date.now() - startTime, 1);
        const completionTokens = estimateTokens(fullText);
        const totalTokens = promptTokens + completionTokens;
        const tokensPerSecond = Math.round((completionTokens / (durationMs / 1000)) * 10) / 10;
        const estimatedCostUsd = estimateCost(config.model, promptTokens, completionTokens);

        const stats: TokenStats = {
          promptTokens,
          completionTokens,
          totalTokens,
          durationMs,
          timeToFirstTokenMs: durationMs,
          tokensPerSecond,
          estimatedCostUsd,
        };

        printStreamFooter(stats);
      } catch (err: any) {
        spinner.stop();
        printError(`Błąd: ${err.message}`);
      }
      return;
    }

    // Tryb interaktywnego czatu
    await startChat();
  });

program
  .command('chat')
  .description('Uruchom interaktywny czat w terminalu (pełny interfejs)')
  .action(async () => {
    await startChat();
  });

program
  .command('models')
  .description('Wyświetl listę dostępnych modeli AI na serwerze WildAI')
  .action(async () => {
    const config = loadConfig();
    const chalk = getChalk();
    printSystemMessage(`Pobieranie modeli z ${config.baseUrl}...`);
    const models = await fetchModels(config.baseUrl);

    if (models.length === 0) {
      printError('Brak aktywnych modeli na serwerze.');
      return;
    }

    console.log(chalk.cyan.bold('\n╭─ DOSTĘPNE MODELE WILDAI ──────────────────────────────────────╮'));
    models.forEach((m) => {
      const isCurrent = m.modelId === config.model;
      const currentBadge = isCurrent ? chalk.bold.green(' (AKTYWNY)') : '';
      const proBadge = m.isPro ? chalk.yellow('[PRO]') : chalk.green('[FREE]');
      const planStr = `Plan: ${(m.minPlan?.toUpperCase() || 'FREE')}`;
      console.log(`│ ${chalk.bold.white(m.displayName.padEnd(24))} ${proBadge} ${chalk.dim(planStr.padEnd(16))} ${currentBadge}`);
    });
    console.log(chalk.cyan.bold('╰───────────────────────────────────────────────────────────────╯\n'));
    console.log(chalk.dim(`Aby zmienić model: `) + chalk.yellow(`wildai model`) + chalk.dim(` lub `) + chalk.yellow(`wildai config -m <id>\n`));
  });

program
  .command('model')
  .description('Interaktywny wybór domyślnego modelu')
  .action(async () => {
    await selectModel();
  });

program
  .command('login')
  .description('Zaloguj się do swojego konta WildAI')
  .action(async () => {
    await login();
  });

program
  .command('logout')
  .description('Wyloguj się z konta WildAI')
  .action(async () => {
    await logout();
  });

program
  .command('config')
  .description('Zarządzanie konfiguracją CLI')
  .option('-b, --baseUrl <url>', 'Adres URL API WildAI')
  .option('-m, --model <model>', 'Nazwa modelu AI')
  .option('--reset', 'Resetuj konfigurację do domyślnych wartości')
  .action(async (options) => {
    const chalk = getChalk();

    if (options.reset) {
      saveConfig(DEFAULT_CONFIG);
      printSuccess('Konfiguracja została zresetowana do domyślnych wartości.');
      return;
    }

    if (options.baseUrl || options.model) {
      const updates: any = {};
      if (options.baseUrl) updates.baseUrl = options.baseUrl;
      if (options.model) updates.model = options.model;
      saveConfig(updates);
      printSuccess('Konfiguracja zaktualizowana!');
    }

    const config = loadConfig();
    console.log(chalk.cyan.bold('\n╭─ AKTUALNA KONFIGURACJA WILDAI ─────────────╮'));
    console.log(`│ Model:      ${chalk.bold.hex('#10a37f')(config.model)}`);
    console.log(`│ Serwer URL: ${chalk.dim(config.baseUrl)}`);
    console.log(`│ Token auth: ${config.accessToken ? chalk.green('Zapisany ✓') : chalk.red('Brak ✗')}`);
    console.log(chalk.cyan.bold('╰────────────────────────────────────────────╯\n'));
  });

program.parse(process.argv);
