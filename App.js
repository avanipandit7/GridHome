import { useCallback, useEffect, useMemo, useState } from 'react';
import './App.css';

const API_BASE = process.env.REACT_APP_API_BASE || '/api';
const NAV_ITEMS = ['Dashboard', 'Devices', 'Zones', 'Data & Charts', 'Alerts', 'Billing'];

const parseErrorResponse = async (response, fallbackMessage) => {
  const contentType = response.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    const data = await response.json();
    return data.error || data.message || fallbackMessage;
  }

  const text = await response.text();
  if (!text) {
    return fallbackMessage;
  }
  return text.length > 200 ? `${fallbackMessage} ${text.slice(0, 200)}` : text;
};

const getLocalDateTimeInput = () => {
  const now = new Date();
  const tzOffsetMs = now.getTimezoneOffset() * 60000;
  const local = new Date(now.getTime() - tzOffsetMs);
  return local.toISOString().slice(0, 16);
};

// main entry form state removed (not used in current UI)

const initialDeviceForm = {
  name: '',
  zone: '',
  watts: 0,
  status: 'Low',
  readingTime: '',
  sourceType: 'Device'
};

const COMMON_ZONES = ['Kitchen', 'Living Room', 'Bathroom', 'Bedroom', 'Hall', 'Office'];
const ZONE_PALETTE = ['#5b60e6', '#ff8a3d', '#2db16a', '#e4578b', '#14b8a6', '#f2b134', '#7c5ce5', '#f97316'];

