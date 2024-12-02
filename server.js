const express = require('express');
const axios = require('axios');
const app = express();
const https = require('https');
const fs = require('fs');
const socketIo = require('socket.io');
const path = require('path');

// Load SSL certificate and key
const keyPath = path.join(__dirname, 'server.key');
const certPath = path.join(__dirname, 'server.cert');

const privateKey = fs.readFileSync(keyPath, 'utf8');
const certificate = fs.readFileSync(certPath, 'utf8');

app.use(express.json({limit: '50mb'}));  // Increase the limit if needed

// Serve static files from the 'public' folder
app.use(express.static('public'));

app.get('/', (req, res) => {
  res.send('Hello from Node.js server!');
});

// app.post('/process-frame', async (req, res) => {
//   try {
//     console.log('Received frame for processing');
//     const response = await axios.post('http://127.0.0.1:5000/process-frame', req.body);
//     console.log('Python server response:', response.data);
//     res.json(response.data);
//   } catch (error) {
//     console.error('Error processing frame:', error.message);
//     if (error.response) {
//       console.error('Python server responded with:', error.response.status, error.response.data);
//     }
//     res.status(500).json({error: 'Error processing frame: ' + error.message});
//   }
// });

const options = {
    key: privateKey,
    cert: certificate
};

const server = https.createServer(options, app);
const io = socketIo(server);

// Add this line to define the users object
const users = {};
const activeCallUsers = new Set(); // Track users in active calls

// Socket.io logic
io.on('connection', (socket) => {
  console.log('New client connected');
  
  // Handle joining a room
    //   socket.on('join_room', (roomId) => {
    //     socket.join(roomId);
    //     console.log(`User joined room: ${roomId}`);
    //   });

  // Handle user registration
  socket.on('register', (data) => {
    users[socket.id] = { username: data.username }; // Store username
    updateUserList(); // Update user list when a new user registers
  });

  // Update user list on disconnect
  socket.on('disconnect', () => {
    console.log('Client disconnected');
    activeCallUsers.delete(socket.id); // Remove from active calls
    delete users[socket.id]; // Remove user on disconnect
    updateUserList(); // Update user list when a user disconnects
  });

//   // Handle sending offers, answers, and ICE candidates
//   socket.on('offer', (offer, roomId) => {
//     socket.to(roomId).emit('offer', offer);
//   });

//   socket.on('answer', (answer, roomId) => {
//     socket.to(roomId).emit('answer', answer);
//   });

//   socket.on('ice-candidate', (candidate, roomId) => {
//     socket.to(roomId).emit('ice-candidate', candidate);
//   });

// Relay WebRTC signaling messages
    socket.on('signal', (data) => {
        io.to(data.targetId).emit('signal', {
            senderId: socket.id,
            message: data.message,
        });
    });


//   // Handle chat messages
//   socket.on('chat_message', (data) => {
//     io.to(data.roomId).emit('chat_message', data);
//   });
 // Handle call requests
    socket.on('call', (data) => {
        // Check if target user is in an active call
        if (activeCallUsers.has(data.targetId)) {
            // Target user is busy, notify caller with specific message
            const busyUsername = users[data.targetId].username;
            socket.emit('userBusy', {
                busyUserId: data.targetId,
                busyUsername: busyUsername,
                reason: 'active_call',
                message: `${busyUsername} is busy on another call. Please try again after some time.`
            });
            return;
        }

        const callerUsername = users[socket.id].username;
        io.to(data.targetId).emit('call', {
            callerId: socket.id,
            callerUsername
        });
    });

// Handle call answer
    socket.on('answer', (data) => {
        const answererUsername = users[socket.id].username;
        // Add both users to active calls set
        activeCallUsers.add(socket.id);
        activeCallUsers.add(data.callerId);
        
        io.to(data.callerId).emit('answer', {
            answererId: socket.id,
            answererUsername
        });
    });

// Handle call rejection
    socket.on('callRejected', (data) => {
        // Remove from active calls if present
        activeCallUsers.delete(socket.id);
        activeCallUsers.delete(data.callerId);
        
        const rejecterUsername = users[data.rejecterId]?.username;
        io.to(data.callerId).emit('callRejected', {
            rejecterId: data.rejecterId,
            rejecterUsername
        });
    });

    socket.on('userBusy', (data) => {
        io.to(data.callerId).emit('userBusy', {
            busyUserId: data.busyUserId,
            busyUsername: data.busyUsername,
            reason: 'active_call',
            message: `${data.busyUsername} is busy on another call. Please try again after some time.`
        });
    });

    socket.on('noResponse', (data) => {
        io.to(data.callerId).emit('noResponse', {
            message: 'User is inactive or unavailable. Please try again later.'
        });
    });

  

    //   // Handle disconnection
    //   socket.on('disconnect', () => {
//     console.log('Client disconnected');
//   });

  // Function to update the user list
  function updateUserList() {
    io.emit('updateUserList', Object.keys(users).map(id => ({ id, username: users[id].username }))); // Notify all clients about the updated user list
  }

  //Handle hangup event
  socket.on('hangup', (data) => {
    // Remove both users from active calls
    activeCallUsers.delete(socket.id);
    activeCallUsers.delete(data.targetId);
    
    io.to(data.targetId).emit('hangup', { 
        username: data.username 
    });
  });


});

// Add after your existing middleware
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', 'https://localhost:5000');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    res.header('Access-Control-Allow-Credentials', 'true');
    next();
});

server.listen(4000, '0.0.0.0', () => {
  console.log('Server running on https://0.0.0.0:4000');
});

