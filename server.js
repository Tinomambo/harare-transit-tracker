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

// In-Memory Live Tracking State
// Key: Plate Number (String), Value: { lat, lng, speed, timestamp }
const activeVehicles = new Map();

// --- PERSISTENCE HELPERS ---

// Load registered vehicles from JSON file
function loadVehicles() {
    try {
        if (!fs.existsSync(VEHICLES_FILE)) {
            fs.writeFileSync(VEHICLES_FILE, JSON.stringify({}), 'utf8');
            return {};
        }
        const data = fs.readFileSync(VEHICLES_FILE, 'utf8');
        return JSON.parse(data || '{}');
    } catch (err) {
        console.error("Error reading vehicles file:", err);
        return {};
    }
}

// Save registered vehicles to JSON file
function saveVehicles(vehicles) {
    try {
        fs.writeFileSync(VEHICLES_FILE, JSON.stringify(vehicles, null, 2), 'utf8');
    } catch (err) {
        console.error("Error writing to vehicles file:", err);
    }
}

// Initialize loaded vehicles store
let registeredVehicles = loadVehicles();


// --- REST API ENDPOINTS ---

// Admin Authentication Endpoint
app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;

    if (username === 'admin' && password === 'admin123') { // Replace with preferred admin credentials
        return res.json({ success: true, message: 'Authentication successful.' });
    }
    return res.status(401).json({ success: false, message: 'Invalid admin credentials.' });
});

// Admin Register Vehicle Endpoint
app.post('/api/admin/register-vehicle', (req, res) => {
    const { plate, pin } = req.body;

    if (!plate || !pin) {
        return res.status(400).json({ success: false, message: 'Plate number and PIN are required.' });
    }

    const formattedPlate = plate.trim().toUpperCase();
    const formattedPin = pin.trim();

    // Reload latest saved records from storage
    registeredVehicles = loadVehicles();

    // Save or update registration entry
    registeredVehicles[formattedPlate] = {
        pin: formattedPin,
        registeredAt: new Date().toISOString()
    };

    saveVehicles(registeredVehicles);

    console.log(`[REGISTERED]: Vehicle ${formattedPlate} saved to persistent storage.`);
    return res.json({ success: true, message: `Vehicle ${formattedPlate} registered successfully!` });
});

// Driver Verification Endpoint
app.post('/api/driver/verify', (req, res) => {
    const { plate, pin } = req.body;

    if (!plate || !pin) {
        return res.status(400).json({ success: false, message: 'Plate number and PIN are required.' });
    }

    const formattedPlate = plate.trim().toUpperCase();
    const formattedPin = pin.trim();

    // Reload latest records from storage
    registeredVehicles = loadVehicles();

    const vehicle = registeredVehicles[formattedPlate];

    if (!vehicle) {
        return res.status(404).json({ success: false, message: `Vehicle '${formattedPlate}' is not registered.` });
    }

    if (vehicle.pin !== formattedPin) {
        return res.status(401).json({ success: false, message: 'Incorrect driver access PIN.' });
    }

    return res.json({ success: true, message: 'Driver authenticated successfully.' });
});


// --- WEBSOCKET BROADCASTING LOGIC ---

// Helper function to broadcast active vehicles payload to all connected clients
function broadcastFleetData() {
    const fleetPayload = JSON.stringify({
        type: 'FLEET_UPDATE',
        vehicles: Array.from(activeVehicles.entries())
    });

    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(fleetPayload);
        }
    });
}

// Clean up inactive vehicles (e.g., if a driver drops signal for over 2 minutes without logging off)
setInterval(() => {
    const now = Date.now();
    let updated = false;

    for (const [plate, info] of activeVehicles.entries()) {
        if (now - info.timestamp > 120000) { // 2 minutes timeout
            activeVehicles.delete(plate);
            updated = true;
            console.log(`[TIMEOUT]: Vehicle ${plate} removed due to inactivity.`);
        }
    }

    if (updated) {
        broadcastFleetData();
    }
}, 30000);

// WebSocket Connection Connection Handling
wss.on('connection', (ws) => {
    // Send current active fleet immediately to newly connected client
    ws.send(JSON.stringify({
        type: 'FLEET_UPDATE',
        vehicles: Array.from(activeVehicles.entries())
    }));

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            // Handle Driver Live Location Stream
            if (data.type === 'DRIVER_TELEMETRY' && data.plate) {
                const formattedPlate = data.plate.trim().toUpperCase();

                activeVehicles.set(formattedPlate, {
                    lat: data.lat,
                    lng: data.lng,
                    speed: data.speed || 0,
                    timestamp: data.timestamp || Date.now()
                });

                broadcastFleetData();
            }

            // Handle Driver Manual Log Off / Offboarding Signal
            if (data.type === 'DRIVER_OFFLINE' && data.plate) {
                const formattedPlate = data.plate.trim().toUpperCase();
                
                if (activeVehicles.has(formattedPlate)) {
                    activeVehicles.delete(formattedPlate);
                    console.log(`[LOG OFF]: Vehicle ${formattedPlate} logged off.`);
                    broadcastFleetData();
                }
            }

        } catch (err) {
            console.error("Error processing WebSocket message:", err);
        }
    });
});


// --- START SERVER ---
server.listen(PORT, () => {
    console.log(`===================================================`);
    console.log(` City of Harare Fleet Control Server Running`);
    console.log(` Port: ${PORT}`);
    console.log(` Data Storage: ${VEHICLES_FILE}`);
    console.log(`===================================================`);
});
