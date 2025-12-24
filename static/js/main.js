// ============================================
// VoxAnalyze Dashboard - Main JavaScript
// Modern, Interactive Dashboard Logic
// ============================================

// Supabase Configuration
const SUPABASE_URL = 'https://vsnzpmeuhsjqbkviebbf.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZzbnpwbWV1aHNqcWJrdmllYmJmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ4NjcyOTMsImV4cCI6MjA4MDQ0MzI5M30.4-eEKIPw5pXHacQYcjK43puRNeCow1wS93XRVv9N7iM'; // Public Anon Key

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Global Variables
let allCalls = [];
let currentSearchTerm = '';
let sentimentChart = null;
let currentOffset = 0;
const PAGE_SIZE = 20;
let hasMoreCalls = true;
let totalCallsCount = 0;
let globalStats = null;
let currentFilters = {
    sentiments: ['positive', 'neutral', 'negative'],
    dateFrom: null,
    dateTo: null,
    tags: ['Support', 'Billing', 'Technical Issue', 'Churn Risk', 'Sales', 'Feedback', 'Complaint']
};

class NotificationService {
    constructor() {
        this.container = document.getElementById('vapi-notification-container');
        this.eventSource = null;
        this.init();
    }

    init() {
        if (!this.container) return;

        console.log('[NOTIFY] Initializing Notification Service...');
        this.eventSource = new EventSource('/api/notifications/stream');

        this.eventSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                this.handleNotification(data);
            } catch (e) {
                console.error('[NOTIFY] Error parsing event data:', e);
            }
        };

        this.eventSource.onerror = (err) => {
            console.warn('[NOTIFY] Connection lost. Retrying...', err);
            // EventSource auto-reconnects, but we log it.
        };
    }

    handleNotification(data) {
        console.log('[NOTIFY] Received:', data);

        if (data.status === 'error') {
            this.showToast('Error', data.message, 'error', 'fa-triangle-exclamation');
        } else if (data.status === 'success' || data.status === 'complete') {
            // Specific check for Drive Upload
            if (data.step === 'upload') {
                this.showToast('Google Drive', data.message, 'success', 'fa-google-drive');
            } else if (data.step === 'done') {
                console.log('[NOTIFY] Analysis run complete. Triggering refresh...');
                this.showToast('Analysis Complete', data.message, 'success', 'fa-check');

                // Refresh list if done - Force reset of list
                if (typeof fetchCalls === 'function') {
                    console.log('[NOTIFY] Calling fetchCalls(false)...');
                    fetchCalls(false);
                }
                if (typeof initializeSentimentChart === 'function') initializeSentimentChart();
            } else {
                this.showToast(this.formatStep(data.step), data.message, 'success', 'fa-check');
            }
        } else {
            // Processing/Active
            this.showToast(this.formatStep(data.step), data.message, 'processing', 'fa-spinner fa-spin');
        }
    }

    formatStep(step) {
        const map = {
            'start': 'Call Received',
            'download': 'Downloading',
            'upload': 'Google Drive',
            'analyze': 'Analyzing',
        };
        return map[step] || step.charAt(0).toUpperCase() + step.slice(1);
    }

    showToast(title, message, type = 'processing', iconClass = 'fa-info-circle') {
        const toast = document.createElement('div');
        toast.className = `vapi-toast ${type}`;

        toast.innerHTML = `
            <div class="vapi-toast-icon">
                <i class="fa-solid ${iconClass}"></i>
            </div>
            <div class="vapi-toast-content">
                <div class="vapi-toast-title">${title}</div>
                <div class="vapi-toast-message">${message}</div>
            </div>
            <button class="vapi-toast-close" onclick="this.parentElement.remove()">
                <i class="fa-solid fa-xmark"></i>
            </button>
        `;

        this.container.appendChild(toast);

        // Auto remove after 5 seconds
        setTimeout(() => {
            toast.style.animation = 'slideOutLeft 0.3s ease-in forwards';
            setTimeout(() => toast.remove(), 300);
        }, 5000);
    }
}

// ============================================
// DOM Ready Handler
// ============================================
document.addEventListener('DOMContentLoaded', async () => {
    // Initialize UI Elements
    initializeMobileMenu();
    initializeRefreshButton();
    setupSearchListener();
    initializeUploadButton();
    initializeProfileDropdown();
    initializeLoadMoreButton();
    initializeFilterModal();

    // Initialize Real-time Notifications
    window.notificationService = new NotificationService();

    // Auth Check - check both Supabase client session and server session
    let user = null;

    // First try Supabase client session
    const { data: { session } } = await supabaseClient.auth.getSession();

    if (session) {
        user = session.user;
    } else {
        // Fallback: Check server-side session
        try {
            const serverSession = await fetch('/api/auth/session');
            if (serverSession.ok) {
                const data = await serverSession.json();
                if (data.authenticated) {
                    // Create a minimal user object from server session
                    user = {
                        email: data.email,
                        id: data.user_id,
                        user_metadata: {}
                    };
                }
            }
        } catch (err) {
            console.log('Server session check failed:', err);
        }
    }

    // Only redirect if BOTH sessions are missing
    if (!user) {
        window.location.href = '/login';
        return;
    }

    // Setup User Profile
    setupUserProfile(user);

    // Setup Logout
    setupLogout();

    // Fetch and Display Data
    await fetchCalls();

    // Initialize Chart
    initializeSentimentChart();

    // Sync Settings in Background
    syncSettingsFromApi();

    // Hide Page Loader after data is ready
    hidePageLoader();
});

// Hide Page Loader
function hidePageLoader() {
    const loader = document.getElementById('page-loader');
    if (loader) {
        loader.classList.add('hidden');
        // Optional: Remove from DOM after transition
        setTimeout(() => {
            loader.style.display = 'none';
        }, 500);
    }
}

// ============================================
// Filter Modal
// ============================================
function initializeFilterModal() {
    const filterBtn = document.getElementById('filter-btn');
    const filterModal = document.getElementById('filter-modal');
    const closeBtn = document.getElementById('filter-modal-close');
    const applyBtn = document.getElementById('filter-apply-btn');
    const resetBtn = document.getElementById('filter-reset-btn');

    if (!filterBtn || !filterModal) return;

    // Open modal
    filterBtn.addEventListener('click', () => {
        // Sync UI with current state
        syncFilterUI();
        filterModal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    });

    // Close modal
    const closeModal = () => {
        filterModal.style.display = 'none';
        document.body.style.overflow = 'auto';
    };

    if (closeBtn) closeBtn.addEventListener('click', closeModal);

    // Close on overlay click
    filterModal.addEventListener('click', (e) => {
        if (e.target === filterModal) closeModal();
    });

    // Reset filters
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            currentFilters = {
                sentiments: ['positive', 'neutral', 'negative'],
                dateFrom: null,
                dateTo: null,
                tags: ['Support', 'Billing', 'Technical Issue', 'Churn Risk', 'Sales', 'Feedback', 'Complaint']
            };
            syncFilterUI();
            applyFilters();
            closeModal();
        });
    }

    // Apply filters
    if (applyBtn) {
        applyBtn.addEventListener('click', () => {
            // Get values from UI
            const sentimentChecks = filterModal.querySelectorAll('input[name="sentiment"]:checked');
            currentFilters.sentiments = Array.from(sentimentChecks).map(cb => cb.value);

            const tagChecks = filterModal.querySelectorAll('input[name="tags"]:checked');
            currentFilters.tags = Array.from(tagChecks).map(cb => cb.value);

            currentFilters.dateFrom = document.getElementById('filter-date-from').value || null;
            currentFilters.dateTo = document.getElementById('filter-date-to').value || null;

            applyFilters();
            closeModal();
        });
    }

    function syncFilterUI() {
        // Sentiments
        const sentimentChecks = filterModal.querySelectorAll('input[name="sentiment"]');
        sentimentChecks.forEach(cb => {
            cb.checked = currentFilters.sentiments.includes(cb.value);
        });

        // Tags
        const tagChecks = filterModal.querySelectorAll('input[name="tags"]');
        tagChecks.forEach(cb => {
            cb.checked = currentFilters.tags.includes(cb.value);
        });

        // Dates
        document.getElementById('filter-date-from').value = currentFilters.dateFrom || '';
        document.getElementById('filter-date-to').value = currentFilters.dateTo || '';
    }
}

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

    // Initialize sidebar navigation
    initializeSidebarNavigation();
}

// ============================================
// Sidebar Navigation
// ============================================
function initializeSidebarNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');

    // Define which sections belong to which nav item
    const sectionMapping = {
        'dashboard': ['dashboard-section', 'analytics-section', 'calls-section'],
        'calls': ['calls-section'],
        'analytics': ['analytics-section'],
        'reports': ['reports-section'],
        'settings': ['settings-section']
    };

    // All possible sections
    const allSections = [
        'dashboard-section',
        'analytics-section',
        'calls-section',
        'settings-section',
        'reports-section'
    ];

    // Initialize: Show only dashboard sections on load
    showSection('dashboard', sectionMapping, allSections);

    navItems.forEach(item => {
        const link = item.querySelector('.nav-link');

        if (link) {
            link.addEventListener('click', (e) => {
                e.preventDefault();

                const sectionName = item.dataset.section;

                if (sectionName) {
                    // Remove active class from all items
                    navItems.forEach(nav => nav.classList.remove('active'));

                    // Add active class to clicked item
                    item.classList.add('active');

                    // Show the appropriate sections
                    showSection(sectionName, sectionMapping, allSections);

                    // Update page title based on section
                    updatePageTitle(sectionName);

                    // Close mobile menu if open
                    if (sidebar) sidebar.classList.remove('open');
                    if (overlay) overlay.classList.remove('active');

                    // Scroll to top of main content
                    const mainContent = document.querySelector('.main-content');
                    if (mainContent) {
                        mainContent.scrollTo({ top: 0, behavior: 'smooth' });
                    }
                }
            });
        }
    });
}

// Show/Hide sections based on navigation
function showSection(sectionName, sectionMapping, allSections) {
    const sectionsToShow = sectionMapping[sectionName] || [];

    allSections.forEach(sectionId => {
        const section = document.getElementById(sectionId);
        if (section) {
            if (sectionsToShow.includes(sectionId)) {
                section.style.display = '';
                section.classList.add('section-active');
                section.classList.remove('section-hidden');
            } else {
                section.style.display = 'none';
                section.classList.remove('section-active');
                section.classList.add('section-hidden');
            }
        }
    });
}

// ============================================
// Update Page Title
// ============================================
function updatePageTitle(section) {
    const pageTitle = document.querySelector('.page-title');
    const pageSubtitle = document.querySelector('.page-subtitle');

    const titles = {
        'dashboard': { title: 'Dashboard', subtitle: 'Track your call analytics and insights' },
        'calls': { title: 'Call Records', subtitle: 'View and manage all analyzed calls' },
        'analytics': { title: 'Analytics', subtitle: 'Sentiment distribution and category insights' },
        'reports': { title: 'Reports', subtitle: 'Generate and download reports' },
        'settings': { title: 'Settings', subtitle: 'Manage your account and preferences' }
    };

    const titleData = titles[section] || titles['dashboard'];

    if (pageTitle) pageTitle.textContent = titleData.title;
    if (pageSubtitle) pageSubtitle.textContent = titleData.subtitle;
}

