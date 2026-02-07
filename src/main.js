import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

// Initialize Supabase Client with proper session persistence
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
        persistSession: true,
        storageKey: 'xmat-auth',
        storage: window.localStorage,
        autoRefreshToken: true,
        detectSessionInUrl: true
    }
});

// Edge Function URL for secure API calls
const EDGE_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/search-number`;

// State
let currentUser = null;
let userProfile = null;
let currentConversation = null;
let messageSubscription = null;

// DOM Elements
const loginPage = document.getElementById('login-page');
const dashboardPage = document.getElementById('dashboard-page');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const logoutBtn = document.getElementById('logout-btn');
const userNameEl = document.getElementById('user-name');
const adminNavBtn = document.getElementById('admin-nav-btn');

// Navigation
const navLinks = document.querySelectorAll('.nav-link');
const sections = document.querySelectorAll('.section');

// Search
const searchForm = document.getElementById('search-form');
const searchInput = document.getElementById('search-number');
const resultsContainer = document.getElementById('results-container');
const searchLoading = document.getElementById('search-loading');

// History
const historyContainer = document.getElementById('history-container');
const historyLoading = document.getElementById('history-loading');

// Admin
const adminSection = document.getElementById('admin-section');
const adminTabs = document.querySelectorAll('.admin-tab');
const adminContents = document.querySelectorAll('.admin-content');
const addUserForm = document.getElementById('add-user-form');
const addUserMessage = document.getElementById('add-user-message');
const usersList = document.getElementById('users-list');
const logsList = document.getElementById('logs-list');

// ===== Initialize App =====
async function initApp() {
    const { data: { session } } = await supabase.auth.getSession();

    if (session) {
        currentUser = session.user;
        await loadUserProfile();
        showDashboard();
    } else {
        showLogin();
    }

    // Auth state listener - only handle actual sign in/out, not session refresh
    supabase.auth.onAuthStateChange(async (event, session) => {
        // Skip initial session and token refresh events to avoid flicker
        if (event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') {
            return;
        }

        if (event === 'SIGNED_IN' && session) {
            // Only reload if user actually changed
            if (!currentUser || currentUser.id !== session.user.id) {
                currentUser = session.user;
                await loadUserProfile();
                showDashboard();
            }
        } else if (event === 'SIGNED_OUT') {
            currentUser = null;
            userProfile = null;
            showLogin();
        }
    });
}

// ===== Load User Profile =====
async function loadUserProfile() {
    if (!currentUser) return;

    const { data, error } = await supabase
        .from('nd_users')
        .select('*')
        .eq('id', currentUser.id)
        .single();

    if (error) {
        console.error('Error loading profile:', error);
        return;
    }

    userProfile = data;

    // Check if suspended
    if (userProfile.is_suspended) {
        alert('Your account has been suspended. Please contact admin.');
        await supabase.auth.signOut();
        return;
    }

    // Update UI
    userNameEl.textContent = userProfile.full_name || currentUser.email;

    // Show admin nav if admin
    if (userProfile.role === 'admin') {
        adminNavBtn.style.display = 'flex';
    }
}

// ===== Show/Hide Pages =====
function showLogin() {
    loginPage.classList.add('active');
    dashboardPage.classList.remove('active');
}

function showDashboard() {
    loginPage.classList.remove('active');
    dashboardPage.classList.add('active');
    loadHistory();
}

// ===== Login =====
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;

    loginError.classList.remove('show');

    const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
    });

    if (error) {
        loginError.textContent = error.message;
        loginError.classList.add('show');
        return;
    }

    // Check if user profile exists and not suspended
    const { data: profile, error: profileError } = await supabase
        .from('nd_users')
        .select('*')
        .eq('id', data.user.id)
        .single();

    if (profileError) {
        loginError.textContent = 'User profile not found. Contact admin.';
        loginError.classList.add('show');
        await supabase.auth.signOut();
        return;
    }

    if (profile.is_suspended) {
        loginError.textContent = 'Your account has been suspended.';
        loginError.classList.add('show');
        await supabase.auth.signOut();
        return;
    }

    // Log session with IP info
    await logSession(data.user.id);
});

// ===== Log Session with IP =====
async function logSession(userId) {
    try {
        // Get IP info from free API
        const ipResponse = await fetch('https://ipapi.co/json/');
        const ipData = await ipResponse.json();

        await supabase.from('nd_session_logs').insert({
            user_id: userId,
            ip_address: ipData.ip || 'Unknown',
            city: ipData.city || 'Unknown',
            region: ipData.region || 'Unknown',
            country: ipData.country_name || 'Unknown',
            isp: ipData.org || 'Unknown',
            user_agent: navigator.userAgent
        });
    } catch (err) {
        // Silent fail - don't block login
    }
}

// ===== Logout =====
logoutBtn.addEventListener('click', async () => {
    await supabase.auth.signOut();
});

// ===== Navigation =====
navLinks.forEach(link => {
    link.addEventListener('click', () => {
        const page = link.dataset.page;

        // Update nav active state
        navLinks.forEach(l => l.classList.remove('active'));
        link.classList.add('active');

        // Show corresponding section
        sections.forEach(s => s.classList.remove('active'));
        document.getElementById(`${page}-section`).classList.add('active');

        // Load data if needed
        if (page === 'history') {
            loadHistory();
        } else if (page === 'chat') {
            initChat();
        } else if (page === 'admin' && userProfile?.role === 'admin') {
            loadUsers();
            loadSearchLogs();
        }
    });
});

// ===== Search =====
searchForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const number = searchInput.value.trim();
    if (number.length !== 10 || !/^\d+$/.test(number)) {
        alert('Please enter a valid 10-digit mobile number');
        return;
    }

    await searchNumber(number);
});

async function searchNumber(number) {
    resultsContainer.innerHTML = '';
    searchLoading.style.display = 'flex';

    try {
        // Get current session for auth token
        const { data: { session } } = await supabase.auth.getSession();

        if (!session) {
            alert('Please login again');
            showLogin();
            return;
        }

        // Call Edge Function (API key is hidden on server)
        const response = await fetch(EDGE_FUNCTION_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session.access_token}`
            },
            body: JSON.stringify({ number })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Search failed');
        }

        if (!data.success || !data.result || data.result.length === 0) {
            resultsContainer.innerHTML = `
                <div class="no-data">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="11" cy="11" r="8"/>
                        <path d="m21 21-4.35-4.35"/>
                    </svg>
                    <p>No results found for this number</p>
                </div>
            `;
            return;
        }

        // Display results (history is saved by Edge Function)
        displayResults(data.result);

    } catch (error) {
        console.error('Search error:', error);
        resultsContainer.innerHTML = `
            <div class="no-data">
                <p>Error: ${error.message || 'Please try again.'}</p>
            </div>
        `;
    } finally {
        searchLoading.style.display = 'none';
    }
}

