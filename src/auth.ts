import { input, password } from '@inquirer/prompts';
import axios from 'axios';
import { saveConfig } from './config';
import { printSystemMessage, printError, getChalk } from './ui';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const apiUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://chat.wildai.pl';

export async function login() {
  const chalk = getChalk();

  console.log(chalk.bold('\nLogowanie do WildAI'));

  const email = await input({ message: 'E-mail:' });
  const pass = await password({ message: 'Hasło:' });

  try {
    const res = await axios.post(`${apiUrl}/api/auth/login`, {
      email,
      password: pass,
    });

    if (res.data?.session?.access_token) {
      saveConfig({ accessToken: res.data.session.access_token });
      printSystemMessage(`Zalogowano pomyślnie jako ${email}! Token został zapisany.`);
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
