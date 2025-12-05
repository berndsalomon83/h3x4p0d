// Hexapod Configuration - JavaScript

// ========== State Management ==========
const state = {
  connected: false,
  currentProfile: 'default',
  defaultProfile: 'default',  // Which profile loads on startup
  profiles: [],  // Will be populated with profile objects
  profilesData: {
    // Profile metadata - will be loaded from backend
    'default': {
      name: 'default',
      description: 'Default configuration for general use',
      lastModified: new Date().toISOString(),
      isDefault: true
    }
  },
  config: {},
  activeGait: 'tripod',
  telemetry: {
    battery: 11.4,
    temperature: 42,
    roll: 0,
    pitch: 0,
    yaw: 0,
    bodyHeight: 120,
    speed: 0
  },
  legAngles: Array(6).fill(null).map(() => ({ coxa: 90, femur: 45, tibia: -90 })),
  footContacts: [true, false, true, true, false, true],
  selectedLeg: null,
  recordedPoses: [],
  isRecording: false,
  gaitPhase: 0,
  testActionActive: false  // When true, disables idle animation
};

// Sparkline data buffers
const sparklineData = {
  'spark-l0-coxa': [], 'spark-l0-femur': [], 'spark-l0-tibia': [],
  'spark-roll': [], 'spark-pitch': [], 'spark-yaw': []
};
const SPARKLINE_MAX_POINTS = 50;

// ========== Navigation ==========
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    item.classList.add('active');
    const sectionId = 'section-' + item.dataset.section;
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.getElementById(sectionId)?.classList.add('active');
  });
});

// ========== Tabs ==========
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const parent = tab.closest('.section') || document;
    const tabGroup = tab.closest('.tabs');
    tabGroup.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const tabId = 'tab-' + tab.dataset.tab;
    parent.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    parent.querySelector('#' + tabId)?.classList.add('active');
  });
});

// ========== LocalStorage Persistence ==========
const STORAGE_KEYS = {
  profiles: 'hexapod_profiles',
  profilesData: 'hexapod_profiles_data',
  currentProfile: 'hexapod_current_profile',
  defaultProfile: 'hexapod_default_profile',
  configs: 'hexapod_configs'
};

function saveProfilesToStorage() {
  try {
    localStorage.setItem(STORAGE_KEYS.profiles, JSON.stringify(state.profiles));
    localStorage.setItem(STORAGE_KEYS.profilesData, JSON.stringify(state.profilesData));
    localStorage.setItem(STORAGE_KEYS.currentProfile, state.currentProfile);
    localStorage.setItem(STORAGE_KEYS.defaultProfile, state.defaultProfile);
    console.log('Profiles saved to localStorage');
  } catch (e) {
    console.error('Failed to save profiles to localStorage:', e);
  }
}

function saveConfigToStorage(profileName, config) {
  try {
    const configs = JSON.parse(localStorage.getItem(STORAGE_KEYS.configs) || '{}');
    configs[profileName] = config;
    localStorage.setItem(STORAGE_KEYS.configs, JSON.stringify(configs));
    console.log(`Config for "${profileName}" saved to localStorage`);
  } catch (e) {
    console.error('Failed to save config to localStorage:', e);
  }
}

function loadProfilesFromStorage() {
  try {
    const profiles = localStorage.getItem(STORAGE_KEYS.profiles);
    const profilesData = localStorage.getItem(STORAGE_KEYS.profilesData);
    const currentProfile = localStorage.getItem(STORAGE_KEYS.currentProfile);
    const defaultProfile = localStorage.getItem(STORAGE_KEYS.defaultProfile);

    if (profiles) {
      state.profiles = JSON.parse(profiles);
    }
    if (profilesData) {
      state.profilesData = JSON.parse(profilesData);
    }
    if (defaultProfile && state.profiles.includes(defaultProfile)) {
      state.defaultProfile = defaultProfile;
    }
    // On fresh load, start with the default profile
    if (currentProfile && state.profiles.includes(currentProfile)) {
      state.currentProfile = currentProfile;
    } else if (state.defaultProfile) {
      state.currentProfile = state.defaultProfile;
    }

    return profiles !== null; // Return true if we found saved data
  } catch (e) {
    console.error('Failed to load profiles from localStorage:', e);
    return false;
  }
}

function loadConfigFromStorage(profileName) {
  try {
    const configs = JSON.parse(localStorage.getItem(STORAGE_KEYS.configs) || '{}');
    return configs[profileName] || null;
  } catch (e) {
    console.error('Failed to load config from localStorage:', e);
    return null;
  }
}

function deleteConfigFromStorage(profileName) {
  try {
    const configs = JSON.parse(localStorage.getItem(STORAGE_KEYS.configs) || '{}');
    delete configs[profileName];
    localStorage.setItem(STORAGE_KEYS.configs, JSON.stringify(configs));
  } catch (e) {
    console.error('Failed to delete config from localStorage:', e);
  }
}

// ========== API Functions ==========
async function loadConfig() {
  // First try localStorage for the current profile
  const savedConfig = loadConfigFromStorage(state.currentProfile);
  if (savedConfig) {
    state.config = savedConfig;
    applyConfigToUI();
    updatePreview();
    updateSummaryCards();
    logEvent('INFO', `Loaded config for "${state.currentProfile}" from localStorage`);
    return;
  }

  // Then try the server
  try {
    const response = await fetch('/api/config');
    if (response.ok) {
      state.config = await response.json();
      applyConfigToUI();
      updatePreview();
      updateSummaryCards();
      saveConfigToStorage(state.currentProfile, state.config); // Cache it
      logEvent('INFO', 'Configuration loaded from server');
    }
  } catch (e) {
    // Use demo config for offline mode
    state.config = {
      body_length: 300,
      body_width: 200,
      body_height: 120,
      leg_coxa_length: 30,
      leg_femur_length: 50,
      leg_tibia_length: 80,
      gait_step_length: 60,
      gait_step_height: 30,
      servo_type: 'DS3218'
    };
    applyConfigToUI();
    updateSummaryCards();
    saveConfigToStorage(state.currentProfile, state.config); // Save default config
    logEvent('WARN', 'Using demo config (offline mode)');
  }
}

async function saveConfig(updates) {
  // Always update state and localStorage
  Object.assign(state.config, updates);
  saveConfigToStorage(state.currentProfile, state.config);

  // Update profile metadata
  if (state.profilesData[state.currentProfile]) {
    state.profilesData[state.currentProfile].lastModified = new Date().toISOString();
    saveProfilesToStorage();
  }

  // Try to save to server too
  try {
    const response = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    });
    if (response.ok) {
      logEvent('INFO', 'Configuration saved');
    }
  } catch (e) {
    logEvent('INFO', 'Configuration saved locally');
  }
}

async function sendCommand(type, data = {}) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type, ...data }));
}

async function loadProfiles() {
  // First try to load from localStorage
  const hasLocalData = loadProfilesFromStorage();

  if (hasLocalData && state.profiles.length > 0) {
    console.log('Loaded profiles from localStorage');
    updateProfileSelector();
    renderProfileTable();
    return;
  }

  // Then try the server
  try {
    const response = await fetch('/api/profiles');
    if (response.ok) {
      const data = await response.json();
      // Handle both array of names and array of objects
      if (Array.isArray(data.profiles)) {
        state.profiles = data.profiles;
        // Create metadata for profiles that don't have it
        data.profiles.forEach(p => {
          const name = typeof p === 'string' ? p : p.name;
          if (!state.profilesData[name]) {
            state.profilesData[name] = {
              name: name,
              description: typeof p === 'object' ? p.description : '',
              lastModified: typeof p === 'object' ? p.lastModified : new Date().toISOString(),
              isDefault: name === 'default'
            };
          }
        });
        saveProfilesToStorage(); // Cache the server data
      }
    }
  } catch (e) {
    console.log('Using default profiles');
    // Set up default profiles for demo
    state.profiles = ['default', 'outdoor_rough', 'indoor_demo'];
    state.profilesData = {
      'default': { name: 'default', description: 'Default configuration', lastModified: new Date().toISOString(), isDefault: true },
      'outdoor_rough': { name: 'outdoor_rough', description: 'Optimized for rough outdoor terrain', lastModified: new Date(Date.now() - 86400000).toISOString(), isDefault: false },
      'indoor_demo': { name: 'indoor_demo', description: 'Slow and smooth for indoor demonstrations', lastModified: new Date(Date.now() - 172800000).toISOString(), isDefault: false }
    };
    saveProfilesToStorage(); // Save defaults to localStorage
  }
  updateProfileSelector();
  renderProfileTable();
}

