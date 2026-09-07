const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const VEHICLES_FILE = path.join(__dirname, 'vehicles.json');

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// In-Memory Live Telemetry Store (Plate -> Telemetry Object)
const activeFleet = new Map();

// Helper Functions for Persistent File Storage
function loadVehicles() {
    try {
        if (!fs.existsSync(VEHICLES_FILE)) {
            fs.writeFileSync(VEHICLES_FILE, JSON.stringify({}), 'utf8');
            return {};
        }
        const data = fs.readFileSync(VEHICLES_FILE, 'utf8');
        return JSON.parse(data || '{}');
    } catch (err) {
        console.error('Error reading vehicles.json:', err);
        return {};
    }
}

function saveVehicles(vehicles) {
    try {
        fs.writeFileSync(VEHICLES_FILE, JSON.stringify(vehicles, null, 2), 'utf8');
    } catch (err) {
        console.error('Error saving vehicles.json:', err);
    }
}

// ----------------------------------------------------
// API ENDPOINTS
// ----------------------------------------------------

// 1. Get List of Registered Vehicles (Admin / Public)
app.get('/api/vehicles', (req, res) => {
    const vehicles = loadVehicles();
    res.json(vehicles);
});

// 2. Register New Vehicle (Admin Dashboard)
app.post('/api/vehicles/register', (req, res) => {
    const { plate } = req.body;
    if (!plate) {
        return res.status(400).json({ success: false, message: 'License plate required.' });
    }

    const cleanPlate = plate.trim().toUpperCase();
    const vehicles = loadVehicles();

    if (vehicles[cleanPlate]) {
        return res.status(400).json({ success: false, message: 'Vehicle already registered.' });
    }

    vehicles[cleanPlate] = {
        plate: cleanPlate,
        registeredAt: new Date().toISOString()
    };

    saveVehicles(vehicles);
    res.json({ success: true, message: `Vehicle ${cleanPlate} registered successfully.` });
});

// 3. Delete Vehicle (Admin Dashboard)
app.delete('/api/vehicles/:plate', (req, res) => {
    const cleanPlate = req.params.plate.trim().toUpperCase();
    const vehicles = loadVehicles();

    if (!vehicles[cleanPlate]) {
        return res.status(404).json({ success: false, message: 'Vehicle not found.' });
    }

    delete vehicles[cleanPlate];
    activeFleet.delete(cleanPlate);

    saveVehicles(vehicles);
    broadcastFleet();

    res.json({ success: true, message: `Vehicle ${cleanPlate} removed successfully.` });
});

// 4. Check Vehicle Registration (Enforcement Verification Terminal)
app.get('/api/enforcement/check-registration/:plate', (req, res) => {
    const rawPlate = req.params.plate;
    if (!rawPlate) {
        return res.status(400).json({ registered: false, message: 'Plate required' });
    }

    const searchPlate = rawPlate.trim().toUpperCase();
    const registeredVehicles = loadVehicles();
    const record = registeredVehicles[searchPlate];

    if (record) {
        return res.json({
            registered: true,
            plate: searchPlate,
            registeredAt: record.registeredAt || 'N/A'
        });
    } else {
        return res.json({
            registered: false,
            plate: searchPlate
        });
    }
});

// 5. Enforcement Login Authentication
app.post('/api/enforcement/login', (req, res) => {
    const { username, password } = req.body;
    
    // Enforcement authentication check
    if (username === 'officer' && password === 'harare2026') {
        return res.json({ success: true, message: 'Authentication successful.' });
    }

    return res.status(401).json({ success: false, message: 'Invalid credentials.' });
});

// ----------------------------------------------------
// WEBSOCKET TELEMETRY BROADCASTING
// ----------------------------------------------------

wss.on('connection', (ws) => {
    // Send full fleet state upon new client connection
    ws.send(JSON.stringify({
        type: 'FLEET_UPDATE',
        vehicles: Array.from(activeFleet.entries())
    }));

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            // Drivers streaming live telemetry
            if (data.type === 'TELEMETRY_UPDATE') {
                const { plate, lat, lng, speed } = data;
                if (!plate) return;

                const cleanPlate = plate.trim().toUpperCase();

                activeFleet.set(cleanPlate, {
                    plate: cleanPlate,
                    lat: parseFloat(lat),
                    lng: parseFloat(lng),
                    speed: parseFloat(speed || 0),
                    timestamp: new Date().toISOString()
                });

                broadcastFleet();
            }
        } catch (err) {
            console.error('Error parsing WebSocket message:', err);
        }
    });

    ws.on('close', () => {
        // Handle disconnect if tracking sessions end
    });
});

function broadcastFleet() {
    const payload = JSON.stringify({
        type: 'FLEET_UPDATE',
        vehicles: Array.from(activeFleet.entries())
    });

    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(payload);
        }
    });
}

// Start HTTP Server
server.listen(PORT, () => {
    console.log(`City of Harare Public Transport Server running on port ${PORT}`);
});
