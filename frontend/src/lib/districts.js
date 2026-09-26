// frontend/src/lib/districts.js
// District picker for the Doctor Portal. Coordinates are approximate district
// (city) centres, used only so NIH clusters can be placed on the map at district
// level; they are not a patient address. The API rounds cluster points to
// 0.01° before the surveillance tier sees them.
export const PROVINCES = ['Punjab', 'Sindh', 'KPK', 'Balochistan', 'Islamabad', 'Gilgit-Baltistan', 'AJK'];

export const DISTRICTS = [
  { district: 'Lahore', province: 'Punjab', latitude: 31.55, longitude: 74.34 },
  { district: 'Faisalabad', province: 'Punjab', latitude: 31.42, longitude: 73.08 },
  { district: 'Rawalpindi', province: 'Punjab', latitude: 33.6, longitude: 73.05 },
  { district: 'Multan', province: 'Punjab', latitude: 30.2, longitude: 71.47 },
  { district: 'Gujranwala', province: 'Punjab', latitude: 32.16, longitude: 74.19 },
  { district: 'Sialkot', province: 'Punjab', latitude: 32.49, longitude: 74.53 },
  { district: 'Bahawalpur', province: 'Punjab', latitude: 29.4, longitude: 71.68 },
  { district: 'Karachi', province: 'Sindh', latitude: 24.86, longitude: 67.01 },
  { district: 'Hyderabad', province: 'Sindh', latitude: 25.39, longitude: 68.37 },
  { district: 'Sukkur', province: 'Sindh', latitude: 27.7, longitude: 68.86 },
  { district: 'Larkana', province: 'Sindh', latitude: 27.56, longitude: 68.21 },
  { district: 'Peshawar', province: 'KPK', latitude: 34.01, longitude: 71.58 },
  { district: 'Mardan', province: 'KPK', latitude: 34.2, longitude: 72.04 },
  { district: 'Abbottabad', province: 'KPK', latitude: 34.15, longitude: 73.22 },
  { district: 'Swat', province: 'KPK', latitude: 34.78, longitude: 72.36 },
  { district: 'Quetta', province: 'Balochistan', latitude: 30.18, longitude: 66.99 },
  { district: 'Gwadar', province: 'Balochistan', latitude: 25.13, longitude: 62.32 },
  { district: 'Islamabad', province: 'Islamabad', latitude: 33.68, longitude: 73.05 },
  { district: 'Gilgit', province: 'Gilgit-Baltistan', latitude: 35.92, longitude: 74.31 },
  { district: 'Muzaffarabad', province: 'AJK', latitude: 34.37, longitude: 73.47 },
];

export function findDistrict(name) {
  return DISTRICTS.find((d) => d.district === name) || null;
}