// ========== Profile Table Rendering ==========
function renderProfileTable() {
  const tbody = document.getElementById('profileTableBody');
  const noMsg = document.getElementById('noProfilesMsg');
  const countEl = document.getElementById('profileCount');

  if (!tbody) return;

  const profileNames = state.profiles.map(p => typeof p === 'string' ? p : p.name);

  if (profileNames.length === 0) {
    tbody.innerHTML = '';
    if (noMsg) noMsg.style.display = 'block';
    if (countEl) countEl.textContent = '0 profiles';
    return;
  }

  if (noMsg) noMsg.style.display = 'none';
  if (countEl) countEl.textContent = `${profileNames.length} profile${profileNames.length !== 1 ? 's' : ''}`;

  tbody.innerHTML = profileNames.map(name => {
    const data = state.profilesData[name] || { name, description: '', lastModified: new Date().toISOString() };
    const isSelected = name === state.currentProfile;
    const isDefault = name === state.defaultProfile;
    const date = new Date(data.lastModified);
    const dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});

    return `
      <tr class="profile-row ${isSelected ? 'selected' : ''}" data-profile="${name}">
        <td><input type="radio" name="profileSelect" class="profile-radio" ${isSelected ? 'checked' : ''} data-profile="${name}"></td>
        <td>
          <strong class="profile-name">${escapeHtml(name)}</strong>
          ${isDefault ? '<span class="tag tag-primary" style="margin-left: 8px; font-size: 9px;">DEFAULT</span>' : ''}
        </td>
        <td style="color: var(--text-muted); font-size: 12px;">${dateStr}</td>
        <td style="color: var(--text-muted); font-size: 12px;">${escapeHtml(data.description || '--')}</td>
        <td>
          ${!isDefault ? `<button class="btn btn-secondary btn-sm profile-action-btn" data-action="set-default" data-profile="${name}" title="Set as default profile">Set Default</button>` : ''}
          <button class="btn btn-secondary btn-sm profile-action-btn" data-action="edit" data-profile="${name}">Edit</button>
          <button class="btn btn-secondary btn-sm profile-action-btn" data-action="duplicate" data-profile="${name}">Duplicate</button>
          ${!isDefault ? `<button class="btn btn-danger btn-sm profile-action-btn" data-action="delete" data-profile="${name}">Delete</button>` : ''}
        </td>
      </tr>
    `;
  }).join('');

  // Add event listeners to rows
  tbody.querySelectorAll('.profile-row').forEach(row => {
    row.addEventListener('click', (e) => {
      // Don't trigger if clicking a button
      if (e.target.closest('button')) return;
      const profileName = row.dataset.profile;
      selectProfile(profileName);
    });
  });

  // Add event listeners to radio buttons
  tbody.querySelectorAll('.profile-radio').forEach(radio => {
    radio.addEventListener('change', () => {
      selectProfile(radio.dataset.profile);
    });
  });

  // Add event listeners to action buttons
  tbody.querySelectorAll('.profile-action-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = btn.dataset.action;
      const profileName = btn.dataset.profile;
      handleProfileAction(action, profileName);
    });
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function selectProfile(profileName) {
  if (profileName === state.currentProfile) return;

  state.currentProfile = profileName;
  saveProfilesToStorage(); // Remember current profile

  // Update header selector
  const headerSelect = document.getElementById('profileSelect');
  if (headerSelect) headerSelect.value = profileName;

  // First try loading from localStorage
  const savedConfig = loadConfigFromStorage(profileName);
  if (savedConfig) {
    state.config = savedConfig;
    applyConfigToUI();
    updateSummaryCards();
    updatePreview();
    logEvent('INFO', `Switched to profile: ${profileName}`);
    renderProfileTable();
    return;
  }

  // Then try the server
  try {
    const response = await fetch(`/api/config?profile=${encodeURIComponent(profileName)}`);
    if (response.ok) {
      state.config = await response.json();
      applyConfigToUI();
      updateSummaryCards();
      updatePreview();
      saveConfigToStorage(profileName, state.config); // Cache it
      logEvent('INFO', `Switched to profile: ${profileName}`);
    }
  } catch (e) {
    // If profile-specific load fails, just load default config
    await loadConfig();
  }

  renderProfileTable();
}

async function handleProfileAction(action, profileName) {
  switch (action) {
    case 'edit':
      // Navigate to appropriate section based on what user might want to edit
      // For now, just select the profile
      selectProfile(profileName);
      logEvent('INFO', `Editing profile: ${profileName}`);
      break;

    case 'set-default':
      state.defaultProfile = profileName;
      // Update isDefault flag in profilesData
      Object.keys(state.profilesData).forEach(name => {
        state.profilesData[name].isDefault = (name === profileName);
      });
      saveProfilesToStorage();
      renderProfileTable();
      logEvent('INFO', `"${profileName}" is now the default profile`);
      break;

    case 'duplicate':
      const newName = prompt('Enter name for the new profile:', profileName + '_copy');
      if (newName && newName.trim()) {
        const trimmedName = newName.trim().toLowerCase().replace(/\s+/g, '_');
        if (state.profiles.includes(trimmedName) || state.profilesData[trimmedName]) {
          alert('A profile with this name already exists.');
          return;
        }
        // Create new profile with copied data
        state.profiles.push(trimmedName);
        state.profilesData[trimmedName] = {
          name: trimmedName,
          description: `Copy of ${profileName}`,
          lastModified: new Date().toISOString(),
          isDefault: false
        };

        // Copy the config from source profile
        const sourceConfig = loadConfigFromStorage(profileName) || state.config;
        saveConfigToStorage(trimmedName, { ...sourceConfig });

        // Save profiles to localStorage
        saveProfilesToStorage();

        // Try to save to backend too
        try {
          await fetch('/api/profiles', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'create',
              name: trimmedName,
              copyFrom: profileName
            })
          });
        } catch (e) {
          console.log('Backend profile save failed, continuing locally');
        }
        updateProfileSelector();
        renderProfileTable();
        logEvent('INFO', `Profile duplicated: ${trimmedName}`);
      }
      break;

    case 'delete':
      if (profileName === state.defaultProfile) {
        alert('Cannot delete the default profile. Set another profile as default first.');
        return;
      }
      if (confirm(`Are you sure you want to delete the profile "${profileName}"?`)) {
        // Remove from state
        state.profiles = state.profiles.filter(p => {
          const n = typeof p === 'string' ? p : p.name;
          return n !== profileName;
        });
        delete state.profilesData[profileName];

        // If we deleted the current profile, switch to default
        if (state.currentProfile === profileName) {
          state.currentProfile = state.defaultProfile;
          await loadConfig();
        }

        // Save to localStorage
        saveProfilesToStorage();
        deleteConfigFromStorage(profileName);

        // Try to delete on backend
        try {
          await fetch('/api/profiles', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'delete', name: profileName })
          });
        } catch (e) {
          console.log('Backend profile delete failed');
        }

        updateProfileSelector();
        renderProfileTable();
        logEvent('WARN', `Profile deleted: ${profileName}`);
      }
      break;
  }
}

// ========== Profile Management ==========
function updateProfileSelector() {
  const select = document.getElementById('profileSelect');
  if (!select) return;
  select.innerHTML = state.profiles.map(p =>
    `<option value="${p}" ${p === state.currentProfile ? 'selected' : ''}>${p}</option>`
  ).join('');
}

document.getElementById('profileSelect')?.addEventListener('change', async (e) => {
  state.currentProfile = e.target.value;
  await loadConfig();
  logEvent('INFO', `Profile switched to: ${state.currentProfile}`);
});

// Profile action buttons - specific handlers
document.getElementById('btnSaveProfile')?.addEventListener('click', async () => {
  await saveConfig(state.config);
  logEvent('INFO', `Profile "${state.currentProfile}" saved`);
});

document.getElementById('btnDuplicateProfile')?.addEventListener('click', async () => {
  const newName = prompt('Enter name for new profile:', state.currentProfile + '_copy');
  if (newName && !state.profiles.includes(newName)) {
    state.profiles.push(newName);
    state.currentProfile = newName;
    updateProfileSelector();
    await saveConfig(state.config);
    logEvent('INFO', `Profile duplicated as "${newName}"`);
  }
});

document.getElementById('btnDeleteProfile')?.addEventListener('click', async () => {
  if (state.currentProfile !== 'default' && confirm(`Delete profile "${state.currentProfile}"?`)) {
    state.profiles = state.profiles.filter(p => p !== state.currentProfile);
    state.currentProfile = 'default';
    updateProfileSelector();
    await loadConfig();
    logEvent('WARN', `Profile deleted`);
  } else if (state.currentProfile === 'default') {
    logEvent('WARN', 'Cannot delete the default profile');
  }
});

