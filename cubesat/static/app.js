
// =====================================================
// GLOBAL VARIABLES
// =====================================================
let targetPitch = 0;
let targetRoll = 0;
let targetYaw = 0;

let chartAltitude = null;
let chartEnv = null;
let map = null;
let marker = null;
let cubesat = null;
let renderer = null;
let camera3D = null;

// UTF-8 decoding.
function decodeUtf8(str) {
    try {
        return decodeURIComponent(escape(str));
    } catch (e) {
        return str;
    }
}

// =====================================================
// MAP INITIALIZATION
// =====================================================
if (typeof L !== "undefined") {
    map = L.map("map").setView([40.4093, 49.8671], 15);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap"
    }).addTo(map);

    marker = L.marker([40.4093, 49.8671]).addTo(map);
    setTimeout(() => { if (map) map.invalidateSize(); }, 500);
}

// =====================================================
// CHARTS INITIALIZATION
// =====================================================
if (typeof Chart !== "undefined") {
    Chart.defaults.color = "#777";
    Chart.defaults.font.family = "monospace";
    Chart.defaults.font.size = 10;

    // 1. Altitude and Speed chart.
    const canvasAlt = document.getElementById("telemetryChart");
    if (canvasAlt) {
        chartAltitude = new Chart(canvasAlt.getContext("2d"), {
            type: "line",
            data: {
                labels: [],
                datasets: [
                    { label: "Alt (m)", data: [], borderColor: "#007bff", borderWidth: 1.5, tension: 0.2, pointRadius: 0 },
                    { label: "Speed (m/s)", data: [], borderColor: "#dc3545", borderWidth: 1.5, tension: 0.2, pointRadius: 0 }
                ]
            },
            options: {
                animation: false,
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: true, position: 'top', labels: { boxWidth: 10, padding: 5 } }
                },
                scales: {
                    x: { grid: { display: false }, ticks: { maxRotation: 0 } },
                    y: { grid: { color: "#222" } }
                }
            }
        });
    }

    // 2. Pressure and Temperature chart.
    const canvasEnv = document.getElementById("envChart");
    if (canvasEnv) {
        chartEnv = new Chart(canvasEnv.getContext("2d"), {
            type: "line",
            data: {
                labels: [],
                datasets: [
                    { label: "Press (hPa)", data: [], borderColor: "#28a745", borderWidth: 1.5, yAxisID: 'y1', tension: 0.2, pointRadius: 0 },
                    { label: "Temp (°C)", data: [], borderColor: "#ffc107", borderWidth: 1.5, yAxisID: 'y2', tension: 0.2, pointRadius: 0 }
                ]
            },
            options: {
                animation: false,
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: true, position: 'top', labels: { boxWidth: 10, padding: 5 } }
                },
                scales: {
                    x: { grid: { display: false }, ticks: { maxRotation: 0 } },
                    y1: { type: 'linear', position: 'left', grid: { color: "#222" } },
                    y2: { type: 'linear', position: 'right', grid: { drawOnChartArea: false } }
                }
            }
        });
    }
}

// =====================================================
// THREE.JS (3D CUBESAT)
// =====================================================
function initCubeSat() {
    if (typeof THREE === "undefined") return;

    const container = document.getElementById("cube-container");
    if (!container) return;

    const width = container.clientWidth;
    const height = container.clientHeight;
    const scene = new THREE.Scene();

    scene.background = new THREE.Color(0x0c0d0f);

    camera3D = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    camera3D.position.set(0, 0, 6);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    container.appendChild(renderer.domElement);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(5, 5, 5);
    scene.add(directionalLight);

    const geometry = new THREE.BoxGeometry(1.6, 2.5, 1.6);
    const material = new THREE.MeshStandardMaterial({ color: 0x555555 });
    cubesat = new THREE.Mesh(geometry, material);
    scene.add(cubesat);

    const panelGeometry = new THREE.BoxGeometry(0.08, 2.2, 1.5);
    const panelMaterial = new THREE.MeshStandardMaterial({ color: 0x1b3d70 });

    const leftPanel = new THREE.Mesh(panelGeometry, panelMaterial);
    leftPanel.position.x = -0.85;
    cubesat.add(leftPanel);

    const rightPanel = new THREE.Mesh(panelGeometry, panelMaterial);
    rightPanel.position.x = 0.85;
    cubesat.add(rightPanel);

    const line = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color: 0xffffff }));
    cubesat.add(line);

    function animate() {
        requestAnimationFrame(animate);

        if (cubesat) {
            cubesat.rotation.x += (targetPitch * Math.PI / 180 - cubesat.rotation.x) * 0.1;
            cubesat.rotation.y += (targetYaw * Math.PI / 180 - cubesat.rotation.y) * 0.1;
            cubesat.rotation.z += (targetRoll * Math.PI / 180 - cubesat.rotation.z) * 0.1;
        }

        renderer.render(scene, camera3D);
    }

    animate();
}

