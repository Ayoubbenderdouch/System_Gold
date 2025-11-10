/**
 * Cryptography module: PBKDF2 key derivation and AES-GCM encryption/decryption
 */

const PBKDF2_ITERATIONS = 200000;
const SALT_LENGTH = 16; // bytes
const IV_LENGTH = 12; // bytes for AES-GCM
const KEY_LENGTH = 256; // bits

/**
 * Generate random bytes
 * @param {number} length - Number of bytes
 * @returns {Uint8Array} - Random bytes
 */
function randomBytes(length) {
    return crypto.getRandomValues(new Uint8Array(length));
}

/**
 * Convert ArrayBuffer to base64
 * @param {ArrayBuffer} buffer
 * @returns {string} - Base64 string
 */
function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

/**
 * Convert base64 to ArrayBuffer
 * @param {string} base64
 * @returns {ArrayBuffer}
 */
function base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}

/**
 * Derive encryption key from password using PBKDF2
 * @param {string} password - User password
 * @param {Uint8Array} salt - Salt bytes
 * @returns {Promise<CryptoKey>} - Derived key
 */
export async function deriveKey(password, salt) {
    const encoder = new TextEncoder();
    const passwordBuffer = encoder.encode(password);

    // Import password as key material
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        passwordBuffer,
        { name: 'PBKDF2' },
        false,
        ['deriveBits', 'deriveKey']
    );

    // Derive key using PBKDF2
    const key = await crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: salt,
            iterations: PBKDF2_ITERATIONS,
            hash: 'SHA-256'
        },
        keyMaterial,
        { name: 'AES-GCM', length: KEY_LENGTH },
        false,
        ['encrypt', 'decrypt']
    );

    return key;
}

/**
 * Compress data using browser's built-in compression
 * @param {Uint8Array} data - Data to compress
 * @returns {Promise<Uint8Array>} - Compressed data
 */
async function compressData(data) {
    const cs = new CompressionStream('gzip');
    const writer = cs.writable.getWriter();
    writer.write(data);
    writer.close();
    
    const chunks = [];
    const reader = cs.readable.getReader();
    
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
    }
    
    // Combine chunks
    const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
    }
    
    return result;
}

/**
 * Decompress data
 * @param {Uint8Array} data - Compressed data
 * @returns {Promise<Uint8Array>} - Decompressed data
 */
async function decompressData(data) {
    const ds = new DecompressionStream('gzip');
    const writer = ds.writable.getWriter();
    writer.write(data);
    writer.close();
    
    const chunks = [];
    const reader = ds.readable.getReader();
    
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
    }
    
    const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
    }
    
    return result;
}

/**
 * Encrypt JSON object with AES-GCM + GZIP Compression (saves 60-70% space!)
 * @param {Object} obj - Object to encrypt
 * @param {string} password - Password
 * @returns {Promise<Object>} - Encrypted blob { v, salt, iv, data, compressed }
 */
export async function encryptJSON(obj, password) {
    const salt = randomBytes(SALT_LENGTH);
    const iv = randomBytes(IV_LENGTH);
    
    const key = await deriveKey(password, salt);
    
    const encoder = new TextEncoder();
    const jsonStr = JSON.stringify(obj);
    const plaintext = encoder.encode(jsonStr);
    
    // OPTIMIZATION: Compress before encryption (saves 60-70% space!)
    const compressed = await compressData(plaintext);
    
    const ciphertext = await crypto.subtle.encrypt(
        {
            name: 'AES-GCM',
            iv: iv
        },
        key,
        compressed
    );
    
    const originalSize = plaintext.length;
    const compressedSize = ciphertext.byteLength;
    const savedPercent = Math.round((1 - compressedSize / originalSize) * 100);
    
    console.log(`💾 Compression: ${originalSize} bytes → ${compressedSize} bytes (${savedPercent}% gespart)`);
    
    return {
        v: 2, // version 2 with compression
        salt: arrayBufferToBase64(salt),
        iv: arrayBufferToBase64(iv),
        data: arrayBufferToBase64(ciphertext),
        compressed: true
    };
}

/**
 * Decrypt JSON object from encrypted blob
 * @param {Object} blob - Encrypted blob { v, salt, iv, data }
 * @param {string} password - Password
 * @returns {Promise<Object>} - Decrypted object
 */
export async function decryptJSON(blob, password) {
    // Validate blob structure
    if (!blob || typeof blob !== 'object') {
        throw new Error('Invalid encrypted blob');
    }
    
    // Support both v1 (uncompressed) and v2 (compressed)
    if (blob.v !== 1 && blob.v !== 2) {
        throw new Error('Unsupported blob version');
    }
    
    if (!blob.salt || !blob.iv || !blob.data) {
        throw new Error('Missing required blob fields');
    }
    
    const salt = new Uint8Array(base64ToArrayBuffer(blob.salt));
    const iv = new Uint8Array(base64ToArrayBuffer(blob.iv));
    const ciphertext = base64ToArrayBuffer(blob.data);
    
    const key = await deriveKey(password, salt);
    
    let decrypted;
    try {
        decrypted = await crypto.subtle.decrypt(
            {
                name: 'AES-GCM',
                iv: iv
            },
            key,
            ciphertext
        );
    } catch (error) {
        throw new Error('Decryption failed - invalid password or corrupted data');
    }
    
    let plaintext = new Uint8Array(decrypted);
    
    // OPTIMIZATION: Decompress if version 2 (compressed)
    if (blob.v === 2 && blob.compressed) {
        console.log('🗜️ Decompressing data...');
        plaintext = await decompressData(plaintext);
    }
    
    const decoder = new TextDecoder();
    const jsonStr = decoder.decode(plaintext);
    
    try {
        return JSON.parse(jsonStr);
    } catch (error) {
        throw new Error('Invalid JSON data');
    }
}

/**
 * Test key derivation with a password (for validation)
 * @param {string} password - Password to test
 * @returns {Promise<boolean>} - True if successful
 */
export async function testKey(password) {
    if (!password || typeof password !== 'string') {
        throw new Error('Invalid password');
    }

    // Check Web Crypto API support
    if (!crypto || !crypto.subtle) {
        throw new Error('Web Crypto API not supported');
    }

    // Test basic encryption/decryption
    const testData = { test: true };
    const encrypted = await encryptJSON(testData, password);
    const decrypted = await decryptJSON(encrypted, password);
    
    if (!decrypted || decrypted.test !== true) {
        throw new Error('Crypto test failed');
    }
    
    return true;
}
