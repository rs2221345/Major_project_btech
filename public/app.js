const socket = io();
let callTimeout = null;

// Global variables - declare these ONCE at the top
let flashInterval = null;
let flashStream = null;
let isCallActive = false;
let vibrateInterval = null;
let hasUserInteraction = false;
let isProcessingSignLanguage = false;
let signLanguageInterval = null;
const sessionId = Date.now().toString(); // Unique session ID for each call

// Get DOM elements
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const callButton = document.getElementById('callButton');
const hangupButton = document.getElementById('hangUpButton');
const captionButton = document.getElementById('captionButton');
const captionBox = document.getElementById('captionBox');
const userSelect = document.getElementById('userSelect');
const selectedUserDisplay = document.getElementById('selectedUserDisplay');
const userSelectButton = document.getElementById('userSelectButton');
const ringtone = document.getElementById('ringtone');

// Variables for WebRTC
let localStream;
let remoteStream;
let peerConnection;
let selectedUserId = null; // Store selected user's ID
let isCaptioning = false; // Track captioning status

// Automatically detect server IP address
const host = window.location.hostname;
const config = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    apiUrl: `https://${host}:5000`,
    wsUrl: `wss://${host}:4000`,
    mlServerUrl: `https://${host}:5000`
};

// Store username
let username = prompt("Please enter your username:") || `User_${Math.floor(Math.random() * 1000)}`;

// Request camera and microphone access
async function startLocalStream() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localVideo.srcObject = localStream;
    } catch (error) {
    }
}

// Emit username upon connecting
socket.emit('register', { username });

// Call button handler
callButton.onclick = () => {
    if (selectedUserId) {
        if (selectedUserId === socket.id) {
            showCustomNotification({
                message: "You cannot call yourself.",
                type: 'error',
                timeout: 3000
            });
            return;
        }

        // Reset state and start fresh
        isCallActive = false; // Reset first
        stopVibration(); // Stop any existing vibration
        
        // Start vibration immediately when call button is clicked
        if (navigator.vibrate) {
            navigator.vibrate([200]);
        }

        socket.emit('call', { targetId: selectedUserId, callerUsername: username });

        showCustomNotification({
            message: "Calling...",
            type: 'alert',
            timeout: 30000
        });

        isCallActive = true; // Now set to active

        if (navigator.vibrate) {
            const startOutgoingCallVibration = () => {
                if (isCallActive) {
                    navigator.vibrate([300, 200, 300]);
                    setTimeout(startOutgoingCallVibration, 1000);
                }
            };
            startOutgoingCallVibration();
        }
    } else {
        showCustomNotification({
            message: "Please select a user to call.",
            type: 'error',
            timeout: 3000
        });
    }
};

// Hangup button handler
hangupButton.onclick = () => {
    if (peerConnection) {
        showCustomNotification({
            message: "Call ended",
            type: 'alert',
            timeout: 3000
        });
        socket.emit('hangup', { 
            targetId: selectedUserId, 
            username,
            hangupInitiator: socket.id  // Add who initiated the hangup
        });
        closeConnection();
    } else {
        showCustomNotification({
            message: "No active call to hang up.",
            type: 'error',
            timeout: 3000
        });
    }
};

// Function to close the connection and clear video
function closeConnection() {
    isCallActive = false;
    stopVibration();
    
    if (peerConnection) {
        const senders = peerConnection.getSenders();
        senders.forEach(sender => peerConnection.removeTrack(sender));
        peerConnection.close();
        peerConnection = null;
    }
    
    if (remoteVideo.srcObject) {
        remoteVideo.srcObject.getTracks().forEach(track => track.stop());
        remoteVideo.srcObject = null;
    }

    if (callTimeout) {
        clearTimeout(callTimeout);
        callTimeout = null;
    }

    // Reset sign language detection
    const signLanguageButton = document.getElementById('toggleSignLanguageButton');
    const container = document.getElementById('sign-language-container');
    
    if (isProcessingSignLanguage) {
        if (signLanguageInterval) {
            clearInterval(signLanguageInterval);
            signLanguageInterval = null;
        }
        isProcessingSignLanguage = false;
    }
    
    // Hide button and container
    signLanguageButton.style.display = 'none';
    container.style.display = 'none';
    
    // Reset button text
    signLanguageButton.textContent = 'Start Sign Language Detection';
    
    // Clear detection results
    document.getElementById('current-letter').textContent = '';
    document.getElementById('current-word').textContent = '';
    document.getElementById('current-sentence').textContent = '';

    // Ensure vibration is completely stopped
    if (navigator.vibrate) {
        navigator.vibrate(0);
    }

    resetUserSelection();
}

