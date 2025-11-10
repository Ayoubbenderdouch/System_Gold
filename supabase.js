/**
 * Supabase configuration and sync module
 * Provides real-time synchronization between devices
 */

const SUPABASE_URL = 'https://iihfgmkuxwqhxyboccst.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlpaGZnbWt1eHdxaHh5Ym9jY3N0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI4MDg5NzksImV4cCI6MjA3ODM4NDk3OX0.4mXloWXZpfEFzeJzomhoKGetZZ0l5MWAnFuBW49PswA';

// Import Supabase client from CDN
let supabase = null;

/**
 * Initialize Supabase client
 */
async function initSupabase() {
    if (supabase) return supabase;
    
    // Load Supabase client from CDN
    if (!window.supabase) {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
        script.type = 'module';
        
        await new Promise((resolve, reject) => {
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
        
        // Wait a bit for the global to be available
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    const { createClient } = window.supabase;
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    
    console.log('✅ Supabase initialized');
    return supabase;
}

/**
 * Get or create user ID based on password hash
 * This ensures same user ID across all devices with same password
 * @param {string} password - Master password (optional, uses stored hash if available)
 * @returns {Promise<string>}
 */
async function getUserId(password = null) {
    // Try to get stored user ID first
    let userId = localStorage.getItem('vault_user_id');
    
    if (!userId && password) {
        // Create user ID from password hash
        // This ensures same ID on all devices with same password
        const encoder = new TextEncoder();
        const data = encoder.encode(password);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        
        // Use first 16 chars of hash as user ID
        userId = 'user_' + hashHex.substring(0, 16);
        localStorage.setItem('vault_user_id', userId);
        console.log('🆔 User ID created from password hash:', userId);
    } else if (!userId) {
        // Fallback: device-specific ID (shouldn't happen normally)
        userId = 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('vault_user_id', userId);
        console.warn('⚠️ Using device-specific user ID (no password provided)');
    }
    
    return userId;
}

/**
 * Upload encrypted vault to Supabase
 * @param {Object} encryptedBlob - Encrypted data blob
 * @param {string} password - Master password for user ID generation
 * @returns {Promise<void>}
 */
export async function uploadToCloud(encryptedBlob, password) {
    try {
        const client = await initSupabase();
        const userId = await getUserId(password);
        
        const dataToUpload = {
            user_id: userId,
            encrypted_data: encryptedBlob,
            updated_at: new Date().toISOString(),
            device: navigator.userAgent.includes('Mobile') ? 'mobile' : 'desktop'
        };
        
        // Upsert (insert or update)
        const { data, error } = await client
            .from('vaults')
            .upsert(dataToUpload, { onConflict: 'user_id' });
        
        if (error) {
            console.error('❌ Supabase upload error:', error);
            throw error;
        }
        
        console.log('☁️ Data synced to cloud for user:', userId);
        return data;
    } catch (error) {
        console.error('❌ Cloud sync failed:', error);
        // Don't throw - local storage still works
    }
}

/**
 * Download encrypted vault from Supabase
 * @param {string} password - Master password for user ID generation
 * @returns {Promise<Object|null>} - Encrypted blob or null
 */
export async function downloadFromCloud(password) {
    try {
        const client = await initSupabase();
        const userId = await getUserId(password);
        
        console.log('🔍 Downloading cloud data for user:', userId);
        
        const { data, error } = await client
            .from('vaults')
            .select('encrypted_data, updated_at')
            .eq('user_id', userId)
            .single();
        
        if (error) {
            if (error.code === 'PGRST116') {
                // No data found - first time user
                console.log('ℹ️ No cloud data found (first time)');
                return null;
            }
            console.error('❌ Supabase download error:', error);
            throw error;
        }
        
        if (data) {
            console.log('☁️ Data downloaded from cloud, updated at:', data.updated_at);
            return data.encrypted_data;
        }
        
        return null;
    } catch (error) {
        console.error('❌ Cloud download failed:', error);
        return null;
    }
}

/**
 * Check if cloud has newer data than local
 * @param {number} localTimestamp - Local data timestamp
 * @param {string} password - Master password for user ID generation
 * @returns {Promise<boolean>}
 */
export async function hasNewerCloudData(localTimestamp, password) {
    try {
        const client = await initSupabase();
        const userId = await getUserId(password);
        
        const { data, error } = await client
            .from('vaults')
            .select('updated_at')
            .eq('user_id', userId)
            .single();
        
        if (error || !data) return false;
        
        const cloudTime = new Date(data.updated_at).getTime();
        return cloudTime > localTimestamp;
    } catch (error) {
        console.error('❌ Cloud check failed:', error);
        return false;
    }
}

/**
 * Setup real-time sync listener
 * @param {Function} onSync - Callback when new data arrives
 */
export async function setupRealtimeSync(onSync) {
    try {
        const client = await initSupabase();
        const userId = getUserId();
        
        const channel = client
            .channel('vault-changes')
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'vaults',
                    filter: `user_id=eq.${userId}`
                },
                (payload) => {
                    console.log('🔄 Real-time update received:', payload);
                    if (onSync && payload.new) {
                        onSync(payload.new.encrypted_data);
                    }
                }
            )
            .subscribe();
        
        console.log('🔔 Real-time sync enabled');
        return channel;
    } catch (error) {
        console.error('❌ Real-time sync setup failed:', error);
        return null;
    }
}

/**
 * Test connection to Supabase
 * @returns {Promise<boolean>}
 */
export async function testConnection() {
    try {
        const client = await initSupabase();
        const { data, error } = await client.from('vaults').select('count').limit(1);
        
        if (error) {
            console.error('❌ Supabase connection test failed:', error);
            return false;
        }
        
        console.log('✅ Supabase connection OK');
        return true;
    } catch (error) {
        console.error('❌ Supabase connection failed:', error);
        return false;
    }
}