function displayResults(results) {
    resultsContainer.innerHTML = results.map((item, index) => `
        <div class="simple-result">
            <table class="result-table">
                <tr><td class="label">Name</td><td class="value">${item.name || 'N/A'}</td></tr>
                <tr><td class="label">Father's Name</td><td class="value">${item.father_name || 'N/A'}</td></tr>
                <tr><td class="label">Mobile</td><td class="value">${item.mobile || 'N/A'}</td></tr>
                <tr><td class="label">Alt Mobile</td><td class="value">${item.alt_mobile || 'N/A'}</td></tr>
                <tr><td class="label">Address</td><td class="value">${formatAddress(item.address) || 'N/A'}</td></tr>
                <tr><td class="label">ID Number</td><td class="value">${item.id_number || 'N/A'}</td></tr>
                <tr><td class="label">Circle</td><td class="value">${item.circle || 'N/A'}</td></tr>
                ${item.email ? `<tr><td class="label">Email</td><td class="value">${item.email}</td></tr>` : ''}
            </table>
        </div>
    `).join('');
}

function formatAddress(address) {
    if (!address) return null;
    return address
        .replace(/!/g, ', ')
        .replace(/,\s*,/g, ',')
        .replace(/,\s*$/g, '')
        .replace(/^\s*,/g, '')
        .trim();
}

function maskIdNumber(id) {
    if (!id) return null;
    return id; // Show full ID number
}

