// Hexapod Patrol Control - JavaScript
// =====================================

// ========== State Management ==========
const state = {
  connected: false,
  ws: null,

  // Map state
  map: null,
  hexapodMarker: null,
  homeMarker: null,
  drawnItems: null,
  currentDrawType: null,
  satelliteView: false,
  currentDrawHandler: null,
  firstVertexMarker: null,

  // Position tracking
  hexapodPosition: { lat: 37.7749, lng: -122.4194 }, // Default: San Francisco (will be updated)
  hexapodHeading: 0,
  homePosition: null,

  // Patrol state
  patrolStatus: 'stopped', // 'stopped', 'running', 'paused'
  activeRoute: null,
  patrolStartTime: null,
  patrolDistance: 0,
  patrolLaps: 0,
  patrolDetections: 0,
  currentWaypointIndex: 0,

  // Routes and zones
  routes: [],
  selectedRoute: null,
  editingRoute: null,

  // Detections
  detections: [],
  detectionMarkers: [],
  detectionCounts: {
    snail: 0,
    person: 0,
    animal: 0,
    vehicle: 0,
    package: 0,
    custom: 0
  },

  // Settings
  settings: {
    detectionTargets: ['snail'],
    detectionSensitivity: 70,
    patrolSpeed: 50,
    patrolMode: 'loop',
    zonePattern: 'lawnmower',
    waypointPause: 2,
    autoReturnHome: true,
    lowBatteryReturn: 20,
    alerts: {
      sound: true,
      notification: true,
      email: false,
      photo: true,
      pause: false,
      cooldown: 30
    },
    schedule: {
      enabled: false,
      days: [0, 1, 2, 3, 4, 5, 6],
      startTime: '06:00',
      endTime: '20:00',
      interval: 60
    }
  }
};

// Storage keys
const STORAGE_KEYS = {
  routes: 'hexapod_patrol_routes',
  settings: 'hexapod_patrol_settings',
  homePosition: 'hexapod_home_position',
  detections: 'hexapod_detections'
};

// ========== Initialization ==========
document.addEventListener('DOMContentLoaded', () => {
  loadFromStorage();
  initMap();
  initEventListeners();
  connectWebSocket();
  requestNotificationPermission();
  updateUI();
});

function loadFromStorage() {
  try {
    const routes = localStorage.getItem(STORAGE_KEYS.routes);
    const settings = localStorage.getItem(STORAGE_KEYS.settings);
    const homePosition = localStorage.getItem(STORAGE_KEYS.homePosition);
    const detections = localStorage.getItem(STORAGE_KEYS.detections);

    if (routes) state.routes = JSON.parse(routes);
    if (settings) state.settings = { ...state.settings, ...JSON.parse(settings) };
    if (homePosition) state.homePosition = JSON.parse(homePosition);
    if (detections) {
      const parsed = JSON.parse(detections);
      state.detections = parsed.detections || [];
      state.detectionCounts = parsed.counts || state.detectionCounts;
    }
  } catch (e) {
    console.error('Failed to load from storage:', e);
  }
}

function saveToStorage() {
  try {
    localStorage.setItem(STORAGE_KEYS.routes, JSON.stringify(state.routes));
    localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(state.settings));
    if (state.homePosition) {
      localStorage.setItem(STORAGE_KEYS.homePosition, JSON.stringify(state.homePosition));
    }
    localStorage.setItem(STORAGE_KEYS.detections, JSON.stringify({
      detections: state.detections.slice(-100), // Keep last 100
      counts: state.detectionCounts
    }));
  } catch (e) {
    console.error('Failed to save to storage:', e);
  }
}

