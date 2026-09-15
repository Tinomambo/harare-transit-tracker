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
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// In-Memory Live Telemetry Store (Plate -> Telemetry Object)
const activeFleet = new Map();

// File Storage Helpers
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
// ROUTE SHORTCUTS & AUTHENTICATION ENDPOINTS
// ----------------------------------------------------

app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/driver', (req, res) => res.sendFile(path.join(__dirname, 'public', 'driver.html')));
app.get('/enforcement', (req, res) => res.sendFile(path.join(__dirname, 'public', 'enforcement.html')));

// Admin Login
app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;
    const cleanUser = username ? username.trim() : '';
    const cleanPass = password ? password.trim() : '';

    if (cleanUser === 'admin' && cleanPass === 'April2005') {
        return res.json({ success: true, message: 'Admin authentication successful.' });
    }
    return res.status(401).json({ success: false, message: 'Invalid admin credentials.' });
});

// Enforcement Login
app.post('/api/enforcement/login', (req, res) => {
    const { username, password } = req.body;
    const cleanUser = username ? username.trim() : '';
    const cleanPass = password ? password.trim() : '';

    if ((cleanUser === 'officer' || cleanUser === 'admin') && cleanPass === 'April2005') {
        return res.json({ success: true, message: 'Officer authentication successful.' });
    }
    return res.status(401).json({ success: false, message: 'Invalid enforcement credentials.' });
});

// Driver Verification / Login
app.post('/api/driver/login', (req, res) => {
    const { plate, pin } = req.body;
    if (!plate || !pin) {
        return res.status(400).json({ success: false, message: 'Plate and PIN are required.' });
    }

    const cleanPlate = plate.trim().toUpperCase();
    const cleanPin = pin.toString().trim();
    const vehicles = loadVehicles();

    if (vehicles[cleanPlate] && vehicles[cleanPlate].pin === cleanPin) {
        return res.json({ success: true, message: 'Driver authenticated successfully.', plate: cleanPlate });
    }

    return res.status(401).json({ success: false, message: 'Invalid Plate or Access PIN.' });
});

// ----------------------------------------------------
// VEHICLE MANAGEMENT ENDPOINTS
// ----------------------------------------------------

app.get('/api/vehicles', (req, res) => {
    res.json(loadVehicles());
});

app.post('/api/vehicles/register', (req, res) => {
    try {
        const rawPlate = req.body.plate || req.body.licensePlate || req.body.vehiclePlate;
        const rawPin = req.body.pin || req.body.driverPin || req.body.accessPin;

        if (!rawPlate) {
            return res.status(400).json({ success: false, message: 'License plate is required.' });
        }

        const cleanPlate = rawPlate.toString().trim().toUpperCase();
        const cleanPin = rawPin ? rawPin.toString().trim() : Math.floor(1000 + Math.random() * 9000).toString();
        const vehicles = loadVehicles();

        if (vehicles[cleanPlate]) {
            return res.status(400).json({ success: false, message: `Vehicle ${cleanPlate} is already registered.` });
        }

        vehicles[cleanPlate] = {
            plate: cleanPlate,
            pin: cleanPin,
            registeredAt: new Date().toISOString()
        };

        saveVehicles(vehicles);

        return res.json({
            success: true,
            message: `Vehicle ${cleanPlate} registered successfully.`,
            plate: cleanPlate,
            pin: cleanPin
        });
    } catch (error) {
        console.error('Registration error:', error);
        return res.status(500).json({ success: false, message: 'Server error saving vehicle.' });
    }
});

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

app.get('/api/enforcement/check-registration/:plate', (req, res) => {
    const rawPlate = req.params.plate;
    if (!rawPlate) return res.status(400).json({ registered: false, message: 'Plate required' });

    const searchPlate = rawPlate.trim().toUpperCase();
    const vehicles = loadVehicles();
    const record = vehicles[searchPlate];

    if (record) {
        return res.json({
            registered: true,
            plate: searchPlate,
            pin: record.pin || 'N/A',
            registeredAt: record.registeredAt || 'N/A'
        });
    } else {
        return res.json({ registered: false, plate: searchPlate });
    }
});

// ----------------------------------------------------
// WEBSOCKET TELEMETRY BROADCASTING
// ----------------------------------------------------

wss.on('connection', (ws) => {
    // Send full fleet state immediately upon client connection
    ws.send(JSON.stringify({
        type: 'FLEET_UPDATE',
        vehicles: Array.from(activeFleet.entries())
    }));

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            if (data.type === 'TELEMETRY_UPDATE') {
                const { plate, lat, lng, speed } = data;
                if (!plate || lat === undefined || lng === undefined) return;

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
        // Disconnect handler
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

server.listen(PORT, () => {
    console.log(`City of Harare Fleet Control running on port ${PORT}`);
});
