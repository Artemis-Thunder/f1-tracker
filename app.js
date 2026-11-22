// ═══════════════════════════════════════════════════════════════
// F1 PULSE — Live Race Tracker
// Powered by OpenF1 API (https://openf1.org)
// ═══════════════════════════════════════════════════════════════

const API_BASE = 'https://api.openf1.org/v1';

// Rate limiter
const requestQueue = [];
let isProcessingQueue = false;
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 600;

async function throttledFetch(url) {
    return new Promise((resolve) => {
        requestQueue.push({ url, resolve });
        processQueue();
    });
}

async function processQueue() {
    if (isProcessingQueue) return;
    isProcessingQueue = true;
    while (requestQueue.length > 0) {
        const wait = Math.max(0, MIN_REQUEST_INTERVAL - (Date.now() - lastRequestTime));
        if (wait > 0) await new Promise(r => setTimeout(r, wait));
        const { url, resolve } = requestQueue.shift();
        lastRequestTime = Date.now();
        try {
            let res = await fetch(url);
            if (res.status === 429) {
                console.warn('Rate limited, waiting 12s...');
                await new Promise(r => setTimeout(r, 12000));
                res = await fetch(url);
            }
            if (!res.ok) { resolve([]); continue; }
            resolve(await res.json());
        } catch (err) {
            console.warn(`Fetch error: ${url}`, err.message);
            resolve([]);
        }
    }
    isProcessingQueue = false;
}

// ═══════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════
const state = {
    sessionKey: null, meetingKey: null, circuitKey: null,
    drivers: {},
    positions: [], intervals: [], laps: [], stints: [],
    weather: [], raceControl: [],
    locationsByDriver: {},
    trackPath: [],
    trackRotation: 0,
    isPlaying: false, playbackSpeed: 1,
    currentTimestamp: null, sessionStartTime: null, sessionEndTime: null,
    selectedDriver: null, driverDots: {},
    transformFn: null,
    currentStandings: [], currentIntervals: {}, currentLaps: {},
    currentStints: {}, currentCarData: {},
    _lastStandingsUpdate: 0, _lastWeatherUpdate: 0, _lastRCUpdate: 0,
};

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

async function fetchAPI(endpoint, params = {}) {
    const url = new URL(`${API_BASE}/${endpoint}`);
    Object.entries(params).forEach(([k, v]) => url.searchParams.append(k, v));
    return throttledFetch(url.toString());
}

const formatTime = (s) => {
    if (s == null || isNaN(s)) return '—';
    return `${Math.floor(Math.abs(s)/60).toString().padStart(2,'0')}:${Math.floor(Math.abs(s)%60).toString().padStart(2,'0')}`;
};

const formatLapTime = (s) => {
    if (s == null || isNaN(s)) return '—';
    const m = Math.floor(s / 60);
    const sec = (s % 60).toFixed(3);
    return m > 0 ? `${m}:${sec.padStart(6, '0')}` : sec;
};

const formatInterval = (v) => {
    if (v == null) return '—';
    if (typeof v === 'string') return v;
    return v === 0 ? 'LEADER' : `+${v.toFixed(3)}`;
};

const parseTS = (d) => new Date(d).getTime();

function updateLoading(pct, text) {
    const f = document.getElementById('loader-fill');
    const t = document.getElementById('loader-text');
    if (f) f.style.width = `${pct}%`;
    if (t) t.textContent = text;
}

function hexToRgb(hex) {
    hex = (hex || '888888').replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    return `${parseInt(hex.slice(0,2),16)||0}, ${parseInt(hex.slice(2,4),16)||0}, ${parseInt(hex.slice(4,6),16)||0}`;
}

// ═══════════════════════════════════════════════════════════════
// SESSION PICKER
// ═══════════════════════════════════════════════════════════════

let allSessionData = {};

async function loadAllSessions() {
    const years = [2025, 2024, 2023];
    const results = await Promise.all(
        years.map(y => fetchAPI('sessions', { year: y.toString() }))
    );
    const all = results.flat().filter(Boolean);
    const byYear = {};
    all.forEach(s => {
        const year = new Date(s.date_start).getFullYear();
        if (!byYear[year]) byYear[year] = {};
        if (!byYear[year][s.meeting_key]) byYear[year][s.meeting_key] = [];
        byYear[year][s.meeting_key].push(s);
    });
    return byYear;
}

