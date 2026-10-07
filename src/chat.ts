import { input, select } from '@inquirer/prompts';
import { loadConfig, saveConfig } from './config';
import { 
  printBanner, 
  printStreamHeader, 
  printStreamFooter, 
  printSessionStats, 
  printHelp, 
  printSystemMessage, 
  printSuccess, 
  printError, 
  printWarning, 
  printPlanUpgradeNotice,
  copyToClipboard, 
  exportChatToMarkdown, 
  getChalk 
} from './ui';
import { localTools, printToolsList } from './tools';
import { estimateTokens, estimateCost, sessionTracker, TokenStats } from './tokenTracker';
import { CodeBoxStreamer } from './codeStreamer';
import ora from 'ora';

export interface ModelInfo {
  modelId: string;
  displayName: string;
  provider: string;
  isPro: boolean;
  minPlan?: string;
}

async function checkConnection(baseUrl: string): Promise<boolean> {
  try {
    const origin = new URL(baseUrl).origin;
    const response = await fetch(origin);
    return response.ok || response.status === 404;
  } catch {
    return false;
  }
}

export async function fetchModels(baseUrl: string): Promise<ModelInfo[]> {
  try {
    const origin = new URL(baseUrl).origin;
    const response = await fetch(`${origin}/api/models`);
    if (!response.ok) return [];
    const data = await response.json();
    if (Array.isArray(data)) {
      return data.map((m: any) => ({
        modelId: m.modelId || m.name,
        displayName: m.displayName || m.modelId || m.name,
        provider: m.provider || 'ollama',
        isPro: Boolean(m.isPro),
        minPlan: m.minPlan || 'free',
      }));
    }
    return [];
  } catch {
    return [];
  }
}

function decodeUserToken(token?: string): { email?: string; isAdmin?: boolean; userId?: string } | null {
  if (!token) return null;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf-8'));
    return {
      email: payload.email,
      isAdmin: Boolean(payload.isAdmin),
      userId: payload.userId,
    };
  } catch {
    return null;
  }
}

export async function selectModel() {
  const config = loadConfig();
  const chalk = getChalk();

  printSystemMessage('Pobieranie dostępnych modeli z API WildAI...');
  const models = await fetchModels(config.baseUrl);

  if (models.length === 0) {
    printError('Nie znaleziono żadnych aktywnych modeli w WildAI. Sprawdź panel admina.');
    return;
  }

  const choices = models.map((m) => {
    const badge = m.isPro ? chalk.yellow('[PRO]') : chalk.green('[FREE]');
    return {
      name: `${m.displayName} ${badge}`,
      value: m.modelId,
      description: `Wymagany plan: ${m.minPlan?.toUpperCase() || 'FREE'}`,
    };
  });

  const chosen = await select({
    message: 'Wybierz model dla WildAI:',
    choices,
    default: config.model,
  });

  saveConfig({ model: chosen });
  printSuccess(`Zmieniono model na: ${chalk.bold.hex('#10a37f')(chosen)}`);
}

