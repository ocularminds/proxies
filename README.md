# proxies
# Low Enrgey Bluetooth QR Code Proximity Validator

The QR Code Proximity Validator is a solution designed to ensure secure and reliable proximity validation before allowing QR code scanning. The system uses **Bluetooth Low Energy (BLE)** to validate proximity and performs network checks to confirm the system being scanned into is on the same network as the mobile device.

---

## Features

- **Network Validation**: Ensures the system being scanned into is on the network.
- **Proximity Validation**:
  - Uses Bluetooth Low Energy (BLE) to measure proximity.
  - Includes fallback mechanisms such as Wi-Fi signal strength or GPS when BLE is unavailable.
- **QR Code Scanning**: Allows QR code scanning only after successful validation.
- **Error Reporting**: Provides appropriate error messages for failed validations.
- **GitHub Actions Integration**: Automated workflows for testing and deployment.

---

## Tech Stack

### Backend

- **Node.js**: Handles API endpoints and BLE communication.
- **Express.js**: Provides RESTful APIs for network and proximity validation.
- **Noble**: Manages BLE scanning and interactions.
- **Docker**: Containerizes the backend application for consistent deployment.

### Mobile App

- **Ionic Framework**: Builds a hybrid mobile application for Android and iOS.
- **Capacitor Plugins**:
  - **Bluetooth LE**: For BLE communication.
  - **QR Scanner**: For QR code scanning.
- **TypeScript**: Ensures robust and maintainable code.

### DevOps

- **GitHub Actions**: Automated workflows for running tests and deploying containers.
- **Docker Hub**: Stores Docker images for the backend and mobile apps.

---

## Project Structure

```
project-root/
├── backend/                 // Node.js backend for validation
│   ├── src/                // Source code for the backend
│   │   ├── index.js        // Entry point for the backend
│   │   ├── controllers/    // Contains controller logic
│   │   ├── services/       // Services for BLE and network validation
│   │   ├── middleware/     // Middleware logic (e.g., logging)
│   │   └── tests/          // Unit tests for backend
│   ├── package.json        // Dependencies for backend
│   ├── .env                // Environment variables
│   ├── .eslintrc.js        // Linter configuration
│   └── Dockerfile          // Docker setup for backend
├── mobile/                 // Ionic mobile app for QR code validation
│   ├── src/                // Ionic app source code
│   │   ├── app/            // Main Ionic app code
│   │   ├── environments/   // Environment configuration
│   │   └── tests/          // Unit and E2E tests
│   ├── package.json        // Dependencies for Ionic app
│   ├── capacitor.config.ts // Capacitor configuration
│   ├── ionic.config.json   // Ionic configuration
│   ├── .env                // Environment variables
│   ├── .eslintrc.js        // Linter configuration
│   └── Dockerfile          // Docker setup for mobile app
├── shared/                 // Shared assets or code
│   ├── constants.js        // Shared constants
│   ├── utils.js            // Shared utility functions
│   └── README.md           // Documentation for shared code
├── .github/                // GitHub Actions workflows
│   └── workflows/
│       ├── backend-tests.yml    // Workflow for backend tests
│       ├── mobile-tests.yml     // Workflow for mobile tests
│       └── deployment.yml       // Workflow for deployment
├── README.md               // Main project documentation
└── package.json            // Root-level dependencies and scripts
```

---

## Installation

### Prerequisites

- **Node.js** (v16 or later)
- **Docker**
- **Ionic CLI** (for mobile app development)

### Backend Setup

1. Navigate to the `backend/` directory:
   ```bash
   cd backend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the backend server:
   ```bash
   npm start
   ```

### Mobile App Setup

1. Navigate to the `mobile/` directory:
   ```bash
   cd mobile
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Build and run the app:
   ```bash
   ionic serve
   ```

---

## Deployment

### Docker Setup

1. Build the backend Docker image:
   ```bash
   docker build -t qr-code-validator-backend ./backend
   ```
2. Build the mobile app Docker image:
   ```bash
   docker build -t qr-code-validator-mobile ./mobile
   ```
3. Run the backend container:
   ```bash
   docker run -p 3000:3000 qr-code-validator-backend
   ```
4. Run the mobile container:
   ```bash
   docker run -p 8100:8100 qr-code-validator-mobile
   ```

### CI/CD with GitHub Actions

- **Backend Tests**: Automatically triggered on push/pull request to the `main` branch.
- **Mobile Tests**: Similar workflow for mobile app.
- **Deployment**: Builds and pushes Docker images to Docker Hub on every push to `main`.

---

## Testing

### Backend Tests

- Run unit tests for the backend using Jest:
  ```bash
  npm test
  ```

### Mobile Tests

- Run unit tests and end-to-end tests for the mobile app:
  ```bash
  npm test
  ```

---

## Contributing

1. Fork the repository.
2. Create a new feature branch:
   ```bash
   git checkout -b feature/your-feature
   ```
3. Commit your changes and open a pull request.

---

## License

This project is licensed under the MIT License. See `LICENSE` for more details.

---

## Contact

For questions or feedback, please reach out to [[your-email@example.com](mailto\:your-email@example.com)].


