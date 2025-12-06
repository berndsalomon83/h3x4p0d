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
  gaits: {},  // Will be populated from API with gait definitions
  enabledGaits: [],  // List of enabled gait IDs
  telemetry: {
    battery: 11.4,
    temperature: 42,
    roll: 0,
    pitch: 0,
    yaw: 0,
    bodyHeight: 80,
    legSpread: 100,  // percentage: 100 = normal, >100 = spread out, <100 = tucked in
    speed: 0
  },
  legAngles: Array(6).fill(null).map(() => ({ coxa: 90, femur: 45, tibia: -90 })),
  footContacts: [true, false, true, true, false, true],
  selectedLeg: null,
  recordedPoses: [],
  poses: {},  // Saved poses from backend (pose_id -> pose data)
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
      step_length: 60,
      step_height: 30,
      cycle_time: 1.2,
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
  state.testActionActive = true;

  if (state.connected) {
    // Send to backend for real walk
    sendCommand('walk', { walking: true });
    logEvent('INFO', 'Walk test started (backend)');
    setTimeout(() => {
      sendCommand('walk', { walking: false });
      logEvent('INFO', 'Walk test stopped');
    }, 3000);
  } else {
    // Start local walking simulation for 3D preview
    startWalkSimulation();
    logEvent('INFO', 'Walk test started (offline simulation)');
    // Stop after 3 seconds
    setTimeout(() => {
      stopWalkSimulation();
      state.testActionActive = false;
      logEvent('INFO', 'Walk test stopped');
    }, 3000);
  }
});

// ========== Gaits Management ==========
function loadDefaultGaits() {
  // Fallback gaits for offline/demo mode (matches backend defaults)
  state.gaits = {
    tripod: { name: 'Tripod', description: 'Fast, stable gait with alternating groups of 3 legs', enabled: true, speed_range: 'Medium - Fast', stability: 'Medium', best_for: 'Flat terrain, speed' },
    wave: { name: 'Wave', description: 'Smooth, elegant sequential leg movement', enabled: true, speed_range: 'Slow', stability: 'High', best_for: 'Rough terrain, stability' },
    ripple: { name: 'Ripple', description: 'Balanced offset pattern between legs', enabled: true, speed_range: 'Medium', stability: 'High', best_for: 'General purpose' },
    creep: { name: 'Creep', description: 'Very slow, maximum stability gait', enabled: true, speed_range: 'Very Slow', stability: 'Very High', best_for: 'Precision, obstacles' }
  };
  state.enabledGaits = ['tripod', 'wave', 'ripple', 'creep'];
  state.activeGait = state.activeGait || 'tripod';  // Set default active gait if not already set
  renderGaitsTable();
  updateGaitSelector();
}

async function loadGaits() {
  try {
    const response = await fetch('/api/gaits');
    if (response.ok) {
      const data = await response.json();
      state.gaits = data.gaits || {};
      state.enabledGaits = data.enabled || [];
      state.activeGait = data.current || 'tripod';
      renderGaitsTable();
      updateGaitSelector();
      console.log('Loaded gaits from API:', Object.keys(state.gaits));
    } else {
      console.log('API returned error, using default gaits');
      loadDefaultGaits();
    }
  } catch (e) {
    console.log('Failed to load gaits from API, using defaults:', e);
    loadDefaultGaits();
  }
}

function renderGaitsTable() {
  const tbody = document.getElementById('gaitsTableBody');
  if (!tbody) return;

  const gaitIds = Object.keys(state.gaits);
  const countEl = document.getElementById('gaitCount');

  if (gaitIds.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--text-muted);">No gaits configured</td></tr>';
    if (countEl) countEl.textContent = '0 gaits';
    return;
  }

  // Update gait count badge
  if (countEl) {
    const enabledCount = state.enabledGaits.length;
    countEl.textContent = `${enabledCount}/${gaitIds.length} enabled`;
  }

  tbody.innerHTML = gaitIds.map(gaitId => {
    const gait = state.gaits[gaitId];
    const isEnabled = state.enabledGaits.includes(gaitId);
    const isActive = state.activeGait === gaitId;

    return `
      <tr class="gait-row ${isActive ? 'selected' : ''}" data-gait="${gaitId}">
        <td><input type="radio" name="activeGait" class="gait-radio" ${isActive ? 'checked' : ''} ${!isEnabled ? 'disabled' : ''} data-gait="${gaitId}"></td>
        <td>
          <strong class="gait-name">${escapeHtml(gait.name || gaitId)}</strong>
          <div style="font-size: 11px; color: var(--text-muted);">${escapeHtml(gait.description || '')}</div>
        </td>
        <td style="color: var(--text-muted); font-size: 12px;">${escapeHtml(gait.speed_range || '--')}</td>
        <td style="color: var(--text-muted); font-size: 12px;">${escapeHtml(gait.stability || '--')}</td>
        <td style="color: var(--text-muted); font-size: 12px;">${escapeHtml(gait.best_for || '--')}</td>
        <td>
          <span class="tag ${isEnabled ? 'tag-success' : 'tag-muted'}">${isEnabled ? 'Enabled' : 'Disabled'}</span>
        </td>
        <td>
          <button class="btn btn-secondary btn-sm gait-action-btn"
                  data-action="${isEnabled ? 'disable' : 'enable'}"
                  data-gait="${gaitId}"
                  ${isEnabled && isActive ? 'disabled title="Cannot disable active gait"' : ''}>
            ${isEnabled ? 'Disable' : 'Enable'}
          </button>
        </td>
      </tr>
    `;
  }).join('');

  // Add event listeners for radio buttons
  tbody.querySelectorAll('.gait-radio').forEach(radio => {
    radio.addEventListener('change', async (e) => {
      const gaitId = e.target.dataset.gait;
      await setActiveGait(gaitId);
    });
  });

  // Add event listeners for action buttons
  tbody.querySelectorAll('.gait-action-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      const button = e.currentTarget;
      const action = button.dataset.action;
      const gaitId = button.dataset.gait;
      if (action && gaitId) {
        await handleGaitAction(action, gaitId);
      } else {
        console.error('Missing action or gaitId:', { action, gaitId });
      }
    });
  });
}

function updateGaitSelector() {
  // Update any gait selector dropdowns in the UI
  const gaitSelect = document.getElementById('gaitMode');
  if (gaitSelect) {
    gaitSelect.innerHTML = state.enabledGaits.map(gaitId => {
      const gait = state.gaits[gaitId];
      return `<option value="${gaitId}" ${gaitId === state.activeGait ? 'selected' : ''}>${gait?.name || gaitId}</option>`;
    }).join('');
  }
}

async function setActiveGait(gaitId) {
  if (!state.enabledGaits.includes(gaitId)) {
    logEvent('WARN', `Cannot select disabled gait: ${gaitId}`);
    return;
  }

  try {
    const response = await fetch('/api/gait', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: gaitId })
    });

    if (response.ok) {
      state.activeGait = gaitId;
      renderGaitsTable();
      updateGaitSelector();
      logEvent('INFO', `Active gait changed to: ${state.gaits[gaitId]?.name || gaitId}`);
    } else {
      const err = await response.json();
      logEvent('ERROR', `Failed to set gait: ${err.error || 'Unknown error'}`);
    }
  } catch (e) {
    // Offline mode - just update locally
    state.activeGait = gaitId;
    renderGaitsTable();
    updateGaitSelector();
    logEvent('INFO', `Active gait changed to: ${state.gaits[gaitId]?.name || gaitId} (offline)`);
  }
}

async function handleGaitAction(action, gaitId) {
  try {
    const response = await fetch('/api/gaits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, gait: gaitId })
    });

    if (response.ok) {
      // Refresh the gaits list
      await loadGaits();
      logEvent('INFO', `Gait "${state.gaits[gaitId]?.name || gaitId}" ${action}d`);
    } else {
      const err = await response.json();
      logEvent('ERROR', `Failed to ${action} gait: ${err.error || 'Unknown error'}`);
    }
  } catch (e) {
    // Offline mode - update locally
    if (action === 'enable') {
      if (!state.enabledGaits.includes(gaitId)) {
        state.enabledGaits.push(gaitId);
      }
      if (state.gaits[gaitId]) state.gaits[gaitId].enabled = true;
    } else if (action === 'disable') {
      // Prevent disabling last enabled gait
      if (state.enabledGaits.length <= 1) {
        logEvent('ERROR', 'Cannot disable last enabled gait');
        return;
      }
      state.enabledGaits = state.enabledGaits.filter(g => g !== gaitId);
      if (state.gaits[gaitId]) state.gaits[gaitId].enabled = false;
      // If this was the active gait, switch to another
      if (state.activeGait === gaitId && state.enabledGaits.length > 0) {
        state.activeGait = state.enabledGaits[0];
      }
    }
    renderGaitsTable();
    updateGaitSelector();
    logEvent('INFO', `Gait "${state.gaits[gaitId]?.name || gaitId}" ${action}d (offline)`);
  }
}

