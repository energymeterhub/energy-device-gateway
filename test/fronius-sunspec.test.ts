import test from 'node:test';
import assert from 'node:assert/strict';
import { FroniusSunSpecDriver } from '../src/meters/fronius-sunspec.js';
import type { MeterConfig } from '../src/core/types.js';

const baseConfig: MeterConfig = {
  type: 'FRONIUS_SUNSPEC',
  host: '192.168.1.10',
  port: 502,
  unit_id: 1,
  timeout_ms: 5000
};

test('Fronius SunSpec energy uses WH_SF from the correct register offset', async () => {
  const driver = new FroniusSunSpecDriver(baseConfig);

  const common = new Array<number>(68).fill(0);
  common[0] = 1;

  const inv = new Array<number>(52).fill(0);
  inv[0] = 103;
  inv[3] = 10;
  inv[4] = 10;
  inv[5] = 10;
  inv[10] = 230;
  inv[11] = 230;
  inv[12] = 230;
  inv[14] = 900;
  inv[16] = 500;
  inv[24] = 1;
  inv[25] = 57920;
  inv[26] = 0xffff;
  inv[27] = 123;

  const client = {
    async readRegisters(_kind: string, start: number, length: number) {
      if (start === 40000 && length === 2) {
        return [0x5375, 0x6e53];
      }
      if (start === 40002 && length === 68) {
        return common;
      }
      if (start === 40070 && length === 52) {
        return inv;
      }
      throw new Error(`Unexpected register read ${start}:${length}`);
    }
  };

  (driver as unknown as { client: typeof client }).client = client;

  const data = await driver.read();

  assert.equal(data.total_power, 900);
  assert.equal(Number(data.total_forward_energy.toFixed(4)), 12.3456);
  assert.equal(Number(data.phase_a.forward_energy.toFixed(4)), 4.1152);
});
