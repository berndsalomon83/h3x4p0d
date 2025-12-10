// Hexapod Configuration - JavaScript

// ========== Constants ==========
const DEFAULT_PROFILE_NAME = 'default';

// ========== State Management ==========
const state = {
  connected: false,
  currentProfile: DEFAULT_PROFILE_NAME,
  defaultProfile: DEFAULT_PROFILE_NAME,  // Which profile loads on startup
  profiles: [],  // Will be populated with profile objects
  profilesData: {
    // Profile metadata - will be loaded from backend
    [DEFAULT_PROFILE_NAME]: {
      name: DEFAULT_PROFILE_NAME,
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
    bodyHeight: 90,
    legSpread: 110,  // percentage: 100 = normal, >100 = spread out, <100 = tucked in
    speed: 0
  },
  legAngles: Array(6).fill(null).map(() => ({ coxa: 90, femur: 75, tibia: 120 })),
  footContacts: [true, false, true, true, false, true],
  selectedLeg: null,
  recordedPoses: [],
  poses: {},  // Saved poses from backend (pose_id -> pose data)
  isRecording: false,
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
  // Load from localStorage first (for quick initial render)
  const savedConfig = loadConfigFromStorage(state.currentProfile);
  if (savedConfig) {
    state.config = savedConfig;
    applyConfigToUI();
    updatePreview();
    updateSummaryCards();
  }

  // Always try to fetch from server to get new keys/defaults
  try {
    const response = await fetch('/api/config');
    if (response.ok) {
      const serverConfig = await response.json();
      console.log('[loadConfig] serverConfig camera_views:', serverConfig.camera_views);
      console.log('[loadConfig] savedConfig camera_views:', savedConfig?.camera_views);
      // Merge: server defaults first, then localStorage overrides
      // This ensures new backend keys are added while preserving user changes
      // Special handling for camera_views: prefer server if localStorage has none/empty
      const mergedConfig = savedConfig
        ? { ...serverConfig, ...savedConfig }
        : serverConfig;
      // Ensure camera_views from server is used if localStorage doesn't have valid camera data
      if (serverConfig.camera_views && (!savedConfig?.camera_views || savedConfig.camera_views.length === 0)) {
        mergedConfig.camera_views = serverConfig.camera_views;
      }
      state.config = mergedConfig;
      console.log('[loadConfig] merged config camera_views:', state.config.camera_views);
      applyConfigToUI();
      updatePreview();
      updateSummaryCards();
      saveConfigToStorage(state.currentProfile, state.config); // Update cache with merged config
      logEvent('INFO', savedConfig ? 'Configuration synced with server' : 'Configuration loaded from server');
    }
  } catch (e) {
    if (!savedConfig) {
      // Use demo config for offline mode only if no localStorage
      state.config = {
        body_radius: 80,
        body_height_geo: 30,
        body_height: 90,
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
              isDefault: name === DEFAULT_PROFILE_NAME
            };
          }
        });
        saveProfilesToStorage(); // Cache the server data
      }
    }
  } catch (e) {
    console.log('Using default profiles');
    // Set up default profiles for demo
    state.profiles = [DEFAULT_PROFILE_NAME, 'outdoor_rough', 'indoor_demo'];
    state.profilesData = {
      [DEFAULT_PROFILE_NAME]: { name: DEFAULT_PROFILE_NAME, description: 'Default configuration', lastModified: new Date().toISOString(), isDefault: true },
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
      const profileData = state.profilesData[profileName] || {};
      showProfileModal({
        mode: 'edit',
        existingName: profileName,
        existingDescription: profileData.description || ''
      });
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
      showProfileModal({
        mode: 'duplicate',
        existingName: profileName + '_copy',
        existingDescription: `Copy of ${profileName}`,
        copyFrom: profileName
      });
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
  if (state.currentProfile !== DEFAULT_PROFILE_NAME && confirm(`Delete profile "${state.currentProfile}"?`)) {
    state.profiles = state.profiles.filter(p => p !== state.currentProfile);
    state.currentProfile = DEFAULT_PROFILE_NAME;
    updateProfileSelector();
    await loadConfig();
    logEvent('WARN', `Profile deleted`);
  } else if (state.currentProfile === DEFAULT_PROFILE_NAME) {
    logEvent('WARN', 'Cannot delete the default profile');
  }
});