// ============================================
// User Profile Setup
// ============================================
function setupUserProfile(user) {
    const userNameEl = document.getElementById('user-name');
    const userEmailEl = document.getElementById('user-email');
    const userAvatarEl = document.getElementById('user-avatar');

    // Get name from metadata or email
    const fullName = user.user_metadata?.full_name ||
        user.email?.split('@')[0] ||
        'User';

    if (userNameEl) {
        userNameEl.textContent = fullName;
    }

    if (userEmailEl) {
        userEmailEl.textContent = user.email || '';
    }

    if (userAvatarEl) {
        userAvatarEl.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(fullName)}&background=6366f1&color=fff&size=80`;
    }
}

// ============================================
// Logout Handler
// ============================================
// ============================================
// Logout Handler
// ============================================
async function handleLogout() {
    try {
        // Clear server-side session first
        await fetch('/api/auth/logout', { method: 'POST' });
        // Then sign out from Supabase
        await supabaseClient.auth.signOut();
    } catch (err) {
        console.error('Logout error:', err);
    }
    window.location.href = '/login';
}

function setupLogout() {
    const logoutBtn = document.getElementById('logout-btn');

    if (logoutBtn) {
        logoutBtn.addEventListener('click', handleLogout);
    }
}

// Initialize Profile Dropdown
function initializeProfileDropdown() {
    const profileTrigger = document.getElementById('profile-trigger');
    const profileDropdown = document.getElementById('profile-dropdown');
    const headerLogoutBtn = document.getElementById('header-logout-btn');

    if (profileTrigger && profileDropdown) {
        // Toggle dropdown on click
        profileTrigger.addEventListener('click', (e) => {
            e.stopPropagation();
            profileDropdown.classList.toggle('active');
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!profileTrigger.contains(e.target) && !profileDropdown.contains(e.target)) {
                profileDropdown.classList.remove('active');
            }
        });

        // Handle logout from dropdown
        if (headerLogoutBtn) {
            headerLogoutBtn.addEventListener('click', handleLogout);
        }
    }
}




// ============================================
// Refresh Button
// ============================================
function initializeRefreshButton() {
    const refreshBtn = document.getElementById('refresh-btn');

    if (refreshBtn) {
        refreshBtn.addEventListener('click', async () => {
            refreshBtn.classList.add('loading');
            await fetchCalls();
            initializeSentimentChart();
            refreshBtn.classList.remove('loading');
            showToast('Data refreshed successfully', 'success');
        });
    }
}

// ============================================
// Upload Button
// ============================================
function initializeUploadButton() {
    const uploadBtn = document.getElementById('upload-btn');
    const uploadModal = document.getElementById('upload-modal');
    const uploadModalClose = document.getElementById('upload-modal-close');
    const uploadCancelBtn = document.getElementById('upload-cancel-btn');
    const uploadSubmitBtn = document.getElementById('upload-submit-btn');
    const uploadDropZone = document.getElementById('upload-drop-zone');
    const fileInput = document.getElementById('upload-modal-file-input-batch');

    // Explicitly enforce multiple attribute
    if (fileInput) {
        console.log('[INIT] Force-enabling multiple file selection (ID: upload-modal-file-input-batch)');
        fileInput.multiple = true;
        fileInput.setAttribute('multiple', 'multiple');
    } else {
        console.error('[INIT] Critical Error: File input element not found!');
    }
    const selectedFilesContainer = document.getElementById('selected-files-container');
    const selectedFilesList = document.getElementById('selected-files-list');
    const filesCountLabel = document.getElementById('files-count-label');
    const clearAllBtn = document.getElementById('clear-all-files');
    const progressSection = document.getElementById('upload-progress-section');
    const progressBar = document.getElementById('upload-progress-bar');
    const progressPercent = document.getElementById('upload-percent');
    const uploadStatusText = document.getElementById('upload-status-text');
    const progressFileName = document.getElementById('progress-file-name');
    const batchProgressInfo = document.getElementById('batch-progress-info');

    // Advanced Options Trigger
    const advancedTrigger = document.getElementById('upload-advanced-trigger');
    const advancedContent = document.getElementById('upload-advanced-content');

    if (advancedTrigger && advancedContent) {
        advancedTrigger.onclick = () => {
            const isHidden = advancedContent.style.display === 'none';
            advancedContent.style.display = isHidden ? 'block' : 'none';
            advancedTrigger.classList.toggle('open', isHidden);
        };
    }

    let selectedFiles = [];

    if (!uploadBtn || !uploadModal) return;

    // Open modal
    uploadBtn.addEventListener('click', () => {
        uploadModal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
        resetUploadModal();
    });

    // Close modal functions
    const closeModal = () => {
        uploadModal.style.display = 'none';
        document.body.style.overflow = '';
        resetUploadModal();
    };

    uploadModalClose.addEventListener('click', closeModal);
    uploadCancelBtn.addEventListener('click', closeModal);
    uploadModal.addEventListener('click', (e) => {
        if (e.target === uploadModal) closeModal();
    });

    // Reset modal state
    function resetUploadModal() {
        selectedFiles = [];
        fileInput.value = '';
        uploadDropZone.style.display = 'block';
        if (selectedFilesContainer) selectedFilesContainer.style.display = 'none';
        if (progressSection) {
            progressSection.style.display = 'none';
            progressSection.classList.remove('complete', 'error');
        }
        if (progressBar) progressBar.style.width = '0%';
        if (progressPercent) progressPercent.textContent = '0%';
        if (uploadStatusText) uploadStatusText.textContent = 'Uploading...';
        if (uploadSubmitBtn) {
            uploadSubmitBtn.disabled = true;
            uploadSubmitBtn.innerHTML = '<i class="fa-solid fa-upload"></i> Upload';
        }
        if (uploadCancelBtn) {
            uploadCancelBtn.disabled = false;
            uploadCancelBtn.textContent = 'Cancel';
        }
        if (advancedContent) advancedContent.style.display = 'none';
        if (advancedTrigger) {
            advancedTrigger.style.display = 'flex';
            advancedTrigger.classList.remove('open');
        }
    }

    // Click to browse - Dynamic Input Creation to Bypass DOM issues
    uploadDropZone.addEventListener('click', () => {
        console.log('[UPLOAD METHOD] User CLICKED browse area.');
        const dynamicInput = document.createElement('input');
        dynamicInput.type = 'file';
        dynamicInput.multiple = true; // Strictly enforce multiple
        dynamicInput.accept = 'audio/*';
        console.log('[UPLOAD DEBUG] Dynamic input created. Multiple enabled:', dynamicInput.multiple);

        dynamicInput.onchange = (e) => {
            console.log('[UPLOAD DEBUG] Dynamic input change event fired');
            handleFileSelection(e.target.files);
        };

        dynamicInput.click();
    });

    // Drag and drop handlers
    uploadDropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy'; // Explicitly indicate copy action
        uploadDropZone.classList.add('drag-over');
    });

    uploadDropZone.addEventListener('dragleave', () => {
        uploadDropZone.classList.remove('drag-over');
    });

    uploadDropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        uploadDropZone.classList.remove('drag-over');

        console.log('[UPLOAD METHOD] User DROPPED files.');
        console.log('[DROP DEBUG] dataTransfer types:', e.dataTransfer.types);

        let files = e.dataTransfer.files;

        // Advanced Item Inspect (for debugging Windows/Chrome behavior)
        if (e.dataTransfer.items) {
            console.log(`[DROP DEBUG] Items found: ${e.dataTransfer.items.length}`);
            for (let i = 0; i < e.dataTransfer.items.length; i++) {
                const item = e.dataTransfer.items[i];
                console.log(`[DROP DEBUG] Item ${i}: kind=${item.kind}, type=${item.type}`);
            }
        }

        console.log(`[DROP DEBUG] Final files list length: ${files ? files.length : 0}`);
        handleFileSelection(files);
    });

    // File input change (Fallback for native input triggers)
    if (fileInput) {
        fileInput.addEventListener('change', (e) => {
            console.log('[UPLOAD METHOD] Native Input Change (Fallback triggered).');
            console.log('[NATIVE DEBUG] Input multiple status:', fileInput.multiple);
            handleFileSelection(e.target.files);
        });
    }

    // Handle file selection
    function handleFileSelection(files) {
        let fileList = files;
        // Fallback: if files is not provided or empty, try the input directly
        if ((!fileList || fileList.length === 0) && fileInput && fileInput.files.length > 0) {
            console.log('[FILE SELECTION] Using fileInput.files fallback');
            fileList = fileInput.files;
        }

        console.log(`[FILE SELECTION] Processing ${fileList ? fileList.length : 0} files.`);

        if (!fileList || fileList.length === 0) {
            console.warn('[FILE SELECTION] No files to process');
            showToast('Debug: Browser reported 0 files selected.', 'error');
            return;
        }

        // Log all received filenames for debugging
        const fileNames = Array.from(fileList).map(f => f.name).join(', ');
        console.log(`[FILE SELECTION] Files received: ${fileNames}`);

        showToast(`Debug: Received ${fileList.length} files: ${fileList.length > 3 ? fileList.length + ' files' : fileNames}`, 'info');

        const allowedExtensions = ['wav', 'mp3', 'm4a', 'ogg', 'webm', 'flac', 'aac'];
        const newFiles = Array.from(fileList);

        let addedCount = 0;
        for (const file of newFiles) {
            const ext = file.name.split('.').pop().toLowerCase();
            console.log(`[FILE SELECTION] Processing ${file.name} (ext: ${ext}, size: ${file.size})`);

            if (allowedExtensions.includes(ext)) {
                // Check for duplicates
                const isDuplicate = selectedFiles.some(f => f.name === file.name && f.size === file.size);
                if (!isDuplicate) {
                    selectedFiles.push(file);
                    addedCount++;
                    console.log(`[FILE SELECTION] Added ${file.name}`);
                } else {
                    console.warn(`[FILE SELECTION] Duplicate skipped: ${file.name}`);
                    showToast(`Debug: Duplicate skipped: ${file.name}`, 'warning');
                }
            } else {
                console.warn(`[FILE SELECTION] Invalid extension skipped: ${file.name}`);
                showToast(`Debug: Skipped invalid extension: ${file.name}`, 'warning');
            }
        }
        console.log(`[FILE SELECTION] Total added: ${addedCount}. New list size: ${selectedFiles.length}`);

        // Reset input value to allow re-selecting same files if needed
        if (fileInput) fileInput.value = '';

        updateSelectedFilesUI();
    }

    function updateSelectedFilesUI() {
        if (selectedFiles.length === 0) {
            uploadDropZone.style.display = 'block';
            if (selectedFilesContainer) selectedFilesContainer.style.display = 'none';
            uploadSubmitBtn.disabled = true;
            return;
        }

        uploadDropZone.style.display = 'none';
        if (selectedFilesContainer) selectedFilesContainer.style.display = 'block';
        uploadSubmitBtn.disabled = false;
        if (filesCountLabel) filesCountLabel.textContent = `Selected Files (${selectedFiles.length})`;

        if (selectedFilesList) {
            selectedFilesList.innerHTML = '';
            selectedFiles.forEach((file, index) => {
                const item = document.createElement('div');
                item.className = 'file-list-item';
                item.innerHTML = `
                    <div class="file-item-info">
                        <i class="fa-solid fa-file-audio"></i>
                        <div class="file-item-details">
                            <span class="file-item-name">${file.name}</span>
                            <span class="file-item-size">${formatFileSize(file.size)}</span>
                        </div>
                    </div>
                    <div class="file-item-actions">
                        <i class="fa-solid fa-circle-check file-status-icon file-status-pending" id="status-icon-${index}"></i>
                        <button class="btn btn-icon remove-file-item" data-index="${index}">
                            <i class="fa-solid fa-xmark"></i>
                        </button>
                    </div>
                `;
                selectedFilesList.appendChild(item);
            });

            // Add remove listeners
            document.querySelectorAll('.remove-file-item').forEach(btn => {
                btn.onclick = (e) => {
                    e.stopPropagation();
                    const index = parseInt(e.currentTarget.dataset.index);
                    selectedFiles.splice(index, 1);
                    updateSelectedFilesUI();
                };
            });
        }
    }

    // Clear all files
    if (clearAllBtn) {
        clearAllBtn.onclick = () => {
            selectedFiles = [];
            updateSelectedFilesUI();
        };
    }

    // Format file size
    function formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    // Upload submit button
    uploadSubmitBtn.onclick = async () => {
        if (selectedFiles.length === 0) return;

        console.log(`[BATCH UPLOAD] Starting upload for ${selectedFiles.length} files`);
        showToast(`Starting batch upload of ${selectedFiles.length} files...`, 'info');

        // Reset UI for processing
        if (uploadDropZone) uploadDropZone.style.display = 'none';
        if (progressSection) progressSection.style.display = 'block';
        uploadSubmitBtn.disabled = true;
        uploadCancelBtn.disabled = true;
        uploadCancelBtn.textContent = 'Processing...';

        // Hide management buttons during processing
        if (clearAllBtn) clearAllBtn.style.display = 'none';
        document.querySelectorAll('.remove-file-item').forEach(btn => btn.style.display = 'none');

        if (advancedTrigger) advancedTrigger.style.display = 'none';
        if (advancedContent) advancedContent.style.display = 'none';

        const langVal = document.getElementById('upload-language').value;
        const speakersVal = document.getElementById('upload-speakers').value;

        let successCount = 0;
        let failCount = 0;

        // Process batch sequentially
        for (let i = 0; i < selectedFiles.length; i++) {
            const file = selectedFiles[i];
            const batchPercent = Math.round((i / selectedFiles.length) * 100);

            // Update batch UI
            if (batchProgressInfo) {
                batchProgressInfo.querySelector('.batch-status').textContent = `Processing ${i + 1} of ${selectedFiles.length} files`;
                batchProgressInfo.querySelector('.batch-percent').textContent = `${batchPercent}%`;
            }

            // Update individual status icon to processing
            updateFileListItemStatus(i, 'processing');

            // Perform single upload
            const success = await performSingleUpload(file, langVal, speakersVal);

            if (success) {
                successCount++;
                updateFileListItemStatus(i, 'complete');
            } else {
                failCount++;
                updateFileListItemStatus(i, 'error');
                // We continue with other files even if one fails
            }

            // Small delay between files to ensure backend resource cleanup
            if (i < selectedFiles.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }

        // Complete batch
        const total = selectedFiles.length;
        if (failCount === 0) {
            if (progressSection) progressSection.classList.add('complete');
            if (uploadStatusText) uploadStatusText.textContent = `All ${total} files processed successfully!`;
        } else if (successCount > 0) {
            if (progressSection) progressSection.classList.add('complete');
            if (uploadStatusText) uploadStatusText.textContent = `Completed: ${successCount} successful, ${failCount} skipped/failed.`;
        } else {
            if (progressSection) progressSection.classList.add('error');
            if (uploadStatusText) uploadStatusText.textContent = `All ${total} files failed.`;
        }

        if (batchProgressInfo) {
            batchProgressInfo.querySelector('.batch-percent').textContent = '100%';
        }
        if (progressBar) progressBar.style.width = '100%';
        if (progressPercent) progressPercent.textContent = '100%';

        const successMsg = document.getElementById('upload-success-message');
        if (successMsg && successCount > 0) {
            successMsg.style.display = 'flex';
            successMsg.querySelector('span').textContent = failCount === 0
                ? 'All files uploaded and analyzed successfully!'
                : `${successCount} files processed. Check list for individual status.`;
        }

        showToast(`Batch complete: ${successCount} success, ${failCount} fail`, successCount > 0 ? 'success' : 'error');

        uploadCancelBtn.disabled = false;
        uploadCancelBtn.textContent = 'Close';

        // Re-enable UI elements if needed (though we mostly close or show final status)
        if (failCount > 0) {
            // Let them see the errors, but hide the upload button
            uploadSubmitBtn.style.display = 'none';
            fetchCalls();
            if (typeof initializeSentimentChart === 'function') initializeSentimentChart();
        } else {
            // Auto-close only if all were successful
            setTimeout(() => {
                closeModal();
                fetchCalls();
                if (typeof initializeSentimentChart === 'function') initializeSentimentChart();
            }, 3000);
        }
    };

    function updateFileListItemStatus(index, state) {
        const icon = document.getElementById(`status-icon-${index}`);
        if (!icon) return;

        icon.className = 'file-status-icon';
        if (state === 'pending') {
            icon.className = 'fa-solid fa-circle file-status-pending';
        } else if (state === 'processing') {
            icon.className = 'fa-solid fa-spinner fa-spin file-status-processing';
        } else if (state === 'complete') {
            icon.className = 'fa-solid fa-circle-check file-status-complete';
        } else if (state === 'error') {
            icon.className = 'fa-solid fa-circle-xmark file-status-error';
        }
    }

    async function performSingleUpload(file, lang, speakers) {
        // Step elements
        const stepUpload = document.getElementById('step-upload');
        const stepTranscribe = document.getElementById('step-transcribe');
        const stepAnalyze = document.getElementById('step-analyze');
        const stepSave = document.getElementById('step-save');

        const stepElements = {
            'upload': { el: stepUpload, statusId: 'step-upload-status' },
            'transcribe': { el: stepTranscribe, statusId: 'step-transcribe-status' },
            'analyze': { el: stepAnalyze, statusId: 'step-analyze-status' },
            'save': { el: stepSave, statusId: 'step-save-status' }
        };

        function updateStep(stepEl, statusId, state, statusText) {
            if (!stepEl) return;
            stepEl.classList.remove('active', 'complete', 'error');
            if (state) stepEl.classList.add(state);
            const statusEl = document.getElementById(statusId);
            if (statusEl) statusEl.textContent = statusText;

            const indicator = stepEl.querySelector('.step-indicator i');
            if (indicator) {
                if (state === 'active') indicator.className = 'fa-solid fa-spinner fa-spin';
                else if (state === 'complete') indicator.className = 'fa-solid fa-check';
                else if (state === 'error') indicator.className = 'fa-solid fa-xmark';
                else indicator.className = 'fa-solid fa-circle';
            }
        }

        // Initialization for current file
        if (progressFileName) progressFileName.textContent = file.name;
        Object.keys(stepElements).forEach(key => updateStep(stepElements[key].el, stepElements[key].statusId, '', 'Waiting...'));
        updateStep(stepElements['upload'].el, 'step-upload-status', 'active', 'In progress...');
        if (progressBar) progressBar.style.width = '0%';
        if (progressPercent) progressPercent.textContent = '0%';

        const formData = new FormData();
        formData.append('file', file);
        if (lang && lang !== 'auto') formData.append('language', lang);
        if (speakers && parseInt(speakers) > 0) formData.append('speakers', speakers);

        let explicitCompleted = false;

        try {
            const response = await fetch('/api/upload', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                const errorData = await response.json();
                console.error(`[SINGLE UPLOAD] ${file.name} failed with status ${response.status}`, errorData);
                showToast(`Error uploading ${file.name}: ${errorData.error || 'Upload failed'}`, 'error');
                return false;
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        let data;
                        try {
                            data = JSON.parse(line.slice(6));
                        } catch (e) { continue; }

                        if (data.step && stepElements[data.step]) {
                            const { el, statusId } = stepElements[data.step];
                            updateStep(el, statusId, data.status, data.message);
                            if (uploadStatusText) uploadStatusText.textContent = data.message;
                        }

                        // Local progress percent
                        const stepOrder = ['upload', 'transcribe', 'analyze', 'save'];
                        const stepIdx = stepOrder.indexOf(data.step);
                        if (stepIdx >= 0) {
                            let percent = Math.round((stepIdx / stepOrder.length) * 100);
                            if (data.status === 'complete') percent = Math.round(((stepIdx + 1) / stepOrder.length) * 100);
                            else if (data.status === 'active') percent += 5;
                            if (progressBar) progressBar.style.width = percent + '%';
                            if (progressPercent) progressPercent.textContent = percent + '%';
                        }

                        if (data.step === 'done' && data.status === 'success') {
                            explicitCompleted = true;
                            return true;
                        }
                        if (data.status === 'error') {
                            console.error(`[SINGLE UPLOAD] ${file.name} reported error:`, data.message);
                            showToast(`${file.name}: ${data.message}`, 'error');
                            return false;
                        }
                    }
                }
            }
            if (!explicitCompleted) {
                console.warn(`[SINGLE UPLOAD] ${file.name} stream ended without 'done' signal.`);
            }
            return explicitCompleted;
        } catch (err) {
            console.error('[SINGLE UPLOAD] Exception:', err);
            return false;
        }
    }
}

// ============================================
// Fetch Calls Data
// ============================================
// ============================================
// Settings & Helpers
// ============================================
function loadSettings() {
    const defaults = {
        pageSize: '25',
        autoRefresh: '20',
        dateFormat: 'short'
    };
    try {
        const saved = JSON.parse(localStorage.getItem('voxanalyze-settings'));
        return { ...defaults, ...saved };
    } catch (e) { return defaults; }
}

async function syncSettingsFromApi() {
    try {
        const response = await fetch('/api/settings');
        if (response.ok) {
            const apiSettings = await response.json();
            if (Object.keys(apiSettings).length > 0) {
                // Merge with defaults to ensure complete object
                const defaults = {
                    pageSize: '25',
                    autoRefresh: '20',
                    dateFormat: 'short'
                };
                const merged = { ...defaults, ...apiSettings };
                localStorage.setItem('voxanalyze-settings', JSON.stringify(merged));
                console.log('[SETTINGS] Synced from API:', merged);
            }
        }
    } catch (e) {
        console.warn('[SETTINGS] Sync failed:', e);
    }
}

function formatDate(dateStr, format) {
    if (!dateStr) return '--';
    const date = new Date(dateStr);

    if (format === 'relative') return timeAgo(date);
    if (format === 'full') {
        return date.toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }
    // Default 'short'
    return date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function timeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);

    let interval = seconds / 31536000;
    if (interval > 1) return Math.floor(interval) + " years ago";
    interval = seconds / 2592000;
    if (interval > 1) return Math.floor(interval) + " months ago";
    interval = seconds / 86400;
    if (interval > 1) return Math.floor(interval) + " days ago";
    interval = seconds / 3600;
    if (interval > 1) return Math.floor(interval) + " hours ago";
    interval = seconds / 60;
    if (interval > 1) return Math.floor(interval) + " minutes ago";
    return Math.floor(seconds) + " seconds ago";
}

// ============================================
// Fetch Calls Data
// ============================================
const autoRefreshTimerObj = { id: null };

async function fetchCalls(append = false) {
    const loadingState = document.getElementById('loading-state');
    const emptyState = document.getElementById('empty-state');
    const tableContainer = document.querySelector('.table-container');
    const loadMoreContainer = document.getElementById('load-more-container');
    const loadMoreBtn = document.getElementById('load-more-btn');
    const loadMoreSpinner = document.getElementById('load-more-spinner');

    if (!append) {
        currentOffset = 0;
        hasMoreCalls = true;
        if (allCalls.length === 0 && loadingState) loadingState.style.display = 'flex';
    } else {
        if (loadMoreBtn) loadMoreBtn.style.display = 'none';
        if (loadMoreSpinner) loadMoreSpinner.style.display = 'block';
    }

    if (emptyState) emptyState.style.display = 'none';

    try {
        const response = await fetch(`/api/calls?offset=${currentOffset}&limit=${PAGE_SIZE}&_t=${Date.now()}`);
        if (!response.ok) throw new Error('Failed to fetch calls');

        const result = await response.json();
        console.log('[API DEBUG] Fetch result:', result);

        // Defensive check: handle both old (array) and new (object) formats
        let calls = [];
        if (Array.isArray(result)) {
            calls = result;
            totalCallsCount = Math.max(totalCallsCount, result.length);
        } else if (result && typeof result === 'object') {
            calls = result.calls || [];
            totalCallsCount = result.total || 0;
            globalStats = result.stats || null;
        }

        if (append) {
            allCalls = Array.isArray(allCalls) ? [...allCalls, ...calls] : [...calls];
        } else {
            allCalls = Array.isArray(calls) ? calls : [];
        }

        if (allCalls.length >= totalCallsCount) {
            hasMoreCalls = false;
        }

        currentOffset = allCalls.length;

        if (loadingState) loadingState.style.display = 'none';
        if (loadMoreSpinner) loadMoreSpinner.style.display = 'none';

        if (allCalls.length === 0) {
            if (emptyState) emptyState.style.display = 'flex';
            if (tableContainer) tableContainer.style.display = 'none';
            if (loadMoreContainer) loadMoreContainer.style.display = 'none';
        } else {
            if (tableContainer) tableContainer.style.display = 'block';
            if (loadMoreContainer) {
                loadMoreContainer.style.display = hasMoreCalls ? 'block' : 'none';
                if (loadMoreBtn) {
                    loadMoreBtn.style.display = 'inline-block';
                    loadMoreBtn.innerHTML = `<i class="fa-solid fa-chevron-down"></i> Load More (${allCalls.length}/${totalCallsCount})`;
                }
            }

            // Handle Auto-Refresh (only on initial load or reset)
            if (!append) {
                if (autoRefreshTimerObj.id) clearTimeout(autoRefreshTimerObj.id);

                const settings = loadSettings();
                const refreshInterval = parseInt(settings.autoRefresh) || 60;

                if (refreshInterval > 0) {
                    autoRefreshTimerObj.id = setTimeout(() => fetchCalls(false), refreshInterval * 1000);
                }
            }

            applyFilters();
            updateStats(globalStats || allCalls);
            updateTagsCard(globalStats ? globalStats.tag_counts : allCalls);
        }

        // Update call count badge (show the TOTAL count)
        const badge = document.getElementById('call-count-badge');
        if (badge) badge.textContent = totalCallsCount;

    } catch (error) {
        console.error('Error fetching calls:', error);
        if (loadingState) loadingState.style.display = 'none';
        if (loadMoreSpinner) loadMoreSpinner.style.display = 'none';

        // Retry auto-refresh even on error after delay
        if (!append) {
            if (autoRefreshTimerObj.id) clearTimeout(autoRefreshTimerObj.id);
            autoRefreshTimerObj.id = setTimeout(() => fetchCalls(false), 60000);
        }
    }
}

// ============================================
// Render Table
// ============================================
// ============================================
// Render Table
// ============================================
function renderTable(callsInput) {
    const tbody = document.getElementById('calls-table-body');

    if (!tbody) return;
    if (!Array.isArray(callsInput)) {
        console.error('[ERROR] renderTable: callsInput is not an array:', callsInput);
        return;
    }

    tbody.innerHTML = '';

    // Apply Pagination Limit
    const settings = loadSettings();
    const limit = parseInt(settings.pageSize) || 25;
    const calls = callsInput.slice(0, limit);

    if (calls.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" style="text-align: center; padding: 40px; color: var(--text-secondary);">
                    No calls match your search criteria
                </td>
            </tr>
        `;
        return;
    }

    calls.forEach((call, index) => {
        const row = document.createElement('tr');

        // Add animation class and staggered delay
        row.classList.add('row-animate');
        row.style.animationDelay = `${index * 50}ms`;

        // Format sentiment
        const sentimentLower = (call.sentiment || 'neutral').toLowerCase();
        let sentimentIcon = 'fa-minus';
        let sentimentClass = 'neutral';

        if (sentimentLower === 'positive') {
            sentimentIcon = 'fa-face-smile';
            sentimentClass = 'positive';
        } else if (sentimentLower === 'negative') {
            sentimentIcon = 'fa-face-frown';
            sentimentClass = 'negative';
        }

        // Format tags (show only first tag for compact display)
        const tags = call.tags || [];
        const firstTag = tags.length > 0 ? tags[0] : 'None';
        let tagClass = 'default';
        const lower = firstTag.toLowerCase();
        if (lower.includes('bill')) tagClass = 'billing';
        if (lower.includes('support') || lower.includes('help')) tagClass = 'support';
        if (lower.includes('churn') || lower.includes('cancel')) tagClass = 'churn';
        const tagsHtml = `<span class="tag ${tagClass}">${escapeHtml(firstTag)}</span>` +
            (tags.length > 1 ? `<span class="tag default">+${tags.length - 1}</span>` : '');

        // Format date using Settings
        const dateStr = formatDate(call.created_at, settings.dateFormat);

        // Format duration
        let durationFormatted = '--:--';
        if (call.duration && call.duration > 0) {
            const minutes = Math.floor(call.duration / 60);
            const seconds = call.duration % 60;
            durationFormatted = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        }

        // Format email status
        let emailBadgeClass = 'pending';
        let emailIcon = 'fa-clock';
        let emailText = 'Pending';

        if (call.email_sent === true) {
            emailBadgeClass = 'sent';
            emailIcon = 'fa-check';
            emailText = 'Sent';
        } else if (call.email_sent === false) {
            emailBadgeClass = 'failed';
            emailIcon = 'fa-xmark';
            emailText = 'Failed';
        }

        row.innerHTML = `
            <td>
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span class="filename-cell" title="${escapeHtml(call.filename || 'Unknown')}" onclick="showFilenamePopup('${escapeHtml(call.filename || 'Unknown').replace(/'/g, "\\'")}', event)">${escapeHtml(call.filename || 'Unknown')}</span>
                </div>
            </td>
            <td>${dateStr}</td>
            <td>
                <span class="duration-badge">
                    <i class="fa-solid fa-clock"></i>
                    ${durationFormatted}
                </span>
            </td>
            <td>
                <span class="sentiment-badge ${sentimentClass}">
                    <i class="fa-solid ${sentimentIcon}"></i>
                    ${call.sentiment || 'Neutral'}
                </span>
            </td>
            <td>
                <div class="tags-cell">${tagsHtml}</div>
            </td>
            <td>
                <button class="summary-btn" onclick="openSummaryModal(${call.id})">
                    <i class="fa-solid fa-file-lines"></i>
                    View
                </button>
            </td>
            <td>
                <span class="email-badge ${emailBadgeClass}">
                    <i class="fa-solid ${emailIcon}"></i>
                    ${emailText}
                </span>
            </td>
            <td>
                <div style="display: flex; align-items: center; gap: 8px;">
                    <button class="action-btn" onclick="openModal(${call.id})">
                        <i class="fa-solid fa-eye"></i>
                        Details
                    </button>
                    <div class="action-menu-container">
                        <button class="action-btn" onclick="toggleActionMenu(event, '${call.id}')">
                            <i class="fa-solid fa-ellipsis-vertical"></i>
                        </button>
                        <div class="action-dropdown" id="action-menu-${call.id}">
                            <button class="action-item delete-item" onclick="openDeleteModal('${call.id}')">
                                <i class="fa-solid fa-trash-can"></i> Delete
                            </button>
                        </div>
                    </div>
                </div>
            </td>
        `;

        // Make entire row clickable
        row.classList.add('clickable-row');
        row.dataset.callId = call.id;

        // Add click handler to row
        row.addEventListener('click', (e) => {
            // Don't open modal if clicking on buttons or interactive elements
            if (e.target.closest('button') ||
                e.target.closest('.action-menu-container') ||
                e.target.closest('.action-dropdown')) {
                return;
            }
            openModal(call.id);
        });

        tbody.appendChild(row);
    });

    // Close action menus when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.action-menu-container')) {
            document.querySelectorAll('.action-dropdown.active').forEach(menu => {
                menu.classList.remove('active');
                menu.closest('.action-menu-container')?.classList.remove('active');
                // Reset z-index of the row
                const tr = menu.closest('tr');
                if (tr) {
                    tr.style.position = '';
                    tr.style.zIndex = '';
                }
            });
        }
    });
}