function showPicker() {
    const picker = document.getElementById('session-picker');
    picker.style.removeProperty('opacity');
    picker.style.removeProperty('visibility');
    picker.style.removeProperty('pointer-events');
    picker.classList.remove('fade-out');
    document.getElementById('step-gp').classList.add('disabled');
    document.getElementById('step-session').classList.add('disabled');
    document.getElementById('gp-options').innerHTML = '<p class="picker-hint">Select a season first</p>';
    document.getElementById('session-options').innerHTML = '<p class="picker-hint">Select a Grand Prix first</p>';
    document.getElementById('picker-loading').classList.add('hidden');
    document.querySelectorAll('.picker-btn.selected').forEach(b => b.classList.remove('selected'));
    // Re-enable steps
    document.getElementById('step-year').classList.remove('disabled');
}

function populateYears() {
    const container = document.getElementById('year-options');
    container.innerHTML = '';
    Object.keys(allSessionData).sort((a, b) => b - a).forEach(year => {
        const btn = document.createElement('button');
        btn.className = 'picker-btn';
        btn.textContent = year;
        btn.addEventListener('click', () => {
            document.querySelectorAll('#year-options .picker-btn').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            populateGPs(year);
        });
        container.appendChild(btn);
    });
}

function populateGPs(year) {
    document.getElementById('step-gp').classList.remove('disabled');
    document.getElementById('step-session').classList.add('disabled');
    document.getElementById('session-options').innerHTML = '<p class="picker-hint">Select a Grand Prix first</p>';

    const container = document.getElementById('gp-options');
    container.innerHTML = '';

    const meetings = allSessionData[year];
    Object.entries(meetings)
        .sort((a, b) => new Date(b[1][0].date_start) - new Date(a[1][0].date_start))
        .forEach(([meetingKey, sessions]) => {
            const first = sessions[0];
            const btn = document.createElement('button');
            btn.className = 'picker-btn';
            btn.textContent = `${first.country_name} — ${first.circuit_short_name}`;
            btn.addEventListener('click', () => {
                document.querySelectorAll('#gp-options .picker-btn').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
                populateSessions(year, meetingKey);
            });
            container.appendChild(btn);
        });
}

function populateSessions(year, meetingKey) {
    document.getElementById('step-session').classList.remove('disabled');
    const container = document.getElementById('session-options');
    container.innerHTML = '';

    const icons = { 'Race':'🏁', 'Qualifying':'⏱️', 'Sprint':'🏃', 'Sprint Qualifying':'⏱️',
        'Practice 1':'🔧', 'Practice 2':'🔧', 'Practice 3':'🔧', 'Sprint Shootout':'⏱️' };

    allSessionData[year][meetingKey]
        .sort((a, b) => new Date(a.date_start) - new Date(b.date_start))
        .forEach(s => {
            const btn = document.createElement('button');
            btn.className = 'picker-btn';
            btn.textContent = `${icons[s.session_name]||'📋'} ${s.session_name}`;
            btn.addEventListener('click', () => onSessionPicked(s.session_key));
            container.appendChild(btn);
        });
}

async function onSessionPicked(sessionKey) {
    document.getElementById('picker-loading').classList.remove('hidden');
    document.querySelectorAll('.picker-step').forEach(s => s.classList.add('disabled'));

    stopPlayback();
    state.locationsByDriver = {}; state.positions = []; state.intervals = [];
    state.laps = []; state.stints = []; state.weather = []; state.raceControl = [];
    state.currentTimestamp = null; state.selectedDriver = null;
    state.currentCarData = {}; carDataCache = {};
    state._lastStandingsUpdate = 0; state._lastWeatherUpdate = 0; state._lastRCUpdate = 0;

    await loadSessionData(sessionKey);
    updateLoading(100, 'Ready!');

    document.getElementById('app').classList.remove('hidden');
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    renderTrack();
    createDriverDots();
    state.currentTimestamp = state.sessionStartTime;
    fullUpdate(state.currentTimestamp);

    const picker = document.getElementById('session-picker');
    picker.style.removeProperty('opacity');
    picker.style.removeProperty('visibility');
    picker.style.removeProperty('pointer-events');
    picker.classList.add('fade-out');
}