document.getElementById('btnExportJson')?.addEventListener('click', () => {
  const profileData = state.profilesData[state.currentProfile] || {};

  // Create a complete export package with all profile data
  const exportData = {
    // Profile identification
    profile_id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
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
        <td style="white-space: nowrap;">
          <button class="btn btn-primary btn-sm gait-test-btn"
                  data-gait="${gaitId}"
                  ${!isEnabled ? 'disabled title="Enable gait first"' : ''}
                  title="Test this gait for 3 seconds">
            Test
          </button>
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

  // Add event listeners for test buttons
  tbody.querySelectorAll('.gait-test-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      const button = e.currentTarget;
      const gaitId = button.dataset.gait;
      if (gaitId) {
        button.disabled = true;
        button.textContent = 'Testing...';
        await testGait(gaitId, 3);
        // Re-enable after test completes
        setTimeout(() => {
          button.disabled = false;
          button.textContent = 'Test';
        }, 3500);
      }
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
  setSliderValue('body_height_geo', c.body_height_geo || 30);
  setSliderValue('body_radius', c.body_radius || 80);

  // Leg geometry - prefer per-leg values (leg0_*) like app.js does
  const coxa = c.leg0_coxa_length ?? c.leg_coxa_length ?? 30;
  const femur = c.leg0_femur_length ?? c.leg_femur_length ?? 50;
  const tibia = c.leg0_tibia_length ?? c.leg_tibia_length ?? 80;
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
  setSliderValue('body_height', c.body_height || state.telemetry.bodyHeight || 90);
  setSliderValue('body_roll', c.body_roll || 0);
  setSliderValue('body_pitch', c.body_pitch || 0);
  setSliderValue('body_yaw', c.body_yaw || 0);

  // Apply all config-bound elements (sliders, selects, toggles, inputs)
  applyConfigBoundElements(c);
}

// Apply configuration to elements with data-config-key attribute
function applyConfigBoundElements(c) {
  // Config sliders
  document.querySelectorAll('.config-slider').forEach(slider => {
    const key = slider.dataset.configKey;
    if (key && c[key] !== undefined) {
      slider.value = c[key];
      const valueEl = document.getElementById(slider.id + '-value');
      if (valueEl) {
        const unit = slider.dataset.unit || '';
        valueEl.innerHTML = c[key] + unit;
      }
    }
  });

  // Config selects
  document.querySelectorAll('.config-select').forEach(select => {
    const key = select.dataset.configKey;
    if (key && c[key] !== undefined) {
      select.value = c[key];
    }
  });

  // Config toggles
  document.querySelectorAll('.config-toggle').forEach(toggle => {
    const key = toggle.dataset.configKey;
    if (key && c[key] !== undefined) {
      toggle.checked = !!c[key];
    }
  });

  // Config inputs
  document.querySelectorAll('.config-input').forEach(input => {
    const key = input.dataset.configKey;
    if (key && c[key] !== undefined) {
      input.value = c[key];
    }
  });

  // Control mode radio buttons
  if (c.control_mode) {
    const radio = document.querySelector(`input[name="controlMode"][value="${c.control_mode}"]`);
    if (radio) {
      radio.checked = true;
    }
  }

  // Reload cameras from config (unified camera system)
  if (typeof loadCameras === 'function') {
    loadCameras();
  }
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

// ========== Config-Bound Element Event Handlers ==========
// Generic handlers for elements with data-config-key attribute

// Config sliders (with data-config-key)
document.querySelectorAll('.config-slider').forEach(slider => {
  const valueEl = document.getElementById(slider.id + '-value');
  slider.addEventListener('input', () => {
    const val = parseFloat(slider.value);
    const unit = slider.dataset.unit || '';
    if (valueEl) {
      valueEl.innerHTML = val + unit;
    }
    // Debounced save
    clearTimeout(slider._saveTimeout);
    slider._saveTimeout = setTimeout(() => {
      const key = slider.dataset.configKey;
      if (key) {
        const update = {};
        update[key] = val;
        saveConfig(update);
      }
    }, 300);
  });
});

// Config selects (with data-config-key)
document.querySelectorAll('.config-select').forEach(select => {
  select.addEventListener('change', () => {
    const key = select.dataset.configKey;
    if (key) {
      const update = {};
      update[key] = select.value;
      saveConfig(update);
    }
  });
});

// Config toggles (with data-config-key)
document.querySelectorAll('.config-toggle').forEach(toggle => {
  toggle.addEventListener('change', () => {
    const key = toggle.dataset.configKey;
    if (key) {
      const update = {};
      update[key] = toggle.checked;
      saveConfig(update);
    }
  });
});

// Config inputs (with data-config-key) - debounced with validation
document.querySelectorAll('.config-input').forEach(input => {
  input.addEventListener('input', () => {
    clearTimeout(input._saveTimeout);

    // Validate the input
    const isValid = validateConfigInput(input);

    input._saveTimeout = setTimeout(() => {
      if (!isValid) return; // Don't save invalid values

      const key = input.dataset.configKey;
      if (key) {
        const update = {};
        // Try to parse as number if it looks like one
        const val = input.value;
        update[key] = isNaN(val) || val === '' ? val : parseFloat(val);
        saveConfig(update);
        // Show success feedback briefly
        showInputFeedback(input, 'success');
      }
    }, 500);
  });
});

// Validate config input and show feedback
function validateConfigInput(input) {
  const key = input.dataset.configKey;
  const val = input.value;
  let isValid = true;
  let errorMsg = '';

  // Define validation rules for specific keys
  const validationRules = {
    imu_sample_rate: { min: 10, max: 500, msg: 'Sample rate must be 10-500 Hz' },
    imu_roll_offset: { min: -180, max: 180, msg: 'Offset must be -180° to 180°' },
    imu_pitch_offset: { min: -180, max: 180, msg: 'Offset must be -180° to 180°' },
    imu_yaw_offset: { min: -180, max: 180, msg: 'Offset must be -180° to 180°' },
    foot_sensor_threshold: { min: 50, max: 500, msg: 'Threshold must be 50-500 mA' }
  };

  // Check if we have validation rules for this key
  if (validationRules[key]) {
    const rule = validationRules[key];
    const numVal = parseFloat(val);

    if (isNaN(numVal)) {
      isValid = false;
      errorMsg = 'Please enter a valid number';
    } else if (numVal < rule.min || numVal > rule.max) {
      isValid = false;
      errorMsg = rule.msg;
    }
  }

  // Also check HTML5 min/max attributes
  if (input.type === 'number') {
    const numVal = parseFloat(val);
    const min = input.hasAttribute('min') ? parseFloat(input.min) : null;
    const max = input.hasAttribute('max') ? parseFloat(input.max) : null;

    if (min !== null && numVal < min) {
      isValid = false;
      errorMsg = errorMsg || `Value must be at least ${min}`;
    }
    if (max !== null && numVal > max) {
      isValid = false;
      errorMsg = errorMsg || `Value must be at most ${max}`;
    }
  }

  // Apply visual feedback
  if (!isValid) {
    showInputFeedback(input, 'error', errorMsg);
  } else {
    clearInputFeedback(input);
  }

  return isValid;
}

// Show visual feedback on input
function showInputFeedback(input, type, message) {
  clearInputFeedback(input);

  if (type === 'error') {
    input.style.borderColor = 'var(--danger)';
    input.style.boxShadow = '0 0 0 2px rgba(239, 68, 68, 0.2)';

    // Add error message tooltip
    if (message && input.parentElement) {
      const tooltip = document.createElement('div');
      tooltip.className = 'input-error-tooltip';
      tooltip.textContent = message;
      tooltip.style.cssText = `
        position: absolute;
        background: var(--danger);
        color: white;
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 11px;
        white-space: nowrap;
        z-index: 1000;
        margin-top: 2px;
      `;
      input.parentElement.style.position = 'relative';
      input.parentElement.appendChild(tooltip);
    }
  } else if (type === 'success') {
    input.style.borderColor = 'var(--success)';
    input.style.boxShadow = '0 0 0 2px rgba(34, 197, 94, 0.2)';
    // Clear success state after brief delay
    setTimeout(() => clearInputFeedback(input), 1500);
  }
}

// Clear visual feedback from input
function clearInputFeedback(input) {
  input.style.borderColor = '';
  input.style.boxShadow = '';
  const tooltip = input.parentElement?.querySelector('.input-error-tooltip');
  if (tooltip) tooltip.remove();
}

// Control mode radio buttons
document.querySelectorAll('input[name="controlMode"]').forEach(radio => {
  radio.addEventListener('change', () => {
    if (radio.checked) {
      saveConfig({ control_mode: radio.value });
    }
  });
});

// ========== System Section Handlers ==========
// Update current time display
function updateSystemTime() {
  const timeEl = document.getElementById('sys-current-time');
  if (timeEl) {
    const now = new Date();
    timeEl.value = now.toISOString().replace('T', ' ').substring(0, 19);
  }
}
setInterval(updateSystemTime, 1000);
updateSystemTime();

// Detect IP address from window location
const ipEl = document.getElementById('sys-ip-address');
if (ipEl) {
  const host = window.location.hostname;
  ipEl.value = host === 'localhost' || host === '127.0.0.1' ? 'localhost' : host;
}

// Show/hide API token
document.getElementById('sys-show-token')?.addEventListener('click', function() {
  const tokenInput = document.getElementById('sys-api-token');
  if (tokenInput) {
    if (tokenInput.type === 'password') {
      tokenInput.type = 'text';
      this.textContent = 'Hide';
    } else {
      tokenInput.type = 'password';
      this.textContent = 'Show';
    }
  }
});

// Regenerate token
document.getElementById('sys-regenerate-token')?.addEventListener('click', async function() {
  const token = 'hex_' + Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map(b => b.toString(16).padStart(2, '0')).join('');
  const tokenInput = document.getElementById('sys-api-token');
  if (tokenInput) {
    tokenInput.value = token;
    tokenInput.type = 'text';
    const showBtn = document.getElementById('sys-show-token');
    if (showBtn) showBtn.textContent = 'Hide';
    await saveConfig({ system_api_token: token });
  }
});

// Export configuration
document.getElementById('sys-export-config')?.addEventListener('click', () => {
  const config = state.config;
  const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `hexapod-config-${state.currentProfile || DEFAULT_PROFILE_NAME}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

// Import configuration
document.getElementById('sys-import-config')?.addEventListener('click', () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (file) {
      try {
        const text = await file.text();
        const imported = JSON.parse(text);
        if (confirm('This will replace the current configuration. Continue?')) {
          await saveConfig(imported);
          await loadConfig();
          alert('Configuration imported successfully.');
        }
      } catch (err) {
        alert('Error importing configuration: ' + err.message);
      }
    }
  };
  input.click();
});

// Reset to defaults
document.getElementById('sys-reset-defaults')?.addEventListener('click', async () => {
  if (confirm('This will reset ALL configuration to factory defaults. This cannot be undone. Continue?')) {
    try {
      const response = await fetch('/api/config/reset', { method: 'POST' });
      if (response.ok) {
        await loadConfig();
        alert('Configuration reset to defaults.');
      } else {
        alert('Error resetting configuration.');
      }
    } catch (err) {
      alert('Error: ' + err.message);
    }
  }
});

// Load system info
async function loadSystemInfo() {
  try {
    const response = await fetch('/api/system/info');
    if (response.ok) {
      const info = await response.json();
      const setEl = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
      };
      setEl('sys-version', info.version || '1.0.0');
      setEl('sys-schema', info.schema || 'v1');
      setEl('sys-hw-mode', info.hardware_mode || 'Mock');
      setEl('sys-python', info.python_version || 'Unknown');
      setEl('sys-uptime', info.uptime || '-');
    }
  } catch (err) {
    console.warn('Failed to load system info:', err);
  }
}
loadSystemInfo();
// Refresh system info periodically
setInterval(loadSystemInfo, 30000);

// ========== Gait Test Button ==========
let gaitTestInProgress = false;

async function testGait(gaitMode, duration = 3) {
  // Prevent overlapping gait tests
  if (gaitTestInProgress) {
    logEvent('WARN', 'Gait test already in progress');
    return false;
  }

  gaitTestInProgress = true;

  // Start walking with the specified gait for a short duration
  try {
    // Check if WebSocket is connected
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      logEvent('WARN', 'Gait test requires backend connection - connect to robot or simulator first');
      gaitTestInProgress = false;
      return false;
    }

    logEvent('INFO', `Testing ${gaitMode} gait for ${duration} seconds...`);

    // Set the gait mode via WebSocket
    sendCommand('set_gait', { mode: gaitMode });

    // Small delay to ensure gait mode is set before starting
    await new Promise(resolve => setTimeout(resolve, 100));

    // Send walk and move commands together (like main UI does)
    sendCommand('walk', { walking: true });
    sendCommand('move', { speed: 0.5, heading: 0, turn: 0, walking: true });

    // Keep sending move commands periodically to maintain movement
    const moveInterval = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        sendCommand('move', { speed: 0.5, heading: 0, turn: 0, walking: true });
      }
    }, 100);

    // Stop after duration seconds
    setTimeout(() => {
      clearInterval(moveInterval);
      // Stop movement - send both walk and move commands
      sendCommand('walk', { walking: false });
      sendCommand('move', { speed: 0, heading: 0, turn: 0, walking: false });

      gaitTestInProgress = false;
      logEvent('INFO', `Gait test complete`);
    }, duration * 1000);

    return true;
  } catch (err) {
    gaitTestInProgress = false;
    console.error('Error testing gait:', err);
    logEvent('ERROR', `Gait test failed: ${err.message}`);
    return false;
  }
}

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
  document.getElementById('btnHighlightAll')?.addEventListener('click', () => {
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
  // Validate channel range (PCA9685 supports 0-15 per board, max 2 boards = 0-31)
  if (isNaN(channel) || channel < 0 || channel > 31) {
    logEvent('ERROR', `Invalid servo channel ${channel}. Must be between 0 and 31.`);
    return;
  }

  // Validate offset range (typical servo pulse width range)
  if (isNaN(offset) || offset < 500 || offset > 2500) {
    logEvent('ERROR', `Invalid servo offset ${offset}. Must be between 500 and 2500.`);
    return;
  }

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
document.getElementById('btnApplyLimitsToAll')?.addEventListener('click', () => {
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

// Handler for "Start Calibration Wizard" button in the wizard tab
document.getElementById('startCalibrationWizardBtn')?.addEventListener('click', () => {
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
  body_radius: 80,  // Octagonal body radius
  body_height_geo: 30,  // Thinner body
  body_origin: 'center',
  leg_coxa_length: 40,
  leg_femur_length: 80,
  leg_tibia_length: 100,
  coxa_axis: 'z',
  femur_axis: 'y',
  tibia_axis: 'y',
  // Spider-like leg arrangement: 6 legs evenly distributed around body
  // x = forward/backward on body (+ = front), y = left/right on body (+ = right)
  // In THREE.js: posX = y (left/right), posZ = x (forward/backward)
  // angle = direction leg points (0° = forward, 90° = right, etc.)
  leg_attach_points: [
    { leg: 0, name: 'FR', x: 55, y: 65, z: 0, angle: 30 },    // Front right - forward, slight right
    { leg: 1, name: 'MR', x: 0, y: 80, z: 0, angle: 50 },     // Middle right - forward, angled right
    { leg: 2, name: 'RR', x: -55, y: 65, z: 0, angle: 70 },   // Rear right - forward, angled right
    { leg: 3, name: 'RL', x: -55, y: -65, z: 0, angle: 290 }, // Rear left - forward, angled left
    { leg: 4, name: 'ML', x: 0, y: -80, z: 0, angle: 310 },   // Middle left - forward, angled left
    { leg: 5, name: 'FL', x: 55, y: -65, z: 0, angle: 330 }   // Front left - forward, slight left
  ],
  frames: [
    { name: 'world', parent: null, position: [0, 0, 0], orientation: [0, 0, 0], fixed: true },
    { name: 'body', parent: 'world', position: [0, 0, 90], orientation: [0, 0, 0], fixed: false },
    { name: 'camera_front', parent: 'body', position: [100, 0, 50], orientation: [0, -10, 0], fixed: false },
    { name: 'camera_rear', parent: 'body', position: [-100, 0, 50], orientation: [0, -10, 180], fixed: false },
    { name: 'imu', parent: 'body', position: [0, 0, 10], orientation: [0, 0, 0], fixed: false }
  ]
};

// ========== 3D Preview ==========
let scene, camera, renderer, body, legs = [];
let hexapodModel;
let groundContactIndicators = [];
let cameraRadius = 200;  // Adjusted for scaled hexapod
let cameraTheta = Math.PI / 4;
let cameraPhi = Math.PI / 3;  // Slightly higher angle for better view

// Walking simulation state (used in animate loop)
let walkSimulation = null;
let walkPhase = 0;

// Global camera position update function
function updateCameraPosition() {
  if (!camera) return;
  camera.position.x = cameraRadius * Math.sin(cameraPhi) * Math.cos(cameraTheta);
  camera.position.y = cameraRadius * Math.cos(cameraPhi);
  camera.position.z = cameraRadius * Math.sin(cameraPhi) * Math.sin(cameraTheta);
  camera.lookAt(0, 0, 0);
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

// Scale factor to fit preview panel (0.5 = half size for better fit)
const GEOMETRY_SCALE = 0.5;
const GROUND_Y = -10 * GEOMETRY_SCALE;

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

function rebuildHexapodPreview() {
  if (!scene || !bodyMaterial) return;

  if (hexapodModel) {
    hexapodModel.dispose();
  }

  const geometry = {
    body_radius: getGeometryValue('body_radius') * GEOMETRY_SCALE,
    body_height_geo: getGeometryValue('body_height_geo') * GEOMETRY_SCALE,
    leg_coxa_length: getGeometryValue('leg_coxa_length') * GEOMETRY_SCALE,
    leg_femur_length: getGeometryValue('leg_femur_length') * GEOMETRY_SCALE,
    leg_tibia_length: getGeometryValue('leg_tibia_length') * GEOMETRY_SCALE,
    leg_attach_points: defaultGeometry.leg_attach_points.map((_, idx) => {
      const attach = getLegAttachPoint(idx);
      return {
        x: attach.x * GEOMETRY_SCALE,
        y: attach.y * GEOMETRY_SCALE,
        z: attach.z * GEOMETRY_SCALE,
        angle: attach.angle
      };
    })
  };

  const scaledBodyHeight = (state.telemetry.bodyHeight || 90) * GEOMETRY_SCALE;  // Match app.js default

  hexapodModel = Hexapod3D.buildHexapod({
    THREE,
    scene,
    geometry,
    bodyHeight: scaledBodyHeight,
    groundY: GROUND_Y,
    materials: {
      bodyMaterial,
      legMaterial,
      jointMaterial,
      footMaterial
    },
    defaultPose: Hexapod3D.computeGroundingAngles(scaledBodyHeight, geometry, GROUND_Y)
  });

  body = hexapodModel.body;
  legs = hexapodModel.legs;
  groundContactIndicators = hexapodModel.contactIndicators;
}

// Rebuild body mesh with current geometry
function rebuildBodyMesh() {
  rebuildHexapodPreview();
}

// Rebuild all legs with current geometry
function rebuildLegs() {
  rebuildHexapodPreview();
}

function updateLegPositions() {
  rebuildHexapodPreview();
}

const previewCanvas = document.getElementById('previewCanvas');

if (previewCanvas && typeof THREE !== 'undefined') {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a2e);
  scene.fog = new THREE.Fog(0x1a1a2e, 300, 900);

  const initialAspect = previewCanvas.clientHeight > 0
    ? previewCanvas.clientWidth / previewCanvas.clientHeight
    : 16 / 9;
  camera = new THREE.PerspectiveCamera(45, initialAspect, 0.1, 1000);
  // Use updateCameraPosition to set initial position matching ISO preset
  updateCameraPosition();

  renderer = new THREE.WebGLRenderer({ canvas: previewCanvas, antialias: true });
  renderer.shadowMap.enabled = true;
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setSize(previewCanvas.clientWidth, previewCanvas.clientHeight);

  // Lights
  const ambientLight = new THREE.AmbientLight(0xaaaaaa, 0.6);
  scene.add(ambientLight);
  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
  directionalLight.position.set(200, 200, 200);
  directionalLight.castShadow = true;
  directionalLight.shadow.mapSize.width = 2048;
  directionalLight.shadow.mapSize.height = 2048;
  directionalLight.shadow.camera.far = 500;
  directionalLight.shadow.camera.left = -200;
  directionalLight.shadow.camera.right = 200;
  directionalLight.shadow.camera.top = 200;
  directionalLight.shadow.camera.bottom = -200;
  scene.add(directionalLight);

  // Ground plane - black floor for config view
  const groundGeom = new THREE.PlaneGeometry(800, 600);
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
  const ground = new THREE.Mesh(groundGeom, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = GROUND_Y;
  ground.receiveShadow = true;
  scene.add(ground);

  // Grid lines visible on black floor
  const gridHelper = new THREE.GridHelper(200, 20, 0x555555, 0x333333);
  gridHelper.position.y = GROUND_Y + 0.1;  // Slightly above ground to avoid z-fighting
  gridHelper.visible = true;
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
    cameraRadius = Math.max(80, Math.min(400, cameraRadius + e.deltaY * 0.5));
    updateCameraPosition();
  });

  // Animation loop
  let animationTime = 0;

  // Get geometry for IK calculations (in scene units, already scaled)
  function getScaledGeometry() {
    return {
      leg_coxa_length: getGeometryValue('leg_coxa_length') * GEOMETRY_SCALE,
      leg_femur_length: getGeometryValue('leg_femur_length') * GEOMETRY_SCALE,
      leg_tibia_length: getGeometryValue('leg_tibia_length') * GEOMETRY_SCALE
    };
  }

  function animate() {
    requestAnimationFrame(animate);
    animationTime += 0.016; // ~60fps

    const bodyHeight = state.telemetry.bodyHeight || 90;  // Match app.js default
    const bodyRollDeg = state.telemetry.roll || 0;
    const bodyPitchDeg = state.telemetry.pitch || 0;
    const bodyYawDeg = state.telemetry.yaw || 0;

    const bodyRoll = bodyRollDeg * Math.PI / 180;
    const bodyPitch = bodyPitchDeg * Math.PI / 180;
    const bodyYaw = bodyYawDeg * Math.PI / 180;

    // Idle breathing animation when not connected and no test action is active
    let idleBreath = 0;
    if (!state.connected && !state.testActionActive) {
      idleBreath = Math.sin(animationTime * 1.5) * 3;
    }

    // Update body pose (position is set by buildHexapod, we only update y for height changes)
    body.position.y = bodyHeight * GEOMETRY_SCALE;
    body.rotation.x = bodyPitch;
    body.rotation.z = bodyRoll;
    body.rotation.y = bodyYaw;

    // Compute base leg pose angles using IK
    const scaledBodyHeight = bodyHeight * GEOMETRY_SCALE;
    const geom = getScaledGeometry();
    const poseAngles = Hexapod3D.computeGroundingAngles(scaledBodyHeight, geom, GROUND_Y);

    // Add idle breathing animation (in radians)
    let femurAngle = poseAngles.femur;
    let tibiaAngle = poseAngles.tibia;
    if (!state.connected && !state.testActionActive) {
      const breathRad = idleBreath * Math.PI / 180;
      femurAngle += breathRad;
      tibiaAngle -= breathRad * 0.5;
    }

    // Update each leg - only joint rotations, positions are set by buildHexapod
    legs.forEach((leg, i) => {
      // Update joint rotations (matches app.js and hexapod-3d.js conventions)
      // Coxa: Y-axis rotation (horizontal/yaw)
      leg.coxaJoint.rotation.y = 0;  // Keep coxa neutral for preview

      // Femur & Tibia: X-axis rotation - angles from computeGroundingAngles are in radians
      leg.femurJoint.rotation.x = femurAngle;
      leg.tibiaJoint.rotation.x = tibiaAngle;

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
    if (container.clientHeight > 0) {
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    }
  });
}

// Preview view dropdown with smooth camera transitions
function getCameraViewAngles(view) {
  switch (view) {
    case 'front':
      return { theta: Math.PI / 2, phi: Math.PI / 3 };  // Camera on +Z axis, looking at front of hexapod
    case 'side':
      return { theta: 0, phi: Math.PI / 3 };  // Camera on +X axis, looking at right side of hexapod
    case 'left':
      return { theta: Math.PI, phi: Math.PI / 3 };  // Camera on -X axis, looking at left side of hexapod
    case 'right':
      return { theta: 0, phi: Math.PI / 3 };  // Camera on +X axis, looking at right side of hexapod
    case 'top':
      return { theta: 0, phi: 0.05 };  // Nearly straight down
    default: // iso
      return { theta: Math.PI / 4, phi: Math.PI / 4 };
  }
}

document.getElementById('cameraViewSelect')?.addEventListener('change', (e) => {
  const { theta, phi } = getCameraViewAngles(e.target.value);
  animateCameraTo(theta, phi, 1500);
});

// Also keep button support for backwards compatibility
document.querySelectorAll('.preview-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.preview-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const { theta, phi } = getCameraViewAngles(btn.dataset.view);
    animateCameraTo(theta, phi, 1500);
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
  state.testActionActive = true;
  applyPosePreset('stand');
  logEvent('INFO', 'Stand pose applied');
});

document.getElementById('testCrouch')?.addEventListener('click', () => {
  state.testActionActive = true;
  applyPosePreset('crouch');
  logEvent('INFO', 'Crouch pose applied');
});

document.getElementById('testWalk')?.addEventListener('click', () => {
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
});

document.getElementById('testReset')?.addEventListener('click', () => {
  state.testActionActive = false;  // Re-enable idle animation

  // Stop walking (both local and backend)
  stopWalkSimulation();
  if (state.connected) {
    sendCommand('walk', { walking: false });
  }

  applyPosePreset('neutral');
  logEvent('INFO', 'Reset to neutral pose');
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
const estopBtn = document.getElementById('estopBtn');
estopBtn?.addEventListener('click', () => {
  sendCommand('estop', {});
  estopBtn.classList.add('active');
  logEvent('WARN', 'EMERGENCY STOP ACTIVATED');
  setTimeout(() => {
    estopBtn.classList.remove('active');
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
    'default_stance': { name: 'Default Stance', category: 'operation', height: 90, roll: 0, pitch: 0, yaw: 0, leg_spread: 110, builtin: true },
    'low_stance': { name: 'Low Stance', category: 'operation', height: 70, roll: 0, pitch: 0, yaw: 0, leg_spread: 115, builtin: false },
    'high_stance': { name: 'High Stance', category: 'operation', height: 120, roll: 0, pitch: 0, yaw: 0, leg_spread: 105, builtin: false },
    'rest_pose': { name: 'Rest Pose', category: 'rest', height: 50, roll: 0, pitch: 0, yaw: 0, leg_spread: 130, builtin: false },
    'power_off': { name: 'Power Off', category: 'rest', height: 40, roll: 0, pitch: 0, yaw: 0, leg_spread: 110, builtin: false }
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
        Number(pose.height) || 90,
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
  const height = Number(pose.height) || 90;
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
    heightSlider.value = Number(pose.height) || 90;
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
    heightSlider.value = state.telemetry.bodyHeight || 90;
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
document.querySelectorAll('#tab-log-selftest button[data-test]').forEach(btn => {
  btn.addEventListener('click', async () => {
    const testType = btn.dataset.test;
    if (!testType) return;

    btn.disabled = true;
    btn.classList.add('testing');

    // Build command parameters based on test type
    let params = {};
    if (testType === 'test_leg') {
      params = { leg: state.selectedLeg ?? 0 };
    } else if (testType === 'test_walk') {
      params = { steps: 2 };
    }

    sendCommand(testType, params);
    logEvent('INFO', `Starting test: ${testType.replace('_', ' ')}`);
    addTestResult('INFO', `Started: ${testType.replace('_', ' ')}`);

    // Re-enable button after timeout
    setTimeout(() => {
      btn.disabled = false;
      btn.classList.remove('testing');
    }, 5000);
  });
});

// Clear test results button
document.getElementById('clearTestResults')?.addEventListener('click', () => {
  const panel = document.getElementById('testResultsLog');
  if (panel) panel.innerHTML = '';
});

// Add test result to the test results panel
function addTestResult(level, message) {
  const panel = document.getElementById('testResultsLog');
  if (!panel) return;

  const time = new Date().toLocaleTimeString();
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.innerHTML = `
    <span class="log-time">${time}</span>
    <span class="log-level ${level.toLowerCase()}">${level}</span>
    <span class="log-message">${message}</span>
  `;
  panel.insertBefore(entry, panel.firstChild);

  // Keep only last 50 entries
  while (panel.children.length > 50) {
    panel.removeChild(panel.lastChild);
  }
}

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

  // Update header battery display
  const headerBattery = document.getElementById('headerBattery');
  const headerBatteryDot = document.getElementById('headerBatteryDot');
  if (headerBattery) {
    headerBattery.textContent = `Battery: ${t.battery.toFixed(1)}V`;
  }
  if (headerBatteryDot) {
    // Set dot color based on battery level (warning < 11V, critical < 10V)
    if (t.battery < 10) {
      headerBatteryDot.className = 'status-dot danger';
    } else if (t.battery < 11) {
      headerBatteryDot.className = 'status-dot warning';
    } else {
      headerBatteryDot.className = 'status-dot connected';
    }
  }

  // Update body pose sparklines and values
  updateSparkline('spark-roll', t.roll);
  updateSparkline('spark-pitch', t.pitch);
  updateSparkline('spark-yaw', t.yaw);
  updateSparklineValue('val-roll', t.roll);
  updateSparklineValue('val-pitch', t.pitch);
  updateSparklineValue('val-yaw', t.yaw);

  // Update L0 leg angle sparklines and values (selected or default to leg 0)
  const leg = state.selectedLeg ?? 0;
  const angles = state.legAngles[leg];
  if (angles) {
    updateSparkline('spark-l0-coxa', angles.coxa);
    updateSparkline('spark-l0-femur', angles.femur);
    updateSparkline('spark-l0-tibia', angles.tibia);
    updateSparklineValue('val-l0-coxa', angles.coxa);
    updateSparklineValue('val-l0-femur', angles.femur);
    updateSparklineValue('val-l0-tibia', angles.tibia);
  }

  // Update foot contact indicators
  const footIndicators = document.querySelectorAll('[data-foot]');
  footIndicators.forEach((el, i) => {
    if (i < state.footContacts.length) {
      el.style.background = state.footContacts[i] ? 'var(--success)' : 'var(--danger)';
    }
  });

  // Record telemetry if session recording is active
  if (typeof recordTelemetrySample === 'function') {
    recordTelemetrySample();
  }
}

// Update sparkline value display
function updateSparklineValue(id, value) {
  const el = document.getElementById(id);
  if (el) {
    el.textContent = (typeof value === 'number' ? value.toFixed(1) : '--') + '°';
  }
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
        } else if (data.type === 'test_result') {
          // Handle self-test results
          const levelMap = {
            'ok': 'INFO',
            'started': 'INFO',
            'warning': 'WARN',
            'critical': 'ERROR',
            'error': 'ERROR'
          };
          const level = levelMap[data.status] || 'INFO';
          const message = data.message || `Test ${data.test}: ${data.status}`;
          logEvent(level, message);
          addTestResult(level, message);
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
function initTargetSelector() {
  const targetSelect = document.getElementById('targetSelect');
  if (!targetSelect) return;

  // Set initial value from config
  if (state.config.target_mode) {
    targetSelect.value = state.config.target_mode;
  }

  targetSelect.addEventListener('change', (e) => {
    const target = e.target.value;
    state.targetMode = target;
    saveConfig({ target_mode: target });

    // Update UI based on target mode
    updateTargetModeUI(target);

    logEvent('INFO', `Target changed to: ${target}`);

    // Notify server of target change if connected
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'set_target_mode',
        mode: target
      }));
    }
  });

  // Apply initial target mode UI
  const initialTarget = targetSelect.value;
  state.targetMode = initialTarget;
  updateTargetModeUI(initialTarget);
}

function updateTargetModeUI(mode) {
  // Show/hide real robot warnings or indicators
  const realRobotWarnings = document.querySelectorAll('.real-robot-warning');
  const simulationOnly = document.querySelectorAll('.simulation-only');

  realRobotWarnings.forEach(el => {
    el.style.display = (mode === 'real' || mode === 'both') ? 'block' : 'none';
  });

  simulationOnly.forEach(el => {
    el.style.display = (mode === 'simulation') ? 'block' : 'none';
  });

  // Update connection status text
  const connectionText = document.getElementById('connectionText');
  if (connectionText) {
    if (mode === 'simulation') {
      connectionText.textContent = state.connected ? 'Simulation' : 'Disconnected';
    } else if (mode === 'real') {
      connectionText.textContent = state.connected ? 'Real Robot' : 'Disconnected';
    } else {
      connectionText.textContent = state.connected ? 'Sim + Real' : 'Disconnected';
    }
  }
}

// Initialize target selector after DOM ready
setTimeout(initTargetSelector, 100);

// ========== Summary Cards ==========
function updateSummaryCards() {
  const c = state.config;

  // Geometry card - use body_width and body_length
  const bodyWidth = c.body_width || 250;
  const bodyLength = c.body_length || 300;
  const summaryGeometry = document.getElementById('summaryGeometry');
  if (summaryGeometry) {
    summaryGeometry.textContent = `${bodyLength} x ${bodyWidth}mm`;
  }
  const summaryGeometryMeta = document.getElementById('summaryGeometryMeta');
  if (summaryGeometryMeta) {
    const coxaLen = c.leg_coxa_length || 15;
    const femurLen = c.leg_femur_length || 50;
    const tibiaLen = c.leg_tibia_length || 55;
    summaryGeometryMeta.textContent = `Leg: ${coxaLen}+${femurLen}+${tibiaLen}mm`;
  }

  // Servos card - count configured offsets
  const summaryServos = document.getElementById('summaryServos');
  if (summaryServos) {
    summaryServos.textContent = '18 servos';
  }
  const summaryServosMeta = document.getElementById('summaryServosMeta');
  if (summaryServosMeta) {
    const freq = c.servo_frequency || 50;
    summaryServosMeta.textContent = `${freq}Hz PWM`;
  }

  // Gait card
  const summaryGait = document.getElementById('summaryGait');
  if (summaryGait) {
    const gaitName = (state.activeGait || c.default_gait || 'tripod');
    summaryGait.textContent = gaitName.charAt(0).toUpperCase() + gaitName.slice(1);
  }
  const summaryGaitMeta = document.getElementById('summaryGaitMeta');
  if (summaryGaitMeta) {
    const stepLen = c.step_length || 40;
    const stepHeight = c.step_height || 25;
    summaryGaitMeta.textContent = `Step: ${stepLen}mm, Height: ${stepHeight}mm`;
  }

  // Body Pose card
  const summaryPose = document.getElementById('summaryPose');
  if (summaryPose) {
    const height = c.body_height || state.telemetry.bodyHeight || 90;
    summaryPose.textContent = `Height: ${height}mm`;
  }
  const summaryPoseMeta = document.getElementById('summaryPoseMeta');
  if (summaryPoseMeta) {
    const roll = state.telemetry.roll || 0;
    const pitch = state.telemetry.pitch || 0;
    const yaw = state.telemetry.yaw || 0;
    summaryPoseMeta.textContent = `R: ${roll.toFixed(1)}° P: ${pitch.toFixed(1)}° Y: ${yaw.toFixed(1)}°`;
  }
}

// Summary card click navigation
document.querySelectorAll('.summary-card[data-nav]').forEach(card => {
  const navigateToSection = () => {
    const targetSection = card.dataset.nav;
    const navItem = document.querySelector(`.nav-item[data-section="${targetSection}"]`);
    if (navItem) {
      navItem.click();
      logEvent('INFO', `Navigated to ${targetSection}`);
    }
  };

  card.addEventListener('click', navigateToSection);

  // Keyboard accessibility for role="button" elements
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      navigateToSection();
    }
  });
});

// ========== Profile Modal ==========
function showProfileModal(options = {}) {
  const { mode = 'create', existingName = '', existingDescription = '', copyFrom = null } = options;

  const isEdit = mode === 'edit';
  const isDuplicate = mode === 'duplicate';
  const title = isEdit ? 'Edit Profile' : isDuplicate ? 'Duplicate Profile' : 'Create New Profile';
  const submitText = isEdit ? 'Save Changes' : isDuplicate ? 'Create Copy' : 'Create Profile';

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-content" style="max-width: 450px;">
      <div class="modal-header">
        <h3>${title}</h3>
        <button class="modal-close">&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-group" style="margin-bottom: 16px;">
          <label class="form-label">Profile Name</label>
          <input type="text" class="form-input" id="profileModalName" value="${existingName}"
            placeholder="e.g., outdoor_rough" style="width: 100%;" ${isEdit ? 'disabled' : ''}>
          <div id="profileNameError" style="color: var(--danger); font-size: 12px; margin-top: 4px; display: none;"></div>
          ${isEdit ? '' : `<div style="color: var(--text-muted); font-size: 11px; margin-top: 4px;">
            Use lowercase letters, numbers, and underscores only
          </div>`}
        </div>
        <div class="form-group" style="margin-bottom: 16px;">
          <label class="form-label">Description (optional)</label>
          <textarea class="form-input" id="profileModalDesc" rows="2"
            placeholder="Brief description of this profile" style="width: 100%; resize: vertical;">${existingDescription}</textarea>
        </div>
        ${!isEdit ? `
        <div class="form-group">
          <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
            <input type="checkbox" id="profileModalCopy" ${copyFrom ? 'checked' : ''}>
            <span>Copy settings from current profile (${state.currentProfile})</span>
          </label>
        </div>
        ` : ''}
      </div>
      <div class="modal-footer" style="display: flex; gap: 12px; justify-content: flex-end;">
        <button class="btn btn-secondary" id="profileModalCancel">Cancel</button>
        <button class="btn btn-primary" id="profileModalSubmit">${submitText}</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const nameInput = modal.querySelector('#profileModalName');
  const descInput = modal.querySelector('#profileModalDesc');
  const errorDiv = modal.querySelector('#profileNameError');
  const copyCheckbox = modal.querySelector('#profileModalCopy');
  const submitBtn = modal.querySelector('#profileModalSubmit');

  // Focus name input
  setTimeout(() => nameInput.focus(), 100);

  // Validate name on input
  nameInput.addEventListener('input', () => {
    const value = nameInput.value.trim().toLowerCase().replace(/\s+/g, '_');
    const sanitized = value.replace(/[^a-z0-9_]/g, '');

    if (value !== sanitized) {
      errorDiv.textContent = 'Only lowercase letters, numbers, and underscores allowed';
      errorDiv.style.display = 'block';
      return;
    }

    if (!isEdit && value && state.profiles.some(p => (typeof p === 'string' ? p : p.name) === sanitized)) {
      errorDiv.textContent = 'A profile with this name already exists';
      errorDiv.style.display = 'block';
      return;
    }

    errorDiv.style.display = 'none';
  });

  // Close handlers
  const closeModal = () => modal.remove();
  modal.querySelector('.modal-close').addEventListener('click', closeModal);
  modal.querySelector('#profileModalCancel').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

  // Submit handler
  submitBtn.addEventListener('click', () => {
    const rawName = nameInput.value.trim();
    const trimmedName = rawName.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    const description = descInput.value.trim();
    const shouldCopy = copyCheckbox?.checked ?? false;

    if (!trimmedName) {
      errorDiv.textContent = 'Profile name is required';
      errorDiv.style.display = 'block';
      return;
    }

    if (!isEdit && state.profiles.some(p => (typeof p === 'string' ? p : p.name) === trimmedName)) {
      errorDiv.textContent = 'A profile with this name already exists';
      errorDiv.style.display = 'block';
      return;
    }

    if (isEdit) {
      // Update existing profile
      state.profilesData[existingName] = {
        ...state.profilesData[existingName],
        description: description,
        lastModified: new Date().toISOString()
      };
      saveProfilesToStorage();
      renderProfileTable();
      logEvent('INFO', `Profile "${existingName}" updated`);
    } else {
      // Create new profile
      state.profiles.push(trimmedName);
      state.profilesData[trimmedName] = {
        name: trimmedName,
        description: description,
        lastModified: new Date().toISOString(),
        isDefault: false
      };

      // Copy config if requested
      if (shouldCopy || copyFrom) {
        const sourceProfile = copyFrom || state.currentProfile;
        const sourceConfig = loadConfigFromStorage(sourceProfile) || state.config;
        saveConfigToStorage(trimmedName, { ...sourceConfig });
      }

      saveProfilesToStorage();

      // Try to save to backend
      fetch('/api/profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          name: trimmedName,
          description: description,
          copyFrom: shouldCopy || copyFrom ? (copyFrom || state.currentProfile) : null
        })
      }).catch(e => console.log('Backend save failed:', e));

      updateProfileSelector();
      renderProfileTable();
      selectProfile(trimmedName);
      logEvent('INFO', `Created new profile: ${trimmedName}`);
    }

    closeModal();
  });

  // Enter key submits
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitBtn.click(); });
  descInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitBtn.click(); } });
}

// ========== New Profile Button ==========
document.getElementById('btnNewProfile')?.addEventListener('click', () => {
  showProfileModal({ mode: 'create' });
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

      // Validate imported data is an object
      if (!imported || typeof imported !== 'object' || Array.isArray(imported)) {
        throw new Error('Invalid profile format: expected an object');
      }

      // Handle new export format (with config wrapper) or legacy format
      const configData = imported.config || imported;

      // Validate configData is a non-empty object
      if (!configData || typeof configData !== 'object' || Array.isArray(configData)) {
        throw new Error('Invalid config data: expected an object');
      }

      if (Object.keys(configData).length === 0) {
        throw new Error('Config data is empty');
      }

      const profileDescription = imported.profile_description || imported.description || `Imported from ${file.name}`;

      // Determine profile name from export data or filename, with sanitization
      let profileName = (imported.profile_name || file.name.replace('.json', ''))
        .replace(/[^a-z0-9_]/gi, '_')
        .toLowerCase()
        .substring(0, 64);  // Limit length

      if (!profileName) {
        profileName = 'imported_profile';
      }

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
  setupGeometrySlider('bodyRadius', 'bodyRadiusValue', 'body_radius', 'mm');
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
  document.getElementById('btnResetBodyGeometry')?.addEventListener('click', () => {
    if (confirm('Reset body geometry to defaults?')) {
      resetGeometryToDefaults();
    }
  });

  // Body origin selector
  const bodyOriginSelect = document.getElementById('bodyOrigin');
  if (bodyOriginSelect) {
    // Set initial value from config
    if (state.config.body_origin) {
      bodyOriginSelect.value = state.config.body_origin;
    }
    bodyOriginSelect.addEventListener('change', () => {
      const value = bodyOriginSelect.value;
      saveConfig({ body_origin: value });
      logEvent('INFO', `Body origin set to: ${value}`);
      // Update 3D preview to reflect origin change
      updateGeometryPreview('body_origin', value);
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

      // Load value from config, falling back to JS defaults
      const configKey = `leg_${legIndex}_attach_${field}`;
      const defaultValue = defaultGeometry.leg_attach_points[legIndex]?.[field];
      const value = state.config[configKey] ?? defaultValue;
      if (value !== undefined) {
        input.value = value;
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
        enableFrameEdit(row);
        row.classList.add('editing');
        btn.textContent = 'Save';
      }
    });
  });

  // Add new frame button functionality
  const addFrameBtn = document.querySelector('#tab-geo-frames button.btn-secondary');
  if (addFrameBtn && addFrameBtn.textContent.includes('Add Frame')) {
    addFrameBtn.addEventListener('click', () => {
      const name = prompt('Enter name for new frame:');
      if (name && name.trim()) {
        addNewFrame(name.trim());
      }
    });
  }
}

function enableFrameEdit(row) {
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
  // Reset body dimensions (octagonal body uses radius)
  setSliderAndSave('bodyRadius', 'bodyRadiusValue', defaultGeometry.body_radius, 'mm', 'body_radius');
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

  // Body dimension changes require rebuilding the body mesh (octagonal body uses radius)
  if (configKey === 'body_radius' || configKey === 'body_height_geo') {
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

// ========== Session Recording & Log Download ==========
const sessionRecording = {
  active: false,
  startTime: null,
  data: []
};

document.getElementById('recordBtn')?.addEventListener('click', function() {
  if (sessionRecording.active) {
    // Stop recording
    sessionRecording.active = false;
    this.textContent = 'Record Session';
    this.classList.remove('btn-danger');
    this.classList.add('btn-success');

    // Export recorded data
    if (sessionRecording.data.length > 0) {
      const blob = new Blob([JSON.stringify({
        startTime: sessionRecording.startTime,
        endTime: new Date().toISOString(),
        duration: Date.now() - new Date(sessionRecording.startTime).getTime(),
        samples: sessionRecording.data.length,
        data: sessionRecording.data
      }, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `hexapod_session_${sessionRecording.startTime.replace(/[:.]/g, '-')}.json`;
      link.click();
      URL.revokeObjectURL(url);
      logEvent('INFO', `Session recording saved: ${sessionRecording.data.length} samples`);
    }
    sessionRecording.data = [];
  } else {
    // Start recording
    sessionRecording.active = true;
    sessionRecording.startTime = new Date().toISOString();
    sessionRecording.data = [];
    this.textContent = 'Stop Recording';
    this.classList.remove('btn-success');
    this.classList.add('btn-danger');
    logEvent('INFO', 'Session recording started');
  }
  state.isRecording = sessionRecording.active;
});

// Capture telemetry for recording
function recordTelemetrySample() {
  if (sessionRecording.active) {
    sessionRecording.data.push({
      timestamp: Date.now(),
      telemetry: { ...state.telemetry },
      legAngles: state.legAngles.map(a => ({ ...a })),
      footContacts: [...state.footContacts]
    });
  }
}

document.getElementById('downloadLogsBtn')?.addEventListener('click', () => {
  // Collect all log entries from the event log
  const eventLog = document.getElementById('eventLog');
  const entries = [];

  if (eventLog) {
    eventLog.querySelectorAll('.log-entry').forEach(entry => {
      const time = entry.querySelector('.log-time')?.textContent || '';
      const level = entry.querySelector('.log-level')?.textContent || '';
      const message = entry.querySelector('.log-message')?.textContent || '';
      entries.push({ time, level, message });
    });
  }

  // Create downloadable log file
  const logContent = {
    exportTime: new Date().toISOString(),
    profile: state.currentProfile,
    config: state.config,
    telemetry: state.telemetry,
    entries: entries
  };

  const blob = new Blob([JSON.stringify(logContent, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `hexapod_logs_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  link.click();
  URL.revokeObjectURL(url);
  logEvent('INFO', `Downloaded ${entries.length} log entries`);
});

// ========== Motion Smoothing Sliders ==========
function initMotionSmoothingSliders() {
  // Max Linear Acceleration slider
  const linearAccelSlider = document.getElementById('maxLinearAccel');
  const linearAccelValue = document.getElementById('maxLinearAccelValue');
  if (linearAccelSlider && linearAccelValue) {
    linearAccelSlider.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      linearAccelValue.textContent = val.toFixed(1) + ' m/s²';
    });
    linearAccelSlider.addEventListener('change', (e) => {
      const val = parseFloat(e.target.value);
      saveConfig({ max_linear_accel: val });
      logEvent('INFO', `Max linear acceleration set to ${val.toFixed(1)} m/s²`);
    });
  }

  // Max Angular Acceleration slider
  const angularAccelSlider = document.getElementById('maxAngularAccel');
  const angularAccelValue = document.getElementById('maxAngularAccelValue');
  if (angularAccelSlider && angularAccelValue) {
    angularAccelSlider.addEventListener('input', (e) => {
      const val = parseInt(e.target.value);
      angularAccelValue.textContent = val + ' °/s²';
    });
    angularAccelSlider.addEventListener('change', (e) => {
      const val = parseInt(e.target.value);
      saveConfig({ max_angular_accel: val });
      logEvent('INFO', `Max angular acceleration set to ${val} °/s²`);
    });
  }

  // Input Smoothing Factor slider
  const smoothingSlider = document.getElementById('inputSmoothingFactor');
  const smoothingValue = document.getElementById('inputSmoothingFactorValue');
  if (smoothingSlider && smoothingValue) {
    smoothingSlider.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      smoothingValue.textContent = val.toFixed(2);
    });
    smoothingSlider.addEventListener('change', (e) => {
      const val = parseFloat(e.target.value);
      saveConfig({ input_smoothing_factor: val });
      logEvent('INFO', `Input smoothing factor set to ${val.toFixed(2)}`);
    });
  }

  // Input Smoothing Enabled checkbox
  const smoothingEnabled = document.getElementById('inputSmoothingEnabled');
  if (smoothingEnabled) {
    smoothingEnabled.addEventListener('change', (e) => {
      saveConfigValue('input_smoothing_enabled', e.target.checked);
      logEvent('INFO', `Input smoothing ${e.target.checked ? 'enabled' : 'disabled'}`);
    });
  }
}