function toggleActionMenu(event, callId) {
    event.stopPropagation();

    const menu = document.getElementById(`action-menu-${callId}`);
    const container = event.target.closest('.action-menu-container');

    // Close others and remove active from their containers
    document.querySelectorAll('.action-dropdown.active').forEach(m => {
        if (m.id !== `action-menu-${callId}`) {
            m.classList.remove('active');
            m.closest('.action-menu-container')?.classList.remove('active');
            // Reset z-index of the row
            const tr = m.closest('tr');
            if (tr) {
                tr.style.position = '';
                tr.style.zIndex = '';
            }
        }
    });

    // Toggle current menu and container
    if (menu) {
        const isActive = menu.classList.toggle('active');

        // Handle row z-index to ensure menu appears above other rows
        const tr = container ? container.closest('tr') : null;

        if (isActive) {
            if (tr) {
                tr.style.position = 'relative';
                tr.style.zIndex = '100';
            }
        } else {
            if (tr) {
                tr.style.position = '';
                tr.style.zIndex = '';
            }
        }

        if (container) {
            container.classList.toggle('active');
        }
    }
}

// ============================================
// Delete Call Functionality
// ============================================
const adminVerifyModal = document.getElementById('admin-verify-modal');
const adminVerifyClose = document.getElementById('admin-verify-close');
const adminVerifyCancel = document.getElementById('admin-verify-cancel');
const adminVerifyConfirm = document.getElementById('admin-verify-confirm');
const adminPasswordInput = document.getElementById('admin-password');
const deleteCallIdInput = document.getElementById('delete-call-id');

function openDeleteModal(callId) {
    if (adminVerifyModal) {
        deleteCallIdInput.value = callId;
        adminPasswordInput.value = ''; // Clear previous password
        adminVerifyModal.style.display = 'flex';
        // Close action menu
        document.getElementById(`action-menu-${callId}`)?.classList.remove('active');
    }
}

function closeDeleteModal() {
    if (adminVerifyModal) {
        adminVerifyModal.style.display = 'none';
        deleteCallIdInput.value = '';
        adminPasswordInput.value = '';
    }
}

if (adminVerifyClose) adminVerifyClose.addEventListener('click', closeDeleteModal);
if (adminVerifyCancel) adminVerifyCancel.addEventListener('click', closeDeleteModal);

if (adminVerifyConfirm) {
    adminVerifyConfirm.addEventListener('click', async () => {
        const callId = deleteCallIdInput.value;
        const password = adminPasswordInput.value;

        if (!password) {
            showToast('Please enter admin password', 'error');
            return;
        }

        // Disable button and show loading
        const originalBtnText = adminVerifyConfirm.innerHTML;
        adminVerifyConfirm.disabled = true;
        adminVerifyConfirm.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Verifying...';

        try {
            const response = await fetch('/api/admin/delete-call', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    call_id: callId,
                    password: password
                })
            });

            const result = await response.json();

            if (response.ok && result.success) {
                showToast('Call deleted successfully', 'success');
                closeDeleteModal();
                // Refresh list
                await fetchCalls();
                initializeSentimentChart(); // Update charts
            } else {
                showToast(result.error || 'Delete failed', 'error');
            }
        } catch (error) {
            console.error('Delete error:', error);
            showToast('Network error occurred', 'error');
        } finally {
            adminVerifyConfirm.disabled = false;
            adminVerifyConfirm.innerHTML = originalBtnText;
        }
    });

}
// Update Stats
// ============================================
function updateStats(data) {
    const totalEl = document.getElementById('total-calls');
    const positiveEl = document.getElementById('positive-percent');
    const negativeEl = document.getElementById('negative-percent');
    const durationEl = document.getElementById('avg-duration');

    if (!data) return;

    // Total calls - Use the total count from DB
    if (totalEl) {
        animateCounter(totalEl, totalCallsCount);
    }

    let positivePercent = 0;
    let negativePercent = 0;
    let avgSeconds = 0;

    if (Array.isArray(data)) {
        // Fallback: Local calculation from provided array
        const positiveCount = data.filter(c => (c.sentiment || '').toLowerCase() === 'positive').length;
        positivePercent = data.length > 0 ? Math.round((positiveCount / data.length) * 100) : 0;

        const negativeCount = data.filter(c => (c.sentiment || '').toLowerCase() === 'negative').length;
        negativePercent = data.length > 0 ? Math.round((negativeCount / data.length) * 100) : 0;

        const callsWithDuration = data.filter(c => c.duration && c.duration > 0);
        avgSeconds = callsWithDuration.length > 0 ?
            Math.round(callsWithDuration.reduce((sum, c) => sum + (c.duration || 0), 0) / callsWithDuration.length) : 0;
    } else if (typeof data === 'object') {
        // Global stats from backend
        const total = totalCallsCount || 1;
        const posCount = (data.sentiment && data.sentiment.positive) || 0;
        const negCount = (data.sentiment && data.sentiment.negative) || 0;

        positivePercent = Math.round((posCount / total) * 100);
        negativePercent = Math.round((negCount / total) * 100);
        avgSeconds = Math.round(data.avg_duration || 0);
    }

    if (positiveEl) animateCounter(positiveEl, positivePercent, '%');
    if (negativeEl) animateCounter(negativeEl, negativePercent, '%');

    if (durationEl) {
        if (avgSeconds > 0) {
            const minutes = Math.floor(avgSeconds / 60);
            const seconds = avgSeconds % 60;
            durationEl.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        } else {
            durationEl.textContent = '--:--';
        }
    }
}

