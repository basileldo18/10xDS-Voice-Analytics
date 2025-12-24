
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
            diarization_data: null
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

function getLanguageName(code) {
    const names = {
        'en': 'English',
        'ml': 'Malayalam',
        'hi': 'Hindi',
        'ar': 'Arabic'
    };
    return names[code] || code;
}

function updateMinutesWithTranslation(callId, translatedText, language) {
    const call = allCalls.find(c => c.id === callId);
    if (!call) return;

    // Parse translated text as JSON if possible
    let translatedData = null;
    try {
        translatedData = JSON.parse(translatedText);
    } catch (e) {
        // Not JSON, use as plain text
    }

    const modalMinutes = document.getElementById('modal-minutes');
    if (!modalMinutes) return;

    // Rebuild minutes HTML with translated content
    let minutesHtml = '<div class="meeting-minutes">';

    // Header (keep original)
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

    // Show translated content
    if (translatedData && typeof translatedData === 'object') {
        // Display structured data
        if (translatedData.overview) {
            minutesHtml += '<div class="minutes-section">';
            minutesHtml += `<h6><i class="fa-solid fa-circle-info"></i> Overview:</h6>`;
            minutesHtml += `<p>${escapeHtml(translatedData.overview)}</p>`;
            minutesHtml += '</div>';
        }

        if (translatedData.key_points && Array.isArray(translatedData.key_points)) {
            minutesHtml += '<div class="minutes-section">';
            minutesHtml += `<h6><i class="fa-solid fa-list-ul"></i> Key Points:</h6>`;
            minutesHtml += '<ul>';
            translatedData.key_points.forEach(point => {
                minutesHtml += `<li>${escapeHtml(point)}</li>`;
            });
            minutesHtml += '</ul>';
            minutesHtml += '</div>';
        }

        if (translatedData.action_items && Array.isArray(translatedData.action_items)) {
            minutesHtml += '<div class="minutes-section">';
            minutesHtml += `<h6><i class="fa-solid fa-clipboard-check"></i> Action Items:</h6>`;
            minutesHtml += '<ul>';
            translatedData.action_items.forEach(item => {
                minutesHtml += `<li>${escapeHtml(item)}</li>`;
            });
            minutesHtml += '</ul>';
            minutesHtml += '</div>';
        }
    } else {
        // Display as plain text
        minutesHtml += '<div class="minutes-section">';
        minutesHtml += `<h6><i class="fa-solid fa-language"></i> Translated Content:</h6>`;
        minutesHtml += `<p>${escapeHtml(translatedText)}</p>`;
        minutesHtml += '</div>';
    }

    minutesHtml += '</div>';
    modalMinutes.innerHTML = minutesHtml;
}

// Close translation dropdown when clicking outside
document.addEventListener('click', (e) => {
    const menu = document.getElementById('minutes-translate-menu');
    if (menu && !e.target.closest('.minutes-translate-dropdown')) {
        menu.classList.remove('active');
    }
});
