(function(){
  // Three.js 3D simulator
  const canvas = document.getElementById('c');
  const renderer = new THREE.WebGLRenderer({canvas, antialias: true});
  renderer.shadowMap.enabled = true;
  const fov = 45;
  const aspect = window.innerWidth / window.innerHeight;
  const near = 0.1;
  const far = 2000;
  const camera = new THREE.PerspectiveCamera(fov, aspect, near, far);

  // Simple camera controls
  let cameraDistance = 300;
  let cameraAngleY = Math.PI;  // Start at back view (180° rotated from front)
  let cameraAngleX = Math.PI / 6;  // Slight downward angle
  let isDragging = false;
  let lastMouseX = 0;
  let lastMouseY = 0;

  function updateCameraPosition() {
    const radius = cameraDistance;
    camera.position.x = radius * Math.sin(cameraAngleY) * Math.cos(cameraAngleX);
    camera.position.y = radius * Math.sin(cameraAngleX);
    camera.position.z = radius * Math.cos(cameraAngleY) * Math.cos(cameraAngleX);
    camera.lookAt(0, 0, 0);
  }

  // Set initial camera position using the angle calculation
  updateCameraPosition();

  canvas.addEventListener('mousedown', (e) => {
    isDragging = true;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
  });

  canvas.addEventListener('mousemove', (e) => {
    if (isDragging) {
      const deltaX = e.clientX - lastMouseX;
      const deltaY = e.clientY - lastMouseY;

      cameraAngleY += deltaX * 0.01;
      cameraAngleX += deltaY * 0.01;

      // Clamp vertical angle
      cameraAngleX = Math.max(0.1, Math.min(Math.PI / 2 - 0.1, cameraAngleX));

      updateCameraPosition();

      lastMouseX = e.clientX;
      lastMouseY = e.clientY;
    }
  });

  canvas.addEventListener('mouseup', () => {
    isDragging = false;
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    cameraDistance += e.deltaY * 0.1;
    cameraDistance = Math.max(100, Math.min(500, cameraDistance));
    updateCameraPosition();
  });

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb);
  scene.fog = new THREE.Fog(0x87ceeb, 500, 1000);
  
  // Lighting
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(200, 200, 200);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.width = 2048;
  dirLight.shadow.mapSize.height = 2048;
  dirLight.shadow.camera.far = 500;
  dirLight.shadow.camera.left = -200;
  dirLight.shadow.camera.right = 200;
  dirLight.shadow.camera.top = 200;
  dirLight.shadow.camera.bottom = -200;
  scene.add(dirLight);
  scene.add(new THREE.AmbientLight(0xaaaaaa, 0.6));
  
  const GROUND_Y = -10;
  // Ground
  const groundGeom = new THREE.PlaneGeometry(800, 600);
  const groundMat = new THREE.MeshStandardMaterial({color: 0x66aa44});
  const ground = new THREE.Mesh(groundGeom, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = GROUND_Y;
  ground.receiveShadow = true;
  scene.add(ground);

  // Grid helper (hidden by default)
  const gridHelper = new THREE.GridHelper(400, 20, 0x444444, 0x222222);
  gridHelper.position.y = -9.5; // Slightly above ground to avoid z-fighting
  gridHelper.visible = false;
  scene.add(gridHelper);
  
  // Hexapod body - ellipsoid (stretched sphere) for realistic proportions
  let defaultBodyY = 80; // Higher off ground for realistic leg extension (adjustable)
  const bodyGeom = new THREE.SphereGeometry(50, 32, 32); // Sphere base
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0x333333,
    metalness: 0.4,
    roughness: 0.6
  });
  const body = new THREE.Mesh(bodyGeom, bodyMat);
  body.scale.set(1.0, 0.3, 1.2); // Ellipsoid: compressed height, stretched length
  body.position.y = defaultBodyY;
  body.castShadow = true;
  body.receiveShadow = true;
  scene.add(body);

  // Leg dimensions loaded from backend API (in mm)
  // Default values used until backend config is fetched
  const DEFAULT_LEG_CONFIG = {
    coxaLength: 15,
    femurLength: 50,
    tibiaLength: 55,
    coxaRadius: 4,
    femurRadius: 4,
    tibiaRadius: 3.5,
    jointRadius: 5,
    footRadius: 4
  };

  // Array of configs, one per leg (all legs share same dimensions from backend)
  let legConfigs = Array(6).fill(null).map(() => ({...DEFAULT_LEG_CONFIG}));

  const NEUTRAL_FOOT_CLEARANCE = 2; // Keep foot a hair above the visual ground

  function computeNeutralAngles(legConfig) {
    const femurLength = legConfig?.femurLength ?? DEFAULT_LEG_CONFIG.femurLength;
    const tibiaLength = legConfig?.tibiaLength ?? DEFAULT_LEG_CONFIG.tibiaLength;

    const desiredFootY = GROUND_Y + NEUTRAL_FOOT_CLEARANCE;
    const targetDrop = Math.max(10, defaultBodyY - desiredFootY);
    const maxReach = Math.max(20, femurLength + tibiaLength - 1);
    const clampedDrop = Math.min(targetDrop, maxReach);

    const cosKnee = (femurLength*femurLength + tibiaLength*tibiaLength - clampedDrop*clampedDrop) / (2 * femurLength * tibiaLength);
    const kneeAngle = Math.PI - Math.acos(Math.max(-1, Math.min(1, cosKnee)));
    const femurAngle = -Math.atan2(tibiaLength * Math.sin(kneeAngle), femurLength + tibiaLength * Math.cos(kneeAngle));

    return { femur: femurAngle, tibia: kneeAngle };
  }

  // Load config from backend API
  async function loadConfigFromBackend() {
    try {
      const response = await fetch('/api/config');
      if (!response.ok) {
        console.warn('Failed to load config from backend, using defaults');
        return;
      }
      const config = await response.json();

      // Map backend config keys to frontend leg config
      const backendConfig = {
        coxaLength: config.leg_coxa_length || DEFAULT_LEG_CONFIG.coxaLength,
        femurLength: config.leg_femur_length || DEFAULT_LEG_CONFIG.femurLength,
        tibiaLength: config.leg_tibia_length || DEFAULT_LEG_CONFIG.tibiaLength,
        coxaRadius: config.viz_coxa_radius || DEFAULT_LEG_CONFIG.coxaRadius,
        femurRadius: config.viz_femur_radius || DEFAULT_LEG_CONFIG.femurRadius,
        tibiaRadius: config.viz_tibia_radius || DEFAULT_LEG_CONFIG.tibiaRadius,
        jointRadius: config.viz_joint_radius || DEFAULT_LEG_CONFIG.jointRadius,
        footRadius: config.viz_foot_radius || DEFAULT_LEG_CONFIG.footRadius
      };

      // Apply to all legs
      legConfigs = Array(6).fill(null).map(() => ({...backendConfig}));
      console.log('Loaded leg config from backend:', backendConfig);

      // Rebuild all legs with new dimensions
      if (typeof rebuildAllLegs === 'function') {
        rebuildAllLegs();
        applyNeutralPose();
      }
    } catch(e) {
      console.error('Failed to load config from backend:', e);
    }
  }

  // Save config to backend API
  async function saveConfigToBackend(updates) {
    try {
      const response = await fetch('/api/config', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(updates)
      });
      if (!response.ok) {
        console.error('Failed to save config to backend');
      }
    } catch(e) {
      console.error('Failed to save config to backend:', e);
    }
  }

  // Load config from backend on startup (called after WebSocket connects)
  // Initial load happens after page load

  // Frontend no longer calculates IK - all leg angles come from backend telemetry
  // This ensures the visualization accurately mirrors the real hexapod state

  // Leg objects: store references for animation with proper hierarchy
  const legs = [];
  // Position legs closer to body surface (ellipsoid with radii: x=50, z=60)
  // Each position is calculated to be at or near the body surface
  const legPositions = [
    [40, 35],    // leg 0: front-right (at body surface)
    [0, 50],     // leg 1: mid-right (at body surface)
    [-40, 35],   // leg 2: rear-right (at body surface)
    [-40, -35],  // leg 3: rear-left (at body surface)
    [0, -50],    // leg 4: mid-left (at body surface)
    [40, -35],   // leg 5: front-left (at body surface)
  ];

  // Interpolation targets for smooth animation
  const legTargets = [];

  // Track manual control for each leg (timestamp of last manual adjustment)
  const manualControlTimestamps = Array(6).fill(-Infinity);
  const MANUAL_CONTROL_TIMEOUT = 5000; // 5 seconds in milliseconds

  for(let i = 0; i < 6; i++){
    const legGroup = new THREE.Group();

    // Determine if this is a right-side leg (positive Z) or left-side leg (negative Z)
    const isRightSide = legPositions[i][1] > 0;

    // Use this leg's specific config
    const legConfig = legConfigs[i];
    const neutralAngles = computeNeutralAngles(legConfig);

    // Coxa joint and segment (base rotation)
    const coxaJoint = new THREE.Group();
    const coxaGeom = new THREE.CapsuleGeometry(legConfig.coxaRadius, legConfig.coxaLength, 4, 8);
    const coxaMat = new THREE.MeshStandardMaterial({
      color: 0xaa6633,
      metalness: 0.4,
      roughness: 0.6
    });
    const coxaMesh = new THREE.Mesh(coxaGeom, coxaMat);
    // Orient coxa to point outward from body (along local Z after leg group rotation)
    coxaMesh.rotation.x = Math.PI / 2;
    // Position coxa to start at origin (attach to body) and extend outward
    coxaMesh.position.z = legConfig.coxaLength / 2;
    coxaMesh.castShadow = true;
    coxaMesh.receiveShadow = true;
    coxaJoint.add(coxaMesh);

    // Joint sphere at coxa end
    const coxaJointSphere = new THREE.Mesh(
      new THREE.SphereGeometry(legConfig.jointRadius, 8, 8),
      new THREE.MeshStandardMaterial({color: 0x666666, metalness: 0.6, roughness: 0.4})
    );
    coxaJointSphere.position.z = legConfig.coxaLength;
    coxaJointSphere.castShadow = true;
    coxaJoint.add(coxaJointSphere);

    // Femur joint and segment (attach to end of coxa)
    const femurJoint = new THREE.Group();
    femurJoint.position.z = legConfig.coxaLength; // Position at end of coxa (Z direction now)

    const femurGeom = new THREE.CapsuleGeometry(legConfig.femurRadius, legConfig.femurLength, 4, 8);
    const femurMat = new THREE.MeshStandardMaterial({
      color: 0xbb88ff,
      metalness: 0.3,
      roughness: 0.7
    });
    const femurMesh = new THREE.Mesh(femurGeom, femurMat);
    femurMesh.position.y = -legConfig.femurLength / 2;
    femurMesh.castShadow = true;
    femurMesh.receiveShadow = true;
    femurJoint.add(femurMesh);

    // Joint sphere at femur end
    const femurJointSphere = new THREE.Mesh(
      new THREE.SphereGeometry(legConfig.jointRadius, 8, 8),
      new THREE.MeshStandardMaterial({color: 0x666666, metalness: 0.6, roughness: 0.4})
    );
    femurJointSphere.position.y = -legConfig.femurLength;
    femurJointSphere.castShadow = true;
    femurJoint.add(femurJointSphere);

    // Tibia joint and segment (attach to end of femur)
    const tibiaJoint = new THREE.Group();
    tibiaJoint.position.y = -legConfig.femurLength; // Position at end of femur

    const tibiaGeom = new THREE.CapsuleGeometry(legConfig.tibiaRadius, legConfig.tibiaLength, 4, 8);
    const tibiaMat = new THREE.MeshStandardMaterial({
      color: 0x44dd88,
      metalness: 0.3,
      roughness: 0.7
    });
    const tibiaMesh = new THREE.Mesh(tibiaGeom, tibiaMat);
    tibiaMesh.position.y = -legConfig.tibiaLength / 2;
    tibiaMesh.castShadow = true;
    tibiaMesh.receiveShadow = true;
    tibiaJoint.add(tibiaMesh);

    // Foot tip
    const footGeom = new THREE.SphereGeometry(legConfig.footRadius, 8, 8);
    const footMat = new THREE.MeshStandardMaterial({
      color: 0x333333,
      metalness: 0.8,
      roughness: 0.3
    });
    const footMesh = new THREE.Mesh(footGeom, footMat);
    footMesh.position.y = -legConfig.tibiaLength;
    footMesh.castShadow = true;
    tibiaJoint.add(footMesh);

    // Set a neutral, ground-touching pose before telemetry arrives
    femurJoint.rotation.x = neutralAngles.femur;
    tibiaJoint.rotation.x = neutralAngles.tibia;

    // Build hierarchy: tibia -> femur -> coxa -> leg group
    femurJoint.add(tibiaJoint);
    coxaJoint.add(femurJoint);
    legGroup.add(coxaJoint);

    // Position leg around body
    legGroup.position.x = legPositions[i][0];
    legGroup.position.z = legPositions[i][1];
    legGroup.position.y = defaultBodyY;

    // Orient leg to point outward from body center
    // Calculate angle from body center to leg position
    // Use PI/2 - angle so that local +Z points radially (rotation.x bends in radial plane)
    let angle = Math.atan2(legPositions[i][1], legPositions[i][0]);
    legGroup.rotation.y = Math.PI / 2 - angle;

    // Keep femur/tibia bending in vertical plane (no outward tilt)
    // The legs already point outward due to legGroup.rotation.y
    femurJoint.rotation.z = 0;

    scene.add(legGroup);
    legs.push({
      group: legGroup,
      coxaJoint: coxaJoint,
      femurJoint: femurJoint,
      tibiaJoint: tibiaJoint,
      isRightSide: isRightSide
    });

      // Initialize interpolation targets to a neutral, ground-touching position
      // Backend telemetry will immediately provide correct IK values
      // Smoothing will transition from this safe position to actual pose
    legTargets.push({
      coxa: 0,      // Neutral (pointing straight out)
      femur: neutralAngles.femur,
      tibia: neutralAngles.tibia
    });

  }

  // UI controls
  const runBtn = document.getElementById('run');
  const gaitSelect = document.getElementById('gait');
  const speedSlider = document.getElementById('speedSlider');
  const log = document.getElementById('log');

  // Movement state
  let walking = false;
  let currentSpeed = 0.5;    // 0-1
  let currentHeading = 0;    // 0-360 degrees
  let keysPressed = {};

  // Joystick controls
  const joystickCanvas = document.getElementById('joystick');
  const joystickCtx = joystickCanvas.getContext('2d');
  let joystickActive = false;
  let joystickX = 0;
  let joystickY = 0;

  function drawJoystick() {
    const centerX = joystickCanvas.width / 2;
    const centerY = joystickCanvas.height / 2;
    const radius = 25;

    joystickCtx.clearRect(0, 0, joystickCanvas.width, joystickCanvas.height);

    // Draw outer circle
    joystickCtx.strokeStyle = '#666';
    joystickCtx.lineWidth = 2;
    joystickCtx.beginPath();
    joystickCtx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    joystickCtx.stroke();

    // Draw center crosshair
    joystickCtx.strokeStyle = '#444';
    joystickCtx.lineWidth = 1;
    joystickCtx.beginPath();
    joystickCtx.moveTo(centerX - 5, centerY);
    joystickCtx.lineTo(centerX + 5, centerY);
    joystickCtx.moveTo(centerX, centerY - 5);
    joystickCtx.lineTo(centerX, centerY + 5);
    joystickCtx.stroke();

    // Draw stick position
    const stickX = centerX + joystickX * radius;
    const stickY = centerY - joystickY * radius; // Invert Y for canvas

    joystickCtx.fillStyle = joystickActive ? '#0099ff' : '#888';
    joystickCtx.beginPath();
    joystickCtx.arc(stickX, stickY, 8, 0, Math.PI * 2);
    joystickCtx.fill();
  }

  function handleJoystickInput(x, y) {
    joystickX = x;
    joystickY = y;

    const maxSpeed = parseFloat(speedSlider.value) / 100;
    const distance = Math.sqrt(x*x + y*y);

    if (distance > 0.1) {
      currentSpeed = Math.min(distance, 1.0) * maxSpeed;
      currentHeading = Math.atan2(x, y) * 180 / Math.PI;

      if (!walking) {
        walking = true;
        runBtn.textContent = 'Stop Walking';
        runBtn.style.background = '#ff6b6b';
      }
    } else {
      currentSpeed = 0;
      joystickX = 0;
      joystickY = 0;

      if (walking) {
        walking = false;
        runBtn.textContent = 'Start Walking';
        runBtn.style.background = '#51cf66';
      }
    }

    updateUI();
    sendMovement();
    drawJoystick();
  }

  // Joystick event handlers
  joystickCanvas.addEventListener('mousedown', (e) => {
    joystickActive = true;
  });

  joystickCanvas.addEventListener('mousemove', (e) => {
    if (joystickActive) {
      const rect = joystickCanvas.getBoundingClientRect();
      const centerX = joystickCanvas.width / 2;
      const centerY = joystickCanvas.height / 2;
      const x = ((e.clientX - rect.left) - centerX) / 25;
      const y = -((e.clientY - rect.top) - centerY) / 25;

      // Clamp to unit circle
      const dist = Math.sqrt(x*x + y*y);
      if (dist > 1) {
        handleJoystickInput(x / dist, y / dist);
      } else {
        handleJoystickInput(x, y);
      }
    }
  });

  joystickCanvas.addEventListener('mouseup', () => {
    joystickActive = false;
    handleJoystickInput(0, 0);
  });

  joystickCanvas.addEventListener('mouseleave', () => {
    if (joystickActive) {
      joystickActive = false;
      handleJoystickInput(0, 0);
    }
  });

  // Touch support for joystick
  joystickCanvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    joystickActive = true;
  });

  joystickCanvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (joystickActive && e.touches.length > 0) {
      const rect = joystickCanvas.getBoundingClientRect();
      const centerX = joystickCanvas.width / 2;
      const centerY = joystickCanvas.height / 2;
      const touch = e.touches[0];
      const x = ((touch.clientX - rect.left) - centerX) / 25;
      const y = -((touch.clientY - rect.top) - centerY) / 25;

      const dist = Math.sqrt(x*x + y*y);
      if (dist > 1) {
        handleJoystickInput(x / dist, y / dist);
      } else {
        handleJoystickInput(x, y);
      }
    }
  });

  joystickCanvas.addEventListener('touchend', (e) => {
    e.preventDefault();
    joystickActive = false;
    handleJoystickInput(0, 0);
  });

  // Initial joystick draw
  drawJoystick();

  function logMsg(msg){
    const timestamp = new Date().toLocaleTimeString();
    log.textContent = `[${timestamp}] ${msg}\n` + log.textContent;
    if(log.textContent.split('\n').length > 10){
      log.textContent = log.textContent.split('\n').slice(0,10).join('\n');
    }
  }

  // WebSocket connection with auto-reconnection
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = protocol + '//' + location.host + '/ws';
  let ws = null;
  let reconnectAttempts = 0;
  const maxReconnectAttempts = 10;
  const reconnectDelay = 2000; // 2 seconds

  function connectWebSocket() {
    if (ws && ws.readyState === WebSocket.OPEN) return;

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      logMsg('Connected to hexapod controller');
      document.getElementById('connectionStatus').textContent = 'Connected';
      document.getElementById('connectionStatus').style.color = '#51cf66';
      reconnectAttempts = 0;
      // Load configuration from backend API
      loadConfigFromBackend();
      // Load gait parameters from backend
      if (typeof loadGaitParams === 'function') {
        loadGaitParams();
      }
    };

    ws.onmessage = (ev) => {
      try {
        const m = JSON.parse(ev.data);
        if (m.type === 'telemetry') {
          // Update target angles for smooth interpolation
          // Backend sends angles for both walking AND standing (body height IK)
          const angles = m.angles;
          if (angles && angles.length === 6) {
            for (let i = 0; i < 6; i++) {
              const [c, f, t] = angles[i];
              // Convert servo angles (0-180°) to radians centered at 90°
              // Coxa: direct conversion for yaw rotation
              legTargets[i].coxa = (c - 90) * Math.PI / 180;

              // Femur and tibia: LEFT and RIGHT legs need OPPOSITE rotations
              // because legGroup.rotation.y flips the X axis for left vs right sides!
              // Right side (positive Z): use angles as-is
              // Left side (negative Z): negate femur/tibia angles
              const isRightSide = legs[i].isRightSide;
              const sign = isRightSide ? 1 : -1;
              legTargets[i].femur = sign * (f - 90) * Math.PI / 180;
              legTargets[i].tibia = sign * (t - 90) * Math.PI / 180;
            }
          }
          // Update walking state for body animation
          walking = m.running || false;

          // Update status display
          if (m.temperature_c !== undefined) {
            document.getElementById('temp').textContent = m.temperature_c.toFixed(1) + ' °C';
          }
          if (m.battery_v !== undefined) {
            document.getElementById('batt').textContent = m.battery_v.toFixed(2) + ' V';
          }
        }
      } catch (e) {
        console.error('Telemetry parse error:', e);
      }
    };

    ws.onerror = () => {
      document.getElementById('connectionStatus').textContent = 'Error';
      document.getElementById('connectionStatus').style.color = '#ff6b6b';
    };

    ws.onclose = () => {
      document.getElementById('connectionStatus').textContent = 'Disconnected';
      document.getElementById('connectionStatus').style.color = '#ff6b6b';

      // Auto-reconnect with exponential backoff
      if (reconnectAttempts < maxReconnectAttempts) {
        reconnectAttempts++;
        const delay = reconnectDelay * Math.min(reconnectAttempts, 5);
        logMsg(`Connection lost. Reconnecting in ${delay/1000}s... (attempt ${reconnectAttempts})`);
        document.getElementById('connectionStatus').textContent = `Reconnecting (${reconnectAttempts})...`;
        document.getElementById('connectionStatus').style.color = '#ffa500';
        setTimeout(connectWebSocket, delay);
      } else {
        logMsg('Max reconnection attempts reached. Click to retry.');
        document.getElementById('connectionStatus').textContent = 'Click to reconnect';
        document.getElementById('connectionStatus').style.cursor = 'pointer';
        document.getElementById('connectionStatus').onclick = () => {
          reconnectAttempts = 0;
          connectWebSocket();
        };
      }
    };
  }

  // Initial connection
  connectWebSocket();

  // Send movement command to server
  function sendMovement(){
    if(!ws || ws.readyState !== WebSocket.OPEN) return;

    // Send both move and walk messages to ensure backend stays in sync
    ws.send(JSON.stringify({
      type: 'walk',
      walking: walking
    }));

    ws.send(JSON.stringify({
      type: 'move',
      speed: currentSpeed,
      heading: currentHeading,
      walking: walking
    }));
  }

  // Update current heading based on keys pressed
  function updateHeading(){
    let dx = 0, dy = 0;

    if(keysPressed['ArrowUp'] || keysPressed['w'] || keysPressed['W']) dy += 1;
    if(keysPressed['ArrowDown'] || keysPressed['s'] || keysPressed['S']) dy -= 1;
    if(keysPressed['ArrowLeft'] || keysPressed['a'] || keysPressed['A']) dx -= 1;
    if(keysPressed['ArrowRight'] || keysPressed['d'] || keysPressed['D']) dx += 1;

    if(dx === 0 && dy === 0){
      currentSpeed = 0;
      // Auto-stop when no keys pressed
      if(walking){
        walking = false;
        runBtn.textContent = 'Start Walking';
        runBtn.style.background = '#51cf66';
      }
    } else {
      // Calculate heading (in degrees, 0 = forward)
      currentHeading = Math.atan2(dx, dy) * 180 / Math.PI;
      // Use max speed from slider (not 100%)
      const maxSpeed = parseFloat(speedSlider.value) / 100;
      const direction = Math.sqrt(dx*dx + dy*dy);
      currentSpeed = Math.min(direction, 1.0) * maxSpeed;
      // Auto-start walking when keys pressed
      if(!walking){
        walking = true;
        runBtn.textContent = 'Stop Walking';
        runBtn.style.background = '#ff6b6b';
      }
    }

    updateUI();
    sendMovement();
  }

  // UI update helper
  function updateUI(){
    document.getElementById('dirValue').textContent = currentHeading.toFixed(0) + '°';
    document.getElementById('spdValue').textContent = (currentSpeed * 100).toFixed(0) + '%';
  }

  // Control button handlers
  document.getElementById('btn-up').addEventListener('mousedown', () => {
    keysPressed['ArrowUp'] = true;
    updateHeading();
  });
  document.getElementById('btn-up').addEventListener('mouseup', () => {
    keysPressed['ArrowUp'] = false;
    updateHeading();
  });
  
  document.getElementById('btn-down').addEventListener('mousedown', () => {
    keysPressed['ArrowDown'] = true;
    updateHeading();
  });
  document.getElementById('btn-down').addEventListener('mouseup', () => {
    keysPressed['ArrowDown'] = false;
    updateHeading();
  });
  
  document.getElementById('btn-left').addEventListener('mousedown', () => {
    keysPressed['ArrowLeft'] = true;
    updateHeading();
  });
  document.getElementById('btn-left').addEventListener('mouseup', () => {
    keysPressed['ArrowLeft'] = false;
    updateHeading();
  });
  
  document.getElementById('btn-right').addEventListener('mousedown', () => {
    keysPressed['ArrowRight'] = true;
    updateHeading();
  });
  document.getElementById('btn-right').addEventListener('mouseup', () => {
    keysPressed['ArrowRight'] = false;
    updateHeading();
  });

  // Keyboard support
  document.addEventListener('keydown', (e) => {
    if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','w','W','a','A','s','S','d','D'].includes(e.key)){
      keysPressed[e.key] = true;
      updateHeading();
    }
  });
  
  document.addEventListener('keyup', (e) => {
    if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','w','W','a','A','s','S','d','D'].includes(e.key)){
      keysPressed[e.key] = false;
      updateHeading();
    }
  });

  // Speed slider
  speedSlider.addEventListener('input', (e) => {
    const sliderSpeed = parseFloat(e.target.value) / 100;
    // Only apply slider if no movement keys are pressed
    if(currentSpeed === 0){
      currentSpeed = sliderSpeed;
      document.getElementById('speedValue').textContent = e.target.value + '%';
      updateUI();
      sendMovement();
    }
  });

  // Body height slider - send to backend (Python calculates IK)
  const bodyHeightSlider = document.getElementById('bodyHeightSlider');
  bodyHeightSlider.addEventListener('input', (e) => {
    const height = parseFloat(e.target.value);
    defaultBodyY = height;
    document.getElementById('bodyHeightValue').textContent = height + 'mm';

    // Update body visual position
    body.position.y = height;

    // Update all leg visual positions
    legs.forEach((leg, i) => {
      leg.group.position.y = height;
    });

    applyNeutralPose();

    // Send body height to backend via WebSocket
    // Backend will calculate IK and send angles back via telemetry
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'body_height',
        height: height
      }));
    }
  });

  // Start/Stop button
  runBtn.addEventListener('click', () => {
    walking = !walking;
    runBtn.textContent = walking ? 'Stop Walking' : 'Start Walking';
    runBtn.style.background = walking ? '#ff6b6b' : '#51cf66';

    // If starting to walk with no movement keys pressed, use slider speed
    if(walking && currentSpeed === 0){
      currentSpeed = parseFloat(speedSlider.value) / 100;
    }

    if(ws && ws.readyState === WebSocket.OPEN){
      ws.send(JSON.stringify({
        type: 'walk',
        walking: walking
      }));
    }

    logMsg(walking ? 'Walking started' : 'Walking stopped');
    sendMovement();
  });

  // Gait selection
  gaitSelect.addEventListener('change', (ev) => {
    const mode = ev.target.value;
    if(ws && ws.readyState === WebSocket.OPEN){
      ws.send(JSON.stringify({type: 'set_gait', mode}));
    }
    logMsg(`Gait mode: ${mode}`);
  });

  // Gait parameter sliders
  const stepHeightSlider = document.getElementById('stepHeightSlider');
  const stepLengthSlider = document.getElementById('stepLengthSlider');
  const cycleTimeSlider = document.getElementById('cycleTimeSlider');

  // Update gait parameter via API
  async function updateGaitParam(param, value) {
    try {
      const response = await fetch('/api/gait/params', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({[param]: value})
      });
      if (!response.ok) {
        console.error('Failed to update gait parameter');
      }
    } catch(e) {
      console.error('Error updating gait parameter:', e);
    }
  }

  // Load gait parameters from backend
  async function loadGaitParams() {
    try {
      const response = await fetch('/api/gait/params');
      if (response.ok) {
        const params = await response.json();
        if (params.step_height) {
          stepHeightSlider.value = params.step_height;
          document.getElementById('stepHeightValue').textContent = params.step_height + 'mm';
        }
        if (params.step_length) {
          stepLengthSlider.value = params.step_length;
          document.getElementById('stepLengthValue').textContent = params.step_length + 'mm';
        }
        if (params.cycle_time) {
          cycleTimeSlider.value = params.cycle_time * 100; // Convert to slider value
          document.getElementById('cycleTimeValue').textContent = params.cycle_time.toFixed(1) + 's';
        }
      }
    } catch(e) {
      console.error('Error loading gait parameters:', e);
    }
  }

  stepHeightSlider.addEventListener('input', (e) => {
    const value = parseFloat(e.target.value);
    document.getElementById('stepHeightValue').textContent = value + 'mm';
    updateGaitParam('step_height', value);
  });

  stepLengthSlider.addEventListener('input', (e) => {
    const value = parseFloat(e.target.value);
    document.getElementById('stepLengthValue').textContent = value + 'mm';
    updateGaitParam('step_length', value);
  });

  cycleTimeSlider.addEventListener('input', (e) => {
    const value = parseFloat(e.target.value) / 100; // Convert from slider value to seconds
    document.getElementById('cycleTimeValue').textContent = value.toFixed(1) + 's';
    updateGaitParam('cycle_time', value);
  });

  // Responsive canvas
  function resizeRenderer(){
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if(canvas.width !== w || canvas.height !== h){
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
  }

  // Animation loop with smooth interpolation
  let frameCount = 0;
  let lastFPSUpdate = performance.now();
  let currentFPS = 0;

  function lerpAngle(a, b, t){
    // Handle angle wrapping for smooth interpolation
    let diff = b - a;
    while(diff > Math.PI) diff -= 2 * Math.PI;
    while(diff < -Math.PI) diff += 2 * Math.PI;
    return a + diff * t;
  }

  // Create FPS display element
  const fpsDisplay = document.createElement('div');
  fpsDisplay.style.position = 'fixed';
  fpsDisplay.style.bottom = '10px';
  fpsDisplay.style.left = '10px';
  fpsDisplay.style.color = '#0f0';
  fpsDisplay.style.fontFamily = 'monospace';
  fpsDisplay.style.fontSize = '16px';
  fpsDisplay.style.textShadow = '1px 1px 2px #000';
  fpsDisplay.style.zIndex = '1000';
  fpsDisplay.style.display = 'none';
  fpsDisplay.style.pointerEvents = 'none';
  document.body.appendChild(fpsDisplay);

  function render(time){
    resizeRenderer();

    // FPS calculation
    frameCount++;
    if (time - lastFPSUpdate >= 1000) {
      currentFPS = frameCount;
      frameCount = 0;
      lastFPSUpdate = time;
    }

    // No fallback animation - all movement data comes from backend API
    // If not connected, legs remain in their last known position

    // Smooth interpolation for leg joints
    const smoothing = settingsValues.smoothing; // Use settings value
    for(let i = 0; i < 6; i++){
      const leg = legs[i];
      const target = legTargets[i];

      // Check if this leg is under manual control (within 5 seconds of last manual adjustment)
      const timeSinceManualControl = time - manualControlTimestamps[i];
      const isManuallyControlled = timeSinceManualControl < MANUAL_CONTROL_TIMEOUT;

      // Only apply automatic animation if not manually controlled
      if (!isManuallyControlled) {
        // Interpolate each joint
        // Coxa: Y-axis rotation (horizontal/yaw)
        // Femur & Tibia: X-axis rotation (vertical/pitch)
        const currentCoxa = leg.coxaJoint.rotation.y;
        const currentFemur = leg.femurJoint.rotation.x;
        const currentTibia = leg.tibiaJoint.rotation.x;

        leg.coxaJoint.rotation.y = lerpAngle(currentCoxa, target.coxa, smoothing);
        leg.femurJoint.rotation.x = lerpAngle(currentFemur, target.femur, smoothing);
        leg.tibiaJoint.rotation.x = lerpAngle(currentTibia, target.tibia, smoothing);
      }
      // If manually controlled, the joint rotations are already set by the slider handlers

      // Update ground contact indicator position and visibility
      if (groundContactIndicators[i]) {
        // Calculate foot world position
        const footPos = new THREE.Vector3();
        leg.tibiaJoint.getWorldPosition(footPos);
        footPos.y -= legConfigs[i].tibiaLength;

        // Update indicator position
        groundContactIndicators[i].position.x = footPos.x;
        groundContactIndicators[i].position.z = footPos.z;

        // Show indicator when foot is near or on ground OR in the air
        const isOnGround = footPos.y < 5;
        groundContactIndicators[i].visible = settingsValues.showGroundContact;

        // Change color: ORANGE when in air, green when on ground
        if (isOnGround) {
          const contactStrength = Math.max(0, 1 - footPos.y / 5);
          groundContactIndicators[i].material.color.setRGB(
            1 - contactStrength,
            contactStrength,
            0
          );
        } else {
          // ORANGE when foot is lifted (in the air)
          groundContactIndicators[i].material.color.setRGB(1.0, 0.6, 0.0);
        }
      }
    }

    // Keep body stable - no bobbing to avoid disturbing movement
    body.position.y = defaultBodyY;
    body.rotation.x = 0;
    body.rotation.z = 0;

    // Update webcam overlay texture if active
    if (webcamOverlay && webcamOverlay.visible) {
      webcamOverlay.material.map.needsUpdate = true;
    }

    renderer.render(scene, camera);

    // Display FPS if enabled (after rendering to avoid interfering with WebGL)
    if (settingsValues.showFPS) {
      fpsDisplay.style.display = 'block';
      fpsDisplay.textContent = `FPS: ${currentFPS}`;
    } else {
      fpsDisplay.style.display = 'none';
    }

    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);

  logMsg('Hexapod simulator loaded - connecting to backend...');

  // ========== Settings Panel ==========

  const gearBtn = document.getElementById('gearBtn');
  const settingsPanel = document.getElementById('settingsPanel');
  const legConfigContainer = document.getElementById('legConfigContainer');

  // Mini preview scenes for each leg
  const legPreviews = [];

  // Ground contact indicators for each leg
  const groundContactIndicators = [];

  // Settings values
  let settingsValues = {
    smoothing: 0.2,
    showGroundContact: true,
    showShadows: true,
    showFPS: false
  };

  // Toggle settings panel
  gearBtn.addEventListener('click', () => {
    settingsPanel.classList.toggle('open');
    if (settingsPanel.classList.contains('open')) {
      // Initialize previews when opening
      initializeLegPreviews();
    }
  });

  // Close button handler
  const settingsClose = document.getElementById('settingsClose');
  if (settingsClose) {
    settingsClose.addEventListener('click', () => {
      settingsPanel.classList.remove('open');
    });
  }

  // Close panel when clicking outside
  document.addEventListener('click', (e) => {
    if (!settingsPanel.contains(e.target) && !gearBtn.contains(e.target)) {
      settingsPanel.classList.remove('open');
    }
  });

  // Tab switching
  document.querySelectorAll('.settings-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const targetTab = tab.dataset.tab;

      // Update active tab
      document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      // Update active content
      document.querySelectorAll('.settings-content').forEach(c => c.classList.remove('active'));
      document.getElementById(`tab-${targetTab}`).classList.add('active');
    });
  });

  // Initialize leg configuration UI
  function initializeConfigUI() {
    const legNames = ['Front Right', 'Mid Right', 'Rear Right', 'Rear Left', 'Mid Left', 'Front Left'];

    // Create a layout with body in center and legs in 2 columns
    legConfigContainer.innerHTML = `
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 15px;">
        <div id="leftLegs" style="text-align: center;">
          <div style="background: #555; padding: 8px; border-radius: 4px; margin-bottom: 10px; font-weight: bold;">LEFT SIDE</div>
        </div>
        <div id="rightLegs" style="text-align: center;">
          <div style="background: #555; padding: 8px; border-radius: 4px; margin-bottom: 10px; font-weight: bold;">RIGHT SIDE</div>
        </div>
      </div>
      <div style="text-align: center; background: #444; padding: 15px; border-radius: 8px; margin: 10px 0; font-weight: bold; font-size: 16px;">
        HEXAPOD BODY
      </div>
    `;

    const leftLegsContainer = document.getElementById('leftLegs');
    const rightLegsContainer = document.getElementById('rightLegs');

    // Left side legs: 5, 4, 3 (Front Left, Mid Left, Rear Left)
    // Right side legs: 0, 1, 2 (Front Right, Mid Right, Rear Right)
    const leftLegs = [5, 4, 3];
    const rightLegs = [0, 1, 2];

    const createLegItem = (name, index) => {
      const item = document.createElement('div');
      item.className = 'leg-config-item';
      item.innerHTML = `
        <div class="leg-config-header">
          <span>${name} (Leg ${index})</span>
          <button class="leg-reset-btn" id="resetLeg${index}">Reset</button>
        </div>
        <canvas class="leg-preview" id="legPreview${index}"></canvas>
        <div class="config-row">
          <span>Coxa Length:</span>
          <input type="number" class="config-input" id="coxa${index}" value="${legConfigs[index].coxaLength}" min="5" max="50" step="1">
          <span>mm</span>
        </div>
        <div class="config-row">
          <span>Femur Length:</span>
          <input type="number" class="config-input" id="femur${index}" value="${legConfigs[index].femurLength}" min="20" max="100" step="1">
          <span>mm</span>
        </div>
        <div class="config-row">
          <span>Tibia Length:</span>
          <input type="number" class="config-input" id="tibia${index}" value="${legConfigs[index].tibiaLength}" min="20" max="100" step="1">
          <span>mm</span>
        </div>
        <div class="config-row" style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #666;">
          <span style="font-weight: bold;">Manual Angles:</span>
        </div>
        <div class="config-row">
          <span>Coxa:</span>
          <input type="range" class="config-input" id="coxaAngle${index}" min="-90" max="90" value="0" step="1" style="width: 100px;">
          <span id="coxaAngleValue${index}">0°</span>
        </div>
        <div class="config-row">
          <span>Femur:</span>
          <input type="range" class="config-input" id="femurAngle${index}" min="-90" max="90" value="0" step="1" style="width: 100px;">
          <span id="femurAngleValue${index}">0°</span>
        </div>
        <div class="config-row">
          <span>Tibia:</span>
          <input type="range" class="config-input" id="tibiaAngle${index}" min="-90" max="90" value="0" step="1" style="width: 100px;">
          <span id="tibiaAngleValue${index}">0°</span>
        </div>
      `;
      return item;
    };

    // Add left side legs
    leftLegs.forEach(index => {
      const item = createLegItem(legNames[index], index);
      leftLegsContainer.appendChild(item);
    });

    // Add right side legs
    rightLegs.forEach(index => {
      const item = createLegItem(legNames[index], index);
      rightLegsContainer.appendChild(item);
    });

    // Now add all the event listeners for all legs
    for (let index = 0; index < 6; index++) {
      // Add input listeners for leg dimensions
      ['coxa', 'femur', 'tibia'].forEach(part => {
        const input = document.getElementById(`${part}${index}`);
        if (input) {
          input.addEventListener('input', (e) => {
            updateLegConfig(index, part, parseFloat(e.target.value));
          });
        }
      });

      // Add angle slider listeners
      ['coxaAngle', 'femurAngle', 'tibiaAngle'].forEach(angleType => {
        const input = document.getElementById(`${angleType}${index}`);
        if (input) {
          input.addEventListener('input', (e) => {
            const angle = parseFloat(e.target.value);
            document.getElementById(`${angleType}Value${index}`).textContent = angle + '°';
            // Directly update the leg joint rotation for manual control
            const radians = angle * Math.PI / 180;
            if (angleType === 'coxaAngle') {
              legs[index].coxaJoint.rotation.y = radians;
              legTargets[index].coxa = radians; // Update target to match
            } else if (angleType === 'femurAngle') {
              legs[index].femurJoint.rotation.x = radians;
              legTargets[index].femur = radians; // Update target to match
            } else if (angleType === 'tibiaAngle') {
              legs[index].tibiaJoint.rotation.x = radians;
              legTargets[index].tibia = radians; // Update target to match
            }
            // Mark this leg as manually controlled and set timestamp
            manualControlTimestamps[index] = performance.now();
          });
        }
      });

      // Individual leg reset button (resets all legs since backend config is uniform)
      const resetBtn = document.getElementById(`resetLeg${index}`);
      if (resetBtn) {
        resetBtn.addEventListener('click', () => {
          resetAllLegsToDefaults();
        });
      }

      // Create ground contact indicator for this leg
      const contactIndicator = new THREE.Mesh(
        new THREE.RingGeometry(8, 12, 16),
        new THREE.MeshBasicMaterial({color: 0x00ff00, transparent: true, opacity: 0.6, side: THREE.DoubleSide})
      );
      contactIndicator.rotation.x = -Math.PI / 2;
      contactIndicator.position.y = -9;
      contactIndicator.visible = false;
      scene.add(contactIndicator);
      groundContactIndicators.push(contactIndicator);
    }
  }

  function applyNeutralPose() {
    const now = performance.now();

    for (let i = 0; i < legs.length; i++) {
      const neutralAngles = computeNeutralAngles(legConfigs[i]);
      legTargets[i].coxa = 0;
      legTargets[i].femur = neutralAngles.femur;
      legTargets[i].tibia = neutralAngles.tibia;

      const underManualControl = (now - manualControlTimestamps[i]) < MANUAL_CONTROL_TIMEOUT;
      if (!underManualControl) {
        legs[i].coxaJoint.rotation.y = 0;
        legs[i].femurJoint.rotation.x = neutralAngles.femur;
        legs[i].tibiaJoint.rotation.x = neutralAngles.tibia;
      }
    }
  }

  // Rebuild all legs with current config
  function rebuildAllLegs() {
    for (let i = 0; i < 6; i++) {
      rebuildLeg(i);
      if (legPreviews[i]) {
        updateLegPreview(i);
      }
      // Update UI inputs if they exist
      const coxaInput = document.getElementById(`coxa${i}`);
      const femurInput = document.getElementById(`femur${i}`);
      const tibiaInput = document.getElementById(`tibia${i}`);
      if (coxaInput) coxaInput.value = legConfigs[i].coxaLength;
      if (femurInput) femurInput.value = legConfigs[i].femurLength;
      if (tibiaInput) tibiaInput.value = legConfigs[i].tibiaLength;
    }
  }

  // Update leg configuration - saves to backend (applies to all legs)
  function updateLegConfig(legIndex, part, value) {
    // Backend config applies to all legs uniformly
    // Map part name to backend config key
    let backendKey;
    if (part === 'coxa') {
      backendKey = 'leg_coxa_length';
      legConfigs.forEach(cfg => cfg.coxaLength = value);
    } else if (part === 'femur') {
      backendKey = 'leg_femur_length';
      legConfigs.forEach(cfg => cfg.femurLength = value);
    } else if (part === 'tibia') {
      backendKey = 'leg_tibia_length';
      legConfigs.forEach(cfg => cfg.tibiaLength = value);
    }

    // Save to backend API
    if (backendKey) {
      saveConfigToBackend({[backendKey]: value});
    }

    // Rebuild all legs with new dimensions (backend config is uniform)
    rebuildAllLegs();
    applyNeutralPose();

    logMsg(`Updated ${part} length to ${value}mm (all legs)`);
  }

  // Rebuild a specific leg with new dimensions
  function rebuildLeg(legIndex) {
    const oldLeg = legs[legIndex];
    const legPos = legPositions[legIndex];

    // Remove old leg from scene
    scene.remove(oldLeg.group);

    // Create new leg with updated dimensions
    const legGroup = new THREE.Group();
    const isRightSide = legPos[1] > 0;

    // Coxa
    const coxaJoint = new THREE.Group();
    const legCfg = legConfigs[legIndex] || DEFAULT_LEG_CONFIG;
    const coxaGeom = new THREE.CapsuleGeometry(legCfg.coxaRadius, legCfg.coxaLength, 4, 8);
    const coxaMat = new THREE.MeshStandardMaterial({color: 0xaa6633, metalness: 0.4, roughness: 0.6});
    const coxaMesh = new THREE.Mesh(coxaGeom, coxaMat);
    coxaMesh.rotation.x = Math.PI / 2;
    coxaMesh.position.z = legCfg.coxaLength / 2;
    coxaMesh.castShadow = true;
    coxaMesh.receiveShadow = true;
    coxaJoint.add(coxaMesh);

    const coxaJointSphere = new THREE.Mesh(
      new THREE.SphereGeometry(legCfg.jointRadius, 8, 8),
      new THREE.MeshStandardMaterial({color: 0x666666, metalness: 0.6, roughness: 0.4})
    );
    coxaJointSphere.position.z = legCfg.coxaLength;
    coxaJointSphere.castShadow = true;
    coxaJoint.add(coxaJointSphere);

    // Femur
    const femurJoint = new THREE.Group();
    femurJoint.position.z = legCfg.coxaLength;
    const femurGeom = new THREE.CapsuleGeometry(legCfg.femurRadius, legCfg.femurLength, 4, 8);
    const femurMat = new THREE.MeshStandardMaterial({color: 0xbb88ff, metalness: 0.3, roughness: 0.7});
    const femurMesh = new THREE.Mesh(femurGeom, femurMat);
    femurMesh.position.y = -legCfg.femurLength / 2;
    femurMesh.castShadow = true;
    femurMesh.receiveShadow = true;
    femurJoint.add(femurMesh);

    const femurJointSphere = new THREE.Mesh(
      new THREE.SphereGeometry(legCfg.jointRadius, 8, 8),
      new THREE.MeshStandardMaterial({color: 0x666666, metalness: 0.6, roughness: 0.4})
    );
    femurJointSphere.position.y = -legCfg.femurLength;
    femurJointSphere.castShadow = true;
    femurJoint.add(femurJointSphere);

    // Tibia
    const tibiaJoint = new THREE.Group();
    tibiaJoint.position.y = -legCfg.femurLength;
    const tibiaGeom = new THREE.CapsuleGeometry(legCfg.tibiaRadius, legCfg.tibiaLength, 4, 8);
    const tibiaMat = new THREE.MeshStandardMaterial({color: 0x44dd88, metalness: 0.3, roughness: 0.7});
    const tibiaMesh = new THREE.Mesh(tibiaGeom, tibiaMat);
    tibiaMesh.position.y = -legCfg.tibiaLength / 2;
    tibiaMesh.castShadow = true;
    tibiaMesh.receiveShadow = true;
    tibiaJoint.add(tibiaMesh);

    const footGeom = new THREE.SphereGeometry(legCfg.footRadius, 8, 8);
    const footMat = new THREE.MeshStandardMaterial({color: 0x333333, metalness: 0.8, roughness: 0.3});
    const footMesh = new THREE.Mesh(footGeom, footMat);
    footMesh.position.y = -legCfg.tibiaLength;
    footMesh.castShadow = true;
    tibiaJoint.add(footMesh);

    // Build hierarchy
    femurJoint.add(tibiaJoint);
    coxaJoint.add(femurJoint);
    legGroup.add(coxaJoint);

    // Position and orient
    legGroup.position.x = legPos[0];
    legGroup.position.z = legPos[1];
    legGroup.position.y = defaultBodyY;
    let angle = Math.atan2(legPos[1], legPos[0]);
    legGroup.rotation.y = Math.PI / 2 - angle;

    // Keep femur/tibia bending in vertical plane
    femurJoint.rotation.z = 0;

    // Restore rotation state
    coxaJoint.rotation.y = oldLeg.coxaJoint.rotation.y;
    femurJoint.rotation.x = oldLeg.femurJoint.rotation.x;
    tibiaJoint.rotation.x = oldLeg.tibiaJoint.rotation.x;

    scene.add(legGroup);

    // Update legs array
    legs[legIndex] = {
      group: legGroup,
      coxaJoint: coxaJoint,
      femurJoint: femurJoint,
      tibiaJoint: tibiaJoint,
      isRightSide: isRightSide
    };
  }

  // Initialize leg previews
  function initializeLegPreviews() {
    for (let i = 0; i < 6; i++) {
      const canvas = document.getElementById(`legPreview${i}`);
      if (!canvas || legPreviews[i]) continue; // Skip if already initialized

      const previewRenderer = new THREE.WebGLRenderer({canvas, antialias: true});
      const previewScene = new THREE.Scene();
      previewScene.background = new THREE.Color(0x1a1a1a);

      const previewCamera = new THREE.PerspectiveCamera(45, canvas.clientWidth / canvas.clientHeight, 0.1, 500);
      previewCamera.position.set(80, 60, 80);
      previewCamera.lookAt(0, -30, 0);

      // Lighting
      const light = new THREE.DirectionalLight(0xffffff, 0.8);
      light.position.set(50, 50, 50);
      previewScene.add(light);
      previewScene.add(new THREE.AmbientLight(0xaaaaaa, 0.6));

      // Create preview leg
      const previewLeg = createPreviewLeg();
      previewScene.add(previewLeg);

      legPreviews[i] = {
        renderer: previewRenderer,
        scene: previewScene,
        camera: previewCamera,
        leg: previewLeg
      };

      // Initial render
      previewRenderer.setSize(canvas.clientWidth, canvas.clientHeight);
      previewRenderer.render(previewScene, previewCamera);

      // Animate preview
      function animatePreview() {
        if (settingsPanel.classList.contains('open')) {
          previewLeg.rotation.y += 0.01;
          previewRenderer.render(previewScene, previewCamera);
        }
        requestAnimationFrame(animatePreview);
      }
      animatePreview();
    }
  }

  // Create a preview leg
  function createPreviewLeg(legIndex) {
    const legGroup = new THREE.Group();
    const legCfg = legConfigs[legIndex] || DEFAULT_LEG_CONFIG;

    // Coxa
    const coxaJoint = new THREE.Group();
    const coxaMesh = new THREE.Mesh(
      new THREE.CapsuleGeometry(legCfg.coxaRadius, legCfg.coxaLength, 4, 8),
      new THREE.MeshStandardMaterial({color: 0xaa6633, metalness: 0.4, roughness: 0.6})
    );
    coxaMesh.rotation.x = Math.PI / 2;
    coxaMesh.position.z = legCfg.coxaLength / 2;
    coxaJoint.add(coxaMesh);

    // Femur
    const femurJoint = new THREE.Group();
    femurJoint.position.z = legCfg.coxaLength;
    const femurMesh = new THREE.Mesh(
      new THREE.CapsuleGeometry(legCfg.femurRadius, legCfg.femurLength, 4, 8),
      new THREE.MeshStandardMaterial({color: 0xbb88ff, metalness: 0.3, roughness: 0.7})
    );
    femurMesh.position.y = -legCfg.femurLength / 2;
    femurJoint.add(femurMesh);
    femurJoint.rotation.x = -0.5;

    // Tibia
    const tibiaJoint = new THREE.Group();
    tibiaJoint.position.y = -legCfg.femurLength;
    const tibiaMesh = new THREE.Mesh(
      new THREE.CapsuleGeometry(legCfg.tibiaRadius, legCfg.tibiaLength, 4, 8),
      new THREE.MeshStandardMaterial({color: 0x44dd88, metalness: 0.3, roughness: 0.7})
    );
    tibiaMesh.position.y = -legCfg.tibiaLength / 2;
    tibiaJoint.add(tibiaMesh);
    tibiaJoint.rotation.x = 0.8;

    femurJoint.add(tibiaJoint);
    coxaJoint.add(femurJoint);
    legGroup.add(coxaJoint);

    return legGroup;
  }

  // Update leg preview
  function updateLegPreview(legIndex) {
    if (!legPreviews[legIndex]) return;

    const preview = legPreviews[legIndex];
    preview.scene.remove(preview.leg);
    preview.leg = createPreviewLeg(legIndex);
    preview.scene.add(preview.leg);
  }

  // Reset all legs to defaults (backend config is uniform for all legs)
  function resetAllLegsToDefaults() {
    legConfigs = Array(6).fill(null).map(() => ({...DEFAULT_LEG_CONFIG}));

    // Save defaults to backend
    saveConfigToBackend({
      leg_coxa_length: DEFAULT_LEG_CONFIG.coxaLength,
      leg_femur_length: DEFAULT_LEG_CONFIG.femurLength,
      leg_tibia_length: DEFAULT_LEG_CONFIG.tibiaLength
    });

    rebuildAllLegs();
    applyNeutralPose();
    logMsg('All legs reset to defaults');
  }

  // Reset all legs
  document.getElementById('resetAllLegs').addEventListener('click', () => {
    if (confirm('Reset all leg dimensions to default values?')) {
      resetAllLegsToDefaults();
    }
  });

  // ========== Visual Settings ==========

  // Ground contact toggle
  document.getElementById('showGroundContact').addEventListener('change', (e) => {
    settingsValues.showGroundContact = e.target.checked;
  });

  // Shadows toggle
  document.getElementById('showShadows').addEventListener('change', (e) => {
    settingsValues.showShadows = e.target.checked;
    // Toggle shadow casting/receiving on all objects
    body.castShadow = e.target.checked;
    body.receiveShadow = e.target.checked;
    ground.receiveShadow = e.target.checked;
    // Update all leg segments
    legs.forEach(leg => {
      leg.group.traverse(obj => {
        if (obj.isMesh) {
          obj.castShadow = e.target.checked;
          obj.receiveShadow = e.target.checked;
        }
      });
    });
    // Force shadow map update
    renderer.shadowMap.needsUpdate = true;
  });

  // Grid toggle
  document.getElementById('showGrid').addEventListener('change', (e) => {
    gridHelper.visible = e.target.checked;
  });

  // Body color
  document.getElementById('bodyColor').addEventListener('input', (e) => {
    body.material.color.setStyle(e.target.value);
  });

  // Ground color
  document.getElementById('groundColor').addEventListener('input', (e) => {
    ground.material.color.setStyle(e.target.value);
  });

  // Sky color
  document.getElementById('skyColor').addEventListener('input', (e) => {
    scene.background.setStyle(e.target.value);
    scene.fog.color.setStyle(e.target.value);
  });

  // ========== Webcam Settings ==========

  let webcamStream = null;
  let webcamOverlay = null;

  document.getElementById('startWebcam').addEventListener('click', async () => {
    try {
      // Request webcam access
      webcamStream = await navigator.mediaDevices.getUserMedia({
        video: {facingMode: 'user'},
        audio: false
      });

      const videoElement = document.getElementById('webcamFeed');
      if (!videoElement) {
        throw new Error('Video element not found');
      }

      videoElement.srcObject = webcamStream;

      // Wait for video to be ready before playing
      await new Promise((resolve, reject) => {
        videoElement.onloadedmetadata = () => {
          videoElement.play()
            .then(resolve)
            .catch(reject);
        };
        videoElement.onerror = reject;
      });

      document.getElementById('startWebcam').classList.add('active');

      // If overlay checkbox is checked, recreate the overlay with new stream
      if (document.getElementById('overlayWebcam').checked) {
        if (webcamOverlay) {
          // Remove old overlay
          scene.remove(webcamOverlay);
        }

        // Create new overlay with updated video element
        const videoTexture = new THREE.VideoTexture(videoElement);
        const overlayGeom = new THREE.PlaneGeometry(200, 150);
        const sliderVal = parseFloat(document.getElementById('webcamOpacity').value);
        const overlayMat = new THREE.MeshBasicMaterial({
          map: videoTexture,
          transparent: true,
          opacity: 1.0 - (sliderVal / 100), // Inverted: 0% slider = opaque
          side: THREE.DoubleSide
        });
        webcamOverlay = new THREE.Mesh(overlayGeom, overlayMat);
        // Position in front of hexapod in 3D space (positive Z)
        // When viewing from behind (camera at negative Z), overlay appears in background
        webcamOverlay.position.set(0, 80, 150);
        scene.add(webcamOverlay);
        webcamOverlay.visible = true;
      }

      logMsg('Webcam started');
    } catch(err) {
      const errorMsg = err && err.message ? err.message : String(err);
      logMsg('Webcam error: ' + errorMsg);
      console.error('Webcam error:', err);
    }
  });

  document.getElementById('stopWebcam').addEventListener('click', () => {
    if (webcamStream) {
      webcamStream.getTracks().forEach(track => track.stop());
      document.getElementById('webcamFeed').srcObject = null;
      document.getElementById('startWebcam').classList.remove('active');
      if (webcamOverlay) {
        webcamOverlay.visible = false;
      }
      logMsg('Webcam stopped');
    }
  });

  // Webcam overlay toggle
  document.getElementById('overlayWebcam').addEventListener('change', (e) => {
    if (e.target.checked && webcamStream) {
      if (!webcamOverlay || !webcamOverlay.material.map) {
        // Create video texture overlay
        const videoElement = document.getElementById('webcamFeed');
        const videoTexture = new THREE.VideoTexture(videoElement);
        const overlayGeom = new THREE.PlaneGeometry(200, 150);
        const sliderVal = parseFloat(document.getElementById('webcamOpacity').value);
        const overlayMat = new THREE.MeshBasicMaterial({
          map: videoTexture,
          transparent: true,
          opacity: 1.0 - (sliderVal / 100), // Inverted: 0% slider = opaque
          side: THREE.DoubleSide
        });
        webcamOverlay = new THREE.Mesh(overlayGeom, overlayMat);
        // Position in front of hexapod in 3D space (positive Z)
        // When viewing from behind (camera at negative Z), overlay appears in background
        webcamOverlay.position.set(0, 80, 150);
        scene.add(webcamOverlay);
      }
      webcamOverlay.visible = true;
      logMsg('Webcam overlay enabled');
    } else if (webcamOverlay) {
      webcamOverlay.visible = false;
      logMsg('Webcam overlay disabled');
    }
  });

  // Webcam opacity (inverted: 0% = transparent, 100% = opaque)
  document.getElementById('webcamOpacity').addEventListener('input', (e) => {
    const sliderValue = parseFloat(e.target.value);
    const opacity = 1.0 - (sliderValue / 100); // INVERT: 0% slider = 1.0 opacity (opaque), 100% = 0.0 (transparent)
    document.getElementById('webcamOpacityValue').textContent = sliderValue + '%';
    if (webcamOverlay && webcamOverlay.material) {
      webcamOverlay.material.opacity = opacity;
    }
  });

  // ========== Advanced Settings ==========

  // Smoothing
  document.getElementById('smoothing').addEventListener('input', (e) => {
    settingsValues.smoothing = parseFloat(e.target.value) / 100;
    document.getElementById('smoothingValue').textContent = e.target.value + '%';
  });

  // Camera FOV
  document.getElementById('cameraFOV').addEventListener('input', (e) => {
    const fov = parseFloat(e.target.value);
    document.getElementById('cameraFOVValue').textContent = fov + '°';
    camera.fov = fov;
    camera.updateProjectionMatrix();
  });

  // Show FPS
  document.getElementById('showFPS').addEventListener('change', (e) => {
    settingsValues.showFPS = e.target.checked;
  });

  // Reset all settings
  document.getElementById('resetAllSettings').addEventListener('click', () => {
    if (confirm('Reset all settings to defaults?')) {
      // Reset visual settings
      document.getElementById('showGroundContact').checked = true;
      document.getElementById('showShadows').checked = true;
      document.getElementById('bodyColor').value = '#333333';
      document.getElementById('groundColor').value = '#66aa44';
      document.getElementById('skyColor').value = '#87ceeb';
      body.material.color.setStyle('#333333');
      ground.material.color.setStyle('#66aa44');
      scene.background.setStyle('#87ceeb');
      scene.fog.color.setStyle('#87ceeb');

      // Reset advanced settings
      document.getElementById('smoothing').value = 20;
      document.getElementById('cameraFOV').value = 45;
      document.getElementById('showFPS').checked = false;
      settingsValues.smoothing = 0.2;
      settingsValues.showGroundContact = true;
      settingsValues.showShadows = true;
      settingsValues.showFPS = false;
      camera.fov = 45;
      camera.updateProjectionMatrix();

      logMsg('All settings reset to defaults');
    }
  });

  // Initialize config UI
  initializeConfigUI();

  // ========== Calibration Tab ==========

  function initializeCalibrationUI() {
    const container = document.getElementById('calibrationContainer');
    if (!container) return;

    const legNames = ['Front Right', 'Middle Right', 'Rear Right', 'Rear Left', 'Middle Left', 'Front Left'];
    const jointNames = ['Coxa', 'Femur', 'Tibia'];

    legNames.forEach((legName, legIndex) => {
      const legSection = document.createElement('div');
      legSection.style.marginBottom = '20px';
      legSection.style.padding = '10px';
      legSection.style.background = '#1a1a1a';
      legSection.style.borderRadius = '4px';

      const legLabel = document.createElement('div');
      legLabel.textContent = `Leg ${legIndex}: ${legName}`;
      legLabel.style.fontWeight = '600';
      legLabel.style.marginBottom = '10px';
      legLabel.style.color = '#51cf66';
      legSection.appendChild(legLabel);

      jointNames.forEach((jointName, jointIndex) => {
        const jointRow = document.createElement('div');
        jointRow.className = 'config-row';
        jointRow.style.alignItems = 'center';
        jointRow.style.marginBottom = '8px';

        const label = document.createElement('span');
        label.textContent = `${jointName}:`;
        label.style.width = '60px';
        label.style.display = 'inline-block';

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = '-90';
        slider.max = '90';
        slider.value = '0';
        slider.step = '0.5';
        slider.style.width = '150px';
        slider.dataset.leg = legIndex;
        slider.dataset.joint = jointIndex;

        const valueDisplay = document.createElement('span');
        valueDisplay.textContent = '0.0°';
        valueDisplay.style.width = '50px';
        valueDisplay.style.display = 'inline-block';
        valueDisplay.style.textAlign = 'right';

        slider.addEventListener('input', async (e) => {
          const offset = parseFloat(e.target.value);
          valueDisplay.textContent = `${offset.toFixed(1)}°`;

          // Save to backend
          try {
            await fetch('/api/config/servo_offset', {
              method: 'POST',
              headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({
                leg: parseInt(e.target.dataset.leg),
                joint: parseInt(e.target.dataset.joint),
                offset: offset
              })
            });
          } catch (error) {
            console.error('Failed to save servo offset:', error);
          }
        });

        jointRow.appendChild(label);
        jointRow.appendChild(slider);
        jointRow.appendChild(valueDisplay);
        legSection.appendChild(jointRow);
      });

      container.appendChild(legSection);
    });

    // Reset button
    document.getElementById('resetCalibration').addEventListener('click', async () => {
      if (!confirm('Reset all servo offsets to 0?')) return;

      const sliders = container.querySelectorAll('input[type="range"]');
      for (const slider of sliders) {
        slider.value = 0;
        slider.nextElementSibling.textContent = '0.0°';

        await fetch('/api/config/servo_offset', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            leg: parseInt(slider.dataset.leg),
            joint: parseInt(slider.dataset.joint),
            offset: 0
          })
        });
      }

      logMsg('All servo offsets reset to 0');
    });
  }

  initializeCalibrationUI();

  // ========== Bluetooth Tab ==========

  let bluetoothDevices = [];

  document.getElementById('btScan').addEventListener('click', async () => {
    const btn = document.getElementById('btScan');
    const devicesDiv = document.getElementById('btDevices');

    btn.disabled = true;
    btn.textContent = 'Scanning...';
    devicesDiv.innerHTML = '<div style="color: #aaa; padding: 10px; text-align: center;">Scanning for BLE devices...</div>';

    try {
      const response = await fetch('/api/bluetooth/scan');
      const data = await response.json();

      if (data.ok && data.devices) {
        bluetoothDevices = data.devices;
        devicesDiv.innerHTML = '';

        if (data.devices.length === 0) {
          devicesDiv.innerHTML = '<div style="color: #aaa; padding: 10px; text-align: center;">No BLE devices found nearby</div>';
        } else {
          // Display devices as read-only list (no connection buttons)
          data.devices.forEach((device, index) => {
            const deviceItem = document.createElement('div');
            deviceItem.style.padding = '8px';
            deviceItem.style.borderBottom = '1px solid #333';
            deviceItem.style.fontSize = '11px';
            deviceItem.style.color = '#ccc';
            deviceItem.innerHTML = `
              <div style="font-weight: 600; color: #0099ff; margin-bottom: 2px;">${device.name}</div>
              <div style="color: #888; font-size: 10px;">${device.address}</div>
            `;
            devicesDiv.appendChild(deviceItem);
          });
        }

        logMsg(`Found ${data.devices.length} BLE device(s)`);
      } else {
        devicesDiv.innerHTML = `<div style="color: #ff6b6b; padding: 10px; text-align: center;">Error: ${data.error || 'Scan failed'}</div>`;
        logMsg(`BLE scan failed: ${data.error}`);
      }
    } catch (error) {
      devicesDiv.innerHTML = `<div style="color: #ff6b6b; padding: 10px; text-align: center;">Error: ${error.message}</div>`;
      logMsg(`BLE scan error: ${error.message}`);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Scan for BLE Devices';
    }
  });

  // ========== Emergency Stop ==========

  document.getElementById('emergencyStop').addEventListener('click', async () => {
    try {
      await fetch('/api/emergency_stop', { method: 'POST' });
      walking = false;
      runBtn.textContent = 'Start Walking';
      runBtn.style.background = '#51cf66';
      logMsg('EMERGENCY STOP activated!');
    } catch (e) {
      console.error('Emergency stop failed:', e);
    }
  });

  // ========== Camera Presets ==========

  const cameraPresets = {
    front: { angleY: 0, angleX: Math.PI / 12 },
    side: { angleY: Math.PI / 2, angleX: Math.PI / 8 },
    top: { angleY: 0, angleX: Math.PI / 2 - 0.1 },
    iso: { angleY: Math.PI * 0.75, angleX: Math.PI / 6 }
  };

  document.querySelectorAll('.camera-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      const preset = cameraPresets[view];
      if (preset) {
        cameraAngleY = preset.angleY;
        cameraAngleX = preset.angleX;
        updateCameraPosition();

        // Update active state
        document.querySelectorAll('.camera-preset-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      }
    });
  });

  // ========== Keyboard Help Modal ==========

  const keyboardHelp = document.getElementById('keyboardHelp');
  const keyboardOverlay = document.getElementById('keyboardOverlay');

  function showKeyboardHelp() {
    keyboardHelp.classList.add('open');
    keyboardOverlay.classList.add('open');
  }

  function hideKeyboardHelp() {
    keyboardHelp.classList.remove('open');
    keyboardOverlay.classList.remove('open');
  }

  document.getElementById('helpBtn').addEventListener('click', showKeyboardHelp);
  document.getElementById('closeHelp').addEventListener('click', hideKeyboardHelp);
  keyboardOverlay.addEventListener('click', hideKeyboardHelp);

  // ========== Rotation Controls ==========

  let isRotatingLeft = false;
  let isRotatingRight = false;

  async function updateRotation() {
    const speed = isRotatingLeft ? -90 : (isRotatingRight ? 90 : 0);
    try {
      await fetch('/api/rotation', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ speed })
      });
    } catch (e) {
      console.error('Rotation update failed:', e);
    }
  }

  const rotateLeftBtn = document.getElementById('rotateLeft');
  const rotateRightBtn = document.getElementById('rotateRight');

  rotateLeftBtn.addEventListener('mousedown', () => {
    isRotatingLeft = true;
    rotateLeftBtn.classList.add('active');
    updateRotation();
  });
  rotateLeftBtn.addEventListener('mouseup', () => {
    isRotatingLeft = false;
    rotateLeftBtn.classList.remove('active');
    updateRotation();
  });
  rotateLeftBtn.addEventListener('mouseleave', () => {
    if (isRotatingLeft) {
      isRotatingLeft = false;
      rotateLeftBtn.classList.remove('active');
      updateRotation();
    }
  });

  rotateRightBtn.addEventListener('mousedown', () => {
    isRotatingRight = true;
    rotateRightBtn.classList.add('active');
    updateRotation();
  });
  rotateRightBtn.addEventListener('mouseup', () => {
    isRotatingRight = false;
    rotateRightBtn.classList.remove('active');
    updateRotation();
  });
  rotateRightBtn.addEventListener('mouseleave', () => {
    if (isRotatingRight) {
      isRotatingRight = false;
      rotateRightBtn.classList.remove('active');
      updateRotation();
    }
  });

  // ========== Body Pose Controls ==========

  async function updateBodyPose(param, value) {
    try {
      await fetch('/api/body_pose', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ [param]: value })
      });
    } catch (e) {
      console.error('Body pose update failed:', e);
    }
  }

  document.getElementById('bodyPitch').addEventListener('input', (e) => {
    const value = parseFloat(e.target.value);
    document.getElementById('bodyPitchValue').textContent = value + '°';
    updateBodyPose('pitch', value);
    // Also update 3D body rotation
    body.rotation.x = value * Math.PI / 180;
  });

  document.getElementById('bodyRoll').addEventListener('input', (e) => {
    const value = parseFloat(e.target.value);
    document.getElementById('bodyRollValue').textContent = value + '°';
    updateBodyPose('roll', value);
    // Also update 3D body rotation
    body.rotation.z = value * Math.PI / 180;
  });

  document.getElementById('bodyYaw').addEventListener('input', (e) => {
    const value = parseFloat(e.target.value);
    document.getElementById('bodyYawValue').textContent = value + '°';
    updateBodyPose('yaw', value);
    // Also update 3D body rotation
    body.rotation.y = value * Math.PI / 180;
  });

  document.getElementById('resetPose').addEventListener('click', async () => {
    document.getElementById('bodyPitch').value = 0;
    document.getElementById('bodyRoll').value = 0;
    document.getElementById('bodyYaw').value = 0;
    document.getElementById('bodyPitchValue').textContent = '0°';
    document.getElementById('bodyRollValue').textContent = '0°';
    document.getElementById('bodyYawValue').textContent = '0°';
    body.rotation.set(0, 0, 0);
    try {
      await fetch('/api/body_pose', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ pitch: 0, roll: 0, yaw: 0 })
      });
    } catch (e) {
      console.error('Pose reset failed:', e);
    }
    logMsg('Body pose reset');
  });

  // ========== Extended Keyboard Shortcuts ==========

  document.addEventListener('keydown', (e) => {
    // Ignore if typing in an input
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    switch (e.key.toLowerCase()) {
      case 'q':
        if (!isRotatingLeft) {
          isRotatingLeft = true;
          rotateLeftBtn.classList.add('active');
          updateRotation();
        }
        break;
      case 'e':
        if (!isRotatingRight) {
          isRotatingRight = true;
          rotateRightBtn.classList.add('active');
          updateRotation();
        }
        break;
      case 'escape':
        document.getElementById('emergencyStop').click();
        break;
      case 'tab':
        e.preventDefault();
        settingsPanel.classList.toggle('open');
        if (settingsPanel.classList.contains('open')) {
          initializeLegPreviews();
        }
        break;
      case '?':
        showKeyboardHelp();
        break;
      case ' ':
        e.preventDefault();
        runBtn.click();
        break;
    }
  });

  document.addEventListener('keyup', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    switch (e.key.toLowerCase()) {
      case 'q':
        isRotatingLeft = false;
        rotateLeftBtn.classList.remove('active');
        updateRotation();
        break;
      case 'e':
        isRotatingRight = false;
        rotateRightBtn.classList.remove('active');
        updateRotation();
        break;
    }
  });

})();
