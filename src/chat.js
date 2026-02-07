// ===== XMAT CHAT MODULE =====
// Separate file for anonymous chat functionality

let supabase = null;
let currentUser = null;
let userProfile = null;
let currentConversation = null;
let messageSubscription = null;
let formatTime = null;

// DOM Elements
let myChatIdEl, copyChatIdBtn, newChatBtn, conversationsList;
let chatWelcome, chatActive, chatPartnerId, messagesContainer;
let messageInput, sendMessageBtn, newChatModal, closeModalBtn;
let searchUserIdInput, searchUserResult, startChatBtn;
let backToChatsBtn, chatSidebar;

let foundUserId = null;

// Initialize chat module with dependencies
export function initChatModule(deps) {
    supabase = deps.supabase;
    currentUser = deps.currentUser;
    userProfile = deps.userProfile;
    formatTime = deps.formatTime;

    // Get DOM elements
    myChatIdEl = document.getElementById('my-chat-id');
    copyChatIdBtn = document.getElementById('copy-chat-id');
    newChatBtn = document.getElementById('new-chat-btn');
    conversationsList = document.getElementById('conversations-list');
    chatWelcome = document.getElementById('chat-welcome');
    chatActive = document.getElementById('chat-active');
    chatPartnerId = document.getElementById('chat-partner-id');
    messagesContainer = document.getElementById('messages-container');
    messageInput = document.getElementById('message-input');
    sendMessageBtn = document.getElementById('send-message-btn');
    newChatModal = document.getElementById('new-chat-modal');
    closeModalBtn = document.getElementById('close-modal-btn');
    searchUserIdInput = document.getElementById('search-user-id');
    searchUserResult = document.getElementById('search-user-result');
    startChatBtn = document.getElementById('start-chat-btn');
    backToChatsBtn = document.getElementById('back-to-chats');
    chatSidebar = document.querySelector('.chat-sidebar');

    // Setup event listeners
    setupEventListeners();
}

// Update user context when it changes
export function updateUserContext(user, profile) {
    currentUser = user;
    userProfile = profile;
}

