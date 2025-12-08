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
  waypointMarkersLayer: null, // Separate layer for waypoint markers (not editable)
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
  routeSortBy: 'name', // 'name', 'date', 'distance', 'priority'
  routeSortAsc: true,

  // Detections
  detections: [],
  detectionMarkers: [],
  customTargets: [], // Custom detection targets with YOLO model info
  editingCustomTarget: null, // Track which custom target is being edited
  selectedModelFile: null, // Temp storage for model file upload
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
  detections: 'hexapod_detections',
  satelliteView: 'hexapod_patrol_satellite_view',
  customTargets: 'hexapod_custom_targets'
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
    const satelliteView = localStorage.getItem(STORAGE_KEYS.satelliteView);

    if (routes) state.routes = JSON.parse(routes);
    if (settings) state.settings = { ...state.settings, ...JSON.parse(settings) };
    if (homePosition) {
      state.homePosition = JSON.parse(homePosition);
      console.log('[Patrol] Loaded home position from storage:', state.homePosition);
    }
    if (detections) {
      const parsed = JSON.parse(detections);
      state.detections = parsed.detections || [];
      state.detectionCounts = parsed.counts || state.detectionCounts;
    }
    if (satelliteView !== null) state.satelliteView = satelliteView === 'true';

    const customTargets = localStorage.getItem(STORAGE_KEYS.customTargets);
    if (customTargets) state.customTargets = JSON.parse(customTargets);
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

  state.streetLayer = streetLayer;
  state.satelliteLayer = satelliteLayer;

  // Add layer based on saved preference
  if (state.satelliteView) {
    satelliteLayer.addTo(state.map);
  } else {
    streetLayer.addTo(state.map);
  }

  // Initialize draw layer (for editable routes/zones)
  state.drawnItems = new L.FeatureGroup();
  state.map.addLayer(state.drawnItems);

  // Initialize waypoint markers layer (non-editable, for display only)
  state.waypointMarkersLayer = new L.FeatureGroup();
  state.map.addLayer(state.waypointMarkersLayer);

  // Initialize draw control - only show edit/delete buttons
  // (users create routes via "+ Route"/"+Zone" buttons which open the naming modal)
  const drawControl = new L.Control.Draw({
    position: 'topright',
    draw: false,  // Disable draw buttons - use our custom buttons instead
    edit: {
      featureGroup: state.drawnItems,
      edit: true,
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
    // Hide cancel button
    updateDrawingUI(false);
  });

  state.map.on(L.Draw.Event.CREATED, () => {
    if (state.firstVertexMarker) {
      state.map.removeLayer(state.firstVertexMarker);
      state.firstVertexMarker = null;
    }
    state.currentDrawHandler = null;
    // Re-enable double-click zoom
    state.map.doubleClickZoom.enable();
    // Hide cancel button
    updateDrawingUI(false);
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
      addWaypointMarkersForRoute(state.editingRoute); // Refresh waypoint markers
      saveRoutes();
      renderRoutesList(); // Update list with new distance/area
    } else if (state.currentDrawType) {
      // New route being created via our buttons
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
      addWaypointMarkersForRoute(route); // Add waypoint markers
      saveRoutes();
      renderRoutesList();
      closeRouteModal();
      addLog(`Created ${route.name}`);
    } else {
      // Fallback: shape created without context (shouldn't happen now that draw buttons are disabled)
      // Create with default name and prompt user to rename
      const isZone = e.layerType === 'polygon' || e.layerType === 'rectangle';
      const defaultName = isZone ? 'Unnamed Zone' : 'Unnamed Route';
      const route = {
        id: 'route_' + Date.now(),
        name: defaultName,
        description: '',
        color: '#4fc3f7',
        priority: 'normal',
        type: e.layerType,
        coordinates: getLayerCoordinates(layer),
        layer: layer,
        createdAt: new Date().toISOString()
      };

      state.routes.push(route);
      state.drawnItems.addLayer(layer);
      updateRouteOnMap(route);
      addWaypointMarkersForRoute(route); // Add waypoint markers
      saveRoutes();
      renderRoutesList();
      addLog(`Created ${defaultName} - click edit to rename`);
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
        // Refresh waypoint markers for edited routes
        addWaypointMarkersForRoute(route);
        saveRoutes();
        renderRoutesList(); // Update distance/time in list
      }
    });
    addLog('Route(s) updated');
  });

  state.map.on(L.Draw.Event.DELETED, (e) => {
    const layers = e.layers;
    layers.eachLayer((layer) => {
      const routeIndex = state.routes.findIndex(r => r.layer === layer);
      if (routeIndex >= 0) {
        const route = state.routes[routeIndex];
        // Clean up waypoint markers
        removeWaypointMarkersForRoute(route);
        state.routes.splice(routeIndex, 1);
        saveRoutes();
        renderRoutesList();
      }
    });
    addLog('Route(s) deleted');
  });

  // Create hexapod marker
  createHexapodMarker();

  // Load existing routes onto map
  loadRoutesOntoMap();

  // Create home marker if set
  if (state.homePosition) {
    console.log('[Patrol] Creating home marker at:', state.homePosition);
    createHomeMarker(state.homePosition);
  } else {
    console.log('[Patrol] No home position to restore');
  }

  // Center map on content: prefer routes, fall back to home position
  if (state.routes.length > 0 && state.routes[0].layer) {
    state.map.fitBounds(state.routes[0].layer.getBounds(), { padding: [50, 50] });
  } else if (state.homePosition) {
    state.map.setView([state.homePosition.lat, state.homePosition.lng], 18);
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
  if (!position || typeof position.lat !== 'number' || typeof position.lng !== 'number') {
    console.error('[Patrol] Invalid home position:', position);
    return;
  }

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
    icon: homeIcon,
    zIndexOffset: 900
  }).addTo(state.map);

  state.homeMarker.bindPopup('<strong>Home Position</strong>');
  console.log('[Patrol] Home marker created at:', position.lat, position.lng);
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
        fill: true,
        fillColor: route.color,
        fillOpacity: 0.3,
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

    // Add waypoint markers for routes (stored on route for cleanup)
    addWaypointMarkersForRoute(route);

    layer.on('click', () => selectRoute(route.id));
  });

  renderRoutesList();
}

function addWaypointMarkersForRoute(route) {
  // Clear existing waypoint markers for this route
  if (route.waypointMarkers) {
    route.waypointMarkers.forEach(m => state.waypointMarkersLayer.removeLayer(m));
  }
  route.waypointMarkers = [];

  // Only add markers for polyline routes (not zones)
  if (route.type !== 'polyline' || !route.coordinates) return;

  route.coordinates.forEach((coord, idx) => {
    const waypointIcon = L.divIcon({
      className: 'waypoint-marker',
      html: `<div style="background: ${route.color}; width: 20px; height: 20px; border-radius: 50%; border: 2px solid #fff; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: bold; color: #fff;">${idx + 1}</div>`,
      iconSize: [20, 20],
      iconAnchor: [10, 10]
    });

    const marker = L.marker(coord, { icon: waypointIcon });
    marker.addTo(state.waypointMarkersLayer);
    route.waypointMarkers.push(marker);
  });
}