// =====================================================
// UPDATE TELEMETRY
// =====================================================
async function updateTelemetry() {
    try {
        const response = await fetch("/api/data?" + Date.now());
        const data = await response.json();

        // Connection Status
        const connectionStatus = document.getElementById("connectionStatus");
        const portValue = document.getElementById("portValue");

        if (data.connected === true) {
            connectionStatus.innerText = "CONNECTED";
            connectionStatus.className = "status connected";
            portValue.innerText = "(" + data.port + ")";
        } else {
            connectionStatus.innerText = "DISCONNECTED";
            connectionStatus.className = "status disconnected";
            portValue.innerText = "(---)";
        }

        updateMissionTime(data.time);

        // Telemetry Data
        setText("altitude", Number(data.altitude).toFixed(1) + " m");
        setText("descentRate", Number(data.descent_rate).toFixed(1) + " m/s");
        setText("pressure", Number(data.pressure).toFixed(1) + " hPa");
        setText("temperature", Number(data.temp).toFixed(1) + " °C");
        setText("gpsAltitude", Number(data.gps_alt).toFixed(1) + " m");
        
        let displayVolt = Number(data.battery);
        if (displayVolt < 5.0 && displayVolt > 2.0) displayVolt *= 2.0;
        setText("battery", displayVolt.toFixed(2) + " V");

        // GPS Coordinates
        setText("latitude", Number(data.lat).toFixed(6));
        setText("longitude", Number(data.lng).toFixed(6));
        setText("mapAltitude", Number(data.gps_alt).toFixed(1) + " m");

        if (map && marker && Number(data.lat) !== 0 && Number(data.lng) !== 0) {
            const position = [Number(data.lat), Number(data.lng)];
            marker.setLatLng(position);
            map.panTo(position);
        }

        // Orientation
        targetPitch = data.pitch;
        targetRoll = data.roll;
        targetYaw = data.yaw;

        setText("pitch", Number(data.pitch).toFixed(1) + "°");
        setText("roll", Number(data.roll).toFixed(1) + "°");
        setText("yaw", Number(data.yaw).toFixed(1) + "°");

        // Sensor Data
        setText("accX", Number(data.accX).toFixed(2));
        setText("accY", Number(data.accY).toFixed(2));
        setText("accZ", Number(data.accZ).toFixed(2));
        setText("gyroX", Number(data.gyroX).toFixed(3));
        setText("gyroY", Number(data.gyroY).toFixed(3));
        setText("gyroZ", Number(data.gyroZ).toFixed(3));

        if (data.user_message) {
            setText("lastMessage", decodeUtf8(data.user_message));
        }

        updateErrors(data);
        updateCharts(data);

    } catch (error) {
        console.error("Telemetry Error:", error);
    }
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.innerText = value;
}

// UPDATE CHARTS
function updateCharts(data) {
    const timeLabel = data.time + "s";

    if (chartAltitude) {
        chartAltitude.data.labels.push(timeLabel);
        chartAltitude.data.datasets[0].data.push(data.altitude);
        chartAltitude.data.datasets[1].data.push(data.descent_rate);

        if (chartAltitude.data.labels.length > 20) {
            chartAltitude.data.labels.shift();
            chartAltitude.data.datasets[0].data.shift();
            chartAltitude.data.datasets[1].data.shift();
        }
        chartAltitude.update();
    }

    if (chartEnv) {
        chartEnv.data.labels.push(timeLabel);
        chartEnv.data.datasets[0].data.push(data.pressure);
        chartEnv.data.datasets[1].data.push(data.temp);

        if (chartEnv.data.labels.length > 20) {
            chartEnv.data.labels.shift();
            chartEnv.data.datasets[0].data.shift();
            chartEnv.data.datasets[1].data.shift();
        }
        chartEnv.update();
    }
}

