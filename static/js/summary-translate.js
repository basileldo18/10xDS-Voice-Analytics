
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