// ===== History =====
async function loadHistory() {
    if (!currentUser) return;

    historyLoading.style.display = 'flex';
    historyContainer.innerHTML = '';

    // Only select minimal fields - don't expose full result_data
    const { data, error } = await supabase
        .from('nd_search_history')
        .select('id, searched_number, result_data, created_at')
        .eq('user_id', currentUser.id)
        .order('created_at', { ascending: false })
        .limit(50);

    historyLoading.style.display = 'none';

    if (error) {
        console.error('Error loading history:', error);
        return;
    }

    if (!data || data.length === 0) {
        historyContainer.innerHTML = `
            <div class="history-empty">
                <p>No search history yet. Start searching!</p>
            </div>
        `;
        return;
    }

    historyContainer.innerHTML = data.map(item => `
        <div class="history-item" data-number="${item.searched_number}">
            <div class="history-number">${item.searched_number}</div>
            <div class="history-name">${item.result_data?.name || 'Unknown'}</div>
            <div class="history-time">${formatTime(item.created_at)}</div>
        </div>
    `).join('');

    // Add click handlers - re-search to get fresh data
    historyContainer.querySelectorAll('.history-item').forEach(item => {
        item.addEventListener('click', async () => {
            const number = item.dataset.number;
            navLinks.forEach(l => l.classList.remove('active'));
            document.querySelector('[data-page="search"]').classList.add('active');
            sections.forEach(s => s.classList.remove('active'));
            document.getElementById('search-section').classList.add('active');
            searchInput.value = number;
            // Re-search to get fresh data (not stored data)
            await searchNumber(number);
        });
    });
}

function getNameFromResult(result) {
    if (!result || result.length === 0) return 'Unknown';
    return result[0].name || 'Unknown';
}

function formatTime(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;

    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return date.toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// ===== Admin Functions =====
adminTabs.forEach(tab => {
    tab.addEventListener('click', () => {
        const tabName = tab.dataset.tab;

        adminTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        adminContents.forEach(c => c.classList.remove('active'));
        document.getElementById(`${tabName}-tab`).classList.add('active');

        if (tabName === 'users') loadUsers();
        if (tabName === 'logs') loadSearchLogs();
        if (tabName === 'sessions') loadSessionLogs();
    });
});

async function loadUsers() {
    if (userProfile?.role !== 'admin') return;

    usersList.innerHTML = '<div class="loading-state"><div class="spinner"></div><p>Loading users...</p></div>';

    const { data, error } = await supabase
        .from('nd_users')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Error loading users:', error);
        usersList.innerHTML = '<div class="no-data"><p>Error loading users</p></div>';
        return;
    }

    if (!data || data.length === 0) {
        usersList.innerHTML = '<div class="no-data"><p>No users found</p></div>';
        return;
    }

    usersList.innerHTML = data.map(user => `
        <div class="user-card" data-user-id="${user.id}">
            <div class="user-avatar">${(user.full_name || 'U').charAt(0).toUpperCase()}</div>
            <div class="user-info">
                <h4>
                    ${user.full_name || 'Unknown'}
                    ${user.role === 'admin' ? '<span class="user-badge admin">Admin</span>' : ''}
                    ${user.is_suspended ? '<span class="user-badge suspended">Suspended</span>' : ''}
                </h4>
                <p>Created: ${new Date(user.created_at).toLocaleDateString('en-IN')}</p>
            </div>
            <div class="user-stats">
                <span>${user.search_count || 0}</span>
                <span>Searches</span>
            </div>
            <div class="user-actions">
                ${user.id !== currentUser.id ? `
                    <button class="btn btn-sm ${user.is_suspended ? 'btn-success' : 'btn-danger'}" 
                            onclick="toggleUserSuspension('${user.id}', ${!user.is_suspended})">
                        ${user.is_suspended ? 'Activate' : 'Suspend'}
                    </button>
                ` : ''}
            </div>
        </div>
    `).join('');
}

window.toggleUserSuspension = async function (userId, suspend) {
    const { error } = await supabase
        .from('nd_users')
        .update({ is_suspended: suspend })
        .eq('id', userId);

    if (error) {
        alert('Error updating user: ' + error.message);
        return;
    }

    loadUsers();
};

addUserForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = document.getElementById('new-user-name').value;
    const email = document.getElementById('new-user-email').value;
    const password = document.getElementById('new-user-password').value;
    const role = document.getElementById('new-user-role').value;

    addUserMessage.className = 'message';
    addUserMessage.textContent = 'Creating user...';

    try {
        const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
            email,
            password,
            options: {
                data: { full_name: name }
            }
        });

        if (signUpError) {
            throw signUpError;
        }

        // Update role if admin
        if (role === 'admin' && signUpData.user) {
            await supabase
                .from('nd_users')
                .update({ role: 'admin' })
                .eq('id', signUpData.user.id);
        }

        addUserMessage.className = 'message success';
        addUserMessage.textContent = `User ${email} created successfully!`;
        addUserForm.reset();
        loadUsers();

    } catch (error) {
        console.error('Error creating user:', error);
        addUserMessage.className = 'message error';
        addUserMessage.textContent = error.message || 'Error creating user';
    }
});

async function loadSearchLogs() {
    if (userProfile?.role !== 'admin') return;

    logsList.innerHTML = '<div class="loading-state"><div class="spinner"></div><p>Loading logs...</p></div>';

    const { data, error } = await supabase
        .from('nd_search_history')
        .select(`
            *,
            nd_users (full_name)
        `)
        .order('created_at', { ascending: false })
        .limit(100);

    if (error) {
        console.error('Error loading logs:', error);
        logsList.innerHTML = '<div class="no-data"><p>Error loading logs</p></div>';
        return;
    }

    if (!data || data.length === 0) {
        logsList.innerHTML = '<div class="no-data"><p>No search logs found</p></div>';
        return;
    }

    logsList.innerHTML = data.map(log => `
        <div class="log-item">
            <div class="log-user">${log.nd_users?.full_name || 'Unknown'}</div>
            <div class="log-number">${log.searched_number}</div>
            <div class="log-name">${log.result_data?.name || 'Unknown'}</div>
            <div class="log-time">${formatTime(log.created_at)}</div>
        </div>
    `).join('');
}

// ===== Load Session Logs (IP Tracking) =====
const sessionsList = document.getElementById('sessions-list');

async function loadSessionLogs() {
    if (userProfile?.role !== 'admin') return;

    sessionsList.innerHTML = '<div class="loading-state"><div class="spinner"></div><p>Loading sessions...</p></div>';

    const { data, error } = await supabase
        .from('nd_session_logs')
        .select(`
            *,
            nd_users (full_name)
        `)
        .order('created_at', { ascending: false })
        .limit(100);

    if (error) {
        console.error('Error loading sessions:', error);
        sessionsList.innerHTML = '<div class="no-data"><p>Error loading sessions</p></div>';
        return;
    }

    if (!data || data.length === 0) {
        sessionsList.innerHTML = '<div class="no-data"><p>No session logs found</p></div>';
        return;
    }

    sessionsList.innerHTML = data.map(session => {
        const name = session.nd_users?.full_name || 'Unknown';
        const initials = name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
        return `
            <div class="session-item">
                <div class="session-avatar">${initials}</div>
                <div class="session-info">
                    <div class="session-user">${name}</div>
                    <div class="session-location">${session.city || 'Unknown'}, ${session.country || 'Unknown'}</div>
                </div>
                <div class="session-meta">
                    <div class="session-ip">${session.ip_address}</div>
                    <div class="session-isp">${session.isp || 'Unknown ISP'}</div>
                    <div class="session-time">${formatTime(session.created_at)}</div>
                </div>
            </div>
        `;
    }).join('');
}

// ===== ANONYMOUS CHAT FUNCTIONS =====
const myChatIdEl = document.getElementById('my-chat-id');
const copyChatIdBtn = document.getElementById('copy-chat-id');
const newChatBtn = document.getElementById('new-chat-btn');
const conversationsList = document.getElementById('conversations-list');
const chatWelcome = document.getElementById('chat-welcome');
const chatActive = document.getElementById('chat-active');
const chatPartnerId = document.getElementById('chat-partner-id');
const messagesContainer = document.getElementById('messages-container');
const messageInput = document.getElementById('message-input');
const sendMessageBtn = document.getElementById('send-message-btn');
const newChatModal = document.getElementById('new-chat-modal');
const closeModalBtn = document.getElementById('close-modal-btn');
const searchUserIdInput = document.getElementById('search-user-id');
const searchUserResult = document.getElementById('search-user-result');
const startChatBtn = document.getElementById('start-chat-btn');
const backToChatsBtn = document.getElementById('back-to-chats');
const chatSidebar = document.querySelector('.chat-sidebar');