// Function to reset user selection display
function resetUserSelection() {
    selectedUserDisplay.textContent = '';
    selectedUserId = null;
    captionButton.style.display = 'none'; // Hide caption button
}

// Function to close the dropdown
function closeDropdown() {
    userSelect.style.display = 'none'; // Hide the dropdown
}

// Function to open the dropdown
function openDropdown() {
    userSelect.style.display = 'block'; // Show the dropdown
}

// Handle user list update
socket.on('updateUserList', (userList) => {
    userSelect.innerHTML = ''; // Clear existing options

    userList.forEach(user => {
        const userDiv = document.createElement('div');
        userDiv.dataset.id = user.id;
        userDiv.textContent = user.username === username ? `${user.username} (YOU)` : user.username;

        // Highlight the local user
        if (user.username === username) {
            userDiv.style.fontWeight = 'bold';
            userDiv.style.color = 'green';
        }

        // Add click event for selection
        userDiv.onclick = () => {
            selectedUserId = user.id; // Store selected user ID
            selectedUserDisplay.textContent = user.username === username ? `${user.username} (YOU)` : user.username;
            closeDropdown(); // Close the dropdown after selection
            highlightSelectedUser(userDiv); // Highlight the selected user
        };

        userSelect.appendChild(userDiv);
    });
});

// Function to highlight the selected user
function highlightSelectedUser(selectedUserDiv) {
    const dropdownItems = userSelect.querySelectorAll('div');
    dropdownItems.forEach(item => {
        item.style.backgroundColor = ''; // Reset to original color
        item.style.color = ''; // Reset color for contrast
    });
    selectedUserDiv.style.backgroundColor = '#61dafb'; // Change to the selected color
    selectedUserDiv.style.color = 'white'; // White text for contrast
}

// Add these notification functions at the top of your app.js

function hideAllNotifications() {
    const existingNotification = document.getElementById('customNotification');
    if (existingNotification) {
        existingNotification.remove();
    }
}

function showCustomNotification(options) {
    const {
        message,
        buttons = [],
        type = 'default',
        timeout = null,
        priority = 'normal'
    } = options;

    if (priority !== 'high' && document.querySelector('.custom-notification.call-notification')) {
        return;
    }

    hideAllNotifications();

    const notification = document.createElement('div');
    notification.className = `custom-notification ${type}`;
    if (type === 'call') notification.className += ' call-notification';
    notification.id = 'customNotification';

    const messageDiv = document.createElement('div');
    messageDiv.className = 'notification-message';
    messageDiv.textContent = message;
    notification.appendChild(messageDiv);

    if (buttons.length > 0) {
        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'notification-buttons';

        buttons.forEach(button => {
            const btn = document.createElement('button');
            btn.className = `${button.class || ''}-btn`;
            btn.textContent = button.text;
            btn.onclick = () => {
                button.action();
                hideAllNotifications();
            };
            buttonContainer.appendChild(btn);
        });

        notification.appendChild(buttonContainer);
    }

    document.body.appendChild(notification);

    if (timeout) {
        setTimeout(() => {
            if (document.getElementById('customNotification') === notification) {
                notification.remove();
            }
        }, timeout);
    }

    return notification;
}

function hideCustomNotification() {
    const existingNotification = document.getElementById('customNotification');
    if (existingNotification) {
        existingNotification.remove();
    }
}

// Add this function at the top of your file
function playRingtone() {
    const ringtone = document.getElementById('ringtone');
    if (ringtone) {
        ringtone.play().catch(error => {
        });
    }
}

function stopRingtone() {
    const ringtone = document.getElementById('ringtone');
    if (ringtone) {
        ringtone.pause();
        ringtone.currentTime = 0;
    }
}