document.getElementById('btnExportJson')?.addEventListener('click', () => {
  const profileData = state.profilesData[state.currentProfile] || {};

  // Create a complete export package with all profile data
  const exportData = {
    // Profile identification
    profile_id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    profile_name: state.currentProfile,
    profile_description: profileData.description || '',

    // Metadata
    exported_at: new Date().toISOString(),
    last_modified: profileData.lastModified || new Date().toISOString(),
    export_version: '1.0',

    // Full configuration
    config: { ...state.config }
  };

  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `hexapod_profile_${state.currentProfile}_${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
  logEvent('INFO', `Profile "${state.currentProfile}" exported with full metadata`);
});

document.getElementById('btnImportConfig')?.addEventListener('click', () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (file) {
      const text = await file.text();
      try {
        const imported = JSON.parse(text);

        // Handle new export format (with config wrapper) or legacy format
        const configData = imported.config || imported;

        // Update current profile's config
        state.config = { ...configData };
        saveConfigToStorage(state.currentProfile, state.config);

        // Update profile metadata if available
        if (imported.profile_description && state.profilesData[state.currentProfile]) {
          state.profilesData[state.currentProfile].lastModified = new Date().toISOString();
          saveProfilesToStorage();
        }

        applyConfigToUI();
        updateSummaryCards();
        updatePreview();
        renderProfileTable();

        logEvent('INFO', `Configuration imported into "${state.currentProfile}"`);
      } catch (err) {
        logEvent('ERROR', 'Invalid config file: ' + err.message);
        alert('Failed to import configuration. Please ensure the file is valid JSON.');
      }
    }
  };
  input.click();
});

document.getElementById('btnCalibrationWizard')?.addEventListener('click', () => {
  // Navigate to servos section and wizard tab
  document.querySelector('[data-section="servos"]')?.click();
  setTimeout(() => {
    document.querySelector('[data-tab="servo-wizard"]')?.click();
  }, 100);
  logEvent('INFO', 'Opening Calibration Wizard');
});

document.getElementById('btnTestWalk')?.addEventListener('click', () => {
  sendCommand('walk', { walking: true });
  logEvent('INFO', 'Walk test started');
  setTimeout(() => {
    sendCommand('walk', { walking: false });
    logEvent('INFO', 'Walk test stopped');
  }, 3000);
});

// ========== Apply Config to UI ==========
function applyConfigToUI() {
  const c = state.config;

  // Geometry sliders
  setSliderValue('bodyHeight', c.body_height || 120);
  setSliderValue('bodyWidth', c.body_width || 100);
  setSliderValue('bodyLength', c.body_length || 150);

  // Leg geometry
  setSliderValue('coxaLength', c.leg_coxa_length || 30);
  setSliderValue('femurLength', c.leg_femur_length || 50);
  setSliderValue('tibiaLength', c.leg_tibia_length || 80);

  // Gait parameters
  setSliderValue('stepHeight', c.gait_step_height || 30);
  setSliderValue('stepLength', c.gait_step_length || 60);
  setSliderValue('cycleTime', (c.gait_cycle_time || 1.0) * 100);

  // Body pose
  setSliderValue('bodyRoll', c.body_roll || 0);
  setSliderValue('bodyPitch', c.body_pitch || 0);
  setSliderValue('bodyYaw', c.body_yaw || 0);
  setSliderValue('bodyTransX', c.body_trans_x || 0);
  setSliderValue('bodyTransY', c.body_trans_y || 0);
  setSliderValue('bodyTransZ', c.body_trans_z || 0);
}

function setSliderValue(id, value) {
  const slider = document.querySelector(`[data-config="${id}"]`) || document.getElementById(id);
  if (slider) {
    slider.value = value;
    const group = slider.closest('.slider-group');
    if (group) {
      const valueEl = group.querySelector('.slider-value');
      if (valueEl) {
        const suffix = valueEl.textContent.replace(/[\d.-]+/, '');
        valueEl.textContent = value + suffix;
      }
    }
  }
}

// ========== Slider Event Handling ==========
document.querySelectorAll('.slider-group').forEach(group => {
  const slider = group.querySelector('.slider');
  const valueEl = group.querySelector('.slider-value');
  if (slider && valueEl) {
    slider.addEventListener('input', () => {
      const val = parseFloat(slider.value);
      const suffix = valueEl.textContent.replace(/[\d.-]+/, '');
      valueEl.textContent = val + suffix;

      // Determine config key from slider
      const configKey = slider.dataset.config || slider.id;
      if (configKey) {
        // Debounced save
        clearTimeout(slider._saveTimeout);
        slider._saveTimeout = setTimeout(() => {
          const update = {};
          update[configKey] = val;
          saveConfig(update);
        }, 300);
      }

      // Update preview
      updatePreviewFromSlider(configKey, val);
    });
  }
});

// ========== Servo Mapping Table ==========
const servoMappingTable = document.getElementById('servoMappingTable');
if (servoMappingTable) {
  const legNames = ['FR', 'MR', 'RR', 'RL', 'ML', 'FL'];
  const jointNames = ['coxa', 'femur', 'tibia'];

  for (let leg = 0; leg < 6; leg++) {
    for (let joint = 0; joint < 3; joint++) {
      const channel = leg * 3 + joint;
      const row = document.createElement('tr');
      row.dataset.leg = leg;
      row.dataset.joint = joint;
      row.innerHTML = `
        <td><strong>leg_${leg}_${jointNames[joint]}</strong></td>
        <td><input type="number" class="form-input channel-input" value="${channel}" style="width:60px" data-channel="${channel}"></td>
        <td>${leg} (${legNames[leg]})</td>
        <td>${jointNames[joint]}</td>
        <td><select class="form-select direction-select" style="width:100px"><option value="1">Normal</option><option value="-1">Reversed</option></select></td>
        <td><input type="number" class="form-input offset-input" value="1500" style="width:70px"></td>
        <td><button class="btn btn-secondary btn-sm test-servo-btn">Test</button></td>
      `;
      servoMappingTable.appendChild(row);

      // Test button handler
      row.querySelector('.test-servo-btn').addEventListener('click', () => {
        testServo(leg, joint);
      });
    }
  }
}

async function testServo(leg, joint) {
  logEvent('INFO', `Testing leg ${leg} ${['coxa', 'femur', 'tibia'][joint]}`);
  sendCommand('test_servo', { leg, joint });
}

// ========== Servo Limits Diagram ==========
document.querySelectorAll('#servoLegDiagram .leg-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const legIndex = parseInt(btn.dataset.leg);
    state.selectedLeg = legIndex;
    const legNames = ['Front Right', 'Mid Right', 'Rear Right', 'Rear Left', 'Mid Left', 'Front Left'];

    document.querySelectorAll('#servoLegDiagram .leg-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');

    document.getElementById('servoLimitsPanel').style.display = 'block';
    document.getElementById('servoLimitsTitle').textContent = `Leg ${legIndex} - ${legNames[legIndex]}`;

    // Load leg-specific limits
    loadLegLimits(legIndex);
  });
});

function loadLegLimits(legIndex) {
  const angles = state.legAngles[legIndex];
  // Update the limit sliders with current values
  ['coxa', 'femur', 'tibia'].forEach(joint => {
    const minSlider = document.querySelector(`[data-limit="${joint}-min"]`);
    const maxSlider = document.querySelector(`[data-limit="${joint}-max"]`);
    if (minSlider) minSlider.value = state.config[`leg${legIndex}_${joint}_min`] || -45;
    if (maxSlider) maxSlider.value = state.config[`leg${legIndex}_${joint}_max`] || 45;
  });
}

// ========== Default Geometry Configuration ==========
// Defined here so 3D preview can access it during initialization
const defaultGeometry = {
  body_length: 300,
  body_width: 250,
  body_height_geo: 50,
  body_origin: 'center',
  leg_coxa_length: 40,
  leg_femur_length: 80,
  leg_tibia_length: 100,
  coxa_axis: 'z',
  femur_axis: 'y',
  tibia_axis: 'y',
  leg_attach_points: [
    { leg: 0, name: 'FR', x: 150, y: 120, z: 0, angle: 45 },
    { leg: 1, name: 'MR', x: 0, y: 150, z: 0, angle: 90 },
    { leg: 2, name: 'RR', x: -150, y: 120, z: 0, angle: 135 },
    { leg: 3, name: 'RL', x: -150, y: -120, z: 0, angle: 225 },
    { leg: 4, name: 'ML', x: 0, y: -150, z: 0, angle: 270 },
    { leg: 5, name: 'FL', x: 150, y: -120, z: 0, angle: 315 }
  ],
  frames: [
    { name: 'world', parent: null, position: [0, 0, 0], orientation: [0, 0, 0], fixed: true },
    { name: 'body', parent: 'world', position: [0, 0, 120], orientation: [0, 0, 0], fixed: false },
    { name: 'camera_front', parent: 'body', position: [100, 0, 50], orientation: [0, -10, 0], fixed: false },
    { name: 'camera_rear', parent: 'body', position: [-100, 0, 50], orientation: [0, -10, 180], fixed: false },
    { name: 'imu', parent: 'body', position: [0, 0, 10], orientation: [0, 0, 0], fixed: false }
  ]
};

// ========== 3D Preview ==========
let scene, camera, renderer, body, legs = [];
let cameraRadius = 400;
let cameraTheta = Math.PI / 4;
let cameraPhi = Math.PI / 4;

// Global camera position update function
function updateCameraPosition() {
  if (!camera) return;
  camera.position.x = cameraRadius * Math.sin(cameraPhi) * Math.cos(cameraTheta);
  camera.position.y = cameraRadius * Math.cos(cameraPhi);
  camera.position.z = cameraRadius * Math.sin(cameraPhi) * Math.sin(cameraTheta);
  camera.lookAt(0, 50, 0);
}

// Smooth camera transition function
let cameraTransition = null;
function animateCameraTo(targetTheta, targetPhi, duration = 1500) {
  // Cancel any existing transition
  if (cameraTransition) {
    cancelAnimationFrame(cameraTransition.frameId);
  }

  const startTheta = cameraTheta;
  const startPhi = cameraPhi;
  const startTime = Date.now();

  // Normalize theta difference for shortest path
  let deltaTheta = targetTheta - startTheta;
  if (deltaTheta > Math.PI) deltaTheta -= 2 * Math.PI;
  if (deltaTheta < -Math.PI) deltaTheta += 2 * Math.PI;

  function step() {
    const elapsed = Date.now() - startTime;
    const progress = Math.min(elapsed / duration, 1);

    // Ease-out cubic for smooth deceleration
    const eased = 1 - Math.pow(1 - progress, 3);

    cameraTheta = startTheta + deltaTheta * eased;
    cameraPhi = startPhi + (targetPhi - startPhi) * eased;

    updateCameraPosition();

    if (progress < 1) {
      cameraTransition = { frameId: requestAnimationFrame(step) };
    } else {
      cameraTransition = null;
      // Ensure we end exactly at target
      cameraTheta = targetTheta;
      cameraPhi = targetPhi;
      updateCameraPosition();
    }
  }

  cameraTransition = { frameId: requestAnimationFrame(step) };
}

// Scale factor: mm in config → units in 3D scene (roughly 1/3 scale)
const GEOMETRY_SCALE = 1 / 3;

// Materials (shared across rebuilds)
let bodyMaterial, legMaterial, jointMaterial, footMaterial;

// Get geometry value from config or default
function getGeometryValue(key) {
  return state.config[key] ?? defaultGeometry[key] ?? 0;
}

// Get leg attach point from config or default
function getLegAttachPoint(legIndex) {
  const defaults = defaultGeometry.leg_attach_points[legIndex];
  return {
    x: state.config[`leg_${legIndex}_attach_x`] ?? defaults.x,
    y: state.config[`leg_${legIndex}_attach_y`] ?? defaults.y,
    z: state.config[`leg_${legIndex}_attach_z`] ?? defaults.z,
    angle: state.config[`leg_${legIndex}_attach_angle`] ?? defaults.angle
  };
}

// Rebuild body mesh with current geometry
function rebuildBodyMesh() {
  if (!scene || !bodyMaterial) return;

  // Remove old body
  if (body) {
    scene.remove(body);
    body.geometry.dispose();
  }

  // Get dimensions from config (scaled)
  const bodyLength = getGeometryValue('body_length') * GEOMETRY_SCALE;
  const bodyWidth = getGeometryValue('body_width') * GEOMETRY_SCALE;
  const bodyHeight = getGeometryValue('body_height_geo') * GEOMETRY_SCALE;

  // Create new body: BoxGeometry(width, height, depth) maps to (x, y, z)
  // body_width → x (left-right), body_height_geo → y (thickness), body_length → z (front-back)
  const bodyGeometry = new THREE.BoxGeometry(bodyWidth, bodyHeight, bodyLength);
  body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.position.y = state.telemetry.bodyHeight || 80;
  scene.add(body);
}

// Create a single leg with proper segment lengths
function createLeg(legIndex) {
  const coxaLen = getGeometryValue('leg_coxa_length') * GEOMETRY_SCALE;
  const femurLen = getGeometryValue('leg_femur_length') * GEOMETRY_SCALE;
  const tibiaLen = getGeometryValue('leg_tibia_length') * GEOMETRY_SCALE;
  const attachPoint = getLegAttachPoint(legIndex);

  const legGroup = new THREE.Group();

  // Coxa joint
  const coxaJoint = new THREE.Group();
  const coxa = new THREE.Mesh(
    new THREE.CylinderGeometry(4, 4, coxaLen, 8),
    legMaterial
  );
  coxa.rotation.z = Math.PI / 2;
  coxa.position.x = coxaLen / 2;
  coxaJoint.add(coxa);

  // Femur joint
  const femurJoint = new THREE.Group();
  femurJoint.position.x = coxaLen;
  const femur = new THREE.Mesh(
    new THREE.CylinderGeometry(3, 3, femurLen, 8),
    legMaterial
  );
  femur.position.y = -femurLen / 2;
  femurJoint.add(femur);
  const femurBall = new THREE.Mesh(new THREE.SphereGeometry(5, 8, 8), jointMaterial);
  femurJoint.add(femurBall);

  // Tibia joint
  const tibiaJoint = new THREE.Group();
  tibiaJoint.position.y = -femurLen;
  const tibia = new THREE.Mesh(
    new THREE.CylinderGeometry(2.5, 2.5, tibiaLen, 8),
    legMaterial
  );
  tibia.position.y = -tibiaLen / 2;
  tibiaJoint.add(tibia);
  const tibiaBall = new THREE.Mesh(new THREE.SphereGeometry(4, 8, 8), jointMaterial);
  tibiaJoint.add(tibiaBall);

  // Foot
  const foot = new THREE.Mesh(new THREE.SphereGeometry(4, 8, 8), footMaterial.clone());
  foot.position.y = -tibiaLen;
  tibiaJoint.add(foot);

  // Build hierarchy
  femurJoint.add(tibiaJoint);
  coxaJoint.add(femurJoint);
  legGroup.add(coxaJoint);

  // Position leg at attach point (config x→3D z, config y→3D x)
  const posX = attachPoint.y * GEOMETRY_SCALE;
  const posZ = attachPoint.x * GEOMETRY_SCALE;
  const posY = (state.telemetry.bodyHeight || 80) + (attachPoint.z * GEOMETRY_SCALE);
  legGroup.position.set(posX, posY, posZ);
  legGroup.rotation.y = (attachPoint.angle * Math.PI) / 180;

  return { group: legGroup, coxaJoint, femurJoint, tibiaJoint, foot };
}

// Rebuild all legs with current geometry
function rebuildLegs() {
  if (!scene || !legMaterial) return;

  // Remove old legs
  legs.forEach(leg => {
    scene.remove(leg.group);
    // Dispose geometries recursively
    leg.group.traverse(child => {
      if (child.geometry) child.geometry.dispose();
    });
  });
  legs = [];

  // Create 6 new legs
  for (let i = 0; i < 6; i++) {
    const leg = createLeg(i);
    scene.add(leg.group);
    legs.push(leg);
  }
}

// Update leg positions without full rebuild (for attach point changes)
function updateLegPositions() {
  legs.forEach((leg, i) => {
    const attachPoint = getLegAttachPoint(i);
    const posX = attachPoint.y * GEOMETRY_SCALE;
    const posZ = attachPoint.x * GEOMETRY_SCALE;
    const posY = (state.telemetry.bodyHeight || 80) + (attachPoint.z * GEOMETRY_SCALE);
    leg.group.position.set(posX, posY, posZ);
    leg.group.rotation.y = (attachPoint.angle * Math.PI) / 180;
  });
}

const previewCanvas = document.getElementById('previewCanvas');

if (previewCanvas && typeof THREE !== 'undefined') {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0f18);

  camera = new THREE.PerspectiveCamera(45, previewCanvas.clientWidth / previewCanvas.clientHeight, 0.1, 1000);
  camera.position.set(300, 200, 300);
  camera.lookAt(0, 50, 0);

  renderer = new THREE.WebGLRenderer({ canvas: previewCanvas, antialias: true });
  renderer.setSize(previewCanvas.clientWidth, previewCanvas.clientHeight);

  // Lights
  const ambientLight = new THREE.AmbientLight(0x404040, 0.6);
  scene.add(ambientLight);
  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
  directionalLight.position.set(100, 200, 100);
  scene.add(directionalLight);

  // Ground grid
  const gridHelper = new THREE.GridHelper(400, 20, 0x1f2c46, 0x0d1727);
  scene.add(gridHelper);

  // Initialize shared materials
  bodyMaterial = new THREE.MeshLambertMaterial({ color: 0x2d3b5a });
  legMaterial = new THREE.MeshLambertMaterial({ color: 0x44dd88 });
  jointMaterial = new THREE.MeshLambertMaterial({ color: 0x666666 });
  footMaterial = new THREE.MeshLambertMaterial({ color: 0x333333 });

  // Build hexapod from geometry config
  rebuildBodyMesh();
  rebuildLegs();

  // Camera orbit controls (simple mouse drag)
  let isDragging = false;
  let previousMousePosition = { x: 0, y: 0 };

  previewCanvas.addEventListener('mousedown', (e) => {
    isDragging = true;
    previousMousePosition = { x: e.clientX, y: e.clientY };
  });

  previewCanvas.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const deltaX = e.clientX - previousMousePosition.x;
    const deltaY = e.clientY - previousMousePosition.y;

    cameraTheta -= deltaX * 0.01;
    cameraPhi = Math.max(0.1, Math.min(Math.PI / 2 - 0.1, cameraPhi - deltaY * 0.01));

    updateCameraPosition();
    previousMousePosition = { x: e.clientX, y: e.clientY };
  });

  previewCanvas.addEventListener('mouseup', () => isDragging = false);
  previewCanvas.addEventListener('mouseleave', () => isDragging = false);

  previewCanvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    cameraRadius = Math.max(150, Math.min(800, cameraRadius + e.deltaY * 0.5));
    updateCameraPosition();
  });

  // Animation loop
  let animationTime = 0;

  function animate() {
    requestAnimationFrame(animate);
    animationTime += 0.016; // ~60fps

    // Idle animation when not connected and no test action is active
    if (!state.connected && !state.testActionActive) {
      const breathe = Math.sin(animationTime * 1.5) * 0.5;
      state.telemetry.pitch = breathe;
      state.telemetry.roll = Math.sin(animationTime * 0.7) * 0.3;

      // Subtle leg movement
      legs.forEach((leg, i) => {
        const phase = (i / 6) * Math.PI * 2;
        const legBreath = Math.sin(animationTime * 1.5 + phase) * 2;
        state.legAngles[i].femur = 45 + legBreath;
        state.legAngles[i].tibia = -90 - legBreath * 0.5;
      });
    }

    // Update leg angles from state
    legs.forEach((leg, i) => {
      const angles = state.legAngles[i];
      leg.coxaJoint.rotation.y = (angles.coxa - 90) * Math.PI / 180;
      leg.femurJoint.rotation.z = (angles.femur - 90) * Math.PI / 180;
      leg.tibiaJoint.rotation.z = (angles.tibia + 90) * Math.PI / 180;

      // Update foot color based on contact
      if (leg.foot.material) {
        leg.foot.material.color.set(state.footContacts[i] ? 0x51cf66 : 0xff6b6b);
      }
    });

    // Update body pose
    body.position.y = state.telemetry.bodyHeight;
    body.rotation.x = state.telemetry.pitch * Math.PI / 180;
    body.rotation.z = state.telemetry.roll * Math.PI / 180;
    body.rotation.y = state.telemetry.yaw * Math.PI / 180;

    renderer.render(scene, camera);
  }
  animate();

  // Resize handler
  window.addEventListener('resize', () => {
    const container = previewCanvas.parentElement;
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  });
}

// Preview view buttons with smooth camera transitions
document.querySelectorAll('.preview-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.preview-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    const view = btn.dataset.view;
    let targetTheta, targetPhi;

    switch (view) {
      case 'front':
        targetTheta = 0;
        targetPhi = Math.PI / 3;  // Slightly lower angle to see full hexapod
        break;
      case 'side':
        targetTheta = Math.PI / 2;
        targetPhi = Math.PI / 3;
        break;
      case 'top':
        targetTheta = 0;
        targetPhi = 0.05;  // Nearly straight down
        break;
      default: // iso
        targetTheta = Math.PI / 4;
        targetPhi = Math.PI / 4;
        break;
    }

    // Smooth transition over 1.5 seconds
    animateCameraTo(targetTheta, targetPhi, 1500);
  });
});

function updatePreviewFromSlider(key, value) {
  if (!body) return;

  switch (key) {
    case 'bodyHeight':
    case 'body_height':
      state.telemetry.bodyHeight = value;
      sendCommand('body_height', { height: value });
      break;
    case 'bodyRoll':
    case 'body_roll':
      state.telemetry.roll = value;
      sendCommand('body_pose', { roll: value });
      break;
    case 'bodyPitch':
    case 'body_pitch':
      state.telemetry.pitch = value;
      sendCommand('body_pose', { pitch: value });
      break;
    case 'bodyYaw':
    case 'body_yaw':
      state.telemetry.yaw = value;
      sendCommand('body_pose', { yaw: value });
      break;
  }
}

function updatePreview() {
  // Update preview based on current config
  if (state.config.body_height) state.telemetry.bodyHeight = state.config.body_height;
}

// Animate pose transition in 3D preview
function animatePoseTransition(targetHeight, targetRoll, targetPitch, targetYaw, duration = 500) {
  const startHeight = state.telemetry.bodyHeight;
  const startRoll = state.telemetry.roll;
  const startPitch = state.telemetry.pitch;
  const startYaw = state.telemetry.yaw;
  const startTime = Date.now();

  function step() {
    const elapsed = Date.now() - startTime;
    const progress = Math.min(elapsed / duration, 1);
    // Ease-out curve
    const eased = 1 - Math.pow(1 - progress, 3);

    state.telemetry.bodyHeight = startHeight + (targetHeight - startHeight) * eased;
    state.telemetry.roll = startRoll + (targetRoll - startRoll) * eased;
    state.telemetry.pitch = startPitch + (targetPitch - startPitch) * eased;
    state.telemetry.yaw = startYaw + (targetYaw - startYaw) * eased;

    if (progress < 1) {
      requestAnimationFrame(step);
    }
  }
  step();
}

// ========== Saved Poses Preview Buttons ==========
document.getElementById('savedPosesTable')?.querySelectorAll('tbody tr').forEach(row => {
  const previewBtn = row.querySelector('.btn-secondary');
  if (previewBtn && previewBtn.textContent.includes('Preview')) {
    previewBtn.addEventListener('click', () => {
      const height = parseFloat(row.dataset.height) || 80;
      const roll = parseFloat(row.dataset.roll) || 0;
      const pitch = parseFloat(row.dataset.pitch) || 0;
      const yaw = parseFloat(row.dataset.yaw) || 0;

      animatePoseTransition(height, roll, pitch, yaw);

      const poseName = row.querySelector('td strong')?.textContent || 'Unknown';
      logEvent('INFO', `Previewing pose: ${poseName}`);
    });
  }
});

// ========== Test Action Buttons ==========
document.getElementById('testStand')?.addEventListener('click', () => {
  state.testActionActive = true;
  sendCommand('pose', { preset: 'stand' });

  // Animate to standing pose
  animatePoseTransition(120, 0, 0, 0, 800);
  animateLegsTo({ femur: 30, tibia: -60 }, 800);  // Extended legs

  logEvent('INFO', 'Stand pose commanded');
});

document.getElementById('testCrouch')?.addEventListener('click', () => {
  state.testActionActive = true;
  sendCommand('pose', { preset: 'crouch' });

  // Animate to crouched pose
  animatePoseTransition(50, 0, 0, 0, 800);
  animateLegsTo({ femur: 70, tibia: -120 }, 800);  // Bent legs

  logEvent('INFO', 'Crouch pose commanded');
});

document.getElementById('testWalk')?.addEventListener('click', () => {
  state.testActionActive = true;
  sendCommand('walk', { walking: true });
  logEvent('INFO', 'Walk test started');

  // Animate a walking motion for demo
  let walkStep = 0;
  const walkInterval = setInterval(() => {
    const roll = Math.sin(walkStep * 0.3) * 5;
    const pitch = Math.sin(walkStep * 0.5) * 3;
    state.telemetry.roll = roll;
    state.telemetry.pitch = pitch;

    // Animate leg walking motion
    state.legAngles.forEach((angles, i) => {
      const phase = (i % 2 === 0) ? 0 : Math.PI;  // Alternating legs
      const liftPhase = Math.sin(walkStep * 0.4 + phase);
      angles.femur = 45 + liftPhase * 15;
      angles.tibia = -90 - liftPhase * 10;
      state.footContacts[i] = liftPhase < 0;
    });

    walkStep++;
  }, 50);

  setTimeout(() => {
    clearInterval(walkInterval);
    sendCommand('walk', { walking: false });
    animatePoseTransition(state.telemetry.bodyHeight, 0, 0, 0, 500);
    animateLegsTo({ femur: 45, tibia: -90 }, 500);
    // Reset foot contacts
    state.footContacts = [true, true, true, true, true, true];
    logEvent('INFO', 'Walk test stopped');
  }, 3000);
});

document.getElementById('testReset')?.addEventListener('click', () => {
  state.testActionActive = false;  // Re-enable idle animation
  sendCommand('pose', { preset: 'neutral' });
  animatePoseTransition(80, 0, 0, 0, 600);
  animateLegsTo({ femur: 45, tibia: -90 }, 600);
  logEvent('INFO', 'Reset to neutral pose');
});

// Helper function to animate all legs to target angles
function animateLegsTo(targetAngles, duration = 500) {
  const startAngles = state.legAngles.map(a => ({ ...a }));
  const startTime = Date.now();

  function step() {
    const elapsed = Date.now() - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);

    state.legAngles.forEach((angles, i) => {
      if (targetAngles.coxa !== undefined) {
        angles.coxa = startAngles[i].coxa + (targetAngles.coxa - startAngles[i].coxa) * eased;
      }
      if (targetAngles.femur !== undefined) {
        angles.femur = startAngles[i].femur + (targetAngles.femur - startAngles[i].femur) * eased;
      }
      if (targetAngles.tibia !== undefined) {
        angles.tibia = startAngles[i].tibia + (targetAngles.tibia - startAngles[i].tibia) * eased;
      }
    });

    if (progress < 1) {
      requestAnimationFrame(step);
    }
  }
  step();
}

// ========== E-Stop ==========
document.getElementById('estopBtn')?.addEventListener('click', () => {
  sendCommand('estop', {});
  document.getElementById('estopBtn').classList.add('active');
  logEvent('WARN', 'EMERGENCY STOP ACTIVATED');
  setTimeout(() => {
    document.getElementById('estopBtn').classList.remove('active');
  }, 1000);
});

// ========== Gait Controls ==========
document.querySelectorAll('.gait-row').forEach(row => {
  row.addEventListener('click', () => {
    // Update radio button
    const radio = row.querySelector('input[type="radio"]');
    if (radio) radio.checked = true;

    // Update status display
    document.querySelectorAll('.gait-row').forEach(r => {
      const statusCell = r.querySelector('.gait-status');
      if (statusCell) statusCell.innerHTML = '-';
    });
    const statusCell = row.querySelector('.gait-status');
    if (statusCell) statusCell.innerHTML = '<span class="tag tag-success">Active</span>';

    // Send command
    const gait = row.dataset.gait;
    sendCommand('set_gait', { mode: gait });
    logEvent('INFO', `Gait changed to ${gait}`);
  });
});

// Also handle direct radio button clicks
document.querySelectorAll('input[name="activeGait"]').forEach(radio => {
  radio.addEventListener('change', () => {
    const row = radio.closest('.gait-row');
    if (row) row.click();
  });
});

// ========== Pose Recording ==========
document.querySelector('[data-action="record-pose"]')?.addEventListener('click', () => {
  const pose = {
    timestamp: Date.now(),
    name: `Pose ${state.recordedPoses.length + 1}`,
    angles: JSON.parse(JSON.stringify(state.legAngles)),
    bodyPose: {
      roll: state.telemetry.roll,
      pitch: state.telemetry.pitch,
      yaw: state.telemetry.yaw,
      height: state.telemetry.bodyHeight
    }
  };
  state.recordedPoses.push(pose);
  updatePoseList();
  logEvent('INFO', `Recorded ${pose.name}`);
});

function updatePoseList() {
  const list = document.getElementById('poseList');
  if (!list) return;
  list.innerHTML = state.recordedPoses.map((pose, i) => `
    <div class="pose-item" data-index="${i}">
      <span>${pose.name}</span>
      <div>
        <button class="btn btn-sm" onclick="playPose(${i})">Play</button>
        <button class="btn btn-sm btn-danger" onclick="deletePose(${i})">X</button>
      </div>
    </div>
  `).join('');
}

window.playPose = function(index) {
  const pose = state.recordedPoses[index];
  if (pose) {
    sendCommand('set_pose', pose);
    logEvent('INFO', `Playing ${pose.name}`);
  }
};

window.deletePose = function(index) {
  state.recordedPoses.splice(index, 1);
  updatePoseList();
};

// ========== Self-Test Routines ==========
document.querySelectorAll('#tab-log-selftest .btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    const text = btn.textContent.toLowerCase();
    btn.disabled = true;
    btn.classList.add('testing');

    if (text.includes('single leg')) {
      const leg = state.selectedLeg ?? 0;
      sendCommand('test_leg', { leg });
      logEvent('INFO', `Testing leg ${leg}`);
    } else if (text.includes('walk')) {
      sendCommand('test_walk', { steps: 2 });
      logEvent('INFO', 'Walking forward 2 steps');
    } else if (text.includes('symmetry')) {
      sendCommand('test_symmetry', {});
      logEvent('INFO', 'Checking symmetry');
    } else if (text.includes('camera')) {
      sendCommand('test_camera', {});
      logEvent('INFO', 'Testing cameras');
    } else if (text.includes('imu')) {
      sendCommand('calibrate_imu', {});
      logEvent('INFO', 'Calibrating IMU');
    } else if (text.includes('battery')) {
      sendCommand('check_battery', {});
      logEvent('INFO', 'Checking battery');
    }

    setTimeout(() => {
      btn.disabled = false;
      btn.classList.remove('testing');
    }, 3000);
  });
});

// ========== Event Logging ==========
function logEvent(level, message) {
  const logPanel = document.getElementById('eventLog');
  if (!logPanel) return;

  const time = new Date().toLocaleTimeString();
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.innerHTML = `
    <span class="log-time">${time}</span>
    <span class="log-level ${level.toLowerCase()}">${level}</span>
    <span class="log-message">${message}</span>
  `;

  logPanel.insertBefore(entry, logPanel.firstChild);

  // Keep only last 100 entries
  while (logPanel.children.length > 100) {
    logPanel.removeChild(logPanel.lastChild);
  }
}

// ========== Sparkline Rendering ==========
function updateSparkline(id, value) {
  const data = sparklineData[id];
  if (!data) return;

  data.push(value);
  if (data.length > SPARKLINE_MAX_POINTS) data.shift();

  const container = document.getElementById(id);
  if (!container) return;

  const width = container.clientWidth || 80;
  const height = container.clientHeight || 24;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const points = data.map((v, i) => {
    const x = (i / (SPARKLINE_MAX_POINTS - 1)) * width;
    const y = height - ((v - min) / range) * height;
    return `${x},${y}`;
  }).join(' ');

  container.innerHTML = `<svg width="${width}" height="${height}">
    <polyline fill="none" stroke="var(--accent)" stroke-width="1.5" points="${points}"/>
  </svg>`;
}

// ========== Live Status Updates ==========
function updateLiveStatus() {
  const t = state.telemetry;

  const liveHeight = document.getElementById('liveHeight');
  const liveSpeed = document.getElementById('liveSpeed');
  const liveRoll = document.getElementById('liveRoll');
  const livePitch = document.getElementById('livePitch');
  const liveTemp = document.getElementById('liveTemp');
  const liveBattery = document.getElementById('liveBattery');

  if (liveHeight) liveHeight.textContent = t.bodyHeight.toFixed(0) + ' mm';
  if (liveSpeed) liveSpeed.textContent = t.speed.toFixed(1) + ' m/s';
  if (liveRoll) liveRoll.textContent = t.roll.toFixed(1) + '°';
  if (livePitch) livePitch.textContent = t.pitch.toFixed(1) + '°';
  if (liveTemp) liveTemp.textContent = t.temperature.toFixed(0) + '°C';
  if (liveBattery) liveBattery.textContent = t.battery.toFixed(1) + 'V';

  // Update sparklines
  updateSparkline('spark-roll', t.roll);
  updateSparkline('spark-pitch', t.pitch);
  updateSparkline('spark-yaw', t.yaw);

  // Update foot contact indicators
  const footIndicators = document.querySelectorAll('[data-foot]');
  footIndicators.forEach((el, i) => {
    if (i < state.footContacts.length) {
      el.style.background = state.footContacts[i] ? 'var(--success)' : 'var(--danger)';
    }
  });
}

// ========== WebSocket Connection ==========
let ws = null;
let reconnectAttempts = 0;
const maxReconnectAttempts = 10;

function connectWebSocket() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${location.host}/ws`;

  try {
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      state.connected = true;
      reconnectAttempts = 0;
      document.getElementById('connectionDot')?.classList.add('connected');
      const connText = document.getElementById('connectionText');
      if (connText) connText.textContent = 'Connected';
      logEvent('INFO', 'WebSocket connected');

      // Load config after connection
      loadConfig();
      loadProfiles();
    };

    ws.onclose = () => {
      state.connected = false;
      document.getElementById('connectionDot')?.classList.remove('connected');
      const connText = document.getElementById('connectionText');

      if (reconnectAttempts < maxReconnectAttempts) {
        reconnectAttempts++;
        const delay = Math.min(2000 * reconnectAttempts, 10000);
        if (connText) connText.textContent = `Reconnecting (${reconnectAttempts})...`;
        setTimeout(connectWebSocket, delay);
      } else {
        if (connText) {
          connText.textContent = 'Click to reconnect';
          connText.style.cursor = 'pointer';
          connText.onclick = () => {
            reconnectAttempts = 0;
            connectWebSocket();
          };
        }
      }
    };

    ws.onerror = () => {
      logEvent('ERROR', 'WebSocket error');
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'telemetry') {
          // Update telemetry
          if (data.battery_v !== undefined) state.telemetry.battery = data.battery_v;
          if (data.temperature_c !== undefined) state.telemetry.temperature = data.temperature_c;
          if (data.roll !== undefined) state.telemetry.roll = data.roll;
          if (data.pitch !== undefined) state.telemetry.pitch = data.pitch;
          if (data.yaw !== undefined) state.telemetry.yaw = data.yaw;
          if (data.body_height !== undefined) state.telemetry.bodyHeight = data.body_height;
          if (data.speed !== undefined) state.telemetry.speed = data.speed;

          // Update leg angles
          if (data.angles && data.angles.length === 6) {
            data.angles.forEach((angles, i) => {
              state.legAngles[i] = {
                coxa: angles[0],
                femur: angles[1],
                tibia: angles[2]
              };
            });

            // Update sparklines for first leg
            updateSparkline('spark-l0-coxa', state.legAngles[0].coxa);
            updateSparkline('spark-l0-femur', state.legAngles[0].femur);
            updateSparkline('spark-l0-tibia', state.legAngles[0].tibia);
          }

          // Update foot contacts
          if (data.ground_contacts) {
            state.footContacts = data.ground_contacts;
          }

          updateLiveStatus();
        }
      } catch (e) {
        console.error('Message parse error:', e);
      }
    };
  } catch (e) {
    logEvent('ERROR', 'WebSocket connection failed: ' + e.message);
    setTimeout(connectWebSocket, 2000);
  }
}