// ========== Map Initialization ==========
function initMap() {
  // Create map centered on default position
  state.map = L.map('map', {
    center: [state.hexapodPosition.lat, state.hexapodPosition.lng],
    zoom: 18,
    zoomControl: true
  });

  // Base layers
  const streetLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
  });

  const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: '&copy; Esri'
  });

  // Add default layer
  streetLayer.addTo(state.map);
  state.streetLayer = streetLayer;
  state.satelliteLayer = satelliteLayer;

  // Initialize draw layer
  state.drawnItems = new L.FeatureGroup();
  state.map.addLayer(state.drawnItems);

  // Initialize draw control
  const drawControl = new L.Control.Draw({
    position: 'topright',
    draw: {
      polyline: {
        shapeOptions: {
          color: '#4fc3f7',
          weight: 4
        }
      },
      polygon: {
        allowIntersection: false,
        showArea: true,
        shapeOptions: {
          color: '#4caf50',
          fillColor: '#4caf50',
          fillOpacity: 0.2
        }
      },
      rectangle: {
        shapeOptions: {
          color: '#ff9800',
          fillColor: '#ff9800',
          fillOpacity: 0.2
        }
      },
      circle: false,
      marker: false,
      circlemarker: false
    },
    edit: {
      featureGroup: state.drawnItems,
      remove: true
    }
  });
  state.map.addControl(drawControl);

  // Track when drawing starts (for toolbar usage)
  state.map.on(L.Draw.Event.DRAWSTART, (e) => {
    // Disable double-click zoom during any drawing
    state.map.doubleClickZoom.disable();

    // Set currentDrawType based on what's being drawn
    if (e.layerType === 'polygon' || e.layerType === 'rectangle') {
      if (!state.currentDrawType) state.currentDrawType = 'zone';
    } else if (e.layerType === 'polyline') {
      if (!state.currentDrawType) state.currentDrawType = 'route';
    }
  });

  // Track first vertex for visual highlighting
  state.map.on(L.Draw.Event.DRAWVERTEX, (e) => {
    // Only create first vertex marker for zone drawing, and only once
    if (state.currentDrawType !== 'zone') return;
    if (state.firstVertexMarker) return; // Already created

    const layers = e.layers;
    let firstVertex = null;
    layers.eachLayer(layer => {
      if (!firstVertex) firstVertex = layer;
    });

    if (!firstVertex) return;

    const latlng = firstVertex.getLatLng();

    // Create pulsing first vertex marker
    const firstVertexIcon = L.divIcon({
      className: 'first-vertex-marker',
      html: '<div class="first-vertex-pulse"></div><div class="first-vertex-inner">1</div>',
      iconSize: [30, 30],
      iconAnchor: [15, 15]
    });

    state.firstVertexMarker = L.marker(latlng, {
      icon: firstVertexIcon,
      interactive: true,
      zIndexOffset: 1000
    }).addTo(state.map);

    // Click on first vertex to complete polygon
    state.firstVertexMarker.on('click', (evt) => {
      L.DomEvent.stopPropagation(evt);
      if (state.currentDrawHandler && state.currentDrawHandler._markers && state.currentDrawHandler._markers.length >= 3) {
        state.currentDrawHandler.completeShape();
      } else {
        addLog('Need at least 3 points to complete zone');
      }
    });

    addLog('First point placed - continue adding points, then click the red "1" to close');
  });

  // Clean up first vertex marker when drawing stops
  state.map.on(L.Draw.Event.DRAWSTOP, () => {
    if (state.firstVertexMarker) {
      state.map.removeLayer(state.firstVertexMarker);
      state.firstVertexMarker = null;
    }
    state.currentDrawHandler = null;
    state.currentDrawType = null;
    // Re-enable double-click zoom
    state.map.doubleClickZoom.enable();
  });

  state.map.on(L.Draw.Event.CREATED, () => {
    if (state.firstVertexMarker) {
      state.map.removeLayer(state.firstVertexMarker);
      state.firstVertexMarker = null;
    }
    state.currentDrawHandler = null;
    // Re-enable double-click zoom
    state.map.doubleClickZoom.enable();
  });

  // Draw events
  state.map.on(L.Draw.Event.CREATED, (e) => {
    const layer = e.layer;

    if (state.editingRoute) {
      // Update existing route
      state.editingRoute.layer = layer;
      state.editingRoute.coordinates = getLayerCoordinates(layer);
      state.editingRoute.type = e.layerType;
      state.drawnItems.addLayer(layer);
      updateRouteOnMap(state.editingRoute);
      saveRoutes();
    } else if (state.currentDrawType) {
      // New route being created
      const route = {
        id: 'route_' + Date.now(),
        name: document.getElementById('routeName').value || 'New Route',
        description: document.getElementById('routeDescription').value || '',
        color: getSelectedColor(),
        priority: document.getElementById('routePriority').value,
        type: e.layerType,
        coordinates: getLayerCoordinates(layer),
        layer: layer,
        createdAt: new Date().toISOString()
      };

      state.routes.push(route);
      state.drawnItems.addLayer(layer);
      updateRouteOnMap(route);
      saveRoutes();
      renderRoutesList();
      closeRouteModal();
    }

    state.currentDrawType = null;
    state.editingRoute = null;
  });

  state.map.on(L.Draw.Event.EDITED, (e) => {
    const layers = e.layers;
    layers.eachLayer((layer) => {
      const route = state.routes.find(r => r.layer === layer);
      if (route) {
        route.coordinates = getLayerCoordinates(layer);
        saveRoutes();
      }
    });
  });

  state.map.on(L.Draw.Event.DELETED, (e) => {
    const layers = e.layers;
    layers.eachLayer((layer) => {
      const routeIndex = state.routes.findIndex(r => r.layer === layer);
      if (routeIndex >= 0) {
        state.routes.splice(routeIndex, 1);
        saveRoutes();
        renderRoutesList();
      }
    });
  });

  // Create hexapod marker
  createHexapodMarker();

  // Load existing routes onto map
  loadRoutesOntoMap();

  // Create home marker if set
  if (state.homePosition) {
    createHomeMarker(state.homePosition);
  }
}

function createHexapodMarker() {
  const hexapodIcon = L.divIcon({
    className: 'hexapod-marker',
    html: `
      <div class="hexapod-marker-direction" style="transform: rotate(${state.hexapodHeading}deg);"></div>
      <div class="hexapod-marker-body"></div>
    `,
    iconSize: [40, 40],
    iconAnchor: [20, 20]
  });

  state.hexapodMarker = L.marker([state.hexapodPosition.lat, state.hexapodPosition.lng], {
    icon: hexapodIcon,
    zIndexOffset: 1000
  }).addTo(state.map);

  state.hexapodMarker.bindPopup('<strong>Hexapod</strong><br>Click to center view');
  state.hexapodMarker.on('click', () => centerOnHexapod());
}

