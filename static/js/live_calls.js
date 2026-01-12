
document.addEventListener('DOMContentLoaded', () => {
    const liveCallsTableBody = document.getElementById('live-calls-table-body');
    const refreshBtn = document.getElementById('refresh-live-calls');
    const liveModal = document.getElementById('live-transcript-modal');
    const modalCloseBtn = document.getElementById('close-live-modal');
    const modalCloseBtnTop = document.getElementById('close-live-modal-top');
    const liveTranscriptContainer = document.getElementById('live-transcript-container');
    const connectionStatus = document.getElementById('live-connection-status');

    let activeSubscription = null;
    let currentCallId = null;
    let lastRole = null; // Track last role to group messages

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
    if (modalCloseBtnTop) {
        modalCloseBtnTop.addEventListener('click', () => window.closeLiveModal());
    }

    // --- Fetch Live Calls ---
    window.fetchLiveCalls = async function () {
        if (!window.appSupabase) return;

        try {
            console.log('[Live] Fetching calls...');

            // Fetch ONLY active calls (in-progress or started)
            const { data, error } = await window.appSupabase
                .from('vapi_calls')
                .select('*')
                .in('status', ['in-progress', 'started'])
                .order('created_at', { ascending: false });

            if (error) {
                console.error('[Live] Supabase error:', error);
                throw error;
            }

            liveCallsTableBody.innerHTML = '';

            if (!data || data.length === 0) {
                liveCallsTableBody.innerHTML = '<tr><td colspan="4" style="text-align:center;">No active live calls at the moment.</td></tr>';
                return;
            }

            console.log(`[Live] Found ${data.length} calls.`);

            data.forEach(call => {
                const row = document.createElement('tr');

                const isLive = call.status === 'in-progress' || call.status === 'started';
                const isEnded = call.status === 'ended';

                let statusColor = '#64748b'; // Default gray
                let statusLabel = (call.status || 'Unknown').charAt(0).toUpperCase() + (call.status || 'unknown').slice(1);
                let badgeClass = '';

                if (isLive) {
                    statusColor = '#22c55e'; // Green
                    statusLabel = 'Live';
                    badgeClass = 'pulse';
                } else if (isEnded) {
                    statusColor = '#94a3b8'; // Lighter gray
                }

                row.innerHTML = `
                    <td>
                        <span style="display:inline-flex; align-items:center; gap:5px; font-weight:600; color:${statusColor};">
                            <i class="fa-solid fa-circle ${badgeClass}" style="font-size:8px;"></i> ${statusLabel}
                        </span>
                    </td>
                    <td>${call.call_id ? call.call_id.substring(0, 8) + '...' : 'Unknown'}</td>
                    <td>${new Date(call.created_at).toLocaleString()}</td>
                    <td>
                        <button class="btn-action view-live-btn" data-id="${call.call_id}">
                            <i class="fa-solid ${isLive ? 'fa-eye' : 'fa-list-alt'}"></i> ${isLive ? 'Live View' : 'Transcript'}
                        </button>
                    </td>
                `;

                // Make the entire row clickable
                row.style.cursor = 'pointer';
                row.addEventListener('click', (e) => {
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
            if (liveCallsTableBody) {
                liveCallsTableBody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:red;">Error: ${err.message}</td></tr>`;
            }
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
        // Removed call ID display from header since it's not in the new UI design

        // Update Date
        const dateDisplay = document.getElementById('live-chat-date');
        if (dateDisplay) {
            const now = new Date();
            const options = { day: 'numeric', month: 'long', year: 'numeric' };
            dateDisplay.textContent = now.toLocaleDateString('en-GB', options);
        }

        // Reset Status
        connectionStatus.textContent = 'Connecting...';
        lastRole = null;

        // Clear previous content and show loading
        liveTranscriptContainer.innerHTML = `
            <div class="chat-date-separator">
                <span class="chat-date-text" id="live-chat-date">Today</span>
            </div>
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
            const text = Array.from(liveTranscriptContainer.querySelectorAll('.chat-msg-row'))
                .map(el => {
                    const role = el.classList.contains('sent') ? 'User' : 'Assistant';
                    const content = el.querySelector('.msg-bubble').textContent.trim();
                    return `${role}: ${content}`;
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
            // Update existing text
            const textEl = existingNode.querySelector('.msg-bubble');
            if (textEl) textEl.textContent = t.transcript;
            return;
        }

        // Create new
        const isUser = t.role === 'user';
        const roleName = isUser ? 'User' : 'Assistant';

        // Avatars matching design
        const userAvatar = "https://ui-avatars.com/api/?name=User&background=000000&color=fff";
        const assistantAvatar = "https://ui-avatars.com/api/?name=AS&background=dcd7ff&color=581c87";
        const avatarSrc = isUser ? userAvatar : assistantAvatar;

        const div = document.createElement('div');
        div.id = `msg-${t.id}`;
        div.className = `chat-msg-row ${isUser ? 'sent' : 'received'}`;

        // Grouping logic (simplified)
        if (lastRole === t.role) {
            div.classList.add('group-mid');
        }
        lastRole = t.role;

        div.innerHTML = `
            <img src="${avatarSrc}" class="msg-avatar" alt="${roleName}">
            <div class="msg-content">
                <div class="msg-meta">${roleName}</div>
                <div class="msg-bubble">
                    ${t.transcript}
                </div>
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

        if (isLive) {
            console.log(`[Live] Received active call: ${newCall.call_id}, Last Update: ${lastUpdate}`);
            // Removed strict stale check to ensure visibility
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