// ========== Target Selector ==========
document.getElementById('targetSelect')?.addEventListener('change', (e) => {
  const target = e.target.value;
  logEvent('INFO', `Target changed to: ${target}`);
  // Would configure simulation vs real robot connection here
});

// ========== Summary Cards ==========
function updateSummaryCards() {
  const c = state.config;

  // Geometry card
  const bodyLength = c.body_length || 300;
  const bodyWidth = c.body_width || 200;
  const summaryGeometry = document.getElementById('summaryGeometry');
  if (summaryGeometry) {
    summaryGeometry.textContent = `${bodyLength} x ${bodyWidth}mm`;
  }
  const summaryGeometryMeta = document.getElementById('summaryGeometryMeta');
  if (summaryGeometryMeta) {
    const coxaLen = c.leg_coxa_length || 30;
    const femurLen = c.leg_femur_length || 50;
    const tibiaLen = c.leg_tibia_length || 80;
    summaryGeometryMeta.textContent = `Leg: ${coxaLen}+${femurLen}+${tibiaLen}mm`;
  }

  // Servos card
  const summaryServos = document.getElementById('summaryServos');
  if (summaryServos) {
    summaryServos.textContent = '18 servos';
  }
  const summaryServosMeta = document.getElementById('summaryServosMeta');
  if (summaryServosMeta) {
    const servoType = c.servo_type || 'DS3218';
    summaryServosMeta.textContent = `Type: ${servoType}`;
  }

  // Gait card
  const summaryGait = document.getElementById('summaryGait');
  if (summaryGait) {
    const gaitName = state.activeGait.charAt(0).toUpperCase() + state.activeGait.slice(1);
    summaryGait.textContent = gaitName;
  }
  const summaryGaitMeta = document.getElementById('summaryGaitMeta');
  if (summaryGaitMeta) {
    const stepLen = c.gait_step_length || 60;
    const stepHeight = c.gait_step_height || 30;
    summaryGaitMeta.textContent = `Step: ${stepLen}mm, Height: ${stepHeight}mm`;
  }

  // Body Pose card
  const summaryPose = document.getElementById('summaryPose');
  if (summaryPose) {
    const height = c.body_height || state.telemetry.bodyHeight || 120;
    summaryPose.textContent = `Height: ${height}mm`;
  }
  const summaryPoseMeta = document.getElementById('summaryPoseMeta');
  if (summaryPoseMeta) {
    const roll = c.body_roll || state.telemetry.roll || 0;
    const pitch = c.body_pitch || state.telemetry.pitch || 0;
    const yaw = c.body_yaw || state.telemetry.yaw || 0;
    summaryPoseMeta.textContent = `R: ${roll.toFixed(1)}° P: ${pitch.toFixed(1)}° Y: ${yaw.toFixed(1)}°`;
  }
}