// ============================================
// Update Tags Card
// ============================================
function updateTagsCard(data) {
    if (!data) return;

    let tagCounts = {
        'Support': 0,
        'Billing': 0,
        'Technical': 0
    };

    if (Array.isArray(data)) {
        // Fallback: Calculate from provided array
        data.forEach(call => {
            const tags = call.tags || [];
            tags.forEach(tag => {
                const lower = tag.toLowerCase();
                if (lower.includes('support') || lower.includes('help')) tagCounts['Support']++;
                if (lower.includes('bill') || lower.includes('payment') || lower.includes('invoice')) tagCounts['Billing']++;
                if (lower.includes('technical') || lower.includes('issue') || lower.includes('error') || lower.includes('bug')) tagCounts['Technical']++;
            });
        });
    } else if (typeof data === 'object') {
        // use backend-provided counts
        tagCounts = {
            'Support': data.Support || 0,
            'Billing': data.Billing || 0,
            'Technical': data.Technical || 0
        };
    }

    const maxCount = Math.max(...Object.values(tagCounts), 1);

    // Update each tag element
    const tagMapping = {
        'Support': { count: 'support-count', bar: 'support-bar' },
        'Billing': { count: 'billing-count', bar: 'billing-bar' },
        'Technical': { count: 'technical-count', bar: 'technical-bar' }
    };

    Object.entries(tagCounts).forEach(([name, count]) => {
        const mapping = tagMapping[name];
        if (mapping) {
            const countEl = document.getElementById(mapping.count);
            const barEl = document.getElementById(mapping.bar);

            if (countEl) countEl.textContent = count;
            if (barEl) {
                const percentage = (count / maxCount) * 100;
                barEl.style.width = `${percentage}%`;
            }
        }
    });
}

// ============================================
// Sentiment Chart
// ============================================
function initializeSentimentChart() {
    const canvas = document.getElementById('sentiment-chart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');

    // Count sentiments
    let positive = 0, neutral = 0, negative = 0;

    if (globalStats && globalStats.sentiment) {
        positive = globalStats.sentiment.positive || 0;
        neutral = globalStats.sentiment.neutral || 0;
        negative = globalStats.sentiment.negative || 0;
    } else {
        // Fallback to local data
        if (!Array.isArray(allCalls)) {
            console.error('[ERROR] allCalls is not an array:', allCalls);
            allCalls = [];
        }

        allCalls.forEach(call => {
            const sentiment = (call.sentiment || 'neutral').toLowerCase();
            if (sentiment === 'positive') positive++;
            else if (sentiment === 'negative') negative++;
            else neutral++;
        });
    }

    // Destroy existing chart
    if (sentimentChart) {
        sentimentChart.destroy();
    }

    // Create new chart
    sentimentChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Positive', 'Neutral', 'Negative'],
            datasets: [{
                data: [positive, neutral, negative],
                backgroundColor: [
                    '#10b981', // Green
                    '#64748b', // Gray
                    '#ef4444'  // Red
                ],
                borderWidth: 0,
                hoverOffset: 8
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '70%',
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    backgroundColor: 'white',
                    titleColor: '#0f172a',
                    bodyColor: '#475569',
                    borderColor: '#e2e8f0',
                    borderWidth: 1,
                    padding: 12,
                    boxPadding: 6,
                    usePointStyle: true,
                    callbacks: {
                        label: function (context) {
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const percentage = total > 0 ?
                                Math.round((context.raw / total) * 100) : 0;
                            return `${context.label}: ${context.raw} (${percentage}%)`;
                        }
                    }
                }
            },
            animation: {
                animateScale: true,
                animateRotate: true
            }
        }
    });
}

// ============================================
// Modal Functions
// ============================================
window.openModal = function (callId) {
    const modal = document.getElementById('transcript-modal');
    const modalFilename = document.getElementById('modal-filename');
    const modalText = document.getElementById('modal-text');
    const modalDate = document.getElementById('modal-date');
    const modalSentiment = document.getElementById('modal-sentiment');
    const modalTags = document.getElementById('modal-tags');
    const modalSummary = document.getElementById('modal-summary');
    const modalAudio = document.getElementById('modal-audio');
    const audioStatus = document.getElementById('audio-status');

    // Find call data
    const call = allCalls.find(c => c.id === callId);

    if (!call) {
        showToast('Call not found', 'error');
        return;
    }

    // Populate modal
    if (modalFilename) {
        modalFilename.textContent = call.filename || 'Unknown';
        // Add title attribute to show full filename on hover
        modalFilename.title = call.filename || 'Unknown';
    }

    // Populate transcript with diarization if available
    if (modalText) {
        const diarizationData = call.diarization_data || [];
        const speakerCount = call.speaker_count || 0;

        // Debug: Log what data we have
        console.log('[DIARIZATION DEBUG] call.diarization_data:', call.diarization_data);
        console.log('[DIARIZATION DEBUG] call.speaker_count:', call.speaker_count);
        console.log('[DIARIZATION DEBUG] diarizationData length:', diarizationData.length);

        // Show speaker count badge next to filename
        const speakerBadge = document.getElementById('speaker-badge-display');
        const speakerCountText = document.getElementById('speaker-count-text');

        if (speakerBadge && speakerCount > 0) {
            speakerCountText.textContent = `${speakerCount} Speaker${speakerCount > 1 ? 's' : ''}`;
            speakerBadge.style.display = 'inline-flex';
        } else if (speakerBadge) {
            speakerBadge.style.display = 'none';
        }

        if (diarizationData.length > 0) {
            // Build speaker-labeled transcript
            let transcriptHtml = '';

            transcriptHtml += '<div class="diarized-transcript">';

            // Create a map to convert A, B, C... to Speaker 1, Speaker 2, Speaker 3...
            const speakerMap = {};
            let speakerIndex = 1;

            diarizationData.forEach((utterance, idx) => {
                const originalSpeaker = utterance.speaker || 'Unknown';

                // Use saved display_name if available, otherwise map to Speaker N format
                let displaySpeaker;
                if (utterance.display_name) {
                    displaySpeaker = utterance.display_name;
                } else {
                    // Map original speaker ID to Speaker N format
                    if (!speakerMap[originalSpeaker]) {
                        speakerMap[originalSpeaker] = `Speaker ${speakerIndex}`;
                        speakerIndex++;
                    }
                    displaySpeaker = speakerMap[originalSpeaker];
                }

                const timestamp = formatTimestamp(utterance.start);
                const speakerClass = getSpeakerClass(originalSpeaker);
                const startTimeMs = utterance.start || 0;

                transcriptHtml += `
                    <div class="utterance-line" data-index="${idx}">
                        <span class="utterance-timestamp clickable-timestamp" data-time="${startTimeMs}" title="Click to jump to this point">[${timestamp}]</span>
                        <span class="speaker-label ${speakerClass}" contenteditable="true" data-original="${escapeHtml(originalSpeaker)}">${escapeHtml(displaySpeaker)}</span>
                        <span class="utterance-text" contenteditable="true" dir="auto">${escapeHtml(utterance.text)}</span>
                    </div>
                `;
            });

            transcriptHtml += '</div>';
            modalText.innerHTML = transcriptHtml;

            // Setup speaker name auto-update listeners with save functionality
            setupSpeakerEditListeners(call.id, diarizationData);

            // Setup transcript text edit listeners with save functionality
            setupTranscriptTextEditListeners(call.id, diarizationData);

            // Setup timestamp click listeners to seek audio
            setupTimestampClickListeners();
        } else {
            // Fallback to plain transcript
            modalText.innerHTML = `<p dir="auto">${escapeHtml(call.transcript || 'No transcript available')}</p>`;
        }
    }

    // Populate summary
    if (modalSummary) {
        const summaryText = call.summary || 'No summary available';

        // Try to parse as JSON for structured summary
        let summaryHtml = '';
        try {
            const summaryData = JSON.parse(summaryText);

            // Build structured summary HTML with translation button
            summaryHtml = '<div class="structured-summary">';

            // Add translation header (same as Minutes tab)
            summaryHtml += '<div class="summary-translate-header">';
            summaryHtml += '<h4 class="summary-main-title">Call Summary</h4>';
            summaryHtml += `
                <div class="summary-translate-dropdown">
                    <button class="summary-translate-btn" onclick="toggleSummaryTranslate(event)">
                        <i class="fa-solid fa-language"></i>
                        <span>Translate</span>
                        <i class="fa-solid fa-chevron-down"></i>
                    </button>
                    <div class="summary-translate-menu" id="summary-translate-menu">
                        <button class="translate-option" onclick="translateSummary(${call.id}, 'en', event)">
                            <span class="lang-flag">🇬🇧</span>
                            English
                        </button>
                        <button class="translate-option" onclick="translateSummary(${call.id}, 'ml', event)">
                            <span class="lang-flag">🇮🇳</span>
                            Malayalam
                        </button>
                        <button class="translate-option" onclick="translateSummary(${call.id}, 'hi', event)">
                            <span class="lang-flag">🇮🇳</span>
                            Hindi
                        </button>
                        <button class="translate-option" onclick="translateSummary(${call.id}, 'ar', event)">
                            <span class="lang-flag">🇸🇦</span>
                            Arabic
                        </button>
                    </div>
                </div>
            `;
            summaryHtml += '</div>';

            // Overview section
            if (summaryData.overview) {
                summaryHtml += `
                    <div class="summary-section overview-section">
                        <div class="summary-section-header">
                            <i class="fa-solid fa-lightbulb"></i>
                            <strong>Overview</strong>
                        </div>
                        <p class="summary-overview">${escapeHtml(summaryData.overview)}</p>
                    </div>
                `;
            }

            // Key Points section
            if (summaryData.key_points && summaryData.key_points.length > 0) {
                summaryHtml += `
                    <div class="summary-section key-points-section">
                        <div class="summary-section-header">
                            <i class="fa-solid fa-list-check"></i>
                            <strong>Key Points</strong>
                        </div>
                        <ul class="key-points-list">
                            ${summaryData.key_points.map(point => `<li>${escapeHtml(point)}</li>`).join('')}
                        </ul>
                    </div>
                `;
            }

            // Caller Intent section
            if (summaryData.caller_intent) {
                summaryHtml += `
                    <div class="summary-section">
                        <div class="summary-section-header">
                            <i class="fa-solid fa-bullseye"></i>
                            <strong>What the Caller Wanted</strong>
                        </div>
                        <p>${escapeHtml(summaryData.caller_intent)}</p>
                    </div>
                `;
            }

            // Issue Details section
            if (summaryData.issue_details) {
                summaryHtml += `
                    <div class="summary-section">
                        <div class="summary-section-header">
                            <i class="fa-solid fa-exclamation-circle"></i>
                            <strong>Issue / Topic</strong>
                        </div>
                        <p>${escapeHtml(summaryData.issue_details)}</p>
                    </div>
                `;
            }

            // Resolution section
            if (summaryData.resolution) {
                summaryHtml += `
                    <div class="summary-section resolution-section">
                        <div class="summary-section-header">
                            <i class="fa-solid fa-check-circle"></i>
                            <strong>Resolution / Outcome</strong>
                        </div>
                        <p>${escapeHtml(summaryData.resolution)}</p>
                    </div>
                `;
            }

            // Action Items section
            if (summaryData.action_items && summaryData.action_items.length > 0) {
                summaryHtml += `
                    <div class="summary-section action-items-section">
                        <div class="summary-section-header">
                            <i class="fa-solid fa-tasks"></i>
                            <strong>Next Steps / Action Items</strong>
                        </div>
                        <ul class="action-items-list">
                            ${summaryData.action_items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}
                        </ul>
                    </div>
                `;
            }

            // Tone section
            if (summaryData.tone) {
                const toneClass = getToneClass(summaryData.tone);
                summaryHtml += `
                    <div class="summary-section tone-section">
                        <div class="summary-section-header">
                            <i class="fa-solid fa-comment"></i>
                            <strong>Conversation Tone</strong>
                        </div>
                        <span class="tone-badge ${toneClass}">${escapeHtml(summaryData.tone)}</span>
                    </div>
                `;
            }

            summaryHtml += '</div>';
        } catch (e) {
            // Not JSON, display as plain text (backward compatibility)
            summaryHtml = `<p>${escapeHtml(summaryText)}</p>`;
        }

        modalSummary.innerHTML = summaryHtml;
    }

    if (modalDate && call.created_at) {
        modalDate.textContent = new Date(call.created_at).toLocaleString();
    }

    if (modalSentiment) {
        modalSentiment.textContent = call.sentiment || 'Neutral';
    }

    if (modalTags) {
        modalTags.innerHTML = (call.tags || []).map(tag => {
            let tagClass = 'default';
            const lower = tag.toLowerCase();
            if (lower.includes('bill')) tagClass = 'billing';
            if (lower.includes('support')) tagClass = 'support';
            if (lower.includes('churn')) tagClass = 'churn';
            return `<span class="tag ${tagClass}">${escapeHtml(tag)}</span>`;
        }).join('');
    }

    // Setup audio player
    if (modalAudio) {
        if (call.audio_url) {
            modalAudio.src = call.audio_url;
            modalAudio.style.display = 'block';
            if (audioStatus) {
                audioStatus.innerHTML = '<i class="fa-solid fa-headphones"></i> Listen to Call';
            }
        } else {
            modalAudio.src = '';
            modalAudio.style.display = 'none';
            if (audioStatus) {
                audioStatus.innerHTML = '<i class="fa-solid fa-volume-xmark"></i> Audio not available';
                audioStatus.style.color = 'var(--text-muted)';
            }
        }
    }

    // Populate Meeting Minutes tab
    const modalMinutes = document.getElementById('modal-minutes');
    if (modalMinutes) {
        let minutesHtml = '';
        const summaryText = call.summary || '';
        let summaryData = null;

        // Try to parse summary as JSON
        try {
            summaryData = JSON.parse(summaryText);
        } catch (e) {
            // Not JSON format
        }

        minutesHtml = '<div class="meeting-minutes">';

        // Meeting info header with translation button
        minutesHtml += '<div class="minutes-header">';
        minutesHtml += '<h5 class="minutes-title">Minutes of Meeting</h5>';
        minutesHtml += `
            <div class="minutes-translate-dropdown">
                <button class="minutes-translate-btn" onclick="toggleMinutesTranslate(event)">
                    <i class="fa-solid fa-language"></i>
                    <span>Translate</span>
                    <i class="fa-solid fa-chevron-down"></i>
                </button>
                <div class="minutes-translate-menu" id="minutes-translate-menu">
                    <button class="translate-option" onclick="translateMinutes(${call.id}, 'en', event)">
                        <span class="lang-flag">🇬🇧</span>
                        English
                    </button>
                    <button class="translate-option" onclick="translateMinutes(${call.id}, 'ml', event)">
                        <span class="lang-flag">🇮🇳</span>
                        Malayalam
                    </button>
                    <button class="translate-option" onclick="translateMinutes(${call.id}, 'hi', event)">
                        <span class="lang-flag">🇮🇳</span>
                        Hindi
                    </button>
                    <button class="translate-option" onclick="translateMinutes(${call.id}, 'ar', event)">
                        <span class="lang-flag">🇸🇦</span>
                        Arabic
                    </button>
                </div>
            </div>
        `;
        minutesHtml += '</div>';

        // Date and Time section
        minutesHtml += '<div class="minutes-meta">';

        // Date - Extract from conversation summary if mentioned, otherwise show Not specified
        let meetingDate = '[Not specified]';
        if (summaryData && summaryData.meeting_date) {
            // If LLM extracted a date from the conversation
            meetingDate = summaryData.meeting_date;
        } else if (summaryData && summaryData.date) {
            meetingDate = summaryData.date;
        }
        // Check for null or empty values
        if (!meetingDate || meetingDate === 'null' || meetingDate === 'NULL' || meetingDate.trim() === '') {
            meetingDate = '[Not specified]';
        }
        // Don't fall back to created_at - only show dates mentioned in the conversation
        minutesHtml += `
            <div class="minutes-meta-item">
                <span class="minutes-label">Date:</span>
                <span class="minutes-value">${escapeHtml(meetingDate)}</span>
            </div>
        `;

        // Time - Extract from conversation summary if mentioned, otherwise show Not specified
        let meetingTime = '[Not specified]';
        if (summaryData && summaryData.meeting_time) {
            // If LLM extracted a time from the conversation
            meetingTime = summaryData.meeting_time;
        } else if (summaryData && summaryData.time) {
            meetingTime = summaryData.time;
        }
        // Check for null or empty values
        if (!meetingTime || meetingTime === 'null' || meetingTime === 'NULL' || meetingTime.trim() === '') {
            meetingTime = '[Not specified]';
        }
        // Don't fall back to created_at - only show times mentioned in the conversation
        minutesHtml += `
            <div class="minutes-meta-item">
                <span class="minutes-label">Time:</span>
                <span class="minutes-value">${escapeHtml(meetingTime)}</span>
            </div>
        `;

        // Duration
        let durationText = '[Not specified]';
        if (call.duration && call.duration > 0) {
            const minutes = Math.floor(call.duration / 60);
            const seconds = call.duration % 60;
            if (minutes > 0) {
                durationText = `${minutes} minute${minutes !== 1 ? 's' : ''}`;
                if (seconds > 0) {
                    durationText += ` ${seconds} second${seconds !== 1 ? 's' : ''}`;
                }
            } else {
                durationText = `${seconds} second${seconds !== 1 ? 's' : ''}`;
            }
        }
        minutesHtml += `
            <div class="minutes-meta-item">
                <span class="minutes-label">Duration:</span>
                <span class="minutes-value">${escapeHtml(durationText)}</span>
            </div>
        `;

        minutesHtml += '</div>'; // End minutes-meta

        // Attendees section
        minutesHtml += '<div class="minutes-section">';
        minutesHtml += '<h6><i class="fa-solid fa-users"></i> Attendees:</h6>';

        const diarizationData = call.diarization_data || [];
        const speakerCount = call.speaker_count || 0;

        if (speakerCount > 0 || diarizationData.length > 0) {
            // Extract unique speaker names from diarization data
            const uniqueSpeakers = new Set();
            const speakerMap = {};
            let speakerIndex = 1;

            diarizationData.forEach(utterance => {
                const originalSpeaker = utterance.speaker || 'Unknown';
                let displayName = utterance.display_name;
                if (!displayName) {
                    if (!speakerMap[originalSpeaker]) {
                        speakerMap[originalSpeaker] = `Speaker ${speakerIndex}`;
                        speakerIndex++;
                    }
                    displayName = speakerMap[originalSpeaker];
                }
                uniqueSpeakers.add(displayName);
            });

            if (uniqueSpeakers.size > 0) {
                minutesHtml += '<ul class="attendees-list">';
                uniqueSpeakers.forEach(speaker => {
                    minutesHtml += `<li>${escapeHtml(speaker)}</li>`;
                });
                minutesHtml += '</ul>';
            } else {
                minutesHtml += `<p class="minutes-placeholder">${speakerCount} participant${speakerCount !== 1 ? 's' : ''} (names not specified)</p>`;
            }
        } else {
            minutesHtml += '<p class="minutes-placeholder">[Not specified]</p>';
        }
        minutesHtml += '</div>';

        // Subject section
        minutesHtml += '<div class="minutes-section">';
        minutesHtml += '<h6><i class="fa-solid fa-bookmark"></i> Subject:</h6>';

        let subject = '[Not specified]';
        if (summaryData) {
            if (summaryData.caller_intent) {
                subject = summaryData.caller_intent;
            } else if (summaryData.overview) {
                // Extract first line or sentence as subject
                const overview = summaryData.overview;
                subject = overview.split('.')[0] || overview.substring(0, 100);
            }
        }
        minutesHtml += `<p class="minutes-subject">${escapeHtml(subject)}</p>`;
        minutesHtml += '</div>';

        // Meeting content sections
        if (summaryData) {
            // 1. Overview / Opening
            if (summaryData.overview) {
                minutesHtml += '<div class="minutes-section">';
                minutesHtml += '<h6><i class="fa-solid fa-play-circle"></i> 1. Opening and Context:</h6>';
                minutesHtml += `<p>${escapeHtml(summaryData.overview)}</p>`;
                minutesHtml += '</div>';
            }

            // 2. Key Discussion Points
            if (summaryData.key_points && summaryData.key_points.length > 0) {
                minutesHtml += '<div class="minutes-section">';
                minutesHtml += '<h6><i class="fa-solid fa-list-ol"></i> 2. Key Discussion Points:</h6>';
                minutesHtml += '<ol class="minutes-points-list">';
                summaryData.key_points.forEach((point, idx) => {
                    minutesHtml += `<li>${escapeHtml(point)}</li>`;
                });
                minutesHtml += '</ol>';
                minutesHtml += '</div>';
            }

            // 3. Issue Identification
            if (summaryData.issue_details) {
                minutesHtml += '<div class="minutes-section">';
                minutesHtml += '<h6><i class="fa-solid fa-exclamation-triangle"></i> 3. Issue Identification:</h6>';
                minutesHtml += `<p>${escapeHtml(summaryData.issue_details)}</p>`;
                minutesHtml += '</div>';
            }

            // 4. Resolution / Outcome
            if (summaryData.resolution) {
                minutesHtml += '<div class="minutes-section">';
                minutesHtml += '<h6><i class="fa-solid fa-check-circle"></i> 4. Resolution / Outcome:</h6>';
                minutesHtml += `<p>${escapeHtml(summaryData.resolution)}</p>`;
                minutesHtml += '</div>';
            }

            // 5. Action Items / Next Steps
            if (summaryData.action_items && summaryData.action_items.length > 0) {
                minutesHtml += '<div class="minutes-section">';
                minutesHtml += '<h6><i class="fa-solid fa-tasks"></i> 5. Action Items / Next Steps:</h6>';
                minutesHtml += '<ul class="minutes-action-list">';
                summaryData.action_items.forEach((item, idx) => {
                    minutesHtml += `<li>${escapeHtml(item)}</li>`;
                });
                minutesHtml += '</ul>';
                minutesHtml += '</div>';
            }

            // Conversation Tone (if available)
            if (summaryData.tone) {
                minutesHtml += '<div class="minutes-section minutes-tone">';
                minutesHtml += '<h6><i class="fa-solid fa-comment"></i> Meeting Tone:</h6>';
                const toneClass = getToneClass(summaryData.tone);
                minutesHtml += `<span class="tone-badge ${toneClass}">${escapeHtml(summaryData.tone)}</span>`;
                minutesHtml += '</div>';
            }
        } else if (summaryText && summaryText.trim()) {
            // Fallback: show raw summary as the meeting discussion
            minutesHtml += '<div class="minutes-section">';
            minutesHtml += '<h6><i class="fa-solid fa-comments"></i> Meeting Discussion:</h6>';
            minutesHtml += `<p>${escapeHtml(summaryText)}</p>`;
            minutesHtml += '</div>';
        } else {
            minutesHtml += '<div class="minutes-section">';
            minutesHtml += '<p class="minutes-placeholder">No detailed meeting content available.</p>';
            minutesHtml += '</div>';
        }

        minutesHtml += '</div>'; // End meeting-minutes

        modalMinutes.innerHTML = minutesHtml;
    }

    // Show modal
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    // Reset to first tab (Summary)
    const modalTabs = document.querySelectorAll('.modal-tab');
    const tabContents = document.querySelectorAll('.tab-content');
    modalTabs.forEach((t, i) => t.classList.toggle('active', i === 0));
    tabContents.forEach((c, i) => c.classList.toggle('active', i === 0));

    // Setup copy button
    setupCopyButton(call.transcript);

    // Setup translation button
    setupTranslationButton(call);
};

