# Energy Monitoring Dashboard

An elegant, software-driven energy monitoring ecosystem that visualizes real-time power consumption, predicts monthly utility costs, and promotes sustainable living through a high-fidelity, minimalistic dashboard.

## 🚀 Features

* **Real-Time Visualization**: Track active power consumption instantly.
* **Predictive Costing**: Forecast monthly utility expenses based on current usage.
* **Sustainability Insights**: Access actionable data to optimize energy habits.
* **Minimalist Interface**: Clean, modern dashboard built for maximum focus.

## 🛠️ Tech Stack

* **Frontend**: JavaScript, CSS, Tailwind CSS
* **Backend**: Java (Spring Boot)

## 📁 Repository Structure

```text
├── .gitignore
├── AlertState.java               # Energy alert status configurations
├── AlertStateRepository.java     # Repository layer for energy alerts
├── App.css                       # Global application styles
├── App.js                        # Main React core component
├── App.test.js                   # Application unit tests
├── EnergyEntry.java              # Data model for tracking energy logs
├── EnergyEntryRepository.java    # Repository layer for log management
├── EnergyLogApplication.java     # Main entry point for the backend service
├── index.css                     # Tailwind CSS entry styles
├── index.js                      # React application render anchor
├── reportWebVitals.js            # Core web vitals performance monitoring
├── setupTests.js                 # Testing environment configurations
└── tailwind.css                  # Tailwinds default build configuration
```

## ⚙️ Installation

### Prerequisites
* Java Development Kit (JDK 17 or higher)
* Node.js (v18 or higher) & npm

### Backend Setup
1. Compile and run the core backend service:
   ```bash
   ./mvnw spring-boot:run
   ```

### Frontend Setup
1. Install project dependencies:
   ```bash
   npm install
   ```
2. Launch the local development server:
   ```bash
   npm start
   ```