let foundUserId = null;

async function initChat() {
    if (!userProfile) return;

    // Generate chat_id if not exists
    if (!userProfile.chat_id) {
        const newChatId = generateChatId();
        await supabase.from('nd_users').update({ chat_id: newChatId }).eq('id', currentUser.id);
        userProfile.chat_id = newChatId;
    }

    myChatIdEl.textContent = userProfile.chat_id;
    await loadConversations();
}

function generateChatId() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 8; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

async function loadConversations() {
    const { data, error } = await supabase
        .from('nd_conversations')
        .select('*')
        .or(`user1_id.eq.${currentUser.id},user2_id.eq.${currentUser.id}`)
        .order('last_message_at', { ascending: false });

    if (error || !data || data.length === 0) {
        conversationsList.innerHTML = `
            <div class="no-chats">
                <p>No chats yet</p>
                <p class="hint">Click "New Chat" to start</p>
            </div>
        `;
        return;
    }

    // Get partner chat IDs
    const partnerIds = data.map(c => c.user1_id === currentUser.id ? c.user2_id : c.user1_id);
    const { data: partners } = await supabase.from('nd_users').select('id, chat_id').in('id', partnerIds);
    const partnerMap = {};
    partners?.forEach(p => partnerMap[p.id] = p.chat_id);

    conversationsList.innerHTML = data.map(conv => {
        const partnerId = conv.user1_id === currentUser.id ? conv.user2_id : conv.user1_id;
        const partnerChatId = partnerMap[partnerId] || 'Unknown';
        return `
            <div class="conversation-item" data-conv-id="${conv.id}" data-partner-id="${partnerId}" data-partner-chat-id="${partnerChatId}">
                <div class="conversation-avatar">${partnerChatId.substring(0, 2)}</div>
                <div class="conversation-info">
                    <div class="conversation-id">${partnerChatId}</div>
                    <div class="conversation-preview">${conv.last_message || 'No messages yet'}</div>
                </div>
                <div class="conversation-time">${formatTime(conv.last_message_at)}</div>
            </div>
        `;
    }).join('');

    // Add click handlers
    document.querySelectorAll('.conversation-item').forEach(item => {
        item.addEventListener('click', () => openChat(item.dataset.convId, item.dataset.partnerChatId));
    });
}

async function openChat(convId, partnerChatId) {
    currentConversation = convId;

    // Update UI
    chatWelcome.style.display = 'none';
    chatActive.style.display = 'flex';
    chatPartnerId.textContent = partnerChatId;

    // Mark conversation as active
    document.querySelectorAll('.conversation-item').forEach(c => c.classList.remove('active'));
    document.querySelector(`[data-conv-id="${convId}"]`)?.classList.add('active');

    // Hide sidebar on mobile
    if (window.innerWidth <= 768) {
        chatSidebar?.classList.add('hidden');
    }

    // Load messages
    await loadMessages(convId);

    // Subscribe to new messages
    subscribeToMessages(convId);
}

async function loadMessages(convId) {
    const { data, error } = await supabase
        .from('nd_messages')
        .select('*')
        .eq('conversation_id', convId)
        .order('created_at', { ascending: true });

    if (error || !data) {
        messagesContainer.innerHTML = '<p class="no-chats">Error loading messages</p>';
        return;
    }

    messagesContainer.innerHTML = data.map(msg => `
        <div class="message ${msg.sender_id === currentUser.id ? 'sent' : 'received'}">
            ${msg.content}
            <div class="message-time">${formatTime(msg.created_at)}</div>
        </div>
    `).join('');

    // Scroll to bottom
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function subscribeToMessages(convId) {
    // Unsubscribe from previous
    if (messageSubscription) {
        messageSubscription.unsubscribe();
    }

    messageSubscription = supabase
        .channel(`messages:${convId}`)
        .on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'nd_messages',
            filter: `conversation_id=eq.${convId}`
        }, (payload) => {
            const msg = payload.new;
            const msgEl = document.createElement('div');
            msgEl.className = `message ${msg.sender_id === currentUser.id ? 'sent' : 'received'}`;
            msgEl.innerHTML = `${msg.content}<div class="message-time">${formatTime(msg.created_at)}</div>`;
            messagesContainer.appendChild(msgEl);
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        })
        .subscribe();
}

