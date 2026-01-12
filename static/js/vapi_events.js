/**
 * Vapi Events Handler
 * Handles automatic modal opening on call start and processing on call end.
 */

// Define global initialization function
window.initializeVapiEvents = async (widget) => {
    console.log('[Vapi] Initializing event listeners for widget...', widget);

    if (!widget) {
        console.warn('[Vapi] Widget element not found.');
        return;
    }

    // Wait for the custom element to be defined
    await customElements.whenDefined('vapi-widget');

    // Remove existing listeners if any (cloneNode doesn't copy listeners, but good to be safe if reused)
    // Note: We can't easily remove anonymous listeners, but we are attaching to a new node in the main flow.

    // --- 1. Call Start (Open Modal Automatically) ---
    widget.addEventListener('call-start', (event) => {
        console.log('[Vapi] Call started:', event.detail);
        const callId = event.detail?.id || event.detail?.callId;
        const startedAt = event.detail?.startedAt || event.detail?.timestamp;

        // Only open automatically if the call is "fresh" (started in the last 15 seconds)
        // This prevents auto-opening for stale/active sessions on page load
        const isFresh = !startedAt || (new Date() - new Date(startedAt)) < 15000;

        if (callId && window.openLiveModal && isFresh) {
            console.log('[Vapi] Automatically opening live transcript modal for:', callId);
            window.openLiveModal(callId);
        } else {
            console.log('[Vapi] Automatic opening skipped (not fresh or missing ID).');
        }
    });

    // --- 2. Call End (Trigger Processing & Fallbacks) ---
    const endEvents = ['call-end', 'call-ended'];
    endEvents.forEach(evtName => {
        widget.addEventListener(evtName, (event) => {
            console.log(`[Vapi] ${evtName} event fired:`, event.detail);
            handleVapiCallEnd(event.detail);
        });
    });

    // --- 3. Message Listener (Fallback for all events) ---
    widget.addEventListener('message', (event) => {
        const detail = event.detail;
        if (!detail) return;

        if (detail.type === 'call-start') {
            const callId = detail.call?.id || detail.callId;
            const startedAt = detail.call?.startedAt || detail.timestamp;
            const isFresh = !startedAt || (new Date() - new Date(startedAt)) < 15000;

            if (callId && window.openLiveModal && isFresh) {
                window.openLiveModal(callId);
            }
        } else if (detail.type === 'call-end' || detail.status === 'ended') {
            handleVapiCallEnd(detail);
        }
    });
};

async function handleVapiCallEnd(callDetail) {
    console.log('[Vapi] Handling call end:', callDetail);

    // Extract recording URL if available immediately
    const recordingUrl = callDetail?.recordingUrl ||
        callDetail?.stereoRecordingUrl ||
        callDetail?.artifact?.recordingUrl;

    if (recordingUrl) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `vapi_call_${timestamp}.wav`;

        if (window.notificationService) {
            window.notificationService.showToast('Call Ended', 'Initiating processing...', 'info', 'fa-phone-slash');
        }

        try {
            const response = await fetch('/api/vapi-call', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    recording_url: recordingUrl,
                    filename: filename
                })
            });

            if (response.ok) {
                console.log('[Vapi] Backend processing triggered.');
            }
        } catch (err) {
            console.error('[Vapi] Error triggering backend:', err);
        }
    }

    // Optional: Refresh list after a short delay
    setTimeout(() => {
        if (window.fetchLiveCalls) window.fetchLiveCalls();
    }, 2000);
}

document.addEventListener('DOMContentLoaded', () => {
    const widget = document.querySelector('vapi-widget');
    window.initializeVapiEvents(widget);
});