// ═══════════════════════════════════════════════════════════════
// DATA LOADING
// ═══════════════════════════════════════════════════════════════

async function loadSessionData(sessionKey) {
    state.sessionKey = sessionKey;

    updateLoading(10, 'Loading session info...');
    const info = await fetchAPI('sessions', { session_key: sessionKey });
    const session = (info||[])[0];
    if (session) {
        state.meetingKey = session.meeting_key;
        state.circuitKey = session.circuit_key;
        state.sessionStartTime = parseTS(session.date_start);
        state.sessionEndTime = parseTS(session.date_end);
        const year = new Date(session.date_start).getFullYear();
        document.getElementById('session-name').textContent = `${session.country_name} Grand Prix ${year}`;
        document.getElementById('session-type').textContent = session.session_name;
        document.getElementById('circuit-name').textContent = session.circuit_short_name;
    }

    updateLoading(15, 'Loading circuit layout...');
    await loadCircuitShape();

    updateLoading(20, 'Loading drivers...');
    const drivers = await fetchAPI('drivers', { session_key: sessionKey });
    state.drivers = {};
    (drivers||[]).forEach(d => { state.drivers[d.driver_number] = d; });

    updateLoading(25, 'Loading positions...');
    state.positions = (await fetchAPI('position', { session_key: sessionKey })||[])
        .sort((a,b) => parseTS(a.date) - parseTS(b.date));

    updateLoading(30, 'Loading weather...');
    state.weather = await fetchAPI('weather', { session_key: sessionKey }) || [];

    updateLoading(35, 'Loading race control...');
    state.raceControl = await fetchAPI('race_control', { session_key: sessionKey }) || [];

    updateLoading(38, 'Loading stints...');
    state.stints = await fetchAPI('stints', { session_key: sessionKey }) || [];

    updateLoading(42, 'Loading intervals...');
    state.intervals = (await fetchAPI('intervals', { session_key: sessionKey })||[])
        .sort((a,b) => parseTS(a.date) - parseTS(b.date));

    updateLoading(46, 'Loading laps...');
    state.laps = (await fetchAPI('laps', { session_key: sessionKey })||[])
        .sort((a,b) => parseTS(a.date_start) - parseTS(b.date_start));

    updateLoading(50, 'Loading GPS data...');
    const nums = Object.keys(state.drivers);
    state.locationsByDriver = {};
    for (let i = 0; i < nums.length; i++) {
        const num = nums[i];
        const pct = 50 + Math.round((i / nums.length) * 40);
        updateLoading(pct, `GPS: ${state.drivers[num]?.name_acronym || num} (${i+1}/${nums.length})`);
        const locs = await fetchAPI('location', { session_key: sessionKey, driver_number: num });
        if (Array.isArray(locs) && locs.length > 0) {
            state.locationsByDriver[num] = locs.map(l => ({
                t: parseTS(l.date), x: l.x, y: l.y
            })).sort((a,b) => a.t - b.t);
        }
    }

    let minT = Infinity, maxT = -Infinity;
    Object.values(state.locationsByDriver).forEach(locs => {
        if (locs.length > 0) {
            minT = Math.min(minT, locs[0].t);
            maxT = Math.max(maxT, locs[locs.length - 1].t);
        }
    });
    if (minT < Infinity) { state.sessionStartTime = minT; state.sessionEndTime = maxT; }

    if (state.trackPath.length === 0) extractTrackFromGPS();

    const dur = (state.sessionEndTime - state.sessionStartTime) / 1000;
    document.getElementById('time-total').textContent = formatTime(dur);
    document.getElementById('time-current').textContent = '00:00';
    document.getElementById('timeline-slider').value = 0;
    updateLoading(95, 'Rendering...');
}

// ═══════════════════════════════════════════════════════════════
// CIRCUIT SHAPE
// ═══════════════════════════════════════════════════════════════

const MULTIVIEWER_API = 'https://api.multiviewer.app/api/v1/circuits';

