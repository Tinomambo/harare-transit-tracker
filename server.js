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

// In-Memory Data Stores
const activeVehicles = new Map();     // Live WebSocket telemetry state
const registeredVehicles = new Map(); // Registered vehicles (Plate -> PIN)
const enforcementAudits = [];         // Audit log history

// ------------------------------------------------------------------
// AUTHENTICATION & API ENDPOINTS
// ------------------------------------------------------------------

// Admin Login Endpoint
app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;
    if (username === 'admin' && password === 'April2005') {
        return res.json({ success: true, message: 'Admin authenticated' });
    }
    return res.status(401).json({ success: false, message: 'Invalid admin credentials.' });
});

// Enforcement Officer Login Endpoint
app.post('/api/officer/login', (req, res) => {
    const { username, password } = req.body;
    if (username === 'officer' && password === 'April2005') {
        return res.json({ success: true, message: 'Officer authenticated' });
    }
    return res.status(401).json({ success: false, message: 'Invalid officer credentials.' });
});

// Register Vehicle & Driver PIN (Admin Action)
app.post('/api/admin/register-vehicle', (req, res) => {
    const { plate, pin } = req.body;
    if (!plate || !pin) {
        return res.status(400).json({ success: false, message: 'Plate and PIN are required.' });
    }
    const formattedPlate = plate.trim().toUpperCase();
    registeredVehicles.set(formattedPlate, pin.trim());
    return res.json({ success: true, message: `Vehicle ${formattedPlate} registered successfully.` });
});

// Driver Verification Endpoint
app.post('/api/driver/verify', (req, res) => {
    const { plate, pin } = req.body;
    const formattedPlate = plate ? plate.trim().toUpperCase() : '';
    const storedPin = registeredVehicles.get(formattedPlate);

    if (storedPin && storedPin === pin.trim()) {
        return res.json({ success: true, message: 'Driver verified' });
    }
    return res.status(401).json({ success: false, message: 'Invalid Plate or Access PIN.' });
});

// Enforcement Plate Verification Search Endpoint
app.post('/api/enforcement/verify-plate', (req, res) => {
    const { plate } = req.body;
    if (!plate) {
        return res.status(400).json({ success: false, message: 'Plate number is required.' });
    }

    const formattedPlate = plate.trim().toUpperCase();
    const isRegistered = registeredVehicles.has(formattedPlate);
    const activeTelemetry = activeVehicles.get(formattedPlate);

    const auditEntry = {
        plate: formattedPlate,
        timestamp: new Date().toISOString(),
        isRegistered,
        isBroadcasting: !!activeTelemetry
    };
    enforcementAudits.push(auditEntry);

    return res.json({
        success: true,
        plate: formattedPlate,
        isRegistered,
        isBroadcasting: !!activeTelemetry,
        telemetry: activeTelemetry || null
    });
});

// ------------------------------------------------------------------
// WEBSOCKET REAL-TIME BROADCAST ENGINE
// ------------------------------------------------------------------
wss.on('connection', (ws) => {
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            if (data.type === 'TELEMETRY_UPDATE') {
                activeVehicles.set(data.plate.toUpperCase(), {
                    lat: data.lat,
                    lng: data.lng,
                    speed: data.speed,
                    timestamp: new Date().toISOString()
                });

                // Broadcast updated positions to all connected web clients
                const updatePayload = JSON.stringify({
                    type: 'FLEET_UPDATE',
                    vehicles: Array.from(activeVehicles.entries())
                });

                wss.clients.forEach((client) => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(updatePayload);
                    }
                });
            }
        } catch (err) {
            console.error('WebSocket Error:', err.message);
        }
    });
});

// Fallback Route for portal.html
app.get('/portal.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'portal.html'));
});

// Server Initialization
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Smart Public Transport Tracker running on port ${PORT}`);
});