// Setup translation button handler
function setupTranslationButton(call) {
    const translateBtn = document.getElementById('translate-btn');
    const languageSelect = document.getElementById('translation-language');
    const translationOutput = document.getElementById('modal-translation');

    if (translateBtn) {
        translateBtn.onclick = async () => {
            const language = languageSelect?.value || 'es';

            // Show loading state
            translateBtn.disabled = true;
            translateBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Translating...';
            translationOutput.innerHTML = '<p class="translation-loading"><i class="fa-solid fa-globe fa-spin"></i> Translating transcript...</p>';

            try {
                // Debug: Log what we're sending to the server
                console.log('[TRANSLATION DEBUG] Sending diarization_data:', call.diarization_data);
                console.log('[TRANSLATION DEBUG] diarization_data length:', call.diarization_data?.length || 0);

                const response = await fetch('/api/translate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        transcript: call.transcript || '',
                        language: language,
                        diarization_data: call.diarization_data || [],
                        call_id: call.id
                    })
                });

                const result = await response.json();

                // Debug: Log what we received from the server
                console.log('[TRANSLATION DEBUG] Response:', result);
                console.log('[TRANSLATION DEBUG] has_diarization:', result.has_diarization);
                console.log('[TRANSLATION DEBUG] translated_diarization:', result.translated_diarization);
                console.log('[TRANSLATION DEBUG] Original call diarization_data:', call.diarization_data);

                if (result.success) {
                    // Build formatted translation output
                    let translationHtml = `
                        <div class="translation-header">
                            <span class="translation-language-badge">
                                <i class="fa-solid fa-globe"></i>
                                Translated to ${result.language}
                            </span>
                        </div>
                    `;

                    // Check if we have diarized translation with timestamps
                    if (result.has_diarization && result.translated_diarization) {
                        translationHtml += '<div class="diarized-transcript translated-diarized">';

                        // Build speaker map from original diarization data to inherit edited names
                        const speakerNameMap = {};
                        let speakerIndex = 1;

                        // First pass: build map from original diarization (which has display_name from edits)
                        if (call.diarization_data && call.diarization_data.length > 0) {
                            call.diarization_data.forEach(utterance => {
                                const originalSpeaker = utterance.speaker || 'Unknown';
                                if (!speakerNameMap[originalSpeaker]) {
                                    // Use saved display_name if available, otherwise create Speaker N format
                                    speakerNameMap[originalSpeaker] = utterance.display_name || `Speaker ${speakerIndex}`;
                                    if (!utterance.display_name) speakerIndex++;
                                }
                            });
                        }

                        // Store translated diarization for editing
                        const translatedDiarization = result.translated_diarization;

                        result.translated_diarization.forEach((utterance, idx) => {
                            const originalSpeaker = utterance.speaker || 'Unknown';

                            // Use speaker name from our map (inherits edited names from original transcript)
                            let displaySpeaker = speakerNameMap[originalSpeaker];
                            if (!displaySpeaker) {
                                displaySpeaker = utterance.display_name || `Speaker ${speakerIndex}`;
                                speakerNameMap[originalSpeaker] = displaySpeaker;
                                speakerIndex++;
                            }

                            const timestamp = formatTimestamp(utterance.start);
                            const speakerClass = getSpeakerClass(originalSpeaker);
                            const startTimeMs = utterance.start || 0;

                            translationHtml += `
                                <div class="utterance-line" data-index="${idx}">
                                    <span class="utterance-timestamp clickable-timestamp" data-time="${startTimeMs}" title="Click to jump to this point">[${timestamp}]</span>
                                    <span class="speaker-label ${speakerClass}" contenteditable="true" data-original="${escapeHtml(originalSpeaker)}">${escapeHtml(displaySpeaker)}</span>
                                    <span class="utterance-text" contenteditable="true">${escapeHtml(utterance.text)}</span>
                                </div>
                            `;
                        });

                        translationHtml += '</div>';
                        translationOutput.innerHTML = translationHtml;

                        // Setup clickable timestamps for translated content
                        setupTimestampClickListeners();

                        // Setup editable speaker names for translation (syncs with original diarization)
                        setupTranslatedSpeakerEditListeners(call.id, call.diarization_data, translatedDiarization);
                    } else if (result.translated_text) {
                        // Plain text translation fallback
                        translationHtml += '<div class="translated-transcript">';
                        const lines = result.translated_text.split('\n');
                        lines.forEach(line => {
                            if (line.trim()) {
                                translationHtml += `<p class="translated-paragraph">${escapeHtml(line)}</p>`;
                            }
                        });
                        translationHtml += '</div>';
                        translationOutput.innerHTML = translationHtml;
                    }

                    showToast(`Translated to ${result.language}`, 'success');
                } else {
                    translationOutput.innerHTML = `<p class="translation-error"><i class="fa-solid fa-exclamation-triangle"></i> ${result.error || 'Translation failed'}</p>`;
                    showToast('Translation failed', 'error');
                }
            } catch (error) {
                console.error('Translation error:', error);
                translationOutput.innerHTML = '<p class="translation-error"><i class="fa-solid fa-exclamation-triangle"></i> Error connecting to translation service</p>';
                showToast('Translation error', 'error');
            } finally {
                // Reset button
                translateBtn.disabled = false;
                translateBtn.innerHTML = '<i class="fa-solid fa-language"></i> Translate';
            }
        };
    }
}

// Setup speaker name edit listeners for translation view
// Edits in translation sync back to original diarization data and update both views
function setupTranslatedSpeakerEditListeners(callId, originalDiarizationData, translatedDiarization) {
    // Select only speaker labels within the translation tab
    const translationContainer = document.getElementById('modal-translation');
    if (!translationContainer) return;

    const speakerLabels = translationContainer.querySelectorAll('.speaker-label[contenteditable="true"]');

    speakerLabels.forEach(label => {
        // Store original display name for tracking
        label.dataset.displayName = label.textContent.trim();

        // Handle Enter key press
        label.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.blur(); // Trigger blur to apply changes
            }
        });

        // Handle blur (when clicking away or pressing Enter)
        label.addEventListener('blur', async function () {
            const newName = this.textContent.trim();
            const originalDisplayName = this.dataset.displayName;
            const originalSpeakerId = this.dataset.original; // Original speaker ID (A, B, etc.)

            // Only update if the name actually changed
            if (newName && newName !== originalDisplayName) {
                // Update all speaker labels with the same original display name in BOTH transcript and translation tabs
                const allLabels = document.querySelectorAll('.speaker-label[contenteditable="true"]');

                allLabels.forEach(otherLabel => {
                    if (otherLabel.dataset.displayName === originalDisplayName) {
                        otherLabel.textContent = newName;
                        otherLabel.dataset.displayName = newName; // Update stored name
                    }
                });

                // Update the original diarization data array with new speaker names
                if (originalDiarizationData && originalSpeakerId) {
                    originalDiarizationData.forEach(utterance => {
                        if (utterance.speaker === originalSpeakerId) {
                            utterance.display_name = newName;
                        }
                    });

                    // Save to database
                    try {
                        const response = await fetch(`/api/calls/${callId}/diarization`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ diarization_data: originalDiarizationData })
                        });

                        if (response.ok) {
                            showToast(`Saved: "${originalDisplayName}" → "${newName}"`, 'success');
                        } else {
                            showToast('Failed to save changes', 'error');
                        }
                    } catch (error) {
                        console.error('Error saving diarization:', error);
                        showToast('Error saving changes', 'error');
                    }
                } else {
                    showToast(`Updated all "${originalDisplayName}" to "${newName}"`, 'success');
                }
            }
        });
    });
}