// Updated mobile device detection function without logging
function isMobileDevice() {
    const userAgent = navigator.userAgent.toLowerCase();
    const mobileKeywords = [
        'mobile',
        'android',
        'iphone',
        'ipad',
        'ipod',
        'blackberry',
        'windows phone',
        'opera mini',
        'webos'
    ];
    
    const isMobile = mobileKeywords.some(keyword => userAgent.includes(keyword));
    const hasTouchScreen = (
        'maxTouchPoints' in navigator && navigator.maxTouchPoints > 0
    ) || (
        'msMaxTouchPoints' in navigator && navigator.msMaxTouchPoints > 0
    );
    
    const isSmallScreen = window.innerWidth <= 800 && window.innerHeight <= 900;
    
    return isMobile || (hasTouchScreen && isSmallScreen);
}

// Updated vibration functions for calls
function startVibration() {
    if (!navigator.vibrate || !hasUserInteraction) {
        return;
    }

    isCallActive = true;

    try {
        // Stop any existing vibration first
        if (vibrateInterval) {
            clearInterval(vibrateInterval);
            vibrateInterval = null;
        }

        // Initial vibration pattern for incoming call
        const pattern = [1000, 500, 1000];
        navigator.vibrate(pattern);

        // Set up continuous vibration loop
        vibrateInterval = setInterval(() => {
            if (isCallActive && hasUserInteraction) {
                navigator.vibrate(pattern);
            }
        }, 2000); // Repeat every 2 seconds
    } catch (error) {
        // Handle vibration error silently
    }
}

function stopVibration() {
    isCallActive = false;
    if (navigator.vibrate && hasUserInteraction) {
        navigator.vibrate(0); // Stop any ongoing vibration
    }
    if (vibrateInterval) {
        clearInterval(vibrateInterval);
        vibrateInterval = null;
    }
}

// Update visibility change handler
function handleVisibilityChange() {
    if (document.visibilityState === 'hidden' && isCallActive) {
        // When page is hidden, use a different pattern
        if (hasUserInteraction && navigator.vibrate) {
            navigator.vibrate([3000, 50, 1000, 50, 1000, 50, 3000]);
        }
    }
}

// Add visibility change listener
document.addEventListener('visibilitychange', handleVisibilityChange);

// Update the call event handler
socket.on('call', async (data) => {
    if (callTimeout) {
        clearTimeout(callTimeout);
        callTimeout = null;
    }
    
    isCallActive = true;
    
    showCustomNotification({
        message: `${data.callerUsername} is calling you...`,
        buttons: [
            {
                text: 'Accept',
                class: 'accept',
                action: async () => {
                    hasUserInteraction = true;
                    stopAllNotifications();
                    handleCallAccept(data);
                }
            },
            {
                text: 'Reject',
                class: 'reject',
                action: () => {
                    hasUserInteraction = true;
                    stopAllNotifications();
                    handleCallReject(data);
                }
            },
            {
                text: 'Busy',
                class: 'busy',
                action: () => {
                    hasUserInteraction = true;
                    stopAllNotifications();
                    handleCallBusy(data);
                }
            }
        ],
        type: 'call',
        priority: 'high',
        timeout: 30000
    });

    playRingtone();
    startVibration();
    startFlash();

    callTimeout = setTimeout(() => {
        stopAllNotifications();
        handleNoResponse(data);
    }, 30000);
});

// Add a helper function to stop all notifications
function stopAllNotifications() {
    isCallActive = false;
    stopVibration();
    stopRingtone();
    stopFlash();
}

// Update hangup handler
socket.on('hangup', (data) => {
    isCallActive = false;
    stopVibration();
    showCustomNotification({
        message: `${data.username} ended the call.`,
        type: 'alert',
        timeout: 3000
    });
    closeConnection();
    resetUserSelection();
});

// Separate handler functions
function handleCallAccept(data) {
    if (callTimeout) {
        clearTimeout(callTimeout);
        callTimeout = null;
    }
    socket.emit('answer', { 
        callerId: data.callerId, 
        callerUsername: data.callerUsername 
    });
    startLocalStream()
        .then(() => {
            createPeerConnection(data.callerId);
            // Show both buttons when call is accepted
            document.getElementById('toggleSignLanguageButton').style.display = 'block';
            captionButton.style.display = 'block';
            updateUserSelectionDisplay(data.callerUsername);
        });
}