async function sendMessage() {
    if (!currentConversation || !messageInput.value.trim()) return;

    const content = messageInput.value.trim();
    messageInput.value = '';

    await supabase.from('nd_messages').insert({
        conversation_id: currentConversation,
        sender_id: currentUser.id,
        content: content
    });

    // Update last message
    await supabase.from('nd_conversations').update({
        last_message: content,
        last_message_at: new Date().toISOString()
    }).eq('id', currentConversation);
}

// Event Listeners
sendMessageBtn?.addEventListener('click', sendMessage);
messageInput?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});

copyChatIdBtn?.addEventListener('click', () => {
    navigator.clipboard.writeText(userProfile?.chat_id || '');
    copyChatIdBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20,6 9,17 4,12"/></svg>';
    setTimeout(() => {
        copyChatIdBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
    }, 2000);
});

// Mobile back button
backToChatsBtn?.addEventListener('click', () => {
    chatSidebar?.classList.remove('hidden');
    chatActive.style.display = 'none';
    chatWelcome.style.display = 'flex';
    currentConversation = null;
});

newChatBtn?.addEventListener('click', () => {
    newChatModal.style.display = 'flex';
    searchUserIdInput.value = '';
    searchUserResult.innerHTML = '';
    searchUserResult.className = 'search-result';
    startChatBtn.disabled = true;
    foundUserId = null;
});

closeModalBtn?.addEventListener('click', () => {
    newChatModal.style.display = 'none';
});

searchUserIdInput?.addEventListener('input', async (e) => {
    const chatId = e.target.value.toUpperCase().trim();
    foundUserId = null;
    startChatBtn.disabled = true;

    if (chatId.length !== 8) {
        searchUserResult.innerHTML = '';
        return;
    }

    if (chatId === userProfile?.chat_id) {
        searchUserResult.innerHTML = 'Cannot chat with yourself';
        searchUserResult.className = 'search-result not-found';
        return;
    }

    const { data } = await supabase.from('nd_users').select('id, chat_id').eq('chat_id', chatId).single();

    if (data) {
        foundUserId = data.id;
        searchUserResult.innerHTML = `✓ User found: ${data.chat_id}`;
        searchUserResult.className = 'search-result found';
        startChatBtn.disabled = false;
    } else {
        searchUserResult.innerHTML = '✗ User not found';
        searchUserResult.className = 'search-result not-found';
    }
});

startChatBtn?.addEventListener('click', async () => {
    if (!foundUserId) return;

    // Check if conversation exists
    const { data: existing } = await supabase
        .from('nd_conversations')
        .select('*')
        .or(`and(user1_id.eq.${currentUser.id},user2_id.eq.${foundUserId}),and(user1_id.eq.${foundUserId},user2_id.eq.${currentUser.id})`)
        .single();

    if (existing) {
        newChatModal.style.display = 'none';
        const { data: partner } = await supabase.from('nd_users').select('chat_id').eq('id', foundUserId).single();
        openChat(existing.id, partner?.chat_id);
        return;
    }

    // Create new conversation
    const { data: newConv, error } = await supabase
        .from('nd_conversations')
        .insert({
            user1_id: currentUser.id,
            user2_id: foundUserId
        })
        .select()
        .single();

    if (error) {
        searchUserResult.innerHTML = 'Error creating chat';
        searchUserResult.className = 'search-result not-found';
        return;
    }

    newChatModal.style.display = 'none';
    await loadConversations();
    const { data: partner } = await supabase.from('nd_users').select('chat_id').eq('id', foundUserId).single();
    openChat(newConv.id, partner?.chat_id);
});

// Initialize
initApp();