// Initialize motion smoothing sliders after DOM ready
setTimeout(initMotionSmoothingSliders, 150);

// ========== Gamepad Status Detection ==========
function initGamepadDetection() {
  const gamepadStatus = document.getElementById('gamepad-status');

  function updateGamepadStatus() {
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    const connected = Array.from(gamepads).filter(gp => gp !== null);

    if (gamepadStatus) {
      if (connected.length > 0) {
        const gp = connected[0];
        gamepadStatus.textContent = `${gp.id.substring(0, 30)}...`;
        gamepadStatus.style.color = 'var(--success)';
      } else {
        gamepadStatus.textContent = 'Not connected';
        gamepadStatus.style.color = 'var(--text-muted)';
      }
    }
  }

  // Listen for gamepad connections
  window.addEventListener('gamepadconnected', (e) => {
    logEvent('INFO', `Gamepad connected: ${e.gamepad.id}`);
    updateGamepadStatus();
  });

  window.addEventListener('gamepaddisconnected', (e) => {
    logEvent('INFO', `Gamepad disconnected: ${e.gamepad.id}`);
    updateGamepadStatus();
  });

  // Initial check
  updateGamepadStatus();

  // Poll for gamepad status (some browsers need this)
  setInterval(updateGamepadStatus, 1000);
}

