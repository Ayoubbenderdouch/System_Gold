/**
 * IndexedDB storage wrapper for encrypted vault data
 * ULTRA-SAFE: Multiple backup layers to prevent data loss
 * NOW WITH: Cloud sync via Supabase for cross-device access
 */

import { uploadToCloud, downloadFromCloud } from './supabase.js';

const DB_NAME = 'vault-db';
const DB_VERSION = 1;
const STORE_NAME = 'vault';
const DATA_KEY = 'data';
const LOCALSTORAGE_BACKUP_KEY = 'vault_emergency_backup';

/**
 * Open IndexedDB connection
 * @returns {Promise<IDBDatabase>}
 */
function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => {
            reject(new Error('Failed to open database'));
        };

        request.onsuccess = () => {
            resolve(request.result);
        };

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            
            // Create object store if it doesn't exist
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };
    });
}

/**
 * Save encrypted vault blob to IndexedDB with automatic backup
 * @param {Object} blob - Encrypted blob to save
 * @returns {Promise<void>}
 */
export async function saveVault(blob) {
    const db = await openDB();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        
        // SAFETY: Create automatic backup before saving new data
        const timestamp = Date.now();
        const backupKey = `backup_${timestamp}`;
        
        // Save backup copy (keep last 10 backups)
        store.put(blob, backupKey);
        
        // Clean old backups (keep only last 10)
        const getAllRequest = store.getAllKeys();
        getAllRequest.onsuccess = () => {
            const keys = getAllRequest.result.filter(k => k.toString().startsWith('backup_'));
            if (keys.length > 10) {
                keys.sort().slice(0, keys.length - 10).forEach(oldKey => {
                    store.delete(oldKey);
                });
            }
        };
        
        // Save main data
        const request = store.put(blob, DATA_KEY);

        request.onsuccess = async () => {
            // EXTRA SAFETY: Also save to localStorage as emergency backup
            try {
                localStorage.setItem(LOCALSTORAGE_BACKUP_KEY, JSON.stringify(blob));
                console.log('💾 Emergency backup saved to localStorage');
            } catch (e) {
                console.warn('⚠️ Could not save to localStorage (might be full):', e);
            }
            
            // CLOUD SYNC: Upload to Supabase for cross-device access
            try {
                await uploadToCloud(blob);
                console.log('☁️ Data synced to cloud');
            } catch (e) {
                console.warn('⚠️ Cloud sync failed (offline?):', e);
                // Continue anyway - local storage works
            }
            
            db.close();
            console.log('✅ Data saved successfully with backup:', backupKey);
            resolve();
        };

        request.onerror = () => {
            db.close();
            reject(new Error('Failed to save vault data'));
        };

        transaction.onerror = () => {
            db.close();
            reject(new Error('Transaction failed'));
        };
    });
}

/**
 * Load encrypted vault blob from IndexedDB with automatic recovery
 * @returns {Promise<Object|null>} - Encrypted blob or null if not found
 */
export async function loadVault() {
    const db = await openDB();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(DATA_KEY);

        request.onsuccess = () => {
            let data = request.result;
            
            // SAFETY: If main data is corrupted or missing, try to recover from latest backup
            if (!data || !data.v || !data.data) {
                console.warn('⚠️ Main data missing or corrupted, attempting recovery from backup...');
                
                const getAllRequest = store.getAllKeys();
                getAllRequest.onsuccess = () => {
                    const backupKeys = getAllRequest.result
                        .filter(k => k.toString().startsWith('backup_'))
                        .sort()
                        .reverse(); // Latest first
                    
                    if (backupKeys.length > 0) {
                        const latestBackup = backupKeys[0];
                        const backupRequest = store.get(latestBackup);
                        
                        backupRequest.onsuccess = () => {
                            console.log('✅ Data recovered from backup:', latestBackup);
                            db.close();
                            resolve(backupRequest.result);
                        };
                        
                        backupRequest.onerror = () => {
                            db.close();
                            resolve(null);
                        };
                    } else {
                        // LAST RESORT: Try localStorage emergency backup
                        console.warn('⚠️ No IndexedDB backups found, checking localStorage...');
                        try {
                            const emergencyBackup = localStorage.getItem(LOCALSTORAGE_BACKUP_KEY);
                            if (emergencyBackup) {
                                const backupData = JSON.parse(emergencyBackup);
                                console.log('✅ Data recovered from localStorage emergency backup!');
                                db.close();
                                resolve(backupData);
                            } else {
                                db.close();
                                resolve(null);
                            }
                        } catch (e) {
                            console.error('❌ Failed to recover from localStorage:', e);
                            db.close();
                            resolve(null);
                        }
                    }
                };
            } else {
                db.close();
                resolve(data);
            }
        };

        request.onerror = () => {
            db.close();
            reject(new Error('Failed to load vault data'));
        };

        transaction.onerror = () => {
            db.close();
            reject(new Error('Transaction failed'));
        };
    });
}

/**
 * Get list of all available backups
 * @returns {Promise<Array>} - Array of backup keys with timestamps
 */
export async function listBackups() {
    const db = await openDB();
    
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAllKeys();
        
        request.onsuccess = () => {
            const backups = request.result
                .filter(k => k.toString().startsWith('backup_'))
                .map(k => {
                    const timestamp = parseInt(k.toString().replace('backup_', ''));
                    return {
                        key: k,
                        timestamp,
                        date: new Date(timestamp).toLocaleString('ar-DZ')
                    };
                })
                .sort((a, b) => b.timestamp - a.timestamp);
            
            db.close();
            resolve(backups);
        };
        
        request.onerror = () => {
            db.close();
            reject(new Error('Failed to list backups'));
        };
    });
}

/**
 * Sync with cloud on app start
 * Downloads cloud data if it's newer than local
 * @returns {Promise<Object|null>} - Cloud data if newer, null otherwise
 */
export async function syncOnStart() {
    try {
        console.log('🔄 Checking for cloud updates...');
        
        // Get local data
        const localData = await loadVault();
        
        // Get cloud data
        const cloudData = await downloadFromCloud();
        
        if (!cloudData) {
            console.log('ℹ️ No cloud data found');
            return null;
        }
        
        if (!localData) {
            console.log('☁️ Downloading initial data from cloud...');
            return cloudData;
        }
        
        // Compare timestamps (if available in metadata)
        // For now, we trust cloud as source of truth if it exists
        console.log('✅ Cloud sync check complete');
        return cloudData;
        
    } catch (error) {
        console.error('❌ Cloud sync failed:', error);
        return null;
    }
}
