// ============================================
// VoxAnalyze Settings Page - JavaScript
// ============================================

// Supabase Configuration
// Supabase Configuration
const SUPABASE_URL = 'https://vsnzpmeuhsjqbkviebbf.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZzbnpwbWV1aHNqcWJrdmllYmJmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ4NjcyOTMsImV4cCI6MjA4MDQ0MzI5M30.4-eEKIPw5pXHacQYcjK43puRNeCow1wS93XRVv9N7iM';

let supabaseClient = null;

// Default Settings
const defaultSettings = {
    theme: 'light',
    compact: false,
    animations: true,
    emailNotify: true,
    browserNotify: false,
    sound: false,
    pageSize: '25',
    autoRefresh: '20',
    dateFormat: 'short'
};

// ============================================
// DOM Ready Handler
// ============================================
document.addEventListener('DOMContentLoaded', async () => {
    console.log('Settings Page Loaded');

    // Load theme immediately
    const savedSettings = JSON.parse(localStorage.getItem('voxanalyze-settings')) || defaultSettings;
    applyTheme(savedSettings.theme);

    // Initialize Supabase Safely
    try {
        if (window.supabase) {
            supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
        } else {
            console.warn('Supabase library not found on window object');
        }
    } catch (e) {
        console.error('Supabase initialization failed:', e);
    }

    // Initialize mobile menu
    initializeMobileMenu();

    // Auth Check
    let user = null;

    // Try Supabase Session first
    if (supabaseClient) {
        try {
            const { data } = await supabaseClient.auth.getSession();
            if (data && data.session) {
                user = data.session.user;
                console.log('Supabase session found');
            }
        } catch (e) {
            console.warn('Supabase auth check failed:', e);
        }
    }

    // Fallback to Server Session if no Supabase user
    if (!user) {
        try {
            console.log('Checking server session...');
            const serverSession = await fetch('/api/auth/session');
            if (serverSession.ok) {
                const data = await serverSession.json();
                if (data.authenticated) {
                    user = { email: data.email, id: data.user_id, user_metadata: {} };
                    console.log('Server session found');
                }
            }
        } catch (err) {
            console.error('Server session check failed:', err);
        }
    }

    if (!user) {
        console.log('No user found, redirecting to login');
        window.location.href = '/login';
        return;
    }

    // Setup User Profile
    setupUserProfile(user);

    // Initialize Settings
    initializeSettings();

    // Setup Logout
    setupLogout();
});

// ============================================
// Mobile Menu
// ============================================
function initializeMobileMenu() {
    const menuToggle = document.getElementById('menu-toggle');
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');

    if (menuToggle) {
        menuToggle.addEventListener('click', () => {
            sidebar.classList.toggle('open');
            overlay.classList.toggle('active');
        });
    }

    if (overlay) {
        overlay.addEventListener('click', () => {
            sidebar.classList.remove('open');
            overlay.classList.remove('active');
        });
    }
}

// ============================================
// User Profile Setup
// ============================================
function setupUserProfile(user) {
    console.log('[SETTINGS DEBUG] Setting up user profile:', user);

    const userNameEl = document.getElementById('user-name');
    const userEmailEl = document.getElementById('user-email');
    const userAvatarEl = document.getElementById('user-avatar');

    const fullName = user.user_metadata?.full_name || user.email?.split('@')[0] || 'User';

    if (userNameEl) userNameEl.textContent = fullName;
    if (userEmailEl) userEmailEl.textContent = user.email || '';
    if (userAvatarEl) {
        userAvatarEl.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(fullName)}&background=6366f1&color=fff&size=80`;
    }

    // Update settings account section
    const settingsName = document.getElementById('settings-name');
    const settingsEmail = document.getElementById('settings-email');
    const settingsAvatar = document.getElementById('settings-avatar');

    console.log('[SETTINGS DEBUG] Account elements found:', {
        settingsName: !!settingsName,
        settingsEmail: !!settingsEmail,
        settingsAvatar: !!settingsAvatar
    });

    if (settingsName) {
        settingsName.textContent = fullName;
        console.log('[SETTINGS DEBUG] Updated settings-name to:', fullName);
    }
    if (settingsEmail) {
        settingsEmail.textContent = user.email || '';
        console.log('[SETTINGS DEBUG] Updated settings-email to:', user.email);
    }
    if (settingsAvatar) {
        settingsAvatar.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(fullName)}&background=6366f1&color=fff&size=80`;
    }
}

// ============================================
// Logout Handler
// ============================================
function setupLogout() {
    const logoutBtn = document.getElementById('logout-btn');
    const settingsLogout = document.getElementById('settings-logout');

    const handleLogout = async () => {
        try {
            await fetch('/api/auth/logout', { method: 'POST' });
            await supabaseClient.auth.signOut();
        } catch (err) {
            console.error('Logout error:', err);
        }
        window.location.href = '/login';
    };

    if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);
    if (settingsLogout) settingsLogout.addEventListener('click', handleLogout);
}

