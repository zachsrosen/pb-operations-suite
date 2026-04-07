/**
 * Solar Designer V12 Engine — Public API
 * Stage 1 (Core): layout -> equipment -> string -> analyze.
 */

// Types
export type {
  CoreSolarDesignerInput,
  CoreSolarDesignerResult,
  PanelGeometry,
  ShadeTimeseries,
  ShadeFidelity,
  ShadeSource,
  ClippingEvent,
  EquipmentSelection,
  SiteConditions,
} from './types';

// Re-exported engine types
export type {
  ConsumptionConfig,
  LossProfile,
  StringConfig,
  InverterConfig,
  PanelStat,
  ResolvedPanel,
  ResolvedInverter,
} from './types';

// Runner
export { runCoreAnalysis, CORE_SCHEMA_VERSION, legacyFixtureToCoreInput } from './runner';

// Equipment
export { getBuiltInPanels, getBuiltInInverters, getBuiltInEss, resolvePanel, resolveInverter, resolveEss } from './equipment';

// Layout parsing
export { parseJSON, parseDXF } from './layout-parser';
export type { RadiancePoint } from './layout-parser';
export { parseShadeCSV } from './csv-shade-parser';

// Shade association
export { associateShadePoints } from './shade-association';

// String validation
export { validateString } from './string-validation';
export type { StringValidationResult } from './string-validation';

// Stringing
export { autoString } from './stringing';

// Physics (re-exported)
export { solarFactor, seasonFactor, getSeasonalTSRF, calculateStringElectrical } from './physics';

// Timeseries
export { aggregateTimeseries, sumTimeseries, viewToKwh } from './timeseries';

// Clipping
export { detectClippingEvents } from './clipping';

// Constants
export { TIMESTEPS, HALF_HOUR_FACTOR, DEFAULT_SITE_CONDITIONS, DEFAULT_LOSS_PROFILE } from './constants';

// Worker
export { handleWorkerMessage } from './worker';
