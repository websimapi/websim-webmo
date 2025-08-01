let currentUser = null;
let currentProject = null;

// State for pagination and search
let nextCursor = null;
let hasNextPage = true;
let isLoading = false;
let currentSearchQuery = '';

const userGrid = document.getElementById('user-grid');
const loadingDiv = document.getElementById('loading');
const scrollLoader = document.getElementById('scroll-loader');
const searchInput = document.getElementById('search-input');

const profileModal = document.getElementById('profile-modal');
const closeProfileModalButton = document.getElementById('close-profile-modal');
const profileIframe = document.getElementById('profile-iframe');

async function init() {
    try {
        [currentUser, currentProject] = await Promise.all([
            window.websim.getCurrentUser(),
            window.websim.getCurrentProject()
        ]);

        if (currentUser) {
            await loadUsers();
        } else {
            loadingDiv.textContent = 'Please log in to see your followed users.';
            loadingDiv.style.display = 'block';
        }
    } catch (error) {
        console.error("Initialization error:", error);
        loadingDiv.textContent = 'Could not load user data. Please try again.';
        loadingDiv.style.display = 'block';
    }
}

async function loadUsers(cursor = null) {
    if (isLoading || (!hasNextPage && cursor)) return;
    isLoading = true;

    if (cursor) {
        scrollLoader.style.display = 'block';
    } else {
        loadingDiv.style.display = 'block';
        userGrid.innerHTML = ''; // Clear for new search or initial load
    }

    try {
        const params = new URLSearchParams({
            first: '20'
        });
        if (cursor) {
            params.append('after', cursor);
        }
        if (currentSearchQuery) {
            params.append('query', currentSearchQuery);
        }

        const response = await fetch(`/api/v1/users/${currentUser.username}/following?${params.toString()}`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        const { data: users, meta } = data.following;

        if (users.length === 0 && !cursor) {
             if (currentSearchQuery) {
                loadingDiv.textContent = `No users found for "${currentSearchQuery}".`;
            } else {
                loadingDiv.textContent = "You aren't following anyone yet. Explore Websim to find creators!";
            }
        } else {
            loadingDiv.style.display = 'none';
        }

        for (const { follow } of users) {
            const userCard = createUserCard(follow.user);
            userGrid.appendChild(userCard);
        }
        
        hasNextPage = meta.has_next_page;
        nextCursor = meta.end_cursor;

    } catch (error) {
        console.error('Failed to load following users:', error);
        loadingDiv.textContent = 'Error loading followed users.';
        loadingDiv.style.display = 'block';
    } finally {
        isLoading = false;
        scrollLoader.style.display = 'none';
    }
}

function createUserCard(user) {
    const card = document.createElement('div');
    card.className = 'user-card';

    const tipAmount = 0; // Placeholder as per instructions

    card.innerHTML = `
        <img src="${user.avatar_url || 'https://images.websim.com/avatar/websim'}" alt="${user.username}'s avatar" class="avatar">
        <div class="username">@${user.username}</div>
        <div class="tip-info">Total Tips Received: ${tipAmount} credits</div>
    `;
    
    card.addEventListener('click', () => {
        openProfileModal(user);
    });

    return card;
}

function openProfileModal(user) {
    if (!user) return;
    const profileUrl = `https://websim.com/@${user.username}`;
    profileIframe.src = profileUrl;
    profileModal.style.display = 'flex';
}

function closeProfileModal() {
    profileModal.style.display = 'none';
    profileIframe.src = 'about:blank'; // Stop loading and clear content
}

function handleSearch() {
    const query = searchInput.value.trim().toLowerCase();
    if(query === currentSearchQuery) return;

    currentSearchQuery = query;
    nextCursor = null;
    hasNextPage = true;
    loadUsers();
}

// --- Event Listeners ---

closeProfileModalButton.addEventListener('click', closeProfileModal);

window.addEventListener('click', (event) => {
    if (event.target === profileModal) {
        closeProfileModal();
    }
});

let searchTimeout;
searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(handleSearch, 300);
});

window.addEventListener('scroll', () => {
    if (isLoading || !hasNextPage) return;

    const {
        scrollTop,
        scrollHeight,
        clientHeight
    } = document.documentElement;
    if (scrollTop + clientHeight >= scrollHeight - 100) {
        loadUsers(nextCursor);
    }
});

init();