async function loadCircuitShape() {
    state.trackPath = [];
    state.trackRotation = 0;
    if (!state.circuitKey) return;
    for (const year of [2025, 2024, 2023]) {
        try {
            const res = await fetch(`${MULTIVIEWER_API}/${state.circuitKey}/${year}`);
            if (!res.ok) continue;
            const data = await res.json();
            if (data && data.x && data.y && data.x.length > 20) {
                state.trackPath = data.x.map((x, i) => ({ x, y: data.y[i] }));
                state.trackRotation = data.rotation || 0;
                console.log(`✅ Circuit loaded: ${state.trackPath.length} pts (${year})`);
                return;
            }
        } catch (e) { /* try next */ }
    }
}

function extractTrackFromGPS() {
    const nums = Object.keys(state.locationsByDriver);
    if (nums.length === 0) return;
    let bestNum = nums[0], bestLen = 0;
    nums.forEach(n => { const len = state.locationsByDriver[n]?.length||0; if (len > bestLen) { bestLen = len; bestNum = n; } });
    const allPts = state.locationsByDriver[bestNum];
    if (!allPts || allPts.length < 50) return;
    const driverLaps = state.laps.filter(l => l.driver_number == bestNum && l.lap_duration && l.lap_duration < 200);
    let lapMs = 100000;
    if (driverLaps.length > 2) { const s = driverLaps.map(l => l.lap_duration).sort((a,b) => a-b); lapMs = s[Math.floor(s.length/2)] * 1000; }
    const si = Math.min(Math.floor(allPts.length * 0.1), 1000);
    const endT = allPts[si].t + lapMs * 1.05;
    const pts = [];
    for (let i = si; i < allPts.length && allPts[i].t <= endT; i++) pts.push({ x: allPts[i].x, y: allPts[i].y });
    if (pts.length > 20) { state.trackPath = pts; state.trackRotation = 0; }
}

// ═══════════════════════════════════════════════════════════════
// TRACK RENDERING
// ═══════════════════════════════════════════════════════════════

function renderTrack() {
    const canvas = document.getElementById('track-canvas');
    const ctx = canvas.getContext('2d');
    const container = document.getElementById('track-container');
    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
    ctx.scale(dpr, dpr);
    const W = rect.width, H = rect.height;
    ctx.clearRect(0, 0, W, H);

    if (state.trackPath.length < 10) {
        ctx.fillStyle = '#666'; ctx.font = '14px "Outfit", sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('Waiting for track data...', W/2, H/2);
        return;
    }

    const rotRad = (state.trackRotation || 0) * Math.PI / 180;
    const rawXs = state.trackPath.map(p => p.x), rawYs = state.trackPath.map(p => p.y);
    const rawCX = (Math.min(...rawXs) + Math.max(...rawXs)) / 2;
    const rawCY = (Math.min(...rawYs) + Math.max(...rawYs)) / 2;

    const rotated = state.trackPath.map(p => {
        const dx = p.x - rawCX, dy = p.y - rawCY;
        return { x: dx*Math.cos(rotRad) - dy*Math.sin(rotRad), y: dx*Math.sin(rotRad) + dy*Math.cos(rotRad) };
    });

    const rxs = rotated.map(p => p.x), rys = rotated.map(p => p.y);
    const rMinX = Math.min(...rxs), rMaxX = Math.max(...rxs);
    const rMinY = Math.min(...rys), rMaxY = Math.max(...rys);
    const rCX = (rMinX+rMaxX)/2, rCY = (rMinY+rMaxY)/2;
    const padding = 70;
    const scale = Math.min((W-2*padding)/(rMaxX-rMinX||1), (H-2*padding)/(rMaxY-rMinY||1));

    function tx(rawX, rawY) {
        const dx = rawX-rawCX, dy = rawY-rawCY;
        const rx = dx*Math.cos(rotRad) - dy*Math.sin(rotRad);
        const ry = dx*Math.sin(rotRad) + dy*Math.cos(rotRad);
        return { x: (rx-rCX)*scale + W/2, y: -(ry-rCY)*scale + H/2 };
    }
    state.transformFn = tx;

    const pts = state.trackPath.map(p => tx(p.x, p.y));
    function drawLine() { ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); for (let i=1;i<pts.length;i++) ctx.lineTo(pts[i].x, pts[i].y); ctx.closePath(); }

    drawLine(); ctx.strokeStyle='rgba(225,6,0,0.12)'; ctx.lineWidth=28; ctx.lineCap='round'; ctx.lineJoin='round'; ctx.stroke();
    drawLine(); ctx.strokeStyle='#2c2c3e'; ctx.lineWidth=18; ctx.stroke();
    drawLine(); ctx.strokeStyle='rgba(255,255,255,0.65)'; ctx.lineWidth=6; ctx.stroke();
    drawLine(); ctx.strokeStyle='#ffffff'; ctx.lineWidth=1.5; ctx.stroke();

    ctx.beginPath(); ctx.arc(pts[0].x, pts[0].y, 6, 0, Math.PI*2);
    ctx.fillStyle='#e10600'; ctx.fill(); ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.stroke();

    document.getElementById('track-overlay').querySelectorAll('.corner-number').forEach(el => el.remove());
}

