const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// In-Memory Data Stores
const activeVehicles = new Map();
const registeredVehicles = new Map();

// ------------------------------------------------------------------
// 1. PAGE ROUTING (Serves your dashboards)
// ------------------------------------------------------------------
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/enforcement', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'enforcement.html'));
});

app.get('/driver', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'driver.html'));
});

// ------------------------------------------------------------------
// 2. AUTHENTICATION ENDPOINTS
// ------------------------------------------------------------------

// Admin Login
app.post(['/api/admin/login', '/login'], (req, res) => {
    const { username, password } = req.body;
    if (username === 'admin' && password === 'harare2026') {
        return res.status(200).json({ 
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

// Enforcement Officer Login
app.post(['/api/officer/login', '/officer/login'], (req, res) => {
    const { username, password } = req.body;
    if (username === 'officer' && password === 'harare2026') {
        return res.status(200).json({ 
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

// Vehicle Registration & Driver Access
app.post('/api/admin/register-vehicle', (req, res) => {
    const { plate, pin } = req.body;
    if (!plate || !pin) {
        return res.status(400).json({ success: false, message: 'Plate and PIN are required.' });
    }
    const formattedPlate = plate.trim().toUpperCase();
    registeredVehicles.set(formattedPlate, pin.trim());
    return res.status(200).json({ success: true, message: `Vehicle ${formattedPlate} registered successfully.` });
});

app.post('/api/driver/verify', (req, res) => {
    const { plate, pin } = req.body;
    const formattedPlate = plate ? plate.trim().toUpperCase() : '';
    const storedPin = registeredVehicles.get(formattedPlate);

    if (storedPin && storedPin === pin.trim()) {
        return res.status(200).json({ success: true, message: 'Driver verified' });
    }
    return res.status(401).json({ success: false, message: 'Invalid Plate or Access PIN.' });
});

// ------------------------------------------------------------------
// 3. WEBSOCKET ENGINE (Real-Time Telemetry)
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

                wss.clients.forEach((client) => {
                    if (client !== ws && client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({ 
                            type: 'FLEET_UPDATE', 
                            data: Array.from(activeVehicles.entries()) 
                        }));
                    }
                });
            }
        } catch (err) {
            console.error('WebSocket Error:', err.message);
        }
    });
});

// ------------------------------------------------------------------
// 4. SERVER STARTUP
// ------------------------------------------------------------------
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Harare Transit Tracker running on port ${PORT}`);
});