
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
                        <p style="margin: 0; line-height: 1.6; color: var(--text-primary);">${escapeHtml(summaryData.overview)}</p>
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