// Helper: Format milliseconds to MM:SS timestamp
function formatTimestamp(ms) {
    if (!ms && ms !== 0) return '0:00';
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

// Setup timestamp click listeners to seek audio player
function setupTimestampClickListeners() {
    const timestamps = document.querySelectorAll('.clickable-timestamp');
    const audioPlayer = document.getElementById('modal-audio');

    timestamps.forEach(timestamp => {
        timestamp.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent triggering parent element events

            const timeMs = parseInt(timestamp.dataset.time, 10);
            const timeSeconds = timeMs / 1000;

            if (audioPlayer && audioPlayer.src) {
                // Seek to the timestamp
                audioPlayer.currentTime = timeSeconds;

                // Start playing if paused
                if (audioPlayer.paused) {
                    audioPlayer.play().catch(err => {
                        console.log('Audio playback failed:', err);
                    });
                }

                // Highlight the clicked line
                document.querySelectorAll('.utterance-line').forEach(line => {
                    line.classList.remove('active-utterance');
                });
                const parentLine = timestamp.closest('.utterance-line');
                if (parentLine) {
                    parentLine.classList.add('active-utterance');
                }

                showToast(`Jumped to ${formatTimestamp(timeMs)}`, 'success');
            } else {
                showToast('Audio not available', 'error');
            }
        });
    });
}

// Helper: Get CSS class for speaker coloring
function getSpeakerClass(speaker) {
    if (!speaker) return 'speaker-a';
    const speakerUpper = speaker.toUpperCase();
    if (speakerUpper === 'A' || speakerUpper === 'SPEAKER A') return 'speaker-a';
    if (speakerUpper === 'B' || speakerUpper === 'SPEAKER B') return 'speaker-b';
    if (speakerUpper === 'C' || speakerUpper === 'SPEAKER C') return 'speaker-c';
    if (speakerUpper === 'D' || speakerUpper === 'SPEAKER D') return 'speaker-d';
    return 'speaker-a';
}

// Helper: Get CSS class for conversation tone styling
function getToneClass(tone) {
    if (!tone) return 'tone-neutral';
    const toneLower = tone.toLowerCase();
    if (toneLower.includes('friendly') || toneLower.includes('positive') || toneLower.includes('happy') || toneLower.includes('pleasant')) {
        return 'tone-positive';
    }
    if (toneLower.includes('frustrated') || toneLower.includes('angry') || toneLower.includes('upset') || toneLower.includes('rude')) {
        return 'tone-negative';
    }
    if (toneLower.includes('professional') || toneLower.includes('formal') || toneLower.includes('business')) {
        return 'tone-professional';
    }
    if (toneLower.includes('urgent') || toneLower.includes('anxious') || toneLower.includes('stressed')) {
        return 'tone-urgent';
    }
    return 'tone-neutral';
}

// Setup speaker name edit listeners for auto-updating all instances and saving to DB
function setupTranscriptTextEditListeners(callId, diarizationData) {
    const textElements = document.querySelectorAll('.utterance-text[contenteditable="true"]');

    textElements.forEach(textEl => {
        const parentLine = textEl.closest('.utterance-line');
        const index = parentLine ? parseInt(parentLine.dataset.index) : -1;

        if (index === -1) return;

        // Store original text
        textEl.dataset.originalText = textEl.textContent.trim();

        // Handle Enter key
        textEl.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.blur();
            }
        });

        // Handle blur to save
        textEl.addEventListener('blur', async function () {
            const newText = this.textContent.trim();
            const originalText = this.dataset.originalText;

            if (newText !== originalText) {
                // Update local array
                if (diarizationData[index]) {
                    diarizationData[index].text = newText;
                    this.dataset.originalText = newText;

                    // Save to database
                    try {
                        const response = await fetch(`/api/calls/${callId}/diarization`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ diarization_data: diarizationData })
                        });

                        if (response.ok) {
                            showToast('Transcript updated', 'success');

                            // Also update the global transcript string for other uses (like copy)
                            const call = allCalls.find(c => c.id === callId);
                            if (call) {
                                call.transcript = diarizationData.map(d => d.text).join(' ');
                            }
                        } else {
                            showToast('Failed to save transcript', 'error');
                        }
                    } catch (error) {
                        console.error('Error saving transcript:', error);
                        showToast('Error saving transcript', 'error');
                    }
                }
            }
        });
    });
}

function setupSpeakerEditListeners(callId, diarizationData) {
    const speakerLabels = document.querySelectorAll('.speaker-label[contenteditable="true"]');

    speakerLabels.forEach(label => {
        // Store original display name for tracking
        label.dataset.displayName = label.textContent.trim();

        // Handle Enter key press
        label.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.blur(); // Trigger blur to apply changes
            }
        });

        // Handle blur (when clicking away or pressing Enter)
        label.addEventListener('blur', async function () {
            const newName = this.textContent.trim();
            const originalDisplayName = this.dataset.displayName;
            const originalSpeakerId = this.dataset.original; // Original speaker ID (A, B, etc.)

            // Only update if the name actually changed
            if (newName && newName !== originalDisplayName) {
                // Find all speaker labels with the same original display name
                const allLabels = document.querySelectorAll('.speaker-label[contenteditable="true"]');

                allLabels.forEach(otherLabel => {
                    if (otherLabel.dataset.displayName === originalDisplayName) {
                        otherLabel.textContent = newName;
                        otherLabel.dataset.displayName = newName; // Update stored name
                    }
                });

                // Update the diarization data array with new speaker names
                if (diarizationData && originalSpeakerId) {
                    diarizationData.forEach(utterance => {
                        if (utterance.speaker === originalSpeakerId) {
                            utterance.display_name = newName;
                        }
                    });

                    // Save to database
                    try {
                        const response = await fetch(`/api/calls/${callId}/diarization`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ diarization_data: diarizationData })
                        });

                        if (response.ok) {
                            showToast(`Saved: "${originalDisplayName}" → "${newName}"`, 'success');
                        } else {
                            showToast('Failed to save changes', 'error');
                        }
                    } catch (error) {
                        console.error('Error saving diarization:', error);
                        showToast('Error saving changes', 'error');
                    }
                } else {
                    showToast(`Updated all "${originalDisplayName}" to "${newName}"`, 'success');
                }
            }
        });
    });
}

function setupCopyButton(transcript) {
    const copyBtn = document.getElementById('copy-transcript-btn');

    if (copyBtn) {
        copyBtn.onclick = () => {
            navigator.clipboard.writeText(transcript || '')
                .then(() => showToast('Transcript copied to clipboard', 'success'))
                .catch(() => showToast('Failed to copy transcript', 'error'));
        };
    }
}

// Close modal handlers
document.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById('transcript-modal');
    const closeBtn = document.querySelector('.close-modal');
    const backdrop = document.querySelector('.modal-backdrop');

    const closeModal = () => {
        if (modal) {
            const modalContent = modal.querySelector('.modal-content');
            const modalBackdrop = modal.querySelector('.modal-backdrop');

            // Add closing animation classes
            if (modalContent) modalContent.classList.add('closing');
            if (modalBackdrop) modalBackdrop.classList.add('closing');

            // Wait for animation to complete before hiding
            setTimeout(() => {
                modal.style.display = 'none';
                document.body.style.overflow = '';

                // Remove closing classes for next open
                if (modalContent) modalContent.classList.remove('closing');
                if (modalBackdrop) modalBackdrop.classList.remove('closing');

                // Pause audio when closing
                const audio = document.getElementById('modal-audio');
                if (audio) {
                    audio.pause();
                    audio.currentTime = 0;
                }
            }, 350); // Match the macOS animation duration
        }
    };

    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (backdrop) backdrop.addEventListener('click', closeModal);

    // ESC key to close
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal?.style.display === 'flex') {
            closeModal();
        }
    });

    // Modal Tab Switching
    const modalTabs = document.querySelectorAll('.modal-tab');
    modalTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.dataset.tab;

            // Update active tab button
            modalTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            // Update active tab content
            const tabContents = document.querySelectorAll('.tab-content');
            tabContents.forEach(content => {
                content.classList.remove('active');
            });

            const activeContent = document.getElementById(`tab-${tabName}`);
            if (activeContent) {
                activeContent.classList.add('active');
            }
        });
    });
});

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
        <span class="toast-message">${escapeHtml(message)}</span>
    `;

    container.appendChild(toast);

    // Auto remove after 4 seconds
    setTimeout(() => {
        toast.style.animation = 'slideInRight 0.3s ease reverse';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// ============================================
// Filename Popup - Simple Overlay
// ============================================
window.showFilenamePopup = function (filename, event) {
    // Remove any existing popup
    closeFilenamePopup();

    // Create simple overlay
    const overlay = document.createElement('div');
    overlay.className = 'filename-overlay';
    overlay.innerHTML = `
        <span class="filename-overlay-text">${escapeHtml(filename)}</span>
        <button class="filename-overlay-close" onclick="closeFilenamePopup()">
            <i class="fa-solid fa-xmark"></i>
        </button>
    `;

    document.body.appendChild(overlay);

    // Position near the click
    if (event) {
        const rect = event.target.getBoundingClientRect();
        overlay.style.top = `${rect.bottom + 8}px`;
        overlay.style.left = `${Math.max(10, rect.left)}px`;
    }

    // Close on click outside
    setTimeout(() => {
        document.addEventListener('click', closeFilenamePopupOnOutside);
    }, 10);

    // Close on ESC
    document.addEventListener('keydown', closeFilenamePopupOnEsc);
};

function closeFilenamePopupOnOutside(e) {
    const overlay = document.querySelector('.filename-overlay');
    if (overlay && !overlay.contains(e.target)) {
        closeFilenamePopup();
    }
}

function closeFilenamePopupOnEsc(e) {
    if (e.key === 'Escape') {
        closeFilenamePopup();
    }
}

window.closeFilenamePopup = function () {
    const overlay = document.querySelector('.filename-overlay');
    if (overlay) {
        overlay.remove();
    }
    document.removeEventListener('click', closeFilenamePopupOnOutside);
    document.removeEventListener('keydown', closeFilenamePopupOnEsc);
};

// ============================================
// Utility Functions
// ============================================
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function animateCounter(element, target, suffix = '') {
    const duration = 1000;
    const start = parseInt(element.textContent) || 0;
    const increment = (target - start) / (duration / 16);
    let current = start;

    const step = () => {
        current += increment;
        if ((increment > 0 && current >= target) || (increment < 0 && current <= target)) {
            element.textContent = target + suffix;
        } else {
            element.textContent = Math.round(current) + suffix;
            requestAnimationFrame(step);
        }
    };

    requestAnimationFrame(step);
}

// ============================================
// Settings Management
// ============================================
const defaultSettings = {
    theme: 'light',
    compact: false,
    animations: true,
    emailNotify: true,
    browserNotify: false,
    sound: false,
    pageSize: '25',
    autoRefresh: '60',
    dateFormat: 'short'
};

function initializeSettings() {
    // Load saved settings
    const savedSettings = JSON.parse(localStorage.getItem('voxanalyze-settings')) || defaultSettings;

    // Apply theme
    applyTheme(savedSettings.theme);

    // Update UI elements
    updateSettingsUI(savedSettings);

    // Setup event listeners
    setupSettingsListeners();

    // Update settings account info
    updateSettingsAccount();
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);

    // Update theme buttons
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
    const compactToggle = document.getElementById('setting-compact');
    const animationsToggle = document.getElementById('setting-animations');
    const emailNotifyToggle = document.getElementById('setting-email-notify');
    const browserNotifyToggle = document.getElementById('setting-browser-notify');
    const soundToggle = document.getElementById('setting-sound');

    if (compactToggle) compactToggle.checked = settings.compact;
    if (animationsToggle) animationsToggle.checked = settings.animations;
    if (emailNotifyToggle) emailNotifyToggle.checked = settings.emailNotify;
    if (browserNotifyToggle) browserNotifyToggle.checked = settings.browserNotify;
    if (soundToggle) soundToggle.checked = settings.sound;

    // Dropdowns
    const pageSizeSelect = document.getElementById('setting-page-size');
    const autoRefreshSelect = document.getElementById('setting-auto-refresh');
    const dateFormatSelect = document.getElementById('setting-date-format');

    if (pageSizeSelect) pageSizeSelect.value = settings.pageSize;
    if (autoRefreshSelect) autoRefreshSelect.value = settings.autoRefresh;
    if (dateFormatSelect) dateFormatSelect.value = settings.dateFormat;

    // Apply animations setting
    if (!settings.animations) {
        document.body.classList.add('no-animations');
    } else {
        document.body.classList.remove('no-animations');
    }
}

function setupSettingsListeners() {
    // Theme buttons
    document.querySelectorAll('.theme-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const theme = btn.dataset.theme;
            applyTheme(theme);

            // Update active state
            document.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });

    // Animations toggle - apply immediately
    const animationsToggle = document.getElementById('setting-animations');
    if (animationsToggle) {
        animationsToggle.addEventListener('change', (e) => {
            if (e.target.checked) {
                document.body.classList.remove('no-animations');
            } else {
                document.body.classList.add('no-animations');
            }
        });
    }

    // Save settings button
    const saveBtn = document.getElementById('save-settings');
    if (saveBtn) {
        saveBtn.addEventListener('click', saveSettings);
    }

    // Reset settings button
    const resetBtn = document.getElementById('reset-settings');
    if (resetBtn) {
        resetBtn.addEventListener('click', resetSettings);
    }

    // Settings logout button
    const settingsLogout = document.getElementById('settings-logout');
    if (settingsLogout) {
        settingsLogout.addEventListener('click', async () => {
            try {
                await fetch('/api/auth/logout', { method: 'POST' });
                await supabaseClient.auth.signOut();
            } catch (err) {
                console.error('Logout error:', err);
            }
            window.location.href = '/login';
        });
    }
}

function saveSettings() {
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

    localStorage.setItem('voxanalyze-settings', JSON.stringify(settings));
    showToast('Settings saved successfully!', 'success');
}

function resetSettings() {
    localStorage.setItem('voxanalyze-settings', JSON.stringify(defaultSettings));
    updateSettingsUI(defaultSettings);
    applyTheme(defaultSettings.theme);
    showToast('Settings reset to defaults', 'success');
}

function updateSettingsAccount() {
    const settingsName = document.getElementById('settings-name');
    const settingsEmail = document.getElementById('settings-email');
    const settingsAvatar = document.getElementById('settings-avatar');

    // Get user info from main profile
    const userName = document.getElementById('user-name')?.textContent || 'User';
    const userEmail = document.getElementById('user-email')?.textContent || '';

    if (settingsName) settingsName.textContent = userName;
    if (settingsEmail) settingsEmail.textContent = userEmail;
    if (settingsAvatar) {
        settingsAvatar.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(userName)}&background=6366f1&color=fff&size=80`;
    }
}