function createHomeMarker(position) {
  if (state.homeMarker) {
    state.map.removeLayer(state.homeMarker);
  }

  const homeIcon = L.divIcon({
    className: 'home-marker',
    html: '🏠',
    iconSize: [24, 24],
    iconAnchor: [12, 12]
  });

  state.homeMarker = L.marker([position.lat, position.lng], {
    icon: homeIcon
  }).addTo(state.map);

  state.homeMarker.bindPopup('<strong>Home Position</strong>');
}

function getLayerCoordinates(layer) {
  if (layer instanceof L.Polygon || layer instanceof L.Rectangle) {
    return layer.getLatLngs()[0].map(ll => [ll.lat, ll.lng]);
  } else if (layer instanceof L.Polyline) {
    return layer.getLatLngs().map(ll => [ll.lat, ll.lng]);
  }
  return [];
}

function loadRoutesOntoMap() {
  state.routes.forEach(route => {
    let layer;

    if (route.type === 'polygon' || route.type === 'rectangle') {
      layer = L.polygon(route.coordinates, {
        color: route.color,
        fillColor: route.color,
        fillOpacity: 0.2,
        weight: 3
      });
    } else {
      layer = L.polyline(route.coordinates, {
        color: route.color,
        weight: 4
      });
    }

    route.layer = layer;
    state.drawnItems.addLayer(layer);

    // Add waypoint markers for routes
    if (route.type === 'polyline') {
      route.coordinates.forEach((coord, idx) => {
        const waypointIcon = L.divIcon({
          className: 'waypoint-marker',
          html: `<div style="background: ${route.color}; width: 20px; height: 20px; border-radius: 50%; border: 2px solid #fff; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: bold; color: #fff;">${idx + 1}</div>`,
          iconSize: [20, 20],
          iconAnchor: [10, 10]
        });

        L.marker(coord, { icon: waypointIcon }).addTo(state.drawnItems);
      });
    }

    layer.on('click', () => selectRoute(route.id));
  });

  renderRoutesList();
}

function updateRouteOnMap(route) {
  if (route.layer) {
    route.layer.setStyle({
      color: route.color,
      fillColor: route.color
    });

    route.layer.bindPopup(`<strong>${route.name}</strong><br>${route.description || 'No description'}`);
  }
}

function saveRoutes() {
  // Save routes without the layer reference (non-serializable)
  const routesForStorage = state.routes.map(r => ({
    ...r,
    layer: undefined
  }));
  localStorage.setItem(STORAGE_KEYS.routes, JSON.stringify(routesForStorage));
}

// ========== Event Listeners ==========
function initEventListeners() {
  // Sensitivity slider
  const sensitivitySlider = document.getElementById('detectionSensitivity');
  sensitivitySlider.addEventListener('input', (e) => {
    state.settings.detectionSensitivity = parseInt(e.target.value);
    document.getElementById('sensitivityValue').textContent = e.target.value + '%';
    saveToStorage();
  });

  // Speed slider
  const speedSlider = document.getElementById('patrolSpeed');
  speedSlider.addEventListener('input', (e) => {
    state.settings.patrolSpeed = parseInt(e.target.value);
    document.getElementById('speedValue').textContent = e.target.value + '%';
    saveToStorage();
  });

  // Patrol mode
  document.getElementById('patrolMode').addEventListener('change', (e) => {
    state.settings.patrolMode = e.target.value;
    saveToStorage();
  });

  // Zone pattern
  document.getElementById('zonePattern').addEventListener('change', (e) => {
    state.settings.zonePattern = e.target.value;
    saveToStorage();
  });

  // Waypoint pause
  document.getElementById('waypointPause').addEventListener('change', (e) => {
    state.settings.waypointPause = parseInt(e.target.value);
    saveToStorage();
  });

  // Auto return home
  document.getElementById('autoReturnHome').addEventListener('change', (e) => {
    state.settings.autoReturnHome = e.target.checked;
    saveToStorage();
  });

  // Low battery return
  document.getElementById('lowBatteryReturn').addEventListener('change', (e) => {
    state.settings.lowBatteryReturn = parseInt(e.target.value);
    saveToStorage();
  });

  // Alert toggles
  ['alertSound', 'alertNotification', 'alertEmail', 'alertPhoto', 'alertPause'].forEach(id => {
    document.getElementById(id).addEventListener('change', (e) => {
      const key = id.replace('alert', '').toLowerCase();
      state.settings.alerts[key] = e.target.checked;
      saveToStorage();
    });
  });

  // Alert cooldown
  document.getElementById('alertCooldown').addEventListener('change', (e) => {
    state.settings.alerts.cooldown = parseInt(e.target.value);
    saveToStorage();
  });

  // Schedule enabled
  document.getElementById('scheduleEnabled').addEventListener('change', (e) => {
    state.settings.schedule.enabled = e.target.checked;
    document.getElementById('scheduleSettings').style.opacity = e.target.checked ? '1' : '0.5';
    document.getElementById('scheduleSettings').style.pointerEvents = e.target.checked ? 'auto' : 'none';
    saveToStorage();
  });

  // Schedule days
  document.querySelectorAll('.schedule-day').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.classList.toggle('active');
      const day = parseInt(btn.dataset.day);
      const idx = state.settings.schedule.days.indexOf(day);
      if (idx >= 0) {
        state.settings.schedule.days.splice(idx, 1);
      } else {
        state.settings.schedule.days.push(day);
        state.settings.schedule.days.sort();
      }
      saveToStorage();
    });
  });

  // Schedule times
  document.getElementById('scheduleStart').addEventListener('change', (e) => {
    state.settings.schedule.startTime = e.target.value;
    saveToStorage();
  });

  document.getElementById('scheduleEnd').addEventListener('change', (e) => {
    state.settings.schedule.endTime = e.target.value;
    saveToStorage();
  });

  document.getElementById('scheduleInterval').addEventListener('change', (e) => {
    state.settings.schedule.interval = parseInt(e.target.value);
    saveToStorage();
  });

  // Color options
  document.querySelectorAll('.color-option').forEach(opt => {
    opt.addEventListener('click', () => {
      document.querySelectorAll('.color-option').forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
    });
  });
}

