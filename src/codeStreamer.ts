import chalk from 'chalk';

export function highlightCode(code: string, lang = ''): string {
  // Komentarze jedno-wierszowe
  if (code.trim().startsWith('//') || code.trim().startsWith('#')) {
    return chalk.dim(code);
  }

  return code
    // Stringi
    .replace(/(["'`].*?["'`])/g, chalk.green('$1'))
    // Słowa kluczowe
    .replace(
      /\b(const|let|var|function|return|import|export|from|if|else|for|while|class|interface|type|async|await|try|catch|new|def|self|public|private|static|extends|implements)\b/g,
      chalk.magenta.bold('$1')
    )
    // Typy i wartości stałe
    .replace(/\b(number|string|boolean|any|void|null|undefined|true|false)\b/g, chalk.cyan('$1'))
    // Liczby
    .replace(/\b(\d+)\b/g, chalk.yellow('$1'));
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
  private currentLang = '';
  private lineNumber = 1;
  private lineBuffer = '';
  private isStartOfLine = true;
  private width = Math.min(process.stdout.columns || 76, 76);

  processChunk(chunk: string) {
    for (let i = 0; i < chunk.length; i++) {
      const char = chunk[i];

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
                process.stdout.write(`\n${chalk.dim('╭─ ')}${chalk.bold.cyan(langBadge)} ${chalk.dim('─'.repeat(borderLen))}${chalk.dim('╮')}\n`);
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
