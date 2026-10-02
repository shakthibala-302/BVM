const modeConfig = window.BVM_MODE_CONFIG;
const conversionFactor = 10.197;
const socket = io();
const chartCanvas = document.getElementById('pressure-chart');
const chartContext = chartCanvas.getContext('2d');
const stateColors = {
  IDLE: '#9baeb0',
  COMPRESS: '#f09a5b',
  RELEASE: '#6bd9e0',
  STOPPED: '#ff7b80'
};

let selectedUnit = 'kPa';
let latestSample = null;
let recording = false;
let recordingSamples = [];
let activeCycle = null;
let completedCycles = [];
let compressionStartTimes = [];
let lastSampleAt = null;
const pageStartedAt = Date.now();
let latestAlarm = false;

const pressureChart = new Chart(chartContext, {
  type: 'line',
  data: {
    datasets: [
      {
        label: 'Pressure',
        data: [],
        borderColor: '#43cbd4',
        backgroundColor: 'rgba(67, 203, 212, .13)',
        borderWidth: 2.5,
        pointRadius: 0,
        pointHitRadius: 8,
        tension: .22,
        fill: true
      },
      {
        label: 'Set pressure limit',
        data: [],
        borderColor: '#f0a45c',
        borderWidth: 1.5,
        borderDash: [6, 5],
        pointRadius: 0,
        tension: 0,
        fill: false
      }
    ]
  },
  options: {
    animation: false,
    maintainAspectRatio: false,
    interaction: { intersect: false, mode: 'nearest' },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#17251f',
        titleFont: { family: "'DM Mono', monospace", size: 10 },
        bodyFont: { family: "'DM Mono', monospace", size: 11 },
        callbacks: {
          title: items => `${items[0].parsed.x.toFixed(1)} s`,
          label: item => `${item.dataset.label}: ${item.parsed.y.toFixed(2)} ${selectedUnit}`
        }
      }
    },
    scales: {
      x: {
        type: 'linear', min: -30, max: 0,
        grid: { color: 'rgba(205, 226, 211, .12)', drawTicks: false },
        border: { display: false },
        ticks: {
          color: '#9aa99f', stepSize: 5, padding: 8, font: { family: "'DM Mono', monospace", size: 10 },
          callback: value => `${value}s`
        },
        title: { display: true, text: 'Seconds from now', color: '#9aa99f', font: { family: "'DM Sans', sans-serif", size: 10 } }
      },
      y: {
        beginAtZero: true,
        grid: { color: 'rgba(205, 226, 211, .12)', drawTicks: false },
        border: { display: false },
        ticks: { color: '#9aa99f', padding: 8, font: { family: "'DM Mono', monospace", size: 10 } },
        title: { display: true, text: 'Pressure (kPa)', color: '#9aa99f', font: { family: "'DM Sans', sans-serif", size: 10 } }
      }
    }
  }
});

function pressureInUnit(kpa) {
  return selectedUnit === 'kPa' ? kpa : kpa * conversionFactor;
}

function pressureText(kpa) {
  return Number.isFinite(kpa) ? pressureInUnit(kpa).toFixed(2) : '--.-';
}

function currentLimit() {
  const mode = latestSample?.mode;
  return modeConfig[mode]?.pressure_limit_kpa ?? 0;
}

function updateModeParameters(mode) {
  const config = modeConfig[mode];
  if (!config) return;
  const unitLabel = selectedUnit === 'kPa' ? 'kPa' : 'cmH₂O';
  document.getElementById('mode-name').textContent = config.label;
  document.getElementById('mode-limit').textContent = `${pressureInUnit(config.pressure_limit_kpa).toFixed(2)} ${unitLabel}`;
  document.getElementById('mode-compression').textContent = `${config.compression_time_s.toFixed(1)} s`;
  document.getElementById('mode-rate').textContent = `${config.rate_per_min} /min`;
}