// ========== WebSocket Connection ==========
function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws`;

  state.ws = new WebSocket(wsUrl);

  state.ws.onopen = () => {
    console.log('WebSocket connected');
    state.connected = true;
    updateConnectionStatus(true);

    // Request initial position
    sendCommand('get_position');
  };

  state.ws.onclose = () => {
    console.log('WebSocket disconnected');
    state.connected = false;
    updateConnectionStatus(false);

    // Reconnect after delay
    setTimeout(connectWebSocket, 3000);
  };

  state.ws.onerror = (error) => {
    console.error('WebSocket error:', error);
  };

  state.ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleMessage(data);
    } catch (e) {
      console.error('Failed to parse message:', e);
    }
  };
}

function sendCommand(type, data = {}) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify({ type, ...data }));
  }
}

function handleMessage(data) {
  switch (data.type) {
    case 'telemetry':
      updateTelemetry(data);
      break;
    case 'position':
      updatePosition(data);
      break;
    case 'detection':
      handleDetection(data);
      break;
    case 'patrol_status':
      updatePatrolStatus(data);
      break;
    case 'waypoint_reached':
      handleWaypointReached(data);
      break;
    case 'patrol_complete':
      handlePatrolComplete(data);
      break;
  }
}

function updateTelemetry(data) {
  // Update battery display
  if (data.battery !== undefined) {
    const batteryPercent = Math.round((data.battery - 9.5) / (12.5 - 9.5) * 100);
    document.getElementById('hexapodBattery').textContent = batteryPercent + '%';

    // Check low battery
    if (batteryPercent <= state.settings.lowBatteryReturn && state.patrolStatus === 'running') {
      if (state.settings.autoReturnHome) {
        addLog('Low battery detected, returning home...');
        goHome();
      }
    }
  }

  // Update heading
  if (data.heading !== undefined) {
    state.hexapodHeading = data.heading;
    document.getElementById('hexapodHeading').textContent = Math.round(data.heading) + '°';
    document.getElementById('headingArrow').style.transform = `rotate(${data.heading}deg)`;

    // Update marker
    if (state.hexapodMarker) {
      const icon = state.hexapodMarker.getIcon();
      const el = document.querySelector('.hexapod-marker-direction');
      if (el) {
        el.style.transform = `rotate(${data.heading}deg)`;
      }
    }
  }
}

function updatePosition(data) {
  if (data.lat !== undefined && data.lng !== undefined) {
    state.hexapodPosition = { lat: data.lat, lng: data.lng };

    // Update marker position
    if (state.hexapodMarker) {
      state.hexapodMarker.setLatLng([data.lat, data.lng]);
    }

    // Update display
    document.getElementById('hexapodCoords').textContent =
      `${data.lat.toFixed(6)}, ${data.lng.toFixed(6)}`;

    // Update patrol distance if running
    if (state.patrolStatus === 'running' && state.lastPosition) {
      const distance = calculateDistance(state.lastPosition, state.hexapodPosition);
      state.patrolDistance += distance;
      document.getElementById('patrolDistance').textContent = formatDistance(state.patrolDistance);
    }
    state.lastPosition = { ...state.hexapodPosition };
  }
}

function handleDetection(data) {
  const detection = {
    id: 'det_' + Date.now(),
    type: data.target || 'unknown',
    confidence: data.confidence || 0,
    lat: data.lat || state.hexapodPosition.lat,
    lng: data.lng || state.hexapodPosition.lng,
    timestamp: new Date().toISOString(),
    imageUrl: data.imageUrl || null
  };

  // Add to detections
  state.detections.unshift(detection);
  state.detectionCounts[detection.type] = (state.detectionCounts[detection.type] || 0) + 1;
  state.patrolDetections++;

  // Update UI
  document.getElementById('patrolDetections').textContent = state.patrolDetections;
  updateDetectionCounts();
  renderDetectionLog();

  // Add marker on map
  addDetectionMarker(detection);

  // Trigger alerts
  triggerAlerts(detection);

  // Pause if configured
  if (state.settings.alerts.pause && state.patrolStatus === 'running') {
    pausePatrol();
    addLog(`Paused patrol: ${detection.type} detected!`);
  }

  saveToStorage();
}

function addDetectionMarker(detection) {
  const icons = {
    snail: '🐌',
    person: '🚶',
    animal: '🐕',
    vehicle: '🚗',
    package: '📦',
    custom: '⚠️'
  };

  const icon = L.divIcon({
    className: 'detection-marker',
    html: icons[detection.type] || '❓',
    iconSize: [24, 24],
    iconAnchor: [12, 12]
  });

  const marker = L.marker([detection.lat, detection.lng], { icon }).addTo(state.map);
  marker.bindPopup(`
    <strong>${detection.type.charAt(0).toUpperCase() + detection.type.slice(1)} Detected</strong><br>
    Confidence: ${Math.round(detection.confidence * 100)}%<br>
    Time: ${new Date(detection.timestamp).toLocaleTimeString()}
  `);

  state.detectionMarkers.push(marker);
}

function triggerAlerts(detection) {
  // Sound alert
  if (state.settings.alerts.sound) {
    playAlertSound();
  }

  // Browser notification
  if (state.settings.alerts.notification) {
    showNotification(detection);
  }

  // Log
  addLog(`Detection: ${detection.type} (${Math.round(detection.confidence * 100)}% confidence)`);
}

function playAlertSound() {
  // Create a simple beep
  try {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    oscillator.frequency.value = 880;
    oscillator.type = 'sine';
    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);

    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.5);
  } catch (e) {
    console.log('Could not play alert sound:', e);
  }
}

function showNotification(detection) {
  if (Notification.permission === 'granted') {
    const icons = {
      snail: '🐌',
      person: '🚶',
      animal: '🐕',
      vehicle: '🚗',
      package: '📦'
    };

    new Notification('Hexapod Detection Alert', {
      body: `${icons[detection.type] || '⚠️'} ${detection.type.charAt(0).toUpperCase() + detection.type.slice(1)} detected!`,
      icon: '/favicon.svg',
      tag: 'hexapod-detection'
    });
  }
}

function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

// ========== Patrol Control ==========
function startPatrol() {
  if (!state.selectedRoute && state.routes.length > 0) {
    state.selectedRoute = state.routes[0].id;
  }

  if (!state.selectedRoute) {
    alert('Please create a patrol route first!');
    return;
  }

  const route = state.routes.find(r => r.id === state.selectedRoute);
  if (!route) {
    alert('Selected route not found!');
    return;
  }

  // Send patrol start command
  sendCommand('patrol_start', {
    route_id: route.id,
    coordinates: route.coordinates,
    type: route.type,
    mode: state.settings.patrolMode,
    pattern: state.settings.zonePattern,
    speed: state.settings.patrolSpeed,
    waypoint_pause: state.settings.waypointPause,
    detection_targets: state.settings.detectionTargets,
    detection_sensitivity: state.settings.detectionSensitivity
  });

  state.patrolStatus = 'running';
  state.activeRoute = route.id;
  state.patrolStartTime = Date.now();
  state.patrolDistance = 0;
  state.patrolDetections = 0;
  state.currentWaypointIndex = 0;

  updatePatrolUI();
  addLog(`Started patrol: ${route.name}`);
}

function pausePatrol() {
  sendCommand('patrol_pause');
  state.patrolStatus = 'paused';
  updatePatrolUI();
  addLog('Patrol paused');
}

function resumePatrol() {
  sendCommand('patrol_resume');
  state.patrolStatus = 'running';
  updatePatrolUI();
  addLog('Patrol resumed');
}

function stopPatrol() {
  sendCommand('patrol_stop');
  state.patrolStatus = 'stopped';
  state.activeRoute = null;
  updatePatrolUI();
  addLog('Patrol stopped');
}

function goHome() {
  if (!state.homePosition) {
    alert('Home position not set! Click the home button on the map to set it.');
    return;
  }

  sendCommand('go_to_position', {
    lat: state.homePosition.lat,
    lng: state.homePosition.lng
  });

  addLog('Returning to home position...');
}

function emergencyStop() {
  sendCommand('emergency_stop');
  state.patrolStatus = 'stopped';
  state.activeRoute = null;
  updatePatrolUI();
  addLog('EMERGENCY STOP activated!');
}

function handleWaypointReached(data) {
  state.currentWaypointIndex = data.waypoint_index;
  addLog(`Waypoint ${data.waypoint_index + 1} reached`);
}

function handlePatrolComplete(data) {
  state.patrolLaps++;
  document.getElementById('patrolLaps').textContent = state.patrolLaps;

  if (state.settings.patrolMode === 'once') {
    stopPatrol();
    addLog('Patrol completed');

    if (state.settings.autoReturnHome) {
      goHome();
    }
  } else {
    addLog(`Lap ${state.patrolLaps} completed`);
  }
}

function updatePatrolUI() {
  const statusEl = document.getElementById('patrolStatus');
  const statusTextEl = document.getElementById('patrolStatusText');
  const routeNameEl = document.getElementById('patrolRouteName');

  // Update status panel
  statusEl.className = 'patrol-status ' + state.patrolStatus;

  if (state.patrolStatus === 'running') {
    statusTextEl.textContent = 'Patrolling';
  } else if (state.patrolStatus === 'paused') {
    statusTextEl.textContent = 'Paused';
  } else {
    statusTextEl.textContent = 'Stopped';
  }

  // Update route name
  if (state.activeRoute) {
    const route = state.routes.find(r => r.id === state.activeRoute);
    routeNameEl.textContent = route ? route.name : 'Unknown route';
  } else {
    routeNameEl.textContent = 'No route selected';
  }

  // Update buttons
  const btnStart = document.getElementById('btnStartPatrol');
  const btnPause = document.getElementById('btnPausePatrol');
  const btnStop = document.getElementById('btnStopPatrol');
  const quickStart = document.getElementById('quickStart');
  const quickPause = document.getElementById('quickPause');
  const quickStop = document.getElementById('quickStop');

  if (state.patrolStatus === 'running') {
    btnStart.style.display = 'none';
    btnPause.style.display = 'inline-flex';
    btnStop.style.display = 'inline-flex';
    quickStart.style.display = 'none';
    quickPause.style.display = 'flex';
    quickStop.style.display = 'flex';
  } else if (state.patrolStatus === 'paused') {
    btnStart.textContent = '▶ Resume';
    btnStart.style.display = 'inline-flex';
    btnStart.onclick = resumePatrol;
    btnPause.style.display = 'none';
    btnStop.style.display = 'inline-flex';
    quickStart.querySelector('.label').textContent = 'Resume';
    quickStart.style.display = 'flex';
    quickStart.onclick = resumePatrol;
    quickPause.style.display = 'none';
    quickStop.style.display = 'flex';
  } else {
    btnStart.textContent = '▶ Start Patrol';
    btnStart.style.display = 'inline-flex';
    btnStart.onclick = startPatrol;
    btnPause.style.display = 'none';
    btnStop.style.display = 'none';
    quickStart.querySelector('.label').textContent = 'Start';
    quickStart.style.display = 'flex';
    quickStart.onclick = startPatrol;
    quickPause.style.display = 'none';
    quickStop.style.display = 'none';
  }

  // Highlight active route in list
  document.querySelectorAll('.route-item').forEach(item => {
    item.classList.remove('active');
    if (item.dataset.id === state.activeRoute) {
      item.classList.add('active');
    }
  });
}

// Update patrol time display
setInterval(() => {
  if (state.patrolStatus === 'running' && state.patrolStartTime) {
    const elapsed = Date.now() - state.patrolStartTime;
    document.getElementById('patrolTime').textContent = formatTime(elapsed);
  }
}, 1000);

// ========== Route Management ==========
function showNewRouteModal(type) {
  state.currentDrawType = type;
  document.getElementById('routeModalTitle').textContent =
    type === 'zone' ? 'New Patrol Zone' : 'New Patrol Route';
  document.getElementById('routeModalAction').textContent = 'Draw on Map';
  document.getElementById('routeName').value = '';
  document.getElementById('routeDescription').value = '';
  document.getElementById('routeModal').classList.add('visible');
}

function closeRouteModal() {
  document.getElementById('routeModal').classList.remove('visible');
  state.currentDrawType = null;
  state.editingRoute = null;
}

function createRoute() {
  const name = document.getElementById('routeName').value;
  if (!name) {
    alert('Please enter a route name');
    return;
  }

  closeRouteModal();

  // Enable drawing mode on map
  const drawType = state.currentDrawType === 'zone' ? 'polygon' : 'polyline';

  // Disable double-click zoom while drawing (it interferes with finishing shapes)
  state.map.doubleClickZoom.disable();

  if (drawType === 'polygon') {
    state.currentDrawHandler = new L.Draw.Polygon(state.map, {
      allowIntersection: false,
      showArea: true,
      shapeOptions: {
        color: getSelectedColor(),
        fillColor: getSelectedColor(),
        fillOpacity: 0.2
      }
    });
    state.currentDrawHandler.enable();
    addLog(`Drawing zone: Click to add points. Click the red "1" marker or double-click last point to finish.`);
  } else {
    state.currentDrawHandler = new L.Draw.Polyline(state.map, {
      shapeOptions: {
        color: getSelectedColor(),
        weight: 4
      }
    });
    state.currentDrawHandler.enable();
    addLog(`Drawing route: Click to add waypoints. Double-click last point to finish.`);
  }
}

function selectRoute(routeId) {
  state.selectedRoute = routeId;

  document.querySelectorAll('.route-item').forEach(item => {
    item.classList.remove('selected');
    if (item.dataset.id === routeId) {
      item.classList.add('selected');
    }
  });

  const route = state.routes.find(r => r.id === routeId);
  if (route && route.layer) {
    state.map.fitBounds(route.layer.getBounds(), { padding: [50, 50] });
  }
}

function editRoute(routeId) {
  const route = state.routes.find(r => r.id === routeId);
  if (!route) return;

  state.editingRoute = route;
  document.getElementById('routeModalTitle').textContent = 'Edit Route';
  document.getElementById('routeModalAction').textContent = 'Save Changes';
  document.getElementById('routeName').value = route.name;
  document.getElementById('routeDescription').value = route.description || '';

  // Select color
  document.querySelectorAll('.color-option').forEach(opt => {
    opt.classList.toggle('selected', opt.dataset.color === route.color);
  });

  document.getElementById('routePriority').value = route.priority || 'normal';
  document.getElementById('routeModal').classList.add('visible');
}

function deleteRoute(routeId) {
  if (!confirm('Delete this route?')) return;

  const routeIndex = state.routes.findIndex(r => r.id === routeId);
  if (routeIndex >= 0) {
    const route = state.routes[routeIndex];
    if (route.layer) {
      state.drawnItems.removeLayer(route.layer);
    }
    state.routes.splice(routeIndex, 1);

    if (state.selectedRoute === routeId) {
      state.selectedRoute = null;
    }

    saveRoutes();
    renderRoutesList();
    addLog(`Route deleted: ${route.name}`);
  }
}

function renderRoutesList() {
  const container = document.getElementById('routesList');

  if (state.routes.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="icon">🗺️</div>
        <div>No routes defined yet</div>
        <div style="font-size: 0.85em; margin-top: 5px;">Click "+ Route" to create one</div>
      </div>
    `;
    return;
  }

  container.innerHTML = state.routes.map(route => {
    const isSelected = route.id === state.selectedRoute;
    const isActive = route.id === state.activeRoute;
    const typeIcon = route.type === 'polygon' || route.type === 'rectangle' ? '🔲' : '📍';
    const waypointCount = route.coordinates ? route.coordinates.length : 0;

    return `
      <div class="route-item ${isSelected ? 'selected' : ''} ${isActive ? 'active' : ''}"
           data-id="${route.id}" onclick="selectRoute('${route.id}')">
        <div class="route-color" style="background: ${route.color};"></div>
        <div class="route-info">
          <div class="route-name">${typeIcon} ${route.name}</div>
          <div class="route-meta">${waypointCount} waypoints • ${route.priority || 'normal'} priority</div>
        </div>
        <div class="route-actions">
          <button class="route-action-btn" onclick="event.stopPropagation(); editRoute('${route.id}')" title="Edit">
            ✏️
          </button>
          <button class="route-action-btn delete" onclick="event.stopPropagation(); deleteRoute('${route.id}')" title="Delete">
            🗑️
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function getSelectedColor() {
  const selected = document.querySelector('.color-option.selected');
  return selected ? selected.dataset.color : '#4fc3f7';
}

// ========== Detection Targets ==========
function toggleDetectionTarget(el) {
  el.classList.toggle('active');

  const target = el.dataset.target;
  const idx = state.settings.detectionTargets.indexOf(target);

  if (idx >= 0) {
    state.settings.detectionTargets.splice(idx, 1);
  } else {
    state.settings.detectionTargets.push(target);
  }

  saveToStorage();

  // Send updated targets to server
  sendCommand('update_detection_targets', {
    targets: state.settings.detectionTargets,
    sensitivity: state.settings.detectionSensitivity
  });
}

function updateDetectionCounts() {
  document.querySelectorAll('.detection-target').forEach(el => {
    const target = el.dataset.target;
    const count = state.detectionCounts[target] || 0;
    el.querySelector('.count').textContent = count + ' found';

    // Update active state
    el.classList.toggle('active', state.settings.detectionTargets.includes(target));
  });
}

// ========== Detection Log ==========
function renderDetectionLog() {
  const container = document.getElementById('detectionLog');

  if (state.detections.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="icon">🔍</div>
        <div>No detections yet</div>
        <div style="font-size: 0.85em; margin-top: 5px;">Start a patrol to begin scanning</div>
      </div>
    `;
    return;
  }

  const icons = {
    snail: '🐌',
    person: '🚶',
    animal: '🐕',
    vehicle: '🚗',
    package: '📦',
    custom: '⚠️'
  };

  container.innerHTML = state.detections.slice(0, 20).map(det => `
    <div class="detection-entry ${det.type}">
      <div class="detection-thumbnail">
        ${det.imageUrl ? `<img src="${det.imageUrl}" alt="${det.type}">` : icons[det.type] || '❓'}
      </div>
      <div class="detection-info">
        <div class="detection-type">${icons[det.type] || '❓'} ${det.type.charAt(0).toUpperCase() + det.type.slice(1)}</div>
        <div class="detection-time">${new Date(det.timestamp).toLocaleString()}</div>
        <div class="detection-location" onclick="goToDetectionLocation(${det.lat}, ${det.lng})">
          📍 ${det.lat.toFixed(6)}, ${det.lng.toFixed(6)}
        </div>
      </div>
    </div>
  `).join('');
}

