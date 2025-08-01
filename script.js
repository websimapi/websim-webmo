let currentUser = null;
let currentProject = null;
let projectCreator = null;

// State for pagination and search
let nextCursor = null;
let hasNextPage = true;
let isLoading = false;
let currentSearchQuery = '';
let viewedProfileData = null; // Store data about the user/project being viewed in the modal
let cardOrder = 0;

const userGrid = document.getElementById('user-grid');
const loadingDiv = document.getElementById('loading');
const scrollLoader = document.getElementById('scroll-loader');
const searchInput = document.getElementById('search-input');
const sortSelect = document.getElementById('sort-select');

// Tip Modal Elements
const tipCreatorButton = document.getElementById('tip-creator-btn');
const tipModal = document.getElementById('tip-modal');
const closeTipModalButton = document.getElementById('close-modal');
const tipForm = document.getElementById('tip-form');
const tipAmountInput = document.getElementById('tip-amount');
const tipMessageInput = document.getElementById('tip-message');
const tipUsernameSpan = document.getElementById('tip-username');
const submitTipButton = document.getElementById('submit-tip-button');
const presetTipButtons = document.querySelectorAll('.preset-tip-btn');

// Add User Modal Elements
const addUserButton = document.getElementById('add-user-btn');
const addUserModal = document.getElementById('add-user-modal');
const closeAddUserModalButton = document.getElementById('close-add-user-modal');
const addUserForm = document.getElementById('add-user-form');
const addUsernameInput = document.getElementById('add-username-input');
const submitAddUserButton = document.getElementById('submit-add-user-button');

const profileModal = document.getElementById('profile-modal');
const closeProfileModalButton = document.getElementById('close-profile-modal');
const profileIframe = document.getElementById('profile-iframe');
const profileNotificationUsername = document.getElementById('profile-notification-username');
const iframeLoader = document.getElementById('iframe-loader');

