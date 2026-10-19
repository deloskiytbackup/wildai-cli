import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

const CONFIG_DIR = path.join(os.homedir(), '.wildai-cli');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

const ENCRYPTION_PREFIX = 'enc:v1:';
const SALT = 'wildai-cli-salt-2026-auth';

// Wyprowadzanie deterministycznego klucza maszyny i użytkownika
function getMachineKey(): Buffer {
  const seed = `${os.userInfo().username}@${os.hostname()}:${os.platform()}:${process.env.USER || ''}`;
  return crypto.scryptSync(seed, SALT, 32);
}

// Szyfrowanie tokenu sesji algorytmem AES-256-GCM (ochrona przed plaintext)
export function encryptSecret(plainText: string): string {
  if (!plainText) return '';
  const key = getMachineKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf-8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${ENCRYPTION_PREFIX}${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

// Odszyfrowywanie tokenu sesji algorytmem AES-256-GCM
export function decryptSecret(cipherText: string): string {
  if (!cipherText) return '';
  if (!cipherText.startsWith(ENCRYPTION_PREFIX)) {
    // Wsteczna kompatybilność, jeśli w pliku był stary token w plaintext
    return cipherText;
  }
  try {
    const raw = cipherText.substring(ENCRYPTION_PREFIX.length);
    const [ivHex, tagHex, dataHex] = raw.split(':');
    if (!ivHex || !tagHex || !dataHex) return '';

    const key = getMachineKey();
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(tagHex, 'hex');
    const data = Buffer.from(dataHex, 'hex');

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf-8');
  } catch {
    return '';
  }
}

export interface CLIConfig {
  baseUrl: string;
  model: string;
  accessToken?: string;
}

export const DEFAULT_CONFIG: CLIConfig = {
  baseUrl: 'https://v2.wildai.pl/api/chat',
  model: 'deepseek-v4.1-flash-uncensored',
};

export function loadConfig(): CLIConfig {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  } else {
    try {
      fs.chmodSync(CONFIG_DIR, 0o700);
    } catch {}
  }
  if (!fs.existsSync(CONFIG_FILE)) {
    const initialConfig = { ...DEFAULT_CONFIG };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(initialConfig, null, 2), { encoding: 'utf-8', mode: 0o600 });
    return DEFAULT_CONFIG;
  }
  try {
    fs.chmodSync(CONFIG_FILE, 0o600);
    const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
    const parsed = JSON.parse(data);
    if (parsed.accessToken) {
      parsed.accessToken = decryptSecret(parsed.accessToken);
    }
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function saveConfig(newConfig: Partial<CLIConfig>) {
  const current = loadConfig();
  const updated = { ...current, ...newConfig };

  // Szyfrujemy token sesji przed zapisem na dysk
  const toSave = {
    ...updated,
    accessToken: updated.accessToken ? encryptSecret(updated.accessToken) : undefined,
  };

  fs.writeFileSync(CONFIG_FILE, JSON.stringify(toSave, null, 2), { encoding: 'utf-8', mode: 0o600 });
  try {
    fs.chmodSync(CONFIG_FILE, 0o600);
  } catch {}
  return updated;
}