// ═══════════════════════════════════════════════════════════════
// DRIVER DOTS
// ═══════════════════════════════════════════════════════════════

function createDriverDots() {
    const overlay = document.getElementById('track-overlay');
    overlay.querySelectorAll('.driver-dot').forEach(el => el.remove());
    state.driverDots = {};
    state._searchIdx = {};
    Object.entries(state.drivers).forEach(([num, driver]) => {
        const dot = document.createElement('div');
        dot.className = 'driver-dot';
        dot.id = `driver-dot-${num}`;
        const color = driver.team_colour || '888888';
        dot.style.backgroundColor = `#${color}`;
        dot.style.boxShadow = `0 0 10px rgba(${hexToRgb(color)}, 0.7)`;
        dot.style.willChange = 'transform';
        dot.innerHTML = `<span class="driver-dot-label">${driver.name_acronym||num}</span>${driver.name_acronym||''}`;
        dot.addEventListener('click', (e) => { e.stopPropagation(); selectDriver(parseInt(num)); });
        dot.style.display = 'none';
        overlay.appendChild(dot);
        state.driverDots[num] = dot;
        state._searchIdx[num] = 0;
    });
}

function getDriverLocAtTime(num, ts) {
    const locs = state.locationsByDriver[num];
    if (!locs || locs.length === 0) return null;
    let idx = state._searchIdx[num] || 0;
    if (idx > 0 && locs[idx].t > ts) idx = 0;
    while (idx < locs.length - 1 && locs[idx + 1].t <= ts) idx++;
    state._searchIdx[num] = idx;
    if (Math.abs(locs[idx].t - ts) > 60000) return null;
    if (idx < locs.length - 1) {
        const a = locs[idx], b = locs[idx + 1], dt = b.t - a.t;
        if (dt > 0 && ts >= a.t && ts <= b.t) {
            const f = (ts - a.t) / dt;
            return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
        }
    }
    return locs[idx];
}

function updateDriverDots(ts) {
    if (!state.transformFn) return;
    const nums = Object.keys(state.drivers);
    for (let i = 0; i < nums.length; i++) {
        const num = nums[i], loc = getDriverLocAtTime(num, ts), dot = state.driverDots[num];
        if (!dot) continue;
        if (loc) { const p = state.transformFn(loc.x, loc.y); dot.style.display = 'flex'; dot.style.transform = `translate(${p.x}px, ${p.y}px)`; }
        else dot.style.display = 'none';
    }
}

// ═══════════════════════════════════════════════════════════════
// STANDINGS
// ═══════════════════════════════════════════════════════════════

function updateStandings(ts) {
    const pos = {};
    for (const p of state.positions) { if (parseTS(p.date) <= ts) pos[p.driver_number] = p.position; }
    state.currentIntervals = {};
    for (const iv of state.intervals) { if (parseTS(iv.date) <= ts) state.currentIntervals[iv.driver_number] = { interval: iv.interval, gap_to_leader: iv.gap_to_leader }; }
    state.currentLaps = {};
    for (const l of state.laps) { if (parseTS(l.date_start) <= ts) state.currentLaps[l.driver_number] = l; }
    state.currentStints = {};
    for (const s of state.stints) {
        const dl = state.currentLaps[s.driver_number];
        if (dl) { const cl = dl.lap_number||0; if (cl >= s.lap_start && (cl <= s.lap_end || !s.lap_end)) state.currentStints[s.driver_number] = s; }
    }

    const standings = Object.keys(state.drivers).map(n => ({ num: parseInt(n), pos: pos[n]||99, driver: state.drivers[n] })).sort((a,b) => a.pos - b.pos);
    state.currentStandings = standings;

    const maxLap = Math.max(0, ...Object.values(state.currentLaps).map(l => l.lap_number||0));
    document.getElementById('current-lap').textContent = maxLap || '—';
    const totalLaps = Math.max(0, ...state.laps.map(l => l.lap_number||0));
    document.getElementById('total-laps').textContent = totalLaps || '—';

    renderStandings(standings);
}