// Initialize settings when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    // Load theme immediately to prevent flash
    const savedSettings = JSON.parse(localStorage.getItem('voxanalyze-settings')) || defaultSettings;
    applyTheme(savedSettings.theme);
});

// Full settings init after main content loads
window.addEventListener('load', () => {
    initializeSettings();
});

// ============================================
// Summary Modal Functions
// ============================================

let currentSummaryCallId = null;

function openSummaryModal(callId) {
    const call = allCalls.find(c => c.id === callId);
    if (!call) {
        showToast('Call not found', 'error');
        return;
    }

    currentSummaryCallId = callId;

    // Update modal content
    const filenameEl = document.getElementById('summary-modal-filename');
    const contentEl = document.getElementById('summary-modal-content');
    const modal = document.getElementById('summary-modal');

    if (filenameEl) filenameEl.textContent = call.filename || 'Unknown';

    // Parse and display summary
    if (contentEl) {
        const summaryText = call.summary || 'No summary available';
        let summaryData = null;

        try {
            summaryData = JSON.parse(summaryText);
        } catch (e) {
            // Not JSON, display as plain text
            contentEl.innerHTML = `<p>${escapeHtml(summaryText)}</p>`;
        }

        if (summaryData && typeof summaryData === 'object') {
            let html = '';

            // Overview
            if (summaryData.overview) {
                html += `
                    <div class="summary-section">
                        <h4 style="color: var(--accent-primary); margin: 0 0 12px 0; font-size: 1.1rem; font-weight: 700; display: flex; align-items: center; gap: 8px;">
                            <i class="fa-solid fa-circle-info"></i> Overview
                        </h4>
                        <p style="margin: 0; line-height: 1.6; color: var(--text-primary); text-align: justify;">${escapeHtml(summaryData.overview)}</p>
                    </div>
                `;
            }

            // Caller Intent
            if (summaryData.caller_intent) {
                html += `
                    <div class="summary-section" style="margin-top: 20px;">
                        <h4 style="color: var(--accent-primary); margin: 0 0 12px 0; font-size: 1.1rem; font-weight: 700; display: flex; align-items: center; gap: 8px;">
                            <i class="fa-solid fa-crosshairs"></i> Caller Intent
                        </h4>
                        <p style="margin: 0; line-height: 1.6; color: var(--text-primary);">${escapeHtml(summaryData.caller_intent)}</p>
                    </div>
                `;
            }

            // Issue Details
            if (summaryData.issue_details) {
                html += `
                    <div class="summary-section" style="margin-top: 20px;">
                        <h4 style="color: var(--accent-primary); margin: 0 0 12px 0; font-size: 1.1rem; font-weight: 700; display: flex; align-items: center; gap: 8px;">
                            <i class="fa-solid fa-magnifying-glass-triangle"></i> Issue Details
                        </h4>
                        <p style="margin: 0; line-height: 1.6; color: var(--text-primary);">${escapeHtml(summaryData.issue_details)}</p>
                    </div>
                `;
            }

            // Resolution
            if (summaryData.resolution) {
                html += `
                    <div class="summary-section" style="margin-top: 20px;">
                        <h4 style="color: var(--accent-primary); margin: 0 0 12px 0; font-size: 1.1rem; font-weight: 700; display: flex; align-items: center; gap: 8px;">
                            <i class="fa-solid fa-check-to-slot"></i> Resolution
                        </h4>
                        <p style="margin: 0; line-height: 1.6; color: var(--text-primary);">${escapeHtml(summaryData.resolution)}</p>
                    </div>
                `;
            }

            // Key Points
            if (summaryData.key_points && Array.isArray(summaryData.key_points) && summaryData.key_points.length > 0) {
                html += `
                    <div class="summary-section" style="margin-top: 20px;">
                        <h4 style="color: var(--accent-primary); margin: 0 0 12px 0; font-size: 1.1rem; font-weight: 700; display: flex; align-items: center; gap: 8px;">
                            <i class="fa-solid fa-list-ul"></i> Key Points
                        </h4>
                        <ul style="margin: 0; padding-left: 20px; color: var(--text-primary);">
                            ${summaryData.key_points.map(point => `<li style="margin-bottom: 8px; line-height: 1.5;">${escapeHtml(point)}</li>`).join('')}
                        </ul>
                    </div>
                `;
            }

            // Action Items
            if (summaryData.action_items && Array.isArray(summaryData.action_items) && summaryData.action_items.length > 0) {
                html += `
                    <div class="summary-section" style="margin-top: 20px;">
                        <h4 style="color: var(--warning); margin: 0 0 12px 0; font-size: 1.1rem; font-weight: 700; display: flex; align-items: center; gap: 8px;">
                            <i class="fa-solid fa-clipboard-check"></i> Action Items
                        </h4>
                        <ul style="margin: 0; padding-left: 20px; color: var(--text-primary);">
                            ${summaryData.action_items.map(item => `<li style="margin-bottom: 8px; line-height: 1.5;">${escapeHtml(item)}</li>`).join('')}
                        </ul>
                    </div>
                `;
            }

            // Tone
            if (summaryData.tone) {
                html += `
                    <div class="summary-section" style="margin-top: 20px;">
                        <h4 style="color: var(--text-secondary); margin: 0 0 8px 0; font-size: 0.95rem; font-weight: 600;">
                            Tone:
                        </h4>
                        <p style="margin: 0; color: var(--text-primary);">${escapeHtml(summaryData.tone)}</p>
                    </div>
                `;
            }

            contentEl.innerHTML = html || '<p style="color: var(--text-muted);">No detailed summary available</p>';
        }
    }

    // Setup "View Full Details" button
    const detailsBtn = document.getElementById('btn-view-full-details');
    if (detailsBtn) {
        detailsBtn.onclick = () => {
            closeSummaryModal();
            setTimeout(() => openModal(callId), 300);
        };
    }

    // Show modal
    if (modal) modal.style.display = 'flex';
}

function closeSummaryModal() {
    const modal = document.getElementById('summary-modal');
    if (modal) modal.style.display = 'none';
    currentSummaryCallId = null;
}

// Close on overlay click
document.addEventListener('click', (e) => {
    const modal = document.getElementById('summary-modal');
    if (e.target === modal) {
        closeSummaryModal();
    }
});

// ============================================
// Minutes Translation Functions
// ============================================

function toggleMinutesTranslate(event) {
    event.stopPropagation();
    const menu = document.getElementById('minutes-translate-menu');
    if (menu) {
        menu.classList.toggle('active');
    }
}

async function translateMinutes(callId, language, event) {
    event.stopPropagation();

    // Close dropdown
    const menu = document.getElementById('minutes-translate-menu');
    if (menu) menu.classList.remove('active');

    const call = allCalls.find(c => c.id === callId);
    if (!call) {
        showToast('Call not found', 'error');
        return;
    }

    // Show loading toast
    showToast('Translating minutes...', 'info');

    try {
        const summaryText = call.summary || '';

        // Prepare request payload
        const requestData = {
            transcript: summaryText,
            language: language,
            diarization_data: []  // Empty array instead of null
        };

        const response = await fetch('/api/translate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestData)
        });

        if (!response.ok) {
            throw new Error('Translation failed');
        }

        const result = await response.json();

        if (result.success && result.translated_text) {
            // Update the minutes display with translated content
            updateMinutesWithTranslation(callId, result.translated_text, language);
            showToast(`Translated to ${getLanguageName(language)}!`, 'success');
        } else {
            throw new Error('Translation error');
        }
    } catch (error) {
        console.error('Translation error:', error);
        showToast('Translation failed. Please try again.', 'error');
    }
}

// Translation maps for UI labels
const uiTranslations = {
    'en': {
        title: 'Minutes of Meeting',
        date: 'Date:',
        time: 'Time:',
        duration: 'Duration:',
        attendees: 'Attendees:',
        subject: 'Subject:',
        opening: '1. Opening and Context:',
        keyPoints: '2. Key Discussion Points:',
        issues: '3. Issue Identification:',
        resolution: '4. Resolution / Outcome:',
        actionItems: '5. Action Items / Next Steps:',
        tone: '6. Meeting Tone:',
        notSpecified: '[Not specified]',
        participant: 'participant',
        participants: 'participants',
        namesNotSpecified: 'names not specified',
        minute: 'minute',
        minutes: 'minutes',
        second: 'second',
        seconds: 'seconds'
    },
    'ml': {
        title: 'മീറ്റിംഗിന്റെ മിനിട്ടുകൾ',
        date: 'തീയതി:',
        time: 'സമയം:',
        duration: 'ദൈർഘ്യം:',
        attendees: 'പങ്കെടുക്കുന്നവർ:',
        subject: 'വിഷയം:',
        opening: '1. ആരംഭവും സന്ദർഭവും:',
        keyPoints: '2. പ്രധാന ചർച്ചാ പോയിന്റുകൾ:',
        issues: '3. പ്രശ്നം തിരിച്ചറിയൽ:',
        resolution: '4. പരിഹാരം / ഫലം:',
        actionItems: '5. പ്രവർത്തന ഇനങ്ങൾ / അടുത്ത ഘട്ടങ്ങൾ:',
        tone: '6. മീറ്റിംഗ് ടോൺ:',
        notSpecified: '[വ്യക്തമാക്കിയിട്ടില്ല]',
        participant: 'പങ്കാളി',
        participants: 'പങ്കാളികൾ',
        namesNotSpecified: 'പേരുകൾ വ്യക്തമാക്കിയിട്ടില്ല',
        minute: 'മിനിറ്റ്',
        minutes: 'മിനിറ്റ്',
        second: 'സെക്കൻഡ്',
        seconds: 'സെക്കൻഡ്'
    },
    'hi': {
        title: 'बैठक की कार्यवृत्त',
        date: 'तारीख:',
        time: 'समय:',
        duration: 'अवधि:',
        attendees: 'उपस्थित:',
        subject: 'विषय:',
        opening: '1. शुरुआत और संदर्भ:',
        keyPoints: '2. मुख्य चर्चा बिंदु:',
        issues: '3. समस्या की पहचान:',
        resolution: '4. समाधान / परिणाम:',
        actionItems: '5. कार्य वस्तुएँ / अगले कदम:',
        tone: '6. बैठक का माहौल:',
        notSpecified: '[निर्दिष्ट नहीं]',
        participant: 'प्रतिभागी',
        participants: 'प्रतिभागियों',
        namesNotSpecified: 'नाम निर्दिष्ट नहीं',
        minute: 'मिनट',
        minutes: 'मिनट',
        second: 'सेकंड',
        seconds: 'सेकंड'
    },
    'ar': {
        title: 'محضر الاجتماع',
        date: 'التاريخ:',
        time: 'الوقت:',
        duration: 'المدة:',
        attendees: 'الحضور:',
        subject: 'الموضوع:',
        opening: '1. الافتتاح والسياق:',
        keyPoints: '2. نقاط النقاش الرئيسية:',
        issues: '3. تحديد المشكلة:',
        resolution: '4. الحل / النتيجة:',
        actionItems: '5. بنود العمل / الخطوات التالية:',
        tone: '6. نبرة الاجتماع:',
        notSpecified: '[غير محدد]',
        participant: 'مشارك',
        participants: 'مشاركون',
        namesNotSpecified: 'الأسماء غير محددة',
        minute: 'دقيقة',
        minutes: 'دقائق',
        second: 'ثانية',
        seconds: 'ثواني'
    }
};

function getLanguageName(code) {
    const names = {
        'en': 'English',
        'ml': 'Malayalam',
        'hi': 'Hindi',
        'ar': 'Arabic'
    };
    return names[code] || code;
}

function getUITranslations(language) {
    return uiTranslations[language] || uiTranslations['en'];
}