function removeWaypointMarkersForRoute(route) {
  if (route.waypointMarkers) {
    route.waypointMarkers.forEach(m => state.waypointMarkersLayer.removeLayer(m));
    route.waypointMarkers = [];
  }
}

function updateRouteOnMap(route) {
  if (route.layer) {
    const isZone = route.type === 'polygon' || route.type === 'rectangle';
    route.layer.setStyle({
      color: route.color,
      fillColor: route.color,
      fill: isZone,
      fillOpacity: isZone ? 0.3 : 0
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
    renderRoutesList(); // Update time estimates
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
    renderRoutesList(); // Update time estimates for zones
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

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    // Don't trigger shortcuts if typing in an input field
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
      // Only allow Escape in inputs
      if (e.key !== 'Escape') return;
    }

    // Escape to cancel drawing or close help
    if (e.key === 'Escape') {
      if (state.currentDrawHandler) {
        cancelDrawing();
        e.preventDefault();
      } else if (document.getElementById('keyboardHelp').style.display !== 'none') {
        toggleKeyboardHelp();
        e.preventDefault();
      }
    }
    // Ctrl+S to save routes
    if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
      saveRoutes();
      addLog('Routes saved');
      e.preventDefault();
    }
    // Space to start/pause patrol (without modifiers)
    if (e.key === ' ' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (state.patrolStatus === 'running') {
        pausePatrol();
      } else if (state.patrolStatus === 'paused') {
        resumePatrol();
      } else {
        startPatrol();
      }
      e.preventDefault();
    }
    // H to return home
    if (e.key === 'h' && !e.ctrlKey && !e.metaKey) {
      goHome();
      e.preventDefault();
    }
    // C to center on hexapod
    if (e.key === 'c' && !e.ctrlKey && !e.metaKey) {
      centerOnHexapod();
      e.preventDefault();
    }
    // F to fit all routes
    if (e.key === 'f' && !e.ctrlKey && !e.metaKey) {
      fitAllRoutes();
      e.preventDefault();
    }
    // S to toggle satellite (without modifiers)
    if (e.key === 's' && !e.ctrlKey && !e.metaKey) {
      toggleSatellite();
      e.preventDefault();
    }
    // ? to toggle keyboard help
    if (e.key === '?') {
      toggleKeyboardHelp();
      e.preventDefault();
    }
  });
}

function toggleKeyboardHelp() {
  const helpEl = document.getElementById('keyboardHelp');
  if (helpEl) {
    helpEl.style.display = helpEl.style.display === 'none' ? 'block' : 'none';
  }
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

  // Confirm if patrol is already running on a different route
  if (state.patrolStatus === 'running' && state.activeRoute !== state.selectedRoute) {
    const currentRoute = state.routes.find(r => r.id === state.activeRoute);
    if (!confirm(`Switch from "${currentRoute?.name || 'current route'}" to "${route.name}"?`)) {
      return;
    }
  }

  // Warn if the route is hidden (unless coming from startPatrolOnRoute which already checks)
  if (route.visible === false && !state._skipHiddenCheck) {
    if (!confirm(`"${route.name}" is currently hidden from the map. Do you want to start patrol on this route anyway?`)) {
      return;
    }
  }
  state._skipHiddenCheck = false;

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
  updateWaypointProgress();
  addLog(`Waypoint ${data.waypoint_index + 1} reached`);
}

function updateWaypointProgress() {
  const progressEl = document.getElementById('waypointProgress');
  const progressTextEl = document.getElementById('waypointProgressText');
  const progressFillEl = document.getElementById('waypointProgressFill');
  const markersEl = document.getElementById('waypointMarkers');

  if (!progressEl) return;

  // Hide if not patrolling or no active route
  if (state.patrolStatus === 'stopped' || !state.activeRoute) {
    progressEl.style.display = 'none';
    return;
  }

  const route = state.routes.find(r => r.id === state.activeRoute);
  if (!route || !route.coordinates || route.coordinates.length === 0) {
    progressEl.style.display = 'none';
    return;
  }

  const isZone = route.type === 'polygon' || route.type === 'rectangle';

  // For zones, show a simplified progress (no individual waypoints)
  if (isZone) {
    progressEl.style.display = 'block';
    progressTextEl.textContent = 'Zone coverage';
    progressFillEl.style.width = '0%'; // Would need actual coverage data from server
    markersEl.innerHTML = '<span style="font-size: 0.75em; color: #888;">Coverage pattern in progress...</span>';
    return;
  }

  progressEl.style.display = 'block';

  const totalWaypoints = route.coordinates.length;
  const currentIndex = state.currentWaypointIndex;

  // Update text
  progressTextEl.textContent = `${currentIndex + 1} / ${totalWaypoints}`;

  // Update progress bar
  const progressPercent = totalWaypoints > 1
    ? (currentIndex / (totalWaypoints - 1)) * 100
    : 0;
  progressFillEl.style.width = `${progressPercent}%`;

  // Update waypoint markers (limit to max 10 for UI clarity)
  const maxMarkers = 10;
  let displayWaypoints = [];

  if (totalWaypoints <= maxMarkers) {
    displayWaypoints = route.coordinates.map((_, i) => i);
  } else {
    // Show first, last, current, and evenly distributed others
    const step = (totalWaypoints - 1) / (maxMarkers - 1);
    for (let i = 0; i < maxMarkers; i++) {
      displayWaypoints.push(Math.round(i * step));
    }
    // Ensure current waypoint is included
    if (!displayWaypoints.includes(currentIndex)) {
      displayWaypoints.push(currentIndex);
      displayWaypoints.sort((a, b) => a - b);
    }
  }

  markersEl.innerHTML = displayWaypoints.map(idx => {
    let className = 'waypoint-marker-dot';
    if (idx < currentIndex) {
      className += ' completed';
    } else if (idx === currentIndex) {
      className += ' current';
    }
    return `<div class="${className}" title="Waypoint ${idx + 1}">${idx + 1}</div>`;
  }).join('');
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

  // Update waypoint progress indicator
  updateWaypointProgress();
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

  // If editing an existing route, just update its properties
  if (state.editingRoute) {
    state.editingRoute.name = name;
    state.editingRoute.description = document.getElementById('routeDescription').value || '';
    state.editingRoute.color = getSelectedColor();
    state.editingRoute.priority = document.getElementById('routePriority').value;

    // Update the layer style on the map
    if (state.editingRoute.layer) {
      const isZone = state.editingRoute.type === 'polygon' || state.editingRoute.type === 'rectangle';
      state.editingRoute.layer.setStyle({
        color: state.editingRoute.color,
        fillColor: state.editingRoute.color,
        fill: isZone,
        fillOpacity: isZone ? 0.3 : 0
      });
      updateRouteOnMap(state.editingRoute);
    }

    saveRoutes();
    renderRoutesList();
    closeRouteModal();
    addLog(`Route "${name}" updated`);
    return;
  }

  // Save draw type BEFORE closing modal (which resets it to null)
  const drawType = state.currentDrawType === 'zone' ? 'polygon' : 'polyline';

  closeRouteModal();

  // Enable drawing mode on map for new routes

  // Disable double-click zoom while drawing (it interferes with finishing shapes)
  state.map.doubleClickZoom.disable();

  if (drawType === 'polygon') {
    state.currentDrawHandler = new L.Draw.Polygon(state.map, {
      allowIntersection: false,
      showArea: true,
      shapeOptions: {
        color: getSelectedColor(),
        fill: true,
        fillColor: getSelectedColor(),
        fillOpacity: 0.3
      }
    });
    state.currentDrawHandler.enable();
    addLog(`Drawing zone: Click to add points. Click the red "1" marker or double-click last point to finish. Press Escape to cancel.`);
  } else {
    state.currentDrawHandler = new L.Draw.Polyline(state.map, {
      shapeOptions: {
        color: getSelectedColor(),
        weight: 4
      }
    });
    state.currentDrawHandler.enable();
    addLog(`Drawing route: Click to add waypoints. Double-click last point to finish. Press Escape to cancel.`);
  }

  // Show cancel button
  updateDrawingUI(true);
}