// ========== Apply Config to UI ==========
function applyConfigToUI() {
  const c = state.config;

  // Geometry sliders
  setSliderValue('body_height_geo', c.body_height_geo || 50);
  setSliderValue('body_width', c.body_width || 100);
  setSliderValue('body_length', c.body_length || 150);

  // Leg geometry
  const coxa = c.leg_coxa_length || c.leg0_coxa_length || 30;
  const femur = c.leg_femur_length || c.leg0_femur_length || 50;
  const tibia = c.leg_tibia_length || c.leg0_tibia_length || 80;
  setSliderValue('leg_coxa_length', coxa);
  setSliderValue('leg_femur_length', femur);
  setSliderValue('leg_tibia_length', tibia);

  // Gait parameters
  const stepHeight = c.step_height ?? c.gait_step_height ?? 30;
  const stepLength = c.step_length ?? c.gait_step_length ?? 60;
  const cycleTime = c.cycle_time ?? c.gait_cycle_time ?? 1.2;
  setSliderValue('step_height', stepHeight);
  setSliderValue('step_length', stepLength);
  setSliderValue('cycle_time', cycleTime);

  // Body pose
  setSliderValue('body_height', c.body_height || state.telemetry.bodyHeight || 120);
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
const servoCalibration = {
  mapping: {},  // leg,joint -> channel
  offsets: {},  // leg,joint -> offset in microseconds
  directions: {},  // leg,joint -> 1 or -1
  hardware: false,
  metadata: { path: null, exists: false, size: null },
  coverage: { mapped: 0, legs_configured: 0, available_channels: [], unmapped: [] },
  lastUpdated: null
};

// Load calibration from API
async function loadCalibration() {
  try {
    const response = await fetch('/api/calibration');
    if (response.ok) {
      const data = await response.json();
      servoCalibration.mapping = data.calibration || {};
      servoCalibration.hardware = data.hardware || false;
      servoCalibration.metadata = data.metadata || servoCalibration.metadata;
      servoCalibration.coverage = data.coverage || servoCalibration.coverage;
      servoCalibration.lastUpdated = new Date();
      logEvent('INFO', `Loaded calibration: ${Object.keys(servoCalibration.mapping).length} mappings`);
      updateServoMappingTable();
      updateCalibrationStatusUI();
    }
  } catch (e) {
    logEvent('WARN', 'Could not load calibration from API, using defaults');
    updateCalibrationStatusUI(true);
  }
}

function updateServoMappingTable() {
  if (!servoMappingTable) return;

  const rows = servoMappingTable.querySelectorAll('tr');
  rows.forEach(row => {
    const leg = parseInt(row.dataset.leg);
    const joint = parseInt(row.dataset.joint);
    const key = `${leg},${joint}`;

    const channelInput = row.querySelector('.channel-input');
    const directionSelect = row.querySelector('.direction-select');
    const offsetInput = row.querySelector('.offset-input');

    if (servoCalibration.mapping[key] !== undefined) {
      channelInput.value = servoCalibration.mapping[key];
    }
    if (servoCalibration.directions[key] !== undefined) {
      directionSelect.value = servoCalibration.directions[key];
    }
    if (servoCalibration.offsets[key] !== undefined) {
      offsetInput.value = servoCalibration.offsets[key];
    }
  });
}

function formatBytes(bytes) {
  if (bytes === null || bytes === undefined) return '--';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function formatUnmapped(unmapped) {
  if (!Array.isArray(unmapped) || unmapped.length === 0) return ['All joints mapped'];
  const jointNames = ['coxa', 'femur', 'tibia'];
  return unmapped.map(u => `Leg ${u.leg} ${jointNames[u.joint] || u.joint}`);
}

function updateCalibrationStatusUI(isOffline = false) {
  const meta = servoCalibration.metadata || {};
  const coverage = servoCalibration.coverage || {};

  const pathEl = document.getElementById('calibrationPath');
  const sizeEl = document.getElementById('calibrationSize');
  const existsTag = document.getElementById('calibrationExistsTag');
  const hardwareEl = document.getElementById('calibrationHardware');
  const updatedEl = document.getElementById('calibrationUpdated');
  const mappedEl = document.getElementById('calibrationMapped');
  const legsEl = document.getElementById('calibrationLegs');
  const availableEl = document.getElementById('calibrationAvailable');
  const unmappedCountEl = document.getElementById('calibrationUnmappedCount');
  const unmappedListEl = document.getElementById('calibrationUnmappedList');

  if (pathEl) pathEl.textContent = meta.path || '--';
  if (sizeEl) sizeEl.textContent = meta.size !== undefined ? formatBytes(meta.size) : '--';

  if (existsTag) {
    const exists = Boolean(meta.exists);
    existsTag.textContent = exists ? 'On disk' : (isOffline ? 'Unknown' : 'Missing');
    existsTag.className = `tag ${exists ? 'tag-success' : isOffline ? 'tag-warning' : 'tag-danger'}`;
  }

  if (hardwareEl) hardwareEl.textContent = servoCalibration.hardware ? 'Hardware connected' : 'Mock / offline';

  if (updatedEl) {
    const ts = servoCalibration.lastUpdated;
    updatedEl.textContent = `Last checked: ${ts ? ts.toLocaleTimeString() : '--'}`;
  }

  if (mappedEl) {
    const mapped = coverage.mapped ?? 0;
    mappedEl.textContent = `${mapped} / 18`;
  }

  if (legsEl) {
    const legs = coverage.legs_configured ?? 0;
    legsEl.textContent = `Legs configured: ${legs}`;
  }

  if (availableEl) {
    const available = coverage.available_channels || [];
    availableEl.textContent = available.length ? available.join(', ') : 'None';
  }

  if (unmappedCountEl) {
    const unmappedCount = (coverage.unmapped || []).length;
    unmappedCountEl.textContent = `Unmapped joints: ${unmappedCount}`;
  }

  if (unmappedListEl) {
    unmappedListEl.innerHTML = '';
    const items = formatUnmapped(coverage.unmapped);
    items.forEach(text => {
      const span = document.createElement('span');
      span.className = 'tag tag-primary';
      span.textContent = text;
      unmappedListEl.appendChild(span);
    });
  }
}

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
        <td><input type="number" class="form-input channel-input" value="${channel}" min="0" max="31" style="width:60px"></td>
        <td>${leg} (${legNames[leg]})</td>
        <td>${jointNames[joint]}</td>
        <td><select class="form-select direction-select" style="width:100px"><option value="1">Normal</option><option value="-1">Reversed</option></select></td>
        <td><input type="number" class="form-input offset-input" value="1500" min="500" max="2500" step="10" style="width:70px"></td>
        <td>
          <button class="btn btn-secondary btn-sm test-servo-btn" title="Sweep servo">Test</button>
        </td>
      `;
      servoMappingTable.appendChild(row);

      const channelInput = row.querySelector('.channel-input');
      const directionSelect = row.querySelector('.direction-select');
      const offsetInput = row.querySelector('.offset-input');

      // Test button - sweep servo
      row.querySelector('.test-servo-btn').addEventListener('click', () => {
        testServo(leg, joint, parseInt(channelInput.value));
      });

      // Auto-save helper
      const autoSaveMapping = () => {
        saveServoMapping(leg, joint, parseInt(channelInput.value), parseInt(directionSelect.value), parseInt(offsetInput.value));
      };

      // Auto-save on any change (consistent with other sections)
      channelInput.addEventListener('change', autoSaveMapping);
      directionSelect.addEventListener('change', autoSaveMapping);
      offsetInput.addEventListener('change', autoSaveMapping);
    }
  }

  // Auto-fill Template button
  document.getElementById('btnAutoFillTemplate')?.addEventListener('click', () => {
    autoFillServoTemplate();
  });

  document.getElementById('btnRefreshCalibration')?.addEventListener('click', () => {
    refreshCalibrationStatus();
  });

  document.getElementById('btnSaveCalibration')?.addEventListener('click', () => {
    saveCalibrationToDisk();
  });

  // Highlight All button
  document.querySelector('#tab-servo-mapping .btn-warning')?.addEventListener('click', () => {
    highlightAllServos();
  });

  // Load calibration on init
  loadCalibration();
}

async function refreshCalibrationStatus() {
  try {
    const response = await fetch('/api/status');
    if (response.ok) {
      const data = await response.json();
      servoCalibration.hardware = Boolean(data.hardware);
      servoCalibration.metadata = data.metadata || servoCalibration.metadata;
      servoCalibration.coverage = data.coverage || servoCalibration.coverage;
      servoCalibration.lastUpdated = new Date();

      if (data.calibration) {
        servoCalibration.mapping = data.calibration;
        updateServoMappingTable();
      }

      updateCalibrationStatusUI();
      logEvent('INFO', 'Calibration status refreshed');
      return;
    }
  } catch (e) {
    logEvent('WARN', 'Calibration status unavailable');
  }

  updateCalibrationStatusUI(true);
}

async function saveCalibrationToDisk() {
  try {
    const response = await fetch('/api/calibration/save', { method: 'POST' });
    if (response.ok) {
      const result = await response.json();
      servoCalibration.metadata = result.metadata || servoCalibration.metadata;
      servoCalibration.coverage = result.coverage || servoCalibration.coverage;
      servoCalibration.lastUpdated = new Date();
      updateCalibrationStatusUI();
      logEvent('INFO', 'Calibration saved to disk');
    }
  } catch (e) {
    logEvent('ERROR', `Failed to save calibration: ${e.message}`);
  }
}

async function testServo(leg, joint, channel) {
  const jointNames = ['coxa', 'femur', 'tibia'];
  const jointName = jointNames[joint];
  logEvent('INFO', `Testing servo: leg ${leg} ${jointName} (channel ${channel})`);

  // Disable idle animation during test
  state.testActionActive = true;

  // Initialize highlight overrides if not present
  if (!state.highlightOverrides) {
    state.highlightOverrides = [{}, {}, {}, {}, {}, {}];
  }

  // Get mesh for color highlighting
  const legObj = legs[leg];
  let mesh = null;
  if (legObj) {
    if (jointName === 'coxa') mesh = legObj.coxaMesh;
    else if (jointName === 'femur') mesh = legObj.femurMesh;
    else if (jointName === 'tibia') mesh = legObj.tibiaMesh;
  }
  if (mesh && highlightMaterial) {
    mesh.material = highlightMaterial;
  }

  // Sweep from neutral to min to max and back
  const servoAngles = [90, 45, 135, 90];

  for (const servoAngle of servoAngles) {
    try {
      // Send to hardware API
      await fetch('/api/servo/angle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel, angle: servoAngle })
      });

      // Update 3D visualization using highlight overrides
      if (jointName === 'coxa') {
        state.highlightOverrides[leg].coxa = servoAngle;
      } else if (jointName === 'femur') {
        state.highlightOverrides[leg].femur = servoAngle - 45; // Femur neutral is ~45
      } else if (jointName === 'tibia') {
        state.highlightOverrides[leg].tibia = servoAngle - 180; // Tibia neutral is ~-90
      }

      await new Promise(r => setTimeout(r, 500));
    } catch (e) {
      logEvent('ERROR', `Failed to set servo angle: ${e.message}`);
    }
  }

  // Restore original material
  if (mesh && legMaterial) {
    mesh.material = legMaterial;
  }

  // Clear highlight overrides
  state.highlightOverrides = null;
  state.testActionActive = false;
  logEvent('INFO', 'Servo test complete');
}

async function saveServoMapping(leg, joint, channel, direction, offset) {
  const key = `${leg},${joint}`;
  servoCalibration.mapping[key] = channel;
  servoCalibration.directions[key] = direction;
  servoCalibration.offsets[key] = offset;

  try {
    const response = await fetch('/api/mapping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leg, joint, channel })
    });
    const result = await response.json();
    if (result.success) {
      logEvent('INFO', `Saved mapping: leg ${leg} joint ${joint} → channel ${channel}`);

      if (result.coverage) {
        servoCalibration.coverage = result.coverage;
        servoCalibration.lastUpdated = new Date();
        updateCalibrationStatusUI();
      }

      // Also save offset and direction to config
      const configUpdate = {};
      configUpdate[`servo_${leg}_${joint}_direction`] = direction;
      configUpdate[`servo_${leg}_${joint}_offset`] = offset;
      saveConfig(configUpdate);
    } else {
      logEvent('ERROR', `Failed to save mapping: ${result.error}`);
    }
  } catch (e) {
    logEvent('ERROR', `API error: ${e.message}`);
  }
}

function autoFillServoTemplate() {
  // Standard hexapod template: sequential channels
  const rows = servoMappingTable.querySelectorAll('tr');
  rows.forEach((row, index) => {
    const channelInput = row.querySelector('.channel-input');
    channelInput.value = index;
    servoCalibration.mapping[`${row.dataset.leg},${row.dataset.joint}`] = index;
  });
  logEvent('INFO', 'Auto-filled servo template (channels 0-17)');
}

async function highlightAllServos() {
  logEvent('INFO', 'Highlighting all servos - moving each briefly');
  const rows = servoMappingTable.querySelectorAll('tr');

  // Disable idle animation during test
  state.testActionActive = true;

  // Initialize highlight overrides array (6 legs)
  state.highlightOverrides = [{}, {}, {}, {}, {}, {}];

  for (const row of rows) {
    const channel = parseInt(row.querySelector('.channel-input').value);
    const leg = parseInt(row.dataset.leg);
    const joint = parseInt(row.dataset.joint);
    const jointNames = ['coxa', 'femur', 'tibia'];
    const jointName = jointNames[joint];

    row.style.background = 'var(--accent)';
    row.style.transition = 'background 0.3s';

    // Get the mesh for this joint and highlight it
    const legObj = legs[leg];
    let mesh = null;
    if (legObj) {
      if (jointName === 'coxa') mesh = legObj.coxaMesh;
      else if (jointName === 'femur') mesh = legObj.femurMesh;
      else if (jointName === 'tibia') mesh = legObj.tibiaMesh;
    }
    if (mesh && highlightMaterial) {
      mesh.material = highlightMaterial;
    }

    // Set highlight override for 3D visualization
    // Use angles that create visible movement from neutral position
    if (jointName === 'coxa') {
      state.highlightOverrides[leg].coxa = 120;  // Rotate coxa outward
    } else if (jointName === 'femur') {
      state.highlightOverrides[leg].femur = 25;  // Lift femur (more horizontal)
    } else if (jointName === 'tibia') {
      state.highlightOverrides[leg].tibia = -60;  // Bend tibia more
    }

    try {
      await fetch('/api/servo/angle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel, angle: 100 })
      });
      await new Promise(r => setTimeout(r, 200));
      await fetch('/api/servo/angle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel, angle: 90 })
      });
    } catch (e) {
      // Continue with next servo
    }

    // Clear this joint's highlight override
    delete state.highlightOverrides[leg][jointName];

    // Restore original material
    if (mesh && legMaterial) {
      mesh.material = legMaterial;
    }

    setTimeout(() => {
      row.style.background = '';
    }, 300);

    await new Promise(r => setTimeout(r, 100));
  }

  // Clear all highlight overrides
  state.highlightOverrides = null;
  state.testActionActive = false;
  logEvent('INFO', 'Highlight complete');
}

// ========== Servo Limits Diagram ==========
const servoLimitsDefaults = {
  coxa: { min: -60, max: 60, neutral: 0 },
  femur: { min: -30, max: 90, neutral: 45 },
  tibia: { min: -120, max: 0, neutral: -90 }
};

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
  const panel = document.getElementById('servoLimitsPanel');
  if (!panel) return;

  const joints = ['coxa', 'femur', 'tibia'];
  const sliderGroups = panel.querySelectorAll('.form-row > div');

  sliderGroups.forEach((group, jointIndex) => {
    if (jointIndex >= joints.length) return;
    const joint = joints[jointIndex];
    const sliders = group.querySelectorAll('input[type="range"]');

    // Min, Max, Neutral sliders in order
    if (sliders[0]) {
      const minKey = `leg${legIndex}_${joint}_min`;
      sliders[0].value = state.config[minKey] ?? servoLimitsDefaults[joint].min;
      updateSliderValue(sliders[0]);
    }
    if (sliders[1]) {
      const maxKey = `leg${legIndex}_${joint}_max`;
      sliders[1].value = state.config[maxKey] ?? servoLimitsDefaults[joint].max;
      updateSliderValue(sliders[1]);
    }
    if (sliders[2]) {
      const neutralKey = `leg${legIndex}_${joint}_neutral`;
      sliders[2].value = state.config[neutralKey] ?? servoLimitsDefaults[joint].neutral;
      updateSliderValue(sliders[2]);
    }
  });
}

function updateSliderValue(slider) {
  const valueEl = slider.parentElement?.querySelector('.slider-value');
  if (valueEl) {
    valueEl.textContent = `${slider.value}°`;
  }
}

// Setup slider value display updates
document.querySelectorAll('#servoLimitsPanel input[type="range"]').forEach(slider => {
  slider.addEventListener('input', () => {
    updateSliderValue(slider);
  });

  slider.addEventListener('change', () => {
    if (state.selectedLeg === null) return;
    saveCurrentLegLimits();
  });
});

function saveCurrentLegLimits() {
  const legIndex = state.selectedLeg;
  if (legIndex === null) return;

  const panel = document.getElementById('servoLimitsPanel');
  const joints = ['coxa', 'femur', 'tibia'];
  const sliderGroups = panel.querySelectorAll('.form-row > div');
  const updates = {};

  sliderGroups.forEach((group, jointIndex) => {
    if (jointIndex >= joints.length) return;
    const joint = joints[jointIndex];
    const sliders = group.querySelectorAll('input[type="range"]');

    if (sliders[0]) updates[`leg${legIndex}_${joint}_min`] = parseInt(sliders[0].value);
    if (sliders[1]) updates[`leg${legIndex}_${joint}_max`] = parseInt(sliders[1].value);
    if (sliders[2]) updates[`leg${legIndex}_${joint}_neutral`] = parseInt(sliders[2].value);
  });

  saveConfig(updates);
  logEvent('INFO', `Saved limits for leg ${legIndex}`);
}

// Test Sweep button - searches for button within the panel
async function runTestSweep() {
  if (state.selectedLeg === null) {
    logEvent('WARN', 'No leg selected');
    return;
  }

  const legIndex = state.selectedLeg;
  logEvent('INFO', `Testing sweep for leg ${legIndex}`);

  // Disable idle animation during test
  state.testActionActive = true;

  // Initialize highlight overrides for 3D visualization
  if (!state.highlightOverrides) {
    state.highlightOverrides = [{}, {}, {}, {}, {}, {}];
  }

  // Helper to update 3D and optionally send to hardware
  async function setJointAngle(joint, jointIndex, angle) {
    // Update 3D visualization using highlight overrides
    if (joint === 'coxa') {
      state.highlightOverrides[legIndex].coxa = angle;
    } else if (joint === 'femur') {
      state.highlightOverrides[legIndex].femur = angle - 45; // Adjust for default offset
    } else if (joint === 'tibia') {
      state.highlightOverrides[legIndex].tibia = angle - 180;
    }

    // Send to hardware
    const key = `${legIndex},${jointIndex}`;
    const channel = servoCalibration.mapping[key];
    if (channel !== undefined) {
      try {
        await fetch('/api/servo/angle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ channel, angle })
        });
      } catch (e) {
        // Silently continue - hardware may not be connected
      }
    }
  }

  // Sweep each joint through its range
  const joints = ['coxa', 'femur', 'tibia'];
  const legObj = legs[legIndex];

  for (let jointIndex = 0; jointIndex < joints.length; jointIndex++) {
    const joint = joints[jointIndex];
    const min = state.config[`leg${legIndex}_${joint}_min`] ?? servoLimitsDefaults[joint].min;
    const max = state.config[`leg${legIndex}_${joint}_max`] ?? servoLimitsDefaults[joint].max;
    const neutral = state.config[`leg${legIndex}_${joint}_neutral`] ?? servoLimitsDefaults[joint].neutral;

    // Get mesh for color highlighting
    let mesh = null;
    if (legObj) {
      if (joint === 'coxa') mesh = legObj.coxaMesh;
      else if (joint === 'femur') mesh = legObj.femurMesh;
      else if (joint === 'tibia') mesh = legObj.tibiaMesh;
    }
    if (mesh && highlightMaterial) {
      mesh.material = highlightMaterial;
    }

    // Convert to servo angles (neutral at 90)
    const servoNeutral = 90 + neutral;
    const servoMin = 90 + min;
    const servoMax = 90 + max;

    await setJointAngle(joint, jointIndex, servoNeutral);
    await new Promise(r => setTimeout(r, 300));
    await setJointAngle(joint, jointIndex, servoMin);
    await new Promise(r => setTimeout(r, 500));
    await setJointAngle(joint, jointIndex, servoMax);
    await new Promise(r => setTimeout(r, 500));
    await setJointAngle(joint, jointIndex, servoNeutral);
    await new Promise(r => setTimeout(r, 300));

    // Restore original material after this joint's sweep
    if (mesh && legMaterial) {
      mesh.material = legMaterial;
    }
  }

  // Clear highlight overrides - legs will return to calculated positions
  state.highlightOverrides = null;
  state.testActionActive = false;
  logEvent('INFO', 'Sweep complete');
}

// Attach Test Sweep and Reset handlers using IDs
setTimeout(() => {
  document.getElementById('btnTestSweep')?.addEventListener('click', runTestSweep);
  document.getElementById('btnResetLimits')?.addEventListener('click', resetLegLimitsToDefaults);
}, 100);

// Reset to Defaults function
function resetLegLimitsToDefaults() {
  if (state.selectedLeg === null) return;

  const legIndex = state.selectedLeg;
  const panel = document.getElementById('servoLimitsPanel');
  const joints = ['coxa', 'femur', 'tibia'];
  const sliderGroups = panel.querySelectorAll('.form-row > div');

  sliderGroups.forEach((group, jointIndex) => {
    if (jointIndex >= joints.length) return;
    const joint = joints[jointIndex];
    const sliders = group.querySelectorAll('input[type="range"]');

    if (sliders[0]) {
      sliders[0].value = servoLimitsDefaults[joint].min;
      updateSliderValue(sliders[0]);
    }
    if (sliders[1]) {
      sliders[1].value = servoLimitsDefaults[joint].max;
      updateSliderValue(sliders[1]);
    }
    if (sliders[2]) {
      sliders[2].value = servoLimitsDefaults[joint].neutral;
      updateSliderValue(sliders[2]);
    }
  });

  saveCurrentLegLimits();
  logEvent('INFO', `Reset leg ${legIndex} limits to defaults`);
}

// Apply to All button in Servo Limits card header
document.querySelector('#tab-servo-limits .card-header .btn-secondary')?.addEventListener('click', () => {
  if (state.selectedLeg === null) {
    logEvent('WARN', 'Select a leg first to copy its limits');
    return;
  }

  const sourceLeg = state.selectedLeg;
  const updates = {};
  const joints = ['coxa', 'femur', 'tibia'];

  for (let leg = 0; leg < 6; leg++) {
    if (leg === sourceLeg) continue;
    joints.forEach(joint => {
      updates[`leg${leg}_${joint}_min`] = state.config[`leg${sourceLeg}_${joint}_min`] ?? servoLimitsDefaults[joint].min;
      updates[`leg${leg}_${joint}_max`] = state.config[`leg${sourceLeg}_${joint}_max`] ?? servoLimitsDefaults[joint].max;
      updates[`leg${leg}_${joint}_neutral`] = state.config[`leg${sourceLeg}_${joint}_neutral`] ?? servoLimitsDefaults[joint].neutral;
    });
  }

  saveConfig(updates);
  logEvent('INFO', `Applied leg ${sourceLeg} limits to all legs`);
});

// ========== Calibration Wizard ==========
let wizardState = {
  active: false,
  step: 0,
  currentLeg: 0,
  currentJoint: 0
};

const wizardSteps = [
  { title: 'Prepare Robot', instructions: 'Place the hexapod on a calibration stand with legs free to move. Ensure power is connected.' },
  { title: 'Set All Neutral', instructions: 'All servos will move to 90° (neutral). Verify each servo responds.' },
  { title: 'Calibrate Leg 0 (FR)', instructions: 'Adjust the coxa, femur, and tibia offsets until the leg appears straight/neutral.' },
  { title: 'Calibrate Leg 1 (MR)', instructions: 'Adjust the coxa, femur, and tibia offsets until the leg appears straight/neutral.' },
  { title: 'Calibrate Leg 2 (RR)', instructions: 'Adjust the coxa, femur, and tibia offsets until the leg appears straight/neutral.' },
  { title: 'Calibrate Leg 3 (RL)', instructions: 'Adjust the coxa, femur, and tibia offsets until the leg appears straight/neutral.' },
  { title: 'Calibrate Leg 4 (ML)', instructions: 'Adjust the coxa, femur, and tibia offsets until the leg appears straight/neutral.' },
  { title: 'Calibrate Leg 5 (FL)', instructions: 'Adjust the coxa, femur, and tibia offsets until the leg appears straight/neutral.' },
  { title: 'Save & Finish', instructions: 'Calibration complete! Save your settings to persist them.' }
];

document.querySelector('#tab-servo-wizard .btn-primary')?.addEventListener('click', () => {
  startCalibrationWizard();
});

function startCalibrationWizard() {
  wizardState.active = true;
  wizardState.step = 0;
  renderWizardStep();
  logEvent('INFO', 'Calibration wizard started');
}

function renderWizardStep() {
  const container = document.querySelector('#tab-servo-wizard .card > div');
  if (!container) return;

  const step = wizardSteps[wizardState.step];
  const isLegStep = wizardState.step >= 2 && wizardState.step <= 7;
  const legIndex = wizardState.step - 2;

  let html = `
    <div style="text-align: center; padding: 20px;">
      <div style="font-size: 14px; color: var(--text-muted); margin-bottom: 8px;">
        Step ${wizardState.step + 1} of ${wizardSteps.length}
      </div>
      <div style="width: 100%; height: 4px; background: var(--control-bg); border-radius: 2px; margin-bottom: 20px;">
        <div style="width: ${((wizardState.step + 1) / wizardSteps.length) * 100}%; height: 100%; background: var(--accent); border-radius: 2px;"></div>
      </div>
      <h3 style="margin-bottom: 8px; color: var(--accent);">${step.title}</h3>
      <p style="color: var(--text-muted); margin-bottom: 24px;">${step.instructions}</p>
  `;

  if (wizardState.step === 1) {
    // Set all neutral step
    html += `
      <button class="btn btn-warning" id="wizardNeutralBtn" style="margin-bottom: 16px;">Move All to Neutral (90°)</button>
    `;
  } else if (isLegStep) {
    // Leg calibration step - show offset sliders
    html += `
      <div style="background: var(--control-bg); padding: 16px; border-radius: 8px; max-width: 400px; margin: 0 auto 16px;">
        <div style="margin-bottom: 12px;">
          <label style="color: var(--text-muted); font-size: 12px;">Coxa Offset</label>
          <div style="display: flex; align-items: center; gap: 8px;">
            <input type="range" class="slider wizard-offset" data-joint="coxa" min="-30" max="30" value="0" style="flex: 1;">
            <span class="wizard-offset-value" data-joint="coxa">0°</span>
          </div>
        </div>
        <div style="margin-bottom: 12px;">
          <label style="color: var(--text-muted); font-size: 12px;">Femur Offset</label>
          <div style="display: flex; align-items: center; gap: 8px;">
            <input type="range" class="slider wizard-offset" data-joint="femur" min="-30" max="30" value="0" style="flex: 1;">
            <span class="wizard-offset-value" data-joint="femur">0°</span>
          </div>
        </div>
        <div>
          <label style="color: var(--text-muted); font-size: 12px;">Tibia Offset</label>
          <div style="display: flex; align-items: center; gap: 8px;">
            <input type="range" class="slider wizard-offset" data-joint="tibia" min="-30" max="30" value="0" style="flex: 1;">
            <span class="wizard-offset-value" data-joint="tibia">0°</span>
          </div>
        </div>
      </div>
      <button class="btn btn-secondary btn-sm" id="wizardTestLegBtn">Test This Leg</button>
    `;
  } else if (wizardState.step === wizardSteps.length - 1) {
    // Final step
    html += `
      <button class="btn btn-primary" id="wizardSaveBtn" style="margin-bottom: 16px;">Save Calibration</button>
    `;
  }

  html += `
      <div style="margin-top: 24px; display: flex; justify-content: center; gap: 12px;">
        ${wizardState.step > 0 ? '<button class="btn btn-secondary" id="wizardPrevBtn">Previous</button>' : ''}
        ${wizardState.step < wizardSteps.length - 1 ? '<button class="btn btn-primary" id="wizardNextBtn">Next</button>' : ''}
        <button class="btn btn-danger" id="wizardCancelBtn">Cancel</button>
      </div>
    </div>
  `;

  container.innerHTML = html;

  // Attach event handlers
  document.getElementById('wizardPrevBtn')?.addEventListener('click', () => {
    wizardState.step--;
    renderWizardStep();
  });

  document.getElementById('wizardNextBtn')?.addEventListener('click', () => {
    wizardState.step++;
    renderWizardStep();
  });

  document.getElementById('wizardCancelBtn')?.addEventListener('click', () => {
    wizardState.active = false;
    renderWizardInitial();
    logEvent('INFO', 'Calibration wizard cancelled');
  });

  document.getElementById('wizardNeutralBtn')?.addEventListener('click', async () => {
    logEvent('INFO', 'Setting all servos to neutral');
    try {
      await fetch('/api/servo/neutral', { method: 'POST' });
      logEvent('INFO', 'All servos set to neutral');
    } catch (e) {
      logEvent('ERROR', `Failed: ${e.message}`);
    }
  });

  document.getElementById('wizardTestLegBtn')?.addEventListener('click', () => {
    const leg = wizardState.step - 2;
    for (let joint = 0; joint < 3; joint++) {
      const channel = servoCalibration.mapping[`${leg},${joint}`];
      if (channel !== undefined) {
        testServo(leg, joint, channel);
      }
    }
  });

  document.getElementById('wizardSaveBtn')?.addEventListener('click', async () => {
    try {
      await fetch('/api/calibration/save', { method: 'POST' });
      logEvent('INFO', 'Calibration saved to file');
      wizardState.active = false;
      renderWizardInitial();
    } catch (e) {
      logEvent('ERROR', `Save failed: ${e.message}`);
    }
  });

  // Offset sliders for leg calibration
  document.querySelectorAll('.wizard-offset').forEach(slider => {
    const legIndex = wizardState.step - 2;
    const joint = slider.dataset.joint;
    const jointIndex = ['coxa', 'femur', 'tibia'].indexOf(joint);

    // Load existing offset
    const offsetKey = `leg${legIndex}_${joint}_offset`;
    slider.value = state.config[offsetKey] || 0;
    const valueEl = document.querySelector(`.wizard-offset-value[data-joint="${joint}"]`);
    if (valueEl) valueEl.textContent = `${slider.value}°`;

    slider.addEventListener('input', () => {
      const value = parseInt(slider.value);
      if (valueEl) valueEl.textContent = `${value}°`;

      // Apply offset to servo in real-time
      const channel = servoCalibration.mapping[`${legIndex},${jointIndex}`];
      if (channel !== undefined) {
        const angle = 90 + value;
        fetch('/api/servo/angle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ channel, angle })
        }).catch(() => {});
      }
    });

    slider.addEventListener('change', () => {
      const value = parseInt(slider.value);
      const updates = {};
      updates[`leg${legIndex}_${joint}_offset`] = value;
      saveConfig(updates);
    });
  });
}

function renderWizardInitial() {
  const container = document.querySelector('#tab-servo-wizard .card > div');
  if (!container) return;

  container.innerHTML = `
    <div style="padding: 20px; text-align: center;">
      <div style="font-size: 48px; margin-bottom: 16px;">🔧</div>
      <h3 style="margin-bottom: 8px;">Step-by-Step Calibration</h3>
      <p style="color: var(--text-muted); margin-bottom: 24px;">
        This wizard will guide you through calibrating each servo for optimal performance.
      </p>
      <div style="background: var(--control-bg); padding: 16px; border-radius: 8px; text-align: left; max-width: 500px; margin: 0 auto;">
        <ol style="color: var(--text-muted); font-size: 13px; line-height: 2; padding-left: 20px;">
          <li>Place hexapod on a calibration stand</li>
          <li>Move all joints to calibration pose (neutral angles)</li>
          <li>For each leg, align to visually "straight" position</li>
          <li>Press "Set as neutral" to compute and save offset</li>
        </ol>
      </div>
      <button class="btn btn-primary" style="margin-top: 24px;" onclick="startCalibrationWizard()">Start Calibration Wizard</button>
    </div>
  `;
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

// Walking simulation state (used in animate loop)
let walkSimulation = null;
let walkPhase = 0;

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
let bodyMaterial, legMaterial, jointMaterial, footMaterial, highlightMaterial;

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
  // Leg mesh points along +X; subtract 90° so angle=0° points forward (+Z)
  legGroup.rotation.y = ((attachPoint.angle - 90) * Math.PI) / 180;

  return {
    group: legGroup,
    coxaJoint, femurJoint, tibiaJoint, foot,
    // Store mesh references for highlighting
    coxaMesh: coxa, femurMesh: femur, tibiaMesh: tibia
  };
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
    // Subtract 90° because leg mesh points along +X, and angle=0° should point forward (+Z)
    leg.group.rotation.y = ((attachPoint.angle - 90) * Math.PI) / 180;
  });
}

const previewCanvas = document.getElementById('previewCanvas');
console.log('3D Preview: previewCanvas found:', !!previewCanvas, 'THREE loaded:', typeof THREE !== 'undefined');

if (previewCanvas && typeof THREE !== 'undefined') {
  console.log('3D Preview: Initializing...');
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0f18);

  camera = new THREE.PerspectiveCamera(45, previewCanvas.clientWidth / previewCanvas.clientHeight, 0.1, 1000);
  // Use updateCameraPosition to set initial position matching ISO preset
  updateCameraPosition();

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
  highlightMaterial = new THREE.MeshLambertMaterial({ color: 0xffaa00, emissive: 0xff6600, emissiveIntensity: 0.5 });

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

  // Calculate leg angles for natural spider-like poses
  // Uses direct mapping based on body height for predictable visual results
  function calculateLegAngles(attachHeight, legIndex, bodyYaw, legSpread) {
    const attachPoint = getLegAttachPoint(legIndex);
    const baseAngle = attachPoint.angle * Math.PI / 180;
    const spreadFactor = (legSpread || 100) / 100;

    // Coxa angle: base angle + counter-rotation for yaw + spread adjustment
    const coxaBase = 90 + (baseAngle * 180 / Math.PI);
    const coxaYawCompensation = -bodyYaw;
    const coxaSpreadAdjust = (spreadFactor - 1) * 15;
    const coxa = coxaBase + coxaYawCompensation + coxaSpreadAdjust;

    // Map body height to leg angles for natural spider pose
    const standHeight = 80 * GEOMETRY_SCALE;   // Standing body height (~26.7 units)
    const crouchHeight = 40 * GEOMETRY_SCALE;  // Crouching body height (~13.3 units)

    // Calculate normalized height (1 = standing, 0 = crouching)
    const heightRatio = Math.max(0, Math.min(1,
      (attachHeight - crouchHeight) / (standHeight - crouchHeight)
    ));

    // Femur angle (degrees below horizontal, 0=horizontal, 90=vertical down)
    // Stand: ~55° below horizontal (legs point mostly down with slight outward angle)
    // Crouch: ~35° below horizontal (legs spread more horizontally)
    const femurStand = 55 - (spreadFactor - 1) * 10;
    const femurCrouch = 35 - (spreadFactor - 1) * 5;
    const femur = femurCrouch + (femurStand - femurCrouch) * heightRatio;

    // Tibia angle (knee bend, 0=straight, negative=bent backward)
    // Stand: very mild bend (~-15°) - tibia points mostly vertical toward ground
    // Crouch: moderate bend (~-55°) - knee bends but tibia still points downward
    const tibiaStand = -15;
    const tibiaCrouch = -55;
    const tibia = tibiaCrouch + (tibiaStand - tibiaCrouch) * heightRatio;

    return { coxa, femur, tibia };
  }

  function animate() {
    requestAnimationFrame(animate);
    animationTime += 0.016; // ~60fps

    const bodyHeight = state.telemetry.bodyHeight || 80;
    const bodyRollDeg = state.telemetry.roll || 0;
    const bodyPitchDeg = state.telemetry.pitch || 0;
    const bodyYawDeg = state.telemetry.yaw || 0;
    const legSpread = state.telemetry.legSpread || 100;

    const bodyRoll = bodyRollDeg * Math.PI / 180;
    const bodyPitch = bodyPitchDeg * Math.PI / 180;
    const bodyYaw = bodyYawDeg * Math.PI / 180;

    // Idle breathing animation when not connected and no test action is active
    let idleBreath = 0;
    if (!state.connected && !state.testActionActive) {
      idleBreath = Math.sin(animationTime * 1.5) * 3;
    }

    // Update body pose
    body.position.y = bodyHeight * GEOMETRY_SCALE;
    body.rotation.x = bodyPitch;
    body.rotation.z = bodyRoll;
    body.rotation.y = bodyYaw;

    // Update each leg
    legs.forEach((leg, i) => {
      const attachPoint = getLegAttachPoint(i);

      // Base attachment position (relative to body center, in scaled units)
      const baseX = attachPoint.y * GEOMETRY_SCALE;
      const baseZ = attachPoint.x * GEOMETRY_SCALE;
      const baseY = attachPoint.z * GEOMETRY_SCALE;

      // Transform attachment point by body rotation
      // Yaw rotation (around Y axis)
      const yawCos = Math.cos(bodyYaw);
      const yawSin = Math.sin(bodyYaw);
      const afterYawX = baseX * yawCos - baseZ * yawSin;
      const afterYawZ = baseX * yawSin + baseZ * yawCos;

      // Pitch rotation (around X axis) - affects Y and Z
      const pitchCos = Math.cos(bodyPitch);
      const pitchSin = Math.sin(bodyPitch);
      const afterPitchY = baseY * pitchCos - afterYawZ * pitchSin;
      const afterPitchZ = baseY * pitchSin + afterYawZ * pitchCos;

      // Roll rotation (around Z axis) - affects X and Y
      const rollCos = Math.cos(bodyRoll);
      const rollSin = Math.sin(bodyRoll);
      const finalX = afterYawX * rollCos - afterPitchY * rollSin;
      const finalY = afterYawX * rollSin + afterPitchY * rollCos;

      // Position leg at transformed attachment point
      leg.group.position.set(finalX, bodyHeight * GEOMETRY_SCALE + finalY, afterPitchZ);

      // Calculate the effective height of this attachment point above ground
      const attachHeightAboveGround = leg.group.position.y;

      // Calculate leg angles for visualization using local IK
      // Always calculate locally - this gives accurate preview of what pose SHOULD look like
      // (Backend angles are raw servo positions, not ideal for visualization)
      let angles = calculateLegAngles(
        attachHeightAboveGround,
        i,
        bodyYawDeg,
        legSpread
      );

      // Override with highlight angles if set (used by Highlight All feature)
      if (state.highlightOverrides && state.highlightOverrides[i]) {
        const override = state.highlightOverrides[i];
        if (override.coxa !== undefined) angles.coxa = override.coxa;
        if (override.femur !== undefined) angles.femur = override.femur;
        if (override.tibia !== undefined) angles.tibia = override.tibia;
      }

      // Add idle breathing animation only when not in test mode
      if (!state.connected && !state.testActionActive) {
        angles.femur += idleBreath;
        angles.tibia -= idleBreath * 0.5;
      }

      // Lift leg during swing phase (walking simulation)
      if (walkSimulation && !state.footContacts[i]) {
        // Leg in swing - lift and tuck to clear ground
        angles.femur -= 15;  // Raise femur slightly (more horizontal)
        angles.tibia -= 20;  // Bend knee more to tuck foot
      }

      // Leg group rotation to match attachment angle (points leg outward)
      // Subtract 90° because leg mesh points along +X, and angle=0° should point forward (+Z)
      const legAngle = (attachPoint.angle - 90) * Math.PI / 180;
      leg.group.rotation.y = legAngle + bodyYaw;

      // Update joint rotations
      // Coxa: horizontal rotation relative to leg's base direction
      const coxaOffset = angles.coxa - 90 - (attachPoint.angle || 0);
      leg.coxaJoint.rotation.y = coxaOffset * Math.PI / 180;

      // Femur: rotation around Z axis (up/down movement)
      // Positive rotation tilts femur outward, negative tilts inward
      const femurRotation = (90 - angles.femur) * Math.PI / 180;
      leg.femurJoint.rotation.z = femurRotation;

      // Tibia: rotation around Z axis relative to femur
      // Negative tibia angle = knee bent backward → positive rotation
      const tibiaRotation = -angles.tibia * Math.PI / 180;
      leg.tibiaJoint.rotation.z = tibiaRotation;

      // Update foot color based on contact
      if (leg.foot.material) {
        leg.foot.material.color.set(state.footContacts[i] ? 0x51cf66 : 0xff6b6b);
      }
    });

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
        targetTheta = Math.PI / 2;  // Camera on +Z axis, looking at front of hexapod
        targetPhi = Math.PI / 3;
        break;
      case 'side':
        targetTheta = 0;  // Camera on +X axis, looking at side of hexapod
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
    case 'legSpread':
    case 'leg_spread':
      state.telemetry.legSpread = value;
      sendCommand('leg_spread', { spread: value });
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
// These buttons send commands to the backend which calculates IK
// The backend responds with calculated joint angles via WebSocket
// Frontend only displays what backend sends - no local IK calculations

function requireBackendConnection(action) {
  if (!state.connected) {
    logEvent('WARN', `${action} requires backend connection - connect to robot or simulator first`);
    return false;
  }
  return true;
}

// Apply pose preset locally (for offline preview) and via backend (when connected)
function applyPosePreset(preset) {
  const presets = {
    stand: { bodyHeight: 80, roll: 0, pitch: 0, yaw: 0, legSpread: 100 },
    crouch: { bodyHeight: 40, roll: 0, pitch: 0, yaw: 0, legSpread: 120 },
    neutral: { bodyHeight: 60, roll: 0, pitch: 0, yaw: 0, legSpread: 100 }
  };
  const pose = presets[preset];
  if (!pose) return;

  // Stop any walking simulation
  stopWalkSimulation();

  // Update local state for immediate visual feedback
  state.telemetry.bodyHeight = pose.bodyHeight;
  state.telemetry.roll = pose.roll;
  state.telemetry.pitch = pose.pitch;
  state.telemetry.yaw = pose.yaw;
  state.telemetry.legSpread = pose.legSpread;

  // Update sliders
  setSliderValue('body_height', pose.bodyHeight);
  setSliderValue('body_roll', pose.roll);
  setSliderValue('body_pitch', pose.pitch);
  setSliderValue('body_yaw', pose.yaw);
  setSliderValue('leg_spread', pose.legSpread);

  // Send to backend if connected
  if (state.connected) {
    sendCommand('pose', { preset });
  }
}

// Stop walking simulation
function stopWalkSimulation() {
  if (walkSimulation) {
    clearInterval(walkSimulation);
    walkSimulation = null;
  }
  // Reset foot contacts
  state.footContacts = [true, true, true, true, true, true];
}

// Start walking simulation (offline tripod gait)
function startWalkSimulation() {
  if (walkSimulation) return; // Already running

  walkPhase = 0;
  walkSimulation = setInterval(() => {
    walkPhase += 0.1;

    // Tripod gait: legs 0,2,4 vs 1,3,5 alternate
    const phase1 = Math.sin(walkPhase);
    const phase2 = Math.sin(walkPhase + Math.PI);

    // Update foot contacts (tripod pattern)
    state.footContacts = [
      phase1 > 0,  // leg 0
      phase2 > 0,  // leg 1
      phase1 > 0,  // leg 2
      phase2 > 0,  // leg 3
      phase1 > 0,  // leg 4
      phase2 > 0   // leg 5
    ];

    // Subtle body sway during walking
    state.telemetry.roll = Math.sin(walkPhase * 2) * 3;
    state.telemetry.pitch = Math.sin(walkPhase) * 2;
  }, 50);
}

document.getElementById('testStand')?.addEventListener('click', () => {
  console.log('Stand button clicked');
  state.testActionActive = true;
  applyPosePreset('stand');
  logEvent('INFO', 'Stand pose applied');
});

document.getElementById('testCrouch')?.addEventListener('click', () => {
  console.log('Crouch button clicked');
  state.testActionActive = true;
  applyPosePreset('crouch');
  logEvent('INFO', 'Crouch pose applied');
});

document.getElementById('testWalk')?.addEventListener('click', () => {
  console.log('Walk button clicked');
  state.testActionActive = true;

  if (state.connected) {
    // Send to backend for real gait
    sendCommand('walk', { walking: true });
    logEvent('INFO', 'Walk test started (backend gait)');
  } else {
    // Run local simulation
    startWalkSimulation();
    logEvent('INFO', 'Walk test started (offline simulation)');
  }
  console.log('Walk started, connected:', state.connected);
});

document.getElementById('testReset')?.addEventListener('click', () => {
  console.log('Reset button clicked');
  state.testActionActive = false;  // Re-enable idle animation

  // Stop walking (both local and backend)
  stopWalkSimulation();
  if (state.connected) {
    sendCommand('walk', { walking: false });
  }

  applyPosePreset('neutral');
  logEvent('INFO', 'Reset to neutral pose');
  console.log('Reset applied, bodyHeight:', state.telemetry.bodyHeight);
});

// Helper function to animate all legs to target angles
// NOTE: This is ONLY for local servo calibration testing visualization
// Actual robot poses come from backend IK calculations via WebSocket
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

// ========== Saved Poses Management ==========
async function loadPoses() {
  try {
    const response = await fetch('/api/poses');
    if (response.ok) {
      const data = await response.json();
      state.poses = data.poses || {};
      renderPosesTable();
      logEvent('INFO', `Loaded ${Object.keys(state.poses).length} poses`);
    } else {
      console.log('Failed to load poses: HTTP', response.status);
      loadDefaultPoses();
    }
  } catch (e) {
    console.log('Failed to load poses from server:', e);
    loadDefaultPoses();
  }
}

function loadDefaultPoses() {
  // Set default poses for offline mode
  state.poses = {
    'default_stance': { name: 'Default Stance', category: 'operation', height: 120, roll: 0, pitch: 0, yaw: 0, leg_spread: 100, builtin: true },
    'low_stance': { name: 'Low Stance', category: 'operation', height: 80, roll: 0, pitch: 0, yaw: 0, leg_spread: 100, builtin: false },
    'high_stance': { name: 'High Stance', category: 'operation', height: 160, roll: 0, pitch: 0, yaw: 0, leg_spread: 100, builtin: false },
    'rest_pose': { name: 'Rest Pose', category: 'rest', height: 40, roll: 0, pitch: 0, yaw: 0, leg_spread: 120, builtin: false },
    'power_off': { name: 'Power Off', category: 'rest', height: 30, roll: 0, pitch: 0, yaw: 0, leg_spread: 100, builtin: false }
  };
  renderPosesTable();
  logEvent('INFO', 'Using default poses (offline mode)');
}

function renderPosesTable() {
  const tbody = document.getElementById('posesTableBody');
  const noMsg = document.getElementById('noPosesMsg');
  const countEl = document.getElementById('poseCount');

  if (!tbody) return;

  const poseIds = Object.keys(state.poses);

  if (poseIds.length === 0) {
    tbody.innerHTML = '';
    if (noMsg) noMsg.style.display = 'block';
    if (countEl) countEl.textContent = '0 poses';
    return;
  }

  if (noMsg) noMsg.style.display = 'none';
  if (countEl) countEl.textContent = `${poseIds.length} pose${poseIds.length !== 1 ? 's' : ''}`;

  const categoryStyles = {
    'operation': 'tag-success',
    'rest': 'tag-primary',
    'debug': 'tag-warning'
  };

  tbody.innerHTML = poseIds.map(poseId => {
    const pose = state.poses[poseId];
    const categoryClass = categoryStyles[pose.category] || 'tag-secondary';
    const categoryLabel = pose.category ? pose.category.charAt(0).toUpperCase() + pose.category.slice(1) : 'Other';
    const isBuiltin = pose.builtin || false;
    const canDelete = !isBuiltin && poseIds.length > 1;

    // Ensure numeric values for display
    const height = Number(pose.height) || 0;
    const legSpread = Number(pose.leg_spread) || 100;
    const roll = Number(pose.roll) || 0;
    const pitch = Number(pose.pitch) || 0;
    const yaw = Number(pose.yaw) || 0;

    return `
      <tr class="pose-row" data-pose-id="${poseId}">
        <td>
          <strong>${escapeHtml(pose.name || poseId)}</strong>
          ${isBuiltin ? '<span class="tag tag-secondary" style="margin-left: 8px; font-size: 9px;">DEFAULT</span>' : ''}
        </td>
        <td><span class="tag ${categoryClass}">${categoryLabel}</span></td>
        <td>${height.toFixed(0)}mm</td>
        <td>${legSpread.toFixed(0)}%</td>
        <td>R: ${roll.toFixed(0)}&deg;, P: ${pitch.toFixed(0)}&deg;, Y: ${yaw.toFixed(0)}&deg;</td>
        <td>
          <button class="btn btn-secondary btn-sm pose-action-btn" data-action="preview" data-pose-id="${poseId}">Preview</button>
          <button class="btn btn-primary btn-sm pose-action-btn" data-action="apply" data-pose-id="${poseId}">Apply</button>
          <button class="btn btn-secondary btn-sm pose-action-btn" data-action="edit" data-pose-id="${poseId}">Edit</button>
          ${canDelete ? `<button class="btn btn-danger btn-sm pose-action-btn" data-action="delete" data-pose-id="${poseId}">Delete</button>` : ''}
        </td>
      </tr>
    `;
  }).join('');

  // Add event listeners to action buttons
  tbody.querySelectorAll('.pose-action-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = btn.dataset.action;
      const poseId = btn.dataset.poseId;
      handlePoseAction(action, poseId);
    });
  });
}

function handlePoseAction(action, poseId) {
  const pose = state.poses[poseId];
  if (!pose) return;

  switch (action) {
    case 'preview':
      // Animate to pose in 3D preview only (don't send to robot)
      animatePoseTransition(
        Number(pose.height) || 120,
        Number(pose.roll) || 0,
        Number(pose.pitch) || 0,
        Number(pose.yaw) || 0
      );
      logEvent('INFO', `Previewing pose: ${pose.name}`);
      break;

    case 'apply':
      // Apply pose to robot via backend
      applyPose(poseId);
      break;

    case 'edit':
      openPoseEditor(poseId);
      break;

    case 'delete':
      deletePose(poseId);
      break;
  }
}

async function applyPose(poseId) {
  const pose = state.poses[poseId];
  if (!pose) return;

  // Ensure numeric values
  const height = Number(pose.height) || 120;
  const roll = Number(pose.roll) || 0;
  const pitch = Number(pose.pitch) || 0;
  const yaw = Number(pose.yaw) || 0;
  const legSpread = Number(pose.leg_spread) || 100;

  // Update local state immediately for visual feedback
  state.telemetry.bodyHeight = height;
  state.telemetry.roll = roll;
  state.telemetry.pitch = pitch;
  state.telemetry.yaw = yaw;
  state.telemetry.legSpread = legSpread;

  // Update sliders
  setSliderValue('body_height', height);
  setSliderValue('body_roll', roll);
  setSliderValue('body_pitch', pitch);
  setSliderValue('body_yaw', yaw);
  setSliderValue('leg_spread', legSpread);

  // Send to backend
  if (state.connected) {
    sendCommand('apply_pose', { pose_id: poseId });
  } else {
    // Try API call if not using WebSocket
    try {
      await fetch('/api/poses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'apply', pose_id: poseId })
      });
    } catch (e) {
      console.log('Failed to apply pose via API');
    }
  }

  logEvent('INFO', `Applied pose: ${pose.name}`);
}

function openPoseEditor(poseId = null) {
  const editorCard = document.getElementById('poseEditorCard');
  const titleEl = document.getElementById('poseEditorTitle');
  const nameInput = document.getElementById('editPoseName');
  const categorySelect = document.getElementById('editPoseCategory');
  const heightSlider = document.getElementById('editPoseHeight');
  const legSpreadSlider = document.getElementById('editPoseLegSpread');
  const rollSlider = document.getElementById('editPoseRoll');
  const pitchSlider = document.getElementById('editPosePitch');
  const yawSlider = document.getElementById('editPoseYaw');
  const poseIdInput = document.getElementById('editPoseId');

  if (!editorCard) return;

  if (poseId && state.poses[poseId]) {
    // Editing existing pose
    const pose = state.poses[poseId];
    titleEl.textContent = 'Edit Pose';
    nameInput.value = pose.name || '';
    categorySelect.value = pose.category || 'operation';
    heightSlider.value = Number(pose.height) || 120;
    legSpreadSlider.value = Number(pose.leg_spread) || 100;
    rollSlider.value = Number(pose.roll) || 0;
    pitchSlider.value = Number(pose.pitch) || 0;
    yawSlider.value = Number(pose.yaw) || 0;
    poseIdInput.value = poseId;
  } else {
    // Creating new pose
    titleEl.textContent = 'Create New Pose';
    nameInput.value = '';
    categorySelect.value = 'operation';
    heightSlider.value = state.telemetry.bodyHeight || 120;
    legSpreadSlider.value = state.telemetry.legSpread || 100;
    rollSlider.value = state.telemetry.roll || 0;
    pitchSlider.value = state.telemetry.pitch || 0;
    yawSlider.value = state.telemetry.yaw || 0;
    poseIdInput.value = '';
  }

  // Update slider value displays
  updatePoseEditorSliderValues();

  editorCard.style.display = 'block';
  editorCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  nameInput.focus();
}

function updatePoseEditorSliderValues() {
  const heightSlider = document.getElementById('editPoseHeight');
  const legSpreadSlider = document.getElementById('editPoseLegSpread');
  const rollSlider = document.getElementById('editPoseRoll');
  const pitchSlider = document.getElementById('editPosePitch');
  const yawSlider = document.getElementById('editPoseYaw');

  if (heightSlider) {
    document.getElementById('editPoseHeightValue').textContent = heightSlider.value + ' mm';
  }
  if (legSpreadSlider) {
    document.getElementById('editPoseLegSpreadValue').textContent = legSpreadSlider.value + '%';
  }
  if (rollSlider) {
    document.getElementById('editPoseRollValue').textContent = rollSlider.value + '\u00B0';
  }
  if (pitchSlider) {
    document.getElementById('editPosePitchValue').textContent = pitchSlider.value + '\u00B0';
  }
  if (yawSlider) {
    document.getElementById('editPoseYawValue').textContent = yawSlider.value + '\u00B0';
  }
}

function closePoseEditor() {
  const editorCard = document.getElementById('poseEditorCard');
  if (editorCard) {
    editorCard.style.display = 'none';
  }
}

async function savePose() {
  const nameInput = document.getElementById('editPoseName');
  const categorySelect = document.getElementById('editPoseCategory');
  const heightSlider = document.getElementById('editPoseHeight');
  const legSpreadSlider = document.getElementById('editPoseLegSpread');
  const rollSlider = document.getElementById('editPoseRoll');
  const pitchSlider = document.getElementById('editPosePitch');
  const yawSlider = document.getElementById('editPoseYaw');
  const poseIdInput = document.getElementById('editPoseId');

  const name = nameInput.value.trim();
  if (!name) {
    logEvent('WARN', 'Pose name is required');
    nameInput.focus();
    return;
  }

  const existingPoseId = poseIdInput.value;
  const isUpdate = existingPoseId && state.poses[existingPoseId];

  const poseData = {
    name: name,
    category: categorySelect.value,
    height: parseFloat(heightSlider.value),
    roll: parseFloat(rollSlider.value),
    pitch: parseFloat(pitchSlider.value),
    yaw: parseFloat(yawSlider.value),
    leg_spread: parseFloat(legSpreadSlider.value)
  };

  try {
    const response = await fetch('/api/poses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: isUpdate ? 'update' : 'create',
        pose_id: existingPoseId || undefined,
        ...poseData
      })
    });

    if (response.ok) {
      const data = await response.json();
      state.poses = data.poses || state.poses;
      renderPosesTable();
      closePoseEditor();
      logEvent('INFO', isUpdate ? `Pose updated: ${name}` : `Pose created: ${name}`);
    } else {
      const error = await response.json();
      logEvent('ERROR', error.error || 'Failed to save pose');
    }
  } catch (e) {
    // Fallback for offline mode - update local state
    if (isUpdate) {
      state.poses[existingPoseId] = { ...state.poses[existingPoseId], ...poseData };
    } else {
      const newId = name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
      state.poses[newId] = { ...poseData, builtin: false };
    }
    renderPosesTable();
    closePoseEditor();
    logEvent('INFO', `Pose saved locally: ${name}`);
  }
}

async function deletePose(poseId) {
  const pose = state.poses[poseId];
  if (!pose) return;

  // Check if this is the last pose
  if (Object.keys(state.poses).length <= 1) {
    logEvent('WARN', 'Cannot delete the last pose');
    return;
  }

  // Check if pose is builtin
  if (pose.builtin) {
    logEvent('WARN', 'Cannot delete builtin pose');
    return;
  }

  if (!confirm(`Delete pose "${pose.name}"?`)) {
    return;
  }

  try {
    const response = await fetch('/api/poses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', pose_id: poseId })
    });

    if (response.ok) {
      const data = await response.json();
      state.poses = data.poses || state.poses;
      renderPosesTable();
      logEvent('INFO', `Pose deleted: ${pose.name}`);
    } else {
      const error = await response.json();
      logEvent('ERROR', error.error || 'Failed to delete pose');
    }
  } catch (e) {
    // Fallback for offline mode
    delete state.poses[poseId];
    renderPosesTable();
    logEvent('INFO', `Pose deleted locally: ${pose.name}`);
  }
}

async function recordCurrentPose() {
  const nameInput = document.getElementById('recordPoseName');
  const categorySelect = document.getElementById('recordPoseCategory');

  const name = nameInput.value.trim();
  if (!name) {
    logEvent('WARN', 'Pose name is required');
    nameInput.focus();
    return;
  }

  const category = categorySelect.value;

  try {
    const response = await fetch('/api/poses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'record',
        name: name,
        category: category
      })
    });

    if (response.ok) {
      const data = await response.json();
      state.poses = data.poses || state.poses;
      renderPosesTable();
      nameInput.value = '';
      logEvent('INFO', `Pose recorded: ${name}`);
    } else {
      const error = await response.json();
      logEvent('ERROR', error.error || 'Failed to record pose');
    }
  } catch (e) {
    // Fallback for offline mode - save current telemetry state
    const newId = name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    state.poses[newId] = {
      name: name,
      category: category,
      height: state.telemetry.bodyHeight,
      roll: state.telemetry.roll,
      pitch: state.telemetry.pitch,
      yaw: state.telemetry.yaw,
      leg_spread: state.telemetry.legSpread,
      builtin: false
    };
    renderPosesTable();
    nameInput.value = '';
    logEvent('INFO', `Pose recorded locally: ${name}`);
  }
}

// Pose editor slider event listeners
document.getElementById('editPoseHeight')?.addEventListener('input', updatePoseEditorSliderValues);
document.getElementById('editPoseLegSpread')?.addEventListener('input', updatePoseEditorSliderValues);
document.getElementById('editPoseRoll')?.addEventListener('input', updatePoseEditorSliderValues);
document.getElementById('editPosePitch')?.addEventListener('input', updatePoseEditorSliderValues);
document.getElementById('editPoseYaw')?.addEventListener('input', updatePoseEditorSliderValues);

// Pose editor button event listeners
document.getElementById('btnNewPose')?.addEventListener('click', () => openPoseEditor(null));
document.getElementById('btnCancelPoseEdit')?.addEventListener('click', closePoseEditor);
document.getElementById('btnSavePose')?.addEventListener('click', savePose);
document.getElementById('btnRecordPose')?.addEventListener('click', recordCurrentPose);

document.getElementById('btnPreviewPoseEdit')?.addEventListener('click', () => {
  const heightSlider = document.getElementById('editPoseHeight');
  const rollSlider = document.getElementById('editPoseRoll');
  const pitchSlider = document.getElementById('editPosePitch');
  const yawSlider = document.getElementById('editPoseYaw');

  animatePoseTransition(
    parseFloat(heightSlider.value),
    parseFloat(rollSlider.value),
    parseFloat(pitchSlider.value),
    parseFloat(yawSlider.value)
  );
  logEvent('INFO', 'Previewing pose editor values');
});

// Legacy pose recording (for backwards compatibility)
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

window.deleteLegacyPose = function(index) {
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
      loadGaits();
      loadPoses();
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
          if (data.body_roll !== undefined) state.telemetry.roll = data.body_roll;
          if (data.body_pitch !== undefined) state.telemetry.pitch = data.body_pitch;
          if (data.body_yaw !== undefined) state.telemetry.yaw = data.body_yaw;
          if (data.body_height !== undefined) state.telemetry.bodyHeight = data.body_height;
          if (data.leg_spread !== undefined) state.telemetry.legSpread = data.leg_spread;
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

          // Sync Body Posture sliders with telemetry (for pose presets)
          if (data.body_height !== undefined) setSliderValue('body_height', data.body_height);
          if (data.body_roll !== undefined) setSliderValue('body_roll', data.body_roll);
          if (data.body_pitch !== undefined) setSliderValue('body_pitch', data.body_pitch);
          if (data.body_yaw !== undefined) setSliderValue('body_yaw', data.body_yaw);
          if (data.leg_spread !== undefined) setSliderValue('leg_spread', data.leg_spread);

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
    const stepLen = c.step_length ?? c.gait_step_length ?? 60;
    const stepHeight = c.step_height ?? c.gait_step_height ?? 30;
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

      // Handle both 'change' (on blur) and 'input' (real-time) events
      const handleInputChange = () => {
        const value = parseFloat(input.value);
        if (isNaN(value)) return;

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
      };

      input.addEventListener('change', handleInputChange);
      input.addEventListener('input', handleInputChange);
    });
  });
}

function applySymmetry() {
  // Apply symmetry: left/right leg pairs mirror each other
  // Pairs: 0-5 (FR-FL), 1-4 (MR-ML), 2-3 (RR-RL)
  const pairs = [[0, 5], [1, 4], [2, 3]];
  const table = document.getElementById('legAttachTable');
  if (!table) return;

  const updates = {};

  pairs.forEach(([rightLeg, leftLeg]) => {
    const rightRow = table.querySelectorAll('tr')[rightLeg];
    const leftRow = table.querySelectorAll('tr')[leftLeg];
    if (!rightRow || !leftRow) return;

    const rightInputs = rightRow.querySelectorAll('input[type="number"]');
    const leftInputs = leftRow.querySelectorAll('input[type="number"]');

    // Mirror: X stays same, Y negates, Z stays same, angle mirrors
    if (rightInputs[0] && leftInputs[0]) {
      const xVal = parseFloat(rightInputs[0].value);
      leftInputs[0].value = xVal;
      updates[`leg_${leftLeg}_attach_x`] = xVal;
    }
    if (rightInputs[1] && leftInputs[1]) {
      const yVal = -parseFloat(rightInputs[1].value);
      leftInputs[1].value = yVal;
      updates[`leg_${leftLeg}_attach_y`] = yVal;
    }
    if (rightInputs[2] && leftInputs[2]) {
      const zVal = parseFloat(rightInputs[2].value);
      leftInputs[2].value = zVal;
      updates[`leg_${leftLeg}_attach_z`] = zVal;
    }
    if (rightInputs[3] && leftInputs[3]) {
      // Angle mirrors: 360 - angle for left side
      const rightAngle = parseFloat(rightInputs[3].value);
      const leftAngle = 360 - rightAngle;
      leftInputs[3].value = leftAngle;
      updates[`leg_${leftLeg}_attach_angle`] = leftAngle;
    }
  });

  // Save all updates to config
  if (Object.keys(updates).length > 0) {
    saveConfig(updates);
  }

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

// ========== Sensors & Cameras Section ==========

// Camera state management
const sensorState = {
  cameras: [
    { id: 'front_cam', interface: '/dev/video0', role: 'navigation', resolution: '1280x720', fps: 30, stream: '/api/stream/front', position: { x: 100, y: 0, z: 50 }, orientation: { roll: 0, pitch: -10, yaw: 0 } },
    { id: 'rear_cam', interface: '/dev/video1', role: 'rear', resolution: '640x480', fps: 15, stream: '/api/stream/rear', position: { x: -100, y: 0, z: 50 }, orientation: { roll: 0, pitch: -10, yaw: 180 } }
  ],
  selectedCamera: 'front_cam',
  imu: {
    device: 'MPU6050',
    filter: 'complementary',
    offsets: { roll: 0, pitch: 0, yaw: 0 },
    calibrated: false
  },
  footSensors: Array(6).fill(null).map((_, i) => ({
    leg: i,
    enabled: true,
    type: 'current_spike',
    threshold: 150
  }))
};

const cameraRoles = {
  'navigation': { label: 'Main Navigation', tagClass: 'tag-success' },
  'rear': { label: 'Rear View', tagClass: 'tag-primary' },
  'depth': { label: 'Depth Sensing', tagClass: 'tag-warning' },
  'aux': { label: 'Auxiliary', tagClass: 'tag-secondary' }
};

const resolutionOptions = ['320x240', '640x480', '800x600', '1280x720', '1920x1080'];
const fpsOptions = [10, 15, 24, 30, 60];
const imuDevices = ['MPU6050 (I2C)', 'BNO055 (I2C)', 'ICM20948 (SPI)', 'LSM6DS3 (I2C)'];
const imuFilters = ['Complementary Filter', 'Extended Kalman Filter', 'Madgwick Filter', 'Mahony Filter'];
const sensorTypes = ['Current Spike', 'Force Sensor', 'Switch', 'Capacitive'];

// Initialize cameras section
function initCamerasSection() {
  renderCameraTable();
  updateCameraTransformEditor();
  setupCameraEventListeners();
}

function renderCameraTable() {
  const tbody = document.querySelector('#tab-sensor-cameras .data-table tbody');
  if (!tbody) return;

  tbody.innerHTML = sensorState.cameras.map(cam => `
    <tr data-camera-id="${cam.id}" class="${cam.id === sensorState.selectedCamera ? 'selected' : ''}">
      <td><strong>${cam.id}</strong></td>
      <td>${cam.interface}</td>
      <td><span class="tag ${cameraRoles[cam.role]?.tagClass || 'tag-secondary'}">${cameraRoles[cam.role]?.label || cam.role}</span></td>
      <td>${cam.resolution}</td>
      <td>${cam.fps}</td>
      <td><code style="font-size: 11px;">${cam.stream}</code></td>
      <td>
        <button class="btn btn-secondary btn-sm camera-edit-btn" data-camera="${cam.id}">Edit</button>
        <button class="btn btn-secondary btn-sm camera-preview-btn" data-camera="${cam.id}">Preview</button>
        <button class="btn btn-danger btn-sm camera-delete-btn" data-camera="${cam.id}" ${sensorState.cameras.length <= 1 ? 'disabled' : ''}>✕</button>
      </td>
    </tr>
  `).join('');

  // Add click handlers for row selection
  tbody.querySelectorAll('tr').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      sensorState.selectedCamera = row.dataset.cameraId;
      renderCameraTable();
      updateCameraTransformEditor();
    });
  });

  // Add button handlers
  tbody.querySelectorAll('.camera-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => showCameraEditModal(btn.dataset.camera));
  });

  tbody.querySelectorAll('.camera-preview-btn').forEach(btn => {
    btn.addEventListener('click', () => showCameraPreview(btn.dataset.camera));
  });

  tbody.querySelectorAll('.camera-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => deleteCamera(btn.dataset.camera));
  });
}

function updateCameraTransformEditor() {
  const cam = sensorState.cameras.find(c => c.id === sensorState.selectedCamera);
  if (!cam) return;

  // Update title
  const title = document.querySelector('#tab-sensor-cameras .card:last-child .card-title');
  if (title) title.textContent = `Camera Transform: ${cam.id}`;

  // Update position/orientation inputs
  const transformEditor = document.querySelector('#tab-sensor-cameras .transform-editor');
  if (!transformEditor) return;

  const inputs = transformEditor.querySelectorAll('.transform-axis-input');
  if (inputs.length >= 6) {
    inputs[0].value = cam.position.x;
    inputs[1].value = cam.position.y;
    inputs[2].value = cam.position.z;
    inputs[3].value = cam.orientation.roll;
    inputs[4].value = cam.orientation.pitch;
    inputs[5].value = cam.orientation.yaw;
  }
}

function setupCameraEventListeners() {
  // Add Camera button
  const addCameraBtn = document.querySelector('#tab-sensor-cameras .card-header .btn-primary');
  if (addCameraBtn) {
    addCameraBtn.addEventListener('click', () => showCameraEditModal(null));
  }

  // Transform editor inputs
  const transformEditor = document.querySelector('#tab-sensor-cameras .transform-editor');
  if (transformEditor) {
    const inputs = transformEditor.querySelectorAll('.transform-axis-input');
    const fields = ['x', 'y', 'z', 'roll', 'pitch', 'yaw'];

    inputs.forEach((input, i) => {
      input.addEventListener('change', () => {
        const cam = sensorState.cameras.find(c => c.id === sensorState.selectedCamera);
        if (!cam) return;

        const value = parseFloat(input.value) || 0;
        if (i < 3) {
          cam.position[fields[i]] = value;
        } else {
          cam.orientation[fields[i]] = value;
        }

        saveSensorConfig();
        update3DCameraPositions();
        logEvent('INFO', `Updated ${cam.id} ${fields[i]} to ${value}`);
      });
    });
  }
}

function showCameraEditModal(cameraId) {
  const isNew = !cameraId;
  const cam = isNew ? {
    id: `camera_${Date.now()}`,
    interface: '/dev/video' + sensorState.cameras.length,
    role: 'aux',
    resolution: '640x480',
    fps: 30,
    stream: '/api/stream/new',
    position: { x: 0, y: 0, z: 50 },
    orientation: { roll: 0, pitch: 0, yaw: 0 }
  } : sensorState.cameras.find(c => c.id === cameraId);

  if (!cam) return;

  // Create modal
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-content" style="max-width: 500px;">
      <div class="modal-header">
        <h3>${isNew ? 'Add Camera' : 'Edit Camera'}</h3>
        <button class="modal-close">&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">Camera Name</label>
          <input type="text" class="form-input" id="modal-cam-id" value="${cam.id}" ${isNew ? '' : 'readonly'}>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Interface</label>
            <input type="text" class="form-input" id="modal-cam-interface" value="${cam.interface}">
          </div>
          <div class="form-group">
            <label class="form-label">Role</label>
            <select class="form-select" id="modal-cam-role">
              ${Object.entries(cameraRoles).map(([key, val]) =>
                `<option value="${key}" ${cam.role === key ? 'selected' : ''}>${val.label}</option>`
              ).join('')}
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Resolution</label>
            <select class="form-select" id="modal-cam-resolution">
              ${resolutionOptions.map(r =>
                `<option value="${r}" ${cam.resolution === r ? 'selected' : ''}>${r}</option>`
              ).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">FPS</label>
            <select class="form-select" id="modal-cam-fps">
              ${fpsOptions.map(f =>
                `<option value="${f}" ${cam.fps === f ? 'selected' : ''}>${f}</option>`
              ).join('')}
            </select>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Stream Endpoint</label>
          <input type="text" class="form-input" id="modal-cam-stream" value="${cam.stream}">
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary modal-cancel">Cancel</button>
        <button class="btn btn-primary modal-save">${isNew ? 'Add Camera' : 'Save Changes'}</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Event handlers
  modal.querySelector('.modal-close').addEventListener('click', () => modal.remove());
  modal.querySelector('.modal-cancel').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

  modal.querySelector('.modal-save').addEventListener('click', () => {
    const updatedCam = {
      id: document.getElementById('modal-cam-id').value.trim(),
      interface: document.getElementById('modal-cam-interface').value.trim(),
      role: document.getElementById('modal-cam-role').value,
      resolution: document.getElementById('modal-cam-resolution').value,
      fps: parseInt(document.getElementById('modal-cam-fps').value),
      stream: document.getElementById('modal-cam-stream').value.trim(),
      position: cam.position,
      orientation: cam.orientation
    };

    if (!updatedCam.id) {
      logEvent('ERROR', 'Camera name is required');
      return;
    }

    if (isNew) {
      sensorState.cameras.push(updatedCam);
      sensorState.selectedCamera = updatedCam.id;
      logEvent('INFO', `Added camera: ${updatedCam.id}`);
    } else {
      const index = sensorState.cameras.findIndex(c => c.id === cameraId);
      if (index >= 0) {
        sensorState.cameras[index] = updatedCam;
        logEvent('INFO', `Updated camera: ${updatedCam.id}`);
      }
    }

    saveSensorConfig();
    renderCameraTable();
    updateCameraTransformEditor();
    update3DCameraPositions();
    modal.remove();
  });
}

function showCameraPreview(cameraId) {
  const cam = sensorState.cameras.find(c => c.id === cameraId);
  if (!cam) return;

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-content" style="max-width: 800px;">
      <div class="modal-header">
        <h3>Camera Preview: ${cam.id}</h3>
        <button class="modal-close">&times;</button>
      </div>
      <div class="modal-body" style="text-align: center;">
        <div style="background: #1a1a2e; border-radius: 8px; padding: 40px; margin-bottom: 16px;">
          <div style="color: var(--text-muted); font-size: 14px; margin-bottom: 8px;">
            ${cam.resolution} @ ${cam.fps}fps
          </div>
          <div style="width: 100%; aspect-ratio: 16/9; background: linear-gradient(45deg, #0a0a15 25%, transparent 25%), linear-gradient(-45deg, #0a0a15 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #0a0a15 75%), linear-gradient(-45deg, transparent 75%, #0a0a15 75%); background-size: 20px 20px; background-position: 0 0, 0 10px, 10px -10px, -10px 0px; border-radius: 4px; display: flex; align-items: center; justify-content: center;">
            <div style="text-align: center; color: var(--text-muted);">
              <div style="font-size: 48px; margin-bottom: 8px;">📷</div>
              <div>Stream: <code>${cam.stream}</code></div>
              <div style="margin-top: 8px; font-size: 12px;">Connect to robot to view live feed</div>
            </div>
          </div>
        </div>
        <div style="display: flex; gap: 12px; justify-content: center;">
          <button class="btn btn-secondary" id="preview-snapshot">📸 Snapshot</button>
          <button class="btn btn-secondary" id="preview-fullscreen">⛶ Fullscreen</button>
          <button class="btn btn-warning" id="preview-test-pattern">Test Pattern</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  modal.querySelector('.modal-close').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

  modal.querySelector('#preview-snapshot').addEventListener('click', () => {
    logEvent('INFO', `Snapshot requested for ${cam.id}`);
  });

  modal.querySelector('#preview-test-pattern').addEventListener('click', () => {
    logEvent('INFO', `Test pattern requested for ${cam.id}`);
  });
}

function deleteCamera(cameraId) {
  if (sensorState.cameras.length <= 1) {
    logEvent('WARN', 'Cannot delete the last camera');
    return;
  }

  const index = sensorState.cameras.findIndex(c => c.id === cameraId);
  if (index >= 0) {
    sensorState.cameras.splice(index, 1);
    if (sensorState.selectedCamera === cameraId) {
      sensorState.selectedCamera = sensorState.cameras[0]?.id;
    }
    saveSensorConfig();
    renderCameraTable();
    updateCameraTransformEditor();
    update3DCameraPositions();
    logEvent('INFO', `Deleted camera: ${cameraId}`);
  }
}

// IMU Section
function initIMUSection() {
  const imuTab = document.getElementById('tab-sensor-imu');
  if (!imuTab) return;

  // Device select
  const deviceSelect = imuTab.querySelector('.form-select');
  if (deviceSelect) {
    deviceSelect.innerHTML = imuDevices.map(d =>
      `<option ${d.startsWith(sensorState.imu.device) ? 'selected' : ''}>${d}</option>`
    ).join('');
    deviceSelect.addEventListener('change', (e) => {
      sensorState.imu.device = e.target.value.split(' ')[0];
      saveSensorConfig();
      logEvent('INFO', `IMU device set to ${sensorState.imu.device}`);
    });
  }

  // Filter select
  const selects = imuTab.querySelectorAll('.form-select');
  if (selects[1]) {
    selects[1].innerHTML = imuFilters.map(f =>
      `<option ${f.toLowerCase().includes(sensorState.imu.filter) ? 'selected' : ''}>${f}</option>`
    ).join('');
    selects[1].addEventListener('change', (e) => {
      sensorState.imu.filter = e.target.value.split(' ')[0].toLowerCase();
      saveSensorConfig();
      logEvent('INFO', `IMU filter set to ${sensorState.imu.filter}`);
    });
  }

  // Mounting orientation inputs
  const orientationInputs = imuTab.querySelectorAll('.transform-axis-input');
  const orientationFields = ['roll', 'pitch', 'yaw'];
  orientationInputs.forEach((input, i) => {
    input.value = sensorState.imu.offsets[orientationFields[i]] || 0;
    input.addEventListener('change', () => {
      sensorState.imu.offsets[orientationFields[i]] = parseFloat(input.value) || 0;
      saveSensorConfig();
      logEvent('INFO', `IMU ${orientationFields[i]} offset set to ${input.value}°`);
    });
  });

  // Add calibration button after filter select
  const filterGroup = selects[1]?.closest('.form-group');
  if (filterGroup && !imuTab.querySelector('#imu-calibrate-btn')) {
    const calibrateBtn = document.createElement('button');
    calibrateBtn.id = 'imu-calibrate-btn';
    calibrateBtn.className = 'btn btn-warning btn-sm';
    calibrateBtn.style.marginLeft = '8px';
    calibrateBtn.textContent = '🎯 Calibrate IMU';
    calibrateBtn.addEventListener('click', showIMUCalibrationModal);
    filterGroup.appendChild(calibrateBtn);
  }

  // Add live IMU display
  addIMULiveDisplay(imuTab);
}

function addIMULiveDisplay(container) {
  const existingDisplay = container.querySelector('.imu-live-display');
  if (existingDisplay) return;

  const card = document.createElement('div');
  card.className = 'card';
  card.style.marginTop = '16px';
  card.innerHTML = `
    <div class="card-header">
      <span class="card-title">Live IMU Data</span>
      <span class="tag ${sensorState.imu.calibrated ? 'tag-success' : 'tag-warning'}" id="imu-status-tag">
        ${sensorState.imu.calibrated ? 'Calibrated' : 'Not Calibrated'}
      </span>
    </div>
    <div class="imu-live-display" style="padding: 16px;">
      <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; text-align: center;">
        <div class="imu-axis">
          <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">Roll</div>
          <div style="font-size: 24px; font-weight: bold; color: #ff6b6b;" id="imu-roll">0.0°</div>
          <div class="imu-bar" style="height: 4px; background: var(--control-bg); border-radius: 2px; margin-top: 8px;">
            <div id="imu-roll-bar" style="width: 50%; height: 100%; background: #ff6b6b; border-radius: 2px; transition: width 0.1s;"></div>
          </div>
        </div>
        <div class="imu-axis">
          <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">Pitch</div>
          <div style="font-size: 24px; font-weight: bold; color: #51cf66;" id="imu-pitch">0.0°</div>
          <div class="imu-bar" style="height: 4px; background: var(--control-bg); border-radius: 2px; margin-top: 8px;">
            <div id="imu-pitch-bar" style="width: 50%; height: 100%; background: #51cf66; border-radius: 2px; transition: width 0.1s;"></div>
          </div>
        </div>
        <div class="imu-axis">
          <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">Yaw</div>
          <div style="font-size: 24px; font-weight: bold; color: #339af0;" id="imu-yaw">0.0°</div>
          <div class="imu-bar" style="height: 4px; background: var(--control-bg); border-radius: 2px; margin-top: 8px;">
            <div id="imu-yaw-bar" style="width: 50%; height: 100%; background: #339af0; border-radius: 2px; transition: width 0.1s;"></div>
          </div>
        </div>
      </div>
      <div style="margin-top: 16px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; text-align: center; font-size: 12px; color: var(--text-muted);">
        <div>Accel: <span id="imu-accel">0.0, 0.0, 9.8</span> m/s²</div>
        <div>Gyro: <span id="imu-gyro">0.0, 0.0, 0.0</span> °/s</div>
        <div>Temp: <span id="imu-temp">25.0</span> °C</div>
      </div>
    </div>
  `;

  container.appendChild(card);
}

function showIMUCalibrationModal() {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-content" style="max-width: 500px;">
      <div class="modal-header">
        <h3>IMU Calibration</h3>
        <button class="modal-close">&times;</button>
      </div>
      <div class="modal-body">
        <div style="text-align: center; padding: 20px;">
          <div style="font-size: 48px; margin-bottom: 16px;">🎯</div>
          <p style="color: var(--text-muted); margin-bottom: 24px;">
            Place the hexapod on a flat, level surface. The calibration will measure the current orientation and set it as the zero reference.
          </p>
          <div id="imu-cal-status" style="background: var(--control-bg); padding: 16px; border-radius: 8px; margin-bottom: 16px;">
            <div style="font-size: 14px; margin-bottom: 8px;">Current Readings</div>
            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; font-size: 12px;">
              <div>Roll: <span id="cal-roll">0.0°</span></div>
              <div>Pitch: <span id="cal-pitch">0.0°</span></div>
              <div>Yaw: <span id="cal-yaw">0.0°</span></div>
            </div>
          </div>
          <div id="imu-cal-progress" style="display: none;">
            <div style="height: 4px; background: var(--control-bg); border-radius: 2px; margin-bottom: 8px;">
              <div id="cal-progress-bar" style="width: 0%; height: 100%; background: var(--accent); border-radius: 2px; transition: width 0.1s;"></div>
            </div>
            <div id="cal-progress-text" style="font-size: 12px; color: var(--text-muted);">Calibrating...</div>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary modal-cancel">Cancel</button>
        <button class="btn btn-primary" id="start-imu-cal">Start Calibration</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  modal.querySelector('.modal-close').addEventListener('click', () => modal.remove());
  modal.querySelector('.modal-cancel').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

  modal.querySelector('#start-imu-cal').addEventListener('click', () => {
    const progress = modal.querySelector('#imu-cal-progress');
    const progressBar = modal.querySelector('#cal-progress-bar');
    const progressText = modal.querySelector('#cal-progress-text');
    const startBtn = modal.querySelector('#start-imu-cal');

    progress.style.display = 'block';
    startBtn.disabled = true;
    startBtn.textContent = 'Calibrating...';

    // Simulate calibration process
    let percent = 0;
    const interval = setInterval(() => {
      percent += 5;
      progressBar.style.width = `${percent}%`;
      progressText.textContent = percent < 100 ? `Sampling... ${percent}%` : 'Calibration complete!';

      if (percent >= 100) {
        clearInterval(interval);
        sensorState.imu.calibrated = true;
        sensorState.imu.offsets = {
          roll: parseFloat(state.telemetry.roll) || 0,
          pitch: parseFloat(state.telemetry.pitch) || 0,
          yaw: parseFloat(state.telemetry.yaw) || 0
        };
        saveSensorConfig();

        // Update IMU offset inputs
        const imuTab = document.getElementById('tab-sensor-imu');
        const inputs = imuTab?.querySelectorAll('.transform-axis-input');
        if (inputs) {
          inputs[0].value = sensorState.imu.offsets.roll.toFixed(1);
          inputs[1].value = sensorState.imu.offsets.pitch.toFixed(1);
          inputs[2].value = sensorState.imu.offsets.yaw.toFixed(1);
        }

        // Update status tag
        const statusTag = document.getElementById('imu-status-tag');
        if (statusTag) {
          statusTag.className = 'tag tag-success';
          statusTag.textContent = 'Calibrated';
        }

        logEvent('INFO', 'IMU calibration complete');

        setTimeout(() => modal.remove(), 1000);
      }
    }, 100);
  });
}

// Foot Contact Sensors Section
function initFootSensorsSection() {
  const sensorTab = document.getElementById('tab-sensor-other');
  if (!sensorTab) return;

  const tbody = sensorTab.querySelector('.data-table tbody');
  if (!tbody) return;

  // Clear and rebuild table
  const legNames = ['Leg 0 (FR)', 'Leg 1 (MR)', 'Leg 2 (RR)', 'Leg 3 (RL)', 'Leg 4 (ML)', 'Leg 5 (FL)'];

  tbody.innerHTML = sensorState.footSensors.map((sensor, i) => `
    <tr data-leg="${i}">
      <td>${legNames[i]}</td>
      <td><input type="checkbox" class="foot-sensor-enable" ${sensor.enabled ? 'checked' : ''}></td>
      <td>
        <select class="form-select foot-sensor-type" style="width: 150px;">
          ${sensorTypes.map(t => `<option value="${t.toLowerCase().replace(' ', '_')}" ${sensor.type === t.toLowerCase().replace(' ', '_') ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
      </td>
      <td>
        <input type="number" class="form-input foot-sensor-threshold" value="${sensor.threshold}" style="width: 80px;">
        <span class="threshold-unit">${getThresholdUnit(sensor.type)}</span>
      </td>
      <td>
        <span class="foot-sensor-status tag ${state.footContacts[i] ? 'tag-success' : 'tag-secondary'}">
          ${state.footContacts[i] ? 'Contact' : 'No Contact'}
        </span>
      </td>
    </tr>
  `).join('');

  // Add event listeners
  tbody.querySelectorAll('.foot-sensor-enable').forEach((checkbox, i) => {
    checkbox.addEventListener('change', () => {
      sensorState.footSensors[i].enabled = checkbox.checked;
      saveSensorConfig();
      logEvent('INFO', `Foot sensor ${i} ${checkbox.checked ? 'enabled' : 'disabled'}`);
    });
  });

  tbody.querySelectorAll('.foot-sensor-type').forEach((select, i) => {
    select.addEventListener('change', () => {
      sensorState.footSensors[i].type = select.value;
      const unitSpan = select.closest('tr').querySelector('.threshold-unit');
      if (unitSpan) unitSpan.textContent = getThresholdUnit(select.value);
      saveSensorConfig();
      logEvent('INFO', `Foot sensor ${i} type set to ${select.value}`);
    });
  });

  tbody.querySelectorAll('.foot-sensor-threshold').forEach((input, i) => {
    input.addEventListener('change', () => {
      sensorState.footSensors[i].threshold = parseInt(input.value) || 0;
      saveSensorConfig();
      logEvent('INFO', `Foot sensor ${i} threshold set to ${input.value}`);
    });
  });

  // Add status column header if not exists
  const thead = sensorTab.querySelector('.data-table thead tr');
  if (thead && thead.children.length === 4) {
    const th = document.createElement('th');
    th.textContent = 'Status';
    thead.appendChild(th);
  }

  // Add test buttons card
  addFootSensorTestCard(sensorTab);
}

function getThresholdUnit(type) {
  switch (type) {
    case 'current_spike': return 'mA';
    case 'force_sensor': return 'g';
    case 'switch': return 'ms';
    case 'capacitive': return 'pF';
    default: return '';
  }
}

function addFootSensorTestCard(container) {
  if (container.querySelector('.foot-sensor-test-card')) return;

  const card = document.createElement('div');
  card.className = 'card foot-sensor-test-card';
  card.style.marginTop = '16px';
  card.innerHTML = `
    <div class="card-header">
      <span class="card-title">Foot Sensor Testing</span>
    </div>
    <div style="padding: 16px;">
      <div style="display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; margin-bottom: 16px;">
        ${[0, 1, 2, 3, 4, 5].map(i => `
          <div class="foot-sensor-indicator" data-leg="${i}" style="
            background: var(--control-bg);
            padding: 12px;
            border-radius: 8px;
            text-align: center;
            cursor: pointer;
            border: 2px solid transparent;
            transition: all 0.2s;
          ">
            <div style="font-size: 20px; margin-bottom: 4px;">🦶</div>
            <div style="font-size: 11px; color: var(--text-muted);">Leg ${i}</div>
            <div class="foot-contact-dot" style="
              width: 8px; height: 8px;
              border-radius: 50%;
              background: ${state.footContacts[i] ? '#51cf66' : '#666'};
              margin: 8px auto 0;
            "></div>
          </div>
        `).join('')}
      </div>
      <div style="display: flex; gap: 8px; justify-content: center;">
        <button class="btn btn-secondary" id="test-all-foot-sensors">Test All Sensors</button>
        <button class="btn btn-secondary" id="reset-foot-thresholds">Reset Thresholds</button>
        <button class="btn btn-warning" id="auto-calibrate-foot">Auto-Calibrate</button>
      </div>
    </div>
  `;

  container.appendChild(card);

  // Event handlers - test individual foot sensor with 3D visualization
  card.querySelectorAll('.foot-sensor-indicator').forEach(indicator => {
    indicator.addEventListener('click', async () => {
      const leg = parseInt(indicator.dataset.leg);
      logEvent('INFO', `Testing foot sensor ${leg}`);
      indicator.style.borderColor = 'var(--accent)';

      // Animate the leg in 3D - lift foot up then back down
      state.testActionActive = true;
      const originalAngles = { ...state.legAngles[leg] };

      // Lift leg
      state.legAngles[leg].femur = 70;
      state.legAngles[leg].tibia = -60;
      state.footContacts[leg] = false;
      await new Promise(r => setTimeout(r, 400));

      // Touch down
      state.legAngles[leg].femur = 30;
      state.legAngles[leg].tibia = -110;
      state.footContacts[leg] = true;
      await new Promise(r => setTimeout(r, 300));

      // Back to original
      state.legAngles[leg] = originalAngles;
      state.testActionActive = false;
      indicator.style.borderColor = 'transparent';
    });
  });

  card.querySelector('#test-all-foot-sensors').addEventListener('click', async () => {
    logEvent('INFO', 'Testing all foot sensors');
    state.testActionActive = true;

    // Save original angles
    const originalAngles = state.legAngles.map(a => ({ ...a }));
    const originalContacts = [...state.footContacts];

    // Test each leg sequentially with visual animation
    for (let i = 0; i < 6; i++) {
      const ind = card.querySelectorAll('.foot-sensor-indicator')[i];
      if (ind) ind.style.borderColor = 'var(--accent)';

      // Lift leg
      state.legAngles[i].femur = 70;
      state.legAngles[i].tibia = -60;
      state.footContacts[i] = false;
      await new Promise(r => setTimeout(r, 200));

      // Touch down
      state.legAngles[i].femur = 30;
      state.legAngles[i].tibia = -110;
      state.footContacts[i] = true;
      await new Promise(r => setTimeout(r, 150));

      // Reset this leg
      state.legAngles[i] = originalAngles[i];
      state.footContacts[i] = originalContacts[i];
      if (ind) ind.style.borderColor = 'transparent';
    }

    state.testActionActive = false;
    logEvent('INFO', 'All foot sensors tested');
  });

  card.querySelector('#reset-foot-thresholds').addEventListener('click', () => {
    sensorState.footSensors.forEach(s => { s.threshold = 150; });
    initFootSensorsSection();
    saveSensorConfig();
    logEvent('INFO', 'Foot sensor thresholds reset to defaults');
  });

  card.querySelector('#auto-calibrate-foot').addEventListener('click', async () => {
    logEvent('INFO', 'Auto-calibrating foot sensors - lift all legs');
    state.testActionActive = true;

    // Lift all legs to simulate no contact
    const originalAngles = state.legAngles.map(a => ({ ...a }));
    const originalContacts = [...state.footContacts];

    // Lift all legs
    for (let i = 0; i < 6; i++) {
      state.legAngles[i].femur = 80;
      state.legAngles[i].tibia = -40;
      state.footContacts[i] = false;
    }
    logEvent('INFO', 'Measuring no-contact baseline...');
    await new Promise(r => setTimeout(r, 1500));

    // Lower all legs to touch ground
    for (let i = 0; i < 6; i++) {
      state.legAngles[i].femur = 35;
      state.legAngles[i].tibia = -100;
      state.footContacts[i] = true;
    }
    logEvent('INFO', 'Measuring contact threshold...');
    await new Promise(r => setTimeout(r, 1500));

    // Restore original positions
    state.legAngles.forEach((_, i) => {
      state.legAngles[i] = originalAngles[i];
      state.footContacts[i] = originalContacts[i];
    });

    state.testActionActive = false;
    logEvent('INFO', 'Auto-calibration complete - thresholds updated');
  });
}

// Update foot sensor status display
function updateFootSensorStatus() {
  const indicators = document.querySelectorAll('.foot-sensor-indicator');
  indicators.forEach((ind, i) => {
    const dot = ind.querySelector('.foot-contact-dot');
    if (dot) {
      dot.style.background = state.footContacts[i] ? '#51cf66' : '#666';
    }
  });

  const statusTags = document.querySelectorAll('.foot-sensor-status');
  statusTags.forEach((tag, i) => {
    tag.className = `foot-sensor-status tag ${state.footContacts[i] ? 'tag-success' : 'tag-secondary'}`;
    tag.textContent = state.footContacts[i] ? 'Contact' : 'No Contact';
  });
}

// Update IMU live display
function updateIMUDisplay() {
  const roll = state.telemetry.roll || 0;
  const pitch = state.telemetry.pitch || 0;
  const yaw = state.telemetry.yaw || 0;

  const rollEl = document.getElementById('imu-roll');
  const pitchEl = document.getElementById('imu-pitch');
  const yawEl = document.getElementById('imu-yaw');

  if (rollEl) rollEl.textContent = `${roll.toFixed(1)}°`;
  if (pitchEl) pitchEl.textContent = `${pitch.toFixed(1)}°`;
  if (yawEl) yawEl.textContent = `${yaw.toFixed(1)}°`;

  // Update bars (map -45 to 45 degrees to 0-100%)
  const rollBar = document.getElementById('imu-roll-bar');
  const pitchBar = document.getElementById('imu-pitch-bar');
  const yawBar = document.getElementById('imu-yaw-bar');

  if (rollBar) rollBar.style.width = `${Math.min(100, Math.max(0, (roll + 45) / 90 * 100))}%`;
  if (pitchBar) pitchBar.style.width = `${Math.min(100, Math.max(0, (pitch + 45) / 90 * 100))}%`;
  if (yawBar) yawBar.style.width = `${Math.min(100, Math.max(0, (yaw + 180) / 360 * 100))}%`;
}

// Save sensor configuration
function saveSensorConfig() {
  const config = {
    cameras: sensorState.cameras,
    imu: sensorState.imu,
    footSensors: sensorState.footSensors
  };

  try {
    localStorage.setItem('hexapod_sensors', JSON.stringify(config));
  } catch (e) {
    console.error('Failed to save sensor config:', e);
  }

  // Also save to main config
  saveConfig({
    sensor_cameras: sensorState.cameras,
    sensor_imu: sensorState.imu,
    sensor_foot: sensorState.footSensors
  });
}

// Load sensor configuration
function loadSensorConfig() {
  try {
    const saved = localStorage.getItem('hexapod_sensors');
    if (saved) {
      const config = JSON.parse(saved);
      if (config.cameras) sensorState.cameras = config.cameras;
      if (config.imu) sensorState.imu = config.imu;
      if (config.footSensors) sensorState.footSensors = config.footSensors;
    }
  } catch (e) {
    console.error('Failed to load sensor config:', e);
  }
}

// Add cameras to 3D preview
let cameraHelpers = [];

function update3DCameraPositions() {
  if (!scene) return;

  // Remove existing camera helpers
  cameraHelpers.forEach(helper => scene.remove(helper));
  cameraHelpers = [];

  // Add camera frustum helpers for each camera
  sensorState.cameras.forEach(cam => {
    const geometry = new THREE.ConeGeometry(5, 15, 4);
    const material = new THREE.MeshBasicMaterial({
      color: cam.id === sensorState.selectedCamera ? 0x51cf66 : 0x666666,
      wireframe: true
    });
    const cone = new THREE.Mesh(geometry, material);

    // Position relative to body
    const scale = GEOMETRY_SCALE || 1/3;
    cone.position.set(
      cam.position.x * scale,
      cam.position.z * scale + 50, // Z becomes Y in 3D
      cam.position.y * scale
    );

    // Apply orientation
    cone.rotation.x = THREE.MathUtils.degToRad(90 + (cam.orientation.pitch || 0));
    cone.rotation.y = THREE.MathUtils.degToRad(cam.orientation.yaw || 0);
    cone.rotation.z = THREE.MathUtils.degToRad(cam.orientation.roll || 0);

    scene.add(cone);
    cameraHelpers.push(cone);
  });
}

// Initialize sensors section
function initSensorsSection() {
  loadSensorConfig();
  initCamerasSection();
  initIMUSection();
  initFootSensorsSection();
  update3DCameraPositions();

  // Update displays periodically
  setInterval(() => {
    updateIMUDisplay();
    updateFootSensorStatus();
  }, 100);

  logEvent('INFO', 'Sensors section initialized');
}

// Call initialization after DOM ready
setTimeout(initSensorsSection, 200);

// ========== Initialize ==========
connectWebSocket();
loadProfiles();
loadConfig();  // Load config immediately for demo mode / summary cards
loadGaits();   // Load gaits for config page table
loadPoses();   // Load poses for body posture section

// Initialize geometry section
setTimeout(initGeometrySection, 100);

// Periodic status update for non-websocket values
setInterval(updateLiveStatus, 100);

logEvent('INFO', 'Hexapod Configuration initialized');
console.log('Hexapod Configuration loaded');
