// Копия shared/hub-crypto.mjs из комплекта dev-cockpit (apps/dev-cockpit) — менять там и копировать сюда.
// Шифрование и подпись по протоколу cockpit-hub (docs/hub-protocol.md).
// Один файл на три стороны: cockpit (Node, без сборки), Mini App (браузер) и тесты. Только WebCrypto —
// globalThis.crypto есть в Node 19+ и во всех браузерах Mini App. Сервер hub этот модуль не использует:
// ключей у него нет, он только хранит и передаёт конверты.

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();

export const PROTOCOL_VERSION = 1;
export const COMMAND_MAX_SKEW_MS = 10 * 60e3;
const HKDF_SALT = enc.encode('cockpit-hub/v1');

// ---------- base64url ----------
export function b64u(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function fromB64u(str) {
  if (typeof str !== 'string' || !/^[A-Za-z0-9_-]*$/.test(str)) throw new Error('bad base64url');
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4));
  return Uint8Array.from(s, c => c.charCodeAt(0));
}

export const randomBytes = n => globalThis.crypto.getRandomValues(new Uint8Array(n));
export const generateDeviceKey = () => randomBytes(32);

// ---------- ключи ----------
// K → K_enc (AES-256-GCM) и K_mac (HMAC-SHA256) по HKDF-SHA256; kid — первые 8 байт SHA-256(K_mac).
export async function deriveKeys(rawKey) {
  if (!(rawKey instanceof Uint8Array) || rawKey.length !== 32) throw new Error('ключ устройства — 32 байта');
  const base = await subtle.importKey('raw', rawKey, 'HKDF', false, ['deriveBits']);
  const bits = info => subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: HKDF_SALT, info: enc.encode(info) }, base, 256);
  const encRaw = new Uint8Array(await bits('enc'));
  const macRaw = new Uint8Array(await bits('mac'));
  const kid = [...new Uint8Array(await subtle.digest('SHA-256', macRaw)).slice(0, 8)].map(b => b.toString(16).padStart(2, '0')).join('');
  return {
    kid,
    encKey: await subtle.importKey('raw', encRaw, 'AES-GCM', false, ['encrypt', 'decrypt']),
    macKey: await subtle.importKey('raw', macRaw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']),
  };
}

// ---------- конверт ----------
// AAD привязывает конверт к устройству и объекту: перенесённый в чужой запрос он не расшифруется.
export const aadFor = (deviceId, type, id) => `${deviceId}|${type}|${id}`;

export async function seal(keys, aad, value) {
  const iv = randomBytes(12);
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(aad) }, keys.encKey, enc.encode(JSON.stringify(value)));
  return { v: PROTOCOL_VERSION, kid: keys.kid, iv: b64u(iv), ct: b64u(new Uint8Array(ct)) };
}

export async function open(keys, aad, envelope) {
  if (!envelope || envelope.v !== PROTOCOL_VERSION) throw new Error('неизвестная версия конверта');
  if (envelope.kid !== keys.kid) throw new Error('конверт другим ключом');
  let pt;
  try {
    pt = await subtle.decrypt({ name: 'AES-GCM', iv: fromB64u(envelope.iv), additionalData: enc.encode(aad) }, keys.encKey, fromB64u(envelope.ct));
  } catch {
    throw new Error('конверт не расшифровался');
  }
  return JSON.parse(dec.decode(pt));
}

// ---------- подпись ----------
// Канонический JSON: ключи по алфавиту на всех уровнях, без пробелов. undefined-поля выбрасываются.
export function canon(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(v => (v === undefined ? 'null' : canon(v))).join(',')}]`;
  return `{${Object.keys(value).filter(k => value[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canon(value[k])}`).join(',')}}`;
}

async function mac(keys, text) {
  return b64u(new Uint8Array(await subtle.sign('HMAC', keys.macKey, enc.encode(text))));
}
async function macVerify(keys, text, sig) {
  let raw;
  try { raw = fromB64u(sig); } catch { return false; }
  return subtle.verify('HMAC', keys.macKey, raw, enc.encode(text)); // сравнение за постоянное время
}

// Команда Mini App → cockpit. body — параметры, их шифруем с AAD команды.
export async function signCommand(keys, { cmdId, deviceId, kind, target = null, body = null, ts = Date.now(), nonce = b64u(randomBytes(16)) }) {
  const sealed = body == null ? null : await seal(keys, aadFor(deviceId, 'command', cmdId), body);
  const cmd = { v: PROTOCOL_VERSION, cmdId, deviceId, kind, target, ts, nonce, body: sealed };
  return { ...cmd, sig: await mac(keys, 'command|' + canon(cmd)) };
}

// Проверка на стороне cockpit. seenNonce(nonce) → true, если номер уже был (кэш ведёт вызывающий).
// Возвращает { ok: true, body } или { ok: false, reason }.
export async function verifyCommand(keys, cmd, { deviceId, now = Date.now(), seenNonce = () => false } = {}) {
  if (!cmd || cmd.v !== PROTOCOL_VERSION) return { ok: false, reason: 'версия' };
  if (deviceId && cmd.deviceId !== deviceId) return { ok: false, reason: 'чужое устройство' };
  if (cmd.body && cmd.body.kid !== keys.kid) return { ok: false, reason: 'другой ключ' };
  const { sig, ...rest } = cmd;
  if (typeof sig !== 'string' || !(await macVerify(keys, 'command|' + canon(rest), sig))) return { ok: false, reason: 'подпись' };
  if (!Number.isFinite(cmd.ts) || Math.abs(now - cmd.ts) > COMMAND_MAX_SKEW_MS) return { ok: false, reason: 'устарела' };
  if (typeof cmd.nonce !== 'string' || cmd.nonce.length < 16 || seenNonce(cmd.nonce)) return { ok: false, reason: 'повтор' };
  let body = null;
  if (cmd.body) {
    try { body = await open(keys, aadFor(cmd.deviceId, 'command', cmd.cmdId), cmd.body); } catch (e) { return { ok: false, reason: e.message }; }
  }
  return { ok: true, body };
}

// ---------- привязка ----------
// proof доказывает cockpit, что пользователь, заявивший pairCode, действительно держит ключ из QR.
export const claimProof = (keys, pairCode) => mac(keys, 'claim|' + pairCode);
export const verifyClaimProof = (keys, pairCode, proof) => macVerify(keys, 'claim|' + pairCode, proof);

// Тексты QR. pair — первая привязка (код + ключ); key — ещё один телефон к уже привязанному устройству.
export const pairQr = (pairCode, rawKey) => `cockpit-pair:v1:${pairCode}:${b64u(rawKey)}`;
export const keyQr = (deviceId, rawKey) => `cockpit-key:v1:${deviceId}:${b64u(rawKey)}`;
export function parseQr(text) {
  const m = /^cockpit-(pair|key):v1:([A-Za-z0-9_-]{4,64}):([A-Za-z0-9_-]{43})$/.exec(String(text || '').trim());
  if (!m) return null;
  const key = fromB64u(m[3]);
  if (key.length !== 32) return null;
  return m[1] === 'pair' ? { type: 'pair', pairCode: m[2], key } : { type: 'key', deviceId: m[2], key };
}

// Код привязки: 8 символов без похожих (0/O, 1/I/L) — его иногда вводят руками.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function pairCode() {
  // Отбрасываем байты ≥ 248, чтобы буквы выпадали равновероятно (248 = 31 × 8).
  let out = '';
  while (out.length < 8) for (const b of randomBytes(16)) if (b < 248 && out.length < 8) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return out;
}
