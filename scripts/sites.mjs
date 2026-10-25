// Demo projects. Boundaries are illustrative boxes drawn over real imagery;
// they are NOT registered carbon projects and the names are fictional.
export const RES = 10; // metres per pixel
export const BOX_M = 3000; // 3 km x 3 km = 900 ha per project / reference area
export const YEARS = [2019, 2021, 2023, 2025, 2026];

export const SITES = [
  {
    id: 'rondonia-frontier',
    name: 'Jaci Frontier Forest',
    region: 'Rondônia',
    country: 'Brazil',
    continent: 'South America',
    center: [-9.4047, -64.3958],
    referenceCenter: [-9.3776, -64.3957],
    claimedThreatPctPerYear: 2.0,
    season: ['07-01', '09-30'],
  },
  {
    id: 'rondonia-riverside',
    name: 'Candeias Riverside Forest',
    region: 'Rondônia',
    country: 'Brazil',
    continent: 'South America',
    center: [-9.2959, -64.4773],
    referenceCenter: [-9.3231, -64.4501],
    claimedThreatPctPerYear: 1.5,
    season: ['07-01', '09-30'],
  },
  {
    id: 'borneo-interior',
    name: 'Kalimantan Highland Forest',
    region: 'Kalimantan',
    country: 'Indonesia',
    continent: 'Asia',
    center: [0.6, 113.0269],
    referenceCenter: [0.6271, 113.0539],
    claimedThreatPctPerYear: 2.5,
    season: ['06-01', '09-30'],
  },
];