// Summary card click navigation
document.querySelectorAll('.summary-card[data-nav]').forEach(card => {
  card.addEventListener('click', () => {
    const targetSection = card.dataset.nav;
    const navItem = document.querySelector(`.nav-item[data-section="${targetSection}"]`);
    if (navItem) {
      navItem.click();
      logEvent('INFO', `Navigated to ${targetSection}`);
    }
  });
});

// ========== New Profile Button ==========
document.getElementById('btnNewProfile')?.addEventListener('click', () => {
  const name = prompt('Enter name for the new profile:');
  if (name && name.trim()) {
    const trimmedName = name.trim().toLowerCase().replace(/\s+/g, '_');

    // Check if profile already exists
    const exists = state.profiles.some(p => {
      const pName = typeof p === 'string' ? p : p.name;
      return pName === trimmedName;
    });

    if (exists) {
      alert('A profile with this name already exists.');
      return;
    }

    const description = prompt('Enter description (optional):', '');

    // Add to state
    state.profiles.push(trimmedName);
    state.profilesData[trimmedName] = {
      name: trimmedName,
      description: description || '',
      lastModified: new Date().toISOString(),
      isDefault: false
    };

    // Copy current config to new profile and save to localStorage
    const sourceConfig = loadConfigFromStorage(state.currentProfile) || state.config;
    saveConfigToStorage(trimmedName, { ...sourceConfig });
    saveProfilesToStorage();

    // Try to save to backend too
    fetch('/api/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'create',
        name: trimmedName,
        description: description || '',
        copyFrom: state.currentProfile
      })
    }).catch(e => console.log('Backend save failed:', e));

    // Update UI
    updateProfileSelector();
    renderProfileTable();

    // Switch to the new profile
    selectProfile(trimmedName);

    logEvent('INFO', `Created new profile: ${trimmedName}`);
  }
});

