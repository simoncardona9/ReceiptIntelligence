import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
const COST = 32_768;
const BLOCK_SIZE = 8;
const PARALLELIZATION = 1;
const KEY_LENGTH = 64;
const MAX_MEMORY = 64 * 1024 * 1024;
const DUMMY_SALT = Buffer.from("ReceiptIntelligenceDummySalt", "utf8");

async function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(
      password,
      salt,
      KEY_LENGTH,
      {
        N: COST,
        r: BLOCK_SIZE,
        p: PARALLELIZATION,
        maxmem: MAX_MEMORY,
      },
      (error, key) => (error ? reject(error) : resolve(key)),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await deriveKey(password, salt);
  return [
    "scrypt",
    COST,
    BLOCK_SIZE,
    PARALLELIZATION,
    salt.toString("base64url"),
    key.toString("base64url"),
  ].join("$");
}

export async function verifyPassword(
  password: string,
  encodedHash: string | null,
): Promise<boolean> {
  const fields = encodedHash?.split("$");
  const validFormat =
    fields?.length === 6 &&
    fields[0] === "scrypt" &&
    Number(fields[1]) === COST &&
    Number(fields[2]) === BLOCK_SIZE &&
    Number(fields[3]) === PARALLELIZATION;
  const salt = validFormat ? Buffer.from(fields[4], "base64url") : DUMMY_SALT;
  const expected = validFormat
    ? Buffer.from(fields[5], "base64url")
    : Buffer.alloc(KEY_LENGTH);

  if (expected.length !== KEY_LENGTH || salt.length < 16) {
    await deriveKey(password, DUMMY_SALT);
    return false;
  }

  const actual = await deriveKey(password, salt);
  return timingSafeEqual(actual, expected) && validFormat;
}
