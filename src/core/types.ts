export type MeterType = 'IAMMETER_WEM3080T' | 'FRONIUS_SUNSPEC' | 'SHELLY_3EM';

export type MeterTypeAlias =
  | MeterType
  | 'IAMMETER'
  | 'FRONIUS'
  | 'FRONIUS_GEN24'
  | 'SHELLY'
  | 'SHELLY_PRO_3EM';

export type DestinationType = 'NONE' | 'IAMMETER_CLOUD' | 'IAMMETER_LOCAL';

export type MeterProtocol = 'modbus-tcp' | 'http';

export interface PhaseData {
  voltage: number;
  current: number;
  active_power: number;
  reactive_power: number;
  forward_energy: number;
  reverse_energy: number;
  power_factor: number;
}

export interface NormalizedMeterData {
  type: MeterType;
  protocol: MeterProtocol;
  model: string;
  timestamp: number;
  phase_a: PhaseData;
  phase_b: PhaseData;
  phase_c: PhaseData;
  frequency: number;
  total_power: number;
  total_forward_energy: number;
  total_reverse_energy: number;
  valid_phases: number;
}

export interface WifiConfig {
  ssid: string;
  password: string;
}

export interface MeterConfig {
  type: MeterType;
  host: string;
  port: number;
  unit_id: number;
  timeout_ms: number;
}

export interface LegacyCloudConfig {
  server: string;
  sn: string;
}

export interface DestinationConfig {
  type: DestinationType;
  address: string;
  sn: string;
}

export interface DeviceIdentityConfig {
  device_name: string;
}

export interface AuthConfig {
  passwordHash: string;
}

export interface GatewayConfig {
  version: number;
  wifi: WifiConfig;
  meter: MeterConfig;
  cloud: LegacyCloudConfig;
  destination: DestinationConfig;
  device: DeviceIdentityConfig;
  auth: AuthConfig;
}

export interface FirmwareInfo {
  project: string;
  version: string;
  idf: string;
  build_date: string;
  build_time: string;
}

export interface ConfigResponse {
  version: number;
  wifi: WifiConfig;
  ap_mode: boolean;
  hide_monitor_ui: boolean;
  meter: {
    type: MeterType;
    host: string;
    port: number;
  };
  cloud: LegacyCloudConfig;
  destination: DestinationConfig;
  device: DeviceIdentityConfig;
  firmware: FirmwareInfo;
}

export interface UploadPayload {
  method: 'uploadsn';
  mac: string;
  version: string;
  server: 'em';
  SN: string;
  Datas: number[][];
}

export interface RuntimeOptions {
  configPath: string;
  port: number;
  host: string;
  pollIntervalMs: number;
  uploadIntervalMs: number;
  selfRestartEnabled: boolean;
  authPassword: string | null;
  authPasswordHash: string | null;
}

export interface BuildInfo {
  project: string;
  version: string;
  builtAt: Date;
}

export interface RuntimeEvent {
  id: string;
  level: 'info' | 'warn' | 'error';
  category: 'system' | 'poll' | 'upload' | 'auth' | 'config';
  message: string;
  createdAt: string;
}

export interface MeterHistoryPoint {
  collectedAt: string;
  totalPower: number;
  totalForwardEnergy: number;
  totalReverseEnergy: number;
  frequency: number;
  phasePower: [number, number, number];
}

export interface RuntimeStatus {
  authenticated: boolean;
  authConfigured: boolean;
  authUsername: string;
  authManagedByEnvironment: boolean;
  authEnvironmentVariable: string | null;
  meterConfigured: boolean;
  sourceType: MeterType;
  sourceHost: string;
  sourcePort: number;
  destinationType: DestinationType;
  destinationUrl: string | null;
  pollIntervalMs: number;
  uploadIntervalMs: number;
  lastPollAt: string | null;
  lastUploadAt: string | null;
  lastUploadError: string | null;
  lastReadingError: string | null;
  deviceName: string;
}