function updateUnitLabels() {
  const label = selectedUnit === 'kPa' ? 'kPa' : 'cmH₂O';
  document.getElementById('pressure-unit').textContent = label;
  document.getElementById('peak-unit').textContent = label;
  document.querySelectorAll('.unit-button').forEach(button => {
    const active = button.dataset.unit === selectedUnit;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  updateModeParameters(latestSample?.mode);
  renderCycleTable();
  if (latestSample) document.getElementById('current-pressure').textContent = pressureText(latestSample.p_kpa);
  if (completedCycles.length) {
    document.getElementById('peak-pressure').textContent = pressureText(completedCycles[0].peakKpa);
  }
  renderChart();
}

function cycleStarted(sample, receivedAt) {
  return {
    cycle: sample.cycle,
    peakKpa: sample.p_kpa,
    compressionStartedAt: null,
    compressionMs: null,
    completed: false
  };
}

function finishCycle(cycle, receivedAt) {
  if (!cycle || cycle.completed) return;
  cycle.completed = true;
  if (cycle.compressionStartedAt === null) return;
  if (cycle.compressionStartedAt !== null && cycle.compressionMs === null) {
    cycle.compressionMs = Math.max(0, receivedAt - cycle.compressionStartedAt);
  }
  completedCycles.unshift(cycle);
  completedCycles = completedCycles.slice(0, 20);
  document.getElementById('peak-pressure').textContent = pressureText(cycle.peakKpa);
  renderCycleTable();
  updateCycleRate(receivedAt);
}

function updateCycleRate(now) {
  compressionStartTimes = compressionStartTimes.filter(timestamp => now - timestamp <= 60000);
  if (compressionStartTimes.length < 2) {
    document.getElementById('cycle-rate').textContent = '--';
    return;
  }
  const elapsed = compressionStartTimes.at(-1) - compressionStartTimes[0];
  const rate = elapsed > 0 ? Math.round((compressionStartTimes.length - 1) * 60000 / elapsed) : 0;
  document.getElementById('cycle-rate').textContent = rate.toString();
}

function renderCycleTable() {
  const body = document.getElementById('cycle-rows');
  if (!completedCycles.length) {
    body.innerHTML = '<tr class="empty-row"><td colspan="3">Cycle data will appear after the first compression.</td></tr>';
    document.getElementById('peak-spread').textContent = '--';
    return;
  }

  body.innerHTML = completedCycles.map(cycle => {
    const peak = `${pressureText(cycle.peakKpa)} ${selectedUnit}`;
    const duration = cycle.compressionMs === null ? '--' : `${(cycle.compressionMs / 1000).toFixed(2)} s`;
    return `<tr><td>${cycle.cycle}</td><td>${peak}</td><td>${duration}</td></tr>`;
  }).join('');
  const peaks = completedCycles.map(cycle => pressureInUnit(cycle.peakKpa));
  if (peaks.length < 2) {
    document.getElementById('peak-spread').textContent = '--';
  } else {
    const spread = Math.max(...peaks) - Math.min(...peaks);
    document.getElementById('peak-spread').textContent = `${spread.toFixed(2)} ${selectedUnit}`;
  }
}

function updateChartLimit() {
  const limit = pressureInUnit(currentLimit());
  pressureChart.data.datasets[1].data = [{ x: -30, y: limit }, { x: 0, y: limit }];
  pressureChart.options.scales.y.title.text = `Pressure (${selectedUnit})`;
  const current = latestSample ? pressureInUnit(latestSample.p_kpa) : 0;
  pressureChart.options.scales.y.max = Math.max(limit * 1.3, current * 1.15, 0.5);
}

function renderChart() {
  const now = Date.now();
  pressureChart.data.datasets[0].data = pressureChart.data.datasets[0].data
    .filter(point => now - point.receivedAt <= 30000)
    .map(point => ({ x: (point.receivedAt - now) / 1000, y: pressureInUnit(point.rawKpa), receivedAt: point.receivedAt }));
  updateChartLimit();
  pressureChart.update('none');
}

function renderAlarm(sample) {
  const overLimit = sample.p_kpa > currentLimit();
  latestAlarm = sample.limit_hit || overLimit;
  const banner = document.getElementById('alarm-banner');
  banner.hidden = !latestAlarm;
  if (latestAlarm) {
    document.getElementById('alarm-message').textContent = sample.limit_hit
      ? `Controller limit-hit flag is active. Pressure: ${pressureText(sample.p_kpa)} ${selectedUnit}.`
      : `Pressure is above the ${pressureText(currentLimit())} ${selectedUnit} mode limit.`;
  }
}

function onSample(sample) {
  const receivedAt = Date.now();
  if (activeCycle && sample.cycle !== activeCycle.cycle) finishCycle(activeCycle, receivedAt);
  if (!activeCycle || sample.cycle !== activeCycle.cycle) activeCycle = cycleStarted(sample, receivedAt);
  activeCycle.peakKpa = Math.max(activeCycle.peakKpa, sample.p_kpa);

  if (sample.state === 'COMPRESS' && activeCycle.compressionStartedAt === null) {
    activeCycle.compressionStartedAt = receivedAt;
    compressionStartTimes.push(receivedAt);
  }
  if (sample.state !== 'COMPRESS' && activeCycle.compressionStartedAt !== null && activeCycle.compressionMs === null) {
    activeCycle.compressionMs = Math.max(0, receivedAt - activeCycle.compressionStartedAt);
    finishCycle(activeCycle, receivedAt);
  }

  latestSample = sample;
  lastSampleAt = receivedAt;
  document.getElementById('connection-label').textContent = window.BVM_SIMULATED ? 'SIMULATION STREAM' : 'SERIAL STREAM';
  document.getElementById('connection-badge').classList.add('connected');
  document.getElementById('current-pressure').textContent = pressureText(sample.p_kpa);
  document.getElementById('total-cycles').textContent = sample.cycle.toString();
  document.getElementById('current-state').textContent = sample.state;
  document.getElementById('current-mode').textContent = modeConfig[sample.mode].label;
  document.getElementById('reading-status').textContent = `Sample ${Math.round(sample.t)} ms · cycle ${sample.cycle}`;
  document.getElementById('state-indicator').className = `state-indicator ${sample.state.toLowerCase()}`;
  updateModeParameters(sample.mode);
  renderAlarm(sample);

  pressureChart.data.datasets[0].data.push({ x: 0, y: pressureInUnit(sample.p_kpa), rawKpa: sample.p_kpa, receivedAt });
  if (recording) {
    recordingSamples.push({ timestamp: sample.t, pressure: sample.p_kpa, state: sample.state, cycle: sample.cycle, mode: sample.mode });
    document.getElementById('recording-count').textContent = `${recordingSamples.length.toLocaleString()} samples captured`;
    document.getElementById('download-button').disabled = false;
  }
  updateCycleRate(receivedAt);
  renderChart();
}

function updateConnectionStatus() {
  document.getElementById('header-clock').textContent = new Date().toLocaleTimeString([], { hour12: false });
  const stale = lastSampleAt === null
    ? Date.now() - pageStartedAt >= 2000
    : Date.now() - lastSampleAt >= 2000;
  document.getElementById('stale-banner').hidden = !stale;
  if (stale) {
    document.getElementById('connection-badge').classList.remove('connected');
    document.getElementById('connection-label').textContent = window.BVM_SIMULATED ? 'SIMULATION WAITING' : 'WAITING FOR DATA';
  }
  if (latestSample && lastSampleAt !== null && Date.now() - lastSampleAt > 2000) {
    document.getElementById('alarm-banner').hidden = true;
  }
  if (pressureChart.data.datasets[0].data.length) renderChart();
}

function setRecording(nextState) {
  recording = nextState;
  const button = document.getElementById('record-button');
  const indicator = document.getElementById('record-indicator');
  button.classList.toggle('is-recording', recording);
  indicator.classList.toggle('recording', recording);
  document.getElementById('recording-state').textContent = recording ? 'Recording' : 'Recording off';
  button.innerHTML = recording
    ? '<span class="button-icon" aria-hidden="true">■</span>Stop recording'
    : '<span class="button-icon" aria-hidden="true">●</span>Start recording';
  if (!recording) {
    document.getElementById('recording-count').textContent = `${recordingSamples.length.toLocaleString()} samples captured`;
  } else {
    recordingSamples = [];
    document.getElementById('recording-count').textContent = '0 samples captured';
    document.getElementById('download-button').disabled = true;
  }
}

function downloadCsv() {
  if (!recordingSamples.length) return;
  const quote = value => `"${String(value).replaceAll('"', '""')}"`;
  const rows = [
    ['timestamp_ms', 'pressure_kpa', 'state', 'cycle', 'mode'],
    ...recordingSamples.map(sample => [sample.timestamp, sample.pressure, sample.state, sample.cycle, sample.mode])
  ];
  const csv = rows.map(row => row.map(quote).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `bvm-recording-${new Date().toISOString().replaceAll(':', '-')}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

document.querySelectorAll('.unit-button').forEach(button => {
  button.addEventListener('click', () => {
    selectedUnit = button.dataset.unit;
    updateUnitLabels();
    if (latestSample) renderAlarm(latestSample);
  });
});
document.getElementById('record-button').addEventListener('click', () => setRecording(!recording));
document.getElementById('download-button').addEventListener('click', downloadCsv);
socket.on('sample', onSample);
socket.on('connect', () => {
  if (lastSampleAt === null) document.getElementById('connection-label').textContent = window.BVM_SIMULATED ? 'SIMULATION WAITING' : 'CONNECTED · NO SAMPLE';
});
socket.on('disconnect', () => {
  document.getElementById('connection-label').textContent = 'SERVER DISCONNECTED';
  document.getElementById('connection-badge').classList.remove('connected');
});
setInterval(updateConnectionStatus, 250);
updateConnectionStatus();