// ========== Import Profile Button ==========
document.getElementById('btnImportProfile')?.addEventListener('click', () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const imported = JSON.parse(text);

      // Handle new export format (with config wrapper) or legacy format
      const configData = imported.config || imported;
      const profileDescription = imported.profile_description || imported.description || `Imported from ${file.name}`;

      // Determine profile name from export data or filename
      let profileName = imported.profile_name || file.name.replace('.json', '').replace(/[^a-z0-9_]/gi, '_').toLowerCase();

      // Check if exists
      const exists = state.profiles.some(p => {
        const pName = typeof p === 'string' ? p : p.name;
        return pName === profileName;
      });

      if (exists) {
        const newName = prompt(`Profile "${profileName}" already exists. Enter a new name:`, profileName + '_imported');
        if (!newName || !newName.trim()) return;
        profileName = newName.trim().toLowerCase().replace(/\s+/g, '_');
      }

      // Add profile with metadata from export
      state.profiles.push(profileName);
      state.profilesData[profileName] = {
        name: profileName,
        description: profileDescription,
        lastModified: imported.last_modified || new Date().toISOString(),
        isDefault: false,
        imported_from: imported.profile_id || null,
        imported_at: new Date().toISOString()
      };

      // Save the config data (not the wrapper) to localStorage
      saveConfigToStorage(profileName, configData);
      saveProfilesToStorage();

      // Try to save to backend too
      try {
        await fetch('/api/profiles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'create',
            name: profileName,
            description: profileDescription,
            config: configData
          })
        });
      } catch (err) {
        console.log('Backend save failed, storing locally');
      }

      updateProfileSelector();
      renderProfileTable();
      selectProfile(profileName);

      logEvent('INFO', `Imported profile "${profileName}" with ${Object.keys(configData).length} settings`);
    } catch (err) {
      logEvent('ERROR', 'Failed to import profile: ' + err.message);
      alert('Failed to import profile. Please ensure the file is valid JSON.');
    }
  };
  input.click();
});