function clearDetectionLog() {
  if (!confirm('Clear all detections?')) return;

  state.detections = [];
  state.detectionCounts = {
    snail: 0,
    person: 0,
    animal: 0,
    vehicle: 0,
    package: 0,
    custom: 0
  };
  state.patrolDetections = 0;

  // Remove markers
  state.detectionMarkers.forEach(m => state.map.removeLayer(m));
  state.detectionMarkers = [];

  updateDetectionCounts();
  renderDetectionLog();
  document.getElementById('patrolDetections').textContent = '0';
  saveToStorage();

  addLog('Detection log cleared');
}

function goToDetectionLocation(lat, lng) {
  state.map.setView([lat, lng], 19);
}

// ========== Map Controls ==========
function centerOnHexapod() {
  state.map.setView([state.hexapodPosition.lat, state.hexapodPosition.lng], 18);
}

function setHomePosition() {
  state.homePosition = { ...state.hexapodPosition };
  createHomeMarker(state.homePosition);
  saveToStorage();
  addLog('Home position set to current location');
}

function toggleSatellite() {
  state.satelliteView = !state.satelliteView;

  if (state.satelliteView) {
    state.map.removeLayer(state.streetLayer);
    state.satelliteLayer.addTo(state.map);
  } else {
    state.map.removeLayer(state.satelliteLayer);
    state.streetLayer.addTo(state.map);
  }
}