// ============================================
// Settings Management
// ============================================
async function initializeSettings() {
    // 1. Try to load from API first
    try {
        const response = await fetch('/api/settings');
        if (response.ok) {
            const apiSettings = await response.json();
            if (Object.keys(apiSettings).length > 0) {
                // Merge with defaults to ensure all keys exist
                const merged = { ...defaultSettings, ...apiSettings };
                localStorage.setItem('voxanalyze-settings', JSON.stringify(merged));
                updateSettingsUI(merged);

                // Also apply theme immediately
                applyTheme(merged.theme);
                return;
            }
        }
    } catch (e) {
        console.warn('Failed to fetch settings from API, falling back to local storage', e);
    }

    // 2. Fallback to LocalStorage
    const savedSettings = JSON.parse(localStorage.getItem('voxanalyze-settings')) || defaultSettings;
    updateSettingsUI(savedSettings);
    applyTheme(savedSettings.theme);
    setupSettingsListeners();
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);

    document.querySelectorAll('.theme-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.theme === theme);
    });
}

function updateSettingsUI(settings) {
    // Theme buttons
    document.querySelectorAll('.theme-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.theme === settings.theme);
    });

    // Toggle switches
    const elements = {
        'setting-compact': settings.compact,
        'setting-animations': settings.animations,
        'setting-email-notify': settings.emailNotify,
        'setting-browser-notify': settings.browserNotify,
        'setting-sound': settings.sound
    };

    Object.entries(elements).forEach(([id, value]) => {
        const el = document.getElementById(id);
        if (el) el.checked = value;
    });

    // Dropdowns
    const selects = {
        'setting-page-size': settings.pageSize,
        'setting-auto-refresh': settings.autoRefresh,
        'setting-date-format': settings.dateFormat
    };

    Object.entries(selects).forEach(([id, value]) => {
        const el = document.getElementById(id);
        if (el) el.value = value;
    });
}

function setupSettingsListeners() {
    // Theme buttons
    document.querySelectorAll('.theme-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const theme = btn.dataset.theme;
            applyTheme(theme);
            document.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });

    // Save button
    const saveBtn = document.getElementById('save-settings');
    if (saveBtn) {
        saveBtn.addEventListener('click', async () => {
            const settings = {
                theme: document.querySelector('.theme-btn.active')?.dataset.theme || 'light',
                compact: document.getElementById('setting-compact')?.checked || false,
                animations: document.getElementById('setting-animations')?.checked ?? true,
                emailNotify: document.getElementById('setting-email-notify')?.checked ?? true,
                browserNotify: document.getElementById('setting-browser-notify')?.checked || false,
                sound: document.getElementById('setting-sound')?.checked || false,
                pageSize: document.getElementById('setting-page-size')?.value || '25',
                autoRefresh: document.getElementById('setting-auto-refresh')?.value || '60',
                dateFormat: document.getElementById('setting-date-format')?.value || 'short'
            };

            // 1. Save to Local Storage (Immediate feedback)
            localStorage.setItem('voxanalyze-settings', JSON.stringify(settings));

            // 2. Save to Database
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';

            try {
                const response = await fetch('/api/settings', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(settings)
                });

                if (response.ok) {
                    showToast('Settings saved to database!', 'success');
                } else {
                    const err = await response.json();
                    console.error('API Save Error:', err);
                    showToast('Saved locally, but database sync failed.', 'warning');
                }
            } catch (e) {
                console.error('Network Save Error:', e);
                showToast('Saved locally (Offline)', 'info');
            } finally {
                saveBtn.disabled = false;
                saveBtn.innerHTML = '<i class="fa-solid fa-check"></i> Save Settings';
            }
        });
    }

    // Reset button
    const resetBtn = document.getElementById('reset-settings');
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            localStorage.setItem('voxanalyze-settings', JSON.stringify(defaultSettings));
            updateSettingsUI(defaultSettings);
            applyTheme(defaultSettings.theme);
            showToast('Settings reset to defaults', 'success');
        });
    }
}

// ============================================
// Toast Notifications
// ============================================
function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const icon = type === 'success' ? 'fa-check' : 'fa-exclamation-triangle';

    toast.innerHTML = `
        <div class="toast-icon">
            <i class="fa-solid ${icon}"></i>
        </div>
        <span class="toast-message">${message}</span>
    `;

    container.appendChild(toast);

    // Trigger animation (Left slide in)
    requestAnimationFrame(() => toast.classList.add('show'));

    setTimeout(() => {
        // Exit animation (Left slide out)
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}
