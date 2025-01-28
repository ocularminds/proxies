const express = require('express');
const axios = require('axios');
const geolib = require('geolib'); // For GPS distance calculations
const PORT = 1214;
const app = express();
// Simulate a database of allowed devices
const allowedDevices = ['BLE_DEVICE_UUID_1', 'BLE_DEVICE_UUID_2'];
app.use(express.json());

// Predefined thresholds
const MAX_BLUETOOTH_RSSI = -70; // Threshold RSSI for BLE
const MAX_WIFI_SIGNAL = -60;   // Threshold Wi-Fi signal strength
const MAX_DISTANCE_METERS = 50; // GPS proximity threshold

// Proximity Validation Endpoint

app.post('/', async (req, res) => {
  try {
      return res.status(200).json({ success: true, message: 'Low Energy Bluetooth QR Proximity Validator', status:'Ready.' });    
  } catch (err) {
    return res.status(400).json({ success: false, message: 'Host is not on the network' });
  }
});
app.post('/validate-proximity', async (req, res) => {
  const { qrData, bluetoothRssi, wifiSignalStrength, gpsCoordinates, hostAddress } = req.body;

  // Step 1: Check if the host is on the network
  try {
    const networkResponse = await axios.get(`http://${hostAddress}`);
    if (networkResponse.status !== 200) {
      return res.status(400).json({ success: false, message: 'Host machine is not on the network.' });
    }
  } catch (err) {
    return res.status(400).json({ success: false, message: 'Failed to connect to the host machine.' });
  }

  // Step 2: Validate proximity
  if (bluetoothRssi && bluetoothRssi < MAX_BLUETOOTH_RSSI) {
    return res.status(400).json({ success: false, message: 'Device is out of Bluetooth range.' });
  }

  if (wifiSignalStrength && wifiSignalStrength < MAX_WIFI_SIGNAL) {
    return res.status(400).json({ success: false, message: 'Device is out of Wi-Fi range.' });
  }

  if (gpsCoordinates) {
    const hostLocation = { latitude: 12.34567, longitude: 76.54321 }; // Example host coordinates
    const distance = geolib.getDistance(gpsCoordinates, hostLocation);

    if (distance > MAX_DISTANCE_METERS) {
      return res.status(400).json({ success: false, message: 'Device is out of GPS range.' });
    }
  }

  // Step 3: Proximity validation successful
  return res.status(200).json({ success: true, message: 'Proximity validation successful.' });
});

app.listen(PORT, () => console.log('Low Energy Bluetooth QR Proximity Validator running on port 1412'));
