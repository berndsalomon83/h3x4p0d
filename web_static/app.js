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

  const DEFAULT_CAMERA_VIEWS = [
    {
      id: 'front',
      label: 'Front',
      enabled: true,
      position: 'front',
      sourceType: 'local',
      sourceUrl: ''
    }
  ];

  // Array of configs, one per leg (all legs share same dimensions from backend)
  let legConfigs = Array(6).fill(null).map(() => ({...DEFAULT_LEG_CONFIG}));

  let cameraViews = DEFAULT_CAMERA_VIEWS.map(v => ({...v}));

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

  function normalizeCameraView(view, index = 0) {
    const fallback = DEFAULT_CAMERA_VIEWS[0];
    return {
      id: view?.id || `camera-${index}`,
      label: view?.label || `Camera ${index + 1}`,
      enabled: view?.enabled !== undefined ? !!view.enabled : fallback.enabled,
      position: view?.position || fallback.position,
      sourceType: view?.source_type || view?.sourceType || fallback.sourceType,
      sourceUrl: view?.source_url || view?.sourceUrl || fallback.sourceUrl,
    };
  }

  function renderCameraList() {
    const list = document.getElementById('cameraList');
    if (!list) return;

    list.innerHTML = '';

    if (!cameraViews.length) {
      const emptyState = document.createElement('div');
      emptyState.className = 'camera-note';
      emptyState.textContent = 'No cameras configured yet. Add one to place a live pane.';
      list.appendChild(emptyState);
      return;
    }

    cameraViews.forEach((view, idx) => {
      const row = document.createElement('div');
      row.className = 'camera-config-row';
      row.dataset.cameraId = view.id;

      const header = document.createElement('div');
      header.style.display = 'flex';
      header.style.justifyContent = 'space-between';
      header.style.alignItems = 'center';

      const title = document.createElement('div');
      title.style.display = 'flex';
      title.style.gap = '8px';
      title.style.alignItems = 'center';

      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.value = view.label;
      nameInput.className = 'config-input';
      nameInput.style.width = '140px';
      nameInput.addEventListener('input', (e) => {
        updateCameraView(view.id, 'label', e.target.value);
      });

      const enabledToggle = document.createElement('label');
      enabledToggle.style.display = 'flex';
      enabledToggle.style.alignItems = 'center';
      enabledToggle.style.gap = '6px';
      enabledToggle.style.color = 'var(--text-muted)';
      enabledToggle.style.fontSize = '11px';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = view.enabled;
      checkbox.addEventListener('change', (e) => {
        updateCameraView(view.id, 'enabled', e.target.checked);
      });
      enabledToggle.appendChild(checkbox);
      const enabledLabel = document.createElement('span');
      enabledLabel.textContent = 'Enabled';
      enabledToggle.appendChild(enabledLabel);

      title.appendChild(nameInput);
      title.appendChild(enabledToggle);

      const removeBtn = document.createElement('button');
      removeBtn.className = 'webcam-btn';
      removeBtn.style.flex = 'none';
      removeBtn.style.width = 'auto';
      removeBtn.style.background = '#7a1f1f';
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', () => {
        cameraViews = cameraViews.filter(c => c.id !== view.id);
        renderCameraList();
        renderCameraDock();
      });

      header.appendChild(title);
      header.appendChild(removeBtn);

      const grid = document.createElement('div');
      grid.className = 'camera-config-grid';

      const sourceLabel = document.createElement('label');
      sourceLabel.textContent = 'Source Type';
      const sourceSelect = document.createElement('select');
      sourceSelect.innerHTML = `
        <option value="local">Local webcam</option>
        <option value="url">Stream URL</option>
      `;
      sourceSelect.value = view.sourceType;
      sourceSelect.addEventListener('change', (e) => {
        updateCameraView(view.id, 'sourceType', e.target.value);
      });
      sourceLabel.appendChild(sourceSelect);

      const urlLabel = document.createElement('label');
      urlLabel.textContent = 'Stream / Device URL';
      const urlInput = document.createElement('input');
      urlInput.type = 'text';
      urlInput.value = view.sourceUrl;
      urlInput.placeholder = 'rtsp/http URL or leave blank for local';
      urlInput.className = 'config-input';
      urlInput.addEventListener('input', (e) => {
        updateCameraView(view.id, 'sourceUrl', e.target.value);
      });
      urlLabel.appendChild(urlInput);

      const positionLabel = document.createElement('label');
      positionLabel.textContent = 'Pane Position';
      const positionSelect = document.createElement('select');
      positionSelect.innerHTML = `
        <option value="front">Front</option>
        <option value="left">Left</option>
        <option value="right">Right</option>
        <option value="rear">Rear</option>
        <option value="floating">Floating</option>
      `;
      positionSelect.value = view.position;
      positionSelect.addEventListener('change', (e) => {
        updateCameraView(view.id, 'position', e.target.value);
      });
      positionLabel.appendChild(positionSelect);

      grid.appendChild(sourceLabel);
      grid.appendChild(urlLabel);
      grid.appendChild(positionLabel);

      row.appendChild(header);
      row.appendChild(grid);
      list.appendChild(row);
    });
  }

  function renderCameraDock() {
    const dock = document.getElementById('cameraDock');
    if (!dock) return;

    dock.innerHTML = '';
    const enabledViews = cameraViews.filter(v => v.enabled);
    dock.style.display = enabledViews.length ? 'grid' : 'none';

    enabledViews.forEach((view) => {
      const pane = document.createElement('div');
      pane.className = `camera-pane position-${view.position || 'floating'}`;

      const header = document.createElement('div');
      header.className = 'camera-pane-header';
      header.innerHTML = `<span>${view.label}</span><span style="font-size: 10px; color: #666;">${view.position}</span>`;
      pane.appendChild(header);

      let hasVideo = false;
      if (view.sourceType === 'local') {
        const video = document.createElement('video');
        video.autoplay = true;
        video.muted = true;
        video.playsInline = true;
        video.loop = true;
        video.dataset.sourceType = 'local';
        video.dataset.cameraId = view.id;
        if (webcamStream) {
          video.srcObject = webcamStream;
          hasVideo = true;
        }
        pane.appendChild(video);
      } else if (view.sourceUrl) {
        const video = document.createElement('video');
        video.autoplay = true;
        video.muted = true;
        video.playsInline = true;
        video.loop = true;
        video.src = view.sourceUrl;
        video.dataset.sourceType = 'url';
        video.dataset.cameraId = view.id;
        pane.appendChild(video);
        hasVideo = true;
      }

      if (!hasVideo) {
        const placeholder = document.createElement('div');
        placeholder.className = 'camera-placeholder';
        placeholder.textContent = view.sourceType === 'local'
          ? 'Start the webcam to view this feed.'
          : 'Add a stream URL to preview this camera.';
        pane.appendChild(placeholder);
      }

      dock.appendChild(pane);
    });
  }

  function updateCameraView(id, field, value) {
    cameraViews = cameraViews.map((view, idx) => {
      if (view.id !== id) return view;
      const updated = { ...view, [field]: value };
      if (field === 'sourceType' && value === 'local' && !updated.label) {
        updated.label = `Camera ${idx + 1}`;
      }
      return updated;
    });
    renderCameraList();
    renderCameraDock();
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

      // Camera layout persistence
      if (Array.isArray(config.camera_views)) {
        cameraViews = config.camera_views.map((view, idx) => normalizeCameraView(view, idx));
      } else {
        cameraViews = DEFAULT_CAMERA_VIEWS.map(v => ({...v}));
      }
      renderCameraList();
      renderCameraDock();

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

  function updateRunButtonTheme() {
    if (!runBtn) return;
    runBtn.style.background = walking ? getThemeColor('--danger', '#ff6b6b') : getThemeColor('--success', '#51cf66');
    runBtn.style.color = '#041019';
  }

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
    joystickCtx.strokeStyle = getThemeColor('--panel-strong', '#666');
    joystickCtx.lineWidth = 2;
    joystickCtx.beginPath();
    joystickCtx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    joystickCtx.stroke();

    // Draw center crosshair
    joystickCtx.strokeStyle = getThemeColor('--panel-border', '#444');
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

    joystickCtx.fillStyle = joystickActive ? getThemeColor('--accent', '#0099ff') : getThemeColor('--text-muted', '#888');
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
          updateRunButtonTheme();
        }
      } else {
        currentSpeed = 0;
        joystickX = 0;
        joystickY = 0;

        if (walking) {
          walking = false;
          runBtn.textContent = 'Start Walking';
          updateRunButtonTheme();
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
      document.getElementById('connectionStatus').style.color = getThemeColor('--success', '#51cf66');
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
      document.getElementById('connectionStatus').style.color = getThemeColor('--danger', '#ff6b6b');
    };

    ws.onclose = () => {
      document.getElementById('connectionStatus').textContent = 'Disconnected';
      document.getElementById('connectionStatus').style.color = getThemeColor('--danger', '#ff6b6b');

      // Auto-reconnect with exponential backoff
      if (reconnectAttempts < maxReconnectAttempts) {
        reconnectAttempts++;
        const delay = reconnectDelay * Math.min(reconnectAttempts, 5);
        logMsg(`Connection lost. Reconnecting in ${delay/1000}s... (attempt ${reconnectAttempts})`);
        document.getElementById('connectionStatus').textContent = `Reconnecting (${reconnectAttempts})...`;
        document.getElementById('connectionStatus').style.color = getThemeColor('--warning', '#ffa500');
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
        updateRunButtonTheme();
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
        updateRunButtonTheme();
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
    updateRunButtonTheme();

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

  // Theme presets and helpers
  const THEME_STORAGE_KEY = 'hexapod-theme';
  const themeVars = ['--accent', '--panel-bg', '--control-bg', '--panel-border', '--text-primary', '--text-muted', '--success', '--danger'];
  const themePresets = {
    aurora: {
      label: 'Aurora Glow',
      values: {
        '--accent': '#00d2ff',
        '--panel-bg': '#0c1423',
        '--control-bg': '#111a2c',
        '--panel-border': '#1f2c46',
        '--text-primary': '#e6efff',
        '--text-muted': '#93a4c7',
        '--success': '#51cf66',
        '--danger': '#ff6b6b'
      }
    },
    carbon: {
      label: 'Carbon Fiber',
      values: {
        '--accent': '#7c5dff',
        '--panel-bg': '#0b0f1a',
        '--control-bg': '#10182b',
        '--panel-border': '#1f2b3f',
        '--text-primary': '#e5ecff',
        '--text-muted': '#94a0bf',
        '--success': '#5be7aa',
        '--danger': '#ff7b8a'
      }
    },
    sunrise: {
      label: 'Sunrise Alloy',
      values: {
        '--accent': '#ffa93a',
        '--panel-bg': '#0d0f1c',
        '--control-bg': '#14192b',
        '--panel-border': '#2b3248',
        '--text-primary': '#f3f4ff',
        '--text-muted': '#a3afcf',
        '--success': '#7ae0c3',
        '--danger': '#ff6b81'
      }
    }
  };

  let activeTheme = {...themePresets.aurora.values};

  function getThemeColor(varName, fallback = '#ffffff') {
    const value = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    return value || fallback;
  }

  function applyTheme(values, skipSave = false) {
    activeTheme = {...activeTheme, ...values};
    Object.entries(activeTheme).forEach(([key, value]) => {
      document.documentElement.style.setProperty(key, value);
    });

    updateRunButtonTheme();
    drawJoystick();

    if (!skipSave) {
      localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify({preset: document.getElementById('themePreset')?.value || 'aurora', values: activeTheme}));
    }
  }

  function syncThemeInputs(values) {
    document.querySelectorAll('[data-theme-var]').forEach((input) => {
      const varName = input.dataset.themeVar;
      if (values[varName]) {
        input.value = values[varName];
      }
    });
  }

  function loadTheme() {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        const presetName = parsed.preset || 'aurora';
        activeTheme = {...activeTheme, ...parsed.values};
        applyTheme(activeTheme, true);
        const presetSelect = document.getElementById('themePreset');
        if (presetSelect) presetSelect.value = presetName;
        syncThemeInputs(activeTheme);
        return;
      } catch (e) {
        console.warn('Failed to load saved theme, reverting to default');
      }
    }
    applyTheme(activeTheme, true);
    syncThemeInputs(activeTheme);
  }

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

  // Theme bindings
  const themePresetSelect = document.getElementById('themePreset');
  if (themePresetSelect) {
    themePresetSelect.addEventListener('change', (event) => {
      const presetKey = event.target.value;
      if (themePresets[presetKey]) {
        applyTheme(themePresets[presetKey].values);
        syncThemeInputs(themePresets[presetKey].values);
      } else {
        syncThemeInputs(activeTheme);
      }
    });
  }

  document.querySelectorAll('[data-theme-var]').forEach((input) => {
    input.addEventListener('input', (event) => {
      const varName = event.target.dataset.themeVar;
      const value = event.target.value;
      applyTheme({[varName]: value});
      if (themePresetSelect) {
        themePresetSelect.value = 'custom';
      }
    });
  });

  const saveCustomThemeBtn = document.getElementById('saveCustomTheme');
  if (saveCustomThemeBtn) {
    saveCustomThemeBtn.addEventListener('click', () => {
      applyTheme(activeTheme);
      if (themePresetSelect) {
        themePresetSelect.value = 'custom';
      }
      logMsg('Custom theme saved');
    });
  }

  // Load saved theme once UI controls are available
  loadTheme();

  // Initialize leg configuration UI
  function initializeConfigUI() {
    const legNames = ['Front Right', 'Mid Right', 'Rear Right', 'Rear Left', 'Mid Left', 'Front Left'];

    // Create a layout with body in center and legs in 2 columns
    legConfigContainer.innerHTML = `
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 15px;">
        <div id="leftLegs" style="text-align: center;">
          <div style="background: var(--panel-strong); padding: 8px; border-radius: 4px; margin-bottom: 10px; font-weight: bold;">LEFT SIDE</div>
        </div>
        <div id="rightLegs" style="text-align: center;">
          <div style="background: var(--panel-strong); padding: 8px; border-radius: 4px; margin-bottom: 10px; font-weight: bold;">RIGHT SIDE</div>
        </div>
      </div>
      <div style="text-align: center; background: var(--control-bg); padding: 15px; border-radius: 8px; margin: 10px 0; font-weight: bold; font-size: 16px;">
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
        <div class="config-row" style="margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--panel-border);">
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

  // Initialize camera UI with defaults before backend config loads
  renderCameraList();
  renderCameraDock();

  // ========== Webcam Settings ==========

  let webcamStream = null;
  let webcamOverlay = null;

  function refreshLocalCameraVideos() {
    document.querySelectorAll('.camera-pane video[data-source-type="local"]').forEach((video) => {
      if (webcamStream) {
        video.srcObject = webcamStream;
        video.play().catch(() => {});
      } else {
        video.srcObject = null;
      }
    });
  }

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

      refreshLocalCameraVideos();
      renderCameraDock();

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
      webcamStream = null;
      refreshLocalCameraVideos();
      renderCameraDock();
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

  document.getElementById('addCameraView').addEventListener('click', () => {
    const nextIndex = cameraViews.length;
    const newView = normalizeCameraView({
      id: `camera-${Date.now()}`,
      label: `Camera ${nextIndex + 1}`,
      enabled: true,
      position: 'floating',
      sourceType: 'local',
      sourceUrl: ''
    }, nextIndex);
    cameraViews.push(newView);
    renderCameraList();
    renderCameraDock();
  });

  document.getElementById('saveCameraViews').addEventListener('click', async () => {
    const payload = {
      camera_views: cameraViews.map(view => ({
        id: view.id,
        label: view.label,
        enabled: view.enabled,
        position: view.position,
        source_type: view.sourceType,
        source_url: view.sourceUrl,
      }))
    };
    await saveConfigToBackend(payload);
    logMsg('Camera layout saved');
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

  // ========== Enhanced Calibration Tab ==========

  const calibrationState = {
    selectedLeg: null,
    offsets: Array(6).fill(null).map(() => ({coxa: 0, femur: 0, tibia: 0})),
    testMode: false,
    mirrorPairs: {0: 5, 1: 4, 2: 3, 3: 2, 4: 1, 5: 0} // Left-right pairs
  };

  const legNames = ['Front Right', 'Mid Right', 'Rear Right', 'Rear Left', 'Mid Left', 'Front Left'];

  // Draw a gauge arc on canvas
  function drawGauge(canvasId, value, min = -45, max = 45) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const centerX = w / 2;
    const centerY = h - 5;
    const radius = 30;

    ctx.clearRect(0, 0, w, h);

    // Background arc
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, Math.PI, 0);
    ctx.strokeStyle = getThemeColor('--panel-border', '#333');
    ctx.lineWidth = 6;
    ctx.stroke();

    // Value arc
    const range = max - min;
    const normalizedValue = (value - min) / range;
    const angle = Math.PI * (1 - normalizedValue);

    // Determine color based on value
    let color;
    if (value > 0) {
      color = getThemeColor('--success', '#51cf66');
    } else if (value < 0) {
      color = getThemeColor('--danger', '#ff6b6b');
    } else {
      color = getThemeColor('--text-muted', '#888');
    }

    // Draw colored portion
    ctx.beginPath();
    if (value >= 0) {
      ctx.arc(centerX, centerY, radius, Math.PI / 2, angle, true);
    } else {
      ctx.arc(centerX, centerY, radius, angle, Math.PI / 2, true);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 6;
    ctx.stroke();

    // Draw needle
    const needleAngle = Math.PI - (normalizedValue * Math.PI);
    const needleLength = radius - 8;
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(
      centerX + Math.cos(needleAngle) * needleLength,
      centerY - Math.sin(needleAngle) * needleLength
    );
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Needle center dot
    ctx.beginPath();
    ctx.arc(centerX, centerY, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();

    // Scale marks
    ctx.fillStyle = getThemeColor('--panel-strong', '#555');
    ctx.font = '7px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('-45', 8, centerY - 5);
    ctx.fillText('0', centerX, 10);
    ctx.fillText('+45', w - 8, centerY - 5);
  }

  // Update all gauges for selected leg
  function updateGauges() {
    if (calibrationState.selectedLeg === null) return;

    const offsets = calibrationState.offsets[calibrationState.selectedLeg];

    drawGauge('coxaGaugeCanvas', offsets.coxa);
    drawGauge('femurGaugeCanvas', offsets.femur);
    drawGauge('tibiaGaugeCanvas', offsets.tibia);

    // Update value displays
    const updateValueDisplay = (id, value) => {
      const el = document.getElementById(id);
      if (el) {
        el.textContent = value.toFixed(1) + '°';
        el.className = 'servo-gauge-value' + (value > 0 ? ' positive' : value < 0 ? ' negative' : '');
      }
    };

    updateValueDisplay('coxaGaugeValue', offsets.coxa);
    updateValueDisplay('femurGaugeValue', offsets.femur);
    updateValueDisplay('tibiaGaugeValue', offsets.tibia);

    updateValueDisplay('coxaSliderValue', offsets.coxa);
    updateValueDisplay('femurSliderValue', offsets.femur);
    updateValueDisplay('tibiaSliderValue', offsets.tibia);

    // Update sliders
    document.getElementById('coxaOffsetSlider').value = offsets.coxa;
    document.getElementById('femurOffsetSlider').value = offsets.femur;
    document.getElementById('tibiaOffsetSlider').value = offsets.tibia;

    // Update leg status
    const hasOffset = offsets.coxa !== 0 || offsets.femur !== 0 || offsets.tibia !== 0;
    const statusEl = document.getElementById('legOffsetStatus');
    if (statusEl) {
      statusEl.textContent = hasOffset ? 'Modified' : 'No offsets';
      statusEl.className = 'leg-detail-status' + (hasOffset ? ' modified' : '');
    }
  }

  // Update SVG diagram to show offset status
  function updateDiagramStatus() {
    document.querySelectorAll('.leg-btn').forEach((legEl, index) => {
      const offsets = calibrationState.offsets[index];
      const hasOffset = offsets.coxa !== 0 || offsets.femur !== 0 || offsets.tibia !== 0;
      legEl.classList.toggle('has-offset', hasOffset);
      legEl.classList.toggle('selected', index === calibrationState.selectedLeg);
    });
  }

  // Select a leg for calibration
  function selectLeg(legIndex) {
    calibrationState.selectedLeg = legIndex;

    // Update title
    const titleEl = document.getElementById('selectedLegTitle');
    if (titleEl) {
      titleEl.textContent = `Leg ${legIndex}: ${legNames[legIndex]}`;
    }

    // Update mirror button text
    const mirrorBtn = document.getElementById('mirrorBtn');
    if (mirrorBtn) {
      const mirrorLeg = calibrationState.mirrorPairs[legIndex];
      mirrorBtn.textContent = `Mirror → ${mirrorLeg}`;
    }

    // Highlight the leg in 3D view
    highlightLegIn3D(legIndex);

    updateGauges();
    updateDiagramStatus();
  }

  // Highlight selected leg in 3D scene
  function highlightLegIn3D(legIndex) {
    // Reset all legs to normal color
    legs.forEach((leg, i) => {
      const isSelected = i === legIndex;
      // Find the coxa, femur, tibia meshes and update their emission
      leg.coxaJoint.traverse(child => {
        if (child.isMesh && child.material) {
          child.material.emissive = isSelected ? new THREE.Color(0x003366) : new THREE.Color(0x000000);
          child.material.emissiveIntensity = isSelected ? 0.5 : 0;
        }
      });
    });
  }

  // Save offset to backend
  async function saveOffset(legIndex, jointIndex, offset) {
    try {
      await fetch('/api/config/servo_offset', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          leg: legIndex,
          joint: jointIndex,
          offset: offset
        })
      });
    } catch (error) {
      console.error('Failed to save servo offset:', error);
    }
  }

  // Load offsets from backend
  async function loadOffsetsFromBackend() {
    try {
      const response = await fetch('/api/config');
      if (!response.ok) return;
      const config = await response.json();

      for (let leg = 0; leg < 6; leg++) {
        calibrationState.offsets[leg] = {
          coxa: config[`servo_offset_leg${leg}_joint0`] || 0,
          femur: config[`servo_offset_leg${leg}_joint1`] || 0,
          tibia: config[`servo_offset_leg${leg}_joint2`] || 0
        };
      }

      updateDiagramStatus();
      if (calibrationState.selectedLeg !== null) {
        updateGauges();
      }
    } catch (e) {
      console.error('Failed to load servo offsets:', e);
    }
  }

  // Initialize calibration UI
  function initializeCalibrationUI() {
    // Leg selection from SVG diagram
    document.querySelectorAll('.leg-btn').forEach(legEl => {
      legEl.addEventListener('click', () => {
        const legIndex = parseInt(legEl.dataset.leg);
        selectLeg(legIndex);
      });
    });

    // Slider handlers
    ['coxa', 'femur', 'tibia'].forEach((joint, jointIndex) => {
      const slider = document.getElementById(`${joint}OffsetSlider`);
      if (slider) {
        slider.addEventListener('input', (e) => {
          if (calibrationState.selectedLeg === null) return;

          const offset = parseFloat(e.target.value);
          calibrationState.offsets[calibrationState.selectedLeg][joint] = offset;

          // Update displays
          updateGauges();
          updateDiagramStatus();

          // Apply to 3D view if in test mode
          if (calibrationState.testMode) {
            applyTestOffset(calibrationState.selectedLeg, jointIndex, offset);
          }

          // Save to backend
          saveOffset(calibrationState.selectedLeg, jointIndex, offset);
        });
      }
    });

    // Quick preset buttons
    document.querySelectorAll('.quick-preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (calibrationState.selectedLeg === null) return;

        const joint = btn.dataset.joint;
        const value = parseFloat(btn.dataset.value);
        const jointIndex = {coxa: 0, femur: 1, tibia: 2}[joint];

        calibrationState.offsets[calibrationState.selectedLeg][joint] = value;

        const slider = document.getElementById(`${joint}OffsetSlider`);
        if (slider) slider.value = value;

        updateGauges();
        updateDiagramStatus();

        if (calibrationState.testMode) {
          applyTestOffset(calibrationState.selectedLeg, jointIndex, value);
        }

        saveOffset(calibrationState.selectedLeg, jointIndex, value);
      });
    });

    // Test mode toggle
    document.getElementById('testModeBtn').addEventListener('click', () => {
      calibrationState.testMode = !calibrationState.testMode;

      const btn = document.getElementById('testModeBtn');
      const indicator = document.getElementById('testModeIndicator');

      btn.classList.toggle('active', calibrationState.testMode);
      btn.textContent = calibrationState.testMode ? 'Exit Test' : 'Test Mode';
      indicator.classList.toggle('active', calibrationState.testMode);

      if (calibrationState.testMode && calibrationState.selectedLeg !== null) {
        logMsg(`Test mode active for leg ${calibrationState.selectedLeg}`);
      } else {
        logMsg('Test mode deactivated');
      }
    });

    // Mirror button
    document.getElementById('mirrorBtn').addEventListener('click', async () => {
      if (calibrationState.selectedLeg === null) return;

      const mirrorLeg = calibrationState.mirrorPairs[calibrationState.selectedLeg];
      const sourceOffsets = calibrationState.offsets[calibrationState.selectedLeg];

      // Copy offsets to mirror leg (invert coxa for left/right)
      calibrationState.offsets[mirrorLeg] = {
        coxa: -sourceOffsets.coxa, // Invert coxa for mirror
        femur: sourceOffsets.femur,
        tibia: sourceOffsets.tibia
      };

      // Save to backend
      await saveOffset(mirrorLeg, 0, -sourceOffsets.coxa);
      await saveOffset(mirrorLeg, 1, sourceOffsets.femur);
      await saveOffset(mirrorLeg, 2, sourceOffsets.tibia);

      updateDiagramStatus();
      logMsg(`Mirrored offsets from leg ${calibrationState.selectedLeg} to leg ${mirrorLeg}`);
    });

    // Reset leg button
    document.getElementById('resetLegBtn').addEventListener('click', async () => {
      if (calibrationState.selectedLeg === null) return;

      calibrationState.offsets[calibrationState.selectedLeg] = {coxa: 0, femur: 0, tibia: 0};

      await saveOffset(calibrationState.selectedLeg, 0, 0);
      await saveOffset(calibrationState.selectedLeg, 1, 0);
      await saveOffset(calibrationState.selectedLeg, 2, 0);

      updateGauges();
      updateDiagramStatus();
      logMsg(`Reset offsets for leg ${calibrationState.selectedLeg}`);
    });

    // Save all button
    document.getElementById('saveCalibration').addEventListener('click', async () => {
      try {
        await fetch('/api/config/save', { method: 'POST' });
        logMsg('Calibration saved to file');
      } catch (e) {
        logMsg('Failed to save calibration');
      }
    });

    // Reset all button
    document.getElementById('resetAllCalibration').addEventListener('click', async () => {
      if (!confirm('Reset all servo offsets to 0?')) return;

      for (let leg = 0; leg < 6; leg++) {
        calibrationState.offsets[leg] = {coxa: 0, femur: 0, tibia: 0};
        await saveOffset(leg, 0, 0);
        await saveOffset(leg, 1, 0);
        await saveOffset(leg, 2, 0);
      }

      updateGauges();
      updateDiagramStatus();
      logMsg('All servo offsets reset to 0');
    });

    // Select first leg by default
    selectLeg(0);

    // Load offsets from backend
    loadOffsetsFromBackend();

    // Draw initial gauges
    drawGauge('coxaGaugeCanvas', 0);
    drawGauge('femurGaugeCanvas', 0);
    drawGauge('tibiaGaugeCanvas', 0);
  }

  // Apply test offset to 3D view
  function applyTestOffset(legIndex, jointIndex, offset) {
    const leg = legs[legIndex];
    const radians = offset * Math.PI / 180;

    // Apply offset directly to the joint
    if (jointIndex === 0) {
      leg.coxaJoint.rotation.y = radians;
      legTargets[legIndex].coxa = radians;
    } else if (jointIndex === 1) {
      leg.femurJoint.rotation.x = radians;
      legTargets[legIndex].femur = radians;
    } else if (jointIndex === 2) {
      leg.tibiaJoint.rotation.x = radians;
      legTargets[legIndex].tibia = radians;
    }

    // Mark as manually controlled
    manualControlTimestamps[legIndex] = performance.now();
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
          devicesDiv.innerHTML = '<div style="color: var(--text-muted); padding: 10px; text-align: center;">No BLE devices found nearby</div>';
        } else {
          // Display devices as read-only list (no connection buttons)
          data.devices.forEach((device, index) => {
            const deviceItem = document.createElement('div');
            deviceItem.style.padding = '8px';
            deviceItem.style.borderBottom = '1px solid var(--panel-border)';
            deviceItem.style.fontSize = '11px';
            deviceItem.style.color = 'var(--text-primary)';
            deviceItem.innerHTML = `
              <div style="font-weight: 600; color: var(--accent); margin-bottom: 2px;">${device.name}</div>
              <div style="color: var(--text-muted); font-size: 10px;">${device.address}</div>
            `;
            devicesDiv.appendChild(deviceItem);
          });
        }

        logMsg(`Found ${data.devices.length} BLE device(s)`);
      } else {
        devicesDiv.innerHTML = `<div style="color: var(--danger); padding: 10px; text-align: center;">Error: ${data.error || 'Scan failed'}</div>`;
        logMsg(`BLE scan failed: ${data.error}`);
      }
    } catch (error) {
      devicesDiv.innerHTML = `<div style="color: var(--danger); padding: 10px; text-align: center;">Error: ${error.message}</div>`;
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
      updateRunButtonTheme();
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