// Initialize gamepad detection after DOM ready
setTimeout(initGamepadDetection, 200);

// ========== Body Posture & Gait Settings ==========
function initPostureAndGaitSettings() {
  // Keep body level checkbox
  const keepBodyLevel = document.getElementById('keepBodyLevel');
  if (keepBodyLevel) {
    // Set initial value from config
    if (state.config.keep_body_level !== undefined) {
      keepBodyLevel.checked = state.config.keep_body_level;
    }
    keepBodyLevel.addEventListener('change', () => {
      const enabled = keepBodyLevel.checked;
      saveConfig({ keep_body_level: enabled });
      logEvent('INFO', `Keep body level (IMU): ${enabled ? 'enabled' : 'disabled'}`);
    });
  }

  // Turn mode selector
  const turnMode = document.getElementById('turnMode');
  if (turnMode) {
    // Set initial value from config
    if (state.config.turn_mode) {
      turnMode.value = state.config.turn_mode;
    }
    turnMode.addEventListener('change', () => {
      const mode = turnMode.value;
      saveConfig({ turn_mode: mode });
      logEvent('INFO', `Turn mode set to: ${mode}`);
    });
  }

  // Max yaw rate slider
  const maxYawRate = document.getElementById('maxYawRate');
  const maxYawRateValue = document.getElementById('maxYawRateValue');
  if (maxYawRate && maxYawRateValue) {
    // Set initial value from config
    const initialValue = state.config.max_yaw_rate ?? 60;
    maxYawRate.value = initialValue;
    maxYawRateValue.textContent = `${initialValue} °/s`;

    maxYawRate.addEventListener('input', () => {
      const value = parseInt(maxYawRate.value);
      maxYawRateValue.textContent = `${value} °/s`;
    });

    maxYawRate.addEventListener('change', () => {
      const value = parseInt(maxYawRate.value);
      saveConfig({ max_yaw_rate: value });
      logEvent('INFO', `Max yaw rate set to: ${value}°/s`);
    });
  }
}

