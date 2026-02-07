import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

// Initialize Supabase Client
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Edge Function URL for secure API calls
const EDGE_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/search-number`;

// State
let currentUser = null;
let userProfile = null;

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

    // Auth state listener
    supabase.auth.onAuthStateChange(async (event, session) => {
        if (event === 'SIGNED_IN' && session) {
            currentUser = session.user;
            await loadUserProfile();
            showDashboard();
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
});

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
        <div class="result-card" style="animation-delay: ${index * 0.1}s">
            <div class="result-header">
                <div class="result-avatar">${(item.name || 'U').charAt(0).toUpperCase()}</div>
                <div class="result-title">
                    <h3>${item.name || 'Unknown'}</h3>
                    <p>Record #${index + 1}</p>
                </div>
            </div>
            <div class="result-grid">
                <div class="result-item">
                    <div class="result-item-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72"/>
                        </svg>
                    </div>
                    <div class="result-item-content">
                        <div class="result-item-label">Mobile Number</div>
                        <div class="result-item-value">${item.mobile || 'N/A'}</div>
                    </div>
                </div>
                <div class="result-item">
                    <div class="result-item-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                            <circle cx="12" cy="7" r="4"/>
                        </svg>
                    </div>
                    <div class="result-item-content">
                        <div class="result-item-label">Father's Name</div>
                        <div class="result-item-value">${item.father_name || 'N/A'}</div>
                    </div>
                </div>
                <div class="result-item">
                    <div class="result-item-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72"/>
                        </svg>
                    </div>
                    <div class="result-item-content">
                        <div class="result-item-label">Alternate Mobile</div>
                        <div class="result-item-value">${item.alt_mobile || 'N/A'}</div>
                    </div>
                </div>
                <div class="result-item">
                    <div class="result-item-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                            <circle cx="12" cy="10" r="3"/>
                        </svg>
                    </div>
                    <div class="result-item-content">
                        <div class="result-item-label">Address</div>
                        <div class="result-item-value">${formatAddress(item.address) || 'N/A'}</div>
                    </div>
                </div>
                <div class="result-item">
                    <div class="result-item-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                            <line x1="16" y1="2" x2="16" y2="6"/>
                            <line x1="8" y1="2" x2="8" y2="6"/>
                            <line x1="3" y1="10" x2="21" y2="10"/>
                        </svg>
                    </div>
                    <div class="result-item-content">
                        <div class="result-item-label">ID Number</div>
                        <div class="result-item-value">${maskIdNumber(item.id_number) || 'N/A'}</div>
                    </div>
                </div>
                <div class="result-item">
                    <div class="result-item-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="10"/>
                            <path d="M2 12h20"/>
                            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
                        </svg>
                    </div>
                    <div class="result-item-content">
                        <div class="result-item-label">Circle/Operator</div>
                        <div class="result-item-value">${item.circle || 'N/A'}</div>
                    </div>
                </div>
                ${item.email ? `
                <div class="result-item">
                    <div class="result-item-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="2" y="4" width="20" height="16" rx="2"/>
                            <path d="m22 7-10 6L2 7"/>
                        </svg>
                    </div>
                    <div class="result-item-content">
                        <div class="result-item-label">Email</div>
                        <div class="result-item-value">${item.email}</div>
                    </div>
                </div>
                ` : ''}
            </div>
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
    if (id.length <= 8) return id;
    return id.substring(0, 4) + '****' + id.substring(id.length - 4);
}

// ===== History =====
async function loadHistory() {
    if (!currentUser) return;

    historyLoading.style.display = 'flex';
    historyContainer.innerHTML = '';

    const { data, error } = await supabase
        .from('nd_search_history')
        .select('*')
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
        <div class="history-item" data-number="${item.searched_number}" data-result='${JSON.stringify(item.result_data)}'>
            <div class="history-number">${item.searched_number}</div>
            <div class="history-name">${getNameFromResult(item.result_data)}</div>
            <div class="history-time">${formatTime(item.created_at)}</div>
        </div>
    `).join('');

    // Add click handlers
    historyContainer.querySelectorAll('.history-item').forEach(item => {
        item.addEventListener('click', () => {
            const result = JSON.parse(item.dataset.result);
            navLinks.forEach(l => l.classList.remove('active'));
            document.querySelector('[data-page="search"]').classList.add('active');
            sections.forEach(s => s.classList.remove('active'));
            document.getElementById('search-section').classList.add('active');
            displayResults(result);
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
            <div class="log-name">${getNameFromResult(log.result_data)}</div>
            <div class="log-time">${formatTime(log.created_at)}</div>
        </div>
    `).join('');
}

// Initialize
initApp();
