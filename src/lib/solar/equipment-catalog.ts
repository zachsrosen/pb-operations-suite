/**
 * Solar Surveyor — Built-In Equipment Catalog
 *
 * Hardcoded equipment profiles matching Solar Surveyor V12's equipment.js.
 * These are the PB-standard panels, inverters, optimizers, and ESS.
 *
 * Custom equipment is stored in DB via SolarCustomEquipment model
 * and merged at runtime by the /api/solar/equipment route.
 */

export interface BuiltInPanel {
  name: string;
  watts: number;
  voc: number;
  vmp: number;
  isc: number;
  imp: number;
  tempCoVoc: number;
  tempCoIsc: number;
  tempCoPmax: number;
  length: number; // meters
  width: number; // meters
  cells: number;
  bypassDiodes: number;
  cellsPerSubstring: number;
  isBifacial?: boolean;
  bifacialityFactor?: number;
}

export interface BuiltInInverter {
  name: string;
  acPower: number;
  dcMax: number;
  mpptMin: number;
  mpptMax: number;
  channels: number;
  maxIsc: number;
  efficiency: number;
  architectureType: "string" | "micro" | "optimizer";
  isMicro?: boolean;
  isIntegrated?: boolean;
}

export interface BuiltInOptimizer {
  name: string;
  dcMaxInput: number;
  inputVoltageMin: number;
  inputVoltageMax: number;
  maxIsc: number;
  outputVoltageMin: number;
  outputVoltageMax: number;
  maxOutputCurrent: number;
  efficiency: number;
  weightedEfficiency: number;
  modulesPerOptimizer: number;
  series: string;
}

export interface BuiltInEss {
  name: string;
  capacity: number;
  power: number;
  roundTrip: number;
  dcChargeRate: number;
  dcChargeRateExpanded: number;
  type: "none" | "ac_coupled" | "dc_coupled";
  expansionCapacity: number;
  expansionPower: number;
  maxExpansions: number;
}

export interface BuiltInEquipmentCatalog {
  panels: Record<string, BuiltInPanel>;
  inverters: Record<string, BuiltInInverter>;
  optimizers: Record<string, BuiltInOptimizer>;
  ess: Record<string, BuiltInEss>;
}