// ========== Geometry & Frames Section ==========
// Note: defaultGeometry is defined earlier (before 3D Preview) so it can be used during initialization

// Initialize geometry from config or defaults
function initGeometrySection() {
  // Body dimension sliders with specific value elements
  setupGeometrySlider('bodyLength', 'bodyLengthValue', 'body_length', 'mm');
  setupGeometrySlider('bodyWidth', 'bodyWidthValue', 'body_width', 'mm');
  setupGeometrySlider('bodyHeightGeo', 'bodyHeightGeoValue', 'body_height_geo', 'mm');

  // Leg segment sliders
  setupGeometrySlider('coxaLength', 'coxaLengthValue', 'leg_coxa_length', 'mm');
  setupGeometrySlider('femurLength', 'femurLengthValue', 'leg_femur_length', 'mm');
  setupGeometrySlider('tibiaLength', 'tibiaLengthValue', 'leg_tibia_length', 'mm');

  // Leg attach points table
  setupLegAttachTable();

  // Symmetry mode checkbox
  const symmetryCheckbox = document.getElementById('symmetryMode');
  if (symmetryCheckbox) {
    symmetryCheckbox.addEventListener('change', () => {
      const enabled = symmetryCheckbox.checked;
      logEvent('INFO', `Symmetry mode ${enabled ? 'enabled' : 'disabled'}`);
      if (enabled) {
        applySymmetry();
      }
    });
  }

  // All legs identical checkbox
  const allLegsCheckbox = document.getElementById('allLegsIdentical');
  if (allLegsCheckbox) {
    allLegsCheckbox.addEventListener('change', () => {
      const enabled = allLegsCheckbox.checked;
      logEvent('INFO', `All legs identical: ${enabled ? 'yes' : 'no'}`);
    });
  }

  // Reset to defaults button
  const resetBtn = document.querySelector('#tab-geo-body .btn-secondary');
  if (resetBtn && resetBtn.textContent.includes('Reset')) {
    resetBtn.addEventListener('click', () => {
      if (confirm('Reset body geometry to defaults?')) {
        resetGeometryToDefaults();
      }
    });
  }

  // Axis orientation selects
  setupAxisSelects();

  // Reference frames table
  setupFramesTable();
}

function setupGeometrySlider(sliderId, valueId, configKey, unit) {
  const slider = document.getElementById(sliderId);
  const valueEl = document.getElementById(valueId);

  if (!slider || !valueEl) return;

  // Set initial value from config or default
  const initialValue = state.config[configKey] || defaultGeometry[configKey] || slider.value;
  slider.value = initialValue;
  valueEl.textContent = `${initialValue} ${unit}`;

  slider.addEventListener('input', () => {
    const value = parseFloat(slider.value);
    valueEl.textContent = `${value} ${unit}`;

    // Debounced save to config
    clearTimeout(slider._geoSaveTimeout);
    slider._geoSaveTimeout = setTimeout(() => {
      const update = {};
      update[configKey] = value;
      saveConfig(update);

      // Update 3D preview if applicable
      updateGeometryPreview(configKey, value);
    }, 300);
  });
}

function setupLegAttachTable() {
  const table = document.getElementById('legAttachTable');
  if (!table) return;

  const rows = table.querySelectorAll('tr');
  rows.forEach((row, legIndex) => {
    const inputs = row.querySelectorAll('input[type="number"]');
    inputs.forEach((input, fieldIndex) => {
      const fields = ['x', 'y', 'z', 'angle'];
      const field = fields[fieldIndex];

      // Load value from config if available
      const configKey = `leg_${legIndex}_attach_${field}`;
      if (state.config[configKey] !== undefined) {
        input.value = state.config[configKey];
      }

      input.addEventListener('change', () => {
        const value = parseFloat(input.value);
        const update = {};
        update[configKey] = value;
        saveConfig(update);

        // Update 3D preview
        updateGeometryPreview(configKey, value);

        // Apply symmetry if enabled
        const symmetryCheckbox = document.getElementById('symmetryMode');
        if (symmetryCheckbox && symmetryCheckbox.checked) {
          applySymmetryForLeg(legIndex, field, value);
        }

        logEvent('INFO', `Leg ${legIndex} ${field} set to ${value}`);
      });
    });
  });
}

function applySymmetry() {
  // Apply symmetry: left/right leg pairs mirror each other
  // Pairs: 0-5 (FR-FL), 1-4 (MR-ML), 2-3 (RR-RL)
  const pairs = [[0, 5], [1, 4], [2, 3]];
  const table = document.getElementById('legAttachTable');
  if (!table) return;

  pairs.forEach(([rightLeg, leftLeg]) => {
    const rightRow = table.querySelectorAll('tr')[rightLeg];
    const leftRow = table.querySelectorAll('tr')[leftLeg];
    if (!rightRow || !leftRow) return;

    const rightInputs = rightRow.querySelectorAll('input[type="number"]');
    const leftInputs = leftRow.querySelectorAll('input[type="number"]');

    // Mirror: X stays same, Y negates, Z stays same, angle mirrors
    if (rightInputs[0] && leftInputs[0]) {
      leftInputs[0].value = rightInputs[0].value; // X same
    }
    if (rightInputs[1] && leftInputs[1]) {
      leftInputs[1].value = -parseFloat(rightInputs[1].value); // Y negated
    }
    if (rightInputs[2] && leftInputs[2]) {
      leftInputs[2].value = rightInputs[2].value; // Z same
    }
    if (rightInputs[3] && leftInputs[3]) {
      // Angle mirrors: 360 - angle for left side
      const rightAngle = parseFloat(rightInputs[3].value);
      leftInputs[3].value = 360 - rightAngle;
    }
  });

  // Update 3D preview
  updateLegPositions();

  logEvent('INFO', 'Symmetry applied to leg attach points');
}

function applySymmetryForLeg(legIndex, field, value) {
  const pairs = { 0: 5, 5: 0, 1: 4, 4: 1, 2: 3, 3: 2 };
  const mirrorLeg = pairs[legIndex];
  if (mirrorLeg === undefined) return;

  const table = document.getElementById('legAttachTable');
  if (!table) return;

  const mirrorRow = table.querySelectorAll('tr')[mirrorLeg];
  if (!mirrorRow) return;

  const fields = ['x', 'y', 'z', 'angle'];
  const fieldIndex = fields.indexOf(field);
  const mirrorInput = mirrorRow.querySelectorAll('input[type="number"]')[fieldIndex];
  if (!mirrorInput) return;

  let mirrorValue = value;
  if (field === 'y') {
    mirrorValue = -value;
  } else if (field === 'angle') {
    mirrorValue = 360 - value;
  }

  mirrorInput.value = mirrorValue;
  const update = {};
  const configKey = `leg_${mirrorLeg}_attach_${field}`;
  update[configKey] = mirrorValue;
  saveConfig(update);

  // Update 3D preview for mirrored leg
  updateGeometryPreview(configKey, mirrorValue);
}

