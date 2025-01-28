const noble = require('noble');
const axios = require('axios');
const { getHostAddress } = require('./utils');

let pairedDevice = null;

function startBluetooth(mainWindow) {
  noble.on('stateChange', (state) => {
    if (state === 'poweredOn') {
      noble.startScanning([], true); // Start scanning for devices
    } else {
      noble.stopScanning();
    }
  });

  noble.on('discover', (peripheral) => {
    console.log('Discovered device:', peripheral.advertisement.localName);

    // Simulate pairing
    pairedDevice = peripheral;
    noble.stopScanning();

    // Send host address to the mobile app
    const hostAddress = getHostAddress();
    peripheral.connect((err) => {
      if (!err) {
        peripheral.write('host-address', Buffer.from(hostAddress), true, () => {
          console.log('Sent host address to mobile.');
        });
      }
    });

    // Handle data received from the mobile app
    peripheral.on('data', async (data) => {
      const mobileMetrics = JSON.parse(data.toString());
      console.log('Received metrics from mobile:', mobileMetrics);

      // Send metrics and QR code to the server
      try {
        const response = await axios.post('http://localhost:3000/validate-proximity', {
          ...mobileMetrics,
          hostAddress,
        });

        if (response.data.success) {
          console.log('Proximity validation successful');
          mainWindow.webContents.send('enable-qr-interface');
        } else {
          console.log('Proximity validation failed:', response.data.message);
          mainWindow.webContents.send('validation-failed', response.data.message);
        }
      } catch (error) {
        console.error('Error validating proximity:', error.message);
        mainWindow.webContents.send('validation-failed', 'Server validation failed.');
      }
    });
  });
}

module.exports = { startBluetooth };