const EQUIPMENT: BuiltInEquipmentCatalog = {
  panels: {
    REC_Alpha_Pure_440: { name: "REC Alpha Pure 440W", watts: 440, voc: 48.4, vmp: 40.8, isc: 11.5, imp: 10.79, tempCoVoc: -0.0024, tempCoIsc: 0.0004, tempCoPmax: -0.0026, length: 1.82, width: 1.02, cells: 132, bypassDiodes: 3, cellsPerSubstring: 44 },
    REC_Alpha_Pure_RX_460: { name: "REC Alpha Pure RX 460W", watts: 460, voc: 50.1, vmp: 42.2, isc: 11.6, imp: 10.9, tempCoVoc: -0.0024, tempCoIsc: 0.0004, tempCoPmax: -0.0026, length: 1.86, width: 1.02, cells: 132, bypassDiodes: 3, cellsPerSubstring: 44 },
    SEG_430_BTD_BG: { name: "SEG 430 BTD BG Bifacial", watts: 430, voc: 45.2, vmp: 37.8, isc: 11.85, imp: 11.38, tempCoVoc: -0.0026, tempCoIsc: 0.0005, tempCoPmax: -0.0034, length: 1.72, width: 1.13, cells: 108, bypassDiodes: 3, cellsPerSubstring: 36, isBifacial: true, bifacialityFactor: 0.70 },
    Hyundai_HIN_T440NF: { name: "Hyundai HIN-T440NF(BK)", watts: 440, voc: 46.1, vmp: 38.5, isc: 11.78, imp: 11.43, tempCoVoc: -0.0026, tempCoIsc: 0.0005, tempCoPmax: -0.0029, length: 1.72, width: 1.13, cells: 120, bypassDiodes: 3, cellsPerSubstring: 40 },
    QCells_QPeak_420: { name: "Q.CELLS Q.PEAK DUO 420W", watts: 420, voc: 44.8, vmp: 37.5, isc: 11.95, imp: 11.2, tempCoVoc: -0.0027, tempCoIsc: 0.0005, tempCoPmax: -0.0034, length: 1.76, width: 1.05, cells: 120, bypassDiodes: 3, cellsPerSubstring: 40 },
    Canadian_HiHero_445: { name: "Canadian HiHero 445W", watts: 445, voc: 49.2, vmp: 41.3, isc: 11.42, imp: 10.78, tempCoVoc: -0.0025, tempCoIsc: 0.0004, tempCoPmax: -0.0029, length: 1.85, width: 1.03, cells: 132, bypassDiodes: 3, cellsPerSubstring: 44 },
    Trina_Vertex_S_435: { name: "Trina Vertex S+ 435W", watts: 435, voc: 47.6, vmp: 40.1, isc: 11.52, imp: 10.85, tempCoVoc: -0.0024, tempCoIsc: 0.0005, tempCoPmax: -0.0030, length: 1.78, width: 1.06, cells: 144, bypassDiodes: 3, cellsPerSubstring: 48 },
    Jinko_Tiger_Neo_445: { name: "Jinko Tiger Neo 445W", watts: 445, voc: 48.9, vmp: 41.0, isc: 11.48, imp: 10.85, tempCoVoc: -0.0025, tempCoIsc: 0.0004, tempCoPmax: -0.0029, length: 1.84, width: 1.03, cells: 144, bypassDiodes: 3, cellsPerSubstring: 48 },
  },
  inverters: {
    Tesla_PW3_Inverter: { name: "Tesla Powerwall 3 (11.5kW)", acPower: 11500, dcMax: 15000, mpptMin: 60, mpptMax: 500, channels: 6, maxIsc: 25, efficiency: 0.975, isIntegrated: true, architectureType: "string" },
    Tesla_Inverter_3_8: { name: "Tesla Inverter 3.8kW", acPower: 3800, dcMax: 7600, mpptMin: 80, mpptMax: 500, channels: 2, maxIsc: 18, efficiency: 0.97, architectureType: "string" },
    Tesla_Inverter_5_0: { name: "Tesla Inverter 5.0kW", acPower: 5000, dcMax: 10000, mpptMin: 90, mpptMax: 500, channels: 2, maxIsc: 18, efficiency: 0.971, architectureType: "string" },
    Tesla_Inverter_7_6: { name: "Tesla Inverter 7.6kW", acPower: 7600, dcMax: 11400, mpptMin: 100, mpptMax: 500, channels: 4, maxIsc: 20, efficiency: 0.975, architectureType: "string" },
    Generac_PWRcell: { name: "Generac PWRcell 7.6kW", acPower: 7600, dcMax: 11000, mpptMin: 120, mpptMax: 500, channels: 3, maxIsc: 18, efficiency: 0.97, architectureType: "string" },
    Enphase_IQ8M: { name: "Enphase IQ8M Micro (PB Std)", acPower: 330, dcMax: 440, mpptMin: 29, mpptMax: 45, channels: 1, maxIsc: 15, efficiency: 0.968, isMicro: true, architectureType: "micro" },
    Enphase_IQ8A: { name: "Enphase IQ8A Micro", acPower: 366, dcMax: 480, mpptMin: 32, mpptMax: 45, channels: 1, maxIsc: 20, efficiency: 0.970, isMicro: true, architectureType: "micro" },
    Enphase_IQ8P: { name: "Enphase IQ8P Micro", acPower: 480, dcMax: 600, mpptMin: 36, mpptMax: 55, channels: 1, maxIsc: 20, efficiency: 0.972, isMicro: true, architectureType: "micro" },
    SolarEdge_SE3800H: { name: "SolarEdge SE3800H", acPower: 3800, dcMax: 5700, mpptMin: 150, mpptMax: 500, channels: 1, maxIsc: 22, efficiency: 0.992, architectureType: "optimizer" },
    SolarEdge_SE7600H: { name: "SolarEdge SE7600H", acPower: 7600, dcMax: 11400, mpptMin: 150, mpptMax: 500, channels: 1, maxIsc: 22, efficiency: 0.992, architectureType: "optimizer" },
    SolarEdge_SE10000H: { name: "SolarEdge SE10000H", acPower: 10000, dcMax: 13500, mpptMin: 150, mpptMax: 500, channels: 1, maxIsc: 22, efficiency: 0.993, architectureType: "optimizer" },
    SolarEdge_SE11400H: { name: "SolarEdge SE11400H", acPower: 11400, dcMax: 17100, mpptMin: 150, mpptMax: 500, channels: 2, maxIsc: 22, efficiency: 0.993, architectureType: "optimizer" },
  },
  optimizers: {
    SolarEdge_S440: { name: "SolarEdge S440", dcMaxInput: 490, inputVoltageMin: 8, inputVoltageMax: 60, maxIsc: 16.5, outputVoltageMin: 0.5, outputVoltageMax: 60, maxOutputCurrent: 15, efficiency: 0.995, weightedEfficiency: 0.988, modulesPerOptimizer: 1, series: "S" },
    SolarEdge_S500: { name: "SolarEdge S500", dcMaxInput: 500, inputVoltageMin: 8, inputVoltageMax: 60, maxIsc: 16.5, outputVoltageMin: 0.5, outputVoltageMax: 60, maxOutputCurrent: 15, efficiency: 0.995, weightedEfficiency: 0.988, modulesPerOptimizer: 1, series: "S" },
    SolarEdge_P505: { name: "SolarEdge P505", dcMaxInput: 505, inputVoltageMin: 8, inputVoltageMax: 83, maxIsc: 15, outputVoltageMin: 0.5, outputVoltageMax: 83, maxOutputCurrent: 15, efficiency: 0.995, weightedEfficiency: 0.988, modulesPerOptimizer: 1, series: "P" },
    SolarEdge_P601: { name: "SolarEdge P601", dcMaxInput: 601, inputVoltageMin: 8, inputVoltageMax: 83, maxIsc: 15, outputVoltageMin: 0.5, outputVoltageMax: 83, maxOutputCurrent: 15, efficiency: 0.995, weightedEfficiency: 0.988, modulesPerOptimizer: 1, series: "P" },
  },
  ess: {
    None: { name: "No ESS", capacity: 0, power: 0, roundTrip: 0, dcChargeRate: 0, dcChargeRateExpanded: 0, type: "none", expansionCapacity: 0, expansionPower: 0, maxExpansions: 0 },
    Tesla_PW2: { name: "Tesla Powerwall 2", capacity: 13.5, power: 5, roundTrip: 0.90, dcChargeRate: 0, dcChargeRateExpanded: 0, type: "ac_coupled", expansionCapacity: 0, expansionPower: 0, maxExpansions: 0 },
    Tesla_PW3: { name: "Tesla Powerwall 3", capacity: 13.5, power: 11.5, roundTrip: 0.92, dcChargeRate: 5000, dcChargeRateExpanded: 8000, type: "dc_coupled", expansionCapacity: 13.5, expansionPower: 3300, maxExpansions: 3 },
    Enphase_IQ_5P: { name: "Enphase IQ Battery 5P", capacity: 5, power: 3.84, roundTrip: 0.89, dcChargeRate: 0, dcChargeRateExpanded: 0, type: "ac_coupled", expansionCapacity: 0, expansionPower: 0, maxExpansions: 0 },
    Enphase_IQ_10T: { name: "Enphase IQ Battery 10T", capacity: 10.5, power: 5.76, roundTrip: 0.90, dcChargeRate: 0, dcChargeRateExpanded: 0, type: "ac_coupled", expansionCapacity: 0, expansionPower: 0, maxExpansions: 0 },
    Generac_PWRcell_M4: { name: "Generac PWRcell M4", capacity: 9, power: 4.5, roundTrip: 0.87, dcChargeRate: 0, dcChargeRateExpanded: 0, type: "ac_coupled", expansionCapacity: 0, expansionPower: 0, maxExpansions: 0 },
  },
};

export function getBuiltInEquipment(): BuiltInEquipmentCatalog {
  return EQUIPMENT;
}
