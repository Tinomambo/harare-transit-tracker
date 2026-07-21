// 1. Change 'http' to 'https' for Render deployment
const https = require('https');

// Simulating three kombis in Harare CBD:
// 1. Registered Kombi driving on roads
// 2. Registered Kombi parked at Copacabana Rank
// 3. Unregistered/Illegal Kombi (Mushikashika)
const VEHICLES = [
  { reg: 'AEB-9021', isRegistered: true, lat: -17.8285, lng: 31.0500, speed: 45 },
  { reg: 'ACZ-4412', isRegistered: true, lat: -17.8317, lng: 31.0428, speed: 0 },
  { reg: 'UNKNOWN-1', isRegistered: false, lat: -17.8330, lng: 31.0480, speed: 20 }
];

function sendLocationUpdate(vehicle) {
  const payload = JSON.stringify({
    registration_number: vehicle.reg,
    latitude: vehicle.lat,
    longitude: vehicle.lng,
    speed: vehicle.speed
  });

  // 2. Point options to your live Render backend URL
  const options = {
    hostname: 'harare-transit-tracker.onrender.com',
    path: '/api/v1/tracking/update',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    }
  };

  // 3. Use https.request instead of http.request
  const req = https.request(options, (res) => {
    res.on('data', () => {});
  });

  req.on('error', (err) => {
    console.error(`Error sending update for ${vehicle.reg}:`, err.message);
  });

  req.write(payload);
  req.end();
}

console.log('🚗 Harare Kombi GPS Simulator Running...');

setInterval(() => {
  VEHICLES.forEach((v) => {
    // Move moving vehicles slightly
    if (v.speed > 0) {
      v.lat += (Math.random() - 0.48) * 0.0005;
      v.lng += (Math.random() - 0.48) * 0.0005;
    }
    sendLocationUpdate(v);
  });
}, 3000);