async function init() {
    cardOrder = 0;
    try {
        [currentUser, currentProject, projectCreator] = await Promise.all([
            window.websim.getCurrentUser(),
            window.websim.getCurrentProject(),
            window.websim.getCreator()
        ]);

        if (tipCreatorButton && projectCreator) {
            tipCreatorButton.style.display = 'block';
        }

        if (currentUser) {
            await handleInitialQueryUser();
            loadCachedUsers();
            await loadContent();
            sortUserGrid(sortSelect.value);
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

// --- Tip Calculation and Storage ---

async function getAllUserProjectIds(userId) {
    const projectIds = new Set();
    let hasNextPage = true;
    let cursor = null;

    while (hasNextPage) {
        const params = new URLSearchParams({ first: '100' });
        if (cursor) {
            params.append('after', cursor);
        }
        try {
            const response = await fetch(`/api/v1/users/${userId}/projects?${params.toString()}`);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();
            const { data: projects, meta } = data.projects;
            projects.forEach(item => projectIds.add(item.project.id));
            hasNextPage = meta.has_next_page;
            cursor = meta.end_cursor;
        } catch (error) {
            console.error(`Failed to fetch a page of projects for user ${userId}:`, error);
            hasNextPage = false; // Stop on error
        }
    }
    return Array.from(projectIds);
}

async function updateAndDisplayTips(userId) {
    let totalTips = 0;
    try {
        const projectIds = await getAllUserProjectIds(userId);
        
        if (projectIds.length > 0) {
            const tipPromises = projectIds.map(projectId => fetchTipsForProject(projectId, currentUser.id));
            const tipAmounts = await Promise.all(tipPromises);
            totalTips = tipAmounts.reduce((sum, amount) => sum + amount, 0);
        }

        localStorage.setItem(`tips_given_${userId}`, totalTips);

    } catch (error) {
        console.error(`Failed to update tips for user ${userId}:`, error);
        // Fallback to localStorage if API fails
        totalTips = parseInt(localStorage.getItem(`tips_given_${userId}`) || '0', 10);
    }
    
    const tipElement = userGrid.querySelector(`.user-card[data-user-id="${userId}"] .tip-amount`);
    if (tipElement) {
        tipElement.textContent = totalTips;
    }
}

async function fetchTipsForProject(projectId, tipperUserId) {
    let totalTips = 0;
    let hasNext = true;
    let cursor = null;

    while(hasNext) {
        const params = new URLSearchParams({ only_tips: 'true', first: '100' });
        if(cursor) params.append('after', cursor);

        try {
            const response = await fetch(`/api/v1/projects/${projectId}/comments?${params.toString()}`);
            if (!response.ok) {
                hasNext = false; // Stop on error
                continue;
            }
            const data = await response.json();
            const tipComments = data.comments.data;

            for (const item of tipComments) {
                const comment = item.comment;
                if (comment.author.id === tipperUserId && comment.card_data && comment.card_data.type === 'tip_comment') {
                    totalTips += comment.card_data.credits_spent;
                }
            }

            hasNext = data.comments.meta.has_next_page;
            cursor = data.comments.meta.end_cursor;

        } catch (error) {
            console.error(`Error fetching tips for project ${projectId}:`, error);
            hasNext = false; // Stop on network error
        }
    }
    return totalTips;
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
        
        // Get cached users
        const cachedUsersJSON = localStorage.getItem('webmo_cached_users');
        const cachedUsers = cachedUsersJSON ? JSON.parse(cachedUsersJSON) : [];
        const cachedUserIds = new Set(cachedUsers.map(u => u.id));

        // Step 3: Filter search results
        const filteredUsers = searchedUsers.filter(user => followedUserIds.has(user.id) || cachedUserIds.has(user.id));

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
            // Check if there are any cards at all. If not, show the message.
            if (userGrid.children.length === 0) {
                 loadingDiv.textContent = "You aren't following anyone yet. Explore Websim to find creators!";
            }
        } else {
            loadingDiv.style.display = 'none';
        }

        for (const { follow } of users) {
            // Prevent adding duplicate cards if the user is also in the cache
            if (!userGrid.querySelector(`.user-card[data-user-id="${follow.user.id}"]`)) {
                const userCard = createUserCard(follow.user);
                userGrid.appendChild(userCard);
            }
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

// --- UI Rendering ---

function createUserCard(user) {
    const card = document.createElement('div');
    card.className = 'user-card';
    card.setAttribute('data-user-id', user.id);
    card.setAttribute('data-order', cardOrder++);

    const storedTips = localStorage.getItem(`tips_given_${user.id}`) || 0;

    card.innerHTML = `
        <img src="${user.avatar_url || 'https://images.websim.com/avatar/websim'}" alt="${user.username}'s avatar" class="avatar">
        <div class="username">@${user.username}</div>
        <div class="tip-info">Total Tips Given: <span class="tip-amount">${storedTips}</span> credits</div>
    `;
    
    card.addEventListener('click', () => {
        openProfileModal(user);
    });
    
    // Asynchronously update tip counts for accuracy without blocking UI
    updateAndDisplayTips(user.id);

    return card;
}

function loadCachedUsers() {
    const cachedUsersJSON = localStorage.getItem('webmo_cached_users');
    if (cachedUsersJSON) {
        try {
            const cachedUsers = JSON.parse(cachedUsersJSON);
            cachedUsers.forEach(user => {
                if (!userGrid.querySelector(`.user-card[data-user-id="${user.id}"]`)) {
                    const userCard = createUserCard(user);
                    userGrid.appendChild(userCard);
                }
            });
        } catch (e) {
            console.error("Failed to parse cached users from localStorage", e);
            localStorage.removeItem('webmo_cached_users');
        }
    }
}

async function handleInitialQueryUser() {
    const urlParams = new URLSearchParams(window.location.search);
    const username = urlParams.get('user');

    if (!username) return;

    // Clean the URL right away to prevent re-triggering on refresh.
    const newUrl = window.location.pathname;
    window.history.replaceState({}, document.title, newUrl);
    
    const addedUser = await fetchAndAddUser(username);
    if(addedUser) {
        openProfileModal(addedUser);
    }
}

async function fetchAndAddUser(username) {
    try {
        const response = await fetch(`/api/v1/users/${username}`);
        if (!response.ok) {
            if (response.status === 404) {
                 throw new Error(`User not found: @${username}`);
            }
            throw new Error(`Failed to fetch user. Status: ${response.status}`);
        }
        
        const { user } = await response.json();
        
        if (user) {
            addUserToCacheAndGrid(user);
            return user; // Return user on success
        } else {
            throw new Error(`Invalid user data received for @${username}`);
        }
    } catch (error) {
        console.error('Error fetching and adding user:', error);
        alert(error.message);
        return null; // Return null on failure
    }
}

function addUserToCacheAndGrid(user) {
    // Check if user card already exists
    if (userGrid.querySelector(`.user-card[data-user-id="${user.id}"]`)) {
        alert(`@${user.username} is already on your list.`);
        return;
    }

    // Add card to grid
    const userCard = createUserCard(user);
    userGrid.prepend(userCard); // Add to top for visibility

    // Add to local storage cache
    const cachedUsersJSON = localStorage.getItem('webmo_cached_users');
    let cachedUsers = cachedUsersJSON ? JSON.parse(cachedUsersJSON) : [];
    
    if (!cachedUsers.some(cachedUser => cachedUser.id === user.id)) {
        cachedUsers.push(user);
        localStorage.setItem('webmo_cached_users', JSON.stringify(cachedUsers));
    }

    // If "not following" message is visible, hide it.
    if (loadingDiv.textContent.includes("aren't following anyone")) {
        loadingDiv.style.display = 'none';
    }
    
    sortUserGrid(sortSelect.value);
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

    viewedProfileData = { user }; // Store the user being viewed

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

    if (viewedProfileData && viewedProfileData.user) {
        console.log(`Updating tips for @${viewedProfileData.user.username}`);
        // This will fetch all tips from the current user to any of the viewed user's projects.
        updateAndDisplayTips(viewedProfileData.user.id);
    }
    
    viewedProfileData = null; // Clear the stored data

    profileIframe.style.display = 'none';
    iframeLoader.style.display = 'block'; // Reset loader
    iframeLoader.textContent = 'Loading profile...';
}

// --- Tip Modal Logic ---

function openCreatorTipModal() {
    if (!projectCreator || !currentProject) return;

    tipUsernameSpan.textContent = `@${projectCreator.username}`;
    tipMessageInput.value = `Great work on ${currentProject.title}!`;
    tipAmountInput.value = '10';
    tipModal.style.display = 'flex';
}

function closeTipModal() {
    tipModal.style.display = 'none';
    tipForm.reset();
}

async function handleTipSubmit(e) {
    e.preventDefault();
    if (submitTipButton.disabled) return;

    const amount = parseInt(tipAmountInput.value, 10);
    const message = tipMessageInput.value.trim();

    if (!message) {
        alert('Please enter a message.');
        return;
    }
    if (isNaN(amount) || amount < 10) {
        alert('Minimum tip amount is 10 credits.');
        return;
    }

    submitTipButton.disabled = true;
    submitTipButton.textContent = 'Sending...';

    try {
        // This will open the native websim UI for the user to confirm the tip comment.
        await window.websim.postComment({
            content: message,
            credits: amount,
        });

        // The native UI handles the final confirmation. We can close our modal now.
        closeTipModal();

    } catch (error) {
        console.error('Failed to initiate tip:', error);
        alert('Could not initiate tip. Please make sure you are logged in and have interacted with the page.');
    } finally {
        submitTipButton.disabled = false;
        submitTipButton.textContent = 'Send Tip';
    }
}

// --- Add User Modal Logic ---

function openAddUserModal() {
    addUserModal.style.display = 'flex';
    addUsernameInput.focus();
}

function closeAddUserModal() {
    addUserModal.style.display = 'none';
    addUserForm.reset();
}

async function handleAddUserSubmit(e) {
    e.preventDefault();
    if (submitAddUserButton.disabled) return;

    const username = addUsernameInput.value.trim();
    if (!username) return;

    submitAddUserButton.disabled = true;
    submitAddUserButton.textContent = 'Adding...';

    await fetchAndAddUser(username);

    submitAddUserButton.disabled = false;
    submitAddUserButton.textContent = 'Add User';
    closeAddUserModal();
}

// --- Event Listeners ---

sortSelect.addEventListener('change', () => {
    sortUserGrid(sortSelect.value);
});

if (tipCreatorButton) {
    tipCreatorButton.addEventListener('click', openCreatorTipModal);
}
if (closeTipModalButton) {
    closeTipModalButton.addEventListener('click', closeTipModal);
}
if (tipModal) {
    tipModal.addEventListener('click', (event) => {
        if (event.target === tipModal) {
            closeTipModal();
        }
    });
}
if (tipForm) {
    tipForm.addEventListener('submit', handleTipSubmit);
}
presetTipButtons.forEach(button => {
    button.addEventListener('click', () => {
        tipAmountInput.value = button.dataset.amount;
    });
});

// Add User Modal Listeners
if (addUserButton) {
    addUserButton.addEventListener('click', openAddUserModal);
}
if (closeAddUserModalButton) {
    closeAddUserModalButton.addEventListener('click', closeAddUserModal);
}
if (addUserModal) {
    addUserModal.addEventListener('click', (event) => {
        if (event.target === addUserModal) {
            closeAddUserModal();
        }
    });
}
if (addUserForm) {
    addUserForm.addEventListener('submit', handleAddUserSubmit);
}

closeProfileModalButton.addEventListener('click', closeProfileModal);

window.addEventListener('click', (event) => {
    if (event.target === profileModal) {
        closeProfileModal();
    }
});

let searchTimeout;
searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(async () => {
        const query = searchInput.value.trim();
        if (query !== currentSearchQuery) {
            currentSearchQuery = query;
            userGrid.innerHTML = ''; // Clear the grid for new state
            cardOrder = 0;
            nextCursor = null;
            hasNextPage = true;
            
            if (!currentSearchQuery) {
                // If search is cleared, reload cached users before followers.
                loadCachedUsers();
            }
            
            await loadContent(null);
            sortUserGrid(sortSelect.value);
        }
    }, 300);
});

window.addEventListener('scroll', () => {
    if (isLoading || !hasNextPage || currentSearchQuery) return; // Disable scroll loading for search

    const {
        scrollTop,
        scrollHeight,
        clientHeight
    } = document.documentElement;
    if (scrollTop + clientHeight >= scrollHeight - 100) {
        (async () => {
            await loadContent(nextCursor);
            sortUserGrid(sortSelect.value);
        })();
    }
});

init();

function sortUserGrid(sortBy) {
    const userCards = Array.from(userGrid.querySelectorAll('.user-card'));

    if (sortBy === 'default') {
        userCards.sort((a, b) => {
            const orderA = parseInt(a.dataset.order, 10) || 0;
            const orderB = parseInt(b.dataset.order, 10) || 0;
            return orderA - orderB;
        });
    } else {
        userCards.sort((a, b) => {
            const tipsA = parseInt(a.querySelector('.tip-amount').textContent, 10) || 0;
            const tipsB = parseInt(b.querySelector('.tip-amount').textContent, 10) || 0;

            if (sortBy === 'tips-desc') {
                return tipsB - tipsA;
            } else { // 'tips-asc'
                return tipsA - tipsB;
            }
        });
    }

    // Re-append sorted cards
    userGrid.innerHTML = '';
    userCards.forEach(card => userGrid.appendChild(card));
}