function setupAxisSelects() {
  const axisConfig = [
    { selectId: 'coxaAxisSelect', configKey: 'coxa_axis' },
    { selectId: 'femurAxisSelect', configKey: 'femur_axis' },
    { selectId: 'tibiaAxisSelect', configKey: 'tibia_axis' }
  ];

  // Find selects in the Axis Orientation card
  const card = document.querySelector('#tab-geo-legs .card:last-child');
  if (!card) return;

  const selects = card.querySelectorAll('select');
  const configs = ['coxa_axis', 'femur_axis', 'tibia_axis'];

  selects.forEach((select, index) => {
    if (index >= configs.length) return;
    const configKey = configs[index];

    // Set initial value from config
    if (state.config[configKey]) {
      select.value = state.config[configKey];
    }

    select.addEventListener('change', () => {
      const update = {};
      update[configKey] = select.value;
      saveConfig(update);
      logEvent('INFO', `${configKey} set to ${select.value}`);
    });
  });
}

function setupFramesTable() {
  // Add edit functionality to frame edit buttons
  const editButtons = document.querySelectorAll('#tab-geo-frames .btn-secondary');
  editButtons.forEach(btn => {
    if (!btn.textContent.includes('Edit')) return;

    btn.addEventListener('click', () => {
      const row = btn.closest('tr');
      if (!row) return;

      const cells = row.querySelectorAll('td');
      const frameName = cells[0]?.textContent?.trim();

      // Toggle edit mode
      if (row.classList.contains('editing')) {
        // Save and exit edit mode
        saveFrameEdit(row, frameName);
        row.classList.remove('editing');
        btn.textContent = 'Edit';
      } else {
        // Enter edit mode
        enableFrameEdit(row, frameName);
        row.classList.add('editing');
        btn.textContent = 'Save';
      }
    });
  });

  // Add new frame button functionality
  const addFrameBtn = document.querySelector('#tab-geo-frames .btn-primary');
  if (addFrameBtn) {
    addFrameBtn.addEventListener('click', () => {
      const name = prompt('Enter name for new frame:');
      if (name && name.trim()) {
        addNewFrame(name.trim());
      }
    });
  }
}

function enableFrameEdit(row, frameName) {
  const cells = row.querySelectorAll('td');

  // Position cell (index 2)
  const posCell = cells[2];
  if (posCell) {
    const posText = posCell.textContent.trim();
    const posParts = posText.split(',').map(s => parseFloat(s.trim()) || 0);
    posCell.innerHTML = `
      <input type="number" class="form-input" value="${posParts[0]}" style="width:60px" data-axis="x">
      <input type="number" class="form-input" value="${posParts[1]}" style="width:60px" data-axis="y">
      <input type="number" class="form-input" value="${posParts[2]}" style="width:60px" data-axis="z">
    `;
  }

  // Orientation cell (index 3)
  const oriCell = cells[3];
  if (oriCell) {
    const oriText = oriCell.textContent.trim().replace(/°/g, '');
    const oriParts = oriText.split(',').map(s => parseFloat(s.trim()) || 0);
    oriCell.innerHTML = `
      <input type="number" class="form-input" value="${oriParts[0]}" style="width:60px" data-axis="r">°
      <input type="number" class="form-input" value="${oriParts[1]}" style="width:60px" data-axis="p">°
      <input type="number" class="form-input" value="${oriParts[2]}" style="width:60px" data-axis="yaw">°
    `;
  }
}

function saveFrameEdit(row, frameName) {
  const cells = row.querySelectorAll('td');

  // Get position values
  const posInputs = cells[2]?.querySelectorAll('input');
  const position = posInputs ?
    [parseFloat(posInputs[0]?.value) || 0, parseFloat(posInputs[1]?.value) || 0, parseFloat(posInputs[2]?.value) || 0] :
    [0, 0, 0];

  // Get orientation values
  const oriInputs = cells[3]?.querySelectorAll('input');
  const orientation = oriInputs ?
    [parseFloat(oriInputs[0]?.value) || 0, parseFloat(oriInputs[1]?.value) || 0, parseFloat(oriInputs[2]?.value) || 0] :
    [0, 0, 0];

  // Update display
  if (cells[2]) cells[2].textContent = position.join(', ');
  if (cells[3]) cells[3].textContent = `${orientation[0]}°, ${orientation[1]}°, ${orientation[2]}°`;

  // Save to config
  const update = {};
  update[`frame_${frameName}_position`] = position;
  update[`frame_${frameName}_orientation`] = orientation;
  saveConfig(update);

  logEvent('INFO', `Frame "${frameName}" updated`);
}

function addNewFrame(name) {
  const tbody = document.querySelector('#tab-geo-frames table tbody');
  if (!tbody) return;

  const row = document.createElement('tr');
  row.innerHTML = `
    <td><strong>${escapeHtml(name)}</strong></td>
    <td>body</td>
    <td>0, 0, 0</td>
    <td>0°, 0°, 0°</td>
    <td>
      <button class="btn btn-secondary btn-sm">Edit</button>
      <button class="btn btn-danger btn-sm">Delete</button>
    </td>
  `;
  tbody.appendChild(row);

  // Add edit handler
  const editBtn = row.querySelector('.btn-secondary');
  editBtn.addEventListener('click', () => {
    if (row.classList.contains('editing')) {
      saveFrameEdit(row, name);
      row.classList.remove('editing');
      editBtn.textContent = 'Edit';
    } else {
      enableFrameEdit(row, name);
      row.classList.add('editing');
      editBtn.textContent = 'Save';
    }
  });

  // Add delete handler
  const deleteBtn = row.querySelector('.btn-danger');
  deleteBtn.addEventListener('click', () => {
    if (confirm(`Delete frame "${name}"?`)) {
      row.remove();
      const update = {};
      update[`frame_${name}_deleted`] = true;
      saveConfig(update);
      logEvent('WARN', `Frame "${name}" deleted`);
    }
  });

  // Save to config
  const update = {};
  update[`frame_${name}_position`] = [0, 0, 0];
  update[`frame_${name}_orientation`] = [0, 0, 0];
  update[`frame_${name}_parent`] = 'body';
  saveConfig(update);

  logEvent('INFO', `Frame "${name}" added`);
}

function resetGeometryToDefaults() {
  // Reset body dimensions
  setSliderAndSave('bodyLength', 'bodyLengthValue', defaultGeometry.body_length, 'mm', 'body_length');
  setSliderAndSave('bodyWidth', 'bodyWidthValue', defaultGeometry.body_width, 'mm', 'body_width');
  setSliderAndSave('bodyHeightGeo', 'bodyHeightGeoValue', defaultGeometry.body_height_geo, 'mm', 'body_height_geo');

  // Reset leg segments
  setSliderAndSave('coxaLength', 'coxaLengthValue', defaultGeometry.leg_coxa_length, 'mm', 'leg_coxa_length');
  setSliderAndSave('femurLength', 'femurLengthValue', defaultGeometry.leg_femur_length, 'mm', 'leg_femur_length');
  setSliderAndSave('tibiaLength', 'tibiaLengthValue', defaultGeometry.leg_tibia_length, 'mm', 'leg_tibia_length');

  // Reset leg attach points
  const table = document.getElementById('legAttachTable');
  if (table) {
    defaultGeometry.leg_attach_points.forEach((point, legIndex) => {
      const row = table.querySelectorAll('tr')[legIndex];
      if (!row) return;

      const inputs = row.querySelectorAll('input[type="number"]');
      if (inputs[0]) inputs[0].value = point.x;
      if (inputs[1]) inputs[1].value = point.y;
      if (inputs[2]) inputs[2].value = point.z;
      if (inputs[3]) inputs[3].value = point.angle;
    });
  }

  // Update 3D preview with new geometry
  rebuildBodyMesh();
  rebuildLegs();

  logEvent('INFO', 'Geometry reset to defaults');
}

function setSliderAndSave(sliderId, valueId, value, unit, configKey) {
  const slider = document.getElementById(sliderId);
  const valueEl = document.getElementById(valueId);
  if (slider) {
    slider.value = value;
  }
  if (valueEl) {
    valueEl.textContent = `${value} ${unit}`;
  }
  const update = {};
  update[configKey] = value;
  saveConfig(update);
}

function updateGeometryPreview(configKey, value) {
  // Update the 3D preview based on geometry changes
  if (!scene) return;

  // Body dimension changes require rebuilding the body mesh
  if (configKey === 'body_length' || configKey === 'body_width' || configKey === 'body_height_geo') {
    rebuildBodyMesh();
    logEvent('DEBUG', `Body geometry updated: ${configKey} = ${value}`);
  }

  // Leg segment length changes require rebuilding all legs
  if (configKey === 'leg_coxa_length' || configKey === 'leg_femur_length' || configKey === 'leg_tibia_length') {
    rebuildLegs();
    logEvent('DEBUG', `Leg geometry updated: ${configKey} = ${value}`);
  }

  // Leg attach point changes just update positions
  if (configKey.startsWith('leg_') && configKey.includes('_attach_')) {
    updateLegPositions();
    logEvent('DEBUG', `Leg positions updated: ${configKey} = ${value}`);
  }
}

// ========== Initialize ==========
connectWebSocket();
loadProfiles();
loadConfig();  // Load config immediately for demo mode / summary cards

// Initialize geometry section
setTimeout(initGeometrySection, 100);

// Periodic status update for non-websocket values
setInterval(updateLiveStatus, 100);

logEvent('INFO', 'Hexapod Configuration initialized');
console.log('Hexapod Configuration loaded');
