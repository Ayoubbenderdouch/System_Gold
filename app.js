/**
 * Application utilities: lockout logic, currency formatting, helpers
 */

// Lockout configuration
const LOCK_AFTER = 5; // attempts
const LOCK_MINUTES = 15; // minutes

const STORAGE_KEY_ATTEMPTS = 'vault_attempts';
const STORAGE_KEY_LOCKED_UNTIL = 'vault_locked_until';

/**
 * Register a login attempt (success or failure)
 * @param {boolean} success - Whether the attempt was successful
 */
export function registerAttempt(success) {
    if (success) {
        // Clear lockout data on success
        localStorage.removeItem(STORAGE_KEY_ATTEMPTS);
        localStorage.removeItem(STORAGE_KEY_LOCKED_UNTIL);
        return;
    }

    // Increment failed attempts
    const attempts = parseInt(localStorage.getItem(STORAGE_KEY_ATTEMPTS) || '0', 10) + 1;
    localStorage.setItem(STORAGE_KEY_ATTEMPTS, attempts.toString());

    // Lock if threshold reached
    if (attempts >= LOCK_AFTER) {
        const lockUntil = Date.now() + (LOCK_MINUTES * 60 * 1000);
        localStorage.setItem(STORAGE_KEY_LOCKED_UNTIL, lockUntil.toString());
    }
}

/**
 * Check if user can attempt to enter
 * @returns {boolean} - True if user can attempt login
 */
export function canEnterNow() {
    const lockedUntilStr = localStorage.getItem(STORAGE_KEY_LOCKED_UNTIL);
    
    if (!lockedUntilStr) {
        return true;
    }

    const lockedUntil = parseInt(lockedUntilStr, 10);
    const now = Date.now();

    if (now >= lockedUntil) {
        // Lock expired, clear data
        localStorage.removeItem(STORAGE_KEY_ATTEMPTS);
        localStorage.removeItem(STORAGE_KEY_LOCKED_UNTIL);
        return true;
    }

    return false;
}

/**
 * Get lockout information
 * @returns {Object} - { attempts: number, locked: boolean, minutesLeft: number }
 */
export function lockInfo() {
    const attempts = parseInt(localStorage.getItem(STORAGE_KEY_ATTEMPTS) || '0', 10);
    const lockedUntilStr = localStorage.getItem(STORAGE_KEY_LOCKED_UNTIL);

    if (!lockedUntilStr) {
        return {
            attempts,
            locked: false,
            minutesLeft: 0
        };
    }

    const lockedUntil = parseInt(lockedUntilStr, 10);
    const now = Date.now();
    const msLeft = lockedUntil - now;
    const minutesLeft = Math.ceil(msLeft / 60000);

    return {
        attempts,
        locked: minutesLeft > 0,
        minutesLeft: Math.max(0, minutesLeft)
    };
}

/**
 * Format currency in Algerian Dinar
 * @param {number} amount - Amount to format
 * @returns {string} - Formatted currency string
 */
export function formatCurrency(amount) {
    try {
        return new Intl.NumberFormat('ar-DZ', {
            style: 'currency',
            currency: 'DZD',
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        }).format(amount);
    } catch (error) {
        // Fallback if Intl API fails
        return `${amount.toFixed(2)} دج`;
    }
}
