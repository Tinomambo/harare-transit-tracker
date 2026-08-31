const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// In-Memory Data Stores (Replace with database if needed)
const activeVehicles = new Map(); // Stores driver telemetry
const registeredVehicles = new Map(); // Registered by Admin (Plate -> PIN)

// ------------------------------------------------------------------
// 1. ADMIN DASHBOARD AUTHENTICATION ROUTE (/index.html)
// ------------------------------------------------------------------
app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;

    if (username === 'admin' && password === 'harare2026') {
        return res.json({ 
            success: true, 
            message: 'Admin authentication successful',
            role: 'admin'
        });
    }

    return res.status(401).json({ 
        success: false, 
        message: 'Unauthorized admin credentials.' 
    });
});

// ------------------------------------------------------------------
// 2. ENFORCEMENT OFFICER AUTHENTICATION ROUTE (/enforcement.html)
// ------------------------------------------------------------------
app.post('/api/officer/login', (req, res) => {
    const { username, password } = req.body;

    if (username === 'officer' && password === 'harare2026') {
        return res.json({ 
            success: true, 
            message: 'Officer authentication successful',
            role: 'officer'
        });
    }

    return res.status(401).json({ 
        success: false, 
        message: 'Unauthorized officer credentials.' 
    });
});

// ------------------------------------------------------------------
// 3. DRIVER PORTAL AUTHENTICATION & REGISTRATION (/driver.html)
// ------------------------------------------------------------------
app.post('/api/admin/register-vehicle', (req, res) => {
    const { plate, pin } = req.body;
    if (!plate || !pin) {
        return res.status(400).json({ success: false, message: 'Plate and PIN are required.' });
    }
    
    const formattedPlate = plate.trim().toUpperCase();
    registeredVehicles.set(formattedPlate, pin.trim());
    return res.json({ success: true, message: `Vehicle ${formattedPlate} registered successfully.` });
});

app.post('/api/driver/verify', (req, res) => {
    const { plate, pin } = req.body;
    const formattedPlate = plate ? plate.trim().toUpperCase() : '';
    const storedPin = registeredVehicles.get(formattedPlate);

    if (storedPin && storedPin === pin.trim()) {
        return res.json({ success: true, message: 'Driver verified' });
    }

    return res.status(401).json({ success: false, message: 'Invalid Plate or Access PIN.' });
});

// ------------------------------------------------------------------
// 4. WEBSOCKET REAL-TIME TELEMETRY ENGINE
// ------------------------------------------------------------------
wss.on('connection', (ws) => {
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            if (data.type === 'TELEMETRY_UPDATE') {
                activeVehicles.set(data.plate, {
                    lat: data.lat,
                    lng: data.lng,
                    speed: data.speed,
                    timestamp: new Date()
                });

                // Broadcast active location to all admin & enforcement clients
                wss.clients.forEach((client) => {
                    if (client !== ws && client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({ type: 'FLEET_UPDATE', data: Array.from(activeVehicles.entries()) }));
                    }
                });
            }
        } catch (err) {
            console.error('WebSocket Error:', err.message);
        }
    });

    ws.on('close', () => {
        // Handle client disconnects
    });
});

// ------------------------------------------------------------------
// 5. SERVER STARTUP
// ------------------------------------------------------------------
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Smart Transport System running on port ${PORT}`);
});