// Calculate route distance in meters using Haversine formula
function calculateRouteDistance(coordinates) {
  if (!coordinates || coordinates.length < 2) return 0;

  let totalDistance = 0;
  for (let i = 0; i < coordinates.length - 1; i++) {
    const [lat1, lng1] = coordinates[i];
    const [lat2, lng2] = coordinates[i + 1];
    totalDistance += haversineDistance(lat1, lng1, lat2, lng2);
  }
  return totalDistance;
}

function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000; // Earth radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// formatDistance is defined once in Utility Functions section

function estimatePatrolTime(distanceMeters, speedPercent) {
  // Assume max speed is about 0.5 m/s for the hexapod
  const maxSpeed = 0.5; // m/s
  const actualSpeed = maxSpeed * (speedPercent / 100);
  const timeSeconds = distanceMeters / actualSpeed;
  const minutes = Math.round(timeSeconds / 60);
  if (minutes < 60) {
    return `~${minutes}min`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `~${hours}h ${mins}min`;
}

// Calculate polygon area in square meters using Shoelace formula
function calculatePolygonArea(coordinates) {
  if (!coordinates || coordinates.length < 3) return 0;

  // Convert to radians and calculate using spherical excess formula
  const R = 6371000; // Earth radius in meters

  let total = 0;
  const n = coordinates.length;

  for (let i = 0; i < n; i++) {
    const [lat1, lng1] = coordinates[i];
    const [lat2, lng2] = coordinates[(i + 1) % n];

    const phi1 = lat1 * Math.PI / 180;
    const phi2 = lat2 * Math.PI / 180;
    const lambda1 = lng1 * Math.PI / 180;
    const lambda2 = lng2 * Math.PI / 180;

    total += (lambda2 - lambda1) * (2 + Math.sin(phi1) + Math.sin(phi2));
  }

  return Math.abs(total * R * R / 2);
}

function formatArea(sqMeters) {
  if (sqMeters < 10000) {
    return `${Math.round(sqMeters)} m²`;
  }
  return `${(sqMeters / 10000).toFixed(2)} ha`;
}

// Calculate zone perimeter in meters
function calculatePolygonPerimeter(coordinates) {
  if (!coordinates || coordinates.length < 2) return 0;

  let totalPerimeter = 0;
  const n = coordinates.length;

  for (let i = 0; i < n; i++) {
    const [lat1, lng1] = coordinates[i];
    const [lat2, lng2] = coordinates[(i + 1) % n]; // Close the loop
    totalPerimeter += haversineDistance(lat1, lng1, lat2, lng2);
  }

  return totalPerimeter;
}

// Estimate zone patrol time based on area and coverage pattern
function estimateZonePatrolTime(areaSqMeters, speedPercent, pattern) {
  // Estimate based on lawnmower pattern with ~1m spacing
  // Coverage distance = area / spacing + perimeter
  const spacing = 1; // meters between rows
  const coverageDistance = areaSqMeters / spacing;

  // Adjust for different patterns
  let patternMultiplier = 1;
  switch (pattern) {
    case 'spiral': patternMultiplier = 0.9; break;
    case 'perimeter': patternMultiplier = 0.2; break; // Much faster, only edges
    case 'random': patternMultiplier = 1.2; break;
    default: patternMultiplier = 1; // lawnmower
  }

  const effectiveDistance = coverageDistance * patternMultiplier;
  return estimatePatrolTime(effectiveDistance, speedPercent);
}

function selectRoute(routeId) {
  const previousSelected = state.selectedRoute;
  state.selectedRoute = routeId;

  // Update sidebar list selection
  document.querySelectorAll('.route-item').forEach(item => {
    item.classList.remove('selected');
    if (item.dataset.id === routeId) {
      item.classList.add('selected');
    }
  });

  // Remove highlight from previously selected route
  if (previousSelected && previousSelected !== routeId) {
    const prevRoute = state.routes.find(r => r.id === previousSelected);
    if (prevRoute && prevRoute.layer) {
      const isZone = prevRoute.type === 'polygon' || prevRoute.type === 'rectangle';
      prevRoute.layer.setStyle({
        weight: isZone ? 3 : 4,
        opacity: 1,
        dashArray: null
      });
    }
  }

  // Highlight newly selected route on map
  const route = state.routes.find(r => r.id === routeId);
  if (route && route.layer) {
    const isZone = route.type === 'polygon' || route.type === 'rectangle';
    route.layer.setStyle({
      weight: isZone ? 5 : 6,
      opacity: 1,
      dashArray: null
    });
    // Bring to front so highlight is visible
    route.layer.bringToFront();
  }
}

function centerOnRoute(routeId) {
  const route = state.routes.find(r => r.id === routeId);
  if (route && route.layer) {
    state.map.fitBounds(route.layer.getBounds(), { padding: [50, 50] });
  }
}

function startPatrolOnRoute(routeId) {
  const route = state.routes.find(r => r.id === routeId);

  // Check if route is hidden and warn user
  if (route && route.visible === false) {
    if (!confirm(`"${route.name}" is currently hidden from the map. Do you want to start patrol on this route anyway?`)) {
      return;
    }
    // Skip the check in startPatrol since we already confirmed
    state._skipHiddenCheck = true;
  }

  state.selectedRoute = routeId;
  startPatrol();
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
    // Clean up waypoint markers
    removeWaypointMarkersForRoute(route);

    state.routes.splice(routeIndex, 1);

    if (state.selectedRoute === routeId) {
      state.selectedRoute = null;
    }

    saveRoutes();
    renderRoutesList();
    addLog(`Route deleted: ${route.name}`);
  }
}