function fitAllRoutes() {
  if (state.routes.length === 0) {
    alert('No routes to fit');
    return;
  }

  const bounds = L.latLngBounds([]);
  state.routes.forEach(route => {
    if (route.layer) {
      bounds.extend(route.layer.getBounds());
    }
  });

  if (bounds.isValid()) {
    state.map.fitBounds(bounds, { padding: [50, 50] });
  }
}

// ========== UI Helpers ==========
function toggleSection(header) {
  const section = header.closest('.sidebar-section');
  section.classList.toggle('collapsed');
}

function updateConnectionStatus(connected) {
  const statusEl = document.getElementById('connectionStatus');
  statusEl.className = 'connection-status ' + (connected ? 'connected' : 'disconnected');
  statusEl.querySelector('span').textContent = connected ? 'Connected' : 'Disconnected';
}

function updateUI() {
  // Update settings UI from state
  document.getElementById('detectionSensitivity').value = state.settings.detectionSensitivity;
  document.getElementById('sensitivityValue').textContent = state.settings.detectionSensitivity + '%';

  document.getElementById('patrolSpeed').value = state.settings.patrolSpeed;
  document.getElementById('speedValue').textContent = state.settings.patrolSpeed + '%';

  document.getElementById('patrolMode').value = state.settings.patrolMode;
  document.getElementById('zonePattern').value = state.settings.zonePattern;
  document.getElementById('waypointPause').value = state.settings.waypointPause;
  document.getElementById('autoReturnHome').checked = state.settings.autoReturnHome;
  document.getElementById('lowBatteryReturn').value = state.settings.lowBatteryReturn;

  document.getElementById('alertSound').checked = state.settings.alerts.sound;
  document.getElementById('alertNotification').checked = state.settings.alerts.notification;
  document.getElementById('alertEmail').checked = state.settings.alerts.email;
  document.getElementById('alertPhoto').checked = state.settings.alerts.photo;
  document.getElementById('alertPause').checked = state.settings.alerts.pause;
  document.getElementById('alertCooldown').value = state.settings.alerts.cooldown;

  document.getElementById('scheduleEnabled').checked = state.settings.schedule.enabled;
  document.getElementById('scheduleSettings').style.opacity = state.settings.schedule.enabled ? '1' : '0.5';
  document.getElementById('scheduleSettings').style.pointerEvents = state.settings.schedule.enabled ? 'auto' : 'none';

  document.querySelectorAll('.schedule-day').forEach(btn => {
    const day = parseInt(btn.dataset.day);
    btn.classList.toggle('active', state.settings.schedule.days.includes(day));
  });

  document.getElementById('scheduleStart').value = state.settings.schedule.startTime;
  document.getElementById('scheduleEnd').value = state.settings.schedule.endTime;
  document.getElementById('scheduleInterval').value = state.settings.schedule.interval;

  updateDetectionCounts();
  renderDetectionLog();
  updatePatrolUI();
}

function addLog(message) {
  console.log(`[Patrol] ${message}`);
  // Could also add to a visible log area
}

// ========== Utility Functions ==========
function calculateDistance(pos1, pos2) {
  // Haversine formula for distance in meters
  const R = 6371000; // Earth radius in meters
  const dLat = (pos2.lat - pos1.lat) * Math.PI / 180;
  const dLng = (pos2.lng - pos1.lng) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(pos1.lat * Math.PI / 180) * Math.cos(pos2.lat * Math.PI / 180) *
            Math.sin(dLng/2) * Math.sin(dLng/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

function formatDistance(meters) {
  if (meters < 1000) {
    return Math.round(meters) + ' m';
  }
  return (meters / 1000).toFixed(2) + ' km';
}

function formatTime(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function closeDetectionModal() {
  document.getElementById('detectionModal').classList.remove('visible');
}