function renderStandings(standings) {
    const c = document.getElementById('standings-list');
    c.innerHTML = '';
    standings.forEach(({ num, pos, driver }) => {
        if (!driver) return;
        const row = document.createElement('div');
        row.className = 'standing-row'; row.id = `standing-${num}`;
        if (state.selectedDriver === num) row.classList.add('selected');
        const tc = driver.team_colour||'888', iv = state.currentIntervals[num], lap = state.currentLaps[num], stint = state.currentStints[num];
        const pc = pos <= 3 ? `p${pos}` : '';
        let ivText = '—';
        if (iv) ivText = pos === 1 ? formatInterval(iv.gap_to_leader) : formatInterval(iv.interval);
        let tire = '';
        if (stint?.compound) tire = `<span class="tire-badge ${stint.compound}">${stint.compound[0]}</span>`;
        row.innerHTML = `
            <span class="position-badge ${pc}">${pos}</span>
            <div class="team-color-bar" style="background-color:#${tc}"></div>
            <div class="driver-info">
                <span class="driver-name">${driver.name_acronym||driver.last_name}${tire}</span>
                <span class="driver-team">${driver.team_name||''}</span>
            </div>
            <div class="driver-timing">
                <span class="interval-time ${pos===1?'leader':''}">${ivText}</span>
                <span class="last-lap">${lap ? formatLapTime(lap.lap_duration) : '—'}</span>
            </div>`;
        row.addEventListener('click', () => selectDriver(num));
        c.appendChild(row);
    });
}

// ═══════════════════════════════════════════════════════════════
// DRIVER SELECTION + TELEMETRY
// ═══════════════════════════════════════════════════════════════

function selectDriver(num) {
    state.selectedDriver = state.selectedDriver === num ? null : num;
    Object.entries(state.driverDots).forEach(([n, dot]) => dot.classList.toggle('selected', parseInt(n) === state.selectedDriver));
    document.querySelectorAll('.standing-row').forEach(r => r.classList.remove('selected'));
    if (state.selectedDriver) {
        const r = document.getElementById(`standing-${state.selectedDriver}`);
        if (r) r.classList.add('selected');
        if (!carDataCache[state.selectedDriver]) loadCarDataForDriver(state.selectedDriver);
    }
    updateTelemetryPanel();
}