function toggleRouteVisibility(routeId) {
  const route = state.routes.find(r => r.id === routeId);
  if (!route) return;

  route.visible = route.visible === false ? true : false; // Default to true if undefined

  if (route.layer) {
    if (route.visible) {
      state.drawnItems.addLayer(route.layer);
      addWaypointMarkersForRoute(route);
    } else {
      state.drawnItems.removeLayer(route.layer);
      removeWaypointMarkersForRoute(route);
    }
  }

  saveRoutes();
  renderRoutesList();
}

function duplicateRoute(routeId) {
  const route = state.routes.find(r => r.id === routeId);
  if (!route) return;

  const newRoute = {
    ...route,
    id: 'route_' + Date.now(),
    name: route.name + ' (copy)',
    createdAt: new Date().toISOString(),
    layer: null, // Will be recreated
    waypointMarkers: [],
    visible: true
  };

  // Create new layer
  const isZone = newRoute.type === 'polygon' || newRoute.type === 'rectangle';
  if (isZone) {
    newRoute.layer = L.polygon(newRoute.coordinates, {
      color: newRoute.color,
      fill: true,
      fillColor: newRoute.color,
      fillOpacity: 0.3,
      weight: 3
    });
  } else {
    newRoute.layer = L.polyline(newRoute.coordinates, {
      color: newRoute.color,
      weight: 4
    });
  }

  state.routes.push(newRoute);
  state.drawnItems.addLayer(newRoute.layer);
  newRoute.layer.on('click', () => selectRoute(newRoute.id));
  addWaypointMarkersForRoute(newRoute);
  updateRouteOnMap(newRoute);

  saveRoutes();
  renderRoutesList();
  addLog(`Duplicated route: ${newRoute.name}`);
}

