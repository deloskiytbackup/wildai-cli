export interface TokenStats {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  durationMs: number;
  timeToFirstTokenMs: number;
  tokensPerSecond: number;
  estimatedCostUsd: number;
}

export interface SessionStats {
  messageCount: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  totalDurationMs: number;
  totalCostUsd: number;
}

// Przybliżona kalkulacja liczby tokenów (3.7 znaków na token dla tekstu, 3.2 dla kodu)
export function estimateTokens(text: string): number {
  if (!text) return 0;
  // BPE heuristic: liczba słów + interpunkcja + podział na 3.5-4 znaki
  const words = text.trim().split(/\s+/).length;
  const chars = text.length;
  const tokenEstimate = Math.max(Math.ceil(chars / 3.7), Math.ceil(words * 1.3));
  return tokenEstimate;
}

// Szacowanie kosztu na podstawie modelu (stawki za 1k tokenów)
export function estimateCost(model: string, promptTokens: number, completionTokens: number): number {
  const m = (model || '').toLowerCase();
  
  let promptRatePer1k = 0.0015;
  let compRatePer1k = 0.002;

  if (m.includes('opus')) {
    promptRatePer1k = 0.015;
    compRatePer1k = 0.075;
  } else if (m.includes('sonnet')) {
    promptRatePer1k = 0.003;
    compRatePer1k = 0.015;
  } else if (m.includes('gpt-4') || m.includes('gpt-5') || m.includes('gpt-6')) {
    promptRatePer1k = 0.005;
    compRatePer1k = 0.015;
  } else if (m.includes('deepseek') || m.includes('qwen') || m.includes('gemini')) {
    promptRatePer1k = 0.0005;
    compRatePer1k = 0.0015;
  } else if (m.includes('llama') || m.includes('gemma') || m.includes('ollama')) {
    // Modele lokalne / darmowe
    return 0;
  }

  const cost = (promptTokens / 1000) * promptRatePer1k + (completionTokens / 1000) * compRatePer1k;
  return Math.round(cost * 100000) / 100000;
}

export class SessionTracker {
  private session: SessionStats = {
    messageCount: 0,
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalTokens: 0,
    totalDurationMs: 0,
    totalCostUsd: 0,
  };

  record(stats: TokenStats) {
    this.session.messageCount += 1;
    this.session.totalPromptTokens += stats.promptTokens;
    this.session.totalCompletionTokens += stats.completionTokens;
    this.session.totalTokens += stats.totalTokens;
    this.session.totalDurationMs += stats.durationMs;
    this.session.totalCostUsd += stats.estimatedCostUsd;
  }

  getSessionStats(): SessionStats {
    return { ...this.session };
  }

  reset() {
    this.session = {
      messageCount: 0,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalTokens: 0,
      totalDurationMs: 0,
      totalCostUsd: 0,
    };
  }
}

export const sessionTracker = new SessionTracker();