// Initialize posture and gait settings after DOM ready
setTimeout(initPostureAndGaitSettings, 150);

// ========== Unified Camera Configuration ==========
// Single unified camera list - combines source + display settings
let cameras = [];
let detectedCameras = []; // Cameras found during detection

// Default camera configuration
const DEFAULT_CAMERAS = [
  {
    id: 'front-cam',
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

function initCamerasSection() {
  // Load cameras from config
  loadCameras();

  // Detect cameras button
  document.getElementById('detectCamerasBtn')?.addEventListener('click', async () => {
    await detectCameras();
  });

  // Add camera button
  document.getElementById('addCameraBtn')?.addEventListener('click', () => {
    addCamera();
  });

  // Save cameras button
  document.getElementById('saveCamerasBtn')?.addEventListener('click', async () => {
    await saveCameras();
  });
}

function loadCameras() {
  // First try new unified format, then fall back to legacy formats
  const configCameras = state.config.cameras;
  console.log('[loadCameras] state.config keys:', Object.keys(state.config));
  console.log('[loadCameras] state.config.cameras:', configCameras);
  console.log('[loadCameras] state.config.camera_views:', state.config.camera_views);

  if (configCameras && Array.isArray(configCameras) && configCameras.length > 0) {
    console.log('[loadCameras] Using unified cameras format');
    cameras = configCameras.map((c, i) => normalizeCamera(c, i));
  } else if (state.config.camera_views && Array.isArray(state.config.camera_views) && state.config.camera_views.length > 0) {
    // Migrate from legacy camera_views format
    console.log('[loadCameras] Migrating from legacy camera_views');
    cameras = migrateLegacyCameraViews(state.config.camera_views, state.config.hardware_cameras || []);
  } else {
    console.log('[loadCameras] Using DEFAULT_CAMERAS (no config found)');
    cameras = DEFAULT_CAMERAS.map((c, i) => normalizeCamera(c, i));
  }
  console.log('[loadCameras] Final cameras array:', cameras);
  renderCameraList();
}

function normalizeCamera(camera, index = 0) {
  return {
    id: camera?.id || `cam-${index}`,
    name: camera?.name || camera?.label || `Camera ${index + 1}`,
    enabled: camera?.enabled !== undefined ? !!camera.enabled : true,
    // Source
    sourceType: camera?.source_type || camera?.sourceType || 'browser',
    sourceAddress: camera?.source_address || camera?.sourceAddress || camera?.address || '',
    resolution: camera?.resolution || '1280x720',
    fps: camera?.fps || 30,
    // Display
    displayMode: camera?.display_mode || camera?.displayMode || 'dock',
    position: camera?.position || 'front',
    // Browser webcam device selection
    deviceId: camera?.device_id || camera?.deviceId || null,
    deviceLabel: camera?.device_label || camera?.deviceLabel || null
  };
}

// Populate device dropdown with available webcam devices
async function populateDeviceDropdown(selectEl, currentDeviceId = null) {
  if (!selectEl) return;

  // Request permission first (needed to get device labels)
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    stream.getTracks().forEach(track => track.stop());
  } catch (err) {
    logEvent('WARN', 'Camera permission denied');
    selectEl.innerHTML = '<option value="">Permission denied</option>';
    return;
  }

  // Get available video devices
  const devices = await navigator.mediaDevices.enumerateDevices();
  const videoDevices = devices.filter(d => d.kind === 'videoinput');

  if (videoDevices.length === 0) {
    selectEl.innerHTML = '<option value="">No devices found</option>';
    return;
  }

  // Build options
  let html = '<option value="">-- Select Device --</option>';
  videoDevices.forEach((device, idx) => {
    const label = device.label || `Camera ${idx + 1}`;
    const selected = device.deviceId === currentDeviceId ? 'selected' : '';
    html += `<option value="${device.deviceId}" ${selected}>${label}</option>`;
  });

  selectEl.innerHTML = html;
  logEvent('INFO', `Found ${videoDevices.length} webcam device(s)`);
}

// Migrate from old two-layer format (hardware_cameras + camera_views)
function migrateLegacyCameraViews(legacyViews, legacyHardware) {
  return legacyViews.map((view, idx) => {
    let sourceType = view.source_type || view.sourceType || 'browser';
    let sourceAddress = view.source_url || view.sourceUrl || '';
    let resolution = '1280x720';
    let fps = 30;

    // If it was a hardware reference, resolve it
    if (sourceType === 'hardware' && (view.hardware_camera_id || view.hardwareCameraId)) {
      const hwId = view.hardware_camera_id || view.hardwareCameraId;
      const hwCam = legacyHardware.find(c => c.id === hwId);
      if (hwCam) {
        sourceType = hwCam.type || 'usb';
        sourceAddress = hwCam.address || '';
        resolution = hwCam.resolution || '1280x720';
        fps = hwCam.fps || 30;
      }
    } else if (sourceType === 'local') {
      sourceType = 'browser';
    }

    return normalizeCamera({
      id: view.id || `cam-${idx}`,
      name: view.label || `Camera ${idx + 1}`,
      enabled: view.enabled,
      sourceType,
      sourceAddress,
      resolution,
      fps,
      displayMode: (view.display_mode || view.displayMode) === 'pane' ? 'dock' : (view.display_mode || view.displayMode || 'dock'),
      position: view.position || 'front'
    }, idx);
  });
}

async function detectCameras() {
  const btn = document.getElementById('detectCamerasBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Detecting...';
  }

  logEvent('INFO', 'Scanning for cameras...');

  try {
    const response = await fetch('/api/cameras/detect');
    if (response.ok) {
      const data = await response.json();
      detectedCameras = data.cameras || [];
      logEvent('INFO', `Found ${detectedCameras.length} camera(s) from hardware`);
    } else {
      detectedCameras = await detectBrowserCameras();
    }
  } catch (err) {
    logEvent('WARN', 'Backend detection unavailable, using browser');
    detectedCameras = await detectBrowserCameras();
  }

  if (detectedCameras.length > 0) {
    showDetectedCamerasDialog(detectedCameras);
  } else {
    logEvent('INFO', 'No new cameras detected');
  }

  if (btn) {
    btn.disabled = false;
    btn.textContent = 'Detect';
  }
}

async function detectBrowserCameras() {
  try {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      stream.getTracks().forEach(track => track.stop());
    } catch (permErr) {
      logEvent('WARN', 'Camera permission denied or unavailable');
    }

    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter(d => d.kind === 'videoinput');

    if (videoDevices.length === 0) {
      logEvent('INFO', 'No video devices found');
      return [];
    }

    logEvent('INFO', `Found ${videoDevices.length} browser camera(s)`);

    return videoDevices.map((d, i) => ({
      id: d.deviceId || `browser-cam-${i}`,
      name: d.label || `Camera ${i + 1}`,
      address: d.deviceId,
      type: 'browser'
    }));
  } catch (err) {
    logEvent('WARN', 'Browser camera detection failed: ' + err.message);
    return [];
  }
}