const nextBillingDueDate = () => {
  const due = new Date();
  due.setMonth(due.getMonth() + 1, 5);
  return due.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

const buildZoneSummary = (rows) => {
  const zoneMap = new Map();

  rows.forEach((item) => {
    const zone = item.location?.trim() || 'Unassigned';
    zoneMap.set(zone, (zoneMap.get(zone) || 0) + item.unitsConsumed);
  });

  const totalKwh = Array.from(zoneMap.values()).reduce((sum, value) => sum + value, 0);
  return Array.from(zoneMap.entries())
    .map(([zone, kwh], index) => ({
      zone,
      kwh,
      percentage: totalKwh ? (kwh / totalKwh) * 100 : 0,
      color: ZONE_PALETTE[index % ZONE_PALETTE.length]
    }))
    .sort((a, b) => b.kwh - a.kwh);
};

const buildBillingSummary = (rows) => {
  const peakRows = rows.filter((row) => row.peakHour);
  const offPeakRows = rows.filter((row) => !row.peakHour);

  const peakUnits = peakRows.reduce((sum, row) => sum + row.unitsConsumed, 0);
  const offPeakUnits = offPeakRows.reduce((sum, row) => sum + row.unitsConsumed, 0);
  const peakCost = peakRows.reduce((sum, row) => sum + row.totalCost, 0);
  const offPeakCost = offPeakRows.reduce((sum, row) => sum + row.totalCost, 0);

  return {
    totalDue: peakCost + offPeakCost,
    dueDate: nextBillingDueDate(),
    peakUnits,
    offPeakUnits,
    peakCost,
    offPeakCost,
    peakShare: peakCost + offPeakCost ? (peakCost / (peakCost + offPeakCost)) * 100 : 0,
    offPeakShare: peakCost + offPeakCost ? (offPeakCost / (peakCost + offPeakCost)) * 100 : 0
  };
};

const buildAlertFeed = (rows) => {
  const severityWeight = {
    critical: 3,
    warning: 2,
    info: 1
  };

  const queue = rows
    .slice()
    .sort((a, b) => new Date(b.readingTime) - new Date(a.readingTime))
    .map((item) => {
      const severity = item.peakHour || item.unitsConsumed >= 10 ? 'critical' : item.unitsConsumed >= 6 ? 'warning' : 'info';
      const message = severity === 'critical'
        ? `${item.notes || item.sourceType} in ${item.location} is under peak load.`
        : severity === 'warning'
          ? `${item.notes || item.sourceType} in ${item.location} is trending high.`
          : `${item.notes || item.sourceType} in ${item.location} is being monitored.`;

      return {
        id: `${item.id}-${severity}`,
        entryId: item.id,
        severity,
        message,
        location: item.location,
        readingTime: item.readingTime,
        timestamp: new Date(item.readingTime).toLocaleString(),
        acknowledged: false,
        severityWeight: severityWeight[severity]
      };
    });

  return queue.sort((a, b) => b.severityWeight - a.severityWeight || new Date(b.readingTime) - new Date(a.readingTime));
};

const build24hChart = (rows) => {
  const hourMs = 60 * 60 * 1000;
  const now = new Date();
  const start = new Date(now.getTime() - 23 * hourMs);
  const consumption = Array(24).fill(0);
  const solar = Array(24).fill(0);

  rows.forEach((entry) => {
    const entryTime = new Date(entry.readingTime);
    const diff = entryTime.getTime() - start.getTime();
    const bucket = Math.floor(diff / hourMs);

    if (bucket >= 0 && bucket < 24) {
      consumption[bucket] += entry.unitsConsumed;
      if (entry.sourceType?.toLowerCase().includes('solar')) {
        solar[bucket] += entry.unitsConsumed;
      }
    }
  });

  const maxValue = Math.max(1, ...consumption, ...solar);
  const xStart = 12;
  const xEnd = 288;
  const yTop = 18;
  const yBottom = 150;
  const stepX = (xEnd - xStart) / 23;

  const toPoint = (values) =>
    values
      .map((value, index) => {
        const x = xStart + stepX * index;
        const y = yBottom - (value / maxValue) * (yBottom - yTop);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');

  return {
    consumptionPoints: toPoint(consumption),
    solarPoints: toPoint(solar),
    maxValue,
    consumption,
    solar
  };
};

function App() {
  const [activeTab, setActiveTab] = useState('Dashboard');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [entries, setEntries] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // form state removed; main entry UI not present
  const [deviceForm, setDeviceForm] = useState(initialDeviceForm);
  const [editingDeviceId, setEditingDeviceId] = useState(null);
  const [alertStateMap, setAlertStateMap] = useState({});

  const summary = useMemo(() => {
    const totalUnits = entries.reduce((sum, row) => sum + row.unitsConsumed, 0);
    const totalCost = entries.reduce((sum, row) => sum + row.totalCost, 0);
    const peakCount = entries.filter((row) => row.peakHour).length;

    const todayStamp = new Date().toISOString().slice(0, 10);
    const todayEntries = entries.filter((item) => item.readingTime.startsWith(todayStamp));
    const todayUsage = todayEntries.reduce((sum, row) => sum + row.unitsConsumed, 0);
    const todayCost = todayEntries.reduce((sum, row) => sum + row.totalCost, 0);
    const solarGenerated = todayEntries
      .filter((item) => item.sourceType.toLowerCase().includes('solar'))
      .reduce((sum, row) => sum + row.unitsConsumed, 0);

    const latest = entries[0];
    const currentDraw = latest ? Math.max(0.3, latest.unitsConsumed / 2.4) : 0;

    return {
      totalUnits,
      totalCost,
      peakCount,
      currentDraw,
      todayUsage,
      todayCost,
      solarGenerated
    };
  }, [entries]);

  const devices = useMemo(() => {
    return entries.map((item) => {
      const status = item.peakHour ? 'High' : item.unitsConsumed >= 8 ? 'Med' : 'Low';
      return {
        id: item.id,
        name: item.notes?.trim() || `${item.sourceType} Unit`,
        zone: item.location,
        watts: Math.round(item.unitsConsumed * 150),
        status,
        kwh: item.unitsConsumed,
        totalCost: item.totalCost,
        readingTime: item.readingTime,
        sourceType: item.sourceType
      };
    });
  }, [entries]);

  const zoneRows = useMemo(() => buildZoneSummary(entries), [entries]);

  const billingSummary = useMemo(() => buildBillingSummary(entries), [entries]);

  const liveAlerts = useMemo(() => {
    const feed = buildAlertFeed(entries);
    return feed.filter((alert) => !alertStateMap[alert.id]?.dismissed);
  }, [alertStateMap, entries]);

  const alerts = useMemo(() => {
    const live = liveAlerts.map((alert) => ({
      ...alert,
      acknowledged: Boolean(alertStateMap[alert.id]?.acknowledged)
    }));

    if (live.length === 0) {
      return [
        {
          id: 'ok-1',
          severity: 'info',
          message: 'No active alerts right now. All monitored zones are stable.',
          timestamp: 'Updated now',
          location: 'System',
          acknowledged: false
        }
      ];
    }

    return live;
  }, [alertStateMap, liveAlerts]);

  const chartDistribution = useMemo(() => {
    const topDevices = devices.slice(0, 5);
    const total = topDevices.reduce((sum, item) => sum + item.kwh, 0);
    return topDevices.map((item, index) => ({
      ...item,
      color: ZONE_PALETTE[index % ZONE_PALETTE.length],
      percentage: total ? (item.kwh / total) * 100 : 0
    }));
  }, [devices]);

  const chart24h = useMemo(() => build24hChart(entries), [entries]);

  const visibleZones = useMemo(() => {
    const zones = zoneRows.map((zone) => zone.zone);
    const fallback = COMMON_ZONES.filter((zone) => !zones.includes(zone));
    return [...zones, ...fallback];
  }, [zoneRows]);

  const donutGradient = useMemo(() => {
    if (!zoneRows.length) {
      return 'conic-gradient(#dde4f3 0deg 360deg)';
    }
    let cumulative = 0;
    const parts = zoneRows.slice(0, 6).map((zone, index) => {
      const start = cumulative;
      cumulative += zone.percentage * 3.6;
      return `${ZONE_PALETTE[index % ZONE_PALETTE.length]} ${start}deg ${cumulative}deg`;
    });
    return `conic-gradient(${parts.join(', ')})`;
  }, [zoneRows]);

  const fetchEntries = useCallback(async () => {
    const response = await fetch(`${API_BASE}/entries`);
    if (!response.ok) {
      const message = await parseErrorResponse(response, 'Could not fetch entries from backend.');
      throw new Error(message);
    }
    const data = await response.json();
    setEntries(data);
  }, []);

  const fetchAnalytics = useCallback(async () => {
    const response = await fetch(`${API_BASE}/analytics?threshold=5&topK=5`);
    if (!response.ok) {
      const message = await parseErrorResponse(response, 'Could not fetch DSA analytics from backend.');
      throw new Error(message);
    }
    const data = await response.json();
    setAnalytics(data);
  }, []);

  const fetchAlertStates = useCallback(async () => {
    const response = await fetch(`${API_BASE}/alerts/state`);
    if (!response.ok) {
      const message = await parseErrorResponse(response, 'Could not fetch alert states from backend.');
      throw new Error(message);
    }

    const data = await response.json();
    const normalized = data.reduce((acc, item) => {
      acc[item.id] = {
        acknowledged: Boolean(item.acknowledged),
        dismissed: Boolean(item.dismissed)
      };
      return acc;
    }, {});

    setAlertStateMap(normalized);
  }, []);

  const loadAll = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      await Promise.all([fetchEntries(), fetchAnalytics(), fetchAlertStates()]);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [fetchAlertStates, fetchAnalytics, fetchEntries]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    const timer = setInterval(() => {
      loadAll();
    }, 30000);

    return () => clearInterval(timer);
  }, [loadAll]);

  const onDeviceInput = (event) => {
    const { name, value } = event.target;
    setDeviceForm((prev) => ({
      ...prev,
      [name]: value
    }));
  };

  const submitEntry = useCallback(async (payload, resetMainForm = false) => {
    try {
      setError('');

      const response = await fetch(`${API_BASE}/entries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const message = await parseErrorResponse(response, 'Failed to save entry.');
        throw new Error(message);
      }

      // no main form to reset in current UI
      await loadAll();
    } catch (err) {
      setError(err.message);
    }
  }, [loadAll]);

  // onSubmit removed (unused) to satisfy linter

  const onSaveDevice = async (event) => {
    event.preventDefault();

    if (!deviceForm.name.trim() || !deviceForm.zone.trim() || Number(deviceForm.watts) <= 0) {
      setError('Please fill valid device details before saving.');
      return;
    }

    const statusCostMap = {
      High: 8.5,
      Med: 6.8,
      Low: 5.2
    };

    const payload = {
      readingTime: editingDeviceId ? deviceForm.readingTime : getLocalDateTimeInput(),
      location: deviceForm.zone,
      sourceType: deviceForm.sourceType || 'Device',
      unitsConsumed: Number(deviceForm.watts) / 150,
      unitCost: statusCostMap[deviceForm.status] || 6,
      peakHour: deviceForm.status === 'High',
      notes: deviceForm.name
    };

    if (editingDeviceId) {
      try {
        setError('');
        const response = await fetch(`${API_BASE}/entries/${editingDeviceId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          const message = await parseErrorResponse(response, 'Failed to update device entry.');
          throw new Error(message);
        }

        await loadAll();
      } catch (err) {
        setError(err.message);
        return;
      }
    } else {
      await submitEntry(payload, false);
    }

    setIsModalOpen(false);
    setEditingDeviceId(null);
    setDeviceForm(initialDeviceForm);
  };

  const onDelete = async (id) => {
    try {
      setError('');
      const response = await fetch(`${API_BASE}/entries/${id}`, { method: 'DELETE' });
      if (!response.ok) {
        const message = await parseErrorResponse(response, 'Delete failed.');
        throw new Error(message);
      }
      await loadAll();
    } catch (err) {
      setError(err.message);
    }
  };

  const saveAlertState = useCallback(async (id, nextState) => {
    const response = await fetch(`${API_BASE}/alerts/state/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(nextState)
    });

    if (!response.ok) {
      const message = await parseErrorResponse(response, 'Failed to persist alert state.');
      throw new Error(message);
    }

    const saved = await response.json();
    setAlertStateMap((prev) => ({
      ...prev,
      [saved.id]: {
        acknowledged: Boolean(saved.acknowledged),
        dismissed: Boolean(saved.dismissed)
      }
    }));
  }, []);

  const dismissAlert = useCallback(async (id) => {
    try {
      setError('');
      const current = alertStateMap[id] || { acknowledged: false, dismissed: false };
      await saveAlertState(id, {
        acknowledged: current.acknowledged,
        dismissed: true
      });
    } catch (err) {
      setError(err.message);
    }
  }, [alertStateMap, saveAlertState]);

  const acknowledgeAlert = useCallback(async (id) => {
    try {
      setError('');
      const current = alertStateMap[id] || { acknowledged: false, dismissed: false };
      await saveAlertState(id, {
        acknowledged: true,
        dismissed: current.dismissed
      });
    } catch (err) {
      setError(err.message);
    }
  }, [alertStateMap, saveAlertState]);

  const closeDeviceModal = useCallback(() => {
    setIsModalOpen(false);
    setEditingDeviceId(null);
    setDeviceForm(initialDeviceForm);
  }, []);

  const openAddDeviceModal = useCallback(() => {
    setEditingDeviceId(null);
    setDeviceForm(initialDeviceForm);
    setIsModalOpen(true);
  }, []);

  const openEditDeviceModal = useCallback((device) => {
    setEditingDeviceId(device.id);
    setDeviceForm({
      name: device.name,
      zone: device.zone,
      watts: device.watts,
      status: device.status,
      readingTime: device.readingTime,
      sourceType: device.sourceType || 'Device'
    });
    setIsModalOpen(true);
  }, []);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-bolt">⚡</div>
          <h1>GridHome</h1>
        </div>

        <nav>
          {NAV_ITEMS.map((item) => (
            <button
              key={item}
              type="button"
              className={`nav-item ${activeTab === item ? 'active' : ''}`}
              onClick={() => setActiveTab(item)}
            >
              {item}
            </button>
          ))}
        </nav>

        <div className="sidebar-foot">Live · Updated now <span /></div>
      </aside>

      <main className="content">
        <header className="content-header">
          <h2>{activeTab}</h2>
          {activeTab === 'Devices' && (
            <button type="button" className="primary-btn" onClick={openAddDeviceModal}>
              + Add Device
            </button>
          )}
          {activeTab === 'Billing' && <button type="button" className="primary-btn">Edit Billing</button>}
        </header>

        {error && <div className="error-banner">{error}</div>}

        {activeTab === 'Dashboard' && (
          <>
            <section className="stats-grid">
              <article className="stat-card">
                <p>CURRENT DRAW</p>
                <h3>{summary.currentDraw.toFixed(1)} kW</h3>
                <span>up 0.3 kW vs 1h ago</span>
              </article>
              <article className="stat-card">
                <p>TODAY'S USAGE</p>
                <h3>{summary.todayUsage.toFixed(1)} kWh</h3>
                <span className="ok">down 12% vs yesterday</span>
              </article>
              <article className="stat-card">
                <p>SOLAR GENERATED</p>
                <h3>{summary.solarGenerated.toFixed(1)} kWh</h3>
                <span className="warn">32% self-sufficiency</span>
              </article>
              <article className="stat-card">
                <p>TODAY'S COST</p>
                <h3>₹{summary.todayCost.toFixed(0)}</h3>
                <span>₹{summary.totalCost.toFixed(0)} spent this month</span>
              </article>
            </section>

            <section className="two-col">
              <article className="panel chart-box">
                <div className="panel-title-row">
                  <h4>24h Consumption vs Solar</h4>
                  <span className="panel-subtitle">Rolling 24-hour view from saved entries</span>
                </div>
                <svg viewBox="0 0 300 170" className="line-chart" aria-label="24h chart">
                  <polyline points={chart24h.consumptionPoints} className="line-main" />
                  <polyline points={chart24h.solarPoints} className="line-secondary" />
                </svg>
                <div className="chart-legend-inline">
                  <span><span className="legend-dot consumption" />Consumption</span>
                  <span><span className="legend-dot solar" />Solar</span>
                </div>
              </article>

              <article className="panel">
                <h4>Zone Distribution</h4>
                <div className="donut" style={{ background: donutGradient }}>
                  <div className="donut-hole" />
                </div>
                <div className="legend-row zone-legend-inline">
                  {zoneRows.slice(0, 6).map((zone) => (
                    <span key={zone.zone} className="legend-item">
                      <span className="legend-swatch" style={{ background: zone.color }} />
                      <span>{zone.zone}</span>
                    </span>
                  ))}
                </div>
              </article>
            </section>
          </>
        )}

        {activeTab === 'Devices' && (
          <>
            <section className="panel table-panel">
              {loading ? (
                <p>Loading records...</p>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>NAME</th>
                      <th>ZONE</th>
                      <th>WATTS</th>
                      <th>STATUS</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {devices.map((device) => (
                      <tr key={device.id}>
                        <td>{device.name}</td>
                        <td>{device.zone}</td>
                        <td>{device.watts} W</td>
                        <td><span className={`tag ${device.status.toLowerCase()}`}>{device.status}</span></td>
                        <td className="actions-cell">
                          <button type="button" className="ghost" onClick={() => openEditDeviceModal(device)}>Edit</button>
                          <button type="button" className="danger" onClick={() => onDelete(device.id)}>Del</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            <section className="two-col">
              <article className="panel">
                <h4>Device share (kWh equivalent)</h4>
                <div className="donut" style={{ background: donutGradient }}>
                  <div className="donut-hole" />
                </div>
              </article>

              <article className="panel bar-panel">
                {chartDistribution.map((device) => (
                  <div key={device.id} className="bar-row">
                    <span>{device.name.slice(0, 14)}</span>
                    <div className="bar-wrap">
                      <div className="bar-fill" style={{ width: `${Math.max(8, device.percentage)}%`, background: device.color }} />
                    </div>
                  </div>
                ))}
              </article>
            </section>
          </>
        )}

        {activeTab === 'Zones' && (
          <>
            <section className="panel">
              <div className="panel-title-row">
                <h4>Zone consumption pie chart</h4>
                <span className="panel-subtitle">Hash map aggregation of all saved entries</span>
              </div>
              <div className="zone-layout">
                <div className="donut large" style={{ background: donutGradient }}>
                  <div className="donut-hole" />
                </div>

                <div className="zone-legend-grid">
                  {zoneRows.length ? zoneRows.map((zone) => (
                    <div key={zone.zone} className="zone-legend-card">
                      <span className="legend-swatch" style={{ background: zone.color }} />
                      <div>
                        <strong>{zone.zone}</strong>
                        <p>{zone.kwh.toFixed(1)} kWh · {zone.percentage.toFixed(0)}%</p>
                      </div>
                    </div>
                  )) : (
                    <p className="empty-state">Enter entries to see zone consumption distribution.</p>
                  )}
                </div>
              </div>

              <div className="zone-chip-row">
                {visibleZones.map((zone) => (
                  <span key={zone} className="zone-chip">{zone}</span>
                ))}
              </div>
            </section>
          </>
        )}

        {activeTab === 'Data & Charts' && (
          <section className="panel">
            <h4>Algorithm outputs</h4>
            {!analytics ? (
              <p>No analytics available yet.</p>
            ) : (
              <div className="charts-grid">
                <div>
                  <h5>Sorted units (Merge Sort)</h5>
                  <p>{(analytics.sortedUnits || []).slice(0, 10).join(', ')}</p>
                </div>
                <div>
                  <h5>Next greater element (Stack)</h5>
                  <p>{(analytics.nextGreaterUnits || []).slice(0, 10).join(', ')}</p>
                </div>
                <div>
                  <h5>Source traversal (Graph + BFS)</h5>
                  <p>{(analytics.bfsSourceOrder || []).join(' -> ')}</p>
                </div>
                <div>
                  <h5>Peak alert queue</h5>
                  <ul>
                    {(analytics.peakAlertsQueue || []).slice(0, 5).map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </div>
              </div>
            )}
          </section>
        )}

        {activeTab === 'Alerts' && (
          <section className="panel">
            <div className="panel-title-row">
              <h4>Live alert queue</h4>
              <span className="panel-subtitle">Priority queue sorted by severity and timestamp</span>
            </div>

            <div className="alert-list">
              {alerts.map((item) => (
                <article key={item.id} className={`alert-card ${item.severity} ${item.acknowledged ? 'acknowledged' : ''}`}>
                  <div className="alert-topline">
                    <span className={`alert-badge ${item.severity} ${item.acknowledged ? 'acknowledged' : ''}`}>{item.severity === 'critical' ? '🔴 Critical' : item.severity === 'warning' ? '🟡 Warning' : '🟢 Info'}{item.acknowledged ? ' · Acknowledged' : ''}</span>
                    <span className="alert-time">{item.timestamp}</span>
                  </div>
                  <p>{item.message}</p>
                  <div className="alert-footer">
                    <span>{item.location}</span>
                    <div className="alert-actions">
                      <button type="button" className="ghost" onClick={() => acknowledgeAlert(item.id)}>{item.acknowledged ? 'Acknowledged' : 'Acknowledge'}</button>
                      <button type="button" className="danger" onClick={() => dismissAlert(item.id)}>Dismiss</button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        {activeTab === 'Billing' && (
          <>
            <section className="stats-grid">
              <article className="stat-card"><p>TOTAL AMOUNT DUE THIS BILLING CYCLE</p><h3>₹{billingSummary.totalDue.toFixed(0)}</h3><span className="warn">Cycle closes on {billingSummary.dueDate}</span></article>
              <article className="stat-card"><p>PEAK HOUR COST</p><h3>₹{billingSummary.peakCost.toFixed(0)}</h3><span>{billingSummary.peakUnits.toFixed(1)} kWh</span></article>
              <article className="stat-card"><p>OFF-PEAK COST</p><h3>₹{billingSummary.offPeakCost.toFixed(0)}</h3><span>{billingSummary.offPeakUnits.toFixed(1)} kWh</span></article>
              <article className="stat-card"><p>DUE DATE FOR PAYMENT</p><h3>{billingSummary.dueDate}</h3><span className="ok">Auto-calculated from saved entries</span></article>
            </section>

            <section className="panel">
              <div className="panel-title-row">
                <h4>Cost breakdown</h4>
                <span className="panel-subtitle">Peak vs off-peak split from stored entries</span>
              </div>
              <div className="billing-breakdown">
                <div className="progress-group">
                  <div className="progress-labels"><span>Peak hours</span><strong>₹{billingSummary.peakCost.toFixed(0)}</strong></div>
                  <div className="progress"><div className="peak-fill" style={{ width: `${Math.max(6, billingSummary.peakShare)}%` }} /></div>
                </div>
                <div className="progress-group">
                  <div className="progress-labels"><span>Off-peak hours</span><strong>₹{billingSummary.offPeakCost.toFixed(0)}</strong></div>
                  <div className="progress"><div className="offpeak-fill" style={{ width: `${Math.max(6, billingSummary.offPeakShare)}%` }} /></div>
                </div>
              </div>
            </section>

            <section className="two-col">
              <article className="panel">
                <h4>Billing cycle chart</h4>
                <div className="donut" style={{ background: `conic-gradient(#d83a52 0deg ${billingSummary.peakShare * 3.6}deg, #1f8a70 ${billingSummary.peakShare * 3.6}deg 360deg)` }}>
                  <div className="donut-hole" />
                </div>
              </article>

              <article className="panel table-panel">
                <h4>Cost summary</h4>
                <table>
                  <tbody>
                    <tr><td>Total due</td><td>₹{billingSummary.totalDue.toFixed(0)}</td></tr>
                    <tr><td>Due date</td><td>{billingSummary.dueDate}</td></tr>
                    <tr><td>Peak contribution</td><td>{billingSummary.peakShare.toFixed(0)}%</td></tr>
                    <tr><td>Off-peak contribution</td><td>{billingSummary.offPeakShare.toFixed(0)}%</td></tr>
                    <tr><td>Peak rate</td><td>₹8.5/kWh</td></tr>
                    <tr><td>Off-peak rate</td><td>₹4.2/kWh</td></tr>
                  </tbody>
                </table>
              </article>
            </section>
          </>
        )}
      </main>

      {isModalOpen && (
        <div className="modal-overlay" role="presentation" onClick={closeDeviceModal}>
          <div className="modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <h3>{editingDeviceId ? 'Edit Device' : 'Add Device'}</h3>
              <button type="button" className="ghost" onClick={closeDeviceModal}>×</button>
            </div>
            <form className="entry-form" onSubmit={onSaveDevice}>
              <label>
                Name
                <input name="name" value={deviceForm.name} onChange={onDeviceInput} required />
              </label>
              <label>
                Zone
                <input name="zone" value={deviceForm.zone} onChange={onDeviceInput} required />
              </label>
              <label>
                Watts
                <input name="watts" type="number" min="0" step="1" value={deviceForm.watts} onChange={onDeviceInput} required />
              </label>
              <label>
                Status
                <select name="status" value={deviceForm.status} onChange={onDeviceInput}>
                  <option>Low</option>
                  <option>Med</option>
                  <option>High</option>
                </select>
              </label>
              <button className="primary-btn" type="submit">{editingDeviceId ? 'Update' : 'Save'}</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