function updateTelemetryPanel() {
    const el = document.getElementById('driver-focus');
    if (!state.selectedDriver) { el.innerHTML = '<p class="no-selection">Click a driver to view telemetry</p>'; return; }
    const d = state.drivers[state.selectedDriver];
    if (!d) return;
    const tc = d.team_colour||'888', lap = state.currentLaps[state.selectedDriver], stint = state.currentStints[state.selectedDriver], cd = state.currentCarData[state.selectedDriver];
    el.innerHTML = `
        <div class="driver-focus-header">
            <div class="focus-color-bar" style="background-color:#${tc}"></div>
            <div>
                <div class="focus-driver-name" style="color:#${tc}">${d.full_name||d.broadcast_name||d.name_acronym}</div>
                <div class="focus-driver-team">${d.team_name||''} · #${d.driver_number}</div>
            </div>
        </div>
        <div class="telemetry-grid">
            <div class="telemetry-item"><span class="telemetry-label">Speed</span><span class="telemetry-value speed">${cd?cd.speed+' km/h':'—'}</span></div>
            <div class="telemetry-item"><span class="telemetry-label">Gear</span><span class="telemetry-value gear">${cd?cd.n_gear:'—'}</span></div>
            <div class="telemetry-item"><span class="telemetry-label">RPM</span><span class="telemetry-value">${cd?cd.rpm?.toLocaleString():'—'}</span></div>
            <div class="telemetry-item"><span class="telemetry-label">DRS</span><span class="telemetry-value">${cd?(cd.drs>=10?'OPEN':'CLOSED'):'—'}</span></div>
            <div class="telemetry-item"><span class="telemetry-label">Last Lap</span><span class="telemetry-value">${lap?formatLapTime(lap.lap_duration):'—'}</span></div>
            <div class="telemetry-item"><span class="telemetry-label">Tire</span><span class="telemetry-value">${stint?stint.compound:'—'}</span></div>
        </div>
        ${cd ? `
        <div class="speed-bar-container">
            <div class="speed-bar-label">Throttle ${cd.throttle}%</div>
            <div class="speed-bar"><div class="speed-bar-fill throttle-bar" style="width:${cd.throttle}%"></div></div>
        </div>
        <div class="speed-bar-container" style="margin-top:6px">
            <div class="speed-bar-label">Brake ${cd.brake}%</div>
            <div class="speed-bar"><div class="speed-bar-fill brake-bar" style="width:${cd.brake}%"></div></div>
        </div>` : ''}`;
}

// ═══════════════════════════════════════════════════════════════
// CAR DATA
// ═══════════════════════════════════════════════════════════════

let carDataCache = {};

async function loadCarDataForDriver(num) {
    if (carDataCache[num]) return;
    try {
        const data = await fetchAPI('car_data', { session_key: state.sessionKey, driver_number: num });
        if (Array.isArray(data) && data.length > 0) carDataCache[num] = data.map(d => ({ ...d, _t: parseTS(d.date) })).sort((a,b) => a._t - b._t);
    } catch(e) { console.warn('Car data error:', e); }
}

function updateCarData(ts) {
    if (!state.selectedDriver) return;
    const data = carDataCache[state.selectedDriver];
    if (!data?.length) return;
    let lo=0, hi=data.length-1, best=null;
    while (lo<=hi) { const mid=(lo+hi)>>1; if (data[mid]._t<=ts) { best=data[mid]; lo=mid+1; } else hi=mid-1; }
    if (best) state.currentCarData[state.selectedDriver] = best;
}

// ═══════════════════════════════════════════════════════════════
// WEATHER + RACE CONTROL
// ═══════════════════════════════════════════════════════════════

function updateWeather(ts) {
    let w = null;
    for (const wi of state.weather) { if (parseTS(wi.date) <= ts) w = wi; }
    if (w) {
        document.getElementById('w-air').textContent = `${w.air_temperature??'—'}°C`;
        document.getElementById('w-track').textContent = `${w.track_temperature??'—'}°C`;
        document.getElementById('w-humidity').textContent = `${w.humidity??'—'}%`;
        document.getElementById('w-wind').textContent = `${w.wind_speed??'—'} km/h`;
        document.getElementById('w-rain').textContent = w.rainfall ? 'Yes 🌧️' : 'No ☀️';
        document.getElementById('w-pressure').textContent = `${w.pressure??'—'} hPa`;
    }
}

function updateRaceControl(ts) {
    const feed = document.getElementById('race-control-feed');
    const msgs = state.raceControl.filter(rc => parseTS(rc.date) <= ts).slice(-15).reverse();
    if (msgs.length === 0) { feed.innerHTML = '<p class="no-messages">No messages yet</p>'; return; }
    feed.innerHTML = msgs.map(rc => {
        const fc = rc.flag ? `flag-${rc.flag.replace(/ /g,'_')}` : '';
        const sc = rc.category === 'SafetyCar' ? 'flag-safety-car' : '';
        const t = new Date(rc.date).toLocaleTimeString('en-US', { hour12: false });
        return `<div class="rc-message ${fc} ${sc}"><div class="rc-time">${t}</div><div class="rc-text">${rc.message||rc.category||''}</div></div>`;
    }).join('');
}

// ═══════════════════════════════════════════════════════════════
// PLAYBACK
// ═══════════════════════════════════════════════════════════════

let playRAF = null, lastFrame = 0;

