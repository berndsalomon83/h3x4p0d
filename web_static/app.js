(function(){
  // ========== Constants ==========
  const CAMERA_MIN_DISTANCE = 100;
  const CAMERA_MAX_DISTANCE = 700;
  const CAMERA_DEFAULT_DISTANCE = 550;
  const JOYSTICK_SCALE = 25;          // Pixels to joystick unit conversion
  const JOYSTICK_DEADZONE = 0.1;      // Minimum joystick movement to register
  const CALIBRATION_SWEEP_RANGE = 15; // Degrees for servo sweep test
  const CALIBRATION_ANGLE_LIMIT = 45; // Max angle deviation for calibration

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
  let cameraDistance = CAMERA_DEFAULT_DISTANCE;
  let cameraAngleY = Math.PI;  // Start at back view (180° rotated from front)
  let cameraAngleX = Math.PI / 4;  // Isometric angle (45° from horizontal)
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
    cameraDistance = Math.max(CAMERA_MIN_DISTANCE, Math.min(CAMERA_MAX_DISTANCE, cameraDistance));
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
  
  // Hexapod preview configuration shared with the configuration UI
  let defaultBodyY = 90;
  // Spider-like leg arrangement: 6 legs evenly distributed around body
  // Default values - will be updated from config if available
  let attachPoints = [
    { x: 55, y: 65, z: 0, angle: 30 },    // Front right - forward, slight right
    { x: 0, y: 80, z: 0, angle: 50 },     // Middle right - forward, angled right
    { x: -55, y: 65, z: 0, angle: 70 },   // Rear right - forward, angled right
    { x: -55, y: -65, z: 0, angle: 290 }, // Rear left - forward, angled left
    { x: 0, y: -80, z: 0, angle: 310 },   // Middle left - forward, angled left
    { x: 55, y: -65, z: 0, angle: 330 }   // Front left - forward, slight left
  ];

  const DEFAULT_LEG_CONFIG = {
    coxaLength: 40,
    femurLength: 80,
    tibiaLength: 100,
    coxaRadius: 3,
    femurRadius: 3,
    tibiaRadius: 2.5,
    jointRadius: 4,
    footRadius: 4
  };

  // Unified camera configuration - combines source + display settings
  const DEFAULT_CAMERAS = [
    {
      id: 'front',
      name: 'Front Camera',
      enabled: true,
      // Source
      sourceType: 'browser',  // browser, usb, csi, rtsp, http
      sourceAddress: '',
      resolution: '1280x720',
      fps: 30,
      // Display
      displayMode: 'dock',    // dock (floating pane) or overlay (3D scene)
      position: 'front'       // front, left, right, rear, floating
    }
  ];

  // Array of configs, one per leg (all legs share same dimensions from backend)
  let legConfigs = Array(6).fill(null).map(() => ({...DEFAULT_LEG_CONFIG}));

  // Unified camera list
  let cameras = DEFAULT_CAMERAS.map(c => ({...c}));

  // ============================================================================
  // ARCHITECTURE NOTE: All IK (Inverse Kinematics) calculations are performed
  // on the backend (Python). The frontend ONLY displays what the backend sends
  // via WebSocket telemetry. This ensures the 3D visualization accurately
  // mirrors the actual hexapod servo positions and prevents drift between
  // the simulated display and real hardware.
  //
  // DO NOT add IK calculations to the frontend. If leg angles need to change,
  // send a message to the backend and let it calculate and send back telemetry.
  // ============================================================================

  // Default visual pose for legs before backend telemetry arrives
  // Hexapod stance: legs drop mostly downward with a gentle knee bend so feet sit under the body
  const DEFAULT_VISUAL_POSE = {
    coxa: 0,                           // Neutral (pointing straight out)
    femur: (75 - 90) * Math.PI / 180,  // Femur aims ~15° forward from vertical
    tibia: (120 - 90) * Math.PI / 180  // Knee bends ~30° toward the ground
  };

  // Normalize camera from config (supports both new unified format and legacy formats)
  function normalizeCamera(cam, index = 0) {
    const fallback = DEFAULT_CAMERAS[0];

    // Handle legacy camera_views format
    if (cam?.label !== undefined || cam?.sourceUrl !== undefined || cam?.hardwareCameraId !== undefined) {
      return {
        id: cam?.id || `cam-${index}`,
        name: cam?.label || cam?.name || `Camera ${index + 1}`,
        enabled: cam?.enabled !== undefined ? !!cam.enabled : fallback.enabled,
        sourceType: mapLegacySourceType(cam?.source_type || cam?.sourceType || 'browser'),
        sourceAddress: cam?.source_url || cam?.sourceUrl || cam?.sourceAddress || '',
        resolution: cam?.resolution || fallback.resolution,
        fps: cam?.fps || fallback.fps,
        displayMode: mapLegacyDisplayMode(cam?.display_mode || cam?.displayMode || 'dock'),
        position: cam?.position || fallback.position,
        deviceId: cam?.device_id || cam?.deviceId || null,
        deviceLabel: cam?.device_label || cam?.deviceLabel || null,
      };
    }

    return {
      id: cam?.id || `cam-${index}`,
      name: cam?.name || `Camera ${index + 1}`,
      enabled: cam?.enabled !== undefined ? !!cam.enabled : fallback.enabled,
      sourceType: cam?.source_type || cam?.sourceType || fallback.sourceType,
      sourceAddress: cam?.source_address || cam?.sourceAddress || '',
      resolution: cam?.resolution || fallback.resolution,
      fps: cam?.fps || fallback.fps,
      displayMode: cam?.display_mode || cam?.displayMode || fallback.displayMode,
      position: cam?.position || fallback.position,
      deviceId: cam?.device_id || cam?.deviceId || null,
      deviceLabel: cam?.device_label || cam?.deviceLabel || null,
    };
  }

  // Map legacy source types to new format
  // 'local' = browser webcam via getUserMedia
  // 'hardware' = USB/V4L2 camera (not browser webcam)
  function mapLegacySourceType(type) {
    if (type === 'local') return 'browser';
    if (type === 'hardware') return 'usb'; // Legacy hardware refs = USB cameras
    return type || 'browser';
  }

  // Map legacy display modes to new format
  function mapLegacyDisplayMode(mode) {
    if (mode === 'pane') return 'dock';
    return mode || 'dock';
  }

  // Get camera source info for display/streaming
  function getCameraSource(cam) {
    return {
      type: cam.sourceType,
      address: cam.sourceAddress,
      resolution: cam.resolution,
      fps: cam.fps,
      name: cam.name
    };
  }

  // Populate the camera checkbox list with configured cameras
  function populateCameraSelect() {
    const container = document.getElementById('cameraCheckboxList');
    if (!container) return;

    // Clear and rebuild
    container.innerHTML = '';

    if (cameras.length === 0) {
      container.innerHTML = '<div style="color: var(--text-muted); font-size: 11px;">No cameras configured</div>';
      updateCameraControlUI();
      return;
    }

    cameras.forEach(cam => {
      const item = document.createElement('div');
      item.className = 'camera-checkbox-item';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.id = `camera-check-${cam.id}`;
      checkbox.checked = cam.enabled || false;
      checkbox.addEventListener('change', () => handleCameraToggle(cam.id, checkbox.checked));

      // Build source info string
      const sourceType = cam.sourceType || 'browser';
      let sourceInfo = '';
      switch (sourceType) {
        case 'browser':
          sourceInfo = 'Browser Webcam';
          if (cam.deviceId && cam.deviceLabel) {
            sourceInfo = cam.deviceLabel.substring(0, 20) + (cam.deviceLabel.length > 20 ? '...' : '');
          }
          break;
        case 'usb':
          sourceInfo = cam.sourceAddress ? `USB: ${cam.sourceAddress}` : 'USB Device';
          break;
        case 'csi':
          sourceInfo = 'Pi Camera (CSI)';
          break;
        case 'http':
          sourceInfo = cam.sourceAddress ? `HTTP: ${cam.sourceAddress.substring(0, 15)}...` : 'HTTP Stream';
          break;
        case 'mjpeg':
          sourceInfo = cam.sourceAddress ? `MJPEG: ${cam.sourceAddress.substring(0, 15)}...` : 'MJPEG Stream';
          break;
        case 'rtsp':
          sourceInfo = cam.sourceAddress ? `RTSP: ${cam.sourceAddress.substring(0, 15)}...` : 'RTSP Stream';
          break;
        default:
          sourceInfo = sourceType;
      }

      const label = document.createElement('label');
      label.htmlFor = `camera-check-${cam.id}`;
      label.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 2px;">
          <span style="font-weight: 500;">${cam.name}</span>
          <span style="font-size: 10px; color: var(--text-muted);">${sourceInfo}</span>
        </div>
        <span class="camera-position">${cam.position || 'floating'}</span>
      `;

      item.appendChild(checkbox);
      item.appendChild(label);

      // For browser webcams, add device selector button
      if (sourceType === 'browser') {
        const selectBtn = document.createElement('button');
        selectBtn.className = 'webcam-btn';
        selectBtn.style.cssText = 'padding: 2px 6px; font-size: 10px; margin-left: 4px;';
        selectBtn.textContent = '📷';
        selectBtn.title = 'Select webcam device';
        selectBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          showDeviceSelector(cam.id);
        });
        item.appendChild(selectBtn);
      }

      container.appendChild(item);
    });

    updateCameraControlUI();
  }

  // Show device selector modal for browser webcams
  async function showDeviceSelector(cameraId) {
    const cam = cameras.find(c => c.id === cameraId);
    if (!cam) return;

    // Request permission first (needed to get device labels)
    try {
      const tempStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      tempStream.getTracks().forEach(track => track.stop());
    } catch (err) {
      logMsg('Camera permission denied or no cameras available');
      return;
    }

    // Get available video devices
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter(d => d.kind === 'videoinput');

    if (videoDevices.length === 0) {
      logMsg('No webcam devices found');
      return;
    }

    // Create modal
    const modal = document.createElement('div');
    modal.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.8); z-index: 10000;
      display: flex; align-items: center; justify-content: center;
    `;

    const content = document.createElement('div');
    content.style.cssText = `
      background: var(--panel-bg, #1a1a2e); padding: 20px; border-radius: 12px;
      max-width: 400px; width: 90%; color: #fff;
    `;

    content.innerHTML = `
      <h3 style="margin: 0 0 16px 0; font-size: 16px;">Select Webcam for "${cam.name}"</h3>
      <div class="device-list" style="display: flex; flex-direction: column; gap: 8px; max-height: 300px; overflow-y: auto;">
        ${videoDevices.map((device, idx) => `
          <button class="device-option" data-device-id="${device.deviceId}" data-device-label="${device.label || 'Camera ' + (idx + 1)}" style="
            background: ${cam.deviceId === device.deviceId ? 'var(--accent, #4dabf7)' : 'rgba(255,255,255,0.1)'};
            border: none; padding: 12px; border-radius: 8px; text-align: left;
            cursor: pointer; color: #fff; transition: background 0.2s;
          ">
            <div style="font-weight: 500;">${device.label || 'Camera ' + (idx + 1)}</div>
            <div style="font-size: 11px; color: rgba(255,255,255,0.6); margin-top: 4px;">
              ID: ${device.deviceId.substring(0, 16)}...
            </div>
            ${cam.deviceId === device.deviceId ? '<div style="font-size: 10px; color: #51cf66; margin-top: 4px;">✓ Currently selected</div>' : ''}
          </button>
        `).join('')}
      </div>
      <div style="display: flex; gap: 8px; margin-top: 16px;">
        <button id="deviceCancelBtn" style="flex: 1; padding: 10px; background: rgba(255,255,255,0.1); border: none; border-radius: 6px; color: #fff; cursor: pointer;">Cancel</button>
      </div>
    `;

    modal.appendChild(content);
    document.body.appendChild(modal);

    // Handle device selection
    content.querySelectorAll('.device-option').forEach(btn => {
      btn.addEventListener('click', async () => {
        const deviceId = btn.dataset.deviceId;
        const deviceLabel = btn.dataset.deviceLabel;

        // Update camera config
        cam.deviceId = deviceId;
        cam.deviceLabel = deviceLabel;

        // If this camera is enabled, restart with the new device
        if (cam.enabled) {
          // Stop current stream
          if (webcamStream) {
            webcamStream.getTracks().forEach(track => track.stop());
            webcamStream = null;
          }
          // Start new stream with specific device
          await startWebcamStream(deviceId);
          refreshLocalCameraVideos();
          renderCameraDock();
        }

        // Save to config
        saveSelectedDevice(cameraId, deviceId, deviceLabel);

        // Update UI
        populateCameraSelect();
        modal.remove();
        logMsg(`Selected: ${deviceLabel}`);
      });

      btn.addEventListener('mouseenter', () => {
        if (cam.deviceId !== btn.dataset.deviceId) {
          btn.style.background = 'rgba(255,255,255,0.2)';
        }
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.background = cam.deviceId === btn.dataset.deviceId
          ? 'var(--accent, #4dabf7)'
          : 'rgba(255,255,255,0.1)';
      });
    });

    // Handle cancel
    content.querySelector('#deviceCancelBtn').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });
  }

  // Save selected device to backend config
  async function saveSelectedDevice(cameraId, deviceId, deviceLabel) {
    try {
      // Find camera index and update
      const camIndex = cameras.findIndex(c => c.id === cameraId);
      if (camIndex === -1) return;

      // Send to backend to update config
      const response = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          [`camera_${camIndex}_device_id`]: deviceId,
          [`camera_${camIndex}_device_label`]: deviceLabel
        })
      });

      if (!response.ok) {
        console.warn('Failed to save device selection to config');
      }
    } catch (err) {
      console.warn('Error saving device selection:', err);
    }
  }

  // Handle toggling individual camera on/off
  async function handleCameraToggle(cameraId, enabled) {
    const cam = cameras.find(c => c.id === cameraId);
    if (cam) {
      cam.enabled = enabled;
    }

    // If enabling a local camera, start it with the configured device
    if (enabled && cam) {
      const source = getCameraSource(cam);
      const isLocalCamera = source.type === 'browser' || cam.sourceType === 'browser';

      if (isLocalCamera) {
        // Use camera's saved device ID if available
        await startWebcamStream(cam.deviceId || null);
      }
    }

    refreshLocalCameraVideos();
    updateCameraControlUI();
    renderCameraDock();
    renderCameraOverlays();
  }

  // Track active camera stream for local webcam
  let activeCameraStream = null;

  // Update camera control UI based on current state
  function updateCameraControlUI() {
    const cameraStatus = document.getElementById('cameraStatus');
    const startAllBtn = document.getElementById('startAllCameras');
    const stopAllBtn = document.getElementById('stopAllCameras');

    const enabledCameras = cameras.filter(c => c.enabled);
    const enabledCount = enabledCameras.length;
    const totalCount = cameras.length;

    // Check if any enabled camera needs the local webcam stream
    const needsLocalStream = enabledCameras.some(c => {
      const source = getCameraSource(c);
      return source.type === 'browser' || source.type === 'local';
    });

    // Update buttons
    if (startAllBtn) {
      startAllBtn.disabled = totalCount === 0;
    }
    if (stopAllBtn) {
      stopAllBtn.disabled = enabledCount === 0 && !webcamStream;
    }

    // Update status text
    if (cameraStatus) {
      if (enabledCount === 0) {
        cameraStatus.textContent = 'Select cameras above to display';
        cameraStatus.style.color = 'var(--text-muted)';
      } else if (needsLocalStream && webcamStream) {
        cameraStatus.textContent = `Showing ${enabledCount} camera${enabledCount > 1 ? 's' : ''} (webcam active)`;
        cameraStatus.style.color = 'var(--success)';
      } else if (needsLocalStream && !webcamStream) {
        cameraStatus.textContent = `${enabledCount} camera${enabledCount > 1 ? 's' : ''} selected - click Start All for local cameras`;
        cameraStatus.style.color = 'var(--warning)';
      } else {
        cameraStatus.textContent = `Showing ${enabledCount} camera${enabledCount > 1 ? 's' : ''}`;
        cameraStatus.style.color = 'var(--success)';
      }
    }
  }

  // Stop the active camera stream
  function stopActiveCamera() {
    if (activeCameraStream) {
      activeCameraStream.getTracks().forEach(track => track.stop());
      activeCameraStream = null;
    }
    if (webcamStream) {
      webcamStream.getTracks().forEach(track => track.stop());
      webcamStream = null;
    }

    // Clear hidden video element
    const videoElement = document.getElementById('webcamFeed');
    if (videoElement) videoElement.srcObject = null;

    if (webcamOverlay) {
      webcamOverlay.visible = false;
    }

    refreshLocalCameraVideos();
    renderCameraDock();
    renderCameraOverlays();
    updateCameraControlUI();
  }

  // Auto-start cameras that are enabled and need local webcam stream
  async function autoStartEnabledCameras() {
    const enabledCameras = cameras.filter(c => c.enabled);
    if (enabledCameras.length === 0) return;

    // Check if any enabled camera needs the local webcam stream
    const needsLocalStream = enabledCameras.some(c => {
      const source = getCameraSource(c);
      return source.type === 'browser' || source.type === 'local';
    });

    if (needsLocalStream && !webcamStream) {
      console.log('Auto-starting webcam for enabled cameras...');
      // Find the first enabled browser camera with a device ID preference
      const browserCam = enabledCameras.find(c => {
        const source = getCameraSource(c);
        return source.type === 'browser' || source.type === 'local';
      });
      const preferredDeviceId = browserCam?.deviceId || null;

      try {
        await startWebcamStream(preferredDeviceId);
        refreshLocalCameraVideos();
        renderCameraDock();
        renderCameraOverlays();
        updateCameraControlUI();
        logMsg('Cameras auto-started');
      } catch (err) {
        console.warn('Failed to auto-start webcam:', err);
        // Don't show error - user can manually start if needed
      }
    }
  }

  // Store floating camera positions
  const floatingCameraPositions = {};

  // Track cleanup functions for draggable elements to prevent memory leaks
  const draggableCleanupFunctions = [];

  function renderCameraDock() {
    const dock = document.getElementById('cameraDock');
    if (!dock) return;

    // Clean up any existing draggable listeners before rebuilding
    while (draggableCleanupFunctions.length > 0) {
      const cleanup = draggableCleanupFunctions.pop();
      if (typeof cleanup === 'function') cleanup();
    }

    dock.innerHTML = '';
    // Filter enabled cameras - only show dock mode cameras
    const enabledCams = cameras.filter(cam => {
      if (!cam.enabled) return false;
      // Only show cameras in 'dock' mode (floating windows)
      if (cam.displayMode === 'overlay') return false;

      // Get camera source info
      const source = getCameraSource(cam);

      // Show browser cameras when webcam stream is active
      if (source.type === 'browser' && !webcamStream) return false;
      // Show URL cameras when they have a source URL
      if ((source.type === 'rtsp' || source.type === 'http' || source.type === 'mjpeg') && !source.address) return false;
      // Hide cameras with invalid sources
      if (source.type === 'not_found') return false;

      return true;
    });
    dock.style.display = enabledCams.length ? 'block' : 'none';

    // Group cameras by position
    const positionGroups = {
      front: [],
      left: [],
      right: [],
      rear: [],
      floating: []
    };

    enabledCams.forEach(cam => {
      const pos = cam.position || 'floating';
      if (positionGroups[pos]) {
        positionGroups[pos].push(cam);
      } else {
        positionGroups.floating.push(cam);
      }
    });

    // Create position group containers and add cameras
    Object.entries(positionGroups).forEach(([position, cams]) => {
      if (cams.length === 0) return;

      // Create group container
      const group = document.createElement('div');
      group.className = `camera-position-group group-${position}`;

      cams.forEach((cam) => {
        const pane = document.createElement('div');
        pane.className = `camera-pane position-${position}`;
        pane.dataset.cameraId = cam.id;

        const header = document.createElement('div');
        header.className = 'camera-pane-header';
        header.innerHTML = `<span>${cam.name}</span><span style="font-size: 10px; color: #666;">${position}</span>`;
        pane.appendChild(header);

        // Get camera source info
        const source = getCameraSource(cam);

        let hasVideo = false;
        if (source.type === 'browser') {
          // Browser webcam - use webcamStream
          const video = document.createElement('video');
          video.autoplay = true;
          video.muted = true;
          video.playsInline = true;
          video.loop = true;
          video.dataset.sourceType = 'browser';
          video.dataset.cameraId = cam.id;
          if (webcamStream) {
            video.srcObject = webcamStream;
            hasVideo = true;
          }
          pane.appendChild(video);
        } else if (source.type === 'mjpeg') {
          // MJPEG stream - use img tag
          const img = document.createElement('img');
          img.src = source.address;
          img.dataset.sourceType = 'mjpeg';
          img.dataset.cameraId = cam.id;
          img.style.width = '100%';
          img.style.height = 'auto';
          img.style.objectFit = 'cover';
          pane.appendChild(img);
          hasVideo = true;
        } else if (source.type === 'rtsp' || source.type === 'http') {
          // URL-based video stream
          const video = document.createElement('video');
          video.autoplay = true;
          video.muted = true;
          video.playsInline = true;
          video.loop = true;
          video.src = source.address;
          video.dataset.sourceType = 'url';
          video.dataset.cameraId = cam.id;
          pane.appendChild(video);
          hasVideo = true;
        } else if (source.type === 'usb' || source.type === 'csi') {
          // Hardware camera via backend stream
          const video = document.createElement('video');
          video.autoplay = true;
          video.muted = true;
          video.playsInline = true;
          video.loop = true;
          if (source.address) {
            video.src = `/api/stream/${encodeURIComponent(source.address)}`;
            hasVideo = true;
          }
          video.dataset.sourceType = 'hardware';
          video.dataset.cameraId = cam.id;
          pane.appendChild(video);
        }

        if (!hasVideo) {
          const placeholder = document.createElement('div');
          placeholder.className = 'camera-placeholder';
          placeholder.textContent = source.type === 'browser'
            ? 'Click "Start Camera" to view this feed.'
            : 'Configure camera address to preview.';
          pane.appendChild(placeholder);
        }

        // Make floating panes draggable
        if (position === 'floating') {
          // Restore saved position or use default
          const savedPos = floatingCameraPositions[cam.id];
          if (savedPos) {
            pane.style.left = savedPos.x + 'px';
            pane.style.top = savedPos.y + 'px';
            pane.style.bottom = 'auto';
          } else {
            // Default position for new floating cameras - offset by index
            const idx = cams.indexOf(cam);
            pane.style.right = '20px';
            pane.style.top = (80 + idx * 180) + 'px';
          }

          makeDraggable(pane, header, cam.id);
        }

        group.appendChild(pane);
      });

      dock.appendChild(group);
    });
  }

  // Make an element draggable by its header
  function makeDraggable(element, handle, cameraId) {
    let isDragging = false;
    let startX, startY, initialX, initialY;

    handle.style.cursor = 'move';

    handle.addEventListener('mousedown', startDrag);
    handle.addEventListener('touchstart', startDrag, { passive: false });

    function startDrag(e) {
      if (e.type === 'touchstart') {
        e.preventDefault();
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
      } else {
        startX = e.clientX;
        startY = e.clientY;
      }

      const rect = element.getBoundingClientRect();
      initialX = rect.left;
      initialY = rect.top;
      isDragging = true;

      document.addEventListener('mousemove', drag);
      document.addEventListener('mouseup', stopDrag);
      document.addEventListener('touchmove', drag, { passive: false });
      document.addEventListener('touchend', stopDrag);
    }

    function drag(e) {
      if (!isDragging) return;

      let currentX, currentY;
      if (e.type === 'touchmove') {
        e.preventDefault();
        currentX = e.touches[0].clientX;
        currentY = e.touches[0].clientY;
      } else {
        currentX = e.clientX;
        currentY = e.clientY;
      }

      const deltaX = currentX - startX;
      const deltaY = currentY - startY;

      const newX = Math.max(0, Math.min(window.innerWidth - element.offsetWidth, initialX + deltaX));
      const newY = Math.max(0, Math.min(window.innerHeight - element.offsetHeight, initialY + deltaY));

      element.style.left = newX + 'px';
      element.style.top = newY + 'px';
      element.style.right = 'auto';
      element.style.bottom = 'auto';
    }

    function stopDrag() {
      if (!isDragging) return;
      isDragging = false;

      // Save position
      floatingCameraPositions[cameraId] = {
        x: parseInt(element.style.left),
        y: parseInt(element.style.top)
      };

      document.removeEventListener('mousemove', drag);
      document.removeEventListener('mouseup', stopDrag);
      document.removeEventListener('touchmove', drag);
      document.removeEventListener('touchend', stopDrag);
    }

    // Return cleanup function to remove all listeners
    function cleanup() {
      handle.removeEventListener('mousedown', startDrag);
      handle.removeEventListener('touchstart', startDrag);
      // Also remove document listeners in case drag is in progress
      document.removeEventListener('mousemove', drag);
      document.removeEventListener('mouseup', stopDrag);
      document.removeEventListener('touchmove', drag);
      document.removeEventListener('touchend', stopDrag);
    }

    // Register cleanup function for later use
    draggableCleanupFunctions.push(cleanup);
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

      // Common visualization config (shared across all legs)
      const vizConfig = {
        coxaRadius: config.viz_coxa_radius || DEFAULT_LEG_CONFIG.coxaRadius,
        femurRadius: config.viz_femur_radius || DEFAULT_LEG_CONFIG.femurRadius,
        tibiaRadius: config.viz_tibia_radius || DEFAULT_LEG_CONFIG.tibiaRadius,
        jointRadius: config.viz_joint_radius || DEFAULT_LEG_CONFIG.jointRadius,
        footRadius: config.viz_foot_radius || DEFAULT_LEG_CONFIG.footRadius
      };

      // Load per-leg configuration (falls back to global defaults)
      const defaultCoxa = config.leg_coxa_length || DEFAULT_LEG_CONFIG.coxaLength;
      const defaultFemur = config.leg_femur_length || DEFAULT_LEG_CONFIG.femurLength;
      const defaultTibia = config.leg_tibia_length || DEFAULT_LEG_CONFIG.tibiaLength;

      legConfigs = Array(6).fill(null).map((_, legIndex) => ({
        coxaLength: config[`leg${legIndex}_coxa_length`] ?? defaultCoxa,
        femurLength: config[`leg${legIndex}_femur_length`] ?? defaultFemur,
        tibiaLength: config[`leg${legIndex}_tibia_length`] ?? defaultTibia,
        ...vizConfig
      }));
      console.log('Loaded per-leg config from backend:', legConfigs);

      // Load leg attach points from config
      const defaultAttachPoints = [
        { x: 55, y: 65, z: 0, angle: 30 },
        { x: 0, y: 80, z: 0, angle: 50 },
        { x: -55, y: 65, z: 0, angle: 70 },
        { x: -55, y: -65, z: 0, angle: 290 },
        { x: 0, y: -80, z: 0, angle: 310 },
        { x: 55, y: -65, z: 0, angle: 330 }
      ];
      attachPoints = defaultAttachPoints.map((defaults, legIndex) => ({
        x: config[`leg_${legIndex}_attach_x`] ?? defaults.x,
        y: config[`leg_${legIndex}_attach_y`] ?? defaults.y,
        z: config[`leg_${legIndex}_attach_z`] ?? defaults.z,
        angle: config[`leg_${legIndex}_attach_angle`] ?? defaults.angle
      }));
      console.log('Loaded leg attach points from backend:', attachPoints);

      // Rebuild hexapod model with new attach points
      rebuildHexapodModel();

      // Load hardware cameras from config
      if (Array.isArray(config.hardware_cameras)) {
        hardwareCameras = config.hardware_cameras.map(cam => ({
          id: cam.id || '',
          name: cam.name || 'Camera',
          address: cam.address || '',
          type: cam.type || 'usb',
          resolution: cam.resolution || '1280x720',
          fps: cam.fps || 30,
          enabled: cam.enabled !== false
        }));
        console.log('Loaded hardware cameras:', hardwareCameras);
      } else {
        hardwareCameras = [];
        console.log('No hardware cameras in config');
      }

      // Load cameras from unified config
      if (Array.isArray(config.cameras)) {
        cameras = config.cameras.map((cam, idx) => normalizeCamera(cam, idx));
        console.log('Loaded cameras:', cameras);
      } else if (Array.isArray(config.camera_views)) {
        // Legacy format migration
        cameras = config.camera_views.map((view, idx) => normalizeCamera(view, idx));
        console.log('Migrated legacy camera_views to cameras:', cameras);
      } else {
        cameras = DEFAULT_CAMERAS.map(c => ({...c}));
        console.log('Using default cameras');
      }
      populateCameraSelect();
      updateCameraControlUI(); // Initialize camera control state
      renderCameraDock();
      renderCameraOverlays();

      // Auto-start enabled cameras after a short delay to let UI settle
      setTimeout(() => autoStartEnabledCameras(), 500);

      // Rebuild all legs with new dimensions
      if (typeof rebuildAllLegs === 'function') {
        rebuildAllLegs();
        applyDefaultVisualPose();
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

  // Load available gaits from API and populate the gait selector
  async function loadGaits() {
    const gaitSelect = document.getElementById('gait');
    if (!gaitSelect) return;

    try {
      const response = await fetch('/api/gaits');
      if (!response.ok) {
        console.warn('Failed to load gaits from backend, using defaults');
        return;
      }
      const data = await response.json();
      const gaits = data.gaits || {};
      const enabled = data.enabled || [];
      const current = data.current || 'tripod';

      // Clear existing options
      gaitSelect.innerHTML = '';

      // Add enabled gaits only
      enabled.forEach(gaitId => {
        const gait = gaits[gaitId];
        if (gait) {
          const option = document.createElement('option');
          option.value = gaitId;
          option.textContent = `${gait.name} (${gait.speed_range || 'N/A'})`;
          option.title = gait.description || '';
          if (gaitId === current) {
            option.selected = true;
          }
          gaitSelect.appendChild(option);
        }
      });

      console.log(`Loaded ${enabled.length} gaits from backend`);
    } catch(e) {
      console.warn('Failed to load gaits, using defaults:', e);
    }
  }

  // Load config from backend on startup (called after WebSocket connects)
  // Initial load happens after page load

  // Frontend no longer calculates IK - all leg angles come from backend telemetry
  // This ensures the visualization accurately mirrors the real hexapod state

  const legTargets = [];
  const groundContactStates = Array(6).fill(true);
  const manualControlTimestamps = Array(6).fill(-Infinity);
  const MANUAL_CONTROL_TIMEOUT = 5000; // 5 seconds in milliseconds

  const materialOverrides = {
    bodyMaterial: new THREE.MeshLambertMaterial({ color: 0x2d3b5a }),
    legMaterial: new THREE.MeshLambertMaterial({ color: 0x44dd88 }),
    jointMaterial: new THREE.MeshLambertMaterial({ color: 0x666666 }),
    footMaterial: new THREE.MeshLambertMaterial({ color: 0x333333 }),
    contactMaterial: new THREE.MeshBasicMaterial({
      color: 0x00ff00,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide
    })
  };

  let hexapodModel;
  let body;
  let legs = [];
  let groundContactIndicators = [];

  function rebuildHexapodModel() {
    if (hexapodModel) {
      hexapodModel.dispose();
    }

    const geometry = {
      body_radius: 80,  // Octagonal body radius
      body_height_geo: 30,  // Thinner body
      leg_coxa_length: legConfigs[0].coxaLength,
      leg_femur_length: legConfigs[0].femurLength,
      leg_tibia_length: legConfigs[0].tibiaLength,
      leg_attach_points: attachPoints
    };

    hexapodModel = Hexapod3D.buildHexapod({
      THREE,
      scene,
      geometry,
      bodyHeight: defaultBodyY,
      groundY: GROUND_Y,
      materials: materialOverrides,
      defaultPose: Hexapod3D.computeGroundingAngles(defaultBodyY, geometry, GROUND_Y)
    });

    body = hexapodModel.body;
    legs = hexapodModel.legs;
    groundContactIndicators = hexapodModel.contactIndicators;

    legTargets.length = 0;
    for (let i = 0; i < legs.length; i++) {
      legTargets.push({
        coxa: DEFAULT_VISUAL_POSE.coxa,
        femur: legs[i].femurJoint.rotation.x,
        tibia: legs[i].tibiaJoint.rotation.x
      });
    }
  }

  rebuildHexapodModel();

  // UI controls
  const runBtn = document.getElementById('run');
  const gaitSelect = document.getElementById('gait');
  const speedSlider = document.getElementById('speedSlider');
  const log = document.getElementById('log');

  // Movement state
  let walking = false;
  let currentSpeed = 0.5;    // 0-1
  let currentHeading = 0;    // 0-360 degrees
  let currentTurnRate = 0;   // -1 to 1: differential steering for Q/E
  let keysPressed = {};

  // Rotation state (for Q/E keys and rotation buttons)
  let isRotatingLeft = false;
  let isRotatingRight = false;

  function updateRunButtonTheme() {
    if (!runBtn) return;
    const bgColor = walking ? getThemeColor('--danger', '#ff6b6b') : getThemeColor('--success', '#51cf66');
    runBtn.style.background = bgColor;
    // Use white text for better contrast on colored backgrounds
    runBtn.style.color = '#ffffff';
    runBtn.style.textShadow = '0 1px 2px rgba(0, 0, 0, 0.3)';
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

      if (distance > JOYSTICK_DEADZONE) {
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
      const x = ((e.clientX - rect.left) - centerX) / JOYSTICK_SCALE;
      const y = -((e.clientY - rect.top) - centerY) / JOYSTICK_SCALE;

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
      const x = ((touch.clientX - rect.left) - centerX) / JOYSTICK_SCALE;
      const y = -((touch.clientY - rect.top) - centerY) / JOYSTICK_SCALE;

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

  // Consistent error handling - logs to console and UI
  function logError(context, error) {
    const errorMsg = error && error.message ? error.message : String(error);
    console.error(`[${context}]`, error);
    logMsg(`Error: ${context} - ${errorMsg}`);
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
      // Remove disconnected state from UI
      document.getElementById('ui').classList.remove('disconnected');
      document.getElementById('disconnectedBanner').classList.remove('visible');
      // Load configuration from backend API
      loadConfigFromBackend();
      // Load available gaits from API
      loadGaits();
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

              // Femur and tibia: convert from servo convention (90° = neutral) to radians
              // No sign flip needed - Three.js leg group rotations already handle
              // left vs right mirroring via legGroup.rotation.y
              legTargets[i].femur = (f - 90) * Math.PI / 180;
              legTargets[i].tibia = (t - 90) * Math.PI / 180;
            }
          }
          if (Array.isArray(m.ground_contacts) && m.ground_contacts.length === 6) {
            for (let i = 0; i < 6; i++) {
              groundContactStates[i] = !!m.ground_contacts[i];
            }
          }
          // Update walking state from backend and sync UI
          const backendWalking = m.running || false;
          if (walking !== backendWalking) {
            walking = backendWalking;
            runBtn.textContent = walking ? 'Stop Walking' : 'Start Walking';
            updateRunButtonTheme();
          }

          // Update status display with gauges
          if (m.temperature_c !== undefined) {
            const temp = m.temperature_c;
            document.getElementById('temp').textContent = temp.toFixed(1) + ' °C';
            // Temperature gauge: 0-80°C range
            const tempPercent = Math.min(100, Math.max(0, (temp / 80) * 100));
            const tempGauge = document.getElementById('tempGauge');
            if (tempGauge) {
              tempGauge.style.width = tempPercent + '%';
              // Color coding: green < 40°C, yellow 40-60°C, red > 60°C
              tempGauge.classList.remove('good', 'warning', 'danger');
              if (temp < 40) tempGauge.classList.add('good');
              else if (temp < 60) tempGauge.classList.add('warning');
              else tempGauge.classList.add('danger');
            }
          }
          if (m.battery_v !== undefined) {
            const batt = m.battery_v;
            document.getElementById('batt').textContent = batt.toFixed(2) + ' V';
            // Battery gauge: 9V (empty) to 12.6V (full) for 3S LiPo
            const battPercent = Math.min(100, Math.max(0, ((batt - 9) / 3.6) * 100));
            const battGauge = document.getElementById('battGauge');
            if (battGauge) {
              battGauge.style.width = battPercent + '%';
              // Color coding: red < 20%, yellow 20-40%, green > 40%
              battGauge.classList.remove('good', 'warning', 'danger');
              if (battPercent > 40) battGauge.classList.add('good');
              else if (battPercent > 20) battGauge.classList.add('warning');
              else battGauge.classList.add('danger');
            }
          }
        }
      } catch (e) {
        console.error('Telemetry parse error:', e);
      }
    };

    ws.onerror = () => {
      document.getElementById('connectionStatus').textContent = 'Error';
      document.getElementById('connectionStatus').style.color = getThemeColor('--danger', '#ff6b6b');
      // Show disconnected state
      document.getElementById('ui').classList.add('disconnected');
      document.getElementById('disconnectedBanner').classList.add('visible');
    };

    ws.onclose = () => {
      document.getElementById('connectionStatus').textContent = 'Disconnected';
      document.getElementById('connectionStatus').style.color = getThemeColor('--danger', '#ff6b6b');
      // Show disconnected state
      document.getElementById('ui').classList.add('disconnected');
      document.getElementById('disconnectedBanner').classList.add('visible');

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

  // Start in disconnected state until connection is established
  document.getElementById('ui').classList.add('disconnected');
  document.getElementById('disconnectedBanner').classList.add('visible');

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
      turn: currentTurnRate,  // Differential steering: -1 left, +1 right
      walking: walking
    }));
  }

  // Update current heading based on keys pressed
  function updateHeading(){
    let dx = 0, dy = 0;

    // WASD / Arrow keys for directional movement
    if(keysPressed['ArrowUp'] || keysPressed['w'] || keysPressed['W']) dy += 1;
    if(keysPressed['ArrowDown'] || keysPressed['s'] || keysPressed['S']) dy -= 1;
    if(keysPressed['ArrowLeft'] || keysPressed['a'] || keysPressed['A']) dx -= 1;
    if(keysPressed['ArrowRight'] || keysPressed['d'] || keysPressed['D']) dx += 1;

    // Q/E for walking and turning (differential steering handled by backend)
    const qPressed = keysPressed['q'] || keysPressed['Q'];
    const ePressed = keysPressed['e'] || keysPressed['E'];
    // Set turn rate: -1 = turn left, +1 = turn right, 0 = straight
    currentTurnRate = qPressed ? -1.0 : (ePressed ? 1.0 : 0.0);
    if(qPressed || ePressed) {
      dy += 1;  // Walk forward while turning
    }

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
    // Movement keys (WASD, arrows, and Q/E for turning)
    if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','w','W','a','A','s','S','d','D','q','Q','e','E'].includes(e.key)){
      keysPressed[e.key] = true;
      // Highlight buttons when keys pressed
      if (e.key === 'q' || e.key === 'Q') {
        const btn = document.getElementById('rotateLeft');
        if (btn) btn.classList.add('active');
      }
      if (e.key === 'e' || e.key === 'E') {
        const btn = document.getElementById('rotateRight');
        if (btn) btn.classList.add('active');
      }
      if (e.key === 'w' || e.key === 'W' || e.key === 'ArrowUp') {
        const btn = document.getElementById('btn-up');
        if (btn) btn.classList.add('active');
      }
      if (e.key === 's' || e.key === 'S' || e.key === 'ArrowDown') {
        const btn = document.getElementById('btn-down');
        if (btn) btn.classList.add('active');
      }
      if (e.key === 'a' || e.key === 'A' || e.key === 'ArrowLeft') {
        const btn = document.getElementById('btn-left');
        if (btn) btn.classList.add('active');
      }
      if (e.key === 'd' || e.key === 'D' || e.key === 'ArrowRight') {
        const btn = document.getElementById('btn-right');
        if (btn) btn.classList.add('active');
      }
      updateHeading();
    }
  });

  document.addEventListener('keyup', (e) => {
    // Movement keys (WASD, arrows, and Q/E for turning)
    if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','w','W','a','A','s','S','d','D','q','Q','e','E'].includes(e.key)){
      keysPressed[e.key] = false;
      // Remove highlight from buttons when keys released
      if (e.key === 'q' || e.key === 'Q') {
        const btn = document.getElementById('rotateLeft');
        if (btn) btn.classList.remove('active');
      }
      if (e.key === 'e' || e.key === 'E') {
        const btn = document.getElementById('rotateRight');
        if (btn) btn.classList.remove('active');
      }
      if (e.key === 'w' || e.key === 'W' || e.key === 'ArrowUp') {
        const btn = document.getElementById('btn-up');
        if (btn) btn.classList.remove('active');
      }
      if (e.key === 's' || e.key === 'S' || e.key === 'ArrowDown') {
        const btn = document.getElementById('btn-down');
        if (btn) btn.classList.remove('active');
      }
      if (e.key === 'a' || e.key === 'A' || e.key === 'ArrowLeft') {
        const btn = document.getElementById('btn-left');
        if (btn) btn.classList.remove('active');
      }
      if (e.key === 'd' || e.key === 'D' || e.key === 'ArrowRight') {
        const btn = document.getElementById('btn-right');
        if (btn) btn.classList.remove('active');
      }
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

    // Update body visual position (with null check)
    if (body) {
      body.position.y = height;
    }

    // Update all leg visual positions (Y position only - leg angles come from backend)
    if (legs && legs.length > 0) {
      legs.forEach((leg) => {
        if (leg && leg.group) {
          leg.group.position.y = height;
        }
      });
    }

    // Send body height to backend via WebSocket
    // Backend calculates IK and sends angles back via telemetry
    // DO NOT calculate leg angles locally - all IK is done on backend
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

    updateUI();

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

        // Show indicator when enabled and colorize from backend ground-contact telemetry
        groundContactIndicators[i].visible = settingsValues.showGroundContact;
        if (groundContactStates[i]) {
          // Firm ground contact -> green
          groundContactIndicators[i].material.color.setRGB(0.0, 1.0, 0.0);
        } else {
          // Swing phase -> orange
          groundContactIndicators[i].material.color.setRGB(1.0, 0.6, 0.0);
        }
      }
    }

    // Keep body stable - no bobbing to avoid disturbing movement
    if (body) {
      body.position.y = defaultBodyY;
      body.rotation.x = 0;
      body.rotation.z = 0;
    }

    // Update webcam overlay texture if active
    if (webcamOverlay && webcamOverlay.visible) {
      webcamOverlay.material.map.needsUpdate = true;
    }

    // Update camera overlay textures
    Object.values(cameraOverlayMeshes).forEach(mesh => {
      if (mesh && mesh.material && mesh.material.map) {
        mesh.material.map.needsUpdate = true;
      }
    });

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

  // Settings values
  let settingsValues = {
    smoothing: 0.2,
    showGroundContact: true,
    showShadows: true,
    showFPS: false
  };

  // Theme presets and helpers
  const THEME_STORAGE_KEY = 'hexapod-theme';
  const VISUAL_STORAGE_KEY = 'hexapod-visual-settings';
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
    },
    matrix: {
      label: 'Matrix Terminal',
      values: {
        '--accent': '#00ff41',
        '--panel-bg': '#0a0a0a',
        '--control-bg': '#0f1510',
        '--panel-border': '#1a2f1a',
        '--text-primary': '#00ff41',
        '--text-muted': '#4a9f4a',
        '--success': '#00ff41',
        '--danger': '#ff3333'
      }
    },
    cyberpunk: {
      label: 'Cyberpunk Neon',
      values: {
        '--accent': '#ff00ff',
        '--panel-bg': '#0d0221',
        '--control-bg': '#150535',
        '--panel-border': '#3d1a5c',
        '--text-primary': '#ff9efc',
        '--text-muted': '#b06ab3',
        '--success': '#00ffcc',
        '--danger': '#ff3366'
      }
    },
    ocean: {
      label: 'Deep Ocean',
      values: {
        '--accent': '#00b4d8',
        '--panel-bg': '#03111a',
        '--control-bg': '#051923',
        '--panel-border': '#0a3d62',
        '--text-primary': '#caf0f8',
        '--text-muted': '#6ba3be',
        '--success': '#48cae4',
        '--danger': '#f77f7f'
      }
    },
    ember: {
      label: 'Ember Forge',
      values: {
        '--accent': '#ff5722',
        '--panel-bg': '#1a0a05',
        '--control-bg': '#2a1208',
        '--panel-border': '#4a2010',
        '--text-primary': '#ffe0d0',
        '--text-muted': '#c09080',
        '--success': '#8bc34a',
        '--danger': '#ff1744'
      }
    },
    arctic: {
      label: 'Arctic Frost',
      values: {
        '--accent': '#89cff0',
        '--panel-bg': '#0e1624',
        '--control-bg': '#152238',
        '--panel-border': '#2a4060',
        '--text-primary': '#e8f4fc',
        '--text-muted': '#8ab4d0',
        '--success': '#7dcea0',
        '--danger': '#e57373'
      }
    },
    midnight: {
      label: 'Midnight Purple',
      values: {
        '--accent': '#9d4edd',
        '--panel-bg': '#10002b',
        '--control-bg': '#1a0040',
        '--panel-border': '#3c096c',
        '--text-primary': '#e0aaff',
        '--text-muted': '#9d6dc0',
        '--success': '#72efdd',
        '--danger': '#ff6b6b'
      }
    },
    military: {
      label: 'Tactical OD',
      values: {
        '--accent': '#9acd32',
        '--panel-bg': '#0c120a',
        '--control-bg': '#141f10',
        '--panel-border': '#2a3a20',
        '--text-primary': '#d4e6c3',
        '--text-muted': '#8aa076',
        '--success': '#9acd32',
        '--danger': '#dc3545'
      }
    },
    gold: {
      label: 'Royal Gold',
      values: {
        '--accent': '#ffd700',
        '--panel-bg': '#0f0d08',
        '--control-bg': '#1a1610',
        '--panel-border': '#3d350a',
        '--text-primary': '#fff8dc',
        '--text-muted': '#c0a060',
        '--success': '#98fb98',
        '--danger': '#ff6347'
      }
    },
    stealth: {
      label: 'Stealth Mode',
      values: {
        '--accent': '#505050',
        '--panel-bg': '#0a0a0a',
        '--control-bg': '#141414',
        '--panel-border': '#252525',
        '--text-primary': '#b0b0b0',
        '--text-muted': '#606060',
        '--success': '#4a9f4a',
        '--danger': '#9f4a4a'
      }
    }
  };

  let activeTheme = {...themePresets.aurora.values};

  function getThemeColor(varName, fallback = '#ffffff') {
    const value = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    return value || fallback;
  }

  function applyTheme(values, skipSave = false) {
    // Only update CSS properties that have actually changed
    const changedKeys = [];
    Object.entries(values).forEach(([key, value]) => {
      if (activeTheme[key] !== value) {
        changedKeys.push(key);
        document.documentElement.style.setProperty(key, value);
      }
    });
    activeTheme = {...activeTheme, ...values};

    // Only redraw if relevant colors changed
    const needsRedraw = changedKeys.some(k =>
      k === '--accent' || k === '--panel-strong' || k === '--panel-border' ||
      k === '--text-muted' || k === '--success' || k === '--danger'
    );
    if (needsRedraw || changedKeys.length === Object.keys(activeTheme).length) {
      updateRunButtonTheme();
      drawJoystick();
    }

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

  // Visual settings (3D scene) save/load
  function saveVisualSettings() {
    const settings = {
      showGrid: document.getElementById('showGrid')?.checked ?? true,
      showShadows: document.getElementById('showShadows')?.checked ?? true,
      bodyColor: document.getElementById('bodyColor')?.value ?? '#333333',
      groundColor: document.getElementById('groundColor')?.value ?? '#66aa44',
      skyColor: document.getElementById('skyColor')?.value ?? '#87ceeb'
    };
    localStorage.setItem(VISUAL_STORAGE_KEY, JSON.stringify(settings));
  }

  function loadVisualSettings() {
    const saved = localStorage.getItem(VISUAL_STORAGE_KEY);
    if (saved) {
      try {
        const settings = JSON.parse(saved);

        // Apply grid visibility
        if (settings.showGrid !== undefined) {
          const gridCheckbox = document.getElementById('showGrid');
          if (gridCheckbox) {
            gridCheckbox.checked = settings.showGrid;
            gridHelper.visible = settings.showGrid;
          }
        }

        // Apply shadows
        if (settings.showShadows !== undefined) {
          const shadowCheckbox = document.getElementById('showShadows');
          if (shadowCheckbox) {
            shadowCheckbox.checked = settings.showShadows;
            settingsValues.showShadows = settings.showShadows;
            body.castShadow = settings.showShadows;
            body.receiveShadow = settings.showShadows;
            legs.forEach(leg => {
              leg.group.traverse(child => {
                if (child.isMesh) {
                  child.castShadow = settings.showShadows;
                  child.receiveShadow = settings.showShadows;
                }
              });
            });
          }
        }

        // Apply body color
        if (settings.bodyColor) {
          const bodyColorInput = document.getElementById('bodyColor');
          if (bodyColorInput) {
            bodyColorInput.value = settings.bodyColor;
            body.material.color.setStyle(settings.bodyColor);
          }
        }

        // Apply ground color
        if (settings.groundColor) {
          const groundColorInput = document.getElementById('groundColor');
          if (groundColorInput) {
            groundColorInput.value = settings.groundColor;
            ground.material.color.setStyle(settings.groundColor);
          }
        }

        // Apply sky color
        if (settings.skyColor) {
          const skyColorInput = document.getElementById('skyColor');
          if (skyColorInput) {
            skyColorInput.value = settings.skyColor;
            scene.background.setStyle(settings.skyColor);
            scene.fog.color.setStyle(settings.skyColor);
          }
        }
      } catch (e) {
        console.warn('Failed to load saved visual settings:', e);
      }
    }
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

  // Load saved visual settings (3D scene colors, grid, shadows)
  loadVisualSettings();

  // Initialize leg configuration UI (legacy - now using unified Legs tab with SVG diagram)
  function initializeConfigUI() {
    // Skip if container doesn't exist (using new unified UI instead)
    if (!legConfigContainer) {
      return;
    }

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

    }
  }

  // Apply default visual pose to all legs (no IK calculation)
  // This is ONLY for initial display - backend telemetry will override with real angles
  // DO NOT add IK calculations here - all IK is done on backend
  function applyDefaultVisualPose() {
    const now = performance.now();

    for (let i = 0; i < legs.length; i++) {
      legTargets[i].coxa = DEFAULT_VISUAL_POSE.coxa;
      legTargets[i].femur = DEFAULT_VISUAL_POSE.femur;
      legTargets[i].tibia = DEFAULT_VISUAL_POSE.tibia;

      const underManualControl = (now - manualControlTimestamps[i]) < MANUAL_CONTROL_TIMEOUT;
      if (!underManualControl) {
        legs[i].coxaJoint.rotation.y = DEFAULT_VISUAL_POSE.coxa;
        legs[i].femurJoint.rotation.x = DEFAULT_VISUAL_POSE.femur;
        legs[i].tibiaJoint.rotation.x = DEFAULT_VISUAL_POSE.tibia;
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

  // Update leg configuration - saves to backend (per-leg configuration)
  function updateLegConfig(legIndex, part, value) {
    // Map part name to backend config key (per-leg)
    let backendKey;
    if (part === 'coxa') {
      backendKey = `leg${legIndex}_coxa_length`;
      legConfigs[legIndex].coxaLength = value;
    } else if (part === 'femur') {
      backendKey = `leg${legIndex}_femur_length`;
      legConfigs[legIndex].femurLength = value;
    } else if (part === 'tibia') {
      backendKey = `leg${legIndex}_tibia_length`;
      legConfigs[legIndex].tibiaLength = value;
    }

    // Save to backend API
    if (backendKey) {
      saveConfigToBackend({[backendKey]: value});
    }

    // Rebuild with shared geometry so the preview stays in sync
    rebuildHexapodModel();
    applyDefaultVisualPose();

    logMsg(`Updated leg ${legIndex} ${part} length to ${value}mm`);
  }

  // Save all dimensions for a leg to backend
  function saveLegDimensions(legIndex) {
    const config = legConfigs[legIndex];
    saveConfigToBackend({
      [`leg${legIndex}_coxa_length`]: config.coxaLength,
      [`leg${legIndex}_femur_length`]: config.femurLength,
      [`leg${legIndex}_tibia_length`]: config.tibiaLength
    });
    rebuildHexapodModel();
    applyDefaultVisualPose();
  }

  function rebuildLeg() {
    rebuildHexapodModel();
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
      new THREE.CylinderGeometry(legCfg.coxaRadius, legCfg.coxaRadius, legCfg.coxaLength, 12),
      new THREE.MeshLambertMaterial({color: 0x44dd88})
    );
    coxaMesh.rotation.x = Math.PI / 2;
    coxaMesh.position.z = legCfg.coxaLength / 2;
    coxaJoint.add(coxaMesh);

    // Femur
    const femurJoint = new THREE.Group();
    femurJoint.position.z = legCfg.coxaLength;
    const femurMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(legCfg.femurRadius, legCfg.femurRadius, legCfg.femurLength, 12),
      new THREE.MeshLambertMaterial({color: 0x44dd88})
    );
    femurMesh.position.y = -legCfg.femurLength / 2;
    femurJoint.add(femurMesh);
    femurJoint.rotation.x = -0.5;

    // Tibia
    const tibiaJoint = new THREE.Group();
    tibiaJoint.position.y = -legCfg.femurLength;
    const tibiaMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(legCfg.tibiaRadius, legCfg.tibiaRadius, legCfg.tibiaLength, 12),
      new THREE.MeshLambertMaterial({color: 0x44dd88})
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

    // Save per-leg defaults to backend
    const updates = {};
    for (let i = 0; i < 6; i++) {
      updates[`leg${i}_coxa_length`] = DEFAULT_LEG_CONFIG.coxaLength;
      updates[`leg${i}_femur_length`] = DEFAULT_LEG_CONFIG.femurLength;
      updates[`leg${i}_tibia_length`] = DEFAULT_LEG_CONFIG.tibiaLength;
      // Also reset servo offsets
      updates[`servo_offset_leg${i}_joint0`] = 0;
      updates[`servo_offset_leg${i}_joint1`] = 0;
      updates[`servo_offset_leg${i}_joint2`] = 0;
    }
    saveConfigToBackend(updates);

    // Reset calibration state offsets
    if (typeof calibrationState !== 'undefined') {
      for (let i = 0; i < 6; i++) {
        calibrationState.offsets[i] = {coxa: 0, femur: 0, tibia: 0};
      }
    }

    rebuildAllLegs();
    applyDefaultVisualPose();
    logMsg('All legs reset to defaults (dimensions and offsets)');
  }

  // Reset all legs (only if button exists in UI)
  const resetAllLegsBtn = document.getElementById('resetAllLegs');
  if (resetAllLegsBtn) {
    resetAllLegsBtn.addEventListener('click', () => {
      if (confirm('Reset all leg dimensions and servo offsets to default values?')) {
        resetAllLegsToDefaults();
        // Update UI if calibration is active
        if (typeof updateGauges === 'function') updateGauges();
        if (typeof updateDiagramStatus === 'function') updateDiagramStatus();
      }
    });
  }

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
    saveVisualSettings();
  });

  // Grid toggle
  document.getElementById('showGrid').addEventListener('change', (e) => {
    gridHelper.visible = e.target.checked;
    saveVisualSettings();
  });

  // Body color
  document.getElementById('bodyColor').addEventListener('input', (e) => {
    body.material.color.setStyle(e.target.value);
    saveVisualSettings();
  });

  // Ground color
  document.getElementById('groundColor').addEventListener('input', (e) => {
    ground.material.color.setStyle(e.target.value);
    saveVisualSettings();
  });

  // Sky color
  document.getElementById('skyColor').addEventListener('input', (e) => {
    scene.background.setStyle(e.target.value);
    scene.fog.color.setStyle(e.target.value);
    saveVisualSettings();
  });

  // Webcam variables (declared before use in renderCameraDock)
  let webcamStream = null;
  let webcamOverlay = null;
  let webcamInitializing = false; // Lock to prevent concurrent initialization

  /**
   * Start the browser webcam stream with race condition protection.
   * @param {string} deviceId - Optional specific device ID to use
   * Returns the stream if successful, null if failed or already initializing.
   */
  async function startWebcamStream(deviceId = null) {
    // If requesting a specific device and current stream uses different device, stop it
    if (deviceId && webcamStream) {
      const currentTrack = webcamStream.getVideoTracks()[0];
      const currentDeviceId = currentTrack?.getSettings()?.deviceId;
      if (currentDeviceId !== deviceId) {
        // Stop current stream to switch devices
        webcamStream.getTracks().forEach(track => track.stop());
        webcamStream = null;
      }
    }

    // Return existing stream if already running and no specific device requested
    if (webcamStream && !deviceId) {
      return webcamStream;
    }

    // Prevent concurrent initialization attempts
    if (webcamInitializing) {
      logMsg('Webcam initialization already in progress...');
      // Wait for the existing initialization to complete
      let attempts = 0;
      while (webcamInitializing && attempts < 50) {
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
      }
      return webcamStream;
    }

    webcamInitializing = true;

    try {
      // Build constraints - use specific device if provided
      const videoConstraints = deviceId
        ? { deviceId: { exact: deviceId } }
        : { facingMode: 'user' };
      const constraints = { video: videoConstraints, audio: false };

      webcamStream = await navigator.mediaDevices.getUserMedia(constraints);
      activeCameraStream = webcamStream;

      // Assign stream to hidden video element for overlay support
      const videoElement = document.getElementById('webcamFeed');
      if (videoElement) {
        videoElement.srcObject = webcamStream;
        // Ensure video starts playing (needed for VideoTexture)
        await videoElement.play().catch(() => {});
      }

      logMsg('Webcam started');
      return webcamStream;
    } catch (err) {
      logError('Webcam', err);
      return null;
    } finally {
      webcamInitializing = false;
    }
  }

  // Track camera overlay meshes for 3D scene (keyed by camera id)
  const cameraOverlayMeshes = {};

  // Get the default overlay opacity from the slider
  function getOverlayOpacity() {
    const slider = document.getElementById('webcamOpacity');
    const sliderVal = slider ? parseFloat(slider.value) : 30;
    return 1.0 - (sliderVal / 100);  // Inverted: 0% slider = opaque
  }

  // Create a placeholder texture for cameras without feed
  function createPlaceholderTexture(label, position) {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 240;
    const ctx = canvas.getContext('2d');

    // Dark background
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Border
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);

    // Camera icon (simple representation)
    ctx.fillStyle = '#333';
    ctx.beginPath();
    ctx.roundRect(110, 70, 100, 70, 8);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(160, 105, 25, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1a1a2e';
    ctx.beginPath();
    ctx.arc(160, 105, 15, 0, Math.PI * 2);
    ctx.fill();

    // "No Feed" text
    ctx.fillStyle = '#888';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No Feed', canvas.width / 2, 165);

    // Camera label
    ctx.fillStyle = '#aaa';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText(label || 'Camera', canvas.width / 2, 190);

    // Position indicator
    ctx.fillStyle = '#666';
    ctx.font = '11px sans-serif';
    ctx.fillText(position || 'front', canvas.width / 2, 210);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  }

  // Position an overlay mesh based on camera position setting
  // Positions are from the USER's perspective (screen-left/right), not hexapod-space.
  // Since the default view is from behind the hexapod (cameraAngleY = PI),
  // we swap X coordinates so "left" appears on screen-left and "right" on screen-right.
  function positionOverlayMesh(mesh, position, idx) {
    switch (position) {
      case 'front':
        // Front: in front of hexapod, facing backward toward camera
        mesh.position.set(0, 100, 250);
        mesh.rotation.set(0, 0, 0);
        break;
      case 'rear':
        // Rear: lying flat on the ground behind the hexapod
        mesh.position.set(0, 0, -150);
        mesh.rotation.set(-Math.PI / 2, 0, Math.PI);  // Lay flat, flipped 180°
        break;
      case 'left':
        // Left: appears on screen-left (positive X in default back-view)
        mesh.position.set(200, 100, 200);
        mesh.rotation.set(0, Math.PI / 4, 0);  // 45° leaning toward front
        break;
      case 'right':
        // Right: appears on screen-right (negative X in default back-view)
        mesh.position.set(-200, 100, 200);
        mesh.rotation.set(0, -Math.PI / 4, 0);  // -45° leaning toward front
        break;
      case 'floating':
      default:
        // Floating: stacked in front
        mesh.position.set(0, 100 + (idx * 20), 200 + (idx * 30));
        mesh.rotation.set(0, 0, 0);
        break;
    }
  }

  // Render camera overlays in the 3D scene for cameras with displayMode === 'overlay'
  function renderCameraOverlays() {
    // Get cameras that should be overlays (show all enabled overlay cameras)
    const overlayCams = cameras.filter(cam => {
      if (!cam.enabled) return false;
      if (cam.displayMode !== 'overlay') return false;

      // Get camera source info
      const source = getCameraSource(cam);

      // Hide cameras with invalid sources
      if (source.type === 'not_found') return false;

      return true;
    });

    // Remove overlays that are no longer needed
    Object.keys(cameraOverlayMeshes).forEach(id => {
      if (!overlayCams.find(cam => cam.id === id)) {
        const mesh = cameraOverlayMeshes[id];
        if (mesh) {
          scene.remove(mesh);
          if (mesh.material.map) mesh.material.map.dispose();
          mesh.material.dispose();
          mesh.geometry.dispose();
          // Clean up video element if it was created
          if (mesh.userData.videoElement) {
            mesh.userData.videoElement.pause();
            mesh.userData.videoElement.src = '';
          }
          // Clean up img element for MJPEG streams
          if (mesh.userData.imgElement) {
            // Clear update interval
            if (mesh.userData.imgElement._updateInterval) {
              clearInterval(mesh.userData.imgElement._updateInterval);
            }
            mesh.userData.imgElement.src = '';
            if (mesh.userData.imgElement.parentNode) {
              mesh.userData.imgElement.parentNode.removeChild(mesh.userData.imgElement);
            }
          }
        }
        delete cameraOverlayMeshes[id];
      }
    });

    // Create or update overlays for active overlay cameras
    overlayCams.forEach((cam, idx) => {
      // Get camera source info
      const source = getCameraSource(cam);
      const isBrowserCamera = source.type === 'browser';

      // Check if feed is available
      const hasFeed = isBrowserCamera ? !!webcamStream : !!source.address;

      if (!cameraOverlayMeshes[cam.id]) {
        // Create new overlay
        let texture;
        let videoElement = null;
        let imgElement = null;

        if (hasFeed) {
          if (isBrowserCamera) {
            videoElement = document.getElementById('webcamFeed');
            texture = new THREE.VideoTexture(videoElement);
            texture.minFilter = THREE.LinearFilter;
            texture.magFilter = THREE.LinearFilter;
          } else if (source.type === 'mjpeg') {
            // MJPEG stream - use img element with onload for frame updates
            imgElement = document.createElement('img');
            imgElement.style.display = 'none';
            document.body.appendChild(imgElement);

            texture = new THREE.Texture(imgElement);
            texture.minFilter = THREE.LinearFilter;
            texture.magFilter = THREE.LinearFilter;
            texture.colorSpace = THREE.SRGBColorSpace;

            // Update texture when each MJPEG frame loads
            imgElement.onload = () => {
              texture.needsUpdate = true;
            };

            // Set src after onload handler to catch first frame
            imgElement.src = source.address;
          } else {
            // For video URL sources, create a hidden video element
            videoElement = document.createElement('video');
            videoElement.autoplay = true;
            videoElement.muted = true;
            videoElement.playsInline = true;
            videoElement.loop = true;
            videoElement.crossOrigin = 'anonymous';
            videoElement.src = source.address;
            videoElement.play().catch(() => {});
            texture = new THREE.VideoTexture(videoElement);
            texture.minFilter = THREE.LinearFilter;
            texture.magFilter = THREE.LinearFilter;
          }
        } else {
          // No feed - show placeholder
          texture = createPlaceholderTexture(cam.name, cam.position);
        }

        const overlayGeom = new THREE.PlaneGeometry(200, 150);
        const overlayMat = new THREE.MeshBasicMaterial({
          map: texture,
          transparent: true,
          opacity: getOverlayOpacity(),
          side: THREE.DoubleSide
        });
        const overlayMesh = new THREE.Mesh(overlayGeom, overlayMat);

        // Position overlay based on configured camera position
        positionOverlayMesh(overlayMesh, cam.position || 'front', idx);

        scene.add(overlayMesh);
        cameraOverlayMeshes[cam.id] = overlayMesh;

        // Store metadata
        overlayMesh.userData.isBrowserCamera = isBrowserCamera;
        overlayMesh.userData.sourceType = source.type;
        overlayMesh.userData.hasFeed = hasFeed;
        if (!isBrowserCamera && videoElement) {
          overlayMesh.userData.videoElement = videoElement;
        }
        if (imgElement) {
          overlayMesh.userData.imgElement = imgElement;
        }
      } else {
        // Update existing overlay
        const mesh = cameraOverlayMeshes[cam.id];
        if (mesh && mesh.material) {
          mesh.material.opacity = getOverlayOpacity();

          // Check if feed status changed (e.g., webcam started/stopped)
          const hadFeed = mesh.userData.hasFeed;
          if (hasFeed !== hadFeed) {
            // Feed status changed - recreate texture
            if (mesh.material.map) mesh.material.map.dispose();

            if (hasFeed) {
              let videoElement;
              if (isBrowserCamera) {
                videoElement = document.getElementById('webcamFeed');
              } else {
                videoElement = mesh.userData.videoElement;
              }
              if (videoElement) {
                const videoTexture = new THREE.VideoTexture(videoElement);
                videoTexture.minFilter = THREE.LinearFilter;
                videoTexture.magFilter = THREE.LinearFilter;
                mesh.material.map = videoTexture;
              }
            } else {
              mesh.material.map = createPlaceholderTexture(cam.name, cam.position);
            }
            mesh.material.needsUpdate = true;
            mesh.userData.hasFeed = hasFeed;
          }
        }
      }
    });
  }

  // Initialize camera UI with defaults before backend config loads
  renderCameraDock();

  // ========== Webcam Settings ==========

  function refreshLocalCameraVideos() {
    document.querySelectorAll('.camera-pane video[data-source-type="browser"]').forEach((video) => {
      if (webcamStream) {
        video.srcObject = webcamStream;
        video.play().catch(() => {});
      } else {
        video.srcObject = null;
      }
    });
  }

  // Start All Cameras button - enables all cameras and starts webcam if needed
  document.getElementById('startAllCameras')?.addEventListener('click', async () => {
    console.log('Start All Cameras clicked');

    // Enable all cameras
    cameras.forEach(cam => {
      cam.enabled = true;
      const checkbox = document.getElementById(`camera-check-${cam.id}`);
      if (checkbox) checkbox.checked = true;
    });

    // Check if any camera needs browser webcam stream
    const localCameras = cameras.filter(cam => {
      const source = getCameraSource(cam);
      return source.type === 'browser';
    });

    if (localCameras.length > 0) {
      // Use the first camera with a configured device ID, or default
      const camWithDevice = localCameras.find(c => c.deviceId) || localCameras[0];
      await startWebcamStream(camWithDevice?.deviceId || null);
    }

    refreshLocalCameraVideos();
    renderCameraDock();
    renderCameraOverlays();
    updateCameraControlUI();

    const enabledCount = cameras.filter(cam => cam.enabled).length;
    logMsg(`Enabled ${enabledCount} camera${enabledCount !== 1 ? 's' : ''}`);
  });

  // Stop All Cameras button - disables all cameras and stops webcam
  document.getElementById('stopAllCameras')?.addEventListener('click', () => {
    // Disable all cameras
    cameras.forEach(cam => {
      cam.enabled = false;
      const checkbox = document.getElementById(`camera-check-${cam.id}`);
      if (checkbox) checkbox.checked = false;
    });

    // Stop webcam stream
    stopActiveCamera();

    refreshLocalCameraVideos();
    renderCameraDock();
    renderCameraOverlays();
    updateCameraControlUI();

    logMsg('All cameras stopped');
  });

  // Webcam overlay toggle
  document.getElementById('overlayWebcam').addEventListener('change', async (e) => {
    if (e.target.checked) {
      // If no webcam stream, try to start it
      if (!webcamStream) {
        logMsg('Starting webcam for overlay...');
        const stream = await startWebcamStream();
        if (!stream) {
          e.target.checked = false;
          return;
        }
        refreshLocalCameraVideos();
        renderCameraDock();
        updateCameraControlUI();
      }

      // Create overlay if needed
      if (!webcamOverlay || !webcamOverlay.material.map) {
        const videoElement = document.getElementById('webcamFeed');
        const videoTexture = new THREE.VideoTexture(videoElement);
        const overlayGeom = new THREE.PlaneGeometry(200, 150);
        const sliderVal = parseFloat(document.getElementById('webcamOpacity').value);
        const overlayMat = new THREE.MeshBasicMaterial({
          map: videoTexture,
          transparent: true,
          opacity: 1.0 - (sliderVal / 100),
          side: THREE.DoubleSide
        });
        webcamOverlay = new THREE.Mesh(overlayGeom, overlayMat);
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
    // Also update all camera overlay meshes
    Object.values(cameraOverlayMeshes).forEach(mesh => {
      if (mesh && mesh.material) {
        mesh.material.opacity = opacity;
      }
    });
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
      document.getElementById('showGrid').checked = true;
      document.getElementById('bodyColor').value = '#333333';
      document.getElementById('groundColor').value = '#66aa44';
      document.getElementById('skyColor').value = '#87ceeb';
      body.material.color.setStyle('#333333');
      ground.material.color.setStyle('#66aa44');
      scene.background.setStyle('#87ceeb');
      scene.fog.color.setStyle('#87ceeb');
      gridHelper.visible = true;
      // Apply shadow reset to body and legs
      body.castShadow = true;
      body.receiveShadow = true;
      ground.receiveShadow = true;
      legs.forEach(leg => {
        leg.group.traverse(obj => {
          if (obj.isMesh) {
            obj.castShadow = true;
            obj.receiveShadow = true;
          }
        });
      });
      renderer.shadowMap.needsUpdate = true;

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

      // Save reset visual settings
      saveVisualSettings();

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
    testInterval: null,
    testAngle: 0,
    testDirection: 1,
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

  // Select a leg for calibration and dimensions
  function selectLeg(legIndex) {
    try {
    // Stop any running test sweep when switching legs
    if (calibrationState.testInterval) {
      clearInterval(calibrationState.testInterval);
      calibrationState.testInterval = null;
      calibrationState.testMode = false;
      const testBtn = document.getElementById('testServoBtn');
      if (testBtn) {
        testBtn.classList.remove('active');
        testBtn.textContent = 'Test';
      }
    }

    calibrationState.selectedLeg = legIndex;

    // Update title
    const titleEl = document.getElementById('selectedLegTitle');
    if (titleEl) {
      titleEl.textContent = `Leg ${legIndex}: ${legNames[legIndex]}`;
    }

    // Update mirror button text (copy to all in combined UI)
    const copyToAllBtn = document.getElementById('copyToAllBtn');
    if (copyToAllBtn) {
      copyToAllBtn.textContent = 'Copy to All';
    }

    // Show the dimension, calibration and action sections
    const dimensionSection = document.getElementById('legDimensionSection');
    const divider = document.getElementById('sectionDivider');
    const gaugeRow = document.getElementById('servoGaugeRow');
    const calibrationSliders = document.getElementById('calibrationSliders');
    const legActions = document.getElementById('legActions');

    if (dimensionSection) dimensionSection.style.display = 'block';
    if (divider) divider.style.display = 'block';
    if (gaugeRow) gaugeRow.style.display = 'flex';
    if (calibrationSliders) calibrationSliders.style.display = 'block';
    if (legActions) legActions.style.display = 'grid';

    // Update dimension sliders with current leg config
    const legConfig = legConfigs[legIndex];
    if (legConfig) {
      const coxaLengthSlider = document.getElementById('coxaLengthSlider');
      const femurLengthSlider = document.getElementById('femurLengthSlider');
      const tibiaLengthSlider = document.getElementById('tibiaLengthSlider');

      if (coxaLengthSlider) {
        coxaLengthSlider.value = legConfig.coxaLength;
        document.getElementById('coxaLengthValue').textContent = legConfig.coxaLength.toFixed(1) + ' mm';
      }
      if (femurLengthSlider) {
        femurLengthSlider.value = legConfig.femurLength;
        document.getElementById('femurLengthValue').textContent = legConfig.femurLength.toFixed(1) + ' mm';
      }
      if (tibiaLengthSlider) {
        tibiaLengthSlider.value = legConfig.tibiaLength;
        document.getElementById('tibiaLengthValue').textContent = legConfig.tibiaLength.toFixed(1) + ' mm';
      }
    }

    // Highlight the leg in 3D view
    highlightLegIn3D(legIndex);

    updateGauges();
    updateDiagramStatus();
    } catch (err) {
      console.error('Error in selectLeg:', err);
    }
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
      legEl.addEventListener('click', (e) => {
        e.stopPropagation();
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

    // Dimension slider handlers (for leg segment lengths)
    ['coxa', 'femur', 'tibia'].forEach((joint) => {
      const slider = document.getElementById(`${joint}LengthSlider`);
      if (slider) {
        slider.addEventListener('input', (e) => {
          if (calibrationState.selectedLeg === null) return;

          const length = parseFloat(e.target.value);
          const legIndex = calibrationState.selectedLeg;
          const configKey = `${joint}Length`;

          // Update local config
          legConfigs[legIndex][configKey] = length;

          // Update display
          const valueEl = document.getElementById(`${joint}LengthValue`);
          if (valueEl) {
            valueEl.textContent = length.toFixed(1) + ' mm';
          }

          // Update 3D visualization
          rebuildLeg(legIndex);
          applyDefaultVisualPose();
        });

        // Save on change (when slider is released)
        slider.addEventListener('change', () => {
          if (calibrationState.selectedLeg === null) return;
          saveLegDimensions(calibrationState.selectedLeg);
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

    // Test mode toggle (test servos for selected leg) - sweeps sliders visually
    const testServoBtn = document.getElementById('testServoBtn');
    if (testServoBtn) {
      testServoBtn.addEventListener('click', () => {
        calibrationState.testMode = !calibrationState.testMode;

        testServoBtn.classList.toggle('active', calibrationState.testMode);
        testServoBtn.textContent = calibrationState.testMode ? 'Stop Test' : 'Test';

        if (calibrationState.testMode && calibrationState.selectedLeg !== null) {
          const legIndex = calibrationState.selectedLeg;
          const baseOffsets = { ...calibrationState.offsets[legIndex] };
          calibrationState.testAngle = 0;
          calibrationState.testDirection = 1;

          // Sweep the sliders back and forth
          calibrationState.testInterval = setInterval(() => {
            if (calibrationState.selectedLeg === null || !calibrationState.testMode) {
              clearInterval(calibrationState.testInterval);
              calibrationState.testInterval = null;
              return;
            }

            // Update test angle (sweep ±15 degrees from current offset)
            const sweepRange = 15;
            const step = 1.5;
            calibrationState.testAngle += calibrationState.testDirection * step;

            if (calibrationState.testAngle >= sweepRange) {
              calibrationState.testDirection = -1;
            } else if (calibrationState.testAngle <= -sweepRange) {
              calibrationState.testDirection = 1;
            }

            // Apply sweep to all joints and update sliders
            const joints = ['coxa', 'femur', 'tibia'];
            const sliderIds = ['coxaOffsetSlider', 'femurOffsetSlider', 'tibiaOffsetSlider'];
            const valueIds = ['coxaSliderValue', 'femurSliderValue', 'tibiaSliderValue'];

            joints.forEach((joint, jointIndex) => {
              const newValue = baseOffsets[joint] + calibrationState.testAngle;
              const clampedValue = Math.max(-45, Math.min(45, newValue));

              // Update slider visually
              const slider = document.getElementById(sliderIds[jointIndex]);
              const valueDisplay = document.getElementById(valueIds[jointIndex]);
              if (slider) {
                slider.value = clampedValue;
              }
              if (valueDisplay) {
                valueDisplay.textContent = clampedValue.toFixed(1) + '°';
                valueDisplay.classList.toggle('positive', clampedValue > 0);
                valueDisplay.classList.toggle('negative', clampedValue < 0);
              }

              // Apply to 3D view
              applyTestOffset(legIndex, jointIndex, clampedValue);

              // Update gauges
              const gaugeCanvases = ['coxaGaugeCanvas', 'femurGaugeCanvas', 'tibiaGaugeCanvas'];
              drawGauge(gaugeCanvases[jointIndex], clampedValue);
              const gaugeValues = ['coxaGaugeValue', 'femurGaugeValue', 'tibiaGaugeValue'];
              const gaugeValueEl = document.getElementById(gaugeValues[jointIndex]);
              if (gaugeValueEl) {
                gaugeValueEl.textContent = clampedValue.toFixed(1) + '°';
                gaugeValueEl.classList.toggle('positive', clampedValue > 0);
                gaugeValueEl.classList.toggle('negative', clampedValue < 0);
              }
            });
          }, 50);

          logMsg(`Testing leg ${legIndex} - sweeping servos`);
        } else {
          // Stop test mode - clear interval and restore original offsets
          if (calibrationState.testInterval) {
            clearInterval(calibrationState.testInterval);
            calibrationState.testInterval = null;
          }

          // Restore sliders to their saved offsets
          if (calibrationState.selectedLeg !== null) {
            const legIndex = calibrationState.selectedLeg;
            const offsets = calibrationState.offsets[legIndex];

            const joints = ['coxa', 'femur', 'tibia'];
            const sliderIds = ['coxaOffsetSlider', 'femurOffsetSlider', 'tibiaOffsetSlider'];
            const valueIds = ['coxaSliderValue', 'femurSliderValue', 'tibiaSliderValue'];
            const gaugeCanvases = ['coxaGaugeCanvas', 'femurGaugeCanvas', 'tibiaGaugeCanvas'];
            const gaugeValues = ['coxaGaugeValue', 'femurGaugeValue', 'tibiaGaugeValue'];

            joints.forEach((joint, jointIndex) => {
              const value = offsets[joint];
              const slider = document.getElementById(sliderIds[jointIndex]);
              const valueDisplay = document.getElementById(valueIds[jointIndex]);
              if (slider) slider.value = value;
              if (valueDisplay) {
                valueDisplay.textContent = value.toFixed(1) + '°';
                valueDisplay.classList.toggle('positive', value > 0);
                valueDisplay.classList.toggle('negative', value < 0);
              }

              // Apply original offset to 3D view
              applyTestOffset(legIndex, jointIndex, value);

              // Update gauge
              drawGauge(gaugeCanvases[jointIndex], value);
              const gaugeValueEl = document.getElementById(gaugeValues[jointIndex]);
              if (gaugeValueEl) {
                gaugeValueEl.textContent = value.toFixed(1) + '°';
                gaugeValueEl.classList.toggle('positive', value > 0);
                gaugeValueEl.classList.toggle('negative', value < 0);
              }
            });
          }

          logMsg('Test mode deactivated');
        }
      });
    }

    // Copy to all legs button
    const copyToAllBtn = document.getElementById('copyToAllBtn');
    if (copyToAllBtn) {
      copyToAllBtn.addEventListener('click', async () => {
        if (calibrationState.selectedLeg === null) return;

        const sourceLeg = calibrationState.selectedLeg;
        const sourceConfig = legConfigs[sourceLeg];
        const sourceOffsets = calibrationState.offsets[sourceLeg];

        // Copy dimensions and offsets to all other legs
        for (let leg = 0; leg < 6; leg++) {
          if (leg === sourceLeg) continue;

          // Copy dimensions and visualization settings
          legConfigs[leg] = {
            coxaLength: sourceConfig.coxaLength,
            femurLength: sourceConfig.femurLength,
            tibiaLength: sourceConfig.tibiaLength,
            coxaRadius: sourceConfig.coxaRadius ?? DEFAULT_LEG_CONFIG.coxaRadius,
            femurRadius: sourceConfig.femurRadius ?? DEFAULT_LEG_CONFIG.femurRadius,
            tibiaRadius: sourceConfig.tibiaRadius ?? DEFAULT_LEG_CONFIG.tibiaRadius,
            jointRadius: sourceConfig.jointRadius ?? DEFAULT_LEG_CONFIG.jointRadius,
            footRadius: sourceConfig.footRadius ?? DEFAULT_LEG_CONFIG.footRadius
          };
          saveLegDimensions(leg);

          // Copy offsets
          calibrationState.offsets[leg] = {
            coxa: sourceOffsets.coxa,
            femur: sourceOffsets.femur,
            tibia: sourceOffsets.tibia
          };
          await saveOffset(leg, 0, sourceOffsets.coxa);
          await saveOffset(leg, 1, sourceOffsets.femur);
          await saveOffset(leg, 2, sourceOffsets.tibia);
        }

        updateDiagramStatus();
        logMsg(`Copied dimensions and offsets from leg ${sourceLeg} to all legs`);
      });
    }

    // Reset leg button (resets both dimensions and offsets)
    document.getElementById('resetLegBtn').addEventListener('click', async () => {
      if (calibrationState.selectedLeg === null) return;

      const legIndex = calibrationState.selectedLeg;

      // Reset dimensions to defaults (include all visualization properties)
      legConfigs[legIndex] = {
        coxaLength: DEFAULT_LEG_CONFIG.coxaLength,
        femurLength: DEFAULT_LEG_CONFIG.femurLength,
        tibiaLength: DEFAULT_LEG_CONFIG.tibiaLength,
        coxaRadius: DEFAULT_LEG_CONFIG.coxaRadius,
        femurRadius: DEFAULT_LEG_CONFIG.femurRadius,
        tibiaRadius: DEFAULT_LEG_CONFIG.tibiaRadius,
        jointRadius: DEFAULT_LEG_CONFIG.jointRadius,
        footRadius: DEFAULT_LEG_CONFIG.footRadius
      };
      saveLegDimensions(legIndex);

      // Update dimension sliders
      const coxaLengthSlider = document.getElementById('coxaLengthSlider');
      const femurLengthSlider = document.getElementById('femurLengthSlider');
      const tibiaLengthSlider = document.getElementById('tibiaLengthSlider');
      if (coxaLengthSlider) {
        coxaLengthSlider.value = DEFAULT_LEG_CONFIG.coxaLength;
        document.getElementById('coxaLengthValue').textContent = DEFAULT_LEG_CONFIG.coxaLength + ' mm';
      }
      if (femurLengthSlider) {
        femurLengthSlider.value = DEFAULT_LEG_CONFIG.femurLength;
        document.getElementById('femurLengthValue').textContent = DEFAULT_LEG_CONFIG.femurLength + ' mm';
      }
      if (tibiaLengthSlider) {
        tibiaLengthSlider.value = DEFAULT_LEG_CONFIG.tibiaLength;
        document.getElementById('tibiaLengthValue').textContent = DEFAULT_LEG_CONFIG.tibiaLength + ' mm';
      }

      // Reset offsets
      calibrationState.offsets[legIndex] = {coxa: 0, femur: 0, tibia: 0};
      await saveOffset(legIndex, 0, 0);
      await saveOffset(legIndex, 1, 0);
      await saveOffset(legIndex, 2, 0);

      updateGauges();
      updateDiagramStatus();
      logMsg(`Reset leg ${legIndex} to defaults`);
    });

    // Save all button (dimensions and calibration offsets)
    const saveAllBtn = document.getElementById('saveCalibrationBtn');
    if (saveAllBtn) {
      saveAllBtn.addEventListener('click', async () => {
        try {
          await fetch('/api/config/save', { method: 'POST' });
          logMsg('Configuration saved to file');
        } catch (e) {
          logMsg('Failed to save configuration');
        }
      });
    }

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

  // Only initialize calibration UI if the required elements exist (e.g., on calibrate.html)
  // The main index.html now has a simplified Legs tab that links to the calibration page
  if (document.getElementById('hexapodDiagram') && document.querySelector('.leg-btn')) {
    initializeCalibrationUI();
  }

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
    back: { angleY: Math.PI, angleX: Math.PI / 4 },  // Starting position - back isometric
    side: { angleY: Math.PI / 2, angleX: Math.PI / 8 },
    top: { angleY: 0, angleX: Math.PI / 2 - 0.1 },
    iso: { angleY: Math.PI * 0.75, angleX: Math.PI / 6 }
  };

  // Smooth camera transition function
  let cameraTransition = null;
  function animateCameraTo(targetAngleY, targetAngleX, duration = 800) {
    // Cancel any existing transition
    if (cameraTransition) {
      cancelAnimationFrame(cameraTransition.frameId);
    }

    const startAngleY = cameraAngleY;
    const startAngleX = cameraAngleX;
    const startTime = Date.now();

    // Normalize angle difference for shortest path
    let deltaAngleY = targetAngleY - startAngleY;
    if (deltaAngleY > Math.PI) deltaAngleY -= 2 * Math.PI;
    if (deltaAngleY < -Math.PI) deltaAngleY += 2 * Math.PI;

    function step() {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Ease-out cubic for smooth deceleration
      const eased = 1 - Math.pow(1 - progress, 3);

      cameraAngleY = startAngleY + deltaAngleY * eased;
      cameraAngleX = startAngleX + (targetAngleX - startAngleX) * eased;

      updateCameraPosition();

      if (progress < 1) {
        cameraTransition = { frameId: requestAnimationFrame(step) };
      } else {
        cameraTransition = null;
        // Ensure we end exactly at target
        cameraAngleY = targetAngleY;
        cameraAngleX = targetAngleX;
        updateCameraPosition();
      }
    }

    cameraTransition = { frameId: requestAnimationFrame(step) };
  }

  document.querySelectorAll('.camera-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      const preset = cameraPresets[view];
      if (preset) {
        // Use smooth animation instead of instant transition
        animateCameraTo(preset.angleY, preset.angleX);

        // Update active state
        document.querySelectorAll('.camera-preset-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      }
    });
  });

  // ========== Detection Targets ==========

  // Store active detection targets
  let detectionTargets = ['snail'];  // Default: snails active

  // Make toggle function globally accessible
  window.toggleDetectionTarget = function(el) {
    const target = el.dataset.target;

    // Special handling for "custom" - just toggle for now
    if (target === 'custom') {
      el.classList.toggle('active');
      return;
    }

    el.classList.toggle('active');

    const idx = detectionTargets.indexOf(target);
    if (idx >= 0) {
      detectionTargets.splice(idx, 1);
    } else {
      detectionTargets.push(target);
    }

    // Save to localStorage
    localStorage.setItem('hexapod_detection_targets', JSON.stringify(detectionTargets));
  };

  // Load saved detection targets on startup
  function loadDetectionTargets() {
    const saved = localStorage.getItem('hexapod_detection_targets');
    if (saved) {
      try {
        detectionTargets = JSON.parse(saved);
        // Update UI to match saved state
        document.querySelectorAll('.detection-target').forEach(el => {
          const target = el.dataset.target;
          if (detectionTargets.includes(target)) {
            el.classList.add('active');
          } else {
            el.classList.remove('active');
          }
        });
      } catch (e) {
        console.error('Failed to load detection targets:', e);
      }
    }
  }

  // Initialize detection targets
  loadDetectionTargets();

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
  // Note: isRotatingLeft and isRotatingRight are defined earlier with movement state

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
      // NOTE: Q/E keys are handled by the movement system in updateHeading()
      // They make the hexapod walk and turn, not just rotate body in place
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

  // NOTE: Q/E keyup is handled by the movement system - no separate handler needed here

})();
