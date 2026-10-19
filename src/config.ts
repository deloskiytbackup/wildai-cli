import fs from 'fs';
import path from 'path';
import os from 'os';

const CONFIG_DIR = path.join(os.homedir(), '.wildai-cli');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

export interface CLIConfig {
  baseUrl: string;
  model: string;
  accessToken?: string;
}

export const DEFAULT_CONFIG: CLIConfig = {
  baseUrl: 'https://chat.wildai.pl/api/chat',
  model: 'llama3',
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
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2), { encoding: 'utf-8', mode: 0o600 });
    return DEFAULT_CONFIG;
  }
  try {
    fs.chmodSync(CONFIG_FILE, 0o600);
    const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
    return { ...DEFAULT_CONFIG, ...JSON.parse(data) };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function saveConfig(newConfig: Partial<CLIConfig>) {
  const current = loadConfig();
  const updated = { ...current, ...newConfig };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(updated, null, 2), { encoding: 'utf-8', mode: 0o600 });
  try {
    fs.chmodSync(CONFIG_FILE, 0o600);
  } catch {}
  return updated;
}
