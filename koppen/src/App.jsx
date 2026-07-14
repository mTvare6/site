import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  BarController,
  LineController,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';
import { Chart } from 'react-chartjs-2';
import koppenData from './data/koppen.json';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  BarController,
  LineController,
  Title,
  Tooltip,
  Legend,
  Filler
);

const tempRangeGradientPlugin = {
  id: 'tempRangeGradient',
  beforeDatasetDraw(chart, args) {
    const dataset = chart.data.datasets[args.index];
    if (dataset?.label !== 'Temp Range') return;

    const { ctx } = chart;
    const patternHeight = Math.max(1, Math.ceil(chart.height));

    for (const element of args.meta.data) {
      if (!Number.isFinite(element.y) || !Number.isFinite(element.base)) continue;

      const top = Math.min(element.y, element.base);
      const bottom = Math.max(element.y, element.base);
      const barHeight = bottom - top;
      if (barHeight <= 0) continue;

      const patternCanvas = chart.canvas.ownerDocument.createElement('canvas');
      patternCanvas.width = 1;
      patternCanvas.height = patternHeight;
      const patternContext = patternCanvas.getContext('2d');

      const gradient = patternContext.createLinearGradient(0, bottom, 0, top);
      gradient.addColorStop(0, '#83a598');
      gradient.addColorStop(0.5, '#fabd2f');
      gradient.addColorStop(1, '#fb4934');
      patternContext.fillStyle = gradient;
      patternContext.fillRect(0, top, 1, barHeight);

      patternContext.globalCompositeOperation = 'destination-out';
      const stripeHeight = 6;
      const gap = 3;
      for (let y = top; y < bottom; y += stripeHeight + gap) {
        patternContext.fillRect(0, y + stripeHeight, 1, gap);
      }

      // This hook runs immediately before each dataset draw, including the
      // first render and every data change, so the pattern never depends on a
      // hover event to be recalculated.
      element.options = {
        ...element.options,
        backgroundColor: ctx.createPattern(patternCanvas, 'repeat-x')
      };
    }
  }
};

ChartJS.register(tempRangeGradientPlugin);

const YEARS = Array.from({ length: 16 }, (_, i) => 2010 + i);

