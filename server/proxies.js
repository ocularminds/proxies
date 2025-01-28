const express = require('express');
const noble = require('noble');
const WebSocket = require('ws');
const axios = require('axios');

const app = express();
app.use(express.json());

const PORT = 1214;

// Simulate a database of allowed devices
const allowedDevices = ['BLE_DEVICE_UUID_1', 'BLE_DEVICE_UUID_2'];

// Step 1: Network validation
app.post('/validate-network', async (req, res) => {
  const { hostAddress } = req.body;

  try {
    const response = await axios.get(`http://${hostAddress}`);
    if (response.ok) {
      return res.status(200).json({ success: true, message: 'Host is reachable' });
    }
    throw new Error('Host unreachable');
  } catch (err) {
    return res.status(400).json({ success: false, message: 'Host is not on the network' });
  }
});

// Step 2: BLE proximity validation
app.post('/validate-proximity', (req, res) => {
  noble.startScanning([], true); // Scan for any BLE devices

  noble.on('discover', (peripheral) => {
    if (allowedDevices.includes(peripheral.uuid)) {
      noble.stopScanning();
      return res.status(200).json({ success: true, message: 'Device is within range' });
    }
  });

  setTimeout(() => {
    noble.stopScanning();
    return res.status(400).json({ success: false, message: 'No nearby BLE devices detected' });
  }, 5000); // Timeout for scanning
});

// Step 3: QR code permission
app.post('/validate', async (req, res) => {
  const { hostAddress } = req.body;

  // Step 1: Validate network
  const network = await axios.post('http://localhost:3000/validate-network', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hostAddress }),
  });

  if (!network.success) {
    return res.status(400).json({ success: false, message: networkResult.message });
  }

  // Step 2: Validate proximity
  const proximity = await axios.post('http://localhost:3000/validate-proximity', {
    method: 'POST',
  });
  if (!proximity.success) {
    return res.status(400).json({ success: false, message: proximityResult.message });
  }

  return res.status(200).json({ success: true, message: 'Validation successful. You may scan the QR code.' });
});

app.listen(PORT, () => console.log(`Proxies.Server listening on port ${PORT}`));
