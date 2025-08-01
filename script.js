let currentUser = null;
let currentProject = null;

// State for pagination and search
let nextCursor = null;
let hasNextPage = true;
let isLoading = false;
let currentSearchQuery = '';
let viewedProfileData = null; // Store data about the user/project being viewed in the modal

const userGrid = document.getElementById('user-grid');
const loadingDiv = document.getElementById('loading');
const scrollLoader = document.getElementById('scroll-loader');
const searchInput = document.getElementById('search-input');

// Tip Modal Elements
const tipModal = document.getElementById('tip-modal');
const closeTipModalButton = document.getElementById('close-modal');
const tipForm = document.getElementById('tip-form');
const tipUsernameSpan = document.getElementById('tip-username');
const tipUsernameNotification = document.getElementById('tip-username-notification');
const tipProjectTitle = document.getElementById('tip-project-title');
const tipAmountInput = document.getElementById('tip-amount');
const tipMessageInput = document.getElementById('tip-message');
const submitTipButton = document.getElementById('submit-tip-button');

const profileModal = document.getElementById('profile-modal');
const profileModalContent = profileModal.querySelector('.modal-content');
const closeProfileModalButton = document.getElementById('close-profile-modal');
const profileIframe = document.getElementById('profile-iframe');
const profileNotificationUsername = document.getElementById('profile-notification-username');
const iframeLoader = document.getElementById('iframe-loader');
const tipUserButton = document.getElementById('tip-user-button');

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

function openTipModal() {
    if (!viewedProfileData || !viewedProfileData.project) {
        console.error("No project loaded, cannot tip.", viewedProfileData);
        alert("A project page must be loaded to send a tip.");
        return;
    }
    
    const { user, project } = viewedProfileData;
    
    tipUsernameSpan.textContent = `@${user.username}`;
    tipUsernameNotification.textContent = `@${user.username}`;
    tipProjectTitle.textContent = project.title || 'this project';
    tipAmountInput.value = '10';
    tipMessageInput.value = `Great work! Sent from Webmo.`;
    
    profileModal.style.display = 'none'; // Hide profile modal
    tipModal.style.display = 'flex';
}

function closeTipModal() {
    tipModal.style.display = 'none';
    profileModal.style.display = 'flex'; // Show profile modal again
}

async function handleTipSubmit(event) {
    event.preventDefault();
    if (!viewedProfileData || !viewedProfileData.project) return;

    const amount = parseInt(tipAmountInput.value, 10);
    const message = tipMessageInput.value.trim();

    if (!message || isNaN(amount) || amount < 10) {
        alert("Please enter a valid message and an amount of at least 10 credits.");
        return;
    }

    submitTipButton.disabled = true;
    submitTipButton.textContent = 'Sending...';

    try {
        await window.websim.postComment({
            content: message,
            credits: amount,
            project_id: viewedProfileData.project.id
        });
        
        // The 'comment:created' listener will handle UI updates
        // We can optimistically close the modal. If the user cancels, no harm done.
        tipModal.style.display = 'none';

        // Wait a moment for comment to post before re-showing profile
        setTimeout(() => {
             profileModal.style.display = 'flex';
             // Also update tips when modal is closed
        }, 500);

    } catch (error) {
        console.error('Error posting tip comment:', error);
        alert('Could not post tip. The request may have been cancelled or failed.');
    } finally {
        submitTipButton.disabled = false;
        submitTipButton.textContent = 'Send Tip';
    }
}

async function handleTipUser() {
    // This now just opens our custom modal
    openTipModal();
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

function createUserCard(user) {
    const card = document.createElement('div');
    card.className = 'user-card';
    card.setAttribute('data-user-id', user.id);

    const storedTips = localStorage.getItem(`tips_given_${user.id}`) || 0;

    card.innerHTML = `
        <img src="${user.avatar_url || `https://images.websim.com/avatar/${user.username}`}" alt="${user.username}'s avatar" class="avatar">
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

    viewedProfileData = { user, project: null }; // Reset data
    profileModalContent.classList.add('profile-modal-content');

    profileNotificationUsername.textContent = `@${user.username}`;
    profileModal.style.display = 'flex';
    profileIframe.style.display = 'none';
    iframeLoader.style.display = 'block';
    iframeLoader.textContent = 'Loading profile...';

    let contentUrl;
    
    // Prioritize finding a posted project to enable tipping
    try {
        const response = await fetch(`/api/v1/users/${user.username}/projects?first=1&posted=true&sort_by=updated_at`);
        if (!response.ok) throw new Error(`API error: ${response.status}`);
        
        const data = await response.json();
        if (data.projects?.data?.length > 0) {
            const project = data.projects.data[0].project;
            viewedProfileData.project = project;
            contentUrl = `https://websim.com/p/${project.id}`;
            console.log(`Found project ${project.id} for @${user.username}. Loading in iframe.`);
        } else {
            console.log(`No posted projects for @${user.username}. Falling back to profile page.`);
        }
    } catch (error) {
        console.error(`Failed to fetch projects for @${user.username}:`, error);
    }

    // Fallback to profile page if no project is found
    if (!contentUrl) {
        contentUrl = `https://websim.com/@${user.username}`;
    }

    // Toggle tip button based on whether a project is loaded
    tipUserButton.style.display = viewedProfileData.project ? 'block' : 'none';
    
    profileIframe.onload = () => {
        iframeLoader.style.display = 'none';
        profileIframe.style.display = 'block';
    };
    
    profileIframe.onerror = () => {
        iframeLoader.textContent = 'Could not load content.';
        tipUserButton.style.display = 'none';
    };

    profileIframe.src = contentUrl;
}

function closeProfileModal() {
    profileModal.style.display = 'none';
    profileIframe.src = 'about:blank'; // Stop loading and clear content
    profileModalContent.classList.remove('profile-modal-content');

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

tipUserButton.addEventListener('click', handleTipUser);
tipForm.addEventListener('submit', handleTipSubmit);
closeTipModalButton.addEventListener('click', closeTipModal);

closeProfileModalButton.addEventListener('click', closeProfileModal);

window.addEventListener('click', (event) => {
    if (event.target === profileModal) {
        closeProfileModal();
    }
    if (event.target === tipModal) {
        tipModal.style.display = 'none';
        profileModal.style.display = 'flex';
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

window.websim.addEventListener('comment:created', (data) => {
    const { comment } = data;
    // Check if the new comment is a tip from the current user
    if (
        comment.author.id === currentUser.id &&
        comment.card_data?.type === 'tip_comment' &&
        viewedProfileData?.user && 
        comment.project_id === viewedProfileData.project.id
    ) {
        console.log('Successfully posted a tip. Updating display.');
        updateAndDisplayTips(viewedProfileData.user.id);
    }
});

init();