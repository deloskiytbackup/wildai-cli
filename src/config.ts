import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { execSync } from 'child_process';

const CONFIG_DIR = path.join(os.homedir(), '.wildai-cli');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

const ENCRYPTION_PREFIX = 'enc:v1:';
const KEYCHAIN_SERVICE = 'wildai-cli';
const KEYCHAIN_INDICATOR = 'keychain:macos';
const SALT = 'wildai-cli-salt-2026-auth';

// Integracja z natywnym macOS Keychain (Secure Enclave / Login Keychain)
function saveToKeychain(token: string): boolean {
  if (process.platform !== 'darwin') return false;
  try {
    const user = process.env.USER || os.userInfo().username;
    // Flaga -U aktualizuje istniejący wpis
    execSync(`security add-generic-password -a "${user}" -s "${KEYCHAIN_SERVICE}" -w "${token}" -U 2>/dev/null`);
    return true;
  } catch {
    return false;
  }
}

function loadFromKeychain(): string | null {
  if (process.platform !== 'darwin') return null;
  try {
    const user = process.env.USER || os.userInfo().username;
    const stdout = execSync(`security find-generic-password -a "${user}" -s "${KEYCHAIN_SERVICE}" -w 2>/dev/null`, { encoding: 'utf-8' });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

function deleteFromKeychain(): boolean {
  if (process.platform !== 'darwin') return false;
  try {
    const user = process.env.USER || os.userInfo().username;
    execSync(`security delete-generic-password -a "${user}" -s "${KEYCHAIN_SERVICE}" 2>/dev/null`);
    return true;
  } catch {
    return false;
  }
}

// Wyprowadzanie deterministycznego klucza maszyny i użytkownika (Fallback dla systemów bez Keychain)
function getMachineKey(): Buffer {
  const seed = `${os.userInfo().username}@${os.hostname()}:${os.platform()}:${process.env.USER || ''}`;
  return crypto.scryptSync(seed, SALT, 32);
}

// Szyfrowanie tokenu sesji algorytmem AES-256-GCM
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
    // Wsteczna kompatybilność, jeśli w pliku był stary token
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
      if (parsed.accessToken === KEYCHAIN_INDICATOR) {
        // Bezpieczny odczyt z macOS Keychain
        const kcToken = loadFromKeychain();
        parsed.accessToken = kcToken || undefined;
      } else {
        // Fallback: odszyfrowanie AES-256-GCM
        parsed.accessToken = decryptSecret(parsed.accessToken);
      }
    }
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function saveConfig(newConfig: Partial<CLIConfig>) {
  const current = loadConfig();
  const updated = { ...current, ...newConfig };

  let tokenToSave = updated.accessToken;

  if (updated.accessToken) {
    // 1. Próba zapisu w natywnym macOS Keychain (najwyższe bezpieczeństwo systemowe)
    const savedInKeychain = saveToKeychain(updated.accessToken);
    if (savedInKeychain) {
      tokenToSave = KEYCHAIN_INDICATOR; // Żaden token nie ląduje w pliku tekstowym!
    } else {
      // 2. Fallback na szyfrowanie AES-256-GCM dla innych środowisk
      tokenToSave = encryptSecret(updated.accessToken);
    }
  } else if (newConfig.accessToken === undefined && current.accessToken) {
    deleteFromKeychain();
    tokenToSave = undefined;
  }

  const toSave = {
    ...updated,
    accessToken: tokenToSave,
  };

  fs.writeFileSync(CONFIG_FILE, JSON.stringify(toSave, null, 2), { encoding: 'utf-8', mode: 0o600 });
  try {
    fs.chmodSync(CONFIG_FILE, 0o600);
  } catch {}
  return updated;
}
