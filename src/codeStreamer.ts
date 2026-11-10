import chalk from 'chalk';

export function highlightCode(code: string, lang = ''): string {
  // Komentarze jedno-wierszowe
  if (code.trim().startsWith('//') || code.trim().startsWith('#')) {
    return chalk.dim(code);
  }

  return code
    // Stringi
    .replace(/(["'`].*?["'`])/g, chalk.green('$1'))
    // Słowa kluczowe (TS/JS/Python/Swift/Go/Rust)
    .replace(
      /\b(const|let|var|function|return|import|export|from|if|else|elif|for|while|switch|case|break|continue|class|struct|enum|protocol|interface|type|async|await|try|catch|finally|new|def|self|public|private|static|extends|implements|fn|mut|pub|package|func|defer|go|select)\b/g,
      chalk.magenta.bold('$1')
    )
    // Typy i wartości stałe
    .replace(
      /\b(number|string|boolean|any|void|null|undefined|true|false|True|False|None|Int|String|Bool|Double|Float| Promise|Record|Array)\b/g,
      chalk.cyan('$1')
    )
    // Liczby
    .replace(/\b(\d+(?:\.\d+)?)\b/g, chalk.yellow('$1'));
}

export function formatCodeBox(code: string, lang = 'kod'): string {
  const lines = code.trim().split('\n');
  const width = Math.min(process.stdout.columns || 76, 76);
  const border = '─'.repeat(width - 2);

  const langBadge = lang ? `[${lang}]` : '[kod]';
  const borderLen = Math.max(1, width - langBadge.length - 6);
  const header = `${chalk.dim('╭─ ')}${chalk.bold.cyan(langBadge)} ${chalk.dim('─'.repeat(borderLen))}${chalk.dim('╮')}`;

  const formattedLines = lines.map((line, idx) => {
    const lineNum = chalk.dim((idx + 1).toString().padStart(3, ' ') + ' │ ');
    const hl = highlightCode(line, lang);
    return `${chalk.dim('│')} ${lineNum}${hl}`;
  });

  const footer = chalk.dim('╰' + border + '╯');
  return [header, ...formattedLines, footer].join('\n');
}

export class CodeBoxStreamer {
  private inCodeBlock = false;
  private inThinkBlock = false;
  private currentLang = '';
  private lineNumber = 1;
  private lineBuffer = '';
  private tagBuffer = '';
  private isStartOfLine = true;
  private width = Math.min(process.stdout.columns || 76, 76);

  processChunk(rawChunk: string) {
    // Normalizacja znaczników [[THINK]] / [[/THINK]] do <think> / </think>
    const chunk = (this.tagBuffer + rawChunk)
      .replace(/\[\[THINK\]\]/gi, '<think>')
      .replace(/\[\[\/THINK\]\]/gi, '</think>');
    this.tagBuffer = '';

    // Jeśli koniec chunku wygląda jak urwany tag (np. "<thin", "</thin", "[[TH"), przytrzymaj w tagBuffer
    const partialMatch = chunk.match(/(<\/?t(?:h(?:i(?:n(?:k[^>]*?)?)?)?)?|\[\[(?:\/?T(?:H(?:I(?:N(?:K\]?)?)?)?)?)?)$/i);
    let toProcess = chunk;
    if (partialMatch && !partialMatch[0].endsWith('>')) {
      this.tagBuffer = partialMatch[0];
      toProcess = chunk.slice(0, chunk.length - this.tagBuffer.length);
    }

    let idx = 0;
    while (idx < toProcess.length) {
      if (!this.inThinkBlock) {
        const openMatch = toProcess.slice(idx).match(/^<think[^>]*>\r?\n?/i);
        if (openMatch) {
          this.inThinkBlock = true;
          const label = '🧠 Proces myślenia';
          const borderLen = Math.max(1, this.width - label.length - 6);
          process.stdout.write(
            `\n${chalk.dim('╭─ ')}${chalk.magenta(label)} ${chalk.dim('─'.repeat(borderLen))}${chalk.dim('╮')}\n${chalk.dim('│ ')}`
          );
          idx += openMatch[0].length;
          continue;
        }
      } else {
        const closeMatch = toProcess.slice(idx).match(/^<\/think>\s*/i);
        if (closeMatch) {
          this.inThinkBlock = false;
          const border = '─'.repeat(this.width - 2);
          process.stdout.write(`\n${chalk.dim('╰' + border + '╯')}\n\n`);
          this.isStartOfLine = true;
          idx += closeMatch[0].length;
          continue;
        }
      }

      const char = toProcess[idx++];

      if (this.inThinkBlock) {
        if (char === '\n') {
          process.stdout.write(`\n${chalk.dim('│ ')}`);
        } else {
          process.stdout.write(chalk.dim.italic(char));
        }
        continue;
      }

      if (this.inCodeBlock) {
        this.lineBuffer += char;
        if (char === '\n') {
          const line = this.lineBuffer.replace(/\r?\n$/, '');
          const trimmed = line.trim();
          if (trimmed === '```') {
            this.inCodeBlock = false;
            const border = '─'.repeat(this.width - 2);
            process.stdout.write(`${chalk.dim('╰' + border + '╯')}\n`);
            this.isStartOfLine = true;
          } else {
            const numStr = (this.lineNumber++).toString().padStart(3, ' ');
            const hl = highlightCode(line, this.currentLang);
            process.stdout.write(`${chalk.dim('│')} ${chalk.dim(numStr)} ${chalk.dim('│')} ${hl}\n`);
          }
          this.lineBuffer = '';
        }
      } else {
        if (this.isStartOfLine) {
          this.lineBuffer += char;
          if (this.lineBuffer.startsWith('`')) {
            if (this.lineBuffer.length < 3) {
              continue;
            }
            if (this.lineBuffer.startsWith('```')) {
              if (char === '\n') {
                this.inCodeBlock = true;
                this.currentLang = this.lineBuffer.replace(/```|\r?\n/g, '').trim() || 'kod';
                this.lineNumber = 1;
                const langBadge = `[${this.currentLang}]`;
                const borderLen = Math.max(1, this.width - langBadge.length - 6);
                process.stdout.write(
                  `\n${chalk.dim('╭─ ')}${chalk.bold.cyan(langBadge)} ${chalk.dim('─'.repeat(borderLen))}${chalk.dim('╮')}\n`
                );
                this.lineBuffer = '';
                this.isStartOfLine = false;
              }
              continue;
            } else {
              process.stdout.write(this.lineBuffer);
              this.lineBuffer = '';
              this.isStartOfLine = char === '\n';
            }
          } else {
            process.stdout.write(this.lineBuffer);
            this.lineBuffer = '';
            this.isStartOfLine = char === '\n';
          }
        } else {
          process.stdout.write(char);
          if (char === '\n') {
            this.isStartOfLine = true;
          }
        }
      }
    }
  }

  flush() {
    if (this.tagBuffer) {
      process.stdout.write(this.tagBuffer);
      this.tagBuffer = '';
    }
    if (this.inThinkBlock) {
      const border = '─'.repeat(this.width - 2);
      process.stdout.write(`\n${chalk.dim('╰' + border + '╯')}\n\n`);
      this.inThinkBlock = false;
    }
    if (this.inCodeBlock && this.lineBuffer) {
      const line = this.lineBuffer.replace(/\r?\n$/, '');
      const numStr = (this.lineNumber++).toString().padStart(3, ' ');
      const hl = highlightCode(line, this.currentLang);
      process.stdout.write(`${chalk.dim('│')} ${chalk.dim(numStr)} ${chalk.dim('│')} ${hl}\n`);
      const border = '─'.repeat(this.width - 2);
      process.stdout.write(`${chalk.dim('╰' + border + '╯')}\n`);
      this.inCodeBlock = false;
      this.lineBuffer = '';
    } else if (this.lineBuffer) {
      process.stdout.write(this.lineBuffer);
      this.lineBuffer = '';
    }
  }
}