function renderRoutesList() {
  const container = document.getElementById('routesList');

  // Update route count in header
  updateRouteCount();

  // Update statistics panel
  updateRouteStats();

  if (state.routes.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="icon">🗺️</div>
        <div style="font-weight: 500; margin-bottom: 8px;">No patrol routes yet</div>
        <div style="font-size: 0.85em; color: #888; line-height: 1.5;">
          <strong>+ Route</strong>: Create a path with waypoints<br>
          <strong>+ Zone</strong>: Define an area to patrol
        </div>
      </div>
    `;
    return;
  }

  // Get sorted routes
  const sortedRoutes = getSortedRoutes();

  container.innerHTML = sortedRoutes.map(route => {
    const isSelected = route.id === state.selectedRoute;
    const isActive = route.id === state.activeRoute;
    const isVisible = route.visible !== false; // Default to true
    const isZone = route.type === 'polygon' || route.type === 'rectangle';
    const typeIcon = isZone ? '🔲' : '📍';
    const waypointCount = route.coordinates ? route.coordinates.length : 0;

    // Priority badge
    const priorityBadge = route.priority === 'high' ? '<span class="priority-badge high">!</span>' :
                          route.priority === 'low' ? '<span class="priority-badge low">↓</span>' : '';

    // Calculate distance/time for routes, area and perimeter for zones
    let sizeInfo = '';
    let timeInfo = '';
    if (isZone && route.coordinates && route.coordinates.length >= 3) {
      const area = calculatePolygonArea(route.coordinates);
      const perimeter = calculatePolygonPerimeter(route.coordinates);
      const zoneTime = estimateZonePatrolTime(area, state.settings.patrolSpeed, state.settings.zonePattern);
      sizeInfo = `${formatArea(area)} • ${formatDistance(perimeter)}`;
      timeInfo = zoneTime;
    } else if (route.type === 'polyline' && route.coordinates && route.coordinates.length >= 2) {
      const distance = calculateRouteDistance(route.coordinates);
      const time = estimatePatrolTime(distance, state.settings.patrolSpeed);
      sizeInfo = formatDistance(distance);
      timeInfo = time;
    }

    return `
      <div class="route-item ${isSelected ? 'selected' : ''} ${isActive ? 'active' : ''} ${!isVisible ? 'hidden-route' : ''}"
           data-id="${route.id}" onclick="selectRoute('${route.id}')" ondblclick="startPatrolOnRoute('${route.id}')" title="Click to select, double-click to start patrol">
        <button class="route-visibility-btn ${isVisible ? 'visible' : ''}" onclick="event.stopPropagation(); toggleRouteVisibility('${route.id}')" title="${isVisible ? 'Hide from map' : 'Show on map'}">
          ${isVisible ? '👁️' : '👁️‍🗨️'}
        </button>
        <div class="route-color" style="background: ${route.color};"></div>
        <div class="route-info">
          <div class="route-name">${typeIcon} ${route.name} ${priorityBadge}</div>
          <div class="route-meta">
            <span>${waypointCount} ${isZone ? 'vertices' : 'waypoints'}</span>
            ${sizeInfo ? `<span class="route-size">${sizeInfo}</span>` : ''}
            ${timeInfo ? `<span class="route-time">⏱️ ${timeInfo}</span>` : ''}
          </div>
        </div>
        <div class="route-actions">
          <button class="route-action-btn play" onclick="event.stopPropagation(); startPatrolOnRoute('${route.id}')" title="Start patrol">
            ▶️
          </button>
          <button class="route-action-btn" onclick="event.stopPropagation(); centerOnRoute('${route.id}')" title="Center on map">
            🎯
          </button>
          <button class="route-action-btn" onclick="event.stopPropagation(); duplicateRoute('${route.id}')" title="Duplicate">
            📋
          </button>
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

function updateRouteCount() {
  const countEl = document.getElementById('routeCount');
  if (countEl && state.routes.length > 0) {
    const visibleCount = state.routes.filter(r => r.visible !== false).length;
    countEl.textContent = `(${visibleCount}/${state.routes.length})`;
  } else if (countEl) {
    countEl.textContent = '';
  }
}

function updateRouteStats() {
  const statsEl = document.getElementById('routeStats');
  if (!statsEl) return;

  if (state.routes.length === 0) {
    statsEl.style.display = 'none';
    return;
  }

  statsEl.style.display = 'flex';

  const routes = state.routes.filter(r => r.type === 'polyline');
  const zones = state.routes.filter(r => r.type === 'polygon' || r.type === 'rectangle');

  let totalRouteDistance = 0;
  let totalZoneArea = 0;
  let totalZonePerimeter = 0;

  routes.forEach(route => {
    if (route.coordinates && route.coordinates.length >= 2) {
      totalRouteDistance += calculateRouteDistance(route.coordinates);
    }
  });

  zones.forEach(zone => {
    if (zone.coordinates && zone.coordinates.length >= 3) {
      totalZoneArea += calculatePolygonArea(zone.coordinates);
      totalZonePerimeter += calculatePolygonPerimeter(zone.coordinates);
    }
  });

  // Calculate estimated total patrol time
  const routeTime = totalRouteDistance > 0 ? estimatePatrolTimeRaw(totalRouteDistance, state.settings.patrolSpeed) : 0;
  const zoneTime = totalZoneArea > 0 ? estimateZonePatrolTimeRaw(totalZoneArea, state.settings.patrolSpeed, state.settings.zonePattern) : 0;
  const totalTimeMinutes = Math.round((routeTime + zoneTime) / 60);

  const highPriority = state.routes.filter(r => r.priority === 'high').length;

  // Update stats display
  document.getElementById('statRouteCount').textContent = routes.length;
  document.getElementById('statZoneCount').textContent = zones.length;
  document.getElementById('statTotalDistance').textContent = formatDistance(totalRouteDistance + totalZonePerimeter);
  document.getElementById('statTotalArea').textContent = formatArea(totalZoneArea);
  document.getElementById('statEstTime').textContent = totalTimeMinutes > 0 ? `~${totalTimeMinutes}min` : '-';
  document.getElementById('statHighPriority').textContent = highPriority;
}

function estimatePatrolTimeRaw(distanceMeters, speedPercent) {
  const maxSpeed = 0.5; // m/s
  const actualSpeed = maxSpeed * (speedPercent / 100);
  return distanceMeters / actualSpeed;
}

function estimateZonePatrolTimeRaw(areaSqMeters, speedPercent, pattern) {
  const spacing = 1;
  let patternMultiplier = 1;
  switch (pattern) {
    case 'spiral': patternMultiplier = 0.9; break;
    case 'perimeter': patternMultiplier = 0.2; break;
    case 'random': patternMultiplier = 1.2; break;
    default: patternMultiplier = 1;
  }
  const effectiveDistance = (areaSqMeters / spacing) * patternMultiplier;
  return estimatePatrolTimeRaw(effectiveDistance, speedPercent);
}

function showAllRoutes() {
  state.routes.forEach(route => {
    if (route.visible === false) {
      route.visible = true;
      if (route.layer) {
        state.drawnItems.addLayer(route.layer);
        addWaypointMarkersForRoute(route);
      }
    }
  });
  saveRoutes();
  renderRoutesList();
  addLog('All routes visible');
}

function hideAllRoutes() {
  state.routes.forEach(route => {
    if (route.visible !== false) {
      route.visible = false;
      if (route.layer) {
        state.drawnItems.removeLayer(route.layer);
        removeWaypointMarkersForRoute(route);
      }
    }
  });
  saveRoutes();
  renderRoutesList();
  addLog('All routes hidden');
}

function exportRoutes() {
  if (state.routes.length === 0) {
    alert('No routes to export');
    return;
  }

  // Prepare routes for export (exclude non-serializable data)
  const exportData = {
    version: 1,
    exportedAt: new Date().toISOString(),
    routes: state.routes.map(r => ({
      id: r.id,
      name: r.name,
      description: r.description,
      color: r.color,
      priority: r.priority,
      type: r.type,
      coordinates: r.coordinates,
      visible: r.visible,
      createdAt: r.createdAt
    }))
  };

  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `hexapod-routes-${new Date().toISOString().split('T')[0]}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  addLog(`Exported ${state.routes.length} routes`);
}

function importRoutes(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);

      if (!data.routes || !Array.isArray(data.routes)) {
        throw new Error('Invalid routes file format');
      }

      const importCount = data.routes.length;
      let addedCount = 0;

      data.routes.forEach(importedRoute => {
        // Check for duplicate names
        const existingName = state.routes.find(r => r.name === importedRoute.name);
        if (existingName) {
          importedRoute.name = importedRoute.name + ' (imported)';
        }

        // Generate new ID
        importedRoute.id = 'route_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        importedRoute.createdAt = new Date().toISOString();
        importedRoute.visible = true;

        // Create layer
        const isZone = importedRoute.type === 'polygon' || importedRoute.type === 'rectangle';
        if (isZone) {
          importedRoute.layer = L.polygon(importedRoute.coordinates, {
            color: importedRoute.color,
            fill: true,
            fillColor: importedRoute.color,
            fillOpacity: 0.3,
            weight: 3
          });
        } else {
          importedRoute.layer = L.polyline(importedRoute.coordinates, {
            color: importedRoute.color,
            weight: 4
          });
        }

        state.routes.push(importedRoute);
        state.drawnItems.addLayer(importedRoute.layer);
        importedRoute.layer.on('click', () => selectRoute(importedRoute.id));
        addWaypointMarkersForRoute(importedRoute);
        updateRouteOnMap(importedRoute);
        addedCount++;
      });

      saveRoutes();
      renderRoutesList();
      addLog(`Imported ${addedCount} of ${importCount} routes`);

      // Fit map to show all routes
      if (addedCount > 0) {
        fitAllRoutes();
      }
    } catch (err) {
      alert('Failed to import routes: ' + err.message);
      console.error('Import error:', err);
    }
  };

  reader.readAsText(file);
  event.target.value = ''; // Reset file input
}

function sortRoutes(sortBy) {
  // Toggle direction if clicking same sort option
  if (state.routeSortBy === sortBy) {
    state.routeSortAsc = !state.routeSortAsc;
  } else {
    state.routeSortBy = sortBy;
    state.routeSortAsc = true;
  }

  renderRoutesList();
  updateSortButtons();
}

function getSortedRoutes() {
  const routes = [...state.routes];
  const direction = state.routeSortAsc ? 1 : -1;

  routes.sort((a, b) => {
    switch (state.routeSortBy) {
      case 'name':
        return direction * a.name.localeCompare(b.name);

      case 'date':
        const dateA = new Date(a.createdAt || 0);
        const dateB = new Date(b.createdAt || 0);
        return direction * (dateB - dateA); // Newest first by default

      case 'distance':
        const distA = getRouteSize(a);
        const distB = getRouteSize(b);
        return direction * (distB - distA); // Largest first by default

      case 'priority':
        const priorityOrder = { high: 0, normal: 1, low: 2 };
        const priA = priorityOrder[a.priority] ?? 1;
        const priB = priorityOrder[b.priority] ?? 1;
        return direction * (priA - priB); // High priority first by default

      default:
        return 0;
    }
  });

  return routes;
}

function getRouteSize(route) {
  const isZone = route.type === 'polygon' || route.type === 'rectangle';
  if (isZone && route.coordinates && route.coordinates.length >= 3) {
    return calculatePolygonArea(route.coordinates);
  } else if (route.type === 'polyline' && route.coordinates && route.coordinates.length >= 2) {
    return calculateRouteDistance(route.coordinates);
  }
  return 0;
}

function updateSortButtons() {
  document.querySelectorAll('.sort-btn').forEach(btn => {
    const sortBy = btn.dataset.sort;
    btn.classList.toggle('active', sortBy === state.routeSortBy);

    // Update arrow indicator
    const arrow = btn.querySelector('.sort-arrow');
    if (arrow) {
      if (sortBy === state.routeSortBy) {
        arrow.textContent = state.routeSortAsc ? '↑' : '↓';
        arrow.style.opacity = '1';
      } else {
        arrow.textContent = '↕';
        arrow.style.opacity = '0.4';
      }
    }
  });
}

function filterRoutes(query) {
  const searchTerm = query.toLowerCase().trim();
  const routeItems = document.querySelectorAll('.route-item');

  routeItems.forEach(item => {
    const routeId = item.dataset.id;
    const route = state.routes.find(r => r.id === routeId);

    if (!route) {
      item.style.display = 'none';
      return;
    }

    // Search in name, description, and type
    const matchesName = route.name.toLowerCase().includes(searchTerm);
    const matchesDescription = (route.description || '').toLowerCase().includes(searchTerm);
    const matchesType = route.type.toLowerCase().includes(searchTerm);
    const matchesPriority = (route.priority || '').toLowerCase().includes(searchTerm);

    // Special keywords
    const isZone = route.type === 'polygon' || route.type === 'rectangle';
    const matchesZoneKeyword = searchTerm === 'zone' && isZone;
    const matchesRouteKeyword = searchTerm === 'route' && !isZone;
    const matchesHiddenKeyword = searchTerm === 'hidden' && route.visible === false;
    const matchesVisibleKeyword = searchTerm === 'visible' && route.visible !== false;

    if (searchTerm === '' || matchesName || matchesDescription || matchesType ||
        matchesPriority || matchesZoneKeyword || matchesRouteKeyword ||
        matchesHiddenKeyword || matchesVisibleKeyword) {
      item.style.display = 'flex';
    } else {
      item.style.display = 'none';
    }
  });

  // Show empty state if no results
  const visibleItems = document.querySelectorAll('.route-item[style*="flex"], .route-item:not([style*="display"])');
  const container = document.getElementById('routesList');
  const existingNoResults = container.querySelector('.no-results');

  if (existingNoResults) {
    existingNoResults.remove();
  }

  if (searchTerm && visibleItems.length === 0 && state.routes.length > 0) {
    const noResults = document.createElement('div');
    noResults.className = 'no-results';
    noResults.innerHTML = `
      <div style="text-align: center; padding: 20px; color: #888;">
        No routes matching "${query}"
      </div>
    `;
    container.appendChild(noResults);
  }
}

// ========== Detection Targets ==========
function toggleDetectionTarget(el) {
  const target = el.dataset.target;

  // Special handling for "custom" - open the modal
  if (target === 'custom') {
    showCustomDetectionModal();
    return;
  }

  el.classList.toggle('active');

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

// ========== Custom Detection Management ==========
function showCustomDetectionModal() {
  const modal = document.getElementById('customDetectionModal');
  modal.classList.add('visible');
  renderCustomTargetsList();
  initCustomDetectionForm();
  initIconPicker();
}

function closeCustomDetectionModal() {
  const modal = document.getElementById('customDetectionModal');
  modal.classList.remove('visible');
  resetCustomDetectionForm();
}

function initCustomDetectionForm() {
  // Source type toggle
  const sourceSelect = document.getElementById('customTargetSource');
  sourceSelect.addEventListener('change', () => {
    const cocoGroup = document.getElementById('cocoClassGroup');
    const modelGroup = document.getElementById('modelFileGroup');

    if (sourceSelect.value === 'yolo-coco') {
      cocoGroup.style.display = 'block';
      modelGroup.style.display = 'none';
    } else {
      cocoGroup.style.display = 'none';
      modelGroup.style.display = 'block';
    }
  });

  // Confidence slider
  const confidenceSlider = document.getElementById('customTargetConfidence');
  const confidenceValue = document.getElementById('customConfidenceValue');
  confidenceSlider.addEventListener('input', () => {
    confidenceValue.textContent = confidenceSlider.value + '%';
  });
}

function resetCustomDetectionForm() {
  document.getElementById('customTargetName').value = '';
  document.getElementById('customTargetIcon').value = '🎯';
  document.getElementById('selectedIconDisplay').textContent = '🎯';
  document.getElementById('customTargetSource').value = 'yolo-coco';
  document.getElementById('customCocoClass').value = '';
  document.getElementById('customTargetConfidence').value = 50;
  document.getElementById('customConfidenceValue').textContent = '50%';
  document.getElementById('modelFileName').textContent = 'Click to select model file...';
  document.getElementById('modelFileName').parentElement.classList.remove('has-file');
  document.getElementById('cocoClassGroup').style.display = 'block';
  document.getElementById('modelFileGroup').style.display = 'none';
  document.getElementById('iconPicker').style.display = 'none';
  state.selectedModelFile = null;
  state.editingCustomTarget = null;

  // Reset button text
  const addBtn = document.querySelector('.custom-target-form .btn-primary');
  if (addBtn) {
    addBtn.textContent = '+ Add Custom Target';
  }

  // Hide cancel button
  const cancelBtn = document.getElementById('cancelEditBtn');
  if (cancelBtn) {
    cancelBtn.style.display = 'none';
  }

  // Reset icon picker selection
  document.querySelectorAll('#iconPickerGrid .icon-option').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.icon === '🎯');
  });
}

// Icon picker for custom detection targets
const DETECTION_ICONS = [
  // Animals & Nature
  '🐌', '🐛', '🐜', '🐝', '🐞', '🦋', '🐛', '🪲', '🪳', '🪰', '🦟', '🦗', '🐾',
  '🐕', '🐈', '🐁', '🐀', '🦔', '🐇', '🐿️', '🦨', '🦝', '🦊', '🐻', '🐼',
  '🦁', '🐯', '🐨', '🐮', '🐷', '🐸', '🦎', '🐍', '🦅', '🦆', '🦉', '🐦',
  // People & Objects
  '🚶', '🧑', '👤', '👥', '🚗', '🚙', '🚕', '🛻', '🚚', '🏍️', '🚲', '🛴',
  '📦', '📬', '🎁', '🧳', '👜', '🎒', '💼', '🛒',
  // Garden & Plants
  '🌱', '🌿', '🍀', '🌻', '🌹', '🌺', '🌸', '🍄', '🌾', '🥕', '🥬', '🍅',
  // Tools & Tech
  '🔧', '🔨', '⚙️', '📷', '📹', '🔦', '💡', '🔔', '🎯', '⚠️', '🚨', '🛡️',
  // Weather & Time
  '☀️', '🌙', '⭐', '🌧️', '❄️', '💧', '🔥',
  // Symbols
  '✅', '❌', '⚡', '💎', '🏠', '🏢', '🚪', '🪟', '🔑', '🗝️'
];

function initIconPicker() {
  const grid = document.getElementById('iconPickerGrid');
  if (!grid) return;

  grid.innerHTML = DETECTION_ICONS.map(icon => `
    <button type="button" class="icon-option ${icon === '🎯' ? 'selected' : ''}"
            data-icon="${icon}" onclick="selectIcon('${icon}')">
      ${icon}
    </button>
  `).join('');
}

function toggleIconPicker() {
  const picker = document.getElementById('iconPicker');
  if (!picker) return;

  const isVisible = picker.style.display !== 'none';
  picker.style.display = isVisible ? 'none' : 'block';

  // Initialize grid on first open
  if (!isVisible && picker.querySelector('.icon-option') === null) {
    initIconPicker();
  }
}

function selectIcon(icon) {
  document.getElementById('customTargetIcon').value = icon;
  document.getElementById('selectedIconDisplay').textContent = icon;

  // Update selected state in grid
  document.querySelectorAll('.icon-option').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.icon === icon);
  });

  // Close picker
  document.getElementById('iconPicker').style.display = 'none';
}

// Close icon picker when clicking outside
document.addEventListener('click', (e) => {
  const picker = document.getElementById('iconPicker');
  const btn = document.getElementById('iconSelectorBtn');
  if (picker && btn && !picker.contains(e.target) && !btn.contains(e.target)) {
    picker.style.display = 'none';
  }
});

function handleModelFileSelect(event) {
  const file = event.target.files[0];
  if (file) {
    state.selectedModelFile = file;
    const fileNameEl = document.getElementById('modelFileName');
    fileNameEl.textContent = file.name;
    fileNameEl.parentElement.classList.add('has-file');
  }
}

function addCustomTarget() {
  const name = document.getElementById('customTargetName').value.trim();
  const icon = document.getElementById('customTargetIcon').value.trim() || '🎯';
  const source = document.getElementById('customTargetSource').value;
  const confidence = parseInt(document.getElementById('customTargetConfidence').value);

  if (!name) {
    alert('Please enter a target name');
    return;
  }

  // Check if we're editing an existing target
  const isEditing = state.editingCustomTarget !== null;
  const existingTarget = state.editingCustomTarget;

  let targetConfig = isEditing ? { ...existingTarget } : {
    id: 'custom_' + Date.now(),
    enabled: true,
    createdAt: new Date().toISOString(),
    detectionCount: 0
  };

  // Update common fields
  targetConfig.name = name;
  targetConfig.icon = icon;
  targetConfig.source = source;
  targetConfig.confidence = confidence;

  if (source === 'yolo-coco') {
    const cocoClass = document.getElementById('customCocoClass').value;
    if (!cocoClass) {
      alert('Please select a COCO class');
      return;
    }
    targetConfig.cocoClass = cocoClass;
    targetConfig.modelType = 'coco';
    // Clear model file info if switching from custom model
    delete targetConfig.modelFileName;
  } else {
    // For custom model, only require file if creating new or changing model
    if (!isEditing && !state.selectedModelFile) {
      alert('Please select a YOLO model file');
      return;
    }
    if (state.selectedModelFile) {
      targetConfig.modelFileName = state.selectedModelFile.name;
      targetConfig.modelType = 'custom';
      // Upload the new model file
      uploadCustomModel(state.selectedModelFile, targetConfig.id);
    }
    // Clear COCO class if switching from coco
    delete targetConfig.cocoClass;
  }

  if (isEditing) {
    // Update existing target in array
    const index = state.customTargets.findIndex(t => t.id === targetConfig.id);
    if (index !== -1) {
      state.customTargets[index] = targetConfig;
    }
    // Notify server about updated custom target
    sendCommand('update_custom_detection_target', targetConfig);
    showToast(`Custom target "${name}" updated`);
  } else {
    state.customTargets.push(targetConfig);
    // Notify server about new custom target
    sendCommand('add_custom_detection_target', targetConfig);
    showToast(`Custom target "${name}" added`);
  }

  saveCustomTargets();
  renderCustomTargetsList();
  resetCustomDetectionForm();
  updateCustomDetectionCount();
}

function uploadCustomModel(file, targetId) {
  // Create FormData for file upload
  const formData = new FormData();
  formData.append('model', file);
  formData.append('target_id', targetId);

  // Upload to server
  fetch('/api/patrol/upload-model', {
    method: 'POST',
    body: formData
  }).then(response => {
    if (!response.ok) {
      console.error('Failed to upload model file');
    }
  }).catch(err => {
    console.error('Error uploading model:', err);
  });
}

function toggleCustomTarget(targetId) {
  const target = state.customTargets.find(t => t.id === targetId);
  if (target) {
    target.enabled = !target.enabled;
    saveCustomTargets();
    renderCustomTargetsList();
    updateCustomDetectionCount();

    // Notify server
    sendCommand('toggle_custom_detection_target', {
      target_id: targetId,
      enabled: target.enabled
    });
  }
}

function editCustomTarget(targetId) {
  const target = state.customTargets.find(t => t.id === targetId);
  if (!target) return;

  state.editingCustomTarget = target;

  // Populate form with target data
  document.getElementById('customTargetName').value = target.name;
  document.getElementById('customTargetIcon').value = target.icon;
  document.getElementById('selectedIconDisplay').textContent = target.icon;
  document.getElementById('customTargetSource').value = target.modelType === 'coco' ? 'yolo-coco' : 'custom-model';
  document.getElementById('customTargetConfidence').value = target.confidence;
  document.getElementById('customConfidenceValue').textContent = target.confidence + '%';

  // Update icon picker selected state
  document.querySelectorAll('#iconPickerGrid .icon-option').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.icon === target.icon);
  });

  // Show/hide source-specific fields
  const cocoGroup = document.getElementById('cocoClassGroup');
  const modelGroup = document.getElementById('modelFileGroup');

  if (target.modelType === 'coco') {
    cocoGroup.style.display = 'block';
    modelGroup.style.display = 'none';
    document.getElementById('customCocoClass').value = target.cocoClass || '';
  } else {
    cocoGroup.style.display = 'none';
    modelGroup.style.display = 'block';
    document.getElementById('modelFileName').textContent = target.modelFileName || 'Click to select model file...';
    if (target.modelFileName) {
      document.getElementById('modelFileName').parentElement.classList.add('has-file');
    }
  }

  // Update button text to indicate editing
  const addBtn = document.querySelector('.custom-target-form .btn-primary');
  if (addBtn) {
    addBtn.textContent = '💾 Update Target';
  }

  // Show cancel button
  const cancelBtn = document.getElementById('cancelEditBtn');
  if (cancelBtn) {
    cancelBtn.style.display = 'block';
  }

  // Scroll form into view
  document.querySelector('.custom-target-form').scrollIntoView({ behavior: 'smooth' });
}

function cancelEditCustomTarget() {
  state.editingCustomTarget = null;
  resetCustomDetectionForm();
}

function deleteCustomTarget(targetId) {
  const target = state.customTargets.find(t => t.id === targetId);
  if (!target) return;

  if (!confirm(`Delete custom target "${target.name}"?`)) {
    return;
  }

  state.customTargets = state.customTargets.filter(t => t.id !== targetId);
  saveCustomTargets();
  renderCustomTargetsList();
  updateCustomDetectionCount();

  // Notify server
  sendCommand('delete_custom_detection_target', { target_id: targetId });

  showToast(`Custom target "${target.name}" deleted`);
}

function renderCustomTargetsList() {
  const container = document.getElementById('customTargetsList');

  if (state.customTargets.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="padding: 15px;">
        <div style="color: #888; font-size: 0.85em;">No custom targets created yet</div>
      </div>
    `;
    return;
  }

  container.innerHTML = state.customTargets.map(target => {
    const sourceInfo = target.modelType === 'coco'
      ? `COCO: ${target.cocoClass}`
      : `Model: ${target.modelFileName}`;

    return `
      <div class="custom-target-item ${target.enabled ? '' : 'disabled'}" data-id="${target.id}">
        <div class="custom-target-icon">${target.icon}</div>
        <div class="custom-target-info">
          <div class="custom-target-name">${target.name}</div>
          <div class="custom-target-meta">
            ${sourceInfo} | ${target.confidence}% confidence | ${target.detectionCount} found
          </div>
        </div>
        <div class="custom-target-actions">
          <button class="edit"
                  onclick="editCustomTarget('${target.id}')"
                  title="Edit">
            ✏️
          </button>
          <button class="toggle ${target.enabled ? 'enabled' : ''}"
                  onclick="toggleCustomTarget('${target.id}')"
                  title="${target.enabled ? 'Disable' : 'Enable'}">
            ${target.enabled ? '✓' : '○'}
          </button>
          <button class="delete"
                  onclick="deleteCustomTarget('${target.id}')"
                  title="Delete">
            🗑️
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function saveCustomTargets() {
  localStorage.setItem(STORAGE_KEYS.customTargets, JSON.stringify(state.customTargets));
}

function updateCustomDetectionCount() {
  const customTarget = document.querySelector('.detection-target[data-target="custom"]');
  if (customTarget) {
    const enabledCount = state.customTargets.filter(t => t.enabled).length;
    const countEl = customTarget.querySelector('.count');
    if (countEl) {
      countEl.textContent = enabledCount > 0 ? `${enabledCount} active` : 'Configure';
    }

    // Toggle active state based on whether any custom targets are enabled
    customTarget.classList.toggle('active', enabledCount > 0);
  }
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
        <div style="font-weight: 500; margin-bottom: 8px;">No detections recorded</div>
        <div style="font-size: 0.85em; color: #888; line-height: 1.5;">
          Detection targets are highlighted when found during patrol.<br>
          Select targets above and start a patrol to begin.
        </div>
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

function centerOnMyLocation() {
  if (!navigator.geolocation) {
    addLog('Geolocation not supported by your browser');
    return;
  }

  addLog('Getting your location...');
  const btn = document.querySelector('[onclick="centerOnMyLocation()"]');
  if (btn) btn.classList.add('loading');

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const { latitude, longitude } = position.coords;
      state.map.setView([latitude, longitude], 18);
      addLog(`Centered on your location: ${latitude.toFixed(6)}, ${longitude.toFixed(6)}`);
      if (btn) btn.classList.remove('loading');
    },
    (error) => {
      let msg = 'Could not get your location';
      if (error.code === 1) msg = 'Location permission denied';
      else if (error.code === 2) msg = 'Location unavailable';
      else if (error.code === 3) msg = 'Location request timed out';
      addLog(msg);
      if (btn) btn.classList.remove('loading');
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

function cancelDrawing() {
  if (state.currentDrawHandler) {
    state.currentDrawHandler.disable();
    state.currentDrawHandler = null;
  }
  if (state.firstVertexMarker) {
    state.map.removeLayer(state.firstVertexMarker);
    state.firstVertexMarker = null;
  }
  state.currentDrawType = null;
  state.map.doubleClickZoom.enable();
  updateDrawingUI(false);
  addLog('Drawing cancelled');
}

function updateDrawingUI(isDrawing) {
  const cancelBtn = document.getElementById('cancelDrawingBtn');
  if (cancelBtn) {
    cancelBtn.style.display = isDrawing ? 'flex' : 'none';
  }
}

function setHomePosition() {
  // Use center of current map view (more intuitive for setting home manually)
  const center = state.map.getCenter();
  state.homePosition = { lat: center.lat, lng: center.lng };
  console.log('[Patrol] Setting home position:', state.homePosition);
  createHomeMarker(state.homePosition);
  saveToStorage();
  // Verify it was saved
  const saved = localStorage.getItem(STORAGE_KEYS.homePosition);
  console.log('[Patrol] Saved home position to localStorage:', saved);
  addLog(`Home position set: ${center.lat.toFixed(6)}, ${center.lng.toFixed(6)}`);
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

  // Update button state
  updateSatelliteButtonState();

  // Persist preference
  localStorage.setItem(STORAGE_KEYS.satelliteView, state.satelliteView);
}

function updateSatelliteButtonState() {
  const btn = document.querySelector('[onclick="toggleSatellite()"]');
  if (btn) {
    btn.classList.toggle('active', state.satelliteView);
    btn.title = state.satelliteView ? 'Switch to Street View' : 'Switch to Satellite View';
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
  updateCustomDetectionCount();
  renderDetectionLog();
  updatePatrolUI();
  updateSatelliteButtonState();
}

function addLog(message) {
  console.log(`[Patrol] ${message}`);

  // Show toast notification
  showToast(message);
}

function showToast(message, duration = 4000) {
  // Create or get toast container
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.style.cssText = 'position: fixed; bottom: 80px; right: 20px; z-index: 2000; display: flex; flex-direction: column; gap: 8px; max-width: 350px;';
    document.body.appendChild(container);
  }

  // Create toast element
  const toast = document.createElement('div');
  toast.style.cssText = 'background: rgba(22, 33, 62, 0.95); color: #e0e0e0; padding: 12px 16px; border-radius: 8px; font-size: 0.9em; box-shadow: 0 4px 12px rgba(0,0,0,0.3); border-left: 3px solid #4fc3f7; animation: slideIn 0.3s ease; display: flex; align-items: center; gap: 10px;';
  toast.innerHTML = `<span style="flex: 1;">${message}</span><button onclick="this.parentElement.remove()" style="background: none; border: none; color: #888; cursor: pointer; font-size: 1.2em; padding: 0; line-height: 1;">&times;</button>`;

  container.appendChild(toast);

  // Auto-remove after duration
  setTimeout(() => {
    toast.style.animation = 'slideOut 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, duration);
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