// ERRORS CONTROL
function updateErrors(data) {
    const err01 = document.getElementById("err01");
    const err02 = document.getElementById("err02");
    const err03 = document.getElementById("err03");
    // const err04 = document.getElementById("err04");

    if (data.iss_err01 === "RED") setError(err01, "ERR_01: DESCENT RATE ERROR");
    else setOK(err01, "ERR_01: Descent Rate");

    if (data.iss_err02 === "RED") setError(err02, "ERR_02: NO GPS DATA!");
    else setOK(err02, "ERR_02: GPS Data");

    // if (data.iss_err03 === "WAITING (<200m)") setWaiting(err03, "ERR_03: Separation Confirmed (<200m)");
    // else setOK(err03, "ERR_03: Separation Confirmed");

    if (data.iss_err03 === "RED") setError(err03, "ERR_03: IoT DATA ERROR");
    else setOK(err03, "ERR_03: IoT Data Transmission");

    const errors = document.querySelectorAll(".error-item.error");
    const status = document.getElementById("systemStatus");

    if (status) {
        if (errors.length > 0) {
            status.innerText = "STATUS: [ ERROR FOUND! ]";
            status.className = "system-status error";
        } else {
            status.innerText = "STATUS: [ SYSTEM NOMINAL ]";
            status.className = "system-status";
        }
    }
}

function setError(element, text) {
    if (!element) return;
    element.innerText = "[ RED ] " + text;
    element.className = "error-item error";
}

function setOK(element, text) {
    if (!element) return;
    element.innerText = "[ OK ] " + text;
    element.className = "error-item ok";
}

function setWaiting(element, text) {
    if (!element) return;
    element.innerText = "[ WAIT ] " + text;
    element.className = "error-item ok";
}

function updateMissionTime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const sec = Math.floor(seconds % 60);

    setText(
        "missionTime",
        String(hours).padStart(2, "0") + ":" +
        String(minutes).padStart(2, "0") + ":" +
        String(sec).padStart(2, "0")
    );
}

// =====================================================
// EVENTS: CAMERA & SATELLITE MESSAGE TRANSMISSION
// =====================================================
document.addEventListener("DOMContentLoaded", function () {
    // 1. Camera Select
    const cameraSelect = document.getElementById("camera-select");
    const videoStream = document.getElementById("video-stream");

    if (cameraSelect) {
        cameraSelect.addEventListener("change", function () {
            let selectedIndex = cameraSelect.value;
            fetch("/api/select_camera", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ index: selectedIndex })
            })
            .then(res => res.json())
            .then(data => {
                if (videoStream) videoStream.src = "/video_feed?t=" + new Date().getTime();
            });
        });
    }

    // 2. Message transmission. (Enter +  TX Button)
    const satInput = document.getElementById("satMessageInput");
    const txBtn = document.getElementById("txBtn");
    const satStatus = document.getElementById("satMessageStatus");

    async function sendSatelliteMessage() {
        if (!satInput) return;
        const text = satInput.value.trim();
        if (!text) return;

        if (satStatus) {
            satStatus.innerText = "STATUS: SENDING...";
            satStatus.style.color = "#ffc107";
        }

        try {
            const response = await fetch("/api/send_message", {
                method: "POST",
                headers: { "Content-Type": "application/json; charset=utf-8" },
                body: JSON.stringify({ message: "CMD:MSG:" + text })
            });

            if (response.ok) {
                if (satStatus) {
                    satStatus.innerText = "STATUS: SENT OK";
                    satStatus.style.color = "#28a745";
                }
                satInput.value = ""; // Clear input field.
            } else {
                if (satStatus) {
                    satStatus.innerText = "STATUS: ERROR";
                    satStatus.style.color = "#dc3545";
                }
            }
        } catch (err) {
            console.error("Send Error:", err);
            if (satStatus) {
                satStatus.innerText = "STATUS: NETWORK ERR";
                satStatus.style.color = "#dc3545";
            }
        }

        setTimeout(() => {
            if (satStatus) {
                satStatus.innerText = "STATUS: READY";
                satStatus.style.color = "#888";
            }
        }, 2500);
    }

    if (txBtn) {
        txBtn.addEventListener("click", sendSatelliteMessage);
    }

    if (satInput) {
        satInput.addEventListener("keydown", function (event) {
            if (event.key === "Enter") {
                event.preventDefault();
                sendSatelliteMessage();
            }
        });
    }
});

// START
initCubeSat();
updateTelemetry();
setInterval(updateTelemetry, 1000);