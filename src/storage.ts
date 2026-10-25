import type { DiaryData } from './types';

const VAULT_KEY = 'garden-diary-v1';
const ATTEMPTS_KEY = 'garden-diary-attempts';
const ITERATIONS = 600_000;

interface Vault {
  version: 1;
  pinLength: 4 | 6;
  salt: string;
  iv: string;
  ciphertext: string;
}

interface Attempts { count: number; blockedUntil: number }

const encode = (value: Uint8Array): string => btoa(String.fromCharCode(...value));
const decode = (value: string): Uint8Array => Uint8Array.from(atob(value), c => c.charCodeAt(0));
const random = (length: number): Uint8Array => crypto.getRandomValues(new Uint8Array(length));

async function derive(pin: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: ITERATIONS, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function readVault(): Vault | null {
  const raw = localStorage.getItem(VAULT_KEY);
  if (!raw) return null;
  try {
    const vault = JSON.parse(raw) as Vault;
    return vault.version === 1 ? vault : null;
  } catch { return null; }
}

function readAttempts(): Attempts {
  try { return JSON.parse(localStorage.getItem(ATTEMPTS_KEY) || '') as Attempts; }
  catch { return { count: 0, blockedUntil: 0 }; }
}

export function hasVault(): boolean { return !!readVault(); }
export function pinLength(): 4 | 6 { return readVault()?.pinLength ?? 4; }
export function waitSeconds(): number { return Math.max(0, Math.ceil((readAttempts().blockedUntil - Date.now()) / 1000)); }

export class DiaryStore {
  private key: CryptoKey | null = null;
  private salt: Uint8Array | null = null;
  data: DiaryData = { events: [], createdAt: new Date().toISOString() };

  async create(pin: string): Promise<void> {
    if (hasVault()) throw new Error('已经设置过密码');
    if (!/^\d{4}$|^\d{6}$/.test(pin)) throw new Error('请输入 4 位或 6 位数字密码');
    this.salt = random(16);
    this.key = await derive(pin, this.salt);
    this.data = { events: [], createdAt: new Date().toISOString() };
    await this.save(pin.length as 4 | 6);
  }

  async unlock(pin: string): Promise<boolean> {
    if (waitSeconds()) throw new Error(`请 ${waitSeconds()} 秒后重试`);
    const vault = readVault();
    if (!vault) throw new Error('未找到本机记录');
    try {
      const salt = decode(vault.salt);
      const key = await derive(pin, salt);
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(vault.iv) as BufferSource }, key, decode(vault.ciphertext) as BufferSource);
      const data = JSON.parse(new TextDecoder().decode(plain)) as DiaryData;
      if (!Array.isArray(data.events)) throw new Error('记录格式错误');
      this.salt = salt;
      this.key = key;
      this.data = data;
      localStorage.removeItem(ATTEMPTS_KEY);
      return true;
    } catch {
      const attempts = readAttempts();
      attempts.count += 1;
      if (attempts.count >= 5) {
        attempts.blockedUntil = Date.now() + Math.min(300, 30 * Math.pow(2, attempts.count - 5)) * 1000;
      }
      localStorage.setItem(ATTEMPTS_KEY, JSON.stringify(attempts));
      return false;
    }
  }

  async save(length?: 4 | 6): Promise<void> {
    if (!this.key || !this.salt) throw new Error('请先登录');
    const iv = random(12);
    const plain = new TextEncoder().encode(JSON.stringify(this.data));
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, this.key, plain);
    const vault: Vault = {
      version: 1,
      pinLength: length ?? pinLength(),
      salt: encode(this.salt),
      iv: encode(iv),
      ciphertext: encode(new Uint8Array(encrypted)),
    };
    localStorage.setItem(VAULT_KEY, JSON.stringify(vault));
  }

  lock(): void {
    this.key = null;
    this.salt = null;
    this.data = { events: [], createdAt: '' };
  }

  async changePin(oldPin: string, newPin: string): Promise<boolean> {
    const vault = readVault();
    if (!vault || !/^\d{4}$|^\d{6}$/.test(newPin)) return false;
    const oldKey = await derive(oldPin, decode(vault.salt));
    try { await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(vault.iv) as BufferSource }, oldKey, decode(vault.ciphertext) as BufferSource); }
    catch { return false; }
    this.salt = random(16);
    this.key = await derive(newPin, this.salt);
    await this.save(newPin.length as 4 | 6);
    return true;
  }
}

export const diaryStore = new DiaryStore();