const RetroMenu = ({ onSelect, currentGroup, currentClass }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeGroup, setActiveGroup] = useState(null);
  const menuRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setIsOpen(false);
        setActiveGroup(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="retro-menu-container" ref={menuRef} onMouseLeave={() => { setIsOpen(false); setActiveGroup(null); }}>
      <button className="retro-btn" onClick={() => setIsOpen(!isOpen)}>
        {currentGroup} - {currentClass} ▼
      </button>
      {isOpen && (
        <div className="retro-menu">
          {Object.entries(koppenData).map(([gId, gData]) => (
            <div 
              key={gId} 
              className="retro-menu-item"
              onMouseEnter={() => setActiveGroup(gId)}
            >
              <span>{gId} - {gData.name}</span>
              <span>⏵</span>
              {activeGroup === gId && (
                <div className="retro-submenu">
                  {Object.entries(gData.classifications).map(([cId, cData]) => (
                    <div 
                      key={cId} 
                      className="retro-submenu-item"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelect(gId, cId);
                        setIsOpen(false);
                        setActiveGroup(null);
                      }}
                    >
                      {cId} - {cData.name}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const RetroDropdown = ({ options, value, onChange, label, style }) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedOpt = options.find(o => o.value === value) || options[0];

  return (
    <div className="retro-dropdown" ref={containerRef} style={style}>
      <button className="retro-dropdown-btn" onClick={() => setIsOpen(!isOpen)}>
        {selectedOpt?.label} <span>{isOpen ? '▲' : '▼'}</span>
      </button>
      {isOpen && (
        <div className="retro-dropdown-menu">
          {options.map(opt => (
            <div 
              key={opt.value} 
              className={`retro-dropdown-item ${opt.value === value ? 'selected' : ''}`}
              onClick={() => { onChange(opt.value); setIsOpen(false); }}
            >
              {opt.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

function App() {
  const [selectedGroup, setSelectedGroup] = useState('A');
  const [selectedClassification, setSelectedClassification] = useState('Af');
  const [selectedCity, setSelectedCity] = useState(0); 
  const [selectedYear, setSelectedYear] = useState(2023);
  const [isRange, setIsRange] = useState(false);
  const [selectedEndYear, setSelectedEndYear] = useState(2023);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [weatherData, setWeatherData] = useState(null);

  const cities = useMemo(() => {
    const group = koppenData[selectedGroup];
    if (!group) return [];
    const classification = group.classifications[selectedClassification];
    if (!classification) return [];
    return classification.cities;
  }, [selectedGroup, selectedClassification]);

  const handleClassSelect = (gId, cId) => {
    setSelectedGroup(gId);
    setSelectedClassification(cId);
    setSelectedCity(0);
  };

  useEffect(() => {
    if (isRange && selectedEndYear < selectedYear) {
      setSelectedEndYear(selectedYear);
    }
  }, [selectedYear, isRange, selectedEndYear]);

  useEffect(() => {
    const fetchData = async () => {
      const cityObj = cities[selectedCity];
      if (!cityObj) return;

      setIsLoading(true);
      setError(null);

      const { lat, lon } = cityObj;
      const actualEndYear = isRange ? Math.max(selectedYear, selectedEndYear) : selectedYear;
      const startDate = `${selectedYear}-01-01`;
      const endDate = `${actualEndYear}-12-31`;
      
      const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${startDate}&end_date=${endDate}&daily=temperature_2m_max,temperature_2m_min,temperature_2m_mean,precipitation_sum&timezone=auto`;

      try {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error('Failed to fetch API data');
        }
        const data = await response.json();
        
        const monthlyMax = new Array(12).fill(-Infinity);
        const monthlyMin = new Array(12).fill(Infinity);
        const monthlyMean = new Array(12).fill(0);
        const monthlyPrecip = new Array(12).fill(0);
        const daysInMonth = new Array(12).fill(0);

        data.daily.time.forEach((dateStr, idx) => {
          const month = parseInt(dateStr.split('-')[1], 10) - 1; 
          const maxT = data.daily.temperature_2m_max[idx];
          const minT = data.daily.temperature_2m_min[idx];
          const meanT = data.daily.temperature_2m_mean[idx];
          const precip = data.daily.precipitation_sum[idx];

          if (maxT !== null && maxT > monthlyMax[month]) monthlyMax[month] = maxT;
          if (minT !== null && minT < monthlyMin[month]) monthlyMin[month] = minT;
          if (meanT !== null) monthlyMean[month] += meanT;
          if (precip !== null) monthlyPrecip[month] += precip;
          daysInMonth[month] += 1;
        });

        let totalAnnualPrecip = 0;
        let sumTemp = 0;
        const yearsCount = isRange ? (actualEndYear - selectedYear + 1) : 1;

        for (let i = 0; i < 12; i++) {
          monthlyMean[i] = monthlyMean[i] / (daysInMonth[i] || 1);
          sumTemp += monthlyMean[i];
          monthlyPrecip[i] = monthlyPrecip[i] / yearsCount;
          totalAnnualPrecip += monthlyPrecip[i];
          
          if (monthlyMax[i] === -Infinity) monthlyMax[i] = null;
          if (monthlyMin[i] === Infinity) monthlyMin[i] = null;
        }

        setWeatherData({
          monthlyMax,
          monthlyMin,
          monthlyMean,
          monthlyPrecip,
          avgAnnualTemp: sumTemp / 12,
          totalAnnualPrecip
        });
      } catch (err) {
        setError(err.message);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [selectedCity, selectedClassification, selectedYear, selectedEndYear, isRange, cities]);

  const chartData = {
    labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    datasets: [
      {
        type: 'bar',
        label: 'Temp Range',
        grouped: false,
        barPercentage: 0.35, 
        categoryPercentage: 0.8,
        data: weatherData ? weatherData.monthlyMax.map((max, i) => [weatherData.monthlyMin[i], max]) : [],
        backgroundColor: 'transparent',
        borderColor: 'transparent',
        borderWidth: 0,
        yAxisID: 'y',
        order: 2
      },
      {
        type: 'line',
        label: 'Mean Temp',
        data: weatherData ? weatherData.monthlyMean : [],
        borderColor: '#fabd2f',
        backgroundColor: '#fabd2f',
        borderWidth: 4,
        stepped: true,
        pointStyle: 'circle',
        pointRadius: 0, // Hidden until hovered!
        pointHoverRadius: 8,
        pointHoverBackgroundColor: '#fabd2f',
        pointHoverBorderWidth: 2,
        pointHoverBorderColor: '#000000',
        yAxisID: 'y',
        order: 1
      },
      {
        type: 'bar',
        label: 'Precipitation',
        grouped: false, 
        barPercentage: 0.95, 
        categoryPercentage: 0.8,
        data: weatherData ? weatherData.monthlyPrecip : [],
        backgroundColor: '#b16286',
        borderColor: '#000000',
        borderWidth: 3,
        hoverBackgroundColor: '#d3869b',
        yAxisID: 'y1',
        order: 4
      },
      {
        type: 'line',
        label: 'Max Temp',
        data: weatherData ? weatherData.monthlyMax : [],
        backgroundColor: 'transparent',
        borderColor: 'transparent',
        borderWidth: 0,
        pointRadius: 0,
        pointHoverRadius: 0,
        showLine: false
      },
      {
        type: 'line',
        label: 'Min Temp',
        data: weatherData ? weatherData.monthlyMin : [],
        backgroundColor: 'transparent',
        borderColor: 'transparent',
        borderWidth: 0,
        pointRadius: 0,
        pointHoverRadius: 0,
        showLine: false
      }
    ]
  };

  const chartOptions = {
    animation: false,
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: 'index',
      intersect: false,
    },
    plugins: {
      legend: {
        onClick: function(e, legendItem, legend) {
          const chart = legend.chart;
          
          // Synchronize toggling: Clicking Max or Min Temp toggles the actual slabs AND both dummy legends
          if (['Max Temp', 'Min Temp'].includes(legendItem.text)) {
            const tempRangeIdx = chart.data.datasets.findIndex(d => d.label === 'Temp Range');
            const maxIdx = chart.data.datasets.findIndex(d => d.label === 'Max Temp');
            const minIdx = chart.data.datasets.findIndex(d => d.label === 'Min Temp');
            
            if (tempRangeIdx !== -1 && chart.isDatasetVisible(tempRangeIdx)) {
              chart.hide(tempRangeIdx);
              if (maxIdx !== -1) chart.hide(maxIdx);
              if (minIdx !== -1) chart.hide(minIdx);
            } else {
              if (tempRangeIdx !== -1) chart.show(tempRangeIdx);
              if (maxIdx !== -1) chart.show(maxIdx);
              if (minIdx !== -1) chart.show(minIdx);
            }
            return;
          }
          
          // Default chart.js toggle behavior for other datasets
          const index = legendItem.datasetIndex;
          if (chart.isDatasetVisible(index)) {
            chart.hide(index);
          } else {
            chart.show(index);
          }
        },
        labels: {
          font: { family: "'Press Start 2P', cursive", size: 8 },
          color: '#ebdbb2',
          boxWidth: 12,
          boxHeight: 12,
          filter: (item) => {
            if (item.text === 'Temp Range') return false;
            if (item.text === 'Max Temp') item.fillStyle = '#fb4934';
            if (item.text === 'Min Temp') item.fillStyle = '#83a598';
            item.lineWidth = 2; // Force uniform border width in the legend
            item.strokeStyle = '#000000'; // Force solid black border around ALL legend boxes
            return true;
          }
        }
      },
      tooltip: {
        titleFont: { family: "'Press Start 2P', cursive", size: 10 },
        bodyFont: { family: "'Press Start 2P', cursive", size: 10 },
        backgroundColor: '#3c3836',
        borderColor: '#000000',
        borderWidth: 2,
        cornerRadius: 0,
        filter: function(tooltipItem) {
          return tooltipItem.dataset.label !== 'Temp Range';
        },
        callbacks: {
          labelColor: function(context) {
            let bgColor = context.dataset.backgroundColor;
            if (context.dataset.label === 'Max Temp') bgColor = '#fb4934';
            if (context.dataset.label === 'Min Temp') bgColor = '#83a598';
            return {
              borderColor: '#000000',
              backgroundColor: bgColor,
              borderWidth: 2
            };
          },
          label: function(context) {
            if (context.dataset.label === 'Precipitation') {
               return `Precipitation: ${context.raw.toFixed(0)}mm`;
            }
            if (context.raw !== undefined && context.raw !== null) {
               return `${context.dataset.label}: ${context.raw.toFixed(1)}°C`;
            }
            return null;
          }
        }
      }
    },
    scales: {
      x: {
        grid: { color: '#504945' },
        ticks: { font: { family: "'Press Start 2P', cursive", size: 8 }, color: '#ebdbb2' }
      },
      y: {
        type: 'linear',
        display: true,
        position: 'left',
        title: {
          display: true,
          text: 'Temp (°C)',
          font: { family: "'Press Start 2P', cursive", size: 10 },
          color: '#fabd2f'
        },
        grid: { color: '#504945' },
        ticks: { font: { family: "'Press Start 2P', cursive", size: 8 }, color: '#fabd2f' }
      },
      y1: {
        type: 'linear',
        display: true,
        position: 'right',
        title: {
          display: true,
          text: 'Precip (mm)',
          font: { family: "'Press Start 2P', cursive", size: 10 },
          color: '#b16286'
        },
        grid: { drawOnChartArea: false },
        ticks: { font: { family: "'Press Start 2P', cursive", size: 8 }, color: '#b16286' }
      }
    }
  };

  return (
    <div className="app-container">
      <h1 className="header">Köppen Climate Inverse Lookup</h1>
      
      <div className="panel">
        <div className="controls-grid">
          
          <div className="control-group" style={{ gridColumn: '1 / -1' }}>
            <div style={{ height: '24px', display: 'flex', alignItems: 'center' }}>
              <label>Climate Classification Menu</label>
            </div>
            <RetroMenu 
              onSelect={handleClassSelect} 
              currentGroup={selectedGroup} 
              currentClass={selectedClassification} 
            />
          </div>

          <div className="control-group" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ height: '24px', display: 'flex', alignItems: 'center' }}>
              <label>City</label>
            </div>
            <RetroDropdown 
              options={cities.map((c, idx) => ({ value: idx, label: c.name }))}
              value={selectedCity}
              onChange={setSelectedCity}
            />
          </div>

          <div className="control-group" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ height: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label>Year{isRange && 's'}</label>
              <button 
                className="range-toggle-btn"
                onClick={() => setIsRange(!isRange)}
              >
                Range: {isRange ? 'ON' : 'OFF'}
              </button>
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
              <RetroDropdown 
                options={YEARS.map(y => ({ value: y, label: y.toString() }))}
                value={selectedYear}
                onChange={setSelectedYear}
                style={{ flex: 1 }}
              />
              {isRange && (
                <>
                  <span style={{ display: 'flex', alignItems: 'center', fontSize: '10px' }}>-</span>
                  <RetroDropdown 
                    options={YEARS.filter(y => y >= selectedYear).map(y => ({ value: y, label: y.toString() }))}
                    value={selectedEndYear < selectedYear ? selectedYear : selectedEndYear}
                    onChange={setSelectedEndYear}
                    style={{ flex: 1 }}
                  />
                </>
              )}
            </div>
          </div>

        </div>
      </div>

      {error && <div className="error-msg">ERROR: {error}</div>}

      <div className="status-grid">
        <div className="status-box">
          <h3>Avg Annual Temp</h3>
          <div className="value temp">
            {weatherData ? `${weatherData.avgAnnualTemp.toFixed(1)}°C` : '--'}
          </div>
        </div>
        <div className="status-box">
          <h3>Total Annual Precip</h3>
          <div className="value precip">
            {weatherData ? `${weatherData.totalAnnualPrecip.toFixed(0)}mm` : '--'}
          </div>
        </div>
      </div>

      <div className="chart-container">
        {isLoading && (
          <div className="loading-overlay">
            AGGREGATING CLIMATE DATA...
          </div>
        )}
        <Chart type="bar" data={chartData} options={chartOptions} />
      </div>

      <nav className="bottom-nav">
        <a href="/">long</a>
        <a href="/resume/">resume</a>
        <a href="/blog/">blog</a>
        <a href="/koppen/" className="current">koppen</a>
        <a href="https://github.com/mTvare6">github</a>
      </nav>
    </div>
  );
}

export default App;
