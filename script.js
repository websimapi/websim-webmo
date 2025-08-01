let currentUser = null;
let currentProject = null;
let selectedUserForTipping = null;

const userGrid = document.getElementById('user-grid');
const loadingDiv = document.getElementById('loading');
const tipModal = document.getElementById('tip-modal');
const closeModalButton = document.getElementById('close-modal');
const tipForm = document.getElementById('tip-form');
const tipUsernameSpan = document.getElementById('tip-username');
const tipAmountInput = document.getElementById('tip-amount');
const tipMessageInput = document.getElementById('tip-message');

async function init() {
    try {
        [currentUser, currentProject] = await Promise.all([
            window.websim.getCurrentUser(),
            window.websim.getCurrentProject()
        ]);

        if (currentUser) {
            loadFollowingUsers(currentUser.username);
        } else {
            loadingDiv.textContent = 'Please log in to see your followed users.';
        }
    } catch (error) {
        console.error("Initialization error:", error);
        loadingDiv.textContent = 'Could not load user data. Please try again.';
    }
}

async function loadFollowingUsers(username) {
    try {
        const response = await fetch(`/api/v1/users/${username}/following`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();

        if (data.following.data.length === 0) {
            loadingDiv.textContent = "You aren't following anyone yet. Explore Websim to find creators!";
            return;
        }

        loadingDiv.style.display = 'none';
        userGrid.innerHTML = ''; // Clear previous content

        for (const { follow } of data.following.data) {
            const userCard = createUserCard(follow.user);
            userGrid.appendChild(userCard);
        }

    } catch (error) {
        console.error('Failed to load following users:', error);
        loadingDiv.textContent = 'Error loading followed users.';
    }
}

function createUserCard(user) {
    const card = document.createElement('div');
    card.className = 'user-card';
    card.dataset.user = JSON.stringify(user);

    const tipAmount = 0; // Placeholder as per instructions

    card.innerHTML = `
        <img src="${user.avatar_url || 'https://images.websim.com/avatar/websim'}" alt="${user.username}'s avatar" class="avatar">
        <div class="username">@${user.username}</div>
        <div class="tip-info">Total Tips Received: ${tipAmount} credits</div>
    `;
    
    card.addEventListener('click', () => {
        selectedUserForTipping = user;
        openTipModal();
    });

    return card;
}

function openTipModal() {
    if (!selectedUserForTipping) return;
    tipUsernameSpan.textContent = `@${selectedUserForTipping.username}`;
    tipModal.style.display = 'flex';
}

function closeTipModal() {
    tipModal.style.display = 'none';
    tipForm.reset();
    selectedUserForTipping = null;
}

async function handleTipSubmit(event) {
    event.preventDefault();
    if (!selectedUserForTipping) return;

    const amount = parseInt(tipAmountInput.value, 10);
    const message = tipMessageInput.value.trim();

    if (isNaN(amount) || amount < 10) {
        alert('Minimum tip amount is 10 credits.');
        return;
    }
    if (!message) {
        alert('Please enter a message for your tip.');
        return;
    }
    
    const fullMessage = `To @${selectedUserForTipping.username}: ${message}`;

    try {
        await window.websim.postComment({
            content: fullMessage,
            credits: amount,
        });
        // The postComment UI handles success/failure messages for the user.
        // We can just close our modal after they interact with it.
        closeTipModal();
    } catch (error) {
        console.error("Failed to post comment:", error);
        alert(`An error occurred while trying to tip: ${error.message}`);
    }
}

closeModalButton.addEventListener('click', closeTipModal);
tipForm.addEventListener('submit', handleTipSubmit);

window.addEventListener('click', (event) => {
    if (event.target === tipModal) {
        closeTipModal();
    }
});

init();

