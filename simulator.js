const https = require('https');

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

  const options = {
    hostname: 'harare-transit-tracker.onrender.com',
    path: '/api/v1/tracking/update',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    }
  };

  const req = https.request(options, (res) => {
    console.log(`[${vehicle.reg}] Status: ${res.statusCode}`);
    res.on('data', () => {});
  });

  req.on('error', (err) => {
    console.error(`❌ Error sending ${vehicle.reg}:`, err.message);
  });

  req.write(payload);
  req.end();
}

console.log('🚗 Harare Kombi GPS Simulator Running...');

// Run immediately once
VEHICLES.forEach(v => sendLocationUpdate(v));

// Run every 3 seconds
setInterval(() => {
  VEHICLES.forEach((v) => {
    if (v.speed > 0) {
      v.lat += (Math.random() - 0.48) * 0.0005;
      v.lng += (Math.random() - 0.48) * 0.0005;
    }
    sendLocationUpdate(v);
  });
}, 3000);
