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

// ------------------------------------------------------------------
// 1. ROOT ROUTE - SERVE CENTRAL PORTAL DIRECTLY
// ------------------------------------------------------------------
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'portal.html'));
});

// Serve static assets from public folder
app.use(express.static(path.join(__dirname, 'public')));

// Data Stores
const activeVehicles = new Map();
const registeredVehicles = new Map();
const enforcementAudits = [];

// ------------------------------------------------------------------
// 2. AUTHENTICATION ENDPOINTS (Password: April2005)
// ------------------------------------------------------------------

// Admin Login
app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;
    if (username === 'admin' && password === 'April2005') {
        return res.json({ success: true, message: 'Admin authenticated' });
    }
    return res.status(401).json({ success: false, message: 'Invalid admin credentials.' });
});

// Officer Login
app.post('/api/officer/login', (req, res) => {
    const { username, password } = req.body;
    if (username === 'officer' && password === 'April2005') {
        return res.json({ success: true, message: 'Officer authenticated' });
    }
    return res.status(401).json({ success: false, message: 'Invalid officer credentials.' });
});

// Vehicle Registration
app.post('/api/admin/register-vehicle', (req, res) => {
    const { plate, pin } = req.body;
    if (!plate || !pin) {
        return res.status(400).json({ success: false, message: 'Plate and PIN are required.' });
    }
    const formattedPlate = plate.trim().toUpperCase();
    registeredVehicles.set(formattedPlate, pin.trim());
    return res.json({ success: true, message: `Vehicle ${formattedPlate} registered successfully.` });
});

// Driver Verification
app.post('/api/driver/verify', (req, res) => {
    const { plate, pin } = req.body;
    const formattedPlate = plate ? plate.trim().toUpperCase() : '';
    const storedPin = registeredVehicles.get(formattedPlate);

    if (storedPin && storedPin === pin.trim()) {
        return res.json({ success: true, message: 'Driver verified' });
    }
    return res.status(401).json({ success: false, message: 'Invalid Plate or Access PIN.' });
});

// Enforcement Verification
app.post('/api/enforcement/verify-plate', (req, res) => {
    const { plate } = req.body;
    if (!plate) return res.status(400).json({ success: false, message: 'Plate required.' });

    const formattedPlate = plate.trim().toUpperCase();
    const isRegistered = registeredVehicles.has(formattedPlate);
    const activeTelemetry = activeVehicles.get(formattedPlate);

    enforcementAudits.push({
        plate: formattedPlate,
        timestamp: new Date().toISOString(),
        isRegistered,
        isBroadcasting: !!activeTelemetry
    });

    return res.json({
        success: true,
        plate: formattedPlate,
        isRegistered,
        isBroadcasting: !!activeTelemetry
    });
});

// ------------------------------------------------------------------
// 3. WEBSOCKET ENGINE
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));