function handleCallReject(data) {
    if (callTimeout) {
        clearTimeout(callTimeout);
        callTimeout = null;
    }
    socket.emit('callRejected', { 
        callerId: data.callerId, 
        rejecterId: socket.id,
        reason: 'rejected'
    });
}

function handleCallBusy(data) {
    if (callTimeout) {
        clearTimeout(callTimeout);
        callTimeout = null;
    }
    socket.emit('userBusy', { 
        callerId: data.callerId, 
        busyUserId: socket.id,
        busyUsername: username
    });
}

function handleNoResponse(data) {
    hideCustomNotification();
    socket.emit('noResponse', {
        callerId: data.callerId,
        targetId: socket.id
    });
    callTimeout = null;
}

// Separate handlers for rejected and busy states
socket.on('callRejected', (data) => {
    isCallActive = false; // Stop vibration
    showCustomNotification({
        message: `Call rejected by ${data.rejecterUsername}.`,
        type: 'error',
        timeout: 3000
    });
    closeConnection();
    resetUserSelection();
});

socket.on('userBusy', (data) => {
    isCallActive = false; // Stop vibration
    showCustomNotification({
        message: `${data.busyUsername} is busy on another call. Please try again later.`,
        type: 'alert',
        timeout: 3000
    });
    closeConnection();
    resetUserSelection();
});

socket.on('noResponse', (data) => {
    isCallActive = false; // Stop vibration
    showCustomNotification({
        message: 'User is inactive or unavailable. Please try again later.',
        type: 'error',
        timeout: 5000
    });
    closeConnection();
    resetUserSelection();
});

// Update error handling
socket.on('error', (data) => {
    stopVibration();
    showCustomNotification({
        message: data.message,
        type: 'error',
        timeout: 3000
    });
});

// Update success messages
socket.on('answer', async (data) => {
    isCallActive = false; // Stop vibration
    showCustomNotification({
        message: `${data.answererUsername} accepted your call.`,
        type: 'success',
        timeout: 3000
    });
    await startLocalStream();
    createPeerConnection(data.answererId);
    document.getElementById('toggleSignLanguageButton').style.display = 'block';
    captionButton.style.display = 'block';
    updateUserSelectionDisplay(data.answererUsername);
});

// Create peer connection and handle media streams
function createPeerConnection(targetId) {
    try {
        // Close existing connection if any
        if (peerConnection) {
            peerConnection.close();
        }
        
        peerConnection = new RTCPeerConnection(config);

        // Add local stream tracks to peer connection
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });

        // Handle incoming tracks
        peerConnection.ontrack = event => {
            remoteVideo.srcObject = event.streams[0];
        };

        // Handle ICE candidates
        peerConnection.onicecandidate = event => {
            if (event.candidate) {
                socket.emit('signal', {
                    targetId,
                    message: {
                        type: 'candidate',
                        candidate: event.candidate
                    }
                });
            }
        };

        // Create and send offer
        peerConnection.createOffer()
            .then(offer => peerConnection.setLocalDescription(offer))
            .then(() => {
                socket.emit('signal', {
                    targetId,
                    message: peerConnection.localDescription
                });
            })
            .catch(() => {
                closeConnection();
            });

    } catch (error) {
        closeConnection();
    }
}

// Handle incoming signaling messages
socket.on('signal', async (data) => {
    try {
        if (!peerConnection) {
            peerConnection = new RTCPeerConnection(config);
            
            localStream.getTracks().forEach(track => {
                peerConnection.addTrack(track, localStream);
            });

            peerConnection.ontrack = event => {
                remoteVideo.srcObject = event.streams[0];
            };

            peerConnection.onicecandidate = event => {
                if (event.candidate) {
                    socket.emit('signal', {
                        targetId: data.senderId,
                        message: {
                            type: 'candidate',
                            candidate: event.candidate
                        }
                    });
                }
            };
        }

        // Handle offer
        if (data.message.type === 'offer') {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.message));
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            socket.emit('signal', {
                targetId: data.senderId,
                message: answer
            });
        } 
        // Handle answer
        else if (data.message.type === 'answer') {
            // Check connection state before setting remote description
            if (peerConnection.signalingState !== "stable") {
                await peerConnection.setRemoteDescription(new RTCSessionDescription(data.message));
            }
        }
        // Handle ICE candidate
        else if (data.message.type === 'candidate') {
            try {
                // Only add candidate if connection is not closed
                if (peerConnection.connectionState !== 'closed') {
                    await peerConnection.addIceCandidate(new RTCIceCandidate(data.message.candidate));
                }
            } catch (error) {
                // Ignore candidate errors
            }
        }
    } catch (error) {
        // Handle error by closing connection and resetting
        closeConnection();
    }
});

