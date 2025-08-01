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
const profileNotificationUsername = document.getElementById('profile-notification-username');
const iframeLoader = document.getElementById('iframe-loader');

async function init() {
    try {
        [currentUser, currentProject] = await Promise.all([
            window.websim.getCurrentUser(),
            window.websim.getCurrentProject()
        ]);

        if (currentUser) {
            await loadContent();
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

async function getAllFollowingIds(username) {
    const followedUserIds = new Set();
    let hasNextPage = true;
    let cursor = null;

    while (hasNextPage) {
        const params = new URLSearchParams({ first: '100' });
        if (cursor) {
            params.append('after', cursor);
        }
        try {
            const response = await fetch(`/api/v1/users/${username}/following?${params.toString()}`);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();
            const { data: users, meta } = data.following;
            users.forEach(item => followedUserIds.add(item.follow.user.id));
            hasNextPage = meta.has_next_page;
            cursor = meta.end_cursor;
        } catch (error) {
            console.error('Failed to fetch a page of followed users:', error);
            // Stop paginating on error to avoid infinite loops
            hasNextPage = false; 
        }
    }
    return followedUserIds;
}

async function loadContent(cursor = null) {
    if (currentSearchQuery) {
        // Search is not paginated, only load on initial search
        if (cursor === null) {
             await performSearch();
        }
    } else {
        // Otherwise, use the standard "load following" logic
        await loadFollowingUsers(cursor);
    }
}

async function performSearch() {
    if (isLoading) return;
    isLoading = true;
    loadingDiv.textContent = `Searching for "${currentSearchQuery}"...`;
    loadingDiv.style.display = 'block';
    userGrid.innerHTML = '';
    scrollLoader.style.display = 'none';

    try {
        // Step 1: Search for users
        const searchResponse = await fetch(`/api/v1/user-search?query=${encodeURIComponent(currentSearchQuery)}`);
        if (!searchResponse.ok) throw new Error(`User search failed with status ${searchResponse.status}`);
        const searchData = await searchResponse.json();
        const searchedUsers = searchData.data;

        if (searchedUsers.length === 0) {
            loadingDiv.textContent = `No users found for "${currentSearchQuery}".`;
            isLoading = false;
            return;
        }

        // Step 2: Get all followed users to check against
        const followedUserIds = await getAllFollowingIds(currentUser.username);
        
        // Step 3: Filter search results
        const filteredUsers = searchedUsers.filter(user => followedUserIds.has(user.id));

        if (filteredUsers.length === 0) {
            loadingDiv.textContent = `You are not following any users matching "${currentSearchQuery}".`;
        } else {
            loadingDiv.style.display = 'none';
            filteredUsers.forEach(user => {
                const userCard = createUserCard(user);
                userGrid.appendChild(userCard);
            });
        }
        
        hasNextPage = false; // Disable infinite scroll for search results

    } catch (error) {
        console.error('Failed to perform search:', error);
        loadingDiv.textContent = 'Error during search.';
    } finally {
        isLoading = false;
    }
}

async function loadFollowingUsers(cursor = null) {
    if (isLoading || (!hasNextPage && cursor)) return;
    isLoading = true;

    if (cursor) {
        scrollLoader.style.display = 'block';
    } else {
        loadingDiv.style.display = 'block';
        userGrid.innerHTML = '';
    }

    try {
        const params = new URLSearchParams({
            first: '20'
        });
        if (cursor) {
            params.append('after', cursor);
        }

        const response = await fetch(`/api/v1/users/${currentUser.username}/following?${params.toString()}`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        const { data: users, meta } = data.following;

        if (users.length === 0 && !cursor) {
            loadingDiv.textContent = "You aren't following anyone yet. Explore Websim to find creators!";
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

async function isGuest(username) {
    try {
        // This subdomain is a convention for checking if a user profile page has been set up.
        const profileUrl = `https://profile--${username}.on.websim.ai`;
        const response = await fetch(profileUrl);

        if (!response.ok && response.status === 404) {
             const errorBody = await response.json().catch(() => ({}));
             if (errorBody?.error?.message === 'Not found') {
                return true; // Profile does not exist, user is a "guest".
             }
        }
        return false; // Profile exists.
    } catch (e) {
        console.error(`Error checking profile for ${username}:`, e);
        return true; // Treat network or other errors as being a guest.
    }
}

async function openProfileModal(user) {
    if (!user) return;

    profileNotificationUsername.textContent = `@${user.username}`;
    profileModal.style.display = 'flex';
    profileIframe.style.display = 'none';
    iframeLoader.style.display = 'block';

    let contentUrl;
    const userIsGuest = await isGuest(user.username);

    if (userIsGuest) {
        console.log(`@${user.username} is a guest. Looking for projects...`);
        try {
            const response = await fetch(`/api/v1/users/${user.username}/projects?first=1`);
            const data = await response.json();
            if (data.projects?.data?.length > 0) {
                const project = data.projects.data[0].project;
                contentUrl = `https://websim.com/p/${project.id}`;
                console.log(`Found project ${project.id}. Loading in iframe.`);
            } else {
                console.log(`No projects found for @${user.username}.`);
            }
        } catch (error) {
            console.error(`Failed to fetch projects for @${user.username}:`, error);
        }
    }

    if (!contentUrl) {
        contentUrl = `https://websim.com/@${user.username}`;
        console.log(`Loading profile page for @${user.username} in iframe.`);
    }
    
    profileIframe.onload = () => {
        iframeLoader.style.display = 'none';
        profileIframe.style.display = 'block';
    };
    
    profileIframe.onerror = () => {
        iframeLoader.textContent = 'Could not load content.';
    };

    profileIframe.src = contentUrl;
}

function closeProfileModal() {
    profileModal.style.display = 'none';
    profileIframe.src = 'about:blank'; // Stop loading and clear content
    profileIframe.style.display = 'none';
    iframeLoader.style.display = 'block'; // Reset loader
    iframeLoader.textContent = 'Loading profile...';
}

function handleSearch() {
    const query = searchInput.value.trim();
    if (query === currentSearchQuery) return;

    currentSearchQuery = query;
    nextCursor = null; // Reset cursor
    hasNextPage = true; // Reset pagination
    userGrid.innerHTML = ''; // Clear grid immediately
    
    // If search is cleared, load initial list. Otherwise, perform search.
    if (!query) {
        loadingDiv.textContent = 'Loading followed users...';
        loadFollowingUsers();
    } else {
        loadContent();
    }
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
        loadContent(nextCursor);
    }
});

init();