function showDetectedCamerasDialog(detectedList) {
  const existingAddresses = cameras.map(c => c.sourceAddress);
  const newCameras = detectedList.filter(c => !existingAddresses.includes(c.address));

  if (newCameras.length === 0) {
    logEvent('INFO', 'All detected cameras are already configured');
    return;
  }

  document.querySelector('.detected-cameras-modal')?.remove();

  const modal = document.createElement('div');
  modal.className = 'modal detected-cameras-modal';
  modal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 10000;';

  modal.innerHTML = `
    <div style="background: var(--panel-bg); border-radius: 12px; padding: 24px; max-width: 500px; width: 90%;">
      <h3 style="margin: 0 0 16px 0; font-size: 18px;">Detected Cameras</h3>
      <p style="font-size: 12px; color: var(--text-muted); margin-bottom: 16px;">Select cameras to add:</p>
      <div id="detectedCamerasList" style="max-height: 300px; overflow-y: auto;">
        ${newCameras.map((c, i) => `
          <label style="display: flex; align-items: center; gap: 10px; padding: 10px; background: var(--control-bg); border-radius: 6px; margin-bottom: 8px; cursor: pointer;">
            <input type="checkbox" class="detected-cam-checkbox" data-index="${i}" checked>
            <div>
              <div style="font-weight: 500;">${c.name}</div>
              <div style="font-size: 11px; color: var(--text-muted);">${c.type}</div>
            </div>
          </label>
        `).join('')}
      </div>
      <div style="display: flex; gap: 10px; margin-top: 20px; justify-content: flex-end;">
        <button class="btn btn-secondary" id="cancelDetectedBtn">Cancel</button>
        <button class="btn btn-primary" id="addDetectedBtn">Add Selected</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  modal.querySelector('#cancelDetectedBtn').addEventListener('click', () => modal.remove());

  modal.querySelector('#addDetectedBtn').addEventListener('click', () => {
    const checkboxes = modal.querySelectorAll('.detected-cam-checkbox:checked');
    checkboxes.forEach(cb => {
      const idx = parseInt(cb.dataset.index);
      const cam = newCameras[idx];
      // For browser cameras, use address as deviceId
      const isBrowser = cam.type === 'browser';
      cameras.push(normalizeCamera({
        id: `cam-${Date.now()}-${idx}`,
        name: cam.name,
        sourceType: cam.type,
        sourceAddress: isBrowser ? '' : cam.address,
        deviceId: isBrowser ? cam.address : null,
        deviceLabel: isBrowser ? cam.name : null,
        displayMode: 'dock',
        position: 'front'
      }, cameras.length));
    });
    renderCameraList();
    logEvent('INFO', `Added ${checkboxes.length} camera(s)`);
    modal.remove();
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });
}

function addCamera() {
  cameras.push(normalizeCamera({
    id: `cam-${Date.now()}`,
    name: `Camera ${cameras.length + 1}`,
    sourceType: 'browser',
    sourceAddress: '',
    displayMode: 'dock',
    position: 'front'
  }, cameras.length));

  renderCameraList();
  logEvent('INFO', 'Added new camera');
}

function updateCamera(id, field, value) {
  const cam = cameras.find(c => c.id === id);
  if (cam) {
    cam[field] = value;
  }
}

function removeCamera(id) {
  cameras = cameras.filter(c => c.id !== id);
  renderCameraList();
  logEvent('INFO', 'Removed camera');
}

async function saveCameras() {
  const payload = {
    cameras: cameras.map(cam => ({
      id: cam.id,
      name: cam.name,
      enabled: cam.enabled,
      source_type: cam.sourceType,
      source_address: cam.sourceAddress,
      resolution: cam.resolution,
      fps: cam.fps,
      display_mode: cam.displayMode,
      position: cam.position,
      device_id: cam.deviceId || null,
      device_label: cam.deviceLabel || null
    }))
  };
  await saveConfig(payload);
  logEvent('INFO', 'Cameras saved');
}

function getSourcePlaceholder(type) {
  switch (type) {
    case 'usb': return '/dev/video0';
    case 'csi': return '0 (CSI port)';
    case 'http': return 'http://192.168.1.100:8080/video';
    case 'rtsp': return 'rtsp://192.168.1.100:554/stream';
    case 'browser': return '(uses browser webcam)';
    default: return 'Device address';
  }
}

function renderCameraList() {
  const container = document.getElementById('cameraList');
  const noCameras = document.getElementById('noCameras');
  console.log('[renderCameraList] container:', container);
  console.log('[renderCameraList] cameras.length:', cameras.length);

  if (!container) {
    console.log('[renderCameraList] No container found, returning early');
    return;
  }

  container.innerHTML = '';

  if (cameras.length === 0) {
    if (noCameras) noCameras.style.display = 'block';
    return;
  }

  if (noCameras) noCameras.style.display = 'none';

  cameras.forEach((cam) => {
    const row = document.createElement('div');
    row.style.cssText = 'background: var(--control-bg); border-radius: 8px; padding: 12px; margin-bottom: 10px;';
    row.dataset.camId = cam.id;

    const isBrowserType = cam.sourceType === 'browser';
    const deviceLabel = cam.deviceLabel || (cam.deviceId ? 'Device selected' : 'No device selected');

    row.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <input type="text" class="form-input cam-name" value="${cam.name}" style="width: 140px;" placeholder="Camera name">
          <label style="display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-muted);">
            <input type="checkbox" class="cam-enabled" ${cam.enabled ? 'checked' : ''}>
            Enabled
          </label>
        </div>
        <button class="btn btn-danger btn-sm cam-remove">Remove</button>
      </div>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px;">
        <div>
          <label class="form-label" style="font-size: 11px;">Source Type</label>
          <select class="form-select cam-source-type">
            <option value="browser" ${cam.sourceType === 'browser' ? 'selected' : ''}>Browser Webcam</option>
            <option value="usb" ${cam.sourceType === 'usb' ? 'selected' : ''}>USB / V4L2</option>
            <option value="csi" ${cam.sourceType === 'csi' ? 'selected' : ''}>CSI (Pi Camera)</option>
            <option value="http" ${cam.sourceType === 'http' ? 'selected' : ''}>HTTP (MJPEG)</option>
            <option value="rtsp" ${cam.sourceType === 'rtsp' ? 'selected' : ''}>RTSP Stream</option>
          </select>
        </div>
        <div class="browser-device-container" style="${isBrowserType ? '' : 'display: none;'}">
          <label class="form-label" style="font-size: 11px;">Webcam Device</label>
          <div style="display: flex; gap: 6px;">
            <select class="form-select cam-device-select" style="flex: 1;">
              <option value="">-- Select Device --</option>
              ${cam.deviceId ? `<option value="${cam.deviceId}" selected>${deviceLabel}</option>` : ''}
            </select>
            <button class="btn btn-secondary btn-sm cam-refresh-devices" title="Refresh device list" style="padding: 4px 8px;">🔄</button>
          </div>
        </div>
        <div class="source-address-container" style="${isBrowserType ? 'display: none;' : ''}">
          <label class="form-label" style="font-size: 11px;">Address</label>
          <input type="text" class="form-input cam-address" value="${cam.sourceAddress || ''}" placeholder="${getSourcePlaceholder(cam.sourceType)}">
        </div>
        <div>
          <label class="form-label" style="font-size: 11px;">Resolution</label>
          <select class="form-select cam-resolution">
            <option value="640x480" ${cam.resolution === '640x480' ? 'selected' : ''}>640x480</option>
            <option value="1280x720" ${cam.resolution === '1280x720' ? 'selected' : ''}>1280x720</option>
            <option value="1920x1080" ${cam.resolution === '1920x1080' ? 'selected' : ''}>1920x1080</option>
          </select>
        </div>
        <div>
          <label class="form-label" style="font-size: 11px;">Display</label>
          <select class="form-select cam-display-mode">
            <option value="dock" ${cam.displayMode === 'dock' ? 'selected' : ''}>Dock (Pane)</option>
            <option value="overlay" ${cam.displayMode === 'overlay' ? 'selected' : ''}>3D Overlay</option>
          </select>
        </div>
        <div>
          <label class="form-label" style="font-size: 11px;">Position</label>
          <select class="form-select cam-position">
            <option value="front" ${cam.position === 'front' ? 'selected' : ''}>Front</option>
            <option value="left" ${cam.position === 'left' ? 'selected' : ''}>Left</option>
            <option value="right" ${cam.position === 'right' ? 'selected' : ''}>Right</option>
            <option value="rear" ${cam.position === 'rear' ? 'selected' : ''}>Rear</option>
            <option value="floating" ${cam.position === 'floating' ? 'selected' : ''}>Floating</option>
          </select>
        </div>
      </div>
    `;

    // Event listeners
    row.querySelector('.cam-name').addEventListener('input', (e) => {
      updateCamera(cam.id, 'name', e.target.value);
    });

    row.querySelector('.cam-enabled').addEventListener('change', (e) => {
      updateCamera(cam.id, 'enabled', e.target.checked);
    });

    row.querySelector('.cam-source-type').addEventListener('change', (e) => {
      updateCamera(cam.id, 'sourceType', e.target.value);
      const isBrowser = e.target.value === 'browser';
      const addrContainer = row.querySelector('.source-address-container');
      const browserContainer = row.querySelector('.browser-device-container');
      const addrInput = row.querySelector('.cam-address');

      addrContainer.style.display = isBrowser ? 'none' : '';
      browserContainer.style.display = isBrowser ? '' : 'none';
      addrInput.placeholder = getSourcePlaceholder(e.target.value);

      // Clear device selection when switching away from browser
      if (!isBrowser) {
        updateCamera(cam.id, 'deviceId', null);
        updateCamera(cam.id, 'deviceLabel', null);
      }
    });

    row.querySelector('.cam-address').addEventListener('input', (e) => {
      updateCamera(cam.id, 'sourceAddress', e.target.value);
    });

    // Device selector for browser webcams
    const deviceSelect = row.querySelector('.cam-device-select');
    const refreshBtn = row.querySelector('.cam-refresh-devices');

    deviceSelect?.addEventListener('change', (e) => {
      const selectedOption = e.target.selectedOptions[0];
      const deviceId = e.target.value;
      const deviceLabel = selectedOption?.textContent || '';
      updateCamera(cam.id, 'deviceId', deviceId || null);
      updateCamera(cam.id, 'deviceLabel', deviceId ? deviceLabel : null);
      logEvent('INFO', deviceId ? `Selected device: ${deviceLabel}` : 'Device cleared');
    });

    // Auto-load devices when dropdown is focused (first time)
    deviceSelect?.addEventListener('focus', async function onFirstFocus() {
      deviceSelect.removeEventListener('focus', onFirstFocus);
      await populateDeviceDropdown(deviceSelect, cam.deviceId);
    });

    refreshBtn?.addEventListener('click', async () => {
      refreshBtn.disabled = true;
      refreshBtn.textContent = '⏳';
      await populateDeviceDropdown(deviceSelect, cam.deviceId);
      refreshBtn.disabled = false;
      refreshBtn.textContent = '🔄';
    });

    row.querySelector('.cam-resolution').addEventListener('change', (e) => {
      updateCamera(cam.id, 'resolution', e.target.value);
    });

    row.querySelector('.cam-display-mode').addEventListener('change', (e) => {
      updateCamera(cam.id, 'displayMode', e.target.value);
    });

    row.querySelector('.cam-position').addEventListener('change', (e) => {
      updateCamera(cam.id, 'position', e.target.value);
    });

    row.querySelector('.cam-remove').addEventListener('click', () => {
      removeCamera(cam.id);
    });

    container.appendChild(row);
  });
}

// ========== Initialize ==========
// Note: initCamerasSection is called by initSensorsSection - do not call it separately
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