function startPlayback() {
    state.isPlaying = true;
    document.getElementById('play-icon').textContent = '⏸';
    lastFrame = performance.now();
    tick();
}

function stopPlayback() {
    state.isPlaying = false;
    document.getElementById('play-icon').textContent = '▶';
    if (playRAF) cancelAnimationFrame(playRAF);
}

function tick() {
    if (!state.isPlaying) return;
    const now = performance.now(), dt = now - lastFrame;
    lastFrame = now;
    const advance = dt * state.playbackSpeed;
    const cur = state.currentTimestamp || state.sessionStartTime;
    const next = cur + advance;
    if (next >= state.sessionEndTime) { state.currentTimestamp = state.sessionEndTime; stopPlayback(); fullUpdate(state.currentTimestamp); return; }
    state.currentTimestamp = next;
    const progress = (next - state.sessionStartTime) / (state.sessionEndTime - state.sessionStartTime);
    document.getElementById('timeline-slider').value = progress * 100;
    document.getElementById('time-current').textContent = formatTime((next - state.sessionStartTime) / 1000);
    updateDriverDots(next);
    if (next - state._lastStandingsUpdate > 3000) { updateStandings(next); state._lastStandingsUpdate = next; }
    if (next - state._lastWeatherUpdate > 15000) { updateWeather(next); state._lastWeatherUpdate = next; }
    if (next - state._lastRCUpdate > 4000) { updateRaceControl(next); state._lastRCUpdate = next; }
    if (state.selectedDriver) { updateCarData(next); updateTelemetryPanel(); }
    playRAF = requestAnimationFrame(tick);
}

function fullUpdate(ts) {
    updateDriverDots(ts); updateStandings(ts); updateWeather(ts); updateRaceControl(ts);
    if (state.selectedDriver) { updateCarData(ts); updateTelemetryPanel(); }
    state._lastStandingsUpdate = ts; state._lastWeatherUpdate = ts; state._lastRCUpdate = ts;
}

// ═══════════════════════════════════════════════════════════════
// EVENTS
// ═══════════════════════════════════════════════════════════════

function setupEvents() {
    document.getElementById('play-btn').addEventListener('click', () => {
        if (state.isPlaying) { stopPlayback(); return; }
        if (!state.currentTimestamp || state.currentTimestamp >= state.sessionEndTime) state.currentTimestamp = state.sessionStartTime;
        startPlayback();
    });

    document.getElementById('timeline-slider').addEventListener('input', (e) => {
        if (state.isPlaying) stopPlayback();
        const p = e.target.value / 100;
        const ts = state.sessionStartTime + p * (state.sessionEndTime - state.sessionStartTime);
        state.currentTimestamp = ts;
        document.getElementById('time-current').textContent = formatTime((ts - state.sessionStartTime) / 1000);
        fullUpdate(ts);
    });

    const speeds = [1, 2, 5, 10, 20, 50];
    let si = 0;
    document.getElementById('speed-btn').addEventListener('click', () => {
        si = (si + 1) % speeds.length;
        state.playbackSpeed = speeds[si];
        document.getElementById('speed-btn').textContent = `${speeds[si]}x`;
    });

    document.getElementById('change-session-btn').addEventListener('click', () => { stopPlayback(); showPicker(); });

    window.addEventListener('resize', () => { renderTrack(); if (state.currentTimestamp) updateDriverDots(state.currentTimestamp); });

    document.addEventListener('keydown', (e) => {
        if (!document.getElementById('session-picker').classList.contains('fade-out')) return;
        if (e.code === 'Space') { e.preventDefault(); document.getElementById('play-btn').click(); }
        const sl = document.getElementById('timeline-slider');
        if (e.code === 'ArrowRight') { sl.value = Math.min(+sl.value + 1, 100); sl.dispatchEvent(new Event('input')); }
        if (e.code === 'ArrowLeft') { sl.value = Math.max(+sl.value - 1, 0); sl.dispatchEvent(new Event('input')); }
    });
}

// ═══════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════

async function init() {
    setupEvents();
    updateLoading(5, 'Fetching sessions...');
    allSessionData = await loadAllSessions();
    populateYears();
    document.getElementById('picker-loading').classList.add('hidden');
}

document.addEventListener('DOMContentLoaded', init);