export async function startChat() {
  const chalk = getChalk();
  let config = loadConfig();

  const isAlive = await checkConnection(config.baseUrl);

  if (!isAlive) {
    printError('Nie można nawiązać połączenia z serwerem WildAI. Sprawdź swoje połączenie internetowe.');
    return;
  }

  const userInfo = decodeUserToken(config.accessToken);
  let agentMode = false;
  let lastAssistantResponse = '';
  let activeChatId: string | null = null;

  // Wyświetl powitalny banner ze statystykami
  console.clear();
  printBanner({
    model: config.model,
    userEmail: userInfo?.email,
    isAdmin: userInfo?.isAdmin,
    baseUrl: config.baseUrl,
    agentMode,
  });

  const messages: any[] = [];

  while (true) {
    config = loadConfig();
    const promptPrefix = chalk.bold.cyan('❯ ') + (agentMode ? chalk.dim('[agent] ') : '');
    let userPrompt = '';

    try {
      userPrompt = await input({ message: promptPrefix });
    } catch {
      // Przerwanie Ctrl+C
      console.log('\n');
      printSessionStats(sessionTracker.getSessionStats());
      process.exit(0);
    }

    const trimmed = userPrompt.trim();

    if (['exit', 'quit', '/exit', '/quit'].includes(trimmed.toLowerCase())) {
      console.log('\n');
      printSessionStats(sessionTracker.getSessionStats());
      printSystemMessage('Dziękujemy za korzystanie z WildAI CLI. Do widzenia!');
      process.exit(0);
    }

    // Obsługa komend
    if (trimmed.startsWith('/')) {
      const parts = trimmed.split(' ');
      const command = parts[0].toLowerCase();
      const arg = parts.slice(1).join(' ').trim();

      if (command === '/help') {
        printHelp();
        continue;
      }

      if (command === '/model') {
        await selectModel();
        continue;
      }

      if (command === '/tokens' || command === '/stats') {
        printSessionStats(sessionTracker.getSessionStats());
        continue;
      }

      if (command === '/mode') {
        agentMode = !agentMode;
        if (agentMode) {
          printSuccess('Włączono tryb AGENT: Dostęp do lokalnych narzędzi deweloperskich (kod, pliki, polecenia)!');
        } else {
          printSystemMessage('Przełączono w tryb STANDARDOWY (czat konwersacyjny).');
        }
        continue;
      }

      if (command === '/tools') {
        printToolsList();
        continue;
      }

      if (command === '/copy') {
        if (!lastAssistantResponse) {
          printWarning('Brak wcześniejszej odpowiedzi do skopiowania.');
        } else {
          copyToClipboard(lastAssistantResponse);
        }
        continue;
      }

      if (command === '/save') {
        exportChatToMarkdown(arg || undefined, messages);
        continue;
      }

      if (command === '/whoami' || command === '/status') {
        const u = decodeUserToken(config.accessToken);
        console.log(chalk.cyan.bold('\n╭─ STATUS KONTA ─────────────────────────────╮'));
        console.log(`│ Email:   ${u?.email ? chalk.green(u.email) : chalk.red('Niezalogowany')}`);
        console.log(`│ Rola:    ${u?.isAdmin ? chalk.magenta.bold('Administrator') : chalk.white('Użytkownik')}`);
        console.log(`│ Model:   ${chalk.yellow(config.model)}`);
        console.log(`│ Serwer:  ${chalk.dim(config.baseUrl)}`);
        console.log(chalk.cyan.bold('╰────────────────────────────────────────────╯\n'));
        continue;
      }

      if (command === '/login') {
        const { login } = await import('./auth');
        await login();
        continue;
      }

      if (command === '/logout') {
        const { logout } = await import('./auth');
        await logout();
        continue;
      }

      if (command === '/clear') {
        console.clear();
        messages.length = 0;
        lastAssistantResponse = '';
        printBanner({
          model: config.model,
          userEmail: decodeUserToken(config.accessToken)?.email,
          isAdmin: decodeUserToken(config.accessToken)?.isAdmin,
          baseUrl: config.baseUrl,
          agentMode,
        });
        printSuccess('Pamięć czatu i ekran zostały wyczyszczone.');
        continue;
      }

      printError(`Nieznana komenda: "${command}". Wpisz /help, aby zobaczyć listę.`);
      continue;
    }

    if (!trimmed) continue;

    // Dodanie wiadomości użytkownika
    messages.push({ role: 'user', content: trimmed });

    // Przygotowanie promptu z kontekstem agenta, jeśli włączony
    let requestMessages = [...messages];
    if (agentMode) {
      const toolsPrompt = `Masz dostęp do narzędzi w środowisku dewelopera: readFile, writeFile, listDirectory, runCommand, gitStatus. Jeśli chcesz użyć narzędzia, odpowiedz w formacie: [TOOL: nazwaNarzedzia { argumenty }].`;
      requestMessages = [{ role: 'system', content: toolsPrompt }, ...messages];
    }

    // Metryki tokenów promptu
    const promptTokens = estimateTokens(requestMessages.map(m => m.content).join(' '));
    const startTime = Date.now();
    let timeToFirstTokenMs = 0;
    let fullResponse = '';

    const spinner = ora({
      text: chalk.cyan('Odpowiedź w toku (myślę)...'),
      color: 'cyan',
      spinner: 'dots',
    }).start();

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (config.accessToken) {
        headers['Authorization'] = `Bearer ${config.accessToken}`;
      }

      const response = await fetch(config.baseUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          messages: requestMessages,
          model: config.model,
          chatId: activeChatId,
        }),
      });

      if (!response.ok) {
        spinner.stop();
        const errorText = await response.text();
        let errorMsg = errorText;
        try {
          const errJson = JSON.parse(errorText);
          errorMsg = errJson.error || errorText;
        } catch {}

        if (response.status === 403 && (errorMsg.includes('wymaga planu') || errorMsg.includes('Twój obecny plan to'))) {
          const reqMatch = errorMsg.match(/wymaga planu\s+([A-Za-z0-9_-]+)/i);
          const userMatch = errorMsg.match(/Twój obecny plan to:\s*([A-Za-z0-9_-]+)/i);
          const reqPlan = reqMatch ? reqMatch[1] : 'BUSINESS';
          const userPlan = userMatch ? userMatch[1] : 'GO';
          printPlanUpgradeNotice(config.model, reqPlan, userPlan);
          continue;
        }

        throw new Error(`Błąd API (${response.status}): ${errorMsg}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error('Nie udało się utworzyć strumienia odpowiedzi.');

      let isFirstToken = true;
      let buffer = '';
      const streamer = new CodeBoxStreamer();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value, { stream: true });
        buffer += text;

        // Sprawdź czy pierwsza linia zawiera {"chatId": ...}
        if (buffer.includes('\n') && !activeChatId) {
          const lines = buffer.split('\n');
          const firstLine = lines[0].trim();
          if (firstLine.startsWith('{') && firstLine.includes('chatId')) {
            try {
              const meta = JSON.parse(firstLine);
              if (meta.chatId) activeChatId = meta.chatId;
              buffer = lines.slice(1).join('\n');
            } catch {}
          }
        }

        // Dopiero gdy mamy rzeczywistą treść od modelu:
        if (buffer) {
          if (isFirstToken) {
            isFirstToken = false;
            timeToFirstTokenMs = Date.now() - startTime;
            spinner.stop();
            printStreamHeader();
          }

          streamer.processChunk(buffer);
          fullResponse += buffer;
          buffer = '';
        }
      }

      if (isFirstToken) {
        spinner.stop();
      }
      streamer.flush();

      const endTime = Date.now();
      const durationMs = Math.max(endTime - startTime, 1);
      const completionTokens = estimateTokens(fullResponse);
      const totalTokens = promptTokens + completionTokens;
      const seconds = durationMs / 1000;
      const tokensPerSecond = Math.round((completionTokens / seconds) * 10) / 10;
      const estimatedCostUsd = estimateCost(config.model, promptTokens, completionTokens);

      const stats: TokenStats = {
        promptTokens,
        completionTokens,
        totalTokens,
        durationMs,
        timeToFirstTokenMs: timeToFirstTokenMs || durationMs,
        tokensPerSecond,
        estimatedCostUsd,
      };

      sessionTracker.record(stats);
      printStreamFooter(stats);

      lastAssistantResponse = fullResponse;
      messages.push({ role: 'assistant', content: fullResponse });

    } catch (err: any) {
      spinner.stop();
      printError(`Wystąpił błąd: ${err.message}`);
    }
  }
}
