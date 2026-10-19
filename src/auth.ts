import { input, password } from '@inquirer/prompts';
import axios from 'axios';
import { loadConfig, saveConfig } from './config';
import { printSystemMessage, printError, getChalk } from './ui';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const defaultApiUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://v2.wildai.pl';

export async function login() {
  const chalk = getChalk();
  const config = loadConfig();
  const targetOrigin = config.baseUrl ? new URL(config.baseUrl).origin : defaultApiUrl;

  console.log(chalk.bold('\nLogowanie do WildAI'));

  const email = await input({ message: 'E-mail:' });
  const pass = await password({ message: 'Hasło:' });

  try {
    const res = await axios.post(`${targetOrigin}/api/auth/login`, {
      email,
      password: pass,
    });

    if (res.data?.session?.access_token) {
      saveConfig({ accessToken: res.data.session.access_token });
      printSystemMessage(`Zalogowano pomyślnie jako ${email}! Token został bezpiecznie zapisany z uprawnieniami 0600.`);
    }
  } catch (error: any) {
    const msg = error.response?.data?.error || error.message || 'Nieznany błąd logowania.';
    printError(`Błąd logowania: ${msg}`);
  }
}

export async function logout() {
  saveConfig({ accessToken: undefined });
  printSystemMessage('Wylogowano pomyślnie.');
}

/**
 * Bezpieczna weryfikacja tożsamości użytkownika bezpośrednio przez API WildAI
 * (Zamiast ufać niezweryfikowanemu podpisowi JWT / base64 po stronie klienta)
 */
export async function getVerifiedUser(baseUrl?: string, token?: string): Promise<{ email?: string; isAdmin?: boolean; userId?: string; plan?: string } | null> {
  const config = loadConfig();
  const activeToken = token || config.accessToken;
  if (!activeToken) return null;

  try {
    const targetOrigin = baseUrl ? new URL(baseUrl).origin : (config.baseUrl ? new URL(config.baseUrl).origin : defaultApiUrl);
    const res = await axios.get(`${targetOrigin}/api/auth/me`, {
      headers: { Authorization: `Bearer ${activeToken}` },
      timeout: 5000,
    });

    if (res.data?.user) {
      return {
        email: res.data.user.email,
        isAdmin: Boolean(res.data.user.isAdmin),
        userId: res.data.user.id || res.data.user.userId,
        plan: res.data.user.plan || 'free',
      };
    }
  } catch {
    // Jeśli token jest nieważny/sfałszowany/wygasł, API zwróci 401
    return null;
  }
  return null;
}
