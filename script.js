let currentUser = null;
let currentProject = null;
let projectCreator = null;

// State for pagination and search
let nextCursor = null;
let hasNextPage = true;
let isLoading = false;
let currentSearchQuery = '';
let viewedProfileData = null; // Store data about the user/project being viewed in the modal

const CACHED_USERS_KEY = 'webmo_cached_users';

const userGrid = document.getElementById('user-grid');
const loadingDiv = document.getElementById('loading');
const scrollLoader = document.getElementById('scroll-loader');
const searchInput = document.getElementById('search-input');

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

const profileModal = document.getElementById('profile-modal');
const closeProfileModalButton = document.getElementById('close-profile-modal');
const profileIframe = document.getElementById('profile-iframe');
const profileNotificationUsername = document.getElementById('profile-notification-username');
const iframeLoader = document.getElementById('iframe-loader');

async function init() {
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
            await loadContent();
            await loadCachedUsers();
            await handleUrlUserParameter();
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

async function handleUrlUserParameter() {
    const params = new URLSearchParams(window.location.search);
    const username = params.get('user');
    if (!username) return;

    try {
        const response = await fetch(`/api/v1/users/${username}`);
        if (!response.ok) {
            console.error(`User ${username} not found via URL parameter.`);
            // Maybe show a notification to the user
            return;
        }
        const { user } = await response.json();
        
        // Open the modal for the user from the URL.
        openProfileModal(user);

        // Check if the user is followed.
        const followedUserIds = await getAllFollowingIds(currentUser.username);
        const isFollowed = followedUserIds.has(user.id);
        
        // Check if a card for this user already exists.
        const existingCard = userGrid.querySelector(`.user-card[data-user-id="${user.id}"]`);

        if (!isFollowed && !existingCard) {
            addUnfollowedUserToGrid(user);
            cacheUnfollowedUser(user);
        }
    } catch (error) {
        console.error(`Error handling user from URL parameter:`, error);
    }
}

async function loadCachedUsers() {
    const cachedUsers = JSON.parse(localStorage.getItem(CACHED_USERS_KEY) || '[]');
    if (cachedUsers.length === 0) return;
    
    const followedUserIds = await getAllFollowingIds(currentUser.username);
    
    for (const user of cachedUsers) {
        const isFollowed = followedUserIds.has(user.id);
        const cardExists = userGrid.querySelector(`.user-card[data-user-id="${user.id}"]`);
        
        if (!isFollowed && !cardExists) {
            addUnfollowedUserToGrid(user);
        }
    }
}

function cacheUnfollowedUser(user) {
    let cachedUsers = JSON.parse(localStorage.getItem(CACHED_USERS_KEY) || '[]');
    // Avoid duplicates
    if (!cachedUsers.some(cachedUser => cachedUser.id === user.id)) {
        cachedUsers.push(user);
        localStorage.setItem(CACHED_USERS_KEY, JSON.stringify(cachedUsers));
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

// --- UI Rendering ---

function createUserCard(user, isNotFollowed = false) {
    const card = document.createElement('div');
    card.className = 'user-card';
    if (isNotFollowed) {
        card.classList.add('not-followed');
    }
    card.setAttribute('data-user-id', user.id);
    card.setAttribute('data-user-name', user.username.toLowerCase()); // For easier lookups

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

function addUnfollowedUserToGrid(user) {
    const userCard = createUserCard(user, true); // true for isNotFollowed
    userGrid.prepend(userCard); // Add to the top of the grid
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

// --- Event Listeners ---

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