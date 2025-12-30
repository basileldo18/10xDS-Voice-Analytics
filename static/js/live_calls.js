
document.addEventListener('DOMContentLoaded', () => {
    const liveCallsTableBody = document.getElementById('live-calls-table-body');
    const refreshBtn = document.getElementById('refresh-live-calls');
    const liveModal = document.getElementById('live-transcript-modal');
    const modalCloseBtn = document.getElementById('close-live-modal');
    const liveTranscriptContainer = document.getElementById('live-transcript-container');
    const connectionStatus = document.getElementById('live-connection-status');

    let activeSubscription = null;
    let currentCallId = null;

    // --- Sidebar Navigation for Live Calls ---
    const liveNavLink = document.getElementById('nav-live-calls');
    if (liveNavLink) {
        liveNavLink.addEventListener('click', (e) => {
            // Navigation handled by main.js
            window.fetchLiveCalls();
        });
    }

    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => window.fetchLiveCalls());
    }

    if (modalCloseBtn) {
        modalCloseBtn.addEventListener('click', () => window.closeLiveModal());
    }

    // --- Fetch Live Calls ---
    window.fetchLiveCalls = async function () {
        if (!window.appSupabase) return;

        try {
            liveCallsTableBody.innerHTML = '<tr><td colspan="4" style="text-align:center;">Loading...</td></tr>';

            // Fetch calls that are not 'ended'
            // Added secondary safety check: Only show calls from the last 12 hours to avoid "stuck" calls
            const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();

            const { data, error } = await window.appSupabase
                .from('vapi_calls')
                .select('*')
                .neq('status', 'ended')
                .gt('created_at', twelveHoursAgo)
                .order('created_at', { ascending: false })
                .limit(20);

            if (error) throw error;

            liveCallsTableBody.innerHTML = '';

            if (!data || data.length === 0) {
                liveCallsTableBody.innerHTML = '<tr><td colspan="4" style="text-align:center;">No active calls found.</td></tr>';
                return;
            }

            data.forEach(call => {
                // Filter out stale records: If a call is 'in-progress' but hasn't been updated in 30 minutes, it's likely stuck.
                const lastUpdate = new Date(call.updated_at || call.created_at);
                const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000);

                if (call.status === 'in-progress' && lastUpdate < thirtyMinsAgo) {
                    console.log(`[Live] Hiding stale call: ${call.call_id}`);
                    return;
                }

                const row = document.createElement('tr');
                // Only show as 'Live' if status is specifically 'in-progress'
                const isLive = call.status === 'in-progress' || call.status === 'started';
                const statusColor = isLive ? '#22c55e' : '#64748b';
                const statusLabel = isLive ? 'Live' : (call.status.charAt(0).toUpperCase() + call.status.slice(1));

                row.innerHTML = `
                    <td>
                        <span style="display:inline-flex; align-items:center; gap:5px; font-weight:600; color:${statusColor};">
                            <i class="fa-solid fa-circle ${isLive ? 'pulse' : ''}" style="font-size:8px;"></i> ${statusLabel}
                        </span>
                    </td>
                    <td>${call.call_id ? call.call_id.substring(0, 8) + '...' : 'Unknown'}</td>
                    <td>${new Date(call.created_at).toLocaleString()}</td>
                    <td>
                        <button class="btn-action view-live-btn" data-id="${call.call_id}">
                            <i class="fa-solid fa-eye"></i> Live View
                        </button>
                    </td>
                `;

                // Make the entire row clickable
                row.style.cursor = 'pointer';
                row.addEventListener('click', (e) => {
                    // Prevent double-trigger if the button itself was clicked (since it has its own listener)
                    if (e.target.closest('.view-live-btn')) return;
                    openLiveModal(call.call_id);
                });

                liveCallsTableBody.appendChild(row);
            });

            // Attach Click Listeners
            document.querySelectorAll('.view-live-btn').forEach(btn => {
                btn.addEventListener('click', () => openLiveModal(btn.dataset.id));
            });

        } catch (err) {
            console.error('Error fetching live calls:', err);
            liveCallsTableBody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:red;">Error: ${err.message}</td></tr>`;
        }
    }

    // --- Live Transcript Modal ---
    window.openLiveModal = async function (callId) {
        if (!callId) return;
        currentCallId = callId;

        console.log('[Live] Opening modal for call:', callId);

        // Show modal
        liveModal.style.display = 'flex';
        document.body.style.overflow = 'hidden';

        // Update Header Info
        const callIdDisplay = document.getElementById('live-call-id');
        if (callIdDisplay) callIdDisplay.textContent = callId.substring(0, 8) + '...';

        // Reset Status
        connectionStatus.textContent = 'Connecting...';

        // Clear previous content and show loading
        liveTranscriptContainer.innerHTML = `
            <div class="empty-state">
                <div class="loader-spinner" style="border-top-color:#9344B3; width:30px; height:30px;"></div>
                <p>Connecting to live stream...</p>
            </div>`;

        // 1. Fetch History
        await fetchTranscriptHistory(callId);

        // 2. Subscribe to Realtime
        subscribeToCall(callId);
    };

    window.closeLiveModal = function () {
        liveModal.style.display = 'none';
        document.body.style.overflow = '';
        currentCallId = null;
        if (activeSubscription) {
            window.appSupabase.removeChannel(activeSubscription);
            activeSubscription = null;
        }
    };

    // Close button in footer
    const closeBtnFooter = document.getElementById('close-live-modal-btn');
    if (closeBtnFooter) {
        closeBtnFooter.addEventListener('click', () => window.closeLiveModal());
    }

    // Copy button
    const copyBtn = document.getElementById('copy-live-btn');
    if (copyBtn) {
        copyBtn.addEventListener('click', () => {
            const text = Array.from(liveTranscriptContainer.querySelectorAll('.msg-text'))
                .map(el => {
                    const role = el.parentElement.querySelector('.msg-meta').textContent.trim();
                    return `${role}: ${el.textContent.trim()}`;
                })
                .join('\n\n');

            navigator.clipboard.writeText(text).then(() => {
                const icon = copyBtn.querySelector('i');
                if (icon) {
                    const originalClass = icon.className;
                    icon.className = 'fa-solid fa-check';
                    const originalText = copyBtn.lastChild.textContent;
                    copyBtn.lastChild.textContent = ' Copied';

                    setTimeout(() => {
                        icon.className = originalClass;
                        copyBtn.lastChild.textContent = originalText;
                    }, 2000);
                }
            }).catch(err => console.error('Failed to copy to clipboard:', err));
        });
    }

    // Close on backdrop click
    liveModal.addEventListener('click', (e) => {
        if (e.target === liveModal || e.target.classList.contains('modal-backdrop')) {
            window.closeLiveModal();
        }
    });

    async function fetchTranscriptHistory(callId) {
        // Show loading if empty and not just placeholder
        if ((!liveTranscriptContainer.hasChildNodes() || liveTranscriptContainer.innerHTML.trim() === '') && !liveTranscriptContainer.querySelector('.empty-state')) {
            liveTranscriptContainer.innerHTML = `
                <div class="empty-state">
                    <div class="loader-spinner" style="border-top-color:#9344B3; width:30px; height:30px;"></div>
                    <p>Loading conversation history...</p>
                </div>`;
        }

        const { data, error } = await window.appSupabase
            .from('transcripts')
            .select('*')
            .eq('call_id', callId)
            .order('timestamp', { ascending: true });

        if (error) {
            console.error('[Live] Error fetching history:', error);
            // Only show error if empty
            if (liveTranscriptContainer.querySelector('.empty-state')) {
                liveTranscriptContainer.innerHTML = `<div class="empty-state" style="color:red"><p>Error loading history.</p></div>`;
            }
            return;
        }

        // Remove loading state if present
        const emptyState = liveTranscriptContainer.querySelector('.empty-state');
        if (emptyState) emptyState.remove();

        if (!data || data.length === 0) {
            if (!liveTranscriptContainer.hasChildNodes()) {
                liveTranscriptContainer.innerHTML = '<div class="empty-state"><p>No transcripts yet. Waiting for speech...</p></div>';
            }
            return;
        }

        // Upsert messages
        data.forEach(t => upsertTranscriptToUI(t));
        scrollToBottom();
    }

    function subscribeToCall(callId) {
        if (activeSubscription) {
            window.appSupabase.removeChannel(activeSubscription);
        }

        connectionStatus.textContent = 'Connecting...';

        activeSubscription = window.appSupabase
            .channel(`live-call-${callId}`)
            .on(
                'postgres_changes',
                {
                    event: '*', // Listen to INSERT and UPDATE (for merged turns)
                    schema: 'public',
                    table: 'transcripts',
                    filter: `call_id=eq.${callId}`
                },
                (payload) => {
                    console.log('Realtime update:', payload);
                    handleRealtimeUpdate(payload);
                }
            )
            .subscribe((status) => {
                if (status === 'SUBSCRIBED') {
                    connectionStatus.textContent = 'Live Connected';
                    connectionStatus.parentElement.querySelector('i').classList.add('pulse'); // Add pulse effect
                }
            });
    }

    function handleRealtimeUpdate(payload) {
        // Remove empty state if it exists
        const emptyState = document.querySelector('#live-transcript-container .empty-state');
        if (emptyState) emptyState.remove();

        const newRec = payload.new;
        if (!newRec) return;

        upsertTranscriptToUI(newRec);
        scrollToBottom();
    }

    function upsertTranscriptToUI(t) {
        const existingNode = document.getElementById(`msg-${t.id}`);

        if (existingNode) {
            // Update existing
            existingNode.querySelector('.msg-text').textContent = t.transcript;
            return;
        }

        // Create new
        const isUser = t.role === 'user';

        // Use classes for styling instead of inline styles
        const div = document.createElement('div');
        div.id = `msg-${t.id}`;
        div.className = `transcript-row ${isUser ? 'user-row' : 'assistant-row'}`;

        // Inline layout styles as fallback/ensurance (matching main style.css logic if classes aren't enough)
        div.style.display = 'flex';
        div.style.flexDirection = 'column';
        div.style.alignItems = isUser ? 'flex-end' : 'flex-start';
        div.style.marginBottom = '16px';

        // Message Bubble Style
        const bubbleBg = isUser ? 'linear-gradient(135deg, #f3e8ff 0%, #e9d5ff 100%)' : '#ffffff';
        const bubbleColor = isUser ? '#581c87' : '#1e293b';
        const bubbleBorder = isUser ? 'none' : '1px solid #e2e8f0';
        const bubbleRadius = isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px';

        div.innerHTML = `
            <div class="msg-meta" style="font-size: 0.75rem; color: #64748b; margin-bottom: 4px; padding: 0 4px;">
                ${t.role === 'user' ? 'User' : 'Assistant'}
            </div>
            <div class="msg-text" style="
                padding: 12px 16px; 
                max-width: 85%; 
                background: ${bubbleBg}; 
                color: ${bubbleColor}; 
                border-radius: ${bubbleRadius}; 
                border: ${bubbleBorder};
                box-shadow: 0 2px 4px rgba(0,0,0,0.05);
                line-height: 1.5;
                font-size: 0.95rem;">
                ${t.transcript}
            </div>
        `;
        liveTranscriptContainer.appendChild(div);
    }

    // --- Subscribe to Live Calls List (Auto-Refresh) ---
    function subscribeToLiveCallsList() {
        window.appSupabase
            .channel('live-calls-list')
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'vapi_calls' },
                (payload) => {
                    console.log('Live Calls List Update:', payload);
                    handleCallListUpdate(payload);
                }
            )
            .subscribe();
    }

    function handleCallListUpdate(payload) {
        const newCall = payload.new;
        if (!newCall) return;

        // Check if row already exists
        let row = Array.from(liveCallsTableBody.querySelectorAll('tr')).find(tr => {
            const btn = tr.querySelector('.view-live-btn');
            return btn && btn.dataset.id === newCall.call_id;
        });

        if (newCall.status === 'ended') {
            if (row) {
                row.remove();
                if (liveCallsTableBody.children.length === 0) {
                    liveCallsTableBody.innerHTML = '<tr><td colspan="4" style="text-align:center;">No active calls found.</td></tr>';
                }
            }
            return;
        }

        const isLive = newCall.status === 'in-progress' || newCall.status === 'started';

        // Filter out stale records: If a call is 'in-progress' but hasn't been updated in 30 minutes, ignore it.
        const lastUpdate = new Date(newCall.updated_at || newCall.created_at);
        const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000);

        if (isLive && lastUpdate < thirtyMinsAgo) {
            console.log(`[Live] Ignoring stale update: ${newCall.call_id}`);
            if (row) row.remove();
            return;
        }

        const statusColor = isLive ? '#22c55e' : '#64748b';
        const statusLabel = isLive ? 'Live' : (newCall.status.charAt(0).toUpperCase() + newCall.status.slice(1));

        const rowHTML = `
            <td>
                <span style="display:inline-flex; align-items:center; gap:5px; font-weight:600; color:${statusColor};">
                    <i class="fa-solid fa-circle ${isLive ? 'pulse' : ''}" style="font-size:8px;"></i> ${statusLabel}
                </span>
            </td>
            <td>${newCall.call_id ? newCall.call_id.substring(0, 8) + '...' : 'Unknown'}</td>
            <td>${new Date(newCall.created_at).toLocaleString()}</td>
            <td>
                <button class="btn-action view-live-btn" data-id="${newCall.call_id}">
                    <i class="fa-solid fa-eye"></i> Live View
                </button>
            </td>
        `;

        if (row) {
            // Update existing row
            row.innerHTML = rowHTML;
            // Re-attach listener
            const btn = row.querySelector('.view-live-btn');
            if (btn) btn.addEventListener('click', () => openLiveModal(btn.dataset.id));
        } else {
            // Prepend new row
            const newRow = document.createElement('tr');
            newRow.innerHTML = rowHTML;

            // Remove "No calls" message if present
            if (liveCallsTableBody.querySelector('td[colspan]')) {
                liveCallsTableBody.innerHTML = '';
            }

            liveCallsTableBody.insertBefore(newRow, liveCallsTableBody.firstChild);

            // Add row click listener for new row
            newRow.style.cursor = 'pointer';
            newRow.addEventListener('click', (e) => {
                if (e.target.closest('.view-live-btn')) return;
                openLiveModal(newCall.call_id);
            });

            // Attach listener
            const btn = newRow.querySelector('.view-live-btn');
            if (btn) btn.addEventListener('click', () => openLiveModal(btn.dataset.id));
        }
    }

    // Initialize
    subscribeToLiveCallsList();

    // Initial Fetch
    window.fetchLiveCalls();

    function scrollToBottom() {
        liveTranscriptContainer.scrollTop = liveTranscriptContainer.scrollHeight;
    }
});
