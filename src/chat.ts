import { input, select, confirm } from '@inquirer/prompts';
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
import { getVerifiedUser } from './auth';
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

  // Bezpieczna weryfikacja tożsamości użytkownika przez API
  let userInfo = await getVerifiedUser(config.baseUrl, config.accessToken);
  if (config.accessToken && !userInfo) {
    printWarning('Twój zapisany token sesji wygasł lub jest nieprawidłowy. Zaloguj się ponownie poleceniem /login.');
  }

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
      // Przerwanie Ctrl+C w menu głównym
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
          printSuccess('Włączono tryb AGENT: Dostęp do lokalnych narzędzi deweloperskich (chronione przed prompt injection i nieautoryzowanym wykonaniem)!');
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
        const u = await getVerifiedUser(config.baseUrl, config.accessToken);
        console.log(chalk.cyan.bold('\n╭─ STATUS KONTA (KRYPTOGRAFICZNIE ZWERYFIKOWANY) ─╮'));
        console.log(`│ Email:   ${u?.email ? chalk.green(u.email) : chalk.red('Niezalogowany / Niezweryfikowany')}`);
        console.log(`│ Plan:    ${u?.plan ? chalk.yellow.bold(u.plan.toUpperCase()) : chalk.dim('FREE')}`);
        console.log(`│ Rola:    ${u?.isAdmin ? chalk.magenta.bold('Administrator') : chalk.white('Użytkownik')}`);
        console.log(`│ Model:   ${chalk.yellow(config.model)}`);
        console.log(`│ Serwer:  ${chalk.dim(config.baseUrl)}`);
        console.log(chalk.cyan.bold('╰──────────────────────────────────────────────────╯\n'));
        continue;
      }

      if (command === '/login') {
        const { login } = await import('./auth');
        await login();
        userInfo = await getVerifiedUser(config.baseUrl, config.accessToken);
        continue;
      }

      if (command === '/logout') {
        const { logout } = await import('./auth');
        await logout();
        userInfo = null;
        continue;
      }

      if (command === '/clear') {
        console.clear();
        messages.length = 0;
        lastAssistantResponse = '';
        printBanner({
          model: config.model,
          userEmail: userInfo?.email,
          isAdmin: userInfo?.isAdmin,
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

    // Przygotowanie promptu z utwardzonym kontekstem agenta przeciw Prompt Injection
    let requestMessages = [...messages];
    if (agentMode) {
      const toolsPrompt = `Jesteś autonomicznym agentem inżynierii oprogramowania WildAI działającym w CLI bezpośrednio na maszynie użytkownika.
TWOIM GŁÓWNYM CELEM JEST TWORZENIE I MODYFIKACJA PLIKÓW NA DYSKU ORAZ URUCHAMIANIE KOMEND — A NIE TYLKO PISANIE KODU W CZACIE!

ZASADY POSTĘPOWANIA W TRYBIE AGENTA:
1. TWORZENIE / EDYCJA PLIKÓW:
   Gdy użytkownik prosi o napisanie, stworzenie, przepisanie, refaktoryzację lub aktualizację programu, skryptu czy konfiguracji:
   - NIE wypisuj długiego kodu w czacie jako blok tekstu markdown!
   - ZAWSZE użyj narzędzia "writeFile", aby zapisać plik bezpośrednio na dysku użytkownika:
     [TOOL: writeFile {"filePath": "nazwa_pliku.rozszerzenie", "content": "pelna_zawartosc_kodu"}]

2. URUCHAMIANIE PROGRAMÓW I TESTÓW:
   - Zawsze użyj narzędzia "runCommand":
     [TOOL: runCommand {"command": "python3 plik.py"}]

3. ODCZYT PLIKÓW:
   - Aby zbadać projekt lub odczytać kod:
     [TOOL: readFile {"filePath": "plik.ext"}] lub [TOOL: listDirectory {"dirPath": "."}]

BEZWZGLĘDNE REGUŁY BEZPIECZEŃSTWA:
- Zezwolono Ci na działanie WYŁĄCZNIE w bieżącym katalogu projektu (Path Traversal jest zabroniony).
- Zabrania się dotykania plików poufnych (.env, klucze SSH).
- Każde polecenie i zapis pliku podlega autoryzacji użytkownika (Human-in-the-loop).

FORMAT WYWOŁANIA:
Napisz jedno krótkie zdanie co robisz (np. "Tworzę plik programu hammer.py na Twoim dysku:"), a zaraz po nim wywołaj narzędzie:
[TOOL: writeFile {"filePath": "nazwa.ext", "content": "..."}]`;
      requestMessages = [{ role: 'system', content: toolsPrompt }, ...messages];
    }

    // Metryki tokenów promptu
    const promptTokens = estimateTokens(requestMessages.map(m => m.content).join(' '));
    const startTime = Date.now();
    let timeToFirstTokenMs = 0;
    let fullResponse = '';

    const spinner = ora({
      text: chalk.cyan('Odpowiedź w toku (myślę)... [Ctrl+C aby przerwać]'),
      color: 'cyan',
      spinner: 'dots',
    }).start();

    // AbortController do bezpiecznego przerywania generowania (Ctrl+C)
    const abortController = new AbortController();
    let isAborted = false;
    const sigIntHandler = () => {
      isAborted = true;
      abortController.abort();
    };
    process.once('SIGINT', sigIntHandler);

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
          max_tokens: 4096, // Bezpieczny limit maksymalnej liczby tokenów odpowiedzi
        }),
        signal: abortController.signal,
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

      // Bezpieczne parsowanie i obsługa narzędzi w trybie agenta z limitem wywołań (Tool Budget)
      const MAX_TOOL_CALLS_PER_PROMPT = 3;
      if (agentMode && fullResponse.includes('[TOOL:')) {
        const toolMatch = fullResponse.match(/\[TOOL:\s*(\w+)\s*(\{[\s\S]*?\})\s*\]/);
        if (toolMatch) {
          const toolName = toolMatch[1];
          const rawArgs = toolMatch[2];

          // Ochrona przed pętlą wywołań narzędzi
          const recentToolCalls = messages.filter((m) => m.role === 'system' && m.content.startsWith('Wynik wykonania narzędzia')).length;
          if (recentToolCalls >= MAX_TOOL_CALLS_PER_PROMPT) {
            printWarning(`\n⚠️  [LIMIT AGENTA] Osiągnięto maksymalny limit wywołań narzędzi (${MAX_TOOL_CALLS_PER_PROMPT}) na to zapytanie. Zatrzymano pętlę agenta, aby zapobiec zapętleniu.`);
            messages.push({
              role: 'system',
              content: `Limit wywołań narzędzi (${MAX_TOOL_CALLS_PER_PROMPT}) na to zapytanie został osiągnięty. Podsumuj dotychczasowe działania dla użytkownika.`,
            });
          } else {
            let toolArgs: any = {};
            try {
              toolArgs = JSON.parse(rawArgs);
            } catch {
              try {
                // Bezpieczne parsowanie kluczy bez eval
                const sanitized = rawArgs
                  .replace(/'/g, '"')
                  .replace(/([{,]\s*)([a-zA-Z0-9_]+)\s*:/g, '$1"$2":');
                toolArgs = JSON.parse(sanitized);
              } catch {}
            }

            const tool = localTools[toolName];
            if (tool) {
              console.log(chalk.cyan(`\n╭─ WYWOŁANIE NARZĘDZIA PRZEZ AGENTA [${recentToolCalls + 1}/${MAX_TOOL_CALLS_PER_PROMPT}] ───────────────╮`));
              console.log(`│ Narzędzie: ${chalk.bold.yellow(toolName)}`);
              console.log(chalk.cyan(`╰────────────────────────────────────────────────────────────╯`));
              
              const toolResult = await tool.execute(toolArgs);
              console.log(chalk.dim(`\n--- Wynik narzędzia (${toolName}) ---`));
              console.log(toolResult.substring(0, 400) + (toolResult.length > 400 ? '...' : ''));
              console.log(chalk.dim(`------------------------------------\n`));

              messages.push({
                role: 'system',
                content: `Wynik wykonania narzędzia ${toolName}: ${toolResult}`,
              });
            } else {
              printWarning(`Model zażądał nieznanego narzędzia: "${toolName}".`);
            }
          }
        }
      }

      // Fallback w trybie agenta: jeśli model wypisał kod w czacie zamiast wywołać writeFile
      if (agentMode && !fullResponse.includes('[TOOL: writeFile')) {
        const codeBlockRegex = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
        let codeMatch;
        while ((codeMatch = codeBlockRegex.exec(fullResponse)) !== null) {
          const lang = codeMatch[1]?.toLowerCase() || '';
          const codeContent = codeMatch[2]?.trim();
          if (!codeContent || codeContent.length < 20) continue;

          // Wykrywanie nazwy pliku z pierwszej linii lub z zapytania użytkownika
          let detectedFilename = '';
          const firstLine = codeContent.split('\n')[0];
          const filenameMatch = firstLine.match(/(?:#|\/\/|\/\*)\s*(?:plik:|file:|nazwa:)?\s*([a-zA-Z0-9_.-]+\.[a-zA-Z0-9]+)/i);
          if (filenameMatch) {
            detectedFilename = filenameMatch[1];
          } else {
            const userFileMatch = trimmed.match(/(?:plik|file|skrypt|program)\s+([a-zA-Z0-9_.-]+\.[a-zA-Z0-9]+)/i)
              || trimmed.match(/([a-zA-Z0-9_.-]+\.(?:py|js|ts|json|sh|html|css|cpp|c|go|rs|txt|md))/i);
            if (userFileMatch) {
              detectedFilename = userFileMatch[1];
            } else if (lang === 'python' || lang === 'py') {
              detectedFilename = 'main.py';
            } else if (lang === 'javascript' || lang === 'js') {
              detectedFilename = 'index.js';
            } else if (lang === 'typescript' || lang === 'ts') {
              detectedFilename = 'index.ts';
            }
          }

          if (detectedFilename) {
            console.log(chalk.cyan(`\n💡  [AGENT DETECTOR] Model wygenerował kod w czacie dla: ${chalk.bold.yellow(detectedFilename)}`));
            const saveNow = await confirm({
              message: `Czy chcesz zapisać ten kod na swoim dysku do pliku "${detectedFilename}"?`,
              default: true,
            });
            if (saveNow) {
              const writeTool = localTools['writeFile'];
              if (writeTool) {
                const res = await writeTool.execute({ filePath: detectedFilename, content: codeContent });
                printSuccess(res);
              }
            }
          }
        }
      }

    } catch (err: any) {
      spinner.stop();
      if (isAborted || err.name === 'AbortError') {
        printWarning('\nGenerowanie odpowiedzi zostało przerwane przez użytkownika.');
      } else {
        printError(`Wystąpił błąd: ${err.message}`);
      }
    } finally {
      process.removeListener('SIGINT', sigIntHandler);
    }
  }
}
