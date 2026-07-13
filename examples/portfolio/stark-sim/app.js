// Flight Variables
let thrustLevel = 0;  // Initial thrust
let pitch = 0, yaw = 0, roll = 0;  // Orientation (pitch, yaw, roll)
let speed = 0;  // Speed of the system
let inertia = 0;  // For momentum-based movement
let batteryStatus = 100;  // Battery percentage
let systemTemp = 20;  // Temperature in degrees Celsius
let coolingLevel = 1;  // Default cooling level

// Component Configurations
const componentConfigs = {
    edf: {
        "default-edf": { thrustMultiplier: 1, weight: 3, coolingEfficiency: 1 },
        "high-power-edf": { thrustMultiplier: 1.5, weight: 4, coolingEfficiency: 0.8 },
        "lightweight-edf": { thrustMultiplier: 0.8, weight: 2, coolingEfficiency: 1.2 }
    },
    battery: {
        "default-battery": { capacity: 100, weight: 5 },
        "high-capacity-battery": { capacity: 150, weight: 6 },
        "lightweight-battery": { capacity: 80, weight: 3 }
    }
};

// Variables for current component configuration
let currentEDF = componentConfigs.edf["default-edf"];
let currentBattery = componentConfigs.battery["default-battery"];

// Flight Mode and System State
let isForwardFlight = false;  // Flight mode (hover vs forward flight)
let isHoverStable = false;  // Hover stability mode
let isAIAssistEnabled = false;  // AI Pilot Assist mode
let edfFailure = false;  // Track EDF failure
let coolingFailure = false;  // Track cooling failure

// Scene Setup
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer();
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// Create EDF units and particle system for exhaust
let edfUnits = [];
function setupEDF() {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
    for (let i = 0; i < 4; i++) {
        let edf = new THREE.Mesh(geometry, material);
        edf.position.set(i - 2, 0, -5);  // Spread them out a bit
        scene.add(edf);
        edfUnits.push(edf);
    }
}

// Helper Functions
function applyDragAndLift() {
    // Apply drag and lift based on system velocity and thrust...
}

function applyThrustVectoring() {
    // Adjust the thrust direction based on pitch and roll...
}

function applyInertia() {
    inertia += thrustLevel * 0.02;
    scene.position.x += inertia * Math.sin(yaw);
    scene.position.z += inertia * Math.cos(yaw);
}

function applyThrust() {
    if (!edfFailure) {
        edfUnits.forEach(edf => {
            edf.rotation.y += 0.01 + (thrustLevel * currentEDF.thrustMultiplier * 0.001);
        });
        scene.position.x += thrustLevel * 0.1 * currentEDF.thrustMultiplier;
    } else {
        thrustLevel = 0;  // Disable thrust if EDF fails
    }
}

function applyCooling() {
    if (!coolingFailure) {
        systemTemp -= coolingLevel * currentEDF.coolingEfficiency * 0.05;
    } else {
        systemTemp += 0.5;  // Increase temp if cooling fails
    }
}

function checkForFailures() {
    if (systemTemp > 90 && !edfFailure) {
        edfFailure = true;
        alert("EDF units have overheated and failed!");
    }
    if (batteryStatus <= 5 && !coolingFailure) {
        coolingFailure = true;
        alert("Cooling system failure due to low battery!");
    }
}

function autoHover() {
    if (isHoverStable && !isForwardFlight) {
        if (Math.abs(pitch) > 0.05) pitch *= 0.95;
        if (Math.abs(roll) > 0.05) roll *= 0.95;
    }
}

function applyAIAssist() {
    if (isAIAssistEnabled) {
        if (Math.abs(pitch) > 0.5) pitch *= 0.9;
        if (Math.abs(roll) > 0.5) roll *= 0.9;
        if (Math.abs(yaw) > 0.5) yaw *= 0.9;
        if (speed > 50) inertia *= 0.9;
    }
}

function applyAIPowerOptimization() {
    if (isAIAssistEnabled) {
        if (batteryStatus < 20 && thrustLevel > 50) thrustLevel *= 0.9;
        if (systemTemp > 80) thrustLevel *= 0.8;
        if (systemTemp > 75) coolingLevel *= 1.2;
    }
}

// UI Interaction (Component Customization)
document.getElementById('edf-select').addEventListener('change', function () {
    currentEDF = componentConfigs.edf[this.value];
});

document.getElementById('battery-select').addEventListener('change', function () {
    currentBattery = componentConfigs.battery[this.value];
});

document.getElementById('apply-upgrade-button').addEventListener('click', function () {
    let selectedUpgrade = document.getElementById('upgrade-select').value;
    switch (selectedUpgrade) {
        case 'boost-thrust': currentEDF.thrustMultiplier *= 1.2; break;
        case 'increase-cooling': currentEDF.coolingEfficiency *= 1.2; break;
        case 'extend-battery': currentBattery.capacity *= 1.2; break;
    }
});

// UI Interaction (Flight Mode and Stability)
document.getElementById('flight-mode-button').addEventListener('click', function () {
    isForwardFlight = !isForwardFlight;
    this.textContent = isForwardFlight ? 'Switch to Hover Mode' : 'Switch to Forward Flight';
});

document.getElementById('hover-stability-button').addEventListener('click', function () {
    isHoverStable = !isHoverStable;
    this.textContent = isHoverStable ? 'Disable Hover Stability' : 'Enable Hover Stability';
});

document.getElementById('ai-assist-button').addEventListener('click', function () {
    isAIAssistEnabled = !isAIAssistEnabled;
    this.textContent = isAIAssistEnabled ? 'Disable AI Pilot Assist' : 'Enable AI Pilot Assist';
});

document.getElementById('repair-button').addEventListener('click', function () {
    edfFailure = false; coolingFailure = false;
    alert("System repaired!");
});

// Main Animation Loop
function animate() {
    requestAnimationFrame(animate);

    if (!edfFailure && !coolingFailure) {
        checkForFailures();
        applyDragAndLift();
        applyThrustVectoring();
        applyInertia();
        applyThrust();
        applyCooling();
        applyAIAssist();
        applyAIPowerOptimization();
        autoHover();
        // Update telemetry, exhaust, and other effects...
    }

    renderer.render(scene, camera);
}

// Start the Simulation
setupEDF();
animate();