// Start local stream on load
document.addEventListener('DOMContentLoaded', startLocalStream);

// Event listeners for dropdown button
userSelectButton.onclick = () => {
    userSelect.style.display === 'block' ? closeDropdown() : openDropdown(); // Toggle dropdown
};

// Close the dropdown if the user clicks outside of it
window.onclick = (event) => {
    if (!event.target.matches('#userSelectButton') && !userSelect.contains(event.target)) {
        closeDropdown(); // Close dropdown if clicked outside
    }
};

// Caption Button Logic
let recognition; // Declare recognition variable in the global scope

captionButton.addEventListener('click', function () {
    captionBox.style.display = 'block'; // Make the caption box visible

    // Toggle recognition
    if (!isCaptioning) {
        captionButton.innerText = 'Stop Captioning'; // Change button text to "Stop Captioning"
        startCaptioning(); // Start captioning
    } else {
        captionButton.innerText = 'Start Captioning'; // Change button text to "Start Captioning"
        stopCaptioning(); // Stop captioning
    }
});

// Start captioning
function startCaptioning() {
    recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
    recognition.lang = 'en-US'; // Set language for recognition
    recognition.interimResults = true; // Show interim results
    recognition.continuous = true; // Ensure continuous listening

    // Handle recognition results
    recognition.onresult = (event) => {
        const transcript = Array.from(event.results)
            .map(result => result[0].transcript) // Get the transcript of recognized speech
            .join('');

        captionBox.innerText = transcript; // Display transcript in the caption box
    };

    recognition.onend = () => {
        console.log("Recognition has ended, restarting...");
        recognition.start(); // Restart recognition
    };

    recognition.onerror = (event) => {
        // Restart recognition on error as well
        recognition.start();
    };

    recognition.start(); // Start recognition
    isCaptioning = true; // Update the captioning status
}

// Stop captioning
function stopCaptioning() {
    if (recognition) {
        recognition.stop(); // Stop the recognition
    }
    captionBox.style.display = 'none'; // Hide the caption box
    isCaptioning = false; // Update the captioning status
}

// Start the local stream when the page loads
startLocalStream();


document.addEventListener('DOMContentLoaded', (event) => {
    const userSelectButton = document.getElementById('userSelectButton');
    if (userSelectButton) {
        userSelectButton.addEventListener('click', function() {
            openDropdown();
        });
    }
});

function openDropdown() {
    const userSelect = document.getElementById('userSelect');
    if (userSelect) {
        userSelect.style.display = 'block';
    }
}

// Function to update user selection display
function updateUserSelectionDisplay(username) {
    // Update the selected user display for the current user
    selectedUserDisplay.textContent = username; // Show the other user's name
    // Optionally, you can also update the dropdown or any other UI element as needed
}

// Add connection state change handler
if (peerConnection) {
    peerConnection.onconnectionstatechange = () => {
        if (peerConnection.connectionState === 'failed' || 
            peerConnection.connectionState === 'closed') {
            closeConnection();
        }
    };
}

// Add flash control functions
async function startFlash() {
    if (!isMobileDevice()) {
        return;
    }

    try {
        // Get video stream with flash
        flashStream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: 'environment',
                advanced: [{ torch: true }]
            }
        });

        // Start flash blinking
        let isFlashOn = true;
        flashInterval = setInterval(() => {
            const track = flashStream.getVideoTracks()[0];
            if (track && 'torch' in track.getCapabilities()) {
                track.applyConstraints({
                    advanced: [{ torch: isFlashOn }]
                });
                isFlashOn = !isFlashOn;
            }
        }, 1000);
    } catch (error) {
        // Silently fail if flash is not supported
    }
}

