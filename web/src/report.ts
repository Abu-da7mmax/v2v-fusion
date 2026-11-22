export const datasetUrl = 'https://www.deepsense6g.net/scenarios/Scenarios%2030-39/scenarios-36-39';
export const paperUrl = 'https://arxiv.org/html/2406.17908#S4.SS1';
export const scenarios = [
  { id: 36, location: 'Tempe metropolitan area', mode: 'Inter-city', light: 'Day', duration: '47 min', distance: '40.02', speed: '51.4', count: 24800, note: 'This was the scenario used to train and evaluate the original project, as documented in chapter 5.' },
  { id: 37, location: 'Phoenix ↔ Scottsdale', mode: 'Inter-city', light: 'Night', duration: '58 min', distance: '45.06', speed: '46.5', count: 31000, note: 'Nighttime inter-city driving broadens the range of road speeds and lighting conditions.' },
  { id: 38, location: 'Tempe metropolitan area', mode: 'Urban', light: 'Day', duration: '1 h 06 min', distance: '17.32', speed: '15.6', count: 36000, note: 'The published velocity distribution includes frequent urban stops and lower-speed driving.' },
  { id: 39, location: 'Downtown Phoenix', mode: 'Urban', light: 'Night', duration: '39 min', distance: '15.10', speed: '23.4', count: 20400, note: 'A downtown night drive with lower-speed streets and a different lighting environment.' },
];
export const evaluation = [
  [100, '0.6', '2.5', '0.1', '3.1', '2.5', '4.4', '2.0°', '89.0%'],
  [200, '0.9', '2.0', '0.1', '2.8', '2.2', '4.4', '−0.1°', '94.5%'],
  [500, '0.7', '2.1', '0.0', '2.8', '2.1', '4.3', '−0.6°', '91.0%'],
  [1000, '0.7', '2.1', '0.0', '3.0', '1.9', '4.8', '−1.0°', '94.7%'],
];
export const ablation = [
  [100, '3.1', '14.5', '12.8', '17.8'],
  [200, '2.8', '15.4', '9.6', '17.8'],
  [500, '2.8', '24.6', '14.1', '30.2'],
  [1000, '3.0', '33.6', '39.1', '43.7'],
];