// Initialize chat page
export async function initChat() {
    if (!userProfile || !myChatIdEl) return;

    try {
        // Generate chat_id if not exists
        if (!userProfile.chat_id) {
            const newChatId = generateChatId();
            const { error } = await supabase
                .from('nd_users')
                .update({ chat_id: newChatId })
                .eq('id', currentUser.id);

            if (!error) {
                userProfile.chat_id = newChatId;
            }
        }

        myChatIdEl.textContent = userProfile.chat_id || 'Loading...';
        await loadConversations();
    } catch (err) {
        console.error('Error initializing chat:', err);
    }
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
    if (!conversationsList || !currentUser) return;

    try {
        const { data, error } = await supabase
            .from('nd_conversations')
            .select('*')
            .or(`user1_id.eq.${currentUser.id},user2_id.eq.${currentUser.id}`)
            .order('last_message_at', { ascending: false, nullsFirst: false });

        if (error) {
            console.error('Error loading conversations:', error);
            conversationsList.innerHTML = `<div class="no-chats"><p>Error loading chats</p></div>`;
            return;
        }

        if (!data || data.length === 0) {
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
        const { data: partners } = await supabase
            .from('nd_users')
            .select('id, chat_id')
            .in('id', partnerIds);

        const partnerMap = {};
        partners?.forEach(p => partnerMap[p.id] = p.chat_id);

        conversationsList.innerHTML = data.map(conv => {
            const partnerId = conv.user1_id === currentUser.id ? conv.user2_id : conv.user1_id;
            const partnerChatId = partnerMap[partnerId] || 'Unknown';
            const initials = partnerChatId.substring(0, 2);
            return `
                <div class="conversation-item" data-conv-id="${conv.id}" data-partner-id="${partnerId}" data-partner-chat-id="${partnerChatId}">
                    <div class="conversation-avatar">${initials}</div>
                    <div class="conversation-info">
                        <div class="conversation-id">${partnerChatId}</div>
                        <div class="conversation-preview">${conv.last_message || 'No messages yet'}</div>
                    </div>
                    <div class="conversation-time">${formatTime ? formatTime(conv.last_message_at) : ''}</div>
                </div>
            `;
        }).join('');

        // Add click handlers
        document.querySelectorAll('.conversation-item').forEach(item => {
            item.addEventListener('click', () => openChat(item.dataset.convId, item.dataset.partnerChatId));
        });
    } catch (err) {
        console.error('Error in loadConversations:', err);
    }
}

async function openChat(convId, partnerChatId) {
    if (!chatActive || !chatWelcome) return;

    currentConversation = convId;

    // Update UI
    chatWelcome.style.display = 'none';
    chatActive.style.display = 'flex';
    if (chatPartnerId) chatPartnerId.textContent = partnerChatId;

    // Mark conversation as active
    document.querySelectorAll('.conversation-item').forEach(c => c.classList.remove('active'));
    document.querySelector(`[data-conv-id="${convId}"]`)?.classList.add('active');

    // Hide sidebar on mobile
    if (window.innerWidth <= 768 && chatSidebar) {
        chatSidebar.classList.add('hidden');
    }

    // Load messages
    await loadMessages(convId);

    // Subscribe to new messages
    subscribeToMessages(convId);
}

async function loadMessages(convId) {
    if (!messagesContainer) return;

    try {
        const { data, error } = await supabase
            .from('nd_messages')
            .select('*')
            .eq('conversation_id', convId)
            .order('created_at', { ascending: true });

        if (error) {
            messagesContainer.innerHTML = '<p class="no-chats">Error loading messages</p>';
            return;
        }

        if (!data || data.length === 0) {
            messagesContainer.innerHTML = '<p class="no-chats">No messages yet. Say hello!</p>';
            return;
        }

        messagesContainer.innerHTML = data.map(msg => `
            <div class="message ${msg.sender_id === currentUser.id ? 'sent' : 'received'}">
                <div class="message-content">${escapeHtml(msg.content)}</div>
                <div class="message-time">${formatTime ? formatTime(msg.created_at) : ''}</div>
            </div>
        `).join('');

        // Scroll to bottom
        scrollToBottom();
    } catch (err) {
        console.error('Error loading messages:', err);
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function scrollToBottom() {
    if (messagesContainer) {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
}

function subscribeToMessages(convId) {
    // Unsubscribe from previous
    if (messageSubscription) {
        supabase.removeChannel(messageSubscription);
    }

    messageSubscription = supabase
        .channel(`chat-messages-${convId}`)
        .on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'nd_messages',
            filter: `conversation_id=eq.${convId}`
        }, (payload) => {
            const msg = payload.new;
            // Only add if not already visible (avoid duplicates)
            if (!document.querySelector(`[data-msg-id="${msg.id}"]`)) {
                const msgEl = document.createElement('div');
                msgEl.className = `message ${msg.sender_id === currentUser.id ? 'sent' : 'received'}`;
                msgEl.dataset.msgId = msg.id;
                msgEl.innerHTML = `
                    <div class="message-content">${escapeHtml(msg.content)}</div>
                    <div class="message-time">${formatTime ? formatTime(msg.created_at) : ''}</div>
                `;
                messagesContainer.appendChild(msgEl);
                scrollToBottom();
            }
        })
        .subscribe();
}

async function sendMessage() {
    if (!currentConversation || !messageInput) return;

    const content = messageInput.value.trim();
    if (!content) return;

    // Clear input immediately
    messageInput.value = '';

    try {
        // Insert message
        const { error } = await supabase.from('nd_messages').insert({
            conversation_id: currentConversation,
            sender_id: currentUser.id,
            content: content
        });

        if (error) {
            console.error('Error sending message:', error);
            messageInput.value = content; // Restore on error
            return;
        }

        // Update conversation last message
        await supabase.from('nd_conversations').update({
            last_message: content.substring(0, 100),
            last_message_at: new Date().toISOString()
        }).eq('id', currentConversation);

    } catch (err) {
        console.error('Error in sendMessage:', err);
        messageInput.value = content;
    }
}

async function searchUser(chatId) {
    if (!chatId || chatId.length !== 8) {
        return null;
    }

    if (chatId === userProfile?.chat_id) {
        return { error: 'self' };
    }

    try {
        const { data, error } = await supabase
            .from('nd_users')
            .select('id, chat_id')
            .eq('chat_id', chatId)
            .single();

        if (error || !data) {
            return { error: 'not_found' };
        }

        return { user: data };
    } catch (err) {
        return { error: 'not_found' };
    }
}

async function createOrOpenConversation(targetUserId) {
    try {
        // Check if conversation already exists
        const { data: existing } = await supabase
            .from('nd_conversations')
            .select('*')
            .or(`and(user1_id.eq.${currentUser.id},user2_id.eq.${targetUserId}),and(user1_id.eq.${targetUserId},user2_id.eq.${currentUser.id})`)
            .single();

        if (existing) {
            const { data: partner } = await supabase
                .from('nd_users')
                .select('chat_id')
                .eq('id', targetUserId)
                .single();
            return { conversation: existing, partnerChatId: partner?.chat_id };
        }

        // Create new conversation
        const { data: newConv, error } = await supabase
            .from('nd_conversations')
            .insert({
                user1_id: currentUser.id,
                user2_id: targetUserId
            })
            .select()
            .single();

        if (error) {
            return { error: 'create_failed' };
        }

        const { data: partner } = await supabase
            .from('nd_users')
            .select('chat_id')
            .eq('id', targetUserId)
            .single();

        return { conversation: newConv, partnerChatId: partner?.chat_id };
    } catch (err) {
        return { error: 'create_failed' };
    }
}

function setupEventListeners() {
    // Send message
    sendMessageBtn?.addEventListener('click', sendMessage);
    messageInput?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    // Copy chat ID
    copyChatIdBtn?.addEventListener('click', () => {
        if (userProfile?.chat_id) {
            navigator.clipboard.writeText(userProfile.chat_id);
            const originalHtml = copyChatIdBtn.innerHTML;
            copyChatIdBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20,6 9,17 4,12"/></svg>';
            setTimeout(() => {
                copyChatIdBtn.innerHTML = originalHtml;
            }, 2000);
        }
    });

    // Mobile back button
    backToChatsBtn?.addEventListener('click', () => {
        if (chatSidebar) chatSidebar.classList.remove('hidden');
        if (chatActive) chatActive.style.display = 'none';
        if (chatWelcome) chatWelcome.style.display = 'flex';
        currentConversation = null;

        // Unsubscribe from messages
        if (messageSubscription) {
            supabase.removeChannel(messageSubscription);
            messageSubscription = null;
        }
    });

    // New chat modal
    newChatBtn?.addEventListener('click', () => {
        if (newChatModal) newChatModal.style.display = 'flex';
        if (searchUserIdInput) searchUserIdInput.value = '';
        if (searchUserResult) {
            searchUserResult.innerHTML = '';
            searchUserResult.className = 'search-result';
        }
        if (startChatBtn) startChatBtn.disabled = true;
        foundUserId = null;
    });

    closeModalBtn?.addEventListener('click', () => {
        if (newChatModal) newChatModal.style.display = 'none';
    });

    // Close modal on outside click
    newChatModal?.addEventListener('click', (e) => {
        if (e.target === newChatModal) {
            newChatModal.style.display = 'none';
        }
    });

    // Search user by ID
    searchUserIdInput?.addEventListener('input', async (e) => {
        const chatId = e.target.value.toUpperCase().trim();
        foundUserId = null;
        if (startChatBtn) startChatBtn.disabled = true;

        if (chatId.length < 8) {
            if (searchUserResult) searchUserResult.innerHTML = chatId.length > 0 ? `${chatId.length}/8 characters` : '';
            return;
        }

        if (searchUserResult) {
            searchUserResult.innerHTML = 'Searching...';
            searchUserResult.className = 'search-result';
        }

        const result = await searchUser(chatId);

        if (result.error === 'self') {
            if (searchUserResult) {
                searchUserResult.innerHTML = '❌ Cannot chat with yourself';
                searchUserResult.className = 'search-result not-found';
            }
        } else if (result.error) {
            if (searchUserResult) {
                searchUserResult.innerHTML = '❌ User not found';
                searchUserResult.className = 'search-result not-found';
            }
        } else if (result.user) {
            foundUserId = result.user.id;
            if (searchUserResult) {
                searchUserResult.innerHTML = `✅ User found: ${result.user.chat_id}`;
                searchUserResult.className = 'search-result found';
            }
            if (startChatBtn) startChatBtn.disabled = false;
        }
    });

    // Start chat
    startChatBtn?.addEventListener('click', async () => {
        if (!foundUserId) return;

        if (startChatBtn) {
            startChatBtn.disabled = true;
            startChatBtn.textContent = 'Starting...';
        }

        const result = await createOrOpenConversation(foundUserId);

        if (result.error) {
            if (searchUserResult) {
                searchUserResult.innerHTML = '❌ Error creating chat';
                searchUserResult.className = 'search-result not-found';
            }
            if (startChatBtn) {
                startChatBtn.disabled = false;
                startChatBtn.textContent = 'Start Chat';
            }
            return;
        }

        if (newChatModal) newChatModal.style.display = 'none';
        await loadConversations();
        openChat(result.conversation.id, result.partnerChatId);

        if (startChatBtn) startChatBtn.textContent = 'Start Chat';
    });
}