function stopFlash() {
    if (flashInterval) {
        clearInterval(flashInterval);
        flashInterval = null;
    }

    if (flashStream) {
        flashStream.getTracks().forEach(track => track.stop());
        flashStream = null;
    }
}

// Handle visibility change
function handleVisibilityChange() {
    if (document.hidden) {
        console.log('Page hidden, ensuring vibration/ringtone continue...');
        if (isCallActive) {
            // Restart vibration and ringtone
            if ('vibrate' in navigator) {
                navigator.vibrate([3000, 50, 1000, 50, 1000, 50, 3000]);
            }
            const ringtone = document.getElementById('ringtone');
            if (ringtone && ringtone.paused) {
                ringtone.play().catch(e => console.log('Ringtone restart failed:', e));
            }
        }
    }
}

// Add event listener for user interaction
document.addEventListener('click', function() {
    hasUserInteraction = true;
}, { once: true }); // Only needs to fire once

// Add this function to update the UI with predictions
function updateSignLanguageUI(prediction) {
    const signLanguageContainer = document.getElementById('sign-language-container');
    signLanguageContainer.innerHTML = `
        <div class="prediction-display">
            <p class="letter">Current Letter: ${prediction.letter}</p>
            <p class="word">Current Word: ${prediction.word}</p>
            <p class="sentence">Sentence: ${prediction.sentence}</p>
        </div>
    `;
}

// Function to capture and process video frame
async function processSignLanguage(video) {
    if (!video.srcObject || !isProcessingSignLanguage) return;
    
    try {
        if (video.readyState !== video.HAVE_ENOUGH_DATA) {
            return;
        }

        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        const frameData = canvas.toDataURL('image/jpeg', 0.8);

        // Add error handling for fetch
        try {
            const response = await fetch(`${config.mlServerUrl}/process-frame`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    frame: frameData,
                    sessionId: sessionId,
                    isRemote: socket.id !== selectedUserId
                })
            });

            if (!response.ok) {
                throw new Error(`Server responded with ${response.status}: ${response.statusText}`);
            }
            
            const result = await response.json();
            if (result.success && result.prediction) {
                document.getElementById('current-letter').textContent = result.prediction.letter || '';
                document.getElementById('current-word').textContent = result.prediction.word || '';
                document.getElementById('current-sentence').textContent = result.prediction.sentence || '';
            }
        } catch (fetchError) {
            console.error('Fetch error:', fetchError);
            // Only show error notification once
            if (!window.hasShownMLError) {
                showCustomNotification({
                    message: 'Unable to connect to ML server. Please check your connection.',
                    type: 'error',
                    timeout: 5000
                });
                window.hasShownMLError = true;
            }
        }
    } catch (error) {
        console.error('Video processing error:', error);
    }
}

// Update toggle button handler
document.getElementById('toggleSignLanguageButton').onclick = function() {
    const container = document.getElementById('sign-language-container');
    const button = this;
    
    isProcessingSignLanguage = !isProcessingSignLanguage;
    
    if (isProcessingSignLanguage) {
        button.textContent = 'Stop Sign Language Detection';
        button.classList.add('active');
        container.style.display = 'block';
        
        signLanguageInterval = setInterval(() => {
            const remoteVideo = document.getElementById('remoteVideo');
            if (remoteVideo && remoteVideo.srcObject) {
                processSignLanguage(remoteVideo);
            }
        }, 500);
    } else {
        button.textContent = 'Start Sign Language Detection';
        button.classList.remove('active');
        container.style.display = 'none';
    }
};

// Add this function to check ML server status
async function checkMLServerStatus() {
    try {
        const response = await fetch(`${config.mlServerUrl}/test`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            },
            mode: 'cors'
        });
        const data = await response.json();
        return data.status === 'ok';
    } catch (error) {
        console.error('ML Server connection error:', error);
        showCustomNotification({
            message: 'ML Server connection failed. Please check if the server is running.',
            type: 'error',
            timeout: 3000
        });
        return false;
    }
}