function updateMinutesWithTranslation(callId, translatedText, language) {
    const call = allCalls.find(c => c.id === callId);
    if (!call) return;

    // Get UI translations for selected language
    const ui = getUITranslations(language);

    // Parse translated text as JSON if possible
    let translatedData = null;
    try {
        translatedData = JSON.parse(translatedText);
    } catch (e) {
        // Not JSON, use as plain text
    }

    const modalMinutes = document.getElementById('modal-minutes');
    if (!modalMinutes) return;

    // Rebuild minutes HTML with FULL STRUCTURE and translated content
    let minutesHtml = '<div class="meeting-minutes">';

    // Header with translation button
    minutesHtml += '<div class="minutes-header">';
    minutesHtml += `<h5 class="minutes-title">${ui.title}</h5>`;
    minutesHtml += `
        <div class="minutes-translate-dropdown">
            <button class="minutes-translate-btn" onclick="toggleMinutesTranslate(event)">
                <i class="fa-solid fa-language"></i>
                <span>Translate</span>
                <i class="fa-solid fa-chevron-down"></i>
            </button>
            <div class="minutes-translate-menu" id="minutes-translate-menu">
                <button class="translate-option" onclick="translateMinutes(${callId}, 'en', event)">
                    <span class="lang-flag">🇬🇧</span>
                    English
                </button>
                <button class="translate-option" onclick="translateMinutes(${callId}, 'ml', event)">
                    <span class="lang-flag">🇮🇳</span>
                    Malayalam
                </button>
                <button class="translate-option" onclick="translateMinutes(${callId}, 'hi', event)">
                    <span class="lang-flag">🇮🇳</span>
                    Hindi
                </button>
                <button class="translate-option" onclick="translateMinutes(${callId}, 'ar', event)">
                    <span class="lang-flag">🇸🇦</span>
                    Arabic
                </button>
            </div>
        </div>
    `;
    minutesHtml += '</div>';

    // Date and Time section (keep original structure)
    minutesHtml += '<div class="minutes-meta">';

    const summaryText = call.summary || '';
    const originalData = JSON.parse(summaryText || '{}');

    // Date
    let meetingDate = ui.notSpecified;
    if (originalData && originalData.meeting_date) {
        meetingDate = originalData.meeting_date;
    } else if (originalData && originalData.date) {
        meetingDate = originalData.date;
    }
    // Check for null or empty values
    if (!meetingDate || meetingDate === 'null' || meetingDate === 'NULL' || meetingDate.trim() === '') {
        meetingDate = ui.notSpecified;
    }
    minutesHtml += `
        <div class="minutes-meta-item">
            <span class="minutes-label">${ui.date}</span>
            <span class="minutes-value">${escapeHtml(meetingDate)}</span>
        </div>
    `;

    // Time
    let meetingTime = ui.notSpecified;
    if (originalData && originalData.meeting_time) {
        meetingTime = originalData.meeting_time;
    } else if (originalData && originalData.time) {
        meetingTime = originalData.time;
    }
    // Check for null or empty values
    if (!meetingTime || meetingTime === 'null' || meetingTime === 'NULL' || meetingTime.trim() === '') {
        meetingTime = ui.notSpecified;
    }
    minutesHtml += `
        <div class="minutes-meta-item">
            <span class="minutes-label">${ui.time}</span>
            <span class="minutes-value">${escapeHtml(meetingTime)}</span>
        </div>
    `;

    // Duration
    let durationText = ui.notSpecified;
    if (call.duration && call.duration > 0) {
        const minutes = Math.floor(call.duration / 60);
        const seconds = call.duration % 60;
        if (minutes > 0) {
            durationText = `${minutes} ${minutes !== 1 ? ui.minutes : ui.minute}`;
            if (seconds > 0) {
                durationText += ` ${seconds} ${seconds !== 1 ? ui.seconds : ui.second}`;
            }
        } else {
            durationText = `${seconds} ${seconds !== 1 ? ui.seconds : ui.second}`;
        }
    }
    minutesHtml += `
        <div class="minutes-meta-item">
            <span class="minutes-label">${ui.duration}</span>
            <span class="minutes-value">${escapeHtml(durationText)}</span>
        </div>
    `;
    minutesHtml += '</div>'; // End minutes-meta

    // Attendees section
    minutesHtml += '<div class="minutes-section">';
    minutesHtml += `<h6><i class="fa-solid fa-users"></i> ${ui.attendees}</h6>`;

    const diarizationData = call.diarization_data || [];
    const speakerCount = call.speaker_count || 0;

    if (speakerCount > 0 || diarizationData.length > 0) {
        const uniqueSpeakers = new Set();
        const speakerMap = {};
        let speakerIndex = 1;

        diarizationData.forEach(utterance => {
            const originalSpeaker = utterance.speaker || 'Unknown';
            let displayName = utterance.display_name;
            if (!displayName) {
                if (!speakerMap[originalSpeaker]) {
                    speakerMap[originalSpeaker] = `Speaker ${speakerIndex}`;
                    speakerIndex++;
                }
                displayName = speakerMap[originalSpeaker];
            }
            uniqueSpeakers.add(displayName);
        });

        if (uniqueSpeakers.size > 0) {
            minutesHtml += '<ul class="attendees-list">';
            uniqueSpeakers.forEach(speaker => {
                minutesHtml += `<li>${escapeHtml(speaker)}</li>`;
            });
            minutesHtml += '</ul>';
        } else {
            minutesHtml += `<p class="minutes-placeholder">${speakerCount} ${speakerCount !== 1 ? ui.participants : ui.participant} (${ui.namesNotSpecified})</p>`;
        }
    } else {
        minutesHtml += `<p class="minutes-placeholder">${ui.notSpecified}</p>`;
    }
    minutesHtml += '</div>';

    // Subject section (translated) - use label-value format
    minutesHtml += '<div class="minutes-meta">';

    let subject = ui.notSpecified;
    if (translatedData) {
        if (translatedData.caller_intent) {
            subject = translatedData.caller_intent;
        } else if (translatedData.overview) {
            const overview = translatedData.overview;
            subject = overview.split('.')[0] || overview.substring(0, 100);
        }
    }
    minutesHtml += `
        <div class="minutes-meta-item">
            <span class="minutes-label">${ui.subject}</span>
            <span class="minutes-value">${escapeHtml(subject)}</span>
        </div>
    `;
    minutesHtml += '</div>';

    // TRANSLATED CONTENT - Structured format with labels
    if (translatedData && typeof translatedData === 'object') {
        // Create a content sections container
        minutesHtml += '<div class="minutes-content-sections">';

        // 1. Overview / Opening
        if (translatedData.overview) {
            minutesHtml += '<div class="minutes-meta">';
            minutesHtml += `
                <div class="minutes-meta-item full-width">
                    <span class="minutes-label">${ui.opening}</span>
                    <span class="minutes-value">${escapeHtml(translatedData.overview)}</span>
                </div>
            `;
            minutesHtml += '</div>';
        }

        // 2. Key Discussion Points - show as list with label
        if (translatedData.key_points && translatedData.key_points.length > 0) {
            minutesHtml += '<div class="minutes-section">';
            minutesHtml += `<h6><i class="fa-solid fa-list-ol"></i> ${ui.keyPoints}</h6>`;
            minutesHtml += '<ol class="minutes-points-list">';
            translatedData.key_points.forEach(point => {
                minutesHtml += `<li>${escapeHtml(point)}</li>`;
            });
            minutesHtml += '</ol>';
            minutesHtml += '</div>';
        }

        // 3. Issue Identification - label-value format
        if (translatedData.issue_details) {
            minutesHtml += '<div class="minutes-meta">';
            minutesHtml += `
                <div class="minutes-meta-item full-width">
                    <span class="minutes-label">${ui.issues}</span>
                    <span class="minutes-value">${escapeHtml(translatedData.issue_details)}</span>
                </div>
            `;
            minutesHtml += '</div>';
        }

        // 4. Resolution / Outcome - label-value format
        if (translatedData.resolution) {
            minutesHtml += '<div class="minutes-meta">';
            minutesHtml += `
                <div class="minutes-meta-item full-width">
                    <span class="minutes-label">${ui.resolution}</span>
                    <span class="minutes-value">${escapeHtml(translatedData.resolution)}</span>
                </div>
            `;
            minutesHtml += '</div>';
        }

        // 5. Action Items / Next Steps - show as list with label
        if (translatedData.action_items && translatedData.action_items.length > 0) {
            minutesHtml += '<div class="minutes-section">';
            minutesHtml += `<h6><i class="fa-solid fa-tasks"></i> ${ui.actionItems}</h6>`;
            minutesHtml += '<ul class="minutes-action-list">';
            translatedData.action_items.forEach(item => {
                minutesHtml += `<li>${escapeHtml(item)}</li>`;
            });
            minutesHtml += '</ul>';
            minutesHtml += '</div>';
        }

        // 6. Tone - label-value format
        if (translatedData.tone) {
            minutesHtml += '<div class="minutes-meta">';
            minutesHtml += `
                <div class="minutes-meta-item full-width">
                    <span class="minutes-label">${ui.tone}</span>
                    <span class="minutes-value">${escapeHtml(translatedData.tone)}</span>
                </div>
            `;
            minutesHtml += '</div>';
        }

        minutesHtml += '</div>'; // End minutes-content-sections
    } else {
        // Display as plain text if not structured
        minutesHtml += '<div class="minutes-section">';
        minutesHtml += '<h6><i class="fa-solid fa-language"></i> Translated Content:</h6>';
        minutesHtml += `<p>${escapeHtml(translatedText)}</p>`;
        minutesHtml += '</div>';
    }

    minutesHtml += '</div>'; // End meeting-minutes
    modalMinutes.innerHTML = minutesHtml;
}

// Close translation dropdown when clicking outside
document.addEventListener('click', (e) => {
    const menu = document.getElementById('minutes-translate-menu');
    if (menu && !e.target.closest('.minutes-translate-dropdown')) {
        menu.classList.remove('active');
    }
});

// ============================================
// Summary Translation Functions
// ============================================

function toggleSummaryTranslate(event) {
    event.stopPropagation();
    const menu = document.getElementById('summary-translate-menu');
    if (menu) {
        menu.classList.toggle('active');
    }
}

async function translateSummary(callId, language, event) {
    event.stopPropagation();

    // Close dropdown
    const menu = document.getElementById('summary-translate-menu');
    if (menu) menu.classList.remove('active');

    const call = allCalls.find(c => c.id === callId);
    if (!call) {
        showToast('Call not found', 'error');
        return;
    }

    // Show loading toast
    showToast('Translating summary...', 'info');

    try {
        const summaryText = call.summary || '';

        // Prepare request payload
        const requestData = {
            transcript: summaryText,
            language: language,
            diarization_data: []
        };

        const response = await fetch('/api/translate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestData)
        });

        if (!response.ok) {
            throw new Error('Translation failed');
        }

        const result = await response.json();

        if (result.success && result.translated_text) {
            // Update the summary display with translated content
            updateSummaryWithTranslation(callId, result.translated_text, language);
            showToast(`Translated to ${getLanguageName(language)}!`, 'success');
        } else {
            throw new Error('Translation error');
        }
    } catch (error) {
        console.error('Translation error:', error);
        showToast('Translation failed. Please try again.', 'error');
    }
}

function updateSummaryWithTranslation(callId, translatedText, language) {
    const call = allCalls.find(c => c.id === callId);
    if (!call) return;

    // Get UI translations for selected language
    const ui = getUITranslations(language);

    // Parse translated text as JSON if possible
    let translatedData = null;
    try {
        translatedData = JSON.parse(translatedText);
    } catch (e) {
        // Not JSON, use as plain text
    }

    const modalSummary = document.getElementById('modal-summary');
    if (!modalSummary) return;

    // Build translated summary HTML
    let summaryHtml = '<div class="structured-summary">';

    // Add translation header
    summaryHtml += '<div class="summary-translate-header">';
    summaryHtml += `<h4 class="summary-main-title">${ui.title || 'Call Summary'}</h4>`;
    summaryHtml += `
        <div class="summary-translate-dropdown">
            <button class="summary-translate-btn" onclick="toggleSummaryTranslate(event)">
                <i class="fa-solid fa-language"></i>
                <span>Translate</span>
                <i class="fa-solid fa-chevron-down"></i>
            </button>
            <div class="summary-translate-menu" id="summary-translate-menu">
                <button class="translate-option" onclick="translateSummary(${callId}, 'en', event)">
                    <span class="lang-flag">🇬🇧</span>
                    English
                </button>
                <button class="translate-option" onclick="translateSummary(${callId}, 'ml', event)">
                    <span class="lang-flag">🇮🇳</span>
                    Malayalam
                </button>
                <button class="translate-option" onclick="translateSummary(${callId}, 'hi', event)">
                    <span class="lang-flag">🇮🇳</span>
                    Hindi
                </button>
                <button class="translate-option" onclick="translateSummary(${callId}, 'ar', event)">
                    <span class="lang-flag">🇸🇦</span>
                    Arabic
                </button>
            </div>
        </div>
    `;
    summaryHtml += '</div>';

    if (translatedData && typeof translatedData === 'object') {
        // Overview section
        if (translatedData.overview) {
            summaryHtml += `
                <div class="summary-section overview-section">
                    <div class="summary-section-header">
                        <i class="fa-solid fa-lightbulb"></i>
                        <strong>${ui.opening || 'Overview'}</strong>
                    </div>
                    <p class="summary-overview">${escapeHtml(translatedData.overview)}</p>
                </div>
            `;
        }

        // Key Points section
        if (translatedData.key_points && translatedData.key_points.length > 0) {
            summaryHtml += `
                <div class="summary-section key-points-section">
                    <div class="summary-section-header">
                        <i class="fa-solid fa-list-check"></i>
                        <strong>${ui.keyPoints || 'Key Points'}</strong>
                    </div>
                    <ul class="key-points-list">
                        ${translatedData.key_points.map(point => `<li>${escapeHtml(point)}</li>`).join('')}
                    </ul>
                </div>
            `;
        }

        // Caller Intent section
        if (translatedData.caller_intent) {
            summaryHtml += `
                <div class="summary-section">
                    <div class="summary-section-header">
                        <i class="fa-solid fa-bullseye"></i>
                        <strong>What the Caller Wanted</strong>
                    </div>
                    <p>${escapeHtml(translatedData.caller_intent)}</p>
                </div>
            `;
        }

        // Issue Details section
        if (translatedData.issue_details) {
            summaryHtml += `
                <div class="summary-section">
                    <div class="summary-section-header">
                        <i class="fa-solid fa-exclamation-circle"></i>
                        <strong>${ui.issues || 'Issue / Topic'}</strong>
                    </div>
                    <p>${escapeHtml(translatedData.issue_details)}</p>
                </div>
            `;
        }

        // Resolution section
        if (translatedData.resolution) {
            summaryHtml += `
                <div class="summary-section resolution-section">
                    <div class="summary-section-header">
                        <i class="fa-solid fa-check-circle"></i>
                        <strong>${ui.resolution || 'Resolution / Outcome'}</strong>
                    </div>
                    <p>${escapeHtml(translatedData.resolution)}</p>
                </div>
            `;
        }

        // Action Items section
        if (translatedData.action_items && translatedData.action_items.length > 0) {
            summaryHtml += `
                <div class="summary-section action-items-section">
                    <div class="summary-section-header">
                        <i class="fa-solid fa-tasks"></i>
                        <strong>${ui.actionItems || 'Next Steps / Action Items'}</strong>
                    </div>
                    <ul class="action-items-list">
                        ${translatedData.action_items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}
                    </ul>
                </div>
            `;
        }

        // Tone section
        if (translatedData.tone) {
            const toneClass = getToneClass(translatedData.tone);
            summaryHtml += `
                <div class="summary-section tone-section">
                    <div class="summary-section-header">
                        <i class="fa-solid fa-comment"></i>
                        <strong>${ui.tone || 'Conversation Tone'}</strong>
                    </div>
                    <span class="tone-badge ${toneClass}">${escapeHtml(translatedData.tone)}</span>
                </div>
            `;
        }
    } else {
        // Display as plain text
        summaryHtml += `<p>${escapeHtml(translatedText)}</p>`;
    }

    summaryHtml += '</div>';
    modalSummary.innerHTML = summaryHtml;
}

// Close summary translation dropdown when clicking outside
document.addEventListener('click', (e) => {
    const menu = document.getElementById('summary-translate-menu');
    if (menu && !e.target.closest('.summary-translate-dropdown')) {
        menu.classList.remove('active');
    }
});

// ============================================
// Theme Toggle Logic
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    const headerThemeBtn = document.getElementById('header-theme-toggle');
    const savedTheme = localStorage.getItem('theme') || 'light';

    // Initial set
    setTheme(savedTheme);

    if (headerThemeBtn) {
        headerThemeBtn.addEventListener('click', () => {
            const currentTheme = document.documentElement.getAttribute('data-theme');
            const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
            setTheme(newTheme);
        });
    }

    function setTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);

        // Update icon
        if (headerThemeBtn) {
            const icon = headerThemeBtn.querySelector('i');
            if (icon) {
                if (theme === 'dark') {
                    icon.className = 'fa-solid fa-sun';
                } else {
                    icon.className = 'fa-solid fa-moon';
                }
            }
        }
    }
});

// ============================================
// Search Functionality
// ============================================
function setupSearchListener() {
    const searchInput = document.getElementById('call-search-input');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            currentSearchTerm = e.target.value.trim().toLowerCase();
            applyFilters();
        });
    }
}

function applyFilters() {
    if (!Array.isArray(allCalls)) {
        console.error('[ERROR] applyFilters: allCalls is not an array:', allCalls);
        allCalls = [];
    }

    let filtered = allCalls.filter(call => {
        // Search Filter
        if (currentSearchTerm) {
            const matchesSearch = (call.filename && call.filename.toLowerCase().includes(currentSearchTerm)) ||
                (call.transcript && call.transcript.toLowerCase().includes(currentSearchTerm)) ||
                (call.summary && call.summary.toLowerCase().includes(currentSearchTerm)) ||
                (call.tags && Array.isArray(call.tags) && call.tags.some(t => t.toLowerCase().includes(currentSearchTerm)));

            if (!matchesSearch) return false;
        }

        // Sentiment Filter
        const sentiment = (call.sentiment || 'neutral').toLowerCase();
        if (!currentFilters.sentiments.includes(sentiment)) return false;

        // Tags Filter
        if (currentFilters.tags.length > 0) {
            const callTags = call.tags || [];
            if (callTags.length > 0) {
                const hasMatchingTag = callTags.some(tag => currentFilters.tags.includes(tag));
                if (!hasMatchingTag) return false;
            }
        }

        // Date Filter
        if (call.created_at) {
            const callDate = new Date(call.created_at);
            if (currentFilters.dateFrom) {
                const fromDate = new Date(currentFilters.dateFrom);
                fromDate.setHours(0, 0, 0, 0);
                if (callDate < fromDate) return false;
            }
            if (currentFilters.dateTo) {
                const toDate = new Date(currentFilters.dateTo);
                toDate.setHours(23, 59, 59, 999);
                if (callDate > toDate) return false;
            }
        }

        return true;
    });

    renderTable(filtered);
}

// ============================================
// Load More Button
// ============================================
function initializeLoadMoreButton() {
    const loadMoreBtn = document.getElementById('load-more-btn');
    if (loadMoreBtn) {
        loadMoreBtn.addEventListener('click', loadMoreCalls);
    }
}

async function loadMoreCalls() {
    await fetchCalls